# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A meeting transcription app with real-time speech-to-text, AI analysis (Gemini), and todo management. Bilingual (Chinese/English) UI and comments.

## Commands

### Run All Services (Production)
```bash
./start_domain.sh  # Starts backend (6543) + frontend static (3456) + Caddy HTTPS (8443)
```

### Development
```bash
# Backend
uv run uvicorn backend.server:app --host 0.0.0.0 --port 6543 --reload

# Frontend (Vite dev server with API proxy to :8443)
cd frontend && npm run dev    # port 3000

# Build frontend
cd frontend && npm run build

# Lint frontend
cd frontend && npm run lint

# Sync Python deps
uv sync
```

### Tests
```bash
uv run pytest tests/                        # all tests
uv run pytest tests/test_gemini_upgrade.py  # single test file
```

## Architecture

### Two Parallel Frontends

There are TWO frontend codebases — this is intentional, not duplication:

1. **`frontend/`** — React + Vite SPA (active development). Uses React Router, zustand for state, Dexie.js for IndexedDB.
2. **Root files** (`main.js`, `index.html`, `index.css`, `services/`) — Original vanilla JS app. Still served by `start_domain.sh` via Python HTTP server. The root `services/` directory mirrors some frontend service logic.

### Backend (Python/FastAPI)

- **`backend/server.py`** — All API endpoints. FastAPI app on port 6543.
- **`backend/storage.py`** — SQLite via raw `sqlite3`. Tables: `pages`, `segments`, `speaker_data`, `todos`, `reviews`. Uses soft delete (`deleted_at`). Auto-migrates columns on startup via `init_db()`.
- **`backend/gemini_service.py`** — Gemini AI integration using `google-genai` SDK. Uses Pydantic schemas + `response_mime_type="application/json"` for structured output. No generic `generate()` method.
- **`backend/transcription.py`** — faster-whisper ASR engine.
- **`backend/funasr_service.py`** — FunASR alternative ASR engine. Selected via `ASR_ENGINE` env var.
- **`backend/fusion_service.py`** — Merges multiple transcript versions (realtime, final, web_speech, streaming → fused).
- **`backend/task_service.py`** — Background task runner for async transcription/fusion.
- **`backend/hotwords.py`** — Custom vocabulary management (JSON file at `backend/data/hotwords.json`).

### Frontend React App (`frontend/`)

- **State**: zustand store (`src/store/recordingStore.js`) for recording state.
- **Data layer**: Dexie IndexedDB (`src/services/Database.js`) with backend sync via `SyncService.js`. IndexedDB is primary, backend is sync target.
- **Services**: `WhisperAPI.js` (backend ASR client), `WebSocketService.js` (real-time streaming transcription).
- **Views**: `ListView` (all meetings), `RecordingView` (active recording), `DetailView` (meeting detail + transcript), `TodoView` (global todo management with calendar/board/analytics sub-views).

### Data Flow

1. Browser records audio → chunks uploaded to backend (`/api/pages/{id}/audio_chunk`)
2. Real-time transcription via Web Speech API (browser) AND/OR WebSocket streaming to backend ASR
3. Segments stored in IndexedDB first, synced to backend SQLite
4. Post-recording: full audio can be sent for final transcription (`/api/transcribe`, async via task_service)
5. AI analysis via Gemini (`/api/analyze`) produces summary, key points, todos
6. Multiple transcript versions can be fused (`/api/pages/{id}/fuse_transcripts`)

## Key Conventions

- Backend uses **snake_case** DB columns, API models use **camelCase** (Pydantic). Storage classes handle the mapping.
- `SyncService.js` `API_BASE` already includes `/api` — never double-prefix URLs.
- Todos use special pageId values: `_manual_` for hand-created, `_ai_generated_` for AI-extracted.
- `PageSync.update` must whitelist-filter fields to match `PageUpdate` Pydantic model — don't send raw objects with Date instances or unknown fields.
- Audio data stored in `data/{pageId}/` directory (chunks in `chunks/` subdirectory).
- SQLite DB at `backend/data/meeting.db`.
- Environment config via `.env` file (notably `GEMINI_API_KEY`, `ASR_ENGINE`).
- Python dependency management uses **uv** (not pip). `pyproject.toml` + `uv.lock`.

## Deployment

Caddy reverse proxy on :8443 handles HTTPS, routes `/api/*` and `/ws/*` to backend :6543, serves frontend static files from `frontend/dist/`. SSL certs expected at `.ssl/cert.pem` and `.ssl/key.pem`.
