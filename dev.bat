@echo off
chcp 65001 >nul
title PokeScouter Dev

rem Check if ports are already in use
netstat -aon | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [ERROR] Port 8000 is already in use.
    goto :abort
)

netstat -aon | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [ERROR] Port 5173 is already in use.
    goto :abort
)

echo Starting backend (port 8000)...
start "PokeScouter Backend" cmd /k "cd /d %~dp0backend && call %~dp0.venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo Starting frontend (port 5173)...
start "PokeScouter Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Both servers starting in separate windows.
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo.
timeout /t 3 >nul
exit /b 0

:abort
echo.
echo Launch cancelled. Close existing servers first.
pause
exit /b 1
