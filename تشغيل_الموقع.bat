@echo off
chcp 65001 > nul
title تشغيل منصة سَمْح
echo جارٍ تشغيل منصة سَمْح...

if not exist node_modules (
    echo تثبيت الاعتماديات...
    call npm install
)

start "" http://localhost:3000
node server.js
pause