# 会议转录 Web 应用 - 实现方案

> 类似 Notion 会议录制 / 飞书妙记的浏览器端实时语音转录应用

## 项目目标

1. **浏览器端录音** - 通过笔记本麦克风进行录音
2. **实时转录** - 浏览器侧完成语音转文字（免费方案）
3. **页面管理** - 每次转录作为独立 page 记录
4. **列表展示** - 根据时间和时长展示管理所有转录记录
5. **离线缓存** - 断电断网可恢复，数据本地持久化
6. **后端同步** - 可选的后端数据库管理

---

## 技术方案对比

### 语音识别引擎

| 方案 | 实时性 | 准确度 | 首次加载 | 离线支持 | 隐私 | 费用 |
|------|--------|--------|----------|----------|------|------|
| **Web Speech API** | ✅ 实时 | 良好 | 即用 | ❌ 需网络 | 音频发到 Google | **免费** |
| **Whisper.js (WASM)** | 延迟 1-3s | 优秀 | 40-200MB | ✅ 完全离线 | 本地处理 | **免费** |
| **Transformers.js** | 延迟 2-5s | 优秀 | 50-300MB | ✅ 完全离线 | 本地处理 | **免费** |

### 选择方案

**Phase 1: Web Speech API（当前实现）**
- 优点：即用、实时、无需下载模型
- 缺点：需要网络、仅 Chrome/Edge 支持
- 适用：快速原型、大部分使用场景

**Phase 2: Whisper.js 增强（后续可选）**
- 优点：完全离线、隐私保护、识别更准确
- 缺点：首次下载模型、对设备性能有要求
- 适用：需要离线使用或对隐私敏感的场景

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器端                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   UI 界面    │  │  录音控制   │  │    转录文字显示     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│  ┌──────▼────────────────▼─────────────────────▼──────────┐ │
│  │                    主应用 (main.js)                     │ │
│  └─────────────────────────┬───────────────────────────────┘ │
│                            │                                │
│  ┌────────────┐  ┌────────▼────────┐  ┌──────────────────┐ │
│  │ 🎤         │  │ SpeechRecognition│  │   AudioRecorder  │ │
│  │ MediaStream│──│   Service        │  │   Service        │ │
│  └────────────┘  └────────┬────────┘  └────────┬─────────┘ │
│                           │                     │           │
│  ┌────────────────────────▼─────────────────────▼─────────┐ │
│  │              IndexedDB (Dexie.js)                       │ │
│  │  ┌───────────┐  ┌──────────────┐  ┌────────────────┐   │ │
│  │  │   Pages   │  │   Segments   │  │  AudioChunks   │   │ │
│  │  └───────────┘  └──────────────┘  └────────────────┘   │ │
│  └─────────────────────────┬───────────────────────────────┘ │
│                            │                                │
│  ┌─────────────────────────▼───────────────────────────────┐ │
│  │              Sync Manager (可选)                         │ │
│  └─────────────────────────┬───────────────────────────────┘ │
└────────────────────────────┼────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   后端 API      │
                    │  (可选, 后续)   │
                    └─────────────────┘
```

---

## 数据模型

### IndexedDB Schema (Dexie.js)

```javascript
// 转录页面
const PageSchema = {
  id: 'string',           // UUID
  title: 'string',        // 标题（自动生成或用户编辑）
  createdAt: 'Date',      // 创建时间
  updatedAt: 'Date',      // 最后更新时间
  duration: 'number',     // 录音时长（秒）
  status: 'string',       // 'recording' | 'paused' | 'completed'
  syncStatus: 'string',   // 'pending' | 'synced' | 'failed'
  language: 'string'      // 识别语言 'zh-CN' | 'en-US'
};

// 转录片段
const SegmentSchema = {
  id: 'string',           // UUID
  pageId: 'string',       // 关联的 page ID
  text: 'string',         // 转录文本
  timestamp: 'number',    // 相对于录音开始的时间（毫秒）
  confidence: 'number',   // 识别置信度 0-1
  isFinal: 'boolean',     // 是否为最终结果
  createdAt: 'Date'
};

// 音频块（可选，用于回放）
const AudioChunkSchema = {
  id: 'string',           // UUID
  pageId: 'string',       // 关联的 page ID
  blob: 'Blob',           // 音频数据
  startTime: 'number',    // 开始时间
  endTime: 'number'       // 结束时间
};
```

---

## 项目结构

```
metting/
├── index.html              # 入口 HTML
├── index.css               # 全局样式（设计系统）
├── main.js                 # 主入口
├── components/
│   ├── App.js              # 主应用组件
│   ├── Header.js           # 顶部导航栏
│   ├── PageList.js         # 转录页面列表
│   ├── PageCard.js         # 单个页面卡片
│   ├── RecordingView.js    # 录音 & 转录界面
│   ├── TranscriptDisplay.js # 实时转录文字展示
│   ├── RecordingControls.js # 录音控制按钮
│   └── PageDetail.js       # 页面详情/编辑
├── services/
│   ├── SpeechRecognition.js  # Web Speech API 封装
│   ├── AudioRecorder.js      # MediaRecorder 封装
│   ├── Database.js           # IndexedDB/Dexie 操作
│   └── SyncManager.js        # 后端同步管理（可选）
├── utils/
│   ├── uuid.js               # UUID 生成
│   ├── formatters.js         # 时间/时长格式化
│   └── browserCheck.js       # 浏览器兼容性检查
├── docs/
│   └── implementation_plan.md # 本文档
└── backend/                  # 后端（可选，后续实现）
    ├── server.js
    └── database.js
```

---

## Web Speech API 核心实现

### 1. 语音识别服务封装

```javascript
// services/SpeechRecognition.js
class SpeechRecognitionService {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error('浏览器不支持语音识别，请使用 Chrome 或 Edge');
    }
    
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;        // 持续识别
    this.recognition.interimResults = true;    // 返回中间结果
    this.recognition.lang = 'zh-CN';           // 中文识别
    
    this.isRunning = false;
    this.onResult = null;
    this.onError = null;
    
    this._setupEventHandlers();
  }
  
  _setupEventHandlers() {
    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;
        const confidence = result[0].confidence;
        
        if (this.onResult) {
          this.onResult({ transcript, isFinal, confidence });
        }
      }
    };
    
    // 处理 60 秒超时自动重启
    this.recognition.onend = () => {
      if (this.isRunning) {
        this.recognition.start();  // 自动重启
      }
    };
    
    this.recognition.onerror = (event) => {
      if (this.onError) {
        this.onError(event.error);
      }
    };
  }
  
  start() {
    this.isRunning = true;
    this.recognition.start();
  }
  
  stop() {
    this.isRunning = false;
    this.recognition.stop();
  }
}
```

### 2. 录音控制按钮

```javascript
// 开始录音
async function startRecording() {
  // 1. 创建新的 Page
  const page = await db.pages.add({
    id: generateUUID(),
    title: `录音 ${formatDate(new Date())}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    duration: 0,
    status: 'recording',
    syncStatus: 'pending'
  });
  
  // 2. 启动语音识别
  speechService.onResult = ({ transcript, isFinal, confidence }) => {
    // 保存到 IndexedDB
    db.segments.add({
      id: generateUUID(),
      pageId: page.id,
      text: transcript,
      timestamp: Date.now() - startTime,
      confidence,
      isFinal,
      createdAt: new Date()
    });
    
    // 更新 UI
    updateTranscriptDisplay(transcript, isFinal);
  };
  
  speechService.start();
}
```

---

## 关键功能流程

### 录音转录流程

```
用户点击开始 → 创建 Page(status: recording)
                  ↓
             请求麦克风权限
                  ↓
         启动 SpeechRecognition + AudioRecorder
                  ↓
    ┌─────────────────────────────────┐
    │     持续识别循环               │
    │  ┌──────────────────────────┐  │
    │  │ 收到中间结果             │  │
    │  │ → 显示灰色临时文字      │  │
    │  └──────────────────────────┘  │
    │  ┌──────────────────────────┐  │
    │  │ 收到最终结果             │  │
    │  │ → 保存到 IndexedDB      │  │
    │  │ → 显示确认文字          │  │
    │  └──────────────────────────┘  │
    └─────────────────────────────────┘
                  ↓
用户点击停止 → 停止识别 → 更新 Page(status: completed)
```

### 离线恢复流程

```
打开应用 → 检查 IndexedDB 中 status='recording' 的 Page
              ↓
         找到未完成录音?
           /        \
          是         否
          ↓          ↓
     提示用户     正常显示列表
     是否恢复?
          ↓
      加载已保存的 Segments
      显示之前的转录内容
      用户可选择继续或保存
```

---

## UI 设计规范

### 颜色系统（深色主题）

```css
:root {
  /* 背景色 */
  --bg-primary: #0a0a0a;
  --bg-secondary: #141414;
  --bg-card: #1a1a1a;
  --bg-hover: #242424;
  
  /* 文字色 */
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --text-muted: #666666;
  
  /* 强调色 */
  --accent-primary: #6366f1;    /* 紫色 */
  --accent-success: #22c55e;    /* 绿色 */
  --accent-warning: #f59e0b;    /* 橙色 */
  --accent-error: #ef4444;      /* 红色 */
  
  /* 毛玻璃效果 */
  --glass-bg: rgba(255, 255, 255, 0.05);
  --glass-border: rgba(255, 255, 255, 0.1);
}
```

### 组件样式

- **卡片**: 圆角 12px，毛玻璃背景，微阴影
- **按钮**: 渐变背景，悬停发光效果
- **动画**: 平滑过渡 0.2s，微交互动效
- **录音按钮**: 脉冲动画表示录音中

---

## 实现阶段

### Phase 1: 核心功能（当前）
- [x] 项目结构搭建
- [ ] 基础 UI 框架
- [ ] Web Speech API 集成
- [ ] IndexedDB 持久化
- [ ] 页面列表管理

### Phase 2: 增强功能
- [ ] 音频录制和回放
- [ ] 搜索过滤
- [ ] 导出功能（TXT/Markdown）
- [ ] 编辑转录文本

### Phase 3: Whisper.js 离线（可选）
- [ ] Transformers.js 集成
- [ ] 模型下载管理
- [ ] 离线识别流程

### Phase 4: 后端同步（可选）
- [ ] REST API 服务
- [ ] 数据同步机制
- [ ] 多设备支持

---

## 浏览器兼容性

| 功能 | Chrome | Edge | Firefox | Safari |
|------|--------|------|---------|--------|
| Web Speech API | ✅ | ✅ | ❌ | ❌ |
| MediaRecorder | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |
| Whisper.js | ✅ | ✅ | ✅ | ✅ |

> ⚠️ **注意**: Web Speech API 仅在 Chrome/Edge 中支持。建议在应用中检测并提示用户。

---

## 已知限制

1. **Web Speech API 60 秒限制**: Chrome 的语音识别约 60 秒后自动断开，需要处理自动重连
2. **需要 HTTPS**: 麦克风权限需要安全上下文（localhost 除外）
3. **浏览器清除数据**: IndexedDB 会被清除，重要数据建议后端同步
4. **识别准确度**: 受网络质量、口音、背景噪音影响
