<#
.SYNOPSIS
  安装 EZAgent 到 DeepSeek Harness 桌面版，并按需安装两个公开插件。
.DESCRIPTION
  运行前必须完全退出 DeepSeek Harness。没有 dsh 命令时会打印图形界面的手动步骤。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -LocalOnly
#>
[CmdletBinding()]
param([switch]$LocalOnly)

$ErrorActionPreference = 'Stop'

$publicPlugins = @(
    'dsh-mnemon@0.5.39',
    '@huanlin/dsh-plugin-better-sidebar-plugin-office@0.2.0'
)
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'

function Stop-Install([string]$Message) {
    Write-Host ''
    Write-Host $Message -ForegroundColor Red
    exit 1
}

$tgz = @(
    (Join-Path $PSScriptRoot 'EZAgent-*.tgz'),
    (Join-Path $PSScriptRoot 'dist\EZAgent-*.tgz')
) | ForEach-Object { Get-ChildItem -Path $_ -File -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $tgz) { Stop-Install '未找到 EZAgent-*.tgz，请把安装包放在本脚本同一目录（或其 dist 子目录）。' }

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
    Stop-Install "没有找到 DSH 桌面版配置（$profileDir）。请先打开一次 DeepSeek Harness，再完全退出后重试。"
}

if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
    Stop-Install 'DeepSeek Harness 正在运行。请从托盘完全退出后再运行本脚本。'
}

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) {
    Write-Host '本机没有 dsh 命令，请用图形界面安装：' -ForegroundColor Yellow
    Write-Host '  1. 打开 DeepSeek Harness，左侧「插件」→「添加插件」'
    Write-Host "  2. 粘贴：$($tgz.FullName)"
    $step = 3
    if (-not $LocalOnly) {
        foreach ($p in $publicPlugins) {
            Write-Host "  $step. 再添加：$p"
            $step++
        }
    }
    Write-Host "  $step. 全部装完，重启 DeepSeek Harness"
    exit 0
}

# 兼容性检查用的是 dsh 命令自身的版本，不是桌面应用的版本
$runtimeFile = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json'
if (Test-Path $runtimeFile) {
    $appVersion = (Get-Content $runtimeFile -Raw | ConvertFrom-Json).desktopVersion
    $cliVersion = (& dsh --version) 2>$null
    if ($appVersion -and $cliVersion -and $appVersion -ne $cliVersion) {
        Write-Host "提示：dsh 命令是 $cliVersion，桌面运行时是 $appVersion；版本不一致时安装可能被兼容性检查拒绝。" -ForegroundColor Yellow
        Write-Host '      遇到时改用图形界面安装，或先执行：npm i -g @deepseek-ai/dsh@latest' -ForegroundColor Yellow
    }
}

Write-Host "安装 EZAgent：$($tgz.FullName)"
& dsh plugin --profile desktop add $tgz.FullName
if ($LASTEXITCODE -ne 0) {
    Stop-Install "EZAgent 安装失败（退出码 $LASTEXITCODE）。日志：$profileDir\.plugin-manager\logs"
}

if (-not $LocalOnly) {
    Write-Host "安装公开插件：$($publicPlugins -join ', ')"
    & dsh plugin --profile desktop add @publicPlugins
    if ($LASTEXITCODE -ne 0) {
        Write-Host '公开插件安装失败（无网络或版本不兼容）。EZAgent 已装好，可稍后在插件页重试。' -ForegroundColor Yellow
    }
}

$manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$bundles = @($manifest.dsh.profile.bundles)
$expected = @('EZAgent')
if (-not $LocalOnly) { $expected += 'dsh-mnemon', '@huanlin/dsh-plugin-better-sidebar-plugin-office' }
$missing = @($expected | Where-Object { $bundles -notcontains $_ })
if ($missing.Count -gt 0) {
    Stop-Install "已安装但未启用：$($missing -join ', ')。请打开插件页手动启用。"
}

Write-Host ''
Write-Host "完成：$($expected -join ', ')。启动 DeepSeek Harness 生效。" -ForegroundColor Green
exit 0
