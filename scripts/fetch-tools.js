'use strict';
/*
  ينزّل الأدوات التي تُضمَّن داخل التطبيق إلى desktop-bin/:
    - yt-dlp.exe   (استخراج وتنزيل الفيديو)
    - ffmpeg.exe   (دمج الصوت والصورة)
    - deno.exe     (مطلوب ليوتيوب)
  التشغيل: npm run fetch-tools
*/
const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const OUT = path.join(__dirname, '..', 'desktop-bin');
fs.mkdirSync(OUT, { recursive: true });

const FILES = [
  {
    name: 'yt-dlp.exe',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  },
  {
    name: 'ffmpeg.exe',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
    zipEntries: ['ffmpeg.exe', 'ffprobe.exe']
  },
  {
    name: 'deno.exe',
    url: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
    zipEntries: ['deno.exe']
  }
];

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'samh-build' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  for (const f of FILES) {
    if (fs.existsSync(path.join(OUT, f.name))) {
      console.log(`✔ ${f.name} موجود`);
      continue;
    }
    console.log(`↓ تنزيل ${f.name} ...`);
    const data = await download(f.url);

    if (!f.zipEntries) {
      fs.writeFileSync(path.join(OUT, f.name), data);
    } else {
      const zip = new AdmZip(data);
      for (const wanted of f.zipEntries) {
        const entry = zip.getEntries().find(e => !e.isDirectory && path.basename(e.entryName).toLowerCase() === wanted);
        if (!entry) throw new Error(`${wanted} غير موجود داخل الملف المضغوط`);
        fs.writeFileSync(path.join(OUT, wanted), entry.getData());
      }
    }
    console.log(`✔ ${f.name}`);
  }
  console.log('تم. الأدوات في:', OUT);
})().catch(e => {
  console.error('فشل تنزيل الأدوات:', e.message);
  process.exit(1);
});
