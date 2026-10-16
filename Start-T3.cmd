@echo off
cd /d "%~dp0"
node scripts\t3-local.mjs start
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts\pair-browser.mjs --open
