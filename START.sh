#!/bin/bash

# Finance Management System - One-Click Launcher
# Mac/Linux version

echo "========================================"
echo "  Finance Management System Launcher"
echo "========================================"
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "[✓] Node.js found: $(node --version)"
echo ""
echo "[1/5] Checking dependencies..."
echo ""

# Check and install backend dependencies
if [ ! -d "backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    cd backend
    npm install
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install backend dependencies!"
        exit 1
    fi
    cd "$SCRIPT_DIR"
    echo "[✓] Backend dependencies installed!"
else
    echo "[✓] Backend dependencies already installed."
fi

# Check and install frontend dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd frontend
    npm install
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install frontend dependencies!"
        exit 1
    fi
    cd "$SCRIPT_DIR"
    echo "[✓] Frontend dependencies installed!"
else
    echo "[✓] Frontend dependencies already installed."
fi

echo ""
echo "[2/5] Starting backend server..."
cd backend
npm run dev &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

sleep 3

echo "[3/5] Starting frontend server..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd "$SCRIPT_DIR"

echo ""
echo "[4/5] Waiting for servers to be ready..."
sleep 5

echo "[5/5] Opening browser..."

# Try to open browser (works on Mac and most Linux distros)
if command -v open &> /dev/null; then
    # macOS
    open http://localhost:5173
elif command -v xdg-open &> /dev/null; then
    # Linux
    xdg-open http://localhost:5173
elif command -v gnome-open &> /dev/null; then
    # GNOME
    gnome-open http://localhost:5173
else
    echo "Please open http://localhost:5173 in your browser"
fi

echo ""
echo "========================================"
echo "  Servers are starting!"
echo "========================================"
echo ""
echo "Backend:  http://localhost:4000"
echo "Frontend: http://localhost:5173"
echo ""
echo "Servers are running in the background."
echo "Press Ctrl+C to stop the servers."
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit
}

trap cleanup INT TERM

# Wait for user interrupt
wait
