@echo off
chcp 65001 >nul
call npm install
call npm run fetch-tools
call npm run desktop
pause
