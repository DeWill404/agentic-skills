@echo off
if "%REMOTE_INPUT_ALLOW%"=="" (
  echo Set the controller IP once, then open a new window:  setx REMOTE_INPUT_ALLOW 192.168.1.50
  pause
  exit /b 1
)
py -3 "%~dp0server.py" --allow %REMOTE_INPUT_ALLOW% %*
pause
