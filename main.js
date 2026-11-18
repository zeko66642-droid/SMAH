'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

// ---------- مسارات الأدوات المضمّنة ----------
const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, 'desktop-bin');

const userBin = path.join(app.getPath('userData'), 'bin');
const ytdlpUser = path.join(userBin, 'yt-dlp.exe');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');

// ---------- إعدادات المستخدم (اختيارية) ----------
// مثال لمحتوى settings.json:
// { "proxy": "socks5h://user:pass@host:1080", "cookiesBrowser": "firefox" }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}

function works(exe) {
  try {
    const r = spawnSync(exe, ['--version'], { windowsHide: true, timeout: 20000 });
    return r.status === 0;
  } catch (_) { return false; }
}

// نسخة yt-dlp توضع في مجلد المستخدم (قابل للكتابة) حتى تتحدث تلقائيًا.
// إذا تلفت (مثلاً أُغلق التطبيق أثناء التحديث) نستبدلها بالنسخة المضمّنة.
function prepareYtDlp() {
  fs.mkdirSync(userBin, { recursive: true });
  const bundled = path.join(binDir, 'yt-dlp.exe');
  if (fs.existsSync(ytdlpUser) && works(ytdlpUser)) return ytdlpUser;
  try {
    fs.rmSync(ytdlpUser, { force: true });
    fs.copyFileSync(bundled, ytdlpUser);
    if (works(ytdlpUser)) return ytdlpUser;
  } catch (_) {}
  return bundled;
}

// تحديث yt-dlp في الخلفية: مرة كل 12 ساعة وبعد 30 ثانية من التشغيل (حتى لا يزاحم أول تنزيل)
const stampFile = path.join(app.getPath('userData'), 'last-update-check.txt');
function updateYtDlpInBackground(exe) {
  let last = 0;
  try { last = Number(fs.readFileSync(stampFile, 'utf8')) || 0; } catch (_) {}
  if (Date.now() - last < 12 * 60 * 60 * 1000) return;
  setTimeout(() => {
    try {
      fs.writeFileSync(stampFile, String(Date.now()));
      const p = spawn(exe, ['-U'], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => {});
    } catch (_) {}
  }, 30000).unref();
}

let mainWindow = null;

async function createWindow() {
  const settings = readSettings();
  const ytdlp = prepareYtDlp();

  process.env.DESKTOP = '1';
  process.env.YTDLP_PATH = ytdlp;
  process.env.FFMPEG_PATH = path.join(binDir, 'ffmpeg.exe');
  process.env.DENO_PATH = path.join(binDir, 'deno.exe');
  process.env.DOWNLOAD_DIR = app.getPath('downloads');
  if (settings.proxy) process.env.PROXY_URL = String(settings.proxy);
  if (settings.geminiApiKey) process.env.GEMINI_API_KEY = String(settings.geminiApiKey).trim();
  if (settings.cookiesBrowser) process.env.COOKIES_BROWSER = String(settings.cookiesBrowser);

  // server.js يقرأ الإعدادات عند تحميله، فنستدعيه بعد ضبط المتغيرات
  const { start } = require(path.join(__dirname, 'server.js'));
  const { port } = await start({
    port: 0, // منفذ عشوائي حر
    onSaved: file => shell.showItemInFolder(file)
  });
  const origin = `http://127.0.0.1:${port}`;

  updateYtDlpInBackground(ytdlp);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'سَمْح',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // الروابط الخارجية تُفتح في المتصفح الافتراضي، ولا يخرج التطبيق من صفحته
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(origin);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'ملف',
      submenu: [
        { label: 'فتح مجلد التنزيلات', click: () => shell.openPath(app.getPath('downloads')) },
        {
          label: 'فتح مجلد الإعدادات',
          click: () => {
            if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{\n  "proxy": "",\n  "cookiesBrowser": "",\n  "geminiApiKey": ""\n}\n');
            shell.showItemInFolder(settingsFile);
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'خروج' }
      ]
    }
  ]));
}

// نسخة واحدة فقط من التطبيق
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await createWindow();
    } catch (e) {
      dialog.showErrorBox('سَمْح', `تعذر تشغيل التطبيق:\n${e.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
