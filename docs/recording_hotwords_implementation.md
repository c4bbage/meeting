# 录音与热词功能实现指南

> 基于飞书妙记功能分析 + 开源方案调研  
> 目标: 实现纯音频录制 + 个人热词 + 高精度转录

---

## 一、飞书妙记录音功能详解

### 1.1 录音界面功能

通过浏览器深入分析飞书妙记的录音界面，发现以下功能：

| 功能 | 实现方式 | 我们的方案 |
|------|---------|-----------|
| **开始/暂停/结束** | 标准 MediaRecorder API | ✅ 已有基础 |
| **语言选择** | 普通话/英语/日语 | ✅ 可实现 |
| **源语言翻译** | 多语言实时翻译 | 🔄 后期可选 |
| **录音时长显示** | 前端计时器 | ✅ 可实现 |
| **实时文字预览** | 需付费升级 | 🔄 根据ASR能力 |

![录音界面探索](file:///Users/cgy/.gemini/antigravity/brain/64782001-759f-497c-a501-937f78957e44/recording_hotwords_deep_dive_1768403668975.webp)

### 1.2 个人热词功能 (核心差异化)

飞书妙记的热词系统是提升识别准确率的关键：

```
┌─────────────────────────────────────────────────────────┐
│                    个人热词面板                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  免费版: 最多 3 个热词                                   │
│  付费版: 最多 200 个热词                                 │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │  热词分类 (提高识别准确率)                           ││
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       ││
│  │  │ 人名   │ │ 公司   │ │ 部门   │ │ 技术   │       ││
│  │  └────────┘ └────────┘ └────────┘ └────────┘       ││
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       ││
│  │  │ 名词   │ │ 地名   │ │ 交通   │ │ 建筑   │       ││
│  │  └────────┘ └────────┘ └────────┘ └────────┘       ││
│  │  ┌────────┐                                         ││
│  │  │ 职业   │                                         ││
│  │  └────────┘                                         ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ⚠️ 当前仅支持配置中文热词                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**热词分类的作用**：通过告诉 ASR 引擎词语的类别，可以减少歧义，提高识别准确率。例如：
- "张三" 标记为 `人名` → 避免识别成 "涨三"
- "Kubernetes" 标记为 `技术` → 避免识别错误

---

## 二、开源 ASR 方案对比

### 2.1 热词支持能力对比

| 方案 | 热词支持 | 实现方式 | 中文支持 | 推荐指数 |
|------|---------|---------|----------|---------|
| **faster-whisper** | ✅ `hotwords` 参数 | 字符串列表，空格分隔 | ✅ 优秀 | ⭐⭐⭐⭐⭐ |
| **Vosk** | ✅ 动态词汇表 | 传入词语数组到 Recognizer | ✅ 良好 | ⭐⭐⭐⭐ |
| **OpenAI Whisper** | ✅ `initial_prompt` | 通过 Prompt 引导 | ✅ 优秀 | ⭐⭐⭐⭐ |
| **Google STT** | ✅ `speechContexts` | 词语权重提升 | ✅ 优秀 | ⭐⭐⭐ (付费) |

### 2.2 推荐方案: faster-whisper + 热词

**选择理由:**
1. 开源免费，本地运行
2. 原生 `hotwords` 参数支持
3. 支持 word-level 时间戳 (同步播放必需)
4. 比原版 Whisper 快 4 倍，内存更少
5. 中文识别准确率高

---

## 三、faster-whisper 热词实现

### 3.1 基础用法

```python
from faster_whisper import WhisperModel

# 加载模型 (推荐 large-v3 或 medium 平衡性能)
model = WhisperModel("large-v3", device="cuda", compute_type="float16")
# 如果没有 GPU，使用:
# model = WhisperModel("medium", device="cpu", compute_type="int8")

# 使用热词转录
segments, info = model.transcribe(
    "meeting.mp3",
    language="zh",  # 中文
    word_timestamps=True,  # 获取单词级时间戳
    
    # 🔑 核心: 热词参数
    hotwords="张三 李四 Kubernetes Docker 微服务 K8s 机器学习",
    
    # 可选: 上下文提示 (更强的引导)
    initial_prompt="这是一个技术会议，参与者有张三和李四，讨论的内容涉及 Kubernetes、Docker 容器化部署。",
)

# 输出结果
for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
    
    # 获取单词级时间戳 (用于同步播放)
    for word in segment.words:
        print(f"  {word.start:.2f}s - {word.end:.2f}s: '{word.word}'")
```

### 3.2 带分类的热词系统

模拟飞书妙记的分类热词功能：

```python
from faster_whisper import WhisperModel
from typing import Dict, List

class HotwordManager:
    """热词管理器 - 模拟飞书妙记的分类热词系统"""
    
    CATEGORIES = {
        "人名": "person",
        "公司": "company", 
        "部门": "department",
        "技术": "technology",
        "名词": "noun",
        "地名": "location",
        "交通": "traffic",
        "建筑": "building",
        "职业": "occupation"
    }
    
    def __init__(self):
        self.hotwords: Dict[str, List[str]] = {cat: [] for cat in self.CATEGORIES}
    
    def add_hotword(self, word: str, category: str):
        """添加热词到指定分类"""
        if category in self.hotwords:
            self.hotwords[category].append(word)
    
    def get_hotwords_string(self) -> str:
        """获取所有热词的空格分隔字符串 (用于 faster-whisper)"""
        all_words = []
        for words in self.hotwords.values():
            all_words.extend(words)
        return " ".join(all_words)
    
    def generate_initial_prompt(self) -> str:
        """根据分类生成智能 initial_prompt"""
        prompt_parts = []
        
        if self.hotwords.get("人名"):
            names = "、".join(self.hotwords["人名"])
            prompt_parts.append(f"参与者包括{names}")
        
        if self.hotwords.get("公司"):
            companies = "、".join(self.hotwords["公司"])
            prompt_parts.append(f"涉及公司：{companies}")
        
        if self.hotwords.get("技术"):
            techs = "、".join(self.hotwords["技术"])
            prompt_parts.append(f"技术术语：{techs}")
        
        return "。".join(prompt_parts) + "。" if prompt_parts else ""


# 使用示例
hotword_mgr = HotwordManager()
hotword_mgr.add_hotword("张三", "人名")
hotword_mgr.add_hotword("李四", "人名")
hotword_mgr.add_hotword("字节跳动", "公司")
hotword_mgr.add_hotword("Kubernetes", "技术")
hotword_mgr.add_hotword("Docker", "技术")

model = WhisperModel("large-v3", device="cuda", compute_type="float16")

segments, info = model.transcribe(
    "meeting.mp3",
    language="zh",
    word_timestamps=True,
    hotwords=hotword_mgr.get_hotwords_string(),
    initial_prompt=hotword_mgr.generate_initial_prompt()
)
```

### 3.3 返回数据结构

```json
{
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 3.5,
      "text": "大家好，我是张三，今天我们来讨论 Kubernetes 的部署方案",
      "words": [
        {"word": "大家好", "start": 0.0, "end": 0.5, "probability": 0.95},
        {"word": "我是", "start": 0.6, "end": 0.9, "probability": 0.98},
        {"word": "张三", "start": 1.0, "end": 1.3, "probability": 0.99},
        {"word": "今天", "start": 1.5, "end": 1.8, "probability": 0.97},
        {"word": "Kubernetes", "start": 2.5, "end": 3.2, "probability": 0.96}
      ]
    }
  ],
  "language": "zh",
  "duration": 120.5
}
```

---

## 四、Vosk 备选方案 (纯离线)

如果需要完全离线 + 更轻量的方案，可使用 Vosk：

### 4.1 基础用法

```python
from vosk import Model, KaldiRecognizer
import wave
import json

# 下载中文模型: https://alphacephei.com/vosk/models
# 推荐: vosk-model-cn-0.22 (1.3GB，准确率高)
model = Model("vosk-model-cn-0.22")

# 创建识别器
wf = wave.open("meeting.wav", "rb")
rec = KaldiRecognizer(model, wf.getframerate())
rec.SetWords(True)  # 启用单词时间戳

# 🔑 设置自定义词汇表 (热词)
# 注意: 需要使用支持动态图的模型
rec.SetPartialWords(True)

results = []
while True:
    data = wf.readframes(4000)
    if len(data) == 0:
        break
    if rec.AcceptWaveform(data):
        result = json.loads(rec.Result())
        results.append(result)

# 获取最终结果
final = json.loads(rec.FinalResult())
results.append(final)
```

### 4.2 Vosk 动态词汇表

```python
from vosk import Model, KaldiRecognizer
import json

model = Model("vosk-model-cn-0.22")

# 限定词汇表 (只识别这些词)
vocabulary = '["张三", "李四", "kubernetes", "docker", "微服务", "[unk]"]'

rec = KaldiRecognizer(model, 16000, vocabulary)

# [unk] 表示允许未知词，否则只会识别列表中的词
```

---

## 五、浏览器端录音实现

### 5.1 完整录音服务

```javascript
// services/AudioRecorder.js
class AudioRecorderService {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.startTime = null;
    this.onDataAvailable = null;
  }

  /**
   * 请求麦克风权限并初始化录音
   */
  async init() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,           // 单声道 (ASR推荐)
          sampleRate: 16000,         // 16kHz (Whisper推荐)
          echoCancellation: true,    // 回声消除
          noiseSuppression: true,    // 噪音抑制
          autoGainControl: true      // 自动增益
        }
      });
      
      // 检测支持的音频格式
      const mimeType = this._getSupportedMimeType();
      
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128000
      });
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          if (this.onDataAvailable) {
            this.onDataAvailable(event.data);
          }
        }
      };
      
      return true;
    } catch (error) {
      console.error('麦克风权限获取失败:', error);
      throw error;
    }
  }
  
  _getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'audio/webm'; // 默认
  }

  /**
   * 开始录音
   * @param {number} timeslice - 数据块间隔 (毫秒)，用于实时上传
   */
  start(timeslice = 5000) {
    if (!this.mediaRecorder) {
      throw new Error('请先调用 init() 初始化录音器');
    }
    
    this.audioChunks = [];
    this.startTime = Date.now();
    this.mediaRecorder.start(timeslice);
  }

  /**
   * 暂停录音
   */
  pause() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  /**
   * 恢复录音
   */
  resume() {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  /**
   * 停止录音并返回音频 Blob
   */
  async stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }
      
      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType;
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        const duration = (Date.now() - this.startTime) / 1000;
        
        resolve({
          blob: audioBlob,
          duration,
          mimeType,
          size: audioBlob.size
        });
      };
      
      this.mediaRecorder.stop();
    });
  }

  /**
   * 释放资源
   */
  destroy() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.mediaRecorder = null;
    this.stream = null;
    this.audioChunks = [];
  }

  /**
   * 获取当前录音时长
   */
  getDuration() {
    if (!this.startTime) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * 获取录音状态
   */
  getState() {
    return this.mediaRecorder?.state || 'inactive';
  }
}

export default AudioRecorderService;
```

### 5.2 实时音频可视化

```javascript
// 音频波形可视化 (录音时的动画效果)
class AudioVisualizer {
  constructor(stream, canvasElement) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    
    this.analyser.fftSize = 256;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.isRunning = false;
  }

  start() {
    this.isRunning = true;
    this._draw();
  }

  stop() {
    this.isRunning = false;
  }

  _draw() {
    if (!this.isRunning) return;
    
    requestAnimationFrame(() => this._draw());
    
    this.analyser.getByteFrequencyData(this.dataArray);
    
    const { width, height } = this.canvas;
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, width, height);
    
    const barWidth = (width / this.dataArray.length) * 2.5;
    let x = 0;
    
    for (let i = 0; i < this.dataArray.length; i++) {
      const barHeight = (this.dataArray[i] / 255) * height;
      
      // 渐变色
      const gradient = this.ctx.createLinearGradient(0, height, 0, height - barHeight);
      gradient.addColorStop(0, '#6366f1');
      gradient.addColorStop(1, '#a855f7');
      
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
  }
}
```

---

## 六、推荐架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (浏览器)                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐ │
│  │ AudioRecorder │   │ Hotword UI    │   │ Transcript    │ │
│  │ Service       │   │ (热词管理)     │   │ Display       │ │
│  └───────┬───────┘   └───────┬───────┘   └───────────────┘ │
│          │                   │                             │
│  ┌───────▼───────────────────▼───────────────────────────┐ │
│  │              IndexedDB (本地存储)                       │ │
│  │  - 热词列表  - 录音文件  - 转录结果                      │ │
│  └───────────────────────────┬───────────────────────────┘ │
└──────────────────────────────┼──────────────────────────────┘
                               │ 上传音频
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      后端 (Python)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                 faster-whisper 服务                     │ │
│  │                                                         │ │
│  │   model.transcribe(                                     │ │
│  │       audio_file,                                       │ │
│  │       language="zh",                                    │ │
│  │       word_timestamps=True,                             │ │
│  │       hotwords="用户热词列表",                           │ │
│  │       initial_prompt="上下文提示"                        │ │
│  │   )                                                     │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、与飞书妙记的对比

| 能力 | 飞书妙记 | 我们的方案 (faster-whisper) |
|------|---------|---------------------------|
| 热词数量 | 3个(免费) / 200个(付费) | **无限制** ✅ |
| 热词分类 | ✅ 9种分类 | ✅ 可实现相同分类系统 |
| 中文支持 | ✅ | ✅ |
| 英日语支持 | ✅ | ✅ |
| 说话人识别 | ✅ (内置) | 需集成 pyannote-audio |
| 实时转录 | ✅ (付费) | 需流式处理架构 |
| 单词时间戳 | ✅ | ✅ `word_timestamps=True` |
| 离线运行 | ❌ | ✅ **优势** |
| 隐私保护 | 云端处理 | ✅ 本地处理 **优势** |

---

## 八、下一步实施计划

### 8.1 Phase 1: 录音 + 热词 (1周)

1. [ ] 实现 `AudioRecorderService` 完整功能
2. [ ] 创建热词管理 UI (添加/删除/分类)
3. [ ] 热词数据持久化到 IndexedDB
4. [ ] 搭建 Python 后端 faster-whisper 服务

### 8.2 Phase 2: 转录 + 同步 (1周)

1. [ ] 实现音频上传和转录接口
2. [ ] 返回带时间戳的转录结果
3. [ ] 实现播放器与转录文字同步

### 8.3 Phase 3: 增强功能 (可选)

1. [ ] 说话人识别 (pyannote-audio)
2. [ ] 智能摘要 (LLM)
3. [ ] AI 问答 (RAG)

---

## 九、参考资源

- **faster-whisper**: https://github.com/SYSTRAN/faster-whisper
- **Vosk**: https://alphacephei.com/vosk/
- **pyannote-audio**: https://github.com/pyannote/pyannote-audio
- **Web Audio API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
