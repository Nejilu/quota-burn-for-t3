@echo off
cd /d "%~dp0"
node scripts\t3-local.mjs start
if errorlevel 1 goto finish
node scripts\connect-claude.mjs
:finish
pause
