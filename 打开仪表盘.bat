@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-dashboard.ps1" -Port 8787
if errorlevel 1 pause
