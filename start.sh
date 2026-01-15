#!/bin/bash

# Meeting Transcription - 启动脚本
# 同时启动前端和后端服务

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Meeting Transcription 启动脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查虚拟环境
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}⚠️  虚拟环境不存在，正在创建...${NC}"
    uv venv
    source .venv/bin/activate
    uv pip install -r requirements.txt
else
    source .venv/bin/activate
fi

echo -e "${GREEN}✅ Python 虚拟环境已激活${NC}"

# 加载环境变量（如果存在 .env 文件）
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ 加载 .env 配置${NC}"
    export $(grep -v '^#' .env | xargs)
fi

# 清理函数
cleanup() {
    echo ""
    echo -e "${YELLOW}正在关闭服务...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo -e "${GREEN}✅ 服务已关闭${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# 清理可能占用的端口
echo ""
echo -e "${YELLOW}检查端口占用...${NC}"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
echo -e "${GREEN}✅ 端口已清理${NC}"

# 启动后端 (从项目根目录运行，使用模块导入，启用 HTTPS)
echo ""
echo -e "${BLUE}🚀 启动后端服务 (端口 8000 HTTPS)...${NC}"

# 如果有 SSL 证书，启用 HTTPS
SSL_ARGS=""
if [ -f ".ssl/cert.pem" ] && [ -f ".ssl/key.pem" ]; then
    SSL_ARGS="--ssl-keyfile .ssl/key.pem --ssl-certfile .ssl/cert.pem"
fi

python3 -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload $SSL_ARGS &
BACKEND_PID=$!

# 等待后端启动
sleep 3

# 启动前端 (使用 HTTPS 以支持远程麦克风访问)
echo ""
echo -e "${BLUE}🚀 启动前端服务 (端口 3000 HTTPS)...${NC}"

# 检查 SSL 证书是否存在
if [ ! -f ".ssl/cert.pem" ] || [ ! -f ".ssl/key.pem" ]; then
    echo -e "${YELLOW}生成 SSL 证书...${NC}"
    mkdir -p .ssl
    openssl req -x509 -newkey rsa:2048 -keyout .ssl/key.pem -out .ssl/cert.pem -days 365 -nodes -subj "/CN=localhost" 2>/dev/null
fi

npx -y serve -p 3000 --ssl-cert .ssl/cert.pem --ssl-key .ssl/key.pem &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ 服务启动成功！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  前端: ${BLUE}https://localhost:3000${NC}"
echo -e "  后端: ${BLUE}http://localhost:8000${NC}"
echo -e "  API 文档: ${BLUE}http://localhost:8000/docs${NC}"
echo ""
echo -e "${YELLOW}⚠️  首次访问 HTTPS 需要在浏览器中接受自签名证书${NC}"
echo -e "${YELLOW}   其他设备请访问: https://$(ipconfig getifaddr en0):3000${NC}"
echo ""
echo -e "${YELLOW}按 Ctrl+C 停止所有服务${NC}"
echo ""

# 等待进程
wait
