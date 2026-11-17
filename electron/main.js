'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, '..', 'desktop-bin');

const userBin = path.join(app.getPath('userData'), 'bin');
const ytdlpUser = path.join(userBin, 'yt-dlp.exe');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}

function prepareYtDlp() {
  fs.mkdirSync(userBin, { recursive: true });
  const bundled = path.join(binDir, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpUser) && fs.existsSync(bundled)) {
    fs.copyFileSync(bundled, ytdlpUser);
  }
  return fs.existsSync(ytdlpUser) ? ytdlpUser : bundled;
}

function updateYtDlpInBackground(exe) {
  try {
    const p = spawn(exe, ['-U'], { windowsHide: true, stdio: 'ignore' });
    p.on('error', () => {});
  } catch (_) {}
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
  if (settings.cookiesBrowser) process.env.COOKIES_BROWSER = String(settings.cookiesBrowser);

  const { start } = require(path.join(__dirname, '..', 'server.js'));
  const { port } = await start({
    port: 0,
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
            if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{\n  "proxy": "",\n  "cookiesBrowser": ""\n}\n');
            shell.showItemInFolder(settingsFile);
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'خروج' }
      ]
    }
  ]));
}

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
