@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py -3 server.py
) else (
  python server.py
)
echo.
echo Se il programma non si apre, installa Python 3 da python.org.
pause
