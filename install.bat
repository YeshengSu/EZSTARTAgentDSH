@echo off
setlocal
cd /d "%~dp0"
title EZAgent Installer

echo ==========================================
echo    EZAgent Installer
echo ==========================================
echo.
echo Please quit DeepSeek Harness completely before continuing,
echo including the tray icon.
echo.

if not exist "%~dp0install.ps1" (
    echo [ERROR] install.ps1 not found.
    echo         Put install.bat, install.ps1 and EZAgent-*.tgz in the same folder.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo Installation finished. Press any key to close this window.
) else if "%RC%"=="2" (
    echo Nothing was installed automatically. Follow the steps above,
    echo then press any key to close this window.
) else (
    echo Installation failed with exit code %RC%.
    echo Please send a screenshot of the messages above.
    echo Press any key to close this window.
)
pause >nul
exit /b %RC%
