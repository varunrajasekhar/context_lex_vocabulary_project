# ContextLex v0.1 — Vocabulary Learning Demo

A responsive vocabulary-learning demo built with **React + TypeScript**, **Python FastAPI**, and **MongoDB**.

## What works
- Dashboard showing daily goal, streak, and vocabulary statistics.
- Choose A1, A2, or B1 and a daily target of 3, 5, 10, or 15 words.
- Stable daily word assignments saved in MongoDB; repeated words are used after the available fresh words run out.
- Reveal a definition and workplace/everyday usage example; mark each word Got it or Need practice.
- Search a curated, seeded 45-word vocabulary dataset.
- Review recently studied words.
- Daily in-app reminder when the web app is open; dismissal saved in MongoDB.
- Responsive interface for mobile browsers, with one common FastAPI REST API.

**Important:** This is an intentionally unauthenticated **single shared demo profile**. All visitors share progress and settings. Do not deploy publicly as a multi-user production app. Account registration and isolation are planned for the next milestone. There are no system push notifications when the browser is closed.

## Prerequisites
- Node.js 20.19+ or 22.12+ for Vite 6 (Node 22 LTS recommended).
- Python 3.12+ (3.12 is a comfortable starting point).
- MongoDB running locally on 127.0.0.1:27017, or a reachable MongoDB Atlas connection string.

## Run the backend
From the repository root:

1. Copy .env.example to .env (optional when running local MongoDB defaults).
2. Start MongoDB locally, or configure MONGODB_URI.
3. Run these commands:

    cd services/api
    python3.12 -m venv .venv
    source .venv/bin/activate
    python -m pip install -r requirements.txt
    uvicorn app.main:app --reload

FastAPI: http://127.0.0.1:8000/docs

The backend seeds the 45 sample words on startup without replacing existing vocabulary edits. Environment variables are read from the process; for .env files you can export their values in the shell before launching the server.

## Run the frontend
Open a second terminal in the repository root:

    cd apps/web
    npm install
    npm run dev

Open http://127.0.0.1:5173. Vite proxies /api requests to FastAPI on port 8000.

## Run tests and build
From services/api with the virtual environment activated:

    python -m pytest -q

From apps/web:

    npm run build

## API
- GET /api/v1/health
- GET/PATCH /api/v1/preferences
- GET /api/v1/words?q=...
- GET /api/v1/learning/today
- PUT /api/v1/learning/words/{word_id}/status
- GET /api/v1/progress/summary
- GET /api/v1/progress/words
- GET /api/v1/reminders/due
- POST /api/v1/reminders/ack

## Data model
MongoDB collections: words, preferences, plans, progress. Dates follow the configured user timezone (UTC initially; the web UI can set your browser timezone in Settings). The saved daily plan remains unchanged if preferences change later that day.

## Next iteration
Proper login and separate user data, richer vocabulary content, revision scheduling, then browser/mobile push. AI and MCP are intentionally excluded from this release.
