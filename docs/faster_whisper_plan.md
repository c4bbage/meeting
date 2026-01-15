# faster-whisper Backend Implementation Plan

> 基于飞书妙记分析的本地 AI 转录后端设计  
> 日期: 2025-01-14

---

## 一、项目背景

### 1.1 飞书妙记核心能力 (参考)

| 功能 | 实现方式 | 本项目实现 |
|------|---------|-----------|
| 录音 | MediaRecorder API | ✅ 已有 |
| 热词 (3/200个) | 分类热词 (人名/公司/技术等) | ⭐ 待实现 |
| 实时转录 | 自研 ASR | Web Speech API + faster-whisper |
| 单词时间戳 | ASR 返回 | ⭐ 待实现 |
| 同步播放 | 时间索引点击 | 🔄 后期 |

### 1.2 技术选型

| 组件 | 选择 | 理由 |
|------|-----|------|
| ASR 引擎 | **faster-whisper (small)** | 开源、支持热词、~500MB 模型 |
| 后端框架 | **FastAPI** | 轻量、自动文档、高性能 |
| 数据存储 | **IndexedDB** (前端) + **JSON** (热词) | 保持离线优先 |
| Python 版本 | **3.12** (uv 管理) | 最新稳定版 |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         浏览器                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌─────────────────┐   ┌─────────────┐  │
│  │ AudioRecorder│    │ SpeechRecognition│   │ WhisperAPI  │  │
│  │ (录音服务)    │    │ (Web Speech API) │   │ (后端客户端) │  │
│  └──────┬───────┘    └────────┬────────┘   └──────┬──────┘  │
│         │                     │                    │         │
│         │   实时转录 (在线)    │                    │ 精确转录 │
│         │◄────────────────────┘                    │ (离线)  │
│         │                                          │         │
│         ▼                                          ▼         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    IndexedDB                             ││
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ ││
│  │  │  pages  │  │ segments │  │ hotwords │  │audioChunks│ ││
│  │  └─────────┘  └──────────┘  └──────────┘  └──────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
└────────────────────────────────────┬────────────────────────┘
                                     │ POST /api/transcribe
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                Python Backend (localhost:8000)               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    FastAPI Server                      │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │  │
│  │  │ /transcribe │  │ /hotwords   │  │ /health       │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └───────────────┘  │  │
│  │         │                │                             │  │
│  │  ┌──────▼──────┐  ┌──────▼──────┐                     │  │
│  │  │Transcription│  │  Hotword    │                     │  │
│  │  │Service      │  │  Manager    │                     │  │
│  │  └──────┬──────┘  └─────────────┘                     │  │
│  │         │                                              │  │
│  │  ┌──────▼──────────────────────────────────────────┐  │  │
│  │  │           faster-whisper (small model)           │  │  │
│  │  │  - hotwords 参数                                  │  │  │
│  │  │  - initial_prompt (分类上下文)                    │  │  │
│  │  │  - word_timestamps=True                          │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  📁 data/hotwords.json                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、数据库设计

### 3.1 现有 IndexedDB Schema (前端)

```javascript
// Version 2 - 当前版本
db.version(2).stores({
  pages: 'id, createdAt, updatedAt, status, syncStatus',
  segments: 'id, pageId, timestamp, isFinal, speaker',
  audioChunks: 'id, pageId, startTime',
  speakerData: 'pageId'
});
```

### 3.2 新增: hotwords 表

```javascript
// Version 3 - 添加热词支持
db.version(3).stores({
  pages: 'id, createdAt, updatedAt, status, syncStatus',
  segments: 'id, pageId, timestamp, isFinal, speaker',
  audioChunks: 'id, pageId, startTime',
  speakerData: 'pageId',
  hotwords: 'id, word, category, createdAt'  // 新增
});
```

### 3.3 Hotword Schema

```javascript
const HotwordSchema = {
  id: 'string',           // UUID
  word: 'string',         // 热词文本，如 "张三" 或 "Kubernetes"
  category: 'string',     // 分类: person|company|technology|location|noun|other
  pinyin: 'string',       // 可选: 拼音 (辅助搜索)
  createdAt: 'Date',
  updatedAt: 'Date'
};

// 分类常量 (来自飞书妙记)
const HOTWORD_CATEGORIES = {
  person: '人名',
  company: '公司',
  department: '部门',
  technology: '技术',
  noun: '名词',
  location: '地名',
  traffic: '交通',
  building: '建筑',
  occupation: '职业',
  other: '其他'
};
```

### 3.4 扩展 Segment Schema (支持单词时间戳)

```javascript
const SegmentSchema = {
  id: 'string',
  pageId: 'string',
  text: 'string',
  timestamp: 'number',      // 段落开始时间 (毫秒)
  endTime: 'number',        // 新增: 段落结束时间
  confidence: 'number',
  isFinal: 'boolean',
  speaker: 'string',
  speakerLabel: 'string',
  speakerColor: 'string',
  
  // 新增: 单词级时间戳 (来自 faster-whisper)
  words: [{
    word: 'string',
    start: 'number',        // 秒
    end: 'number',          // 秒
    probability: 'number'
  }],
  
  // 新增: 转录来源
  source: 'string',         // 'web_speech' | 'whisper'
  createdAt: 'Date'
};
```

---

## 四、API 设计

### 4.1 POST /api/transcribe

**请求:**
```
POST /api/transcribe
Content-Type: multipart/form-data

file: <audio_file>          # 音频文件 (webm/mp3/wav)
language: "zh"              # 可选: zh|en|ja (默认 zh)
hotwords: "张三 李四 K8s"    # 可选: 空格分隔热词
```

**响应:**
```json
{
  "success": true,
  "language": "zh",
  "duration": 45.5,
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 3.5,
      "text": "大家好，我是张三",
      "words": [
        {"word": "大家好", "start": 0.0, "end": 0.5, "probability": 0.95},
        {"word": "我是", "start": 0.6, "end": 0.9, "probability": 0.98},
        {"word": "张三", "start": 1.0, "end": 1.3, "probability": 0.99}
      ]
    }
  ]
}
```

### 4.2 GET /api/hotwords

**响应:**
```json
{
  "hotwords": [
    {"id": "xxx", "word": "张三", "category": "person"},
    {"id": "yyy", "word": "Kubernetes", "category": "technology"}
  ],
  "categories": ["person", "company", "technology", ...]
}
```

### 4.3 POST /api/hotwords

**请求:**
```json
{
  "word": "Docker",
  "category": "technology"
}
```

### 4.4 DELETE /api/hotwords/{id}

删除指定热词。

---

## 五、文件结构

```
meeting/
├── backend/
│   ├── __init__.py
│   ├── server.py           # FastAPI 入口
│   ├── transcription.py    # faster-whisper 服务
│   ├── hotwords.py         # 热词管理
│   └── data/
│       └── hotwords.json   # 热词持久化
├── services/
│   ├── AudioRecorder.js    # (已有)
│   ├── Database.js         # (更新 v3)
│   ├── SpeechRecognition.js # (已有)
│   ├── WhisperAPI.js       # (新增) 后端 API 客户端
│   └── HotwordManager.js   # (新增) 热词 UI 管理
├── pyproject.toml          # Python 依赖
├── .python-version         # 3.12
└── requirements.txt        # pip 兼容
```

---

## 六、实现步骤

### Phase 1: 后端核心 (今天)

1. [x] 创建 `feature/faster-whisper` 分支
2. [x] 配置 Python 3.12 + uv 环境
3. [x] 安装 faster-whisper
4. [ ] 创建 `backend/transcription.py`
5. [ ] 创建 `backend/hotwords.py`
6. [ ] 创建 `backend/server.py`
7. [ ] 测试转录 API

### Phase 2: 前端集成

8. [ ] 创建 `services/WhisperAPI.js`
9. [ ] 更新 `services/Database.js` (v3 + 热词表)
10. [ ] 更新 `main.js` - 录音后调用后端转录
11. [ ] 添加 ASR 引擎切换 UI

### Phase 3: 热词管理

12. [ ] 创建热词管理 UI
13. [ ] 实现热词 CRUD
14. [ ] 测试热词效果

---

## 七、依赖安装

```bash
# 已完成
uv venv --python 3.12
uv pip install faster-whisper

# 需要添加
uv pip install fastapi uvicorn python-multipart
```

---

## 八、启动命令

```bash
# 启动后端
cd /Users/cgy/wkgit/meeting
source .venv/bin/activate
python -m uvicorn backend.server:app --reload --port 8000

# 前端 (另一个终端)
open index.html  # 或用 live-server
```

---

## 九、验证计划

### 9.1 单元测试

```bash
# 测试转录服务
python -c "
from backend.transcription import TranscriptionService
svc = TranscriptionService()
result = svc.transcribe('test.mp3', language='zh', hotwords='测试')
print(result)
"
```

### 9.2 API 测试

```bash
# 健康检查
curl http://localhost:8000/health

# 转录测试
curl -X POST http://localhost:8000/api/transcribe \
  -F "file=@test_audio.webm" \
  -F "language=zh"

# 热词管理
curl http://localhost:8000/api/hotwords
```

### 9.3 端到端测试

1. 打开浏览器录音
2. 说一段包含自定义热词的话
3. 验证热词被正确识别
4. 检查单词时间戳返回
