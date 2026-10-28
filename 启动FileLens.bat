@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装 Python 3 并加入 PATH。
  pause
  exit /b 1
)
if "%~1"=="" (
  echo 请输入要浏览的文件夹完整路径（可以直接把文件夹拖进本窗口），然后按回车：
  set /p FOLDER=路径: 
) else (
  set "FOLDER=%~1"
)
if "%FOLDER%"=="" (
  echo [提示] 未提供路径，将以空白页面启动，稍后可在页面顶部粘贴路径。
  python server.py
) else (
  python server.py "%FOLDER%"
)
pause
