/**
 * TranscriptVersionSwitcher - UI component for switching between transcript versions
 */
import React from 'react';
import './TranscriptVersionSwitcher.css';

const TranscriptVersionSwitcher = ({ page, currentVersion, onVersionChange }) => {
    // 所有支持的版本（按推荐顺序排列）
    const versions = {
        fused: {
            label: '智能融合',
            icon: '✨',
            desc: 'AI 融合多版本 - 准确且完整',
            badge: '推荐',
            priority: 1
        },
        final: {
            label: '高精度',
            icon: '🎯',
            desc: '录音后完整转录 - 最准确',
            priority: 2
        },
        streaming: {
            label: 'FunASR流式',
            icon: '🌊',
            desc: '服务端流式识别',
            priority: 3
        },
        web_speech: {
            label: 'Web Speech',
            icon: '🌐',
            desc: '浏览器实时识别',
            priority: 4
        },
        realtime: {
            label: '合并实时',
            icon: '⚡',
            desc: '实时识别合并版',
            priority: 5
        }
    };

    // Get available versions from page metadata
    const transcriptVersions = page?.transcriptVersions || {};
    const availableVersions = Object.keys(transcriptVersions);

    // If no versions available, show nothing
    if (availableVersions.length === 0) {
        return null;
    }

    // Sort available versions by priority
    const sortedVersions = Object.entries(versions)
        .filter(([key]) => availableVersions.includes(key))
        .sort((a, b) => a[1].priority - b[1].priority);

    return (
        <div className="transcript-version-switcher">
            <div className="version-switcher-header">
                <span className="version-switcher-label">转录版本</span>
                <span className="version-count">{availableVersions.length} 个版本可用</span>
            </div>
            <div className="version-buttons">
                {sortedVersions.map(([key, config]) => {
                    const isActive = currentVersion === key;
                    const versionInfo = transcriptVersions[key];

                    return (
                        <button
                            key={key}
                            className={`version-btn ${isActive ? 'active' : ''}`}
                            onClick={() => onVersionChange(key)}
                            title={config.desc}
                        >
                            <span className="icon">{config.icon}</span>
                            <span className="label">{config.label}</span>
                            {config.badge && isActive && (
                                <span className="badge">{config.badge}</span>
                            )}
                            {versionInfo?.segmentCount && (
                                <span className="count">{versionInfo.segmentCount}段</span>
                            )}
                        </button>
                    );
                })}
            </div>
            {currentVersion && versions[currentVersion] && (
                <div className="version-info">
                    {versions[currentVersion]?.icon} {versions[currentVersion]?.desc}
                </div>
            )}
        </div>
    );
};

export default TranscriptVersionSwitcher;
