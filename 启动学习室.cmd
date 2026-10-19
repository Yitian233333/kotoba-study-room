@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer from https://nodejs.org/
  pause
  exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 pause
