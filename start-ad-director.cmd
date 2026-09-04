@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title AdDirector AI 本地服务

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 npm，请检查 Node.js 安装。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [提示] 尚未安装依赖，请先在当前目录运行 npm install。
  pause
  exit /b 1
)

echo 正在启动 AdDirector AI，服务就绪后会自动打开浏览器。
call npm run local
if errorlevel 1 (
  echo.
  echo [错误] 启动失败，请查看上方日志。
  pause
)

endlocal