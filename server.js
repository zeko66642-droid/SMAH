
const express = require('express');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = 3000;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'C:\\Users\\pcfor\\Desktop\\ffmpeg-9.0.2-essentials_build\\ffmpeg-9.0.2-essentials_build\\bin\\ffmpeg.exe';
const PYTHON_PATH = process.env.PYTHON_PATH || 'C:\\Users\\pcfor\\AppData\\Local\\Python\\pythoncore-3.15-64\\python.exe';
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const COOKIES_BROWSER = process.env.COOKIES_BROWSER || ''; // مثال: chrome أو edge أو firefox
const cookieArgs = COOKIES_BROWSER ? ['--cookies-from-browser', COOKIES_BROWSER] : [];

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];

function validateVideoUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'أدخل رابط الفيديو أولاً.' };
  let parsed;
  try { parsed = new URL(raw.trim()); } catch { return { error: 'رابط الفيديو غير صحيح.' }; }
  const host = parsed.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username || parsed.password ||
      BLOCKED_HOSTS.includes(host) ||
      /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return { error: 'نوع الرابط غير مسموح.' };
  }
  return { url: parsed.href };
}

app.use(express.json({ limit: '10kb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));


app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'خادم سَمْح يعمل'
  });
});

app.post('/api/video-info', (req, res) => {
  const checked = validateVideoUrl((req.body || {}).url);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const videoUrl = checked.url;

  execFile(
    PYTHON_PATH,
    [
      '-m',
      'yt_dlp',
      '--dump-single-json',
      '--no-warnings',
      '--skip-download',
      '--no-playlist',
      ...cookieArgs,
      '--',
      videoUrl
],
    {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    },
    (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp error:', stderr || error.message);

        return res.status(500).json({
          error: error.killed
            ? 'استغرق استخراج المعلومات وقتاً طويلاً. حاول مرة أخرى.'
            : 'تعذر استخراج معلومات الفيديو. تأكد من الرابط وحاول مرة أخرى.'
        });
      }

   
      try {
        const video = JSON.parse(stdout);

        return res.json({
          success: true,
          title: video.title || 'فيديو بدون عنوان',
          thumbnail: video.thumbnail || null,
          duration: video.duration ?? null,
          uploader: video.uploader || null,
          webpage_url: video.webpage_url || videoUrl,
          heights: [...new Set(
            (video.formats || [])
              .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
              .map(f => f.height)
          )].sort((x, y) => y - x)
        });
      } catch (parseError) {
        console.error('JSON parsing error:', parseError.message);

        return res.status(500).json({
          error: 'وصلت نتيجة غير متوقعة من أداة استخراج الفيديو.'
        });
      }
    }
  );
});

app.post('/api/download', (req, res) => {
  const { url, height } = req.body || {};

  const checked = validateVideoUrl(url);
  if (checked.error) return res.status(400).json({ error: checked.error });

  const isBest = String(height) === 'best';
  const selectedHeight = Number(height);

  if (!isBest && !(Number.isInteger(selectedHeight) && selectedHeight >= 100 && selectedHeight <= 4320)) {
    return res.status(400).json({ error: 'الجودة المختارة غير صالحة.' });
  }

  
const formatSelector = isBest
  ? 'bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4]/bv*+ba/b'
  : `bv*[height<=${selectedHeight}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=${selectedHeight}][vcodec^=avc1][ext=mp4]/bv*[height<=${selectedHeight}]+ba/b[height<=${selectedHeight}]/b`;

  const outputDir = path.join(os.tmpdir(), 'samh-downloads');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputTemplate = path.join(outputDir, '%(title).100s-%(id)s.%(ext)s');

  const args = [
    '-m', 'yt_dlp',
    '--no-warnings',
    '--no-playlist',
    '--no-part',
    '--ffmpeg-location',
    path.dirname(FFMPEG_PATH),
   '-f', formatSelector,
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    ...cookieArgs,
    '--print', 'after_move:filepath',
    '--',
    checked.url
  ];

  const child = spawn(PYTHON_PATH, args, { windowsHide: true });

  let stdout = '';
  let stderr = '';
  let responded = false;
  const killTimer = setTimeout(() => child.kill(), 15 * 60 * 1000);

  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  child.on('error', error => {
    if (responded) return;
    responded = true;
    console.error('Download process error:', error);
    res.status(500).json({ error: 'تعذر تشغيل أداة التنزيل.' });
  });

  child.on('close', code => {
    clearTimeout(killTimer);
    if (responded) return;

    const outputFile = stdout.trim().split(/\r?\n/).filter(Boolean).pop();

    if (code !== 0 || !outputFile || !fs.existsSync(outputFile)) {
      console.error('yt-dlp download failed:', stderr);
      responded = true;
      return res.status(500).json({
        error: 'تعذر تنزيل الفيديو. جرّب «أفضل جودة» أو حدّث yt-dlp، وقد يكون الفيديو خاصاً أو يتطلب تسجيل دخول.'
      });
    }

    responded = true;
    res.download(outputFile, path.basename(outputFile), error => {
      if (error) console.error('Sending download failed:', error.message);
      fs.promises.unlink(outputFile).catch(() => {});
    });
  });
});


app.listen(PORT, '127.0.0.1', () => {
  console.log(`منصة سَمْح تعمل على http://localhost:${PORT}`);
});

