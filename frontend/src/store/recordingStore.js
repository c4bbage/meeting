import { create } from 'zustand';

/**
 * Recording Store - 管理录音状态
 */
export const useRecordingStore = create((set, get) => ({
    // Recording state
    isRecording: false,
    recordingStartTime: null,
    activeRecordingPageId: null,
    isStoppingRecording: false,

    // Transcription
    currentTranscript: '',
    interimTranscript: '',
    webSpeechSegments: [],
    streamingSegments: [],
    streamingInterimTranscript: '',

    // Audio
    currentVolume: 0,
    selectedDeviceId: null,
    audioDevices: [],

    // Recognition status
    recognitionActive: false,
    streamingActive: false,
    lastRecognitionTime: null,

    // Settings
    useWhisper: true,
    whisperAvailable: false,
    compareMode: true,

    // Actions
    setRecording: (isRecording) => set({ isRecording }),

    setRecordingStartTime: (time) => set({ recordingStartTime: time }),

    setActiveRecordingPageId: (id) => set({ activeRecordingPageId: id }),

    addWebSpeechSegment: (segment) => set(state => ({
        webSpeechSegments: [...state.webSpeechSegments, segment]
    })),

    addStreamingSegment: (segment) => set(state => ({
        streamingSegments: [...state.streamingSegments, segment]
    })),

    setInterimTranscript: (text) => set({ interimTranscript: text }),

    setStreamingInterimTranscript: (text) => set({ streamingInterimTranscript: text }),

    appendTranscript: (text) => set(state => ({
        currentTranscript: state.currentTranscript + text + ' '
    })),

    setVolume: (volume) => set({ currentVolume: volume }),

    setAudioDevices: (devices) => set({ audioDevices: devices }),

    setSelectedDeviceId: (deviceId) => set({ selectedDeviceId: deviceId }),

    setRecognitionActive: (active) => set({
        recognitionActive: active,
        lastRecognitionTime: active ? Date.now() : null
    }),

    setStreamingActive: (active) => set({ streamingActive: active }),

    toggleWhisper: () => set(state => {
        const newUseWhisper = !state.useWhisper;
        return {
            useWhisper: newUseWhisper,
            compareMode: newUseWhisper ? state.compareMode : false,
            streamingSegments: newUseWhisper ? state.streamingSegments : [],
            streamingInterimTranscript: ''
        };
    }),

    setWhisperAvailable: (available) => set({ whisperAvailable: available }),

    toggleCompareMode: () => set(state => ({
        compareMode: state.useWhisper && state.whisperAvailable ? !state.compareMode : false
    })),

    resetRecording: () => set({
        currentTranscript: '',
        interimTranscript: '',
        streamingInterimTranscript: '',
        webSpeechSegments: [],
        streamingSegments: [],
        currentVolume: 0,
        recognitionActive: false,
        streamingActive: false,
        lastRecognitionTime: null
    }),

    clearRecording: () => set({
        isRecording: false,
        recordingStartTime: null,
        activeRecordingPageId: null,
        currentTranscript: '',
        interimTranscript: '',
        streamingInterimTranscript: '',
        webSpeechSegments: [],
        streamingSegments: [],
        currentVolume: 0,
        recognitionActive: false,
        streamingActive: false
    })
}));
