'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ---------- مسارات الأدوات المضمّنة ----------
const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, '..', 'desktop-bin');

const userBin = path.join(app.getPath('userData'), 'bin');
const ytdlpUser = path.join(userBin, 'yt-dlp.exe');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');

// ---------- إعدادات المستخدم (اختيارية) ----------
// مثال لمحتوى settings.json:
// { "proxy": "socks5h://user:pass@host:1080", "cookiesBrowser": "firefox" }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}

// نسخة yt-dlp توضع في مجلد المستخدم (قابل للكتابة) حتى تتحدث تلقائيًا
function prepareYtDlp() {
  fs.mkdirSync(userBin, { recursive: true });
  const bundled = path.join(binDir, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpUser) && fs.existsSync(bundled)) {
    fs.copyFileSync(bundled, ytdlpUser);
