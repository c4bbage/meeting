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

### Browser-only Mode (Web Speech API)

```bash
# Just open index.html in Chrome/Edge
open index.html
```

### With Local AI (faster-whisper)

```bash
# Install Python dependencies
pip install faster-whisper

# Run transcription service
python services/transcribe.py
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
