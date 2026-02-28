# Meeting Transcription

> Browser-based real-time speech transcription app inspired by Feishu Minutes

A lightweight, privacy-focused meeting transcription tool that runs entirely in your browser with optional local AI processing.

## ✨ Features

- 🎤 **Browser Recording** - Record directly from your microphone
- 📝 **Real-time Transcription** - Speech-to-text with Web Speech API
- 🔤 **Custom Hotwords** - Improve accuracy for names, technical terms
- 💾 **Offline Storage** - All data stored locally in IndexedDB
- 🔒 **Privacy First** - No data leaves your device (when using local ASR)

## 📸 Screenshots

### Reference: Feishu Minutes Overview
![Feishu Minutes main interface showing recording and transcription features](docs/images/feishu_overview.webp)

### Reference: Recording & Hotwords Configuration
![Recording interface and personal hotwords settings panel](docs/images/recording_hotwords.webp)

## 🛠️ Tech Stack

### Frontend
- **Vanilla JavaScript** - No framework dependencies
- **Web Speech API** - Real-time browser transcription
- **MediaRecorder API** - High-quality audio capture
- **IndexedDB (Dexie.js)** - Local data persistence

### Backend (Optional)
- **Python 3.8+** with faster-whisper
- Local AI transcription with custom vocabulary support

## 🚀 Quick Start

### 1. Prerequisites

- **Python 3.12+**
- **uv** (Modern Python package manager)
  - Install: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Caddy** (For domain access / local HTTPS)
  - Install: `brew install caddy` (macOS) or see [Caddy Docs](https://caddyserver.com/docs/install)
- **FFmpeg** (Recommended for audio processing)
  - Install: `brew install ffmpeg`

### 2. Setup & Run (Domain/LAN Mode)

This is the recommended way to run the app, using Caddy to handle HTTPS and reverse proxying, which allows access from other devices on your network (like phones/tablets).

1.  **Configure Environment**:
    ```bash
    cp .env.example .env
    # Edit .env and set your configurations (e.g., GEMINI_API_KEY)
    ```

2.  **Configure Caddy**:
    ```bash
    # Edit Caddyfile to set your domain or local hostname
    nano Caddyfile
    ```

3.  **Start Services**:
    ```bash
    ./start_domain.sh
    ```

    This script will:
    - Auto-install Python dependencies via `uv`.
    - Start the Backend (FastAPI) on port **6543**.
    - Start the Frontend (serve) on port **3456**.
    - Start Caddy (HTTPS Reverse Proxy) on port **8443**.

4.  **Access**:
    Open `https://<your-domain>:8443` (or `https://localhost:8443`).
    > Note: You will need to accept the self-signed certificate warning.

### 3. Verification

- Backend Health: `curl http://localhost:8443/health`






> ⚠️ **注意**: 必须通过 HTTP 服务器访问（不要直接打开 file://），否则 Web Speech API 和 ES Modules 无法正常工作。

### 仅浏览器模式（无后端）

如果只使用 Web Speech API（无需 Whisper），可以用任意 HTTP 服务器：

```bash
# 方式1：Python
python3 -m http.server 5500

# 方式2：Node.js
npx serve -p 5500

# 方式3：VS Code Live Server 插件
```

## 🔤 Hotwords Support

Custom vocabulary improves recognition accuracy for domain-specific terms:

```python
from faster_whisper import WhisperModel

model = WhisperModel("large-v3", device="cuda")

segments, info = model.transcribe(
    "meeting.mp3",
    language="zh",
    word_timestamps=True,
    # Custom hotwords for better accuracy
    hotwords="Kubernetes Docker 张三 李四 微服务",
    initial_prompt="Technical meeting about container orchestration."
)
```

### Supported Hotword Categories

| Category | Chinese | Example |
|----------|---------|---------|
| Person | 人名 | 张三, John |
| Company | 公司 | Google, 字节跳动 |
| Technology | 技术 | Kubernetes, Docker |
| Location | 地名 | Beijing, 硅谷 |
| Occupation | 职业 | Engineer, 产品经理 |

## 🔧 ASR Options Comparison

| Engine | Hotwords | Offline | Accuracy | Setup |
|--------|----------|---------|----------|-------|
| **Web Speech API** | ❌ | ❌ | Good | None |
| **faster-whisper** | ✅ | ✅ | Excellent | Python |
| **Vosk** | ✅ | ✅ | Good | Python |

## 📁 Project Structure

```
meeting/
├── index.html          # Main entry
├── index.css           # Design system
├── main.js             # App logic
├── services/
│   ├── SpeechRecognition.js
│   ├── AudioRecorder.js
│   └── Database.js
├── docs/
│   ├── images/
│   ├── feishu_minutes_analysis.md
│   └── recording_hotwords_implementation.md
└── README.md
```

## 📖 Documentation

- [Feishu Minutes Analysis](docs/feishu_minutes_analysis.md) - Feature breakdown
- [Recording & Hotwords Guide](docs/recording_hotwords_implementation.md) - Implementation details

## 🌐 Browser Support

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Web Speech API | ✅ | ✅ | ❌ | ❌ |
| MediaRecorder | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |

## 📄 License

MIT
