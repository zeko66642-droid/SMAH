@echo off
chcp 65001 >nul
echo === بناء تطبيق سمح للويندوز ===
call npm install
if errorlevel 1 goto fail
call npm run fetch-tools
if errorlevel 1 goto fail
call npm run dist
if errorlevel 1 goto fail
echo.
echo تم! ملف التثبيت داخل مجلد dist
explorer dist
pause
exit /b 0
:fail
echo حدث خطأ. انسخ الرسالة أعلاه وأرسلها.
pause
