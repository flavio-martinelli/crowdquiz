# Party Quiz System
 
## Context
 
Build a one-time-use quiz app for a ski retreat party. Host shows questions on a shared screen (TV/laptop), players answer on their phones via a web app. Supports scored multiple-choice questions and non-scored polls. Up to 6 answer options per question. Real-time scoreboard between rounds.
 
## Tech Stack
 
- **Backend**: Python — FastAPI + python-socketio (async) + uvicorn
- **Frontend**: Vanilla HTML/CSS/JS, no build step, Socket.IO client from CDN
- **State**: All in-memory (no database)
- **Deployment**: ngrok tunnel (server on laptop, public URL for phones)
 
## File Structure
 
```
server.py              # FastAPI + Socket.IO server, event handlers, timer
game.py                # Game state machine (Player, Question, Game classes)
questions.json         # Quiz content (edit this to customize)
requirements.txt       # 3 deps: fastapi, uvicorn[standard], python-socketio
static/
  common/style.css     # Shared colors (6-color palette), reset, animations
  host/
    index.html         # Host view (TV screen)
    style.css          # Large fonts, scoreboard layout, timer bar
    app.js             # Host Socket.IO client, view switching, QR code
  player/
    index.html         # Player view (phone)
    style.css          # Mobile-first, 2x3 answer button grid
    app.js             # Player Socket.IO client, join flow, answer submission
```
 
## Game Flow
 
1. Host opens `/host` → lobby with QR code + URL + live player list (name + emoji)
2. Players scan QR on phones → `/` → pick a name + emoji → join lobby
3. Host clicks **Start** → first question appears
4. Per question:
   - Host screen: question text + up to 6 colored option blocks + countdown timer + "X/Y answered"
   - Player phones: up to 6 colored answer buttons in a 2x3 grid
   - Timer runs server-side (authoritative), ticks broadcast every second
   - Auto-reveals when timer expires OR all players answer
5. Results screen: correct answer highlighted (quiz) or vote distribution bar chart (poll)
6. Scoreboard (quiz only): players ranked by total score, emoji + name displayed
7. After last question → final podium (1st/2nd/3rd) with confetti
 
## Data Models (`game.py`)
 
- **`GamePhase`** enum: `LOBBY → SHOWING_QUESTION → SHOWING_RESULTS → SHOWING_SCOREBOARD → FINISHED`
- **`Question`**: `text, options[] (2-6 items), type("quiz"|"poll"), correct(int|None), time_limit(default=20)`
- **`Player`**: `sid, name, emoji, score, current_answer`
- **`Game`** class: holds all state, exposes methods like `add_player()`, `submit_answer()`, `close_question()`, `advance()`, `get_scoreboard()`
 
## Scoring — Simple +1 / 0
 
- **Quiz questions**: correct answer = **+1 point**, wrong or no answer = **0 points**. No speed bonus.
- **Polls**: no scoring at all, just show vote distribution.
- Timer still exists to keep the game moving, but answering speed has no effect on score.
 
## 6-Color Palette for Answer Options
 
```css
--color-1: #e21b3c;   /* Red */
--color-2: #1368ce;   /* Blue */
--color-3: #d89e00;   /* Gold */
--color-4: #26890c;   /* Green */
--color-5: #b620e0;   /* Purple */
--color-6: #0aa3cf;   /* Cyan */
```
 
Questions with 2-4 options use the first N colors. Questions with 5-6 use all.
 
## Player Join: Name + Emoji
 
On the join screen, players:
1. Type a name (max 16 chars)
2. Pick an emoji from a grid of ~30 options (animals, food, sports, objects — fun party vibes)
3. Their identity throughout the game is **emoji + name** (e.g., "🦊 Alice")
 
The emoji grid is hardcoded in the player HTML — no server-side logic needed. The chosen emoji is sent with the join event.
 
## Socket.IO Events
 
| Event | Direction | Payload |
|---|---|---|
| `player:join` | Player→Server | `{name, emoji}` |
| `game:joined` | Server→Player | `{success, name, emoji, error?}` |
| `lobby:update` | Server→All | `{players: [{name, emoji}], count}` |
| `host:start` | Host→Server | `{}` |
| `game:question` | Server→All | `{index, total, text, options[], type, time_limit}` |
| `game:tick` | Server→All | `{remaining}` |
| `player:answer` | Player→Server | `{answer}` (0-based index) |
| `game:answer_ack` | Server→Player | `{received: true}` |
| `game:answer_count` | Server→Host | `{answered, total}` |
| `host:next` | Host→Server | `{}` (advance to next phase) |
| `game:results` | Server→All | `{type, correct?, distribution[], options[]}` |
| `game:scoreboard` | Server→All | `{scores: [{name, emoji, score, rank, delta}]}` |
| `game:finished` | Server→All | `{podium: [{name, emoji, score, rank}]}` |
 
## HTTP Routes (`server.py`)
 
| Route | Response |
|---|---|
| `GET /` | Redirect → `/player/` |
| `GET /player/` | Serve player HTML |
| `GET /host` | Serve host HTML |
| `GET /api/info` | `{local_ip, port}` for fallback LAN access |
| `/static/...` | Static files mount |
 
Server entry: `uvicorn server:asgi_app --host 0.0.0.0 --port 8000`
 
## `questions.json` Format
 
```json
{
  "title": "Ski Retreat 2026 Quiz",
  "questions": [
    {
      "type": "quiz",
      "text": "What year was the first lab ski retreat?",
      "options": ["2020", "2021", "2022", "2023", "2024", "2025"],
      "correct": 3,
      "time_limit": 20
    },
    {
      "type": "poll",
      "text": "What's your favorite run difficulty?",
      "options": ["Green", "Blue", "Red", "Black"],
      "time_limit": 15
    }
  ]
}
```
 
Options array supports 2 to 6 items.
 
## Implementation Order
 
### Phase 1: Backend
1. `requirements.txt` — 3 dependencies
2. `questions.json` — 5-8 sample questions (ski retreat themed, mix of quiz + poll, varying option counts)
3. `game.py` — Game state machine, pure Python, all logic
4. `server.py` — FastAPI + Socket.IO wiring, event handlers, timer task
 
### Phase 2: Host Frontend
5. `static/common/style.css` — 6-color palette, reset, shared animations
6. `static/host/index.html` — sections for each phase, QR lib from CDN
7. `static/host/style.css` — large-screen layout, 2x3 option grid, scoreboard
8. `static/host/app.js` — Socket.IO client, view state machine, QR generation
 
### Phase 3: Player Frontend
9. `static/player/index.html` — name + emoji join form, 2x3 answer grid, result feedback
10. `static/player/style.css` — mobile-first, large touch targets, no scroll
11. `static/player/app.js` — Socket.IO client, join + answer flows
 
### Phase 4: Polish
12. Animations (CSS-only): timer bar, score transitions, confetti, slide-ins
13. Edge cases: late join message, host reconnect, XSS sanitization (`textContent` not `innerHTML`)
 
## Deployment — ngrok (Recommended)
 
### What ngrok does
ngrok creates a **tunnel** from a public URL to your laptop. You run the quiz server locally, and ngrok gives you a URL like `https://abc123.ngrok-free.app` that anyone on the internet can reach — it forwards their requests to your laptop through the tunnel.
 
### Setup (one-time, ~2 minutes)
```bash
# Install ngrok
brew install ngrok    # or download from ngrok.com
 
# Create a free account at ngrok.com, then:
ngrok config add-authtoken YOUR_TOKEN_HERE
```
 
### On game day
```bash
# Terminal 1: start the quiz server
pip install -r requirements.txt
uvicorn server:asgi_app --host 0.0.0.0 --port 8000
 
# Terminal 2: expose it publicly
ngrok http 8000
# → outputs something like: https://abc123.ngrok-free.app
```
 
The host view at `/host` will:
- Auto-detect the ngrok URL (or you paste it in)
- Generate a QR code with that URL
- Also show the LAN IP (`http://192.168.x.x:8000`) as fallback
 
Players scan the QR code → land on the join page → done.
 
### Why ngrok over cloud hosting
- **Zero deployment config** — no GitHub push, no build pipeline, no cloud account needed
- **Server is your laptop** — you're in full control, can restart instantly
- **Works offline-ish** — if everyone is on the same WiFi, you can skip ngrok entirely and use the LAN IP
- **Free tier is enough** — the only downside is a one-time interstitial page ("Visit Site") that players click through once
 
### Alternative: Render (if you want a clean URL)
Push to GitHub → connect to render.com → set start command `uvicorn server:asgi_app --host 0.0.0.0 --port $PORT` → get a URL like `quiz.onrender.com`. Free tier spins down after 15 min idle (wake it up before the party).
 
## Key Design Decisions
 
- **Simple scoring (+1/0)** — party-friendly, no one feels rushed
- **Emoji identity** — more visual and fun than just names on the scoreboard
- **Up to 6 options** — 2x3 grid layout on both host and player screens
- **Timer is server-authoritative** — prevents clock manipulation
- **QR code generated client-side** using `qrcode.js` from CDN
- **Host reconnect**: game state lives in server memory; reopening `/host` sends current state
- **No database**: single `Game` instance in memory
- **Mobile viewport lock**: `overflow: hidden; position: fixed` to prevent pull-to-refresh
 
## Verification
 
1. Open `/host` in browser + 3 incognito tabs at `/` as players
2. Join with different names + emojis → verify lobby shows emoji + name
3. Start game → verify question + answer buttons appear (test with 4 and 6 options)
4. Answer correctly on one, wrong on others → verify +1/0 scoring
5. Test a poll question → verify distribution shown, no scoring
6. Complete full game → verify final podium with emojis
7. Test on actual phone via ngrok → verify mobile layout + touch targets + emoji picker
