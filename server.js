'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const dns = require('dns').promises;
const { execFile, spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_WIN = process.platform === 'win32';

/* ============== وضع التطبيق المكتبي (Electron) ==============
   DESKTOP=1  : يعمل على 127.0.0.1 فقط، بدون حدود الموقع العام،
                ويحفظ الفيديو مباشرة في مجلد التنزيلات (DOWNLOAD_DIR).
   YTDLP_PATH : مسار yt-dlp.exe (بدل Python)
   DENO_PATH  : مسار deno.exe (مطلوب ليوتيوب)
============================================================ */
const DESKTOP = process.env.DESKTOP === '1';
const YTDLP_PATH = process.env.YTDLP_PATH || '';
const DENO_PATH = process.env.DENO_PATH || '';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads');
let desktopHooks = {};   // { onSaved(filePath) } يمرره Electron
let allowedHost = '';    // يُضبط عند التشغيل في وضع التطبيق

/* ====================== الإعدادات (من متغيرات البيئة فقط) ======================
   لا توجد مسارات شخصية في الكود. على ويندوز اضبط FFMPEG_PATH و PYTHON_PATH
   في ملف .env أو في النظام إن لم يكونا في PATH.
=============================================================================== */
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const PYTHON_PATH = process.env.PYTHON_PATH || (IS_WIN ? 'python' : 'python3');
// الأمر الذي نشغّله: yt-dlp.exe مباشرة، أو Python مع -m yt_dlp
const RUNNER = YTDLP_PATH || PYTHON_PATH;
const RUNNER_PREFIX = YTDLP_PATH ? [] : ['-m', 'yt_dlp'];

const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || (DESKTOP ? 3 : 2);
const MAX_CONCURRENT_INFO = Number(process.env.MAX_CONCURRENT_INFO) || 4;
const DOWNLOAD_TIMEOUT_MS = (Number(process.env.DOWNLOAD_TIMEOUT_MIN) || 15) * 60 * 1000;
const MAX_FILESIZE = process.env.MAX_FILESIZE || (DESKTOP ? '' : '500M');

// عدد البروكسيات التي أمام الخادم (Render/Railway/Cloudflare = 1). 0 إذا يعمل مباشرة.
const TRUST_PROXY = process.env.TRUST_PROXY !== undefined
  ? Number(process.env.TRUST_PROXY)
  : (process.env.NODE_ENV === 'production' ? 1 : 0);

/* ----------------------------- البروكسي (اختياري) ----------------------------- */
// أمثلة: socks5h://user:pass@host:1080  أو  http://user:pass@host:8080
const PROXY_URL = (process.env.PROXY_URL || '').trim();
let proxyArgs = [];
if (PROXY_URL) {
  try {
    const p = new URL(PROXY_URL);
    if (!['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:'].includes(p.protocol)) throw new Error('bad protocol');
    proxyArgs = ['--proxy', PROXY_URL];
  } catch {
    console.error('[config] قيمة PROXY_URL غير صالحة، تم تجاهلها.');
  }
}

/* ------------------------------ الكوكيز (اختياري) ------------------------------
   COOKIES_FILE   : مسار ملف cookies.txt
   COOKIES_BASE64 : محتوى cookies.txt مشفّر base64 (مناسب للاستضافة بدون رفع ملفات)
   COOKIES_BROWSER: chrome/edge/firefox (للتشغيل المحلي فقط)
------------------------------------------------------------------------------- */
let cookieArgs = [];
(function setupCookies() {
  try {
    if (process.env.COOKIES_BASE64) {
      const target = path.join(os.tmpdir(), 'samh-cookies.txt');
      fs.writeFileSync(target, Buffer.from(process.env.COOKIES_BASE64, 'base64'), { mode: 0o600 });
      cookieArgs = ['--cookies', target];
    } else if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
      cookieArgs = ['--cookies', process.env.COOKIES_FILE];
    } else if (process.env.COOKIES_BROWSER) {
      cookieArgs = ['--cookies-from-browser', process.env.COOKIES_BROWSER];
    }
  } catch (e) {
    console.error('[config] تعذر تجهيز الكوكيز:', e.message);
  }
})();

// yt-dlp يفعّل Deno فقط افتراضيًا، وصورة Docker تحتوي Node
const jsRuntimeArgs = DENO_PATH ? ['--js-runtimes', `deno:${DENO_PATH}`] : ['--js-runtimes', 'node'];

// DISABLE_GENERIC=1 يمنع yt-dlp من فتح أي صفحة عشوائية (أمان أعلى لكن مواقع أقل)
const genericArgs = process.env.DISABLE_GENERIC === '1' ? ['--use-extractors', 'default,-generic'] : [];

const baseArgs = [
  ...RUNNER_PREFIX,
  '--ignore-config',
  '--no-warnings',
  '--no-playlist',
  '--socket-timeout', '20',
  ...jsRuntimeArgs,
  ...proxyArgs,
  ...cookieArgs,
  ...genericArgs
];

const ffmpegArgs = /[\\/]/.test(FFMPEG_PATH) ? ['--ffmpeg-location', path.dirname(FFMPEG_PATH)] : [];

/* ------------------------------ أدوات مساعدة ------------------------------ */
// إخفاء بيانات البروكسي من السجلات
function redact(text) {
  let s = String(text || '');
  if (PROXY_URL) s = s.split(PROXY_URL).join('[proxy]');
  return s.slice(0, 2000);
}

// تصنيف سبب الفشل من stderr لإرجاع رسالة مفيدة للمستخدم دون كشف تفاصيل تقنية
function classifyYtDlpError(stderr = '') {
  const s = String(stderr);
  if (/not a bot|--cookies/i.test(s)) {
    return { code: 'PLATFORM_VERIFICATION', status: 503,
      message: 'هذه المنصة تطلب تحققًا إضافيًا من الزائر حاليًا، لذلك لا يمكن استخراج هذا الرابط من الخادم. جرّب رابطًا آخر أو أعد المحاولة لاحقًا.' };
  }
  if (/private video|login required|members[- ]only|age[- ]restricted|requires? (a )?(login|authentication)/i.test(s)) {
    return { code: 'LOGIN_REQUIRED', status: 403,
      message: 'هذا الفيديو خاص أو مقيّد ويتطلب تسجيل دخول، ولا يمكن تنزيله.' };
  }
  if (/unsupported url/i.test(s)) {
    return { code: 'UNSUPPORTED_URL', status: 400, message: 'هذا الرابط غير مدعوم.' };
  }
  if (/video unavailable|has been removed|deleted|not available/i.test(s)) {
    return { code: 'UNAVAILABLE', status: 404, message: 'الفيديو غير متاح أو تم حذفه.' };
  }
  if (/unexpected response from webpage|unable to extract|unable to download webpage|http error 4\d\d|rehydration|captcha/i.test(s)) {
    return { code: 'EXTRACTOR_BLOCKED', status: 502,
      message: 'تعذّر على الخادم قراءة صفحة الفيديو من هذه المنصة حاليًا (قد تحجب المنصة الطلب أو تكون غيّرت بنيتها). حاول لاحقًا.' };
  }
  return { code: 'UNKNOWN', status: 500,
    message: 'تعذر استخراج معلومات الفيديو. تأكد من الرابط وحاول مرة أخرى.' };
}

/* ------------------- التحقق من الرابط (حماية من SSRF) ------------------- */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) {
      const rest = l.slice(7);
      return net.isIPv4(rest) ? isPrivateIp(rest) : true;
    }
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || /^ff/.test(l);
  }
  return true;
}

async function validateVideoUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'أدخل رابط الفيديو أولاً.' };
  if (raw.length > 2048) return { error: 'الرابط طويل جدًا.' };
  let parsed;
  try { parsed = new URL(raw.trim()); } catch { return { error: 'رابط الفيديو غير صحيح.' }; }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const portOk = parsed.port === '' || parsed.port === '80' || parsed.port === '443';
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !portOk ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'نوع الرابط غير مسموح.' };
  }

  try {
    const addrs = net.isIP(host)
      ? [{ address: host }]
      : await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
      return { error: 'نوع الرابط غير مسموح.' };
    }
  } catch {
    return { error: 'تعذر الوصول إلى هذا الرابط. تأكد من صحته.' };
  }
  return { url: parsed.href };
}

/* ------------------------------ الأمان والتحديد ------------------------------ */
app.set('trust proxy', TRUST_PROXY);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': null
    }
  },
  crossOriginEmbedderPolicy: false
}));

const tooMany = message => ({ code: 'RATE_LIMITED', error: message });
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  message: tooMany('طلبات كثيرة. انتظر قليلاً ثم أعد المحاولة.')
});
const infoLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: tooMany('طلبات كثيرة. انتظر دقيقة ثم أعد المحاولة.')
});
const downloadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false,
  message: tooMany('وصلت للحد المسموح من التنزيلات. أعد المحاولة بعد قليل.')
});

if (!DESKTOP) app.use(generalLimiter);

// في وضع التطبيق: نقبل الطلبات من صفحة التطبيق نفسها فقط (حماية من مواقع تحاول استدعاء الخادم المحلي)
if (DESKTOP) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (req.headers.host !== allowedHost || (origin && origin !== `http://${allowedHost}`)) {
      return res.status(403).json({ error: 'غير مسموح.' });
    }
    next();
  });
}
app.use(express.json({ limit: '10kb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'خادم سَمْح يعمل' });
});

/* ------------------------------ معلومات الفيديو ------------------------------ */
let activeInfo = 0;

app.post('/api/video-info', DESKTOP ? [] : infoLimiter, async (req, res) => {
  const checked = await validateVideoUrl((req.body || {}).url);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const videoUrl = checked.url;

  if (activeInfo >= MAX_CONCURRENT_INFO) {
    return res.status(503).json({ code: 'BUSY', error: 'الخادم مشغول الآن. حاول بعد لحظات.' });
  }
  activeInfo++;

  execFile(
    RUNNER,
    [...baseArgs, '--dump-single-json', '--skip-download', '--', videoUrl],
    { timeout: 60000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    (error, stdout, stderr) => {
      activeInfo--;
      if (error) {
        if (error.killed) {
          console.error(`[video-info] timeout host=${new URL(videoUrl).hostname}`);
          return res.status(504).json({ code: 'TIMEOUT', error: 'استغرق استخراج المعلومات وقتاً طويلاً. حاول مرة أخرى.' });
        }
        const info = classifyYtDlpError(stderr);
        console.error(`[video-info] code=${info.code} host=${new URL(videoUrl).hostname}\n${redact(stderr || error.message)}`);
        return res.status(info.status).json({ code: info.code, error: info.message });
      }

      try {
        const video = JSON.parse(stdout);
        const videoFormats = (video.formats || []).filter(f => f.vcodec && f.vcodec !== 'none' && f.height);

        return res.json({
          success: true,
          title: video.title || 'فيديو بدون عنوان',
          thumbnail: video.thumbnail || null,
          duration: video.duration ?? null,
          uploader: video.uploader || null,
          webpage_url: video.webpage_url || videoUrl,
          formats: videoFormats
            .map(f => ({
              format_id: f.format_id,
              ext: f.ext || null,
              quality: f.format_note || `${f.height}p`,
              height: f.height || null,
              filesize: f.filesize ?? f.filesize_approx ?? null,
              has_audio: Boolean(f.acodec && f.acodec !== 'none'),
              vcodec: f.vcodec || null,
              acodec: f.acodec || null
            }))
            .sort((a, b) =>
              a.height - b.height ||
              Number(b.has_audio) - Number(a.has_audio) ||
              (a.ext === 'mp4' ? -1 : 1)),
          heights: [...new Set(videoFormats.map(f => f.height))].sort((a, b) => b - a)
        });
      } catch (parseError) {
        console.error('JSON parsing error:', parseError.message);
        return res.status(500).json({ error: 'وصلت نتيجة غير متوقعة من أداة استخراج الفيديو.' });
      }
    }
  );
});

/* --------------------------------- التنزيل --------------------------------- */
const DOWNLOAD_ROOT = path.join(os.tmpdir(), 'samh-downloads');
fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });

// حذف أي مجلدات تنزيل قديمة (بقايا انقطاع أو انتهاء مهلة)
function sweepOldJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  fs.readdir(DOWNLOAD_ROOT, (err, names) => {
    if (err) return;
    names.forEach(name => {
      const full = path.join(DOWNLOAD_ROOT, name);
      fs.stat(full, (e, st) => {
        if (!e && st.mtimeMs < cutoff) fs.rm(full, { recursive: true, force: true }, () => {});
      });
    });
  });
}
sweepOldJobs();
setInterval(sweepOldJobs, 10 * 60 * 1000).unref();

let activeDownloads = 0;

app.post('/api/download', DESKTOP ? [] : downloadLimiter, async (req, res) => {
  const { url, height } = req.body || {};

  const checked = await validateVideoUrl(url);
  if (checked.error) return res.status(400).json({ error: checked.error });

  const isBest = String(height) === 'best';
  const selectedHeight = Number(height);
  if (!isBest && !(Number.isInteger(selectedHeight) && selectedHeight >= 100 && selectedHeight <= 4320)) {
    return res.status(400).json({ error: 'الجودة المختارة غير صالحة.' });
  }

  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return res.status(503).json({ code: 'BUSY', error: 'الخادم مشغول بتنزيلات أخرى الآن. أعد المحاولة بعد دقيقة.' });
  }

  const formatSelector = isBest
    ? 'bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4]/bv*+ba/b'
    : `bv*[height<=${selectedHeight}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height<=${selectedHeight}][vcodec^=avc1][ext=mp4]/bv*[height<=${selectedHeight}]+ba/b[height<=${selectedHeight}]/b`;

  // مجلد مستقل لكل عملية حتى يسهل تنظيفه بالكامل
  const jobDir = fs.mkdtempSync(path.join(DOWNLOAD_ROOT, 'job-'));
  const cleanup = () => fs.rm(jobDir, { recursive: true, force: true }, () => {});

  const args = [
    ...baseArgs,
    '--no-part',
    ...(MAX_FILESIZE ? ['--max-filesize', MAX_FILESIZE] : []),
    ...ffmpegArgs,
    '-f', formatSelector,
    '--merge-output-format', 'mp4',
    '-o', path.join(jobDir, '%(title).100s-%(id)s.%(ext)s'),
    '--print', 'after_move:filepath',
    '--',
    checked.url
  ];

  activeDownloads++;
  const child = spawn(RUNNER, args, { windowsHide: true });

  let stdout = '';
  let stderr = '';
  let responded = false;
  let finished = false;
  const killTimer = setTimeout(() => child.kill('SIGKILL'), DOWNLOAD_TIMEOUT_MS);

  // إذا أغلق المستخدم الصفحة أثناء المعالجة نوقف العملية فورًا
  res.on('close', () => { if (!finished) child.kill('SIGKILL'); });

  child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 1e6) stdout = stdout.slice(-1e5); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 1e6) stderr = stderr.slice(-1e5); });

  child.on('error', error => {
    finished = true;
    clearTimeout(killTimer);
    activeDownloads--;
    cleanup();
    if (responded) return;
    responded = true;
    console.error('Download process error:', error.message);
    res.status(500).json({ error: 'تعذر تشغيل أداة التنزيل.' });
  });

  child.on('close', code => {
    finished = true;
    clearTimeout(killTimer);
    activeDownloads--;
    if (responded) return cleanup();

    const outputFile = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const insideJobDir = outputFile && path.resolve(outputFile).startsWith(jobDir + path.sep);

    if (code !== 0 || !insideJobDir || !fs.existsSync(outputFile)) {
      const info = classifyYtDlpError(stderr);
      console.error(`[download] code=${info.code} exit=${code} host=${new URL(checked.url).hostname}\n${redact(stderr)}`);
      responded = true;
      cleanup();
      if (res.headersSent) return;
      return res.status(info.status).json({
        code: info.code,
        error: info.code === 'UNKNOWN'
          ? 'تعذر تنزيل الفيديو. جرّب «أفضل جودة»، وقد يكون الفيديو خاصاً أو يتطلب تسجيل دخول أو أكبر من الحد المسموح.'
          : info.message
      });
    }

    responded = true;

    if (DESKTOP) {
      // حفظ مباشر في مجلد التنزيلات بدل إرسال الملف للمتصفح
      try {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        const ext = path.extname(outputFile);
        const stem = path.basename(outputFile, ext);
        let dest = path.join(DOWNLOAD_DIR, stem + ext);
        for (let i = 1; fs.existsSync(dest); i++) dest = path.join(DOWNLOAD_DIR, `${stem} (${i})${ext}`);
        fs.copyFileSync(outputFile, dest);
        cleanup();
        if (desktopHooks.onSaved) desktopHooks.onSaved(dest);
        return res.json({ saved: true, filename: path.basename(dest), folder: DOWNLOAD_DIR });
      } catch (e) {
        console.error('Saving file failed:', e.message);
        cleanup();
        return res.status(500).json({ error: 'تعذر حفظ الفيديو في مجلد التنزيلات.' });
      }
    }

    res.download(outputFile, path.basename(outputFile), error => {
      if (error) console.error('Sending download failed:', error.message);
      cleanup();
    });
  });
});

/* ------------------------------ معالجة الأخطاء ------------------------------ */
app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود.' }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'طلب غير صالح.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'الطلب كبير جدًا.' });
  console.error('Unhandled error:', err && err.message);
  res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
});

function start({ port = PORT, onSaved } = {}) {
  desktopHooks = { onSaved };
  const host = DESKTOP ? '127.0.0.1' : '0.0.0.0';
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const actualPort = server.address().port;
      allowedHost = `127.0.0.1:${actualPort}`;
      console.log(`منصة سَمْح تعمل على المنفذ ${actualPort}${DESKTOP ? ' (وضع التطبيق)' : ''}`);
      console.log(`[config] proxy=${proxyArgs.length ? 'on' : 'off'} cookies=${cookieArgs.length ? 'on' : 'off'} trustProxy=${TRUST_PROXY}`);

      execFile(RUNNER, [...RUNNER_PREFIX, '--version'], { timeout: 15000, windowsHide: true }, (err, out, errOut) => {
        if (err) console.error('[yt-dlp] تعذر قراءة الإصدار:', errOut || err.message);
        else console.log(`[yt-dlp] version=${out.trim()}`);
      });
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

module.exports = { start, app };

// التشغيل المباشر: node server.js (الموقع على الاستضافة)
if (require.main === module) {
  start().catch(e => { console.error(e); process.exit(1); });
}
