@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"
title EZAgent 安装

echo ==========================================
echo    EZAgent 安装程序
echo ==========================================
echo.
echo 运行前请【完全退出 DeepSeek Harness】，托盘图标也要退出。
echo.

if not exist "%~dp0install.ps1" (
    echo [错误] 找不到 install.ps1。
    echo        请把 install.bat、install.ps1 和 EZAgent-*.tgz 放在同一个文件夹。
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo 安装完成。按任意键关闭窗口。
) else if "%RC%"=="2" (
    echo 未自动安装。请按上面的步骤在 DeepSeek Harness 界面里手动添加。
    echo 按任意键关闭窗口。
) else (
    echo 安装失败，退出码 %RC%。请把上面的提示截图反馈。
    echo 按任意键关闭窗口。
)
pause >nul
exit /b %RC%
