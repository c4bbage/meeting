#!/bin/bash

# Caddy Domain Startup Script
# Starts Frontend (HTTP) + Backend (HTTP) + Caddy (HTTPS Proxy)

set -e

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

# 0. Cleanup ports
echo "Checking ports..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
sudo lsof -ti:80 | xargs sudo kill -9 2>/dev/null || true
sudo lsof -ti:443 | xargs sudo kill -9 2>/dev/null || true
echo "✅ Ports clean"

# 1. Start Backend (HTTP Mode - standard)
# We force SSL off by overriding potential env vars or just running raw
echo "Starting Backend (Port 8000 HTTP)..."
source .venv/bin/activate
python3 -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# 2. Start Frontend (HTTP Mode - standard)
echo "Starting Frontend (Port 3000 HTTP)..."
npx -y serve -p 3000 &
FRONTEND_PID=$!

# 3. Start Caddy
echo "Starting Caddy (Port 80/443)..."
# Using sudo because port 80/443 requires root
sudo caddy run --config Caddyfile --adapter caddyfile &
CADDY_PID=$!

cleanup() {
    echo "Stopping services..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    sudo kill $CADDY_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

echo "✅ Services Running!"
echo "   Access via: https://<your-domain>"

wait
