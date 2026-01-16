/**
 * Meeting Transcription App
 * 会议转录应用主入口
 */

import { PageService, SegmentService, SpeakerDataService, HotwordService, AudioService, TodoService, db } from './services/Database.js';
import { SpeechRecognitionService } from './services/SpeechRecognition.js';
import { AudioRecorderService } from './services/AudioRecorder.js';
import { SpeakerDiarizerService } from './services/SpeakerDiarizer.js';
import { getWhisperAPI } from './services/WhisperAPI.js';
import { WebSocketService } from './services/WebSocketService.js';

import {
  formatDuration,
  formatDateTime,
  formatRelativeTime,
  formatDurationHuman,
  checkBrowserSupport,
  escapeHtml,
  truncate,
  downloadFile
} from './utils/helpers.js';

// App State
const state = {
  currentView: 'list',    // 'list' | 'recording' | 'detail'
  currentPageId: null,
  isRecording: false,
  recordingStartTime: null,
  timerInterval: null,
  pages: [],
  currentTranscript: '',
  interimTranscript: '',
  webSpeechSegments: [],  // Web Speech 片段
  streamingSegments: [],  // 后端流式片段
  streamingInterimTranscript: '',
  currentVolume: 0,
  isSilent: false,
  silenceWarningShown: false,
  silenceDuration: 0,
  whisperAvailable: false,  // 后端是否可用
  useWhisper: false,        // 是否使用 Whisper 转录
  geminiAvailable: false,   // Gemini AI 是否可用
  recognitionActive: false, // 语音识别是否正在工作
  lastRecognitionTime: 0,   // 上次收到识别结果的时间
  selectedDeviceId: null,   // 当前选中的麦克风ID
  audioDevices: [],         // 可用的音频设备列表
  pageSummary: null,        // 当前页面的 AI 总结
  summaryLoading: false,    // 总结生成中
  pageTodos: [],            // 当前页面的 TODO 列表
  todosLoading: false,      // TODO 加载中
  compareMode: false,       // 是否开启对比模式
  activeRecordingPageId: null, // 当前正在录音的页面ID
  streamingActive: false,   // 后端流式转录是否连接
  streamingRecent: [],      // 流式去重窗口
  streamingDuplicateWindowMs: 2500,
  streamingCommitTimer: null,
  streamingLastCommittedText: '',
  streamingLastConfidence: 0,
  isStoppingRecording: false,
  audioCacheQueue: [],
  audioCacheSaving: false,
  audioCachedChunks: 0,
  segmentSyncInterval: null,  // 定期同步 segments 到后端
  showApiKeyModal: false,   // 显示 API Key 配置模态框
  currentSource: null,      // 当前显示的转录版本 (null = 默认/web_speech)
  availableSources: []      // 可用的转录版本列表
};

// Services
// Services - initialized in init()
let speechService = null;
let audioRecorder = null;
let speakerDiarizer = null;
let streamingDiarizer = null;
let whisperAPI = null;
let recognitionWatchdog = null;
let webSocketService = null;

const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Initialize the application
 */
async function init() {
  console.log('Initializing Meeting Transcription App...');

  // Check browser support
  const support = checkBrowserSupport();

  if (!support.speechRecognition) {
    renderBrowserWarning(support);
    return;
  }

  // Initialize services
  speechService = new SpeechRecognitionService();
  audioRecorder = new AudioRecorderService();
  webSocketService = new WebSocketService();

  // Check if Whisper backend is available
  whisperAPI = getWhisperAPI();
  state.whisperAvailable = await whisperAPI.checkHealth();
  console.log(`Whisper backend: ${state.whisperAvailable ? '✅ Available' : '❌ Not available'}`);
  if (state.whisperAvailable) {
    state.useWhisper = true;
    state.compareMode = true;
    try {
      fetch(`${whisperAPI.baseUrl}/api/preload`, { method: 'POST' });
    } catch (error) {
      console.warn('Preload request failed:', error);
    }
    // Check Gemini availability from backend
    try {
      const geminiRes = await fetch(`${whisperAPI.baseUrl}/api/gemini/status`);
      const geminiStatus = await geminiRes.json();
      state.geminiAvailable = geminiStatus.available === true;
      console.log(`Gemini AI: ${state.geminiAvailable ? '✅ Available' : '❌ Not configured'}`);
    } catch (e) {
      console.warn('Gemini status check failed:', e);
    }
  }

  // Check for unfinished recordings
  await checkUnfinishedRecordings();

  // Load pages and render
  await loadPages();
  renderApp();

  console.log('App initialized successfully');
}

/**
 * Check for unfinished recordings (recovery)
 */
async function checkUnfinishedRecordings() {
  const recordingPages = await PageService.findRecording();

  if (recordingPages.length > 0) {
    const page = recordingPages[0];
    const confirmed = confirm(`发现未完成的录音 "${page.title}"，是否恢复？`);

    if (confirmed) {
      state.currentPageId = page.id;
      state.currentView = 'detail';
    } else {
      // Mark as completed
      await PageService.update(page.id, { status: 'completed' });
    }
  }
}

/**
 * Load all pages from database
 */
async function loadPages() {
  state.pages = await PageService.getAll();
}

/**
 * Render the application
 */
function renderApp() {
  const app = document.getElementById('app');

  app.innerHTML = `
    ${renderHeader()}
    <main class="main-content">
      ${renderRecordingBanner()}
      ${state.currentView === 'list' ? renderPageList() : ''}
      ${state.currentView === 'recording' ? renderRecordingView() : ''}
      ${state.currentView === 'detail' ? renderDetailView() : ''}
      ${state.currentView === 'hotwords' ? '<div id="hotwords-container"><div class="text-center"><p>加载中...</p></div></div>' : ''}
    </main>
  `;

  bindEvents();

  // Connect WebSocket if viewing list to be ready (optional)
  // webSocketService.connect();

  // Handle async hotwords view
  if (state.currentView === 'hotwords') {
    renderHotwordsViewAsync();
  }
}

/**
 * Render hotwords view asynchronously
 */
async function renderHotwordsViewAsync() {
  const container = document.getElementById('hotwords-container');
  if (container) {
    container.innerHTML = await renderHotwordsView();
  }
}

/**
 * Render header
 */
function renderHeader() {
  const whisperStatus = state.whisperAvailable
    ? (state.useWhisper ? '🟢 Whisper' : '🔵 Web Speech')
    : '⚪ Web Speech';

  return `
    <header class="header">
      <div class="header-content">
        <a href="#" class="logo" onclick="navigateTo('list'); return false;">
          <span class="logo-icon">🎙️</span>
          <span>Meeting Transcription</span>
        </a>
        <div class="header-actions">
          ${state.whisperAvailable ? `
            <button class="btn btn-sm ${state.useWhisper ? 'btn-primary' : 'btn-secondary'}" 
                    onclick="toggleWhisper()" title="切换识别引擎">
              ${state.useWhisper ? '🧠 Neural Link' : '🌐 Web Speech'}
            </button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" onclick="openHotwords()" title="热词管理">
            🔤 热词
          </button>
          ${state.currentView === 'list' ? `
            ${state.isRecording && state.activeRecordingPageId ? `
              <button class="btn btn-secondary" onclick="returnToRecording()">
                🎙️ 返回录音
              </button>
            ` : `
              <button class="btn btn-primary" onclick="startNewRecording()">
                <span>➕</span> 新建录音
              </button>
            `}
          ` : ''}
          ${state.currentView !== 'list' ? `
            <button class="btn btn-secondary" onclick="navigateTo('list')">
              <span>←</span> 返回列表
            </button>
          ` : ''}
        </div>
      </div>
    </header>
  `;
}

/**
 * Render recording banner (visible when recording in background)
 */
function renderRecordingBanner() {
  if (!state.isRecording || state.currentView === 'recording' || !state.activeRecordingPageId) {
    return '';
  }

  const elapsed = state.recordingStartTime
    ? Math.floor((Date.now() - state.recordingStartTime) / 1000)
    : 0;

  return `
    <div class="recording-banner">
      <div class="recording-banner-left">
        <span class="recording-banner-dot"></span>
        <span class="recording-banner-text">录音进行中</span>
        <span class="recording-banner-timer" id="recording-banner-timer">${formatDuration(elapsed)}</span>
      </div>
      <div class="recording-banner-actions">
        <button class="btn btn-sm btn-secondary" onclick="returnToRecording()">返回录音</button>
        <button class="btn btn-sm btn-primary" onclick="saveRecording()">停止并保存</button>
      </div>
    </div>
  `;
}

/**
 * Render page list view
 */
function renderPageList() {
  if (state.pages.length === 0) {
    return `
      <div class="page-list">
        <div class="page-list-header">
          <h1 class="page-list-title">我的录音</h1>
        </div>
        <div class="page-list-empty">
          <div class="page-list-empty-icon">🎤</div>
          <p>还没有任何录音</p>
          <p class="text-muted mt-sm">点击"新建录音"开始第一次转录</p>
          ${state.isRecording ? `
            <button class="btn btn-secondary mt-lg" onclick="returnToRecording()">
              返回录音
            </button>
          ` : `
            <button class="btn btn-primary mt-lg" onclick="startNewRecording()">
              开始录音
            </button>
          `}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-list">
      <div class="page-list-header">
        <h1 class="page-list-title">我的录音 (${state.pages.length})</h1>
      </div>
      <div class="page-list-grid">
        ${state.pages.map(page => renderPageCard(page)).join('')}
      </div>
    </div>
  `;
}

/**
 * Render a single page card
 */
function renderPageCard(page) {
  const statusBadge = page.status === 'recording' || page.status === 'paused'
    ? '<span class="badge badge-error">录音中</span>'
    : page.analyzed
      ? '<span class="badge badge-success">已分析</span>'
      : '';

  // Use AI-generated title if available, otherwise fallback to default title
  const displayTitle = page.autoTitle || page.title;

  // Show word count and todo count if analyzed
  const statsHtml = page.analyzed ? `
    <span class="card-meta-item">
      <span>📝</span>
      ${page.wordCount || 0} 字
    </span>
    <span class="card-meta-item">
      <span>✅</span>
      TODO ${page.todoCount || 0}
    </span>
  ` : '';

  return `
    <div class="card" onclick="openPage('${page.id}')" style="cursor: pointer;">
      <div class="card-header">
        <h3 class="card-title">${escapeHtml(displayTitle)}</h3>
        ${statusBadge}
      </div>
      <div class="card-meta">
        <span class="card-meta-item">
          <span>📅</span>
          ${formatRelativeTime(page.createdAt)}
        </span>
        <span class="card-meta-item">
          <span>⏱️</span>
          ${formatDurationHuman(page.duration)}
        </span>
        ${statsHtml}
      </div>
      <div class="card-actions mt-md flex gap-sm">
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); deletePage('${page.id}')">
          🗑️ 删除
        </button>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); exportPage('${page.id}')">
          📥 导出
        </button>
      </div>
    </div>
  `;
}

/**
 * Build transcript HTML from segments and interim text
 */
function buildTranscriptHtml(segments, interimTranscript) {
  let html = '<div class="transcript-segments">';
  let lastSpeaker = null;

  segments.forEach((seg) => {
    const isNewSpeaker = seg.speaker !== lastSpeaker;
    if (isNewSpeaker) {
      if (lastSpeaker !== null) {
        html += '</div></div>'; // Close speaker-text AND speaker-block
      }
      html += `
              <div class="speaker-block">
                <div class="speaker-label" style="color: ${seg.speakerColor}">
                  <span class="speaker-dot" style="background-color: ${seg.speakerColor}"></span>
                  ${escapeHtml(seg.speakerLabel)}
                </div>
                <div class="speaker-text">
            `;
    }

    const isLowConfidence = typeof seg.confidence === 'number'
      && seg.confidence > 0
      && seg.confidence < LOW_CONFIDENCE_THRESHOLD;
    const confidenceTitle = isLowConfidence
      ? ` title="置信度 ${(seg.confidence * 100).toFixed(0)}%"`
      : '';

    html += `<span class="segment-text${isLowConfidence ? ' low-confidence' : ''}"${confidenceTitle}>${escapeHtml(seg.text)} </span>`;
    lastSpeaker = seg.speaker;
  });

  if (segments.length > 0) {
    html += '</div></div>'; // Close speaker-text and speaker-block
  }

  if (interimTranscript) {
    html += `<div class="interim-text">${escapeHtml(interimTranscript)}</div>`;
  }

  html += '</div>';
  return html;
}

function renderTranscriptContent(segments, interimTranscript, placeholderTitle, placeholderHint) {
  if (segments.length === 0 && !interimTranscript) {
    return `
        <div class="transcript-placeholder">
          <p>${placeholderTitle}</p>
          <p class="text-muted mt-sm">${placeholderHint}</p>
        </div>
      `;
  }

  return buildTranscriptHtml(segments, interimTranscript);
}

function isStreamingPreferred() {
  return state.useWhisper
    && state.whisperAvailable
    && (state.streamingActive || state.streamingSegments.length > 0);
}

/**
 * Render recording view
 */
function renderRecordingView() {
  const statusClass = state.isRecording ? 'active' : '';
  const statusText = state.isRecording ? '录音中' : '准备录音';

  // Volume indicator bars
  const volumeBars = renderVolumeBars(state.currentVolume);

  // Generate device options
  const deviceOptions = state.audioDevices.map(device =>
    `<option value="${device.deviceId}" ${device.deviceId === state.selectedDeviceId ? 'selected' : ''}>
      ${device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
    </option>`
  ).join('');

  const deviceSelectControl = state.audioDevices.length > 0 ? `
    <div class="device-selector-inline">
      <label for="audio-device-select" class="text-sm text-muted mr-sm">🎤 选择麦克风:</label>
      <select id="audio-device-select" class="select select-sm" onchange="changeAudioDevice(this.value)">
        ${deviceOptions}
      </select>
    </div>
  ` : '';

  const compareToggle = state.useWhisper && state.whisperAvailable ? `
    <div class="compare-toggle mb-sm text-center">
      <button class="btn btn-sm ${state.compareMode ? 'btn-primary' : 'btn-secondary'}"
              onclick="toggleCompareMode()">
        ${state.compareMode ? '对比模式：开' : '对比模式：关'}
      </button>
    </div>
  ` : '';

  const placeholderTitle = state.isRecording ? '🎤 正在聆听...' : '🎤 点击下方按钮开始录音';
  const placeholderHint = '转录的文字将在这里实时显示';

  const showCompare = state.compareMode && state.useWhisper && state.whisperAvailable;
  const useStreaming = isStreamingPreferred();
  const transcriptHtml = showCompare
    ? `
      <div class="transcript-compare">
        <div class="transcript-column">
          <div class="transcript-column-title">🌐 Web Speech</div>
          <div class="transcript-container" id="transcript-container-web">
            ${renderTranscriptContent(state.webSpeechSegments, state.interimTranscript, placeholderTitle, placeholderHint)}
          </div>
        </div>
        <div class="transcript-column">
          <div class="transcript-column-title">⚡ Streaming ASR</div>
          <div class="transcript-container" id="transcript-container-streaming">
            ${renderTranscriptContent(state.streamingSegments, state.streamingInterimTranscript, placeholderTitle, placeholderHint)}
          </div>
        </div>
      </div>
    `
    : `
      <div class="transcript-container" id="transcript-container">
        ${renderTranscriptContent(
      useStreaming ? state.streamingSegments : state.webSpeechSegments,
      useStreaming ? state.streamingInterimTranscript : state.interimTranscript,
      placeholderTitle,
      placeholderHint
    )}
      </div>
    `;

  return `
    <div class="recording-view">
      <div class="recording-header">
        <div class="recording-timer" id="timer">00:00</div>
        <div class="recording-status ${statusClass}">
          <span class="recording-status-dot"></span>
          <span>${statusText}</span>
        </div>
      </div>

      ${!state.isRecording ? `
        <div class="recording-setup-row">
          ${deviceSelectControl}
          <button class="btn btn-primary btn-lg" onclick="toggleRecording()">
            开始录音
          </button>
        </div>
      ` : ''}
      ${compareToggle}

      ${state.isRecording ? `
        <canvas id="audio-visualizer"></canvas>
        <div class="recognition-diagnostics" id="recognition-diagnostics">
          <div class="diag-row">
            <span class="diag-label">ENGINE:</span>
            <span class="diag-value">${state.useWhisper ? '🧠 NEURAL_LINK_V2' : '🌐 WEB_NET_API'}</span>
          </div>
          <div class="diag-row">
            <span class="diag-label">STATUS:</span>
            <span class="diag-value" id="recognition-status">
              ${state.recognitionActive ? '🟢 LISTENING...' : '🟡 STANDBY'}
            </span>
          </div>
          ${state.useWhisper ? `
          <div class="diag-row">
            <span class="diag-label">STREAM:</span>
            <span class="diag-value" id="streaming-status">${state.streamingActive ? '🟢 LIVE' : '🟡 CONNECTING'}</span>
          </div>
          <div class="diag-row diag-tip">
            >> SYSTEM: Neural streaming active; final pass refines post-recording.
          </div>
          ` : ''}
        </div>
      ` : ''}

      ${transcriptHtml}

      ${state.isRecording ? `
        <div class="recording-controls">
          <button class="btn btn-primary" onclick="saveRecording()">
            结束并保存
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render volume bars
 */
function renderVolumeBars(volume) {
  const totalBars = 20;
  const activeBars = Math.round((volume / 100) * totalBars);
  let bars = '';

  for (let i = 0; i < totalBars; i++) {
    const isActive = i < activeBars;
    const level = i < totalBars * 0.6 ? 'low' : i < totalBars * 0.85 ? 'medium' : 'high';
    bars += `<div class="volume-bar ${isActive ? 'active' : ''} ${level}"></div>`;
  }

  return bars;
}

/**
 * Get volume label text
 */
function getVolumeLabel(volume, isSilent) {
  if (isSilent) return '静音';
  if (volume < 20) return '音量较低';
  if (volume < 50) return '音量正常';
  if (volume < 80) return '音量良好';
  return '音量较高';
}

/**
 * Render detail view
 */
function renderDetailView() {
  const page = state.pages.find(p => p.id === state.currentPageId);

  if (!page) {
    return '<p>页面未找到</p>';
  }

  return `
    <div class="page-detail">
      <div class="page-detail-header">
        <div class="page-detail-title">
          <input type="text" value="${escapeHtml(page.title)}" 
                 onchange="updatePageTitle('${page.id}', this.value)"
                 placeholder="输入标题...">
        </div>
        <div class="page-detail-meta">
          <span>📅 ${formatDateTime(page.createdAt)}</span>
          <span>⏱️ ${formatDurationHuman(page.duration)}</span>
        </div>
      </div>
      
      <div class="audio-player-section" id="audio-player-section">
        <div class="audio-controls">
          <audio id="audio-player" controls style="display: none;"></audio>
          <div id="audio-loading">🔄 加载音频中...</div>
        </div>
        <div class="audio-actions mt-sm">
          <button class="btn btn-sm btn-secondary" onclick="downloadAudio('${page.id}')" id="download-audio-btn" disabled>
            💾 下载音频
          </button>
        </div>
      </div>
      
      <div class="page-detail-content" id="page-content">
        <div class="transcript-placeholder text-center">
          <p>加载中...</p>
        </div>
      </div>
      
      <!-- AI 总结面板 -->
      <div class="summary-panel" id="summary-panel">
        <div class="summary-header">
          <h3>🤖 AI 总结</h3>
          <div class="summary-actions">
            ${state.geminiAvailable ? `
              <button class="btn btn-sm btn-primary" onclick="generatePageSummary('${page.id}')" ${state.summaryLoading ? 'disabled' : ''}>
                ${state.summaryLoading ? '⏳ 生成中...' : '✨ 生成总结'}
              </button>
            ` : `
              <span class="text-muted text-sm">⚠️ 后端 Gemini 未配置</span>
            `}
          </div>
        </div>
        <div class="summary-content" id="summary-content">
          ${state.pageSummary
      ? `<div class="summary-text">${state.pageSummary.replace(/\n/g, '<br>')}</div>`
      : '<p class="text-muted">点击「生成总结」按钮，AI 将自动分析会议内容并生成摘要和待办事项。</p>'
    }
        </div>
      </div>

      ${renderTodoPanel()}
      
      <div class="flex gap-md mt-lg">
        <button class="btn btn-primary" onclick="exportPage('${page.id}')">
          📥 导出为文本
        </button>
        <button class="btn btn-danger" onclick="deletePage('${page.id}')">
          🗑️ 删除录音
        </button>
      </div>
    </div>
  `;
}

/**
 * Render todo panel for current page
 */
function renderTodoPanel() {
  return `
    <div class="todo-panel" id="todo-panel">
      ${renderTodoPanelContent()}
    </div>
  `;
}

/**
 * Render todo panel content (for async updates)
 */
function renderTodoPanelContent() {
  const total = state.pageTodos.length;
  const completed = state.pageTodos.filter(t => t.completed).length;

  let bodyHtml = '';

  if (state.todosLoading) {
    bodyHtml = '<p class="text-muted">加载中...</p>';
  } else if (total === 0) {
    bodyHtml = '<p class="text-muted">暂无待办事项</p>';
  } else {
    bodyHtml = `
      <div class="todo-list">
        ${state.pageTodos.map(todo => `
          <div class="todo-item ${todo.completed ? 'completed' : ''}">
            <label class="todo-check">
              <input type="checkbox" ${todo.completed ? 'checked' : ''} onchange="toggleTodo('${todo.id}')">
              <span class="todo-text">${escapeHtml(todo.content)}</span>
            </label>
            <div class="todo-meta">
              ${todo.assignee ? `<span class="todo-chip">👤 ${escapeHtml(todo.assignee)}</span>` : ''}
              ${todo.deadline ? `<span class="todo-chip">📅 ${escapeHtml(todo.deadline)}</span>` : ''}
              ${todo.priority ? `<span class="todo-chip">⚡ ${escapeHtml(todo.priority)}</span>` : ''}
              ${todo.category ? `<span class="todo-chip">🏷️ ${escapeHtml(todo.category)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="todo-header">
      <h3>✅ 待办事项</h3>
      <div class="todo-count">${completed}/${total} 已完成</div>
    </div>
    <div class="todo-content">
      ${bodyHtml}
    </div>
  `;
}

/**
 * Render browser warning
 */
function renderBrowserWarning(support) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="main-content">
      <div class="browser-warning">
        <h2 class="browser-warning-title">⚠️ 浏览器不支持</h2>
        <p class="browser-warning-text">
          您当前使用的是 ${support.browserName} 浏览器，但语音识别功能仅在 
          <strong>Chrome</strong> 或 <strong>Edge</strong> 浏览器中可用。
        </p>
        <p class="browser-warning-text mt-md">
          请使用 Chrome 或 Edge 浏览器打开此页面。
        </p>
      </div>
    </div>
  `;
}

/**
 * Bind global event handlers
 */
function bindEvents() {
  // Make functions available globally for onclick handlers
  window.navigateTo = navigateTo;
  window.startNewRecording = startNewRecording;
  window.toggleRecording = toggleRecording;
  window.saveRecording = saveRecording;
  window.openPage = openPage;
  window.deletePage = deletePage;
  window.exportPage = exportPage;
  window.updatePageTitle = updatePageTitle;
  window.toggleWhisper = toggleWhisper;
  window.openHotwords = openHotwords;
  window.addHotword = addHotword;
  window.deleteHotword = deleteHotword;
  window.closeHotwords = closeHotwords;
  window.changeAudioDevice = changeAudioDevice;
  // Gemini functions
  window.generatePageSummary = generatePageSummary;
  window.switchTranscriptSource = switchTranscriptSource;
  window.toggleTodo = toggleTodo;
  window.toggleCompareMode = toggleCompareMode;
  window.returnToRecording = returnToRecording;
}

/**
 * Change audio input device
 */
function changeAudioDevice(deviceId) {
  state.selectedDeviceId = deviceId;
  console.log('Selected audio device:', deviceId);
}

/**
 * Generate AI summary for a page
 */
async function generatePageSummary(pageId) {
  if (state.summaryLoading) return;

  if (!state.geminiAvailable) {
    state.pageSummary = '⚠️ 后端 Gemini 未配置。请在 .env 文件中设置 GEMINI_API_KEY。';
    renderApp();
    return;
  }

  state.summaryLoading = true;
  state.pageSummary = null;
  renderApp();

  try {
    // Get all segments for this page
    const segments = await SegmentService.getFinalByPageId(pageId);

    if (segments.length === 0) {
      state.pageSummary = '⚠️ 无转录内容，无法生成总结。';
      state.summaryLoading = false;
      renderApp();
      return;
    }

    // Build transcript with speaker labels
    let transcript = '';
    let lastSpeaker = null;

    segments.forEach(seg => {
      const speaker = seg.speakerLabel || '说话人';
      if (speaker !== lastSpeaker) {
        transcript += `\n【${speaker}】\n`;
        lastSpeaker = speaker;
      }
      transcript += seg.text + ' ';
    });

    // Call backend analyze API
    const analyzeRes = await fetch(`${getAPIBase()}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcript.trim() })
    });

    if (!analyzeRes.ok) {
      throw new Error(`API error: ${analyzeRes.status}`);
    }

    const result = await analyzeRes.json();

    if (result.success) {
      // Format summary display
      let summaryText = `## ${result.title}\n\n${result.summary}\n\n`;
      if (result.key_points && result.key_points.length > 0) {
        summaryText += `### 关键要点\n${result.key_points.map(p => `- ${p}`).join('\n')}\n\n`;
      }
      if (result.decisions && result.decisions.length > 0) {
        summaryText += `### 决策\n${result.decisions.map(d => `- ${d}`).join('\n')}`;
      }
      state.pageSummary = summaryText;

      // Save todos
      if (result.todos && result.todos.length > 0) {
        await TodoService.addBatch(pageId, result.todos);
        state.pageTodos = await TodoService.getByPageId(pageId);
      }

      // Update page
      await PageService.update(pageId, {
        autoTitle: result.title,
        summary: result.summary,
        keyPoints: result.key_points || [],
        decisions: result.decisions || [],
        todoCount: result.todos?.length || 0,
        analyzed: true
      });
    } else {
      state.pageSummary = '❌ 分析失败';
    }

    state.summaryLoading = false;
    renderApp();
  } catch (error) {
    console.error('Summary generation failed:', error);
    state.pageSummary = `❌ 生成失败: ${error.message}`;
    state.summaryLoading = false;
    renderApp();
  }
}

/**
 * Load available audio devices
 */
async function loadAudioDevices() {
  try {
    // Request permission first to get labels
    // We do a quick stream init then stop it just to get permissions if needed
    // But usually we load this when entering recording view where user expects it

    const devices = await AudioRecorderService.getAudioInputDevices();
    state.audioDevices = devices;

    // Set default if not set
    if (!state.selectedDeviceId && devices.length > 0) {
      // Prefer 'default' or first one
      const defaultDevice = devices.find(d => d.deviceId === 'default');
      state.selectedDeviceId = defaultDevice ? defaultDevice.deviceId : devices[0].deviceId;
    }
  } catch (error) {
    console.error('Failed to load audio devices:', error);
  }
}

/**
 * Toggle Whisper ASR engine
 */
function toggleWhisper() {
  if (!state.whisperAvailable) return;
  state.useWhisper = !state.useWhisper;
  if (!state.useWhisper) {
    state.compareMode = false;
    state.streamingSegments = [];
    state.streamingInterimTranscript = '';
  }
  console.log(`ASR engine: ${state.useWhisper ? 'Whisper' : 'Web Speech'}`);
  renderApp();
}

/**
 * Toggle compare mode (Web Speech vs Streaming)
 */
function toggleCompareMode() {
  if (!state.useWhisper || !state.whisperAvailable) return;
  state.compareMode = !state.compareMode;
  renderApp();
}

/**
 * Open hotwords management modal
 */
async function openHotwords() {
  state.currentView = 'hotwords';
  renderApp();
}

/**
 * Close hotwords modal
 */
function closeHotwords() {
  state.currentView = 'list';
  renderApp();
}

/**
 * Render hotwords management view
 */
async function renderHotwordsView() {
  const hotwords = await HotwordService.getAll();
  const categories = HotwordService.CATEGORIES;

  const categoryOptions = Object.entries(categories)
    .map(([key, label]) => `<option value="${key}">${label}</option>`)
    .join('');

  const hotwordItems = hotwords.length === 0
    ? '<p class="text-muted text-center">暂无热词，添加热词可提升识别准确度</p>'
    : hotwords.map(hw => `
        <div class="hotword-item">
          <span class="hotword-word">${escapeHtml(hw.word)}</span>
          <span class="hotword-category badge">${categories[hw.category] || hw.category}</span>
          <button class="btn btn-sm btn-danger" onclick="deleteHotword('${hw.id}')">删除</button>
        </div>
      `).join('');

  return `
    <div class="hotwords-view">
      <div class="hotwords-header">
        <h1>🔤 热词管理</h1>
        <p class="text-muted">添加自定义热词（人名、技术术语等）提升识别准确度</p>
      </div>
      
      <div class="hotword-form">
        <input type="text" id="hotword-input" class="input" placeholder="输入热词..." />
        <select id="hotword-category" class="select">
          ${categoryOptions}
        </select>
        <button class="btn btn-primary" onclick="addHotword()">添加</button>
      </div>
      
      <div class="hotword-list">
        ${hotwordItems}
      </div>
      
      <div class="mt-lg">
        <button class="btn btn-secondary" onclick="closeHotwords()">
          <span>←</span> 返回列表
        </button>
      </div>
    </div>
  `;
}

/**
 * Add a new hotword
 */
async function addHotword() {
  const wordInput = document.getElementById('hotword-input');
  const categorySelect = document.getElementById('hotword-category');

  const word = wordInput?.value?.trim();
  const category = categorySelect?.value || 'other';

  if (!word) {
    alert('请输入热词');
    return;
  }

  await HotwordService.add(word, category);
  wordInput.value = '';
  renderApp();
}

/**
 * Delete a hotword
 */
async function deleteHotword(id) {
  await HotwordService.delete(id);
  renderApp();
}

/**
 * Navigate to a view
 */
function navigateTo(view) {
  state.currentView = view;
  if (view === 'recording') {
    state.currentPageId = state.activeRecordingPageId || state.currentPageId;
  } else {
    state.currentPageId = null;
  }
  renderApp();
}

/**
 * Return to active recording view
 */
function returnToRecording() {
  if (!state.activeRecordingPageId) return;
  state.currentView = 'recording';
  state.currentPageId = state.activeRecordingPageId;
  renderApp();
}

/**
 * Start a new recording session
 */
async function startNewRecording() {
  if (state.isRecording) {
    returnToRecording();
    return;
  }

  // Create new page
  const page = await PageService.create();
  state.currentPageId = page.id;
  state.activeRecordingPageId = page.id;
  state.currentView = 'recording';
  state.currentTranscript = '';
  state.interimTranscript = '';
  state.streamingInterimTranscript = '';
  state.webSpeechSegments = [];
  state.streamingSegments = [];

  // Initialize speaker diarizer with longer threshold to avoid false speaker changes
  speakerDiarizer = new SpeakerDiarizerService({ silenceThreshold: 5000 });
  streamingDiarizer = new SpeakerDiarizerService({ silenceThreshold: 5000 });

  await loadAudioDevices();
  await loadPages();
  renderApp();

  // Auto-start recording for new sessions
  await startRecording();
}

/**
 * Toggle recording on/off
 */
async function toggleRecording() {
  if (state.isRecording) {
    // Stop recording - must await to ensure audio blob is saved
    await stopRecording();
  } else {
    // Start recording
    await startRecording();
  }

  renderApp();
}

/**
 * Start recording
 */
async function startRecording() {
  if (state.isStoppingRecording) {
    return;
  }
  const recordingPageId = state.activeRecordingPageId || state.currentPageId;

  // Initialize audio recorder
  const audioReady = await audioRecorder.init(state.selectedDeviceId);
  if (!audioReady) {
    alert('无法访问麦克风，请检查权限设置');
    return;
  }

  if (!state.activeRecordingPageId && recordingPageId) {
    state.activeRecordingPageId = recordingPageId;
  }

  state.streamingRecent = [];
  state.streamingActive = false;
  state.streamingInterimTranscript = '';
  clearStreamingCommitTimer();
  state.streamingLastCommittedText = '';
  state.streamingLastConfidence = 0;
  state.interimTranscript = '';
  resetAudioCacheState();

  // Setup speech recognition callbacks
  speechService.onResult = (transcript, isFinal, confidence) => {
    // Update recognition status
    state.recognitionActive = true;
    state.lastRecognitionTime = Date.now();
    updateRecognitionStatus();

    if (isFinal) {
      const baseTime = state.recordingStartTime || Date.now();
      const timestamp = Date.now() - baseTime;

      // Process through speaker diarizer
      const segmentWithSpeaker = speakerDiarizer.processSegment({
        text: transcript,
        timestamp: timestamp,
        confidence: confidence
      });

      // Add to state segments for display
      state.webSpeechSegments.push(segmentWithSpeaker);

      // Append to final transcript
      state.currentTranscript += transcript + ' ';
      state.interimTranscript = '';

      // Save segment to database with speaker info
      SegmentService.add(recordingPageId, {
        text: transcript,
        timestamp: timestamp,
        confidence: confidence,
        isFinal: true,
        speaker: segmentWithSpeaker.speaker,
        speakerLabel: segmentWithSpeaker.speakerLabel,
        speakerColor: segmentWithSpeaker.speakerColor
      });
    } else {
      state.interimTranscript = transcript;
    }

    updateTranscriptDisplay();
  };

  speechService.onError = (error) => {
    console.error('Speech recognition error:', error);
    state.recognitionActive = false;
    updateRecognitionStatus(error);
  };

  // Start Audio Recorder (emit chunks every 500ms for streaming)
  const success = await audioRecorder.start(500);

  if (!success) {
    state.isRecording = false;
    alert('无法启动录音，请检查麦克风权限');
    return;
  }
  // Setup volume monitoring
  audioRecorder.onVolumeChange = (volume, isSilent) => {
    state.currentVolume = volume;
    // ... (rest of volume logic) ...
  };
  audioRecorder.startVolumeMonitoring(100, 5);

  // === WebSocket Streaming Logic ===
  if (state.useWhisper && state.whisperAvailable) {
    webSocketService.onOpen = () => {
      state.streamingActive = true;
      updateStreamingStatus();
    };

    webSocketService.onClose = () => {
      state.streamingActive = false;
      updateStreamingStatus();
      if (!state.isRecording || state.isStoppingRecording) {
        return;
      }
      if (!speechService.isRunning && !state.compareMode) {
        startSpeechRecognition();
      }
    };

    webSocketService.onResult = (payload) => {
      handleStreamingResult(payload);
    };

    webSocketService.onError = (error) => {
      console.error('Streaming error:', error);
      state.streamingActive = false;
      updateStreamingStatus();
      if (!state.isRecording || state.isStoppingRecording) {
        return;
      }
      if (!speechService.isRunning && !state.compareMode) {
        startSpeechRecognition();
      }
    };

    webSocketService.connect('zh');
  }

  // Hook data stream (cache always; stream when enabled)
  audioRecorder.onDataAvailable = (chunk) => {
    enqueueAudioChunk(recordingPageId, chunk);
    if (state.useWhisper && state.whisperAvailable && !state.isStoppingRecording) {
      webSocketService.sendAudio(chunk);
    }
  };

  // === Timer & Visualizer ===
  state.isRecording = true;
  state.recordingStartTime = Date.now();
  state.currentVolume = 0;
  state.silenceDuration = 0;
  state.silenceWarningShown = false;

  startTimer();
  requestAnimationFrame(drawVisualizer);

  // Start speech recognition (Web Speech or compare mode)
  if (!state.useWhisper || state.compareMode) {
    startSpeechRecognition();
  }

  renderApp();
  if (recordingPageId) {
    await PageService.update(recordingPageId, { status: 'recording' });
    startSegmentSync(recordingPageId); // Start periodic sync
  }
}

/**
 * Stop recording
 */
async function stopRecording() {
  if (state.isStoppingRecording || !state.isRecording) {
    return;
  }

  state.isStoppingRecording = true;
  const recordingPageId = state.activeRecordingPageId || state.currentPageId;

  try {
    // Stop services
    speechService.stop();
    audioRecorder.stopVolumeMonitoring();
    stopRecognitionWatchdog();
    stopSegmentSync(); // Stop periodic sync
    state.recognitionActive = false;
    updateRecognitionStatus();

    if (webSocketService) {
      webSocketService.onOpen = null;
      webSocketService.onClose = null;
      webSocketService.onError = null;
      webSocketService.onResult = null;
      webSocketService.disconnect(); // Disconnect WS
    }

    state.streamingActive = false;
    updateStreamingStatus();
    flushStreamingCommit();
    state.interimTranscript = '';
    state.streamingInterimTranscript = '';

    // Get audio blob before stopping recorder
    const audioResult = await audioRecorder.stop();
    audioRecorder.onDataAvailable = null;
    await flushAudioCacheQueue();

    // Stop timer
    stopTimer();

    // Update state
    state.isRecording = false;
    state.activeRecordingPageId = null;

    // Calculate duration
    const duration = Math.floor((Date.now() - state.recordingStartTime) / 1000);

    // Save speaker diarization state
    if (speakerDiarizer && recordingPageId) {
      await SpeakerDataService.save(recordingPageId, speakerDiarizer.exportData());
    }

    // If backend ASR is available and enabled, also transcribe with backend for comparison
    if (state.whisperAvailable && state.useWhisper && audioResult?.blob) {
      console.log('Sending audio to backend ASR for additional transcription...');
      try {
        const result = await whisperAPI.transcribe(audioResult.blob, {
          language: 'zh',
          useSavedHotwords: true
        });

        if (result.success && result.segments?.length > 0) {
          // Get backend engine name from result or default
          const backendSource = result.engine || 'backend';

          // Delete any existing backend results (in case of re-transcription)
          if (recordingPageId) {
            await SegmentService.deleteBySource(recordingPageId, backendSource);
          }

          // Add backend results alongside WebSpeech (not replacing)
          if (recordingPageId) {
            await SegmentService.addFromWhisper(recordingPageId, result.segments, backendSource);
          }

          const webSpeechSegs = recordingPageId
            ? await SegmentService.getFinalByPageId(recordingPageId, 'web_speech')
            : [];
          const backendSegs = result.segments;
          console.log(`Multi-version saved: WebSpeech=${webSpeechSegs.length} segs, ${backendSource}=${backendSegs.length} segs`);
        }
      } catch (error) {
        console.error('Backend transcription failed:', error);
      }
    }

    // Update page
    if (recordingPageId) {
      await PageService.update(recordingPageId, {
        status: 'completed',
        duration: duration
      });
    }

    // Save audio blob for playback/download (skip if cached chunks exist)
    const hasCachedAudio = state.audioCachedChunks > 0;
    console.log('Audio result from recorder:', audioResult);
    if (hasCachedAudio) {
      console.log(`Audio cached in chunks: ${state.audioCachedChunks}`);
    } else if (audioResult?.blob && recordingPageId) {
      await AudioService.save(recordingPageId, audioResult.blob, audioResult.mimeType || 'audio/webm');
      console.log(`Audio saved: ${(audioResult.blob.size / 1024).toFixed(1)} KB`);
    } else {
      console.warn('No audio blob available to save!');
    }

    // Sync segments to backend for cross-device access
    if (recordingPageId) {
      await SegmentService.syncToBackend(recordingPageId);
    }

    // Auto-analyze with Gemini AI (if available)
    if (recordingPageId) {
      autoAnalyzeRecording(recordingPageId);
    }
  } finally {
    state.isStoppingRecording = false;
  }
}

/**
 * Auto-analyze recording with Gemini AI
 */
async function autoAnalyzeRecording(pageId) {
  try {
    // Check if Gemini is available
    const statusRes = await fetch(`${getAPIBase()}/api/gemini/status`);
    const status = await statusRes.json();

    if (!status.available) {
      console.log('Gemini AI not configured, skipping auto-analysis');
      return;
    }

    // Get transcript text
    const segments = await SegmentService.getFinalByPageId(pageId);
    if (segments.length === 0) {
      console.log('No transcript to analyze');
      return;
    }

    // Build transcript text
    let transcript = '';
    let lastSpeaker = null;
    segments.forEach(seg => {
      const speaker = seg.speakerLabel || '说话人';
      if (speaker !== lastSpeaker) {
        transcript += `\n【${speaker}】\n`;
        lastSpeaker = speaker;
      }
      transcript += seg.text + ' ';
    });

    const wordCount = transcript.replace(/\s/g, '').length;

    console.log('Auto-analyzing with Gemini AI...');

    // Call analyze API
    const analyzeRes = await fetch(`${getAPIBase()}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcript.trim() })
    });

    if (!analyzeRes.ok) {
      console.error('Analysis failed:', analyzeRes.status);
      return;
    }

    const result = await analyzeRes.json();

    if (result.success) {
      // Save todos
      if (result.todos && result.todos.length > 0) {
        await TodoService.addBatch(pageId, result.todos);
      }

      // Update page with analysis results
      await PageService.update(pageId, {
        autoTitle: result.title,
        summary: result.summary,
        keyPoints: result.key_points || [],
        decisions: result.decisions || [],
        wordCount: wordCount,
        todoCount: result.todos?.length || 0,
        analyzed: true
      });

      console.log(`✅ AI Analysis complete: "${result.title}", ${result.todos?.length || 0} TODOs`);

      // Reload pages to update list
      await loadPages();
      renderApp();
    }
  } catch (error) {
    console.error('Auto-analysis error:', error);
  }
}

/**
 * Get API base URL
 */
function getAPIBase() {
  const port = window.location.port;
  if (port === '3000') {
    return `${window.location.protocol}//` + window.location.hostname + ':8000';
  }
  return window.location.origin;
}

/**
 * Save current recording
 */
async function saveRecording() {
  if (state.isRecording) {
    await stopRecording();
  }

  await loadPages();
  navigateTo('list');
}

/**
 * Update recognition status in diagnostics panel
 */
function updateRecognitionStatus(errorMessage = null) {
  const statusEl = document.getElementById('recognition-status');
  if (!statusEl) return;

  if (errorMessage) {
    statusEl.innerHTML = `<span style="color: var(--accent-warning)">⚠️ ${errorMessage}</span>`;
  } else if (state.recognitionActive) {
    statusEl.innerHTML = '✅ 正在识别';
  } else {
    statusEl.innerHTML = '⏸️ 等待语音...';
  }
}

/**
 * Update streaming status in diagnostics panel
 */
function updateStreamingStatus() {
  const statusEl = document.getElementById('streaming-status');
  if (!statusEl) return;
  statusEl.textContent = state.streamingActive ? '🟢 LIVE' : '🟡 CONNECTING';
}

/**
 * Handle streaming ASR results
 */
function handleStreamingResult(payload) {
  if (!payload || !payload.text) return;

  const text = normalizeStreamingText(payload.text);
  if (!text) return;

  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0;
  if (shouldIgnoreStreamingText(text, confidence)) {
    return;
  }

  if (isStreamingDuplicate(text)) {
    return;
  }

  state.streamingLastConfidence = confidence;
  state.streamingInterimTranscript = text;
  updateTranscriptDisplay();
  scheduleStreamingCommit(text, confidence);
}

function normalizeStreamingText(text) {
  if (!text) return '';
  let cleaned = text.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^([。.\u2026,，!?！？;；:：、\-\—]+\s*)+/g, '');
  cleaned = cleaned.replace(/([。.!?！？，,])(?:\s*\1)+/g, '$1');
  cleaned = cleaned.replace(/([。.!?！？]){2,}/g, '$1');
  cleaned = cleaned.replace(/\s+([。.!?！？])/g, '$1');
  return cleaned.trim();
}

function shouldIgnoreStreamingText(text, confidence) {
  const compact = text.replace(/\s+/g, '');
  // Ignore single punctuation or punctuation-only bursts during silence
  const punctuationOnly = /^[\.\,\!\?\:\;\-\—…，。！？；：、]+$/.test(compact);
  if (punctuationOnly && (compact.length <= 2 || confidence < 0.45)) {
    return true;
  }
  return false;
}

function clearStreamingCommitTimer() {
  if (state.streamingCommitTimer) {
    clearTimeout(state.streamingCommitTimer);
    state.streamingCommitTimer = null;
  }
}

function scheduleStreamingCommit(text, confidence) {
  clearStreamingCommitTimer();
  state.streamingCommitTimer = setTimeout(() => {
    commitStreamingText(text, confidence);
  }, 1200);
}

function commitStreamingText(text, confidence) {
  const trimmed = text.trim();
  if (!trimmed) return;

  let commitText = trimmed;
  if (state.streamingLastCommittedText && trimmed.startsWith(state.streamingLastCommittedText)) {
    commitText = trimmed.slice(state.streamingLastCommittedText.length).trim();
  }
  if (!commitText) {
    state.streamingLastCommittedText = trimmed;
    return;
  }

  const baseTime = state.recordingStartTime || Date.now();
  const timestamp = Date.now() - baseTime;
  const diarizer = streamingDiarizer || speakerDiarizer;
  const segmentWithSpeaker = diarizer.processSegment({
    text: commitText,
    timestamp: timestamp,
    confidence: confidence
  });

  state.streamingSegments.push(segmentWithSpeaker);
  state.streamingLastCommittedText = trimmed;
  state.streamingInterimTranscript = '';

  const recordingPageId = state.activeRecordingPageId || state.currentPageId;
  if (recordingPageId) {
    SegmentService.add(recordingPageId, {
      text: commitText,
      timestamp: timestamp,
      confidence: confidence,
      isFinal: true,
      speaker: segmentWithSpeaker.speaker,
      speakerLabel: segmentWithSpeaker.speakerLabel,
      speakerColor: segmentWithSpeaker.speakerColor,
      source: 'streaming'
    }).catch((error) => console.error('Failed to save streaming segment:', error));
  }
}

function flushStreamingCommit() {
  clearStreamingCommitTimer();
  if (state.streamingInterimTranscript) {
    commitStreamingText(state.streamingInterimTranscript, state.streamingLastConfidence || 0);
  }
}

function resetAudioCacheState() {
  state.audioCacheQueue = [];
  state.audioCacheSaving = false;
  state.audioCachedChunks = 0;
}

/**
 * Start periodic segment sync to backend (every 30 seconds)
 */
function startSegmentSync(pageId) {
  stopSegmentSync(); // Clear any existing interval
  state.segmentSyncInterval = setInterval(async () => {
    if (!state.isRecording || state.isStoppingRecording) {
      stopSegmentSync();
      return;
    }
    try {
      const count = await SegmentService.syncToBackend(pageId);
      if (count > 0) {
        console.log(`[Sync] Synced ${count} segments to backend`);
      }
    } catch (e) {
      console.warn('[Sync] Periodic sync failed:', e);
    }
  }, 10000); // 10 seconds
}

/**
 * Stop periodic segment sync
 */
function stopSegmentSync() {
  if (state.segmentSyncInterval) {
    clearInterval(state.segmentSyncInterval);
    state.segmentSyncInterval = null;
  }
}

function enqueueAudioChunk(pageId, blob) {
  if (!pageId || !blob || blob.size === 0) return;
  state.audioCacheQueue.push({ pageId, blob, mimeType: blob.type || 'audio/webm' });
  if (!state.audioCacheSaving) {
    void flushAudioCacheQueue();
  }
}

async function flushAudioCacheQueue() {
  if (state.audioCacheSaving) return;
  state.audioCacheSaving = true;
  while (state.audioCacheQueue.length > 0) {
    const item = state.audioCacheQueue.shift();
    try {
      await AudioService.save(item.pageId, item.blob, item.mimeType);
      state.audioCachedChunks += 1;
    } catch (error) {
      console.error('Audio cache save failed:', error);
    }
  }
  state.audioCacheSaving = false;
}

function isStreamingDuplicate(text) {
  const normalized = text.trim().toLowerCase();
  const now = Date.now();
  state.streamingRecent = state.streamingRecent.filter(
    (entry) => now - entry.time < state.streamingDuplicateWindowMs
  );
  if (state.streamingRecent.some((entry) => entry.text === normalized)) {
    return true;
  }
  state.streamingRecent.push({ text: normalized, time: now });
  if (state.streamingRecent.length > 100) {
    state.streamingRecent.shift();
  }
  return false;
}

/**
 * Start speech recognition watchdog for UI status
 */
function startSpeechRecognition() {
  if (!state.isRecording || state.isStoppingRecording) {
    return;
  }
  if (speechService.isRunning) {
    return;
  }
  const started = speechService.start();
  if (!started) {
    updateRecognitionStatus('无法启动语音识别');
    return;
  }
  startRecognitionWatchdog();
  updateRecognitionStatus();
}

function startRecognitionWatchdog() {
  stopRecognitionWatchdog();
  recognitionWatchdog = setInterval(() => {
    if (!state.isRecording) return;
    const idleMs = Date.now() - state.lastRecognitionTime;
    if (state.recognitionActive && idleMs > 3000) {
      state.recognitionActive = false;
      updateRecognitionStatus();
    }
  }, 1000);
}

function stopRecognitionWatchdog() {
  if (recognitionWatchdog) {
    clearInterval(recognitionWatchdog);
    recognitionWatchdog = null;
  }
}

/**
 * Update transcript display in real-time
 */
function updateTranscriptDisplay() {
  const placeholderTitle = state.isRecording ? '🎤 正在聆听...' : '🎤 点击下方按钮开始录音';
  const placeholderHint = '转录的文字将在这里实时显示';

  if (state.compareMode && state.useWhisper && state.whisperAvailable) {
    const webContainer = document.getElementById('transcript-container-web');
    const streamContainer = document.getElementById('transcript-container-streaming');

    if (webContainer) {
      webContainer.innerHTML = renderTranscriptContent(
        state.webSpeechSegments,
        state.interimTranscript,
        placeholderTitle,
        placeholderHint
      );
      webContainer.scrollTop = webContainer.scrollHeight;
    }

    if (streamContainer) {
      streamContainer.innerHTML = renderTranscriptContent(
        state.streamingSegments,
        state.streamingInterimTranscript,
        placeholderTitle,
        placeholderHint
      );
      streamContainer.scrollTop = streamContainer.scrollHeight;
    }
    return;
  }

  const container = document.getElementById('transcript-container');
  if (!container) return;

  const useStreaming = isStreamingPreferred();
  const segments = useStreaming ? state.streamingSegments : state.webSpeechSegments;
  const interim = useStreaming ? state.streamingInterimTranscript : state.interimTranscript;

  container.innerHTML = renderTranscriptContent(
    segments,
    interim,
    placeholderTitle,
    placeholderHint
  );

  container.scrollTop = container.scrollHeight;
}

/**
 * Update volume display in real-time (without full re-render)
 */
function updateVolumeDisplay() {
  const barsContainer = document.getElementById('volume-bars');
  const labelEl = document.getElementById('volume-label');

  if (barsContainer) {
    barsContainer.innerHTML = renderVolumeBars(state.currentVolume);
  }

  if (labelEl) {
    labelEl.textContent = getVolumeLabel(state.currentVolume, state.isSilent);
  }
}

/**
 * Start the recording timer
 */
function startTimer() {
  // Clear any existing timer
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }

  state.timerInterval = setInterval(() => {
    // Query element inside interval to handle DOM re-renders
    const timerEl = document.getElementById('timer');
    const bannerTimerEl = document.getElementById('recording-banner-timer');
    if (timerEl && state.recordingStartTime) {
      const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
      timerEl.textContent = formatDuration(elapsed);
    }
    if (bannerTimerEl && state.recordingStartTime) {
      const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
      bannerTimerEl.textContent = formatDuration(elapsed);
    }
  }, 1000);
}

/**
 * Stop the recording timer
 */
function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

/**
 * Open a page detail view
 */
async function openPage(pageId) {
  // Check page status first
  const page = state.pages.find(p => p.id === pageId);

  // If page is in 'recording' status, ask user what to do
  if (page && page.status === 'recording') {
    const action = confirm('此录音未正常完成。\n\n点击"确定"将其标记为已完成并查看内容，\n点击"取消"删除此录音。');

    if (action) {
      // Mark as completed
      await PageService.update(pageId, { status: 'completed' });
      page.status = 'completed';
    } else {
      // Ask if they want to delete
      const confirmDelete = confirm('确定要删除这个录音吗？');
      if (confirmDelete) {
        await deletePage(pageId);
        return;
      }
      return;
    }
  }

  state.currentPageId = pageId;
  state.currentView = 'detail';
  state.currentSource = null;  // Reset to default
  state.pageSummary = null;    // Clear previous summary
  state.pageTodos = [];
  state.todosLoading = true;

  // Check Gemini availability if not already done
  if (!state.geminiAvailable && state.whisperAvailable) {
    try {
      const geminiRes = await fetch(`${getAPIBase()}/api/gemini/status`);
      const geminiStatus = await geminiRes.json();
      state.geminiAvailable = geminiStatus.available === true;
      console.log(`Gemini AI: ${state.geminiAvailable ? '✅ Available' : '❌ Not configured'}`);
    } catch (e) {
      console.warn('Gemini status check failed:', e);
    }
  }

  renderApp();

  // Get available sources first
  state.availableSources = await SegmentService.getSourcesByPageId(pageId);

  // Load content with source selector
  await loadPageContent(pageId, state.currentSource);

  // Load audio player
  loadAudioPlayer(pageId);

  // Load todos
  loadTodos(pageId);
}

/**
 * Load page content with specific source
 */
async function loadPageContent(pageId, source = null) {
  const contentEl = document.getElementById('page-content');
  if (!contentEl) return;

  // Load segments (optionally filtered by source)
  const segments = await SegmentService.getFinalByPageId(pageId, source);

  // Build source tabs if multiple sources available
  let tabsHtml = '';
  if (state.availableSources.length > 1) {
    const sourceLabels = {
      'web_speech': '🌐 实时转录',
      'streaming': '⚡ 实时后端',
      'backend': '🤖 后端 ASR',
      'funasr': '🇨🇳 FunASR',
      'whisper': '🐳 Whisper'
    };

    tabsHtml = `
      <div class="source-tabs">
        <span class="source-tabs-label">转录版本：</span>
        ${state.availableSources.map(s => `
          <button class="source-tab ${(source || 'web_speech') === s ? 'active' : ''}" 
                  onclick="switchTranscriptSource('${s}')">
            ${sourceLabels[s] || s}
          </button>
        `).join('')}
      </div>
    `;
  }

  if (segments.length === 0) {
    contentEl.innerHTML = tabsHtml + `<div class="transcript-placeholder text-center"><p>暂无转录内容</p></div>`;
    return;
  }

  // Render segments with speaker labels
  let html = tabsHtml + '<div class="transcript-segments">';
  let lastSpeaker = null;

  segments.forEach(seg => {
    const isNewSpeaker = seg.speaker !== lastSpeaker;
    const speakerColor = seg.speakerColor || '#4CAF50';
    const speakerLabel = seg.speakerLabel || '说话人 1';

    if (isNewSpeaker) {
      if (lastSpeaker !== null) {
        html += '</div></div>'; // Close speaker-text and speaker-block
      }
      html += `
              <div class="speaker-block">
                <div class="speaker-label" style="color: ${speakerColor}">
                  <span class="speaker-dot" style="background-color: ${speakerColor}"></span>
                  ${escapeHtml(speakerLabel)}
                </div>
                <div class="speaker-text">
            `;
    }
    const isLowConfidence = typeof seg.confidence === 'number'
      && seg.confidence > 0
      && seg.confidence < LOW_CONFIDENCE_THRESHOLD;
    const confidenceTitle = isLowConfidence
      ? ` title="置信度 ${(seg.confidence * 100).toFixed(0)}%"`
      : '';
    html += `<span class="segment-text${isLowConfidence ? ' low-confidence' : ''}"${confidenceTitle}>${escapeHtml(seg.text)} </span>`;
    lastSpeaker = seg.speaker;
  });

  html += '</div></div></div>'; // Close all

  // Add character count info
  const totalChars = segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
  html += `<p class="text-muted mt-sm" style="font-size: 0.85em;">📊 ${segments.length} 段 | ${totalChars} 字</p>`;

  contentEl.innerHTML = html;
}

/**
 * Load todos for a page and update panel
 */
async function loadTodos(pageId) {
  state.todosLoading = true;
  const panelEl = document.getElementById('todo-panel');
  if (panelEl) {
    panelEl.innerHTML = renderTodoPanelContent();
  }

  try {
    state.pageTodos = await TodoService.getByPageId(pageId);
  } catch (error) {
    console.error('Failed to load todos:', error);
    state.pageTodos = [];
  } finally {
    state.todosLoading = false;
  }

  if (panelEl) {
    panelEl.innerHTML = renderTodoPanelContent();
  } else {
    renderApp();
  }
}

/**
 * Toggle todo completion
 */
async function toggleTodo(todoId) {
  try {
    await TodoService.toggle(todoId);
    await loadTodos(state.currentPageId);
  } catch (error) {
    console.error('Failed to toggle todo:', error);
  }
}

/**
 * Switch transcript source version
 */
async function switchTranscriptSource(source) {
  state.currentSource = source;
  await loadPageContent(state.currentPageId, source);
}

/**
 * Delete a page
 */
async function deletePage(pageId) {
  const confirmed = confirm('确定要删除这个录音吗？此操作无法撤销。');
  if (!confirmed) return;

  await PageService.delete(pageId);
  await loadPages();

  if (state.currentView === 'detail' && state.currentPageId === pageId) {
    navigateTo('list');
  } else {
    renderApp();
  }
}

/**
 * Export page as text file with speaker labels
 */
async function exportPage(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;

  const segments = await SegmentService.getFinalByPageId(pageId);

  // Group segments by speaker for export
  let transcriptLines = [];
  let lastSpeaker = null;

  segments.forEach(seg => {
    const speakerLabel = seg.speakerLabel || '说话人 1';
    if (seg.speaker !== lastSpeaker) {
      transcriptLines.push('');
      transcriptLines.push(`【${speakerLabel}】`);
    }
    transcriptLines.push(seg.text);
    lastSpeaker = seg.speaker;
  });

  // Build speaker summary
  const speakerStats = {};
  segments.forEach(seg => {
    const speaker = seg.speakerLabel || '说话人 1';
    if (!speakerStats[speaker]) {
      speakerStats[speaker] = { count: 0, chars: 0 };
    }
    speakerStats[speaker].count++;
    speakerStats[speaker].chars += seg.text.length;
  });

  const speakerSummary = Object.entries(speakerStats)
    .map(([speaker, stats]) => `  - ${speaker}: ${stats.count}段, ${stats.chars}字`)
    .join('\n');

  const content = `# ${page.title}

创建时间: ${formatDateTime(page.createdAt)}
时长: ${formatDurationHuman(page.duration)}
说话人数: ${Object.keys(speakerStats).length}

## 说话人统计
${speakerSummary || '  (无数据)'}

---

${transcriptLines.join('\n') || '(无转录内容)'}
`;

  const filename = `${page.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.txt`;
  downloadFile(content, filename, 'text/plain;charset=utf-8');
}

/**
 * Update page title
 */
async function updatePageTitle(pageId, newTitle) {
  await PageService.update(pageId, { title: newTitle });
  await loadPages();
}

/**
 * Load audio player for a page
 */
async function loadAudioPlayer(pageId) {
  const playerEl = document.getElementById('audio-player');
  const loadingEl = document.getElementById('audio-loading');
  const downloadBtn = document.getElementById('download-audio-btn');

  if (!playerEl || !loadingEl) return;

  try {
    const audioUrl = await AudioService.getAudioUrl(pageId);

    if (audioUrl) {
      playerEl.src = audioUrl;
      playerEl.style.display = 'block';
      loadingEl.style.display = 'none';
      downloadBtn.disabled = false;
    } else {
      loadingEl.innerHTML = '📭 无音频文件';
    }
  } catch (error) {
    console.error('Failed to load audio:', error);
    loadingEl.innerHTML = '❌ 加载音频失败';
  }
}

/**
 * Download audio file
 */
async function downloadAudio(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;

  try {
    const audio = await AudioService.getByPageId(pageId);
    if (!audio?.blob) {
      alert('无音频文件可下载');
      return;
    }

    // Create download link
    const url = URL.createObjectURL(audio.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${page.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download audio:', error);
    alert('下载音频失败');
  }
}

// Expose downloadAudio to global scope
window.downloadAudio = downloadAudio;

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', init);

/**
 * Draw Visualizer
 */
function drawVisualizer() {
  if (!state.isRecording) return;

  const canvas = document.getElementById('audio-visualizer');
  if (!canvas) {
    requestAnimationFrame(drawVisualizer);
    return;
  }

  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.offsetWidth;
  const height = canvas.height = canvas.offsetHeight;

  // Get data
  const dataArray = audioRecorder.getFrequencyData(); // Needs getFrequencyData exposed in service
  // Or check if it exists. AudioRecorderService in step 231 HAS getFrequencyData.

  ctx.clearRect(0, 0, width, height);

  const waveform = audioRecorder.getWaveformData();
  if (waveform.length > 0) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.9)';
    ctx.beginPath();
    const sliceWidth = width / waveform.length;
    let xPos = 0;
    for (let i = 0; i < waveform.length; i++) {
      const v = waveform[i] / 128.0;
      const y = (v * height) / 2;
      if (i === 0) {
        ctx.moveTo(xPos, y);
      } else {
        ctx.lineTo(xPos, y);
      }
      xPos += sliceWidth;
    }
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }

  requestAnimationFrame(drawVisualizer);
}

// Make globally available if needed
window.drawVisualizer = drawVisualizer;
