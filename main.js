/**
 * Meeting Transcription App
 * 会议转录应用主入口
 */

import { PageService, SegmentService, SpeakerDataService, HotwordService, AudioService, db } from './services/Database.js';
import { SpeechRecognitionService } from './services/SpeechRecognition.js';
import { AudioRecorderService } from './services/AudioRecorder.js';
import { SpeakerDiarizerService } from './services/SpeakerDiarizer.js';
import { getWhisperAPI } from './services/WhisperAPI.js';
import { getGeminiService, ConfigManager } from './services/GeminiService.js';
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
  isPaused: false,
  recordingStartTime: null,
  timerInterval: null,
  pages: [],
  currentTranscript: '',
  interimTranscript: '',
  segments: [],  // 当前录音的片段（含说话人信息）
  currentVolume: 0,
  isSilent: false,
  silenceWarningShown: false,
  silenceDuration: 0,
  whisperAvailable: false,  // 后端是否可用
  useWhisper: false,        // 是否使用 Whisper 转录
  recognitionActive: false, // 语音识别是否正在工作
  lastRecognitionTime: 0,   // 上次收到识别结果的时间
  selectedDeviceId: null,   // 当前选中的麦克风ID
  audioDevices: [],         // 可用的音频设备列表
  pageSummary: null,        // 当前页面的 AI 总结
  summaryLoading: false,    // 总结生成中
  showApiKeyModal: false,   // 显示 API Key 配置模态框
  currentSource: null,      // 当前显示的转录版本 (null = 默认/web_speech)
  availableSources: []      // 可用的转录版本列表
};

// Services
let speechService = null;
let audioRecorder = null;
let speakerDiarizer = null;
let whisperAPI = null;

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

  // Check if Whisper backend is available
  whisperAPI = getWhisperAPI();
  state.whisperAvailable = await whisperAPI.checkHealth();
  console.log(`Whisper backend: ${state.whisperAvailable ? '✅ Available' : '❌ Not available'}`);

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
      ${state.currentView === 'list' ? renderPageList() : ''}
      ${state.currentView === 'recording' ? renderRecordingView() : ''}
      ${state.currentView === 'detail' ? renderDetailView() : ''}
      ${state.currentView === 'hotwords' ? '<div id="hotwords-container"><div class="text-center"><p>加载中...</p></div></div>' : ''}
    </main>
  `;

  bindEvents();

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
                    onclick="toggleWhisper()" title="切换 ASR 引擎">
              ${whisperStatus}
            </button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" onclick="openHotwords()" title="热词管理">
            🔤 热词
          </button>
          ${state.currentView === 'list' ? `
            <button class="btn btn-primary" onclick="startNewRecording()">
              <span>➕</span> 新建录音
            </button>
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
          <button class="btn btn-primary mt-lg" onclick="startNewRecording()">
            开始录音
          </button>
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
  const statusBadge = page.status === 'recording'
    ? '<span class="badge badge-error">录音中</span>'
    : page.status === 'paused'
      ? '<span class="badge badge-warning">已暂停</span>'
      : '';

  return `
    <div class="card" onclick="openPage('${page.id}')" style="cursor: pointer;">
      <div class="card-header">
        <h3 class="card-title">${escapeHtml(page.title)}</h3>
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
 * Render recording view
 */
function renderRecordingView() {
  const statusClass = state.isRecording && !state.isPaused ? 'active' : '';
  const statusText = state.isRecording
    ? (state.isPaused ? '已暂停' : '录音中')
    : '准备录音';

  // Volume indicator bars
  const volumeBars = renderVolumeBars(state.currentVolume);

  // Generate device options
  const deviceOptions = state.audioDevices.map(device =>
    `<option value="${device.deviceId}" ${device.deviceId === state.selectedDeviceId ? 'selected' : ''}>
      ${device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
    </option>`
  ).join('');

  const deviceSelector = !state.isRecording && state.audioDevices.length > 0 ? `
    <div class="device-selector mb-md text-center">
      <label for="audio-device-select" class="text-sm text-muted mr-sm">🎤 选择麦克风:</label>
      <select id="audio-device-select" class="select select-sm" onchange="changeAudioDevice(this.value)" style="max-width: 200px;">
        ${deviceOptions}
      </select>
    </div>
  ` : '';

  return `
    <div class="recording-view">
      <div class="recording-header">
        <div class="recording-timer" id="timer">00:00</div>
        <div class="recording-status ${statusClass}">
          <span class="recording-status-dot"></span>
          <span>${statusText}</span>
        </div>
      </div>

      ${deviceSelector}

      ${state.isRecording ? `
        <div class="volume-meter" id="volume-meter">
          <div class="volume-bars" id="volume-bars">
            ${volumeBars}
          </div>
          <div class="volume-label" id="volume-label">
            ${getVolumeLabel(state.currentVolume, state.isSilent)}
          </div>
        </div>
        ${state.silenceWarningShown ? `
          <div class="silence-warning">
            ⚠️ 未检测到声音，请检查麦克风
          </div>
        ` : ''}
        <div class="recognition-diagnostics" id="recognition-diagnostics">
          <div class="diag-row">
            <span class="diag-label">识别引擎:</span>
            <span class="diag-value">${state.useWhisper ? '🟢 Whisper (本地)' : '🔵 Web Speech (网络)'}</span>
          </div>
          <div class="diag-row">
            <span class="diag-label">识别状态:</span>
            <span class="diag-value" id="recognition-status">
              ${state.recognitionActive ? '✅ 正在识别' : '⏸️ 等待语音...'}
            </span>
          </div>
          ${!state.useWhisper ? `
          <div class="diag-row diag-tip">
            💡 Web Speech API依赖网络，如频繁中断请切换到 Whisper 模式
          </div>
          ` : `
          <div class="diag-row diag-tip">
            💡 录音结束后将用Whisper重新转录，获得更高精度
          </div>
          `}
        </div>
      ` : ''}

      <div class="transcript-container" id="transcript-container">
        ${state.currentTranscript || state.interimTranscript || state.segments.length > 0
      ? `<div class="transcript-text">
              <span class="final">${escapeHtml(state.currentTranscript)}</span>
              <span class="interim">${escapeHtml(state.interimTranscript)}</span>
            </div>`
      : `<div class="transcript-placeholder">
              <p>🎤 点击下方按钮开始录音</p>
              <p class="text-muted mt-sm">转录的文字将在这里实时显示</p>
            </div>`
    }
      </div>

      <div class="recording-controls">
        ${!state.isRecording ? `
          <button class="record-btn" onclick="toggleRecording()">
            <div class="record-btn-icon"></div>
          </button>
        ` : `
          <button class="btn btn-secondary btn-icon" onclick="togglePause()">
            ${state.isPaused ? '▶️' : '⏸️'}
          </button>
          <button class="record-btn recording" onclick="toggleRecording()">
            <div class="record-btn-icon"></div>
          </button>
          <button class="btn btn-primary" onclick="saveRecording()">
            💾 保存
          </button>
        `}
      </div>
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
            ${ConfigManager.isConfigured() ? `
              <button class="btn btn-sm btn-primary" onclick="generatePageSummary('${page.id}')" ${state.summaryLoading ? 'disabled' : ''}>
                ${state.summaryLoading ? '⏳ 生成中...' : '✨ 生成总结'}
              </button>
            ` : `
              <button class="btn btn-sm btn-secondary" onclick="showApiKeySettings()">
                ⚙️ 配置 API Key
              </button>
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
  window.togglePause = togglePause;
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
  window.showApiKeySettings = showApiKeySettings;
  window.saveApiKey = saveApiKey;
  window.closeApiKeyModal = closeApiKeyModal;
  window.switchTranscriptSource = switchTranscriptSource;
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

  if (!ConfigManager.isConfigured()) {
    showApiKeySettings();
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

    // Call Gemini API
    const gemini = getGeminiService();
    const summary = await gemini.generateSummary(transcript.trim());

    state.pageSummary = summary;
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
 * Show API Key settings modal
 */
function showApiKeySettings() {
  const currentKey = ConfigManager.getApiKey();
  const maskedKey = currentKey ? currentKey.slice(0, 8) + '...' + currentKey.slice(-4) : '';

  // Create modal HTML
  const modalHtml = `
    <div class="modal-overlay" id="api-key-modal" onclick="closeApiKeyModal(event)">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>⚙️ Gemini API 配置</h2>
          <button class="btn btn-sm" onclick="closeApiKeyModal()">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted mb-md">请输入你的 Gemini API Key 以启用 AI 总结功能。</p>
          <p class="text-muted mb-md" style="font-size: 0.9em;">
            获取方式：访问 <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a> 创建 API Key
          </p>
          <input type="password" id="api-key-input" class="input" 
                 placeholder="输入 API Key..." 
                 value="${currentKey}"
                 style="width: 100%; margin-bottom: 1rem;">
          ${maskedKey ? `<p class="text-muted" style="font-size: 0.85em;">当前: ${maskedKey}</p>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeApiKeyModal()">取消</button>
          <button class="btn btn-primary" onclick="saveApiKey()">保存</button>
        </div>
      </div>
    </div>
  `;

  // Append to body
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Save API Key
 */
function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const key = input?.value?.trim();

  if (key) {
    ConfigManager.setApiKey(key);
    console.log('API Key saved');
  }

  closeApiKeyModal();
  renderApp();
}

/**
 * Close API Key modal
 */
function closeApiKeyModal(event) {
  if (event && event.target.id !== 'api-key-modal') return;
  const modal = document.getElementById('api-key-modal');
  if (modal) {
    modal.remove();
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
  console.log(`ASR engine: ${state.useWhisper ? 'Whisper' : 'Web Speech'}`);
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
  // Stop recording if leaving recording view
  if (state.currentView === 'recording' && state.isRecording) {
    const confirmed = confirm('正在录音中，确定要离开吗？录音将被保存。');
    if (!confirmed) return;
    saveRecording();
  }

  state.currentView = view;
  state.currentPageId = null;
  renderApp();
}

/**
 * Start a new recording session
 */
async function startNewRecording() {
  // Create new page
  const page = await PageService.create();
  state.currentPageId = page.id;
  state.currentView = 'recording';
  state.currentTranscript = '';
  state.interimTranscript = '';
  state.segments = [];

  // Initialize speaker diarizer with longer threshold to avoid false speaker changes
  speakerDiarizer = new SpeakerDiarizerService({ silenceThreshold: 5000 });

  await loadAudioDevices();
  await loadPages();
  renderApp();
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
  // Initialize audio recorder
  const audioReady = await audioRecorder.init(state.selectedDeviceId);
  if (!audioReady) {
    alert('无法访问麦克风，请检查权限设置');
    return;
  }

  // Setup speech recognition callbacks
  speechService.onResult = (transcript, isFinal, confidence) => {
    // Update recognition status
    state.recognitionActive = true;
    state.lastRecognitionTime = Date.now();
    updateRecognitionStatus();

    if (isFinal) {
      const timestamp = Date.now() - state.recordingStartTime;

      // Process through speaker diarizer
      const segmentWithSpeaker = speakerDiarizer.processSegment({
        text: transcript,
        timestamp: timestamp,
        confidence: confidence
      });

      // Add to state segments for display
      state.segments.push(segmentWithSpeaker);

      // Append to final transcript
      state.currentTranscript += transcript + ' ';
      state.interimTranscript = '';

      // Save segment to database with speaker info
      SegmentService.add(state.currentPageId, {
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

  // Start services
  const speechStarted = speechService.start();
  if (!speechStarted) {
    alert('无法启动语音识别');
    return;
  }

  audioRecorder.start();

  // Setup volume monitoring
  audioRecorder.onVolumeChange = (volume, isSilent) => {
    state.currentVolume = volume;
    state.isSilent = isSilent;

    // Track silence duration for warning
    if (isSilent) {
      state.silenceDuration += 100; // monitoring interval
      if (state.silenceDuration > 5000 && !state.silenceWarningShown) {
        state.silenceWarningShown = true;
        renderApp();
      }
    } else {
      state.silenceDuration = 0;
      if (state.silenceWarningShown) {
        state.silenceWarningShown = false;
        renderApp();
      }
    }

    updateVolumeDisplay();
  };
  audioRecorder.startVolumeMonitoring(100, 5);

  // Update state
  state.isRecording = true;
  state.isPaused = false;
  state.recordingStartTime = Date.now();
  state.currentVolume = 0;
  state.silenceDuration = 0;
  state.silenceWarningShown = false;

  // Start timer
  startTimer();

  // Update page status
  await PageService.update(state.currentPageId, { status: 'recording' });
}

/**
 * Stop recording
 */
async function stopRecording() {
  // Stop services
  speechService.stop();
  audioRecorder.stopVolumeMonitoring();

  // Get audio blob before stopping recorder
  const audioResult = await audioRecorder.stop();

  // Stop timer
  stopTimer();

  // Update state
  state.isRecording = false;
  state.isPaused = false;

  // Calculate duration
  const duration = Math.floor((Date.now() - state.recordingStartTime) / 1000);

  // Save speaker diarization state
  if (speakerDiarizer) {
    await SpeakerDataService.save(state.currentPageId, speakerDiarizer.exportData());
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
        await SegmentService.deleteBySource(state.currentPageId, backendSource);

        // Add backend results alongside WebSpeech (not replacing)
        await SegmentService.addFromWhisper(state.currentPageId, result.segments, backendSource);

        const webSpeechSegs = await SegmentService.getFinalByPageId(state.currentPageId, 'web_speech');
        const backendSegs = result.segments;
        console.log(`Multi-version saved: WebSpeech=${webSpeechSegs.length} segs, ${backendSource}=${backendSegs.length} segs`);
      }
    } catch (error) {
      console.error('Backend transcription failed:', error);
    }
  }

  // Update page
  await PageService.update(state.currentPageId, {
    status: 'completed',
    duration: duration
  });

  // Save audio blob for playback/download
  console.log('Audio result from recorder:', audioResult);
  if (audioResult?.blob) {
    await AudioService.save(state.currentPageId, audioResult.blob, audioResult.mimeType || 'audio/webm');
    console.log(`Audio saved: ${(audioResult.blob.size / 1024).toFixed(1)} KB`);
  } else {
    console.warn('No audio blob available to save!');
  }

  // Sync segments to backend for cross-device access
  await SegmentService.syncToBackend(state.currentPageId);
}

/**
 * Toggle pause
 */
function togglePause() {
  if (state.isPaused) {
    // Resume
    speechService.resume();
    audioRecorder.resume();
    state.isPaused = false;
    startTimer();
  } else {
    // Pause
    speechService.pause();
    audioRecorder.pause();
    state.isPaused = true;
    stopTimer();
  }

  renderApp();
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
    statusEl.innerHTML = `<span style="color: var(--color-warning)">⚠️ ${errorMessage}</span>`;
  } else if (state.recognitionActive) {
    statusEl.innerHTML = '✅ 正在识别';
  } else {
    statusEl.innerHTML = '⏸️ 等待语音...';
  }
}

/**
 * Update transcript display in real-time
 */
function updateTranscriptDisplay() {
  const container = document.getElementById('transcript-container');
  if (!container) return;

  // Group segments by speaker for better display
  let html = '<div class="transcript-segments">';
  let lastSpeaker = null;

  state.segments.forEach((seg, index) => {
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
    html += `<span class="segment-text">${escapeHtml(seg.text)} </span>`;
    lastSpeaker = seg.speaker;
  });

  if (state.segments.length > 0) {
    html += '</div></div>'; // Close speaker-text and speaker-block
  }

  // Add interim result
  if (state.interimTranscript) {
    html += `<div class="interim-text">${escapeHtml(state.interimTranscript)}</div>`;
  }

  html += '</div>';

  // Show placeholder if no content
  if (state.segments.length === 0 && !state.interimTranscript) {
    container.innerHTML = `
        <div class="transcript-placeholder">
          <p>🎤 正在聆听...</p>
          <p class="text-muted mt-sm">转录的文字将在这里实时显示</p>
        </div>
      `;
  } else {
    container.innerHTML = html;
  }

  // Auto scroll to bottom
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
    if (timerEl && state.recordingStartTime) {
      const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
      timerEl.textContent = formatDuration(elapsed);
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
  renderApp();

  // Get available sources first
  state.availableSources = await SegmentService.getSourcesByPageId(pageId);

  // Load content with source selector
  await loadPageContent(pageId, state.currentSource);

  // Load audio player
  loadAudioPlayer(pageId);
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
    html += `<span class="segment-text">${escapeHtml(seg.text)} </span>`;
    lastSpeaker = seg.speaker;
  });

  html += '</div></div></div>'; // Close all

  // Add character count info
  const totalChars = segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
  html += `<p class="text-muted mt-sm" style="font-size: 0.85em;">📊 ${segments.length} 段 | ${totalChars} 字</p>`;

  contentEl.innerHTML = html;
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

