import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HotwordService } from '../../services/Database';
import { escapeHtml } from '../../utils/helpers';

function HotwordsView() {
    const navigate = useNavigate();
    const [hotwords, setHotwords] = useState([]);
    const [newWord, setNewWord] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('name');

    const categories = HotwordService.CATEGORIES;

    useEffect(() => {
        loadHotwords();
    }, []);

    const loadHotwords = async () => {
        const words = await HotwordService.getAll();
        setHotwords(words);
    };

    const handleAdd = async () => {
        const word = newWord.trim();
        if (!word) {
            alert('请输入热词');
            return;
        }

        await HotwordService.add(word, selectedCategory);
        setNewWord('');
        await loadHotwords();
    };

    const handleDelete = async (id) => {
        await HotwordService.delete(id);
        await loadHotwords();
    };

    return (
        <div className="hotwords-view">
            <div className="hotwords-header">
                <h1>🔤 热词管理</h1>
                <p className="text-muted">添加自定义热词（人名、技术术语等）提升识别准确度</p>
            </div>

            <div className="hotword-form">
                <input
                    type="text"
                    className="input"
                    placeholder="输入热词..."
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                />
                <select
                    className="select"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                >
                    {Object.entries(categories).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
                <button className="btn btn-primary" onClick={handleAdd}>
                    添加
                </button>
            </div>

            <div className="hotword-list">
                {hotwords.length === 0 ? (
                    <p className="text-muted text-center">暂无热词，添加热词可提升识别准确度</p>
                ) : (
                    hotwords.map(hw => (
                        <div key={hw.id} className="hotword-item">
                            <span className="hotword-word">{hw.word}</span>
                            <span className="hotword-category badge">{categories[hw.category] || hw.category}</span>
                            <button
                                className="btn btn-sm btn-danger"
                                onClick={() => handleDelete(hw.id)}
                            >
                                删除
                            </button>
                        </div>
                    ))
                )}
            </div>

            <div className="mt-lg">
                <button className="btn btn-secondary" onClick={() => navigate('/')}>
                    <span>←</span> 返回列表
                </button>
            </div>
        </div>
    );
}

export default HotwordsView;
