/**
 * GeminiService - Gemini AI API 封装
 * 提供会议总结和 TODO 生成功能
 */

// 配置管理
const CONFIG_KEY = 'meeting_gemini_config';

class ConfigManager {
    static getConfig() {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse config:', e);
            }
        }
        return {
            apiKey: '',
            model: 'gemini-2.0-flash',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
        };
    }

    static saveConfig(config) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }

    static getApiKey() {
        return this.getConfig().apiKey;
    }

    static setApiKey(apiKey) {
        const config = this.getConfig();
        config.apiKey = apiKey;
        this.saveConfig(config);
    }

    static isConfigured() {
        return !!this.getApiKey();
    }
}

/**
 * GeminiService - 核心 API 服务
 */
class GeminiService {
    constructor() {
        this.config = ConfigManager.getConfig();
    }

    /**
     * 刷新配置
     */
    refreshConfig() {
        this.config = ConfigManager.getConfig();
    }

    /**
     * 调用 Gemini API
     */
    async callAPI(prompt, options = {}) {
        this.refreshConfig();

        if (!this.config.apiKey) {
            throw new Error('请先配置 Gemini API Key');
        }

        const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

        const body = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: options.temperature || 0.7,
                maxOutputTokens: options.maxTokens || 2048,
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `API 请求失败: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error('API 返回了空响应');
        }

        return text;
    }

    /**
     * 生成会议总结和 TODO
     */
    async generateSummary(transcript, options = {}) {
        const prompt = `你是一个专业的会议记录助手。请根据以下会议转录内容，生成结构化的会议总结。

## 转录内容：
${transcript}

## 请按以下格式输出：

### 📋 会议摘要
（用2-3句话概括会议主要内容）

### 🎯 关键要点
（列出3-5个最重要的讨论点）

### ✅ 待办事项 (TODO)
（提取会议中提到的任务、承诺或后续行动项，格式如下：）
- [ ] 任务描述 ${options.includeAssignee ? '| 负责人：XXX' : ''}
- [ ] 任务描述 ${options.includeAssignee ? '| 负责人：XXX' : ''}

### 💡 决策记录
（如有明确的决定或结论，请列出）

请确保 TODO 列表是可执行的、具体的任务，而不是泛泛的描述。如果转录内容太短或不包含实质性会议内容，请如实说明。`;

        return await this.callAPI(prompt, {
            temperature: 0.5,
            maxTokens: 2048
        });
    }

    /**
     * 与会议内容对话
     */
    async chat(transcript, question, history = []) {
        const historyText = history.length > 0
            ? '\n\n## 对话历史：\n' + history.map(h => `${h.role}: ${h.content}`).join('\n')
            : '';

        const prompt = `你是一个会议记录助手。以下是会议转录内容，请根据内容回答用户的问题。

## 会议转录：
${transcript}
${historyText}

## 用户问题：
${question}

请基于会议内容回答。如果问题超出会议内容范围，请如实说明。`;

        return await this.callAPI(prompt, {
            temperature: 0.7,
            maxTokens: 1024
        });
    }
}

// 单例实例
let geminiServiceInstance = null;

export function getGeminiService() {
    if (!geminiServiceInstance) {
        geminiServiceInstance = new GeminiService();
    }
    return geminiServiceInstance;
}

export { ConfigManager, GeminiService };
export default GeminiService;
