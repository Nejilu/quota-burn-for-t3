@echo off
cd /d "%~dp0"
node scripts\t3-local.mjs start
if errorlevel 1 goto fail
node scripts\burn-local.mjs start
if errorlevel 1 goto fail
node scripts\burn-local.mjs open
exit /b 0
:fail
pause
exit /b 1
