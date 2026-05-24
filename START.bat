@echo off
title Finance Management System - Starting...
color 0A

echo ========================================
echo   Finance Management System Launcher
echo ========================================
echo.

REM Get the directory where this script is located
cd /d "%~dp0"

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/5] Checking dependencies...
echo.

REM Check and install backend dependencies
if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    cd backend
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install backend dependencies!
        pause
        exit /b 1
    )
    cd ..
    echo Backend dependencies installed!
) else (
    echo Backend dependencies already installed.
)

REM Check and install frontend dependencies
if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install frontend dependencies!
        pause
        exit /b 1
    )
    cd ..
    echo Frontend dependencies installed!
) else (
    echo Frontend dependencies already installed.
)

echo.
echo [2/5] Starting backend server...
start "Backend Server" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 3 /nobreak >nul

echo [3/5] Starting frontend server...
start "Frontend Server" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 5 /nobreak >nul

echo.
echo [4/5] Waiting for servers to be ready...
timeout /t 3 /nobreak >nul

echo [5/5] Opening browser...
start http://localhost:5173

echo.
echo ========================================
echo   Servers are starting!
echo ========================================
echo.
echo Backend:  http://localhost:4000
echo Frontend: http://localhost:5173
echo.
echo Two command windows have opened - keep them open while using the app.
echo Close this window or press any key to exit this launcher.
echo (The servers will continue running in their own windows)
echo.
pause >nul
