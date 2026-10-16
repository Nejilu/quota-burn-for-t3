@echo off
cd /d "%~dp0"
node scripts\t3-local.mjs stop
if errorlevel 1 pause
