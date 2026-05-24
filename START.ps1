# Finance Management System - One-Click Launcher
# PowerShell version

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Finance Management System Launcher" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "[✓] Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[✗] ERROR: Node.js is not installed!" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "[1/5] Checking dependencies..." -ForegroundColor Cyan
Write-Host ""

# Check and install backend dependencies
if (-not (Test-Path "backend\node_modules")) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    Set-Location "backend"
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[✗] ERROR: Failed to install backend dependencies!" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Set-Location $scriptDir
    Write-Host "[✓] Backend dependencies installed!" -ForegroundColor Green
} else {
    Write-Host "[✓] Backend dependencies already installed." -ForegroundColor Green
}

# Check and install frontend dependencies
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Set-Location "frontend"
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[✗] ERROR: Failed to install frontend dependencies!" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Set-Location $scriptDir
    Write-Host "[✓] Frontend dependencies installed!" -ForegroundColor Green
} else {
    Write-Host "[✓] Frontend dependencies already installed." -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/5] Starting backend server..." -ForegroundColor Cyan
$backendProcess = Start-Process -FilePath "cmd" -ArgumentList "/k", "cd /d `"$scriptDir\backend`" && npm run dev" -PassThru -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host "[3/5] Starting frontend server..." -ForegroundColor Cyan
$frontendProcess = Start-Process -FilePath "cmd" -ArgumentList "/k", "cd /d `"$scriptDir\frontend`" && npm run dev" -PassThru -WindowStyle Normal

Write-Host ""
Write-Host "[4/5] Waiting for servers to be ready..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

Write-Host "[5/5] Opening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Servers are starting!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  http://localhost:4000" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Two command windows have opened - keep them open while using the app." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the servers, or close this window." -ForegroundColor Yellow
Write-Host ""

# Keep script running
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} catch {
    Write-Host "`nStopping servers..." -ForegroundColor Yellow
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue
}
