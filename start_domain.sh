#!/bin/bash

# Caddy Domain Startup Script
# Starts Frontend (HTTP) + Backend (HTTP) + Caddy (HTTPS Proxy)
# Backend has watchdog auto-restart on crash

# Note: no 'set -e' — backend watchdog needs to survive uvicorn crashes

STOPPING=false
STOP_FILE="/tmp/.meeting-backend-stop"
rm -f "$STOP_FILE"

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "❌ Error: 'uv' is not installed. Please install it first (e.g., 'curl -LsSf https://astral.sh/uv/install.sh | sh')."
    exit 1
fi

# Load settings
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Check if domain is configured in Caddyfile
if grep -q "meeting.example.com" Caddyfile; then
    echo "⚠️  警告: 请先修改 Caddyfile，将 'meeting.example.com' 替换为你的真实域名！"
    echo "   命令: nano Caddyfile"
    exit 1
fi

echo "🚀 Starting services for Domain Access..."

# 0. Sync dependencies
echo "📦 Syncing dependencies with uv..."
uv sync

# 0. Cleanup ports
echo "Checking ports..."
lsof -ti:3456 | xargs kill -9 2>/dev/null || true
lsof -ti:6543 | xargs kill -9 2>/dev/null || true
lsof -ti:8443 | xargs kill -9 2>/dev/null || true
echo "✅ Ports clean"

# 1. Start Backend with watchdog (auto-restart on crash)
echo "Starting Backend (Port 6543 HTTP) with watchdog..."
backend_watchdog() {
    while [ ! -f "$STOP_FILE" ]; do
        echo "[$(date '+%H:%M:%S')] 🔄 Starting backend..."
        uv run uvicorn backend.server:app --host 0.0.0.0 --port 6543; EXIT_CODE=$?
        if [ -f "$STOP_FILE" ]; then
            break
        fi
        echo "[$(date '+%H:%M:%S')] ⚠️  Backend exited (code: $EXIT_CODE), restarting in 3s..."
        sleep 3
    done
}
backend_watchdog &
BACKEND_PID=$!

# 2. Start Frontend (HTTP Mode - standard)
echo "Starting Frontend (Port 3456 HTTP)..."
# Use Python's built-in HTTP server instead of Node.js
# -m http.server serves the current directory
uv run python -m http.server 3456 &
FRONTEND_PID=$!

# 3. Start Caddy
echo "Starting Caddy (Port 8443)..."
# Using sudo not needed for >1024 ports usually, but keep if user wants checks
# But wait, Caddyfile will need to change to :8443
caddy run --config Caddyfile --adapter caddyfile &
CADDY_PID=$!

cleanup() {
    echo "Stopping services..."
    touch "$STOP_FILE"
    lsof -ti:6543 | xargs kill 2>/dev/null || true
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    kill $CADDY_PID 2>/dev/null
    rm -f "$STOP_FILE"
    exit
}

trap cleanup SIGINT SIGTERM

echo "✅ Services Running!"
echo "   Access via: https://localhost:8443"

wait
