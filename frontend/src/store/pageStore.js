import { create } from 'zustand';
import { PageService, SegmentService, TodoService } from '../services/Database';

/**
 * Page Store - 管理会议页面和列表
 */
export const usePageStore = create((set, get) => ({
    // Pages list
    pages: [],
    currentPageId: null,

    // Current page details
    pageSummary: null,
    pageTodos: [],

    // Loading states
    summaryLoading: false,
    todosLoading: false,

    // Gemini availability
    geminiAvailable: false,

    // Actions
    loadPages: async () => {
        const pages = await PageService.getAll();
        set({ pages });
    },

    createPage: async () => {
        const page = await PageService.create();
        await get().loadPages();
        return page;
    },

    openPage: (pageId) => {
        set({ currentPageId: pageId });
    },

    updatePage: async (pageId, updates) => {
        const updated = await PageService.update(pageId, updates);
        await get().loadPages();
        return updated;
    },

    deletePage: async (pageId) => {
        if (confirm('确定要删除这条录音吗？此操作无法撤销。')) {
            await PageService.delete(pageId);
            await get().loadPages();
        }
    },

    // Summary
    setSummaryLoading: (loading) => set({ summaryLoading: loading }),

    setPageSummary: (summary) => set({ pageSummary: summary }),

    // Todos
    setTodosLoading: (loading) => set({ todosLoading: loading }),

    loadTodos: async (pageId) => {
        set({ todosLoading: true });
        const todos = await TodoService.getByPageId(pageId);
        set({ pageTodos: todos, todosLoading: false });
    },

    setPageTodos: (todos) => set({ pageTodos: todos }),

    toggleTodo: async (todoId) => {
        const todo = get().pageTodos.find(t => t.id === todoId);
        if (todo) {
            const nextCompleted = !todo.completed;
            await TodoService.update(todoId, { completed: nextCompleted });
            set(state => ({
                pageTodos: state.pageTodos.map(item => (
                    item.id === todoId ? { ...item, completed: nextCompleted } : item
                ))
            }));
            const currentPageId = get().currentPageId;
            if (currentPageId) {
                await get().loadTodos(currentPageId);
            }
        }
    },

    // Gemini
    setGeminiAvailable: (available) => set({ geminiAvailable: available }),

    checkGeminiStatus: async () => {
        try {
            const response = await fetch('/api/gemini/status');
            const data = await response.json();
            set({ geminiAvailable: data.available });
        } catch (error) {
            console.error('Failed to check Gemini status:', error);
            set({ geminiAvailable: false });
        }
    }
}));
