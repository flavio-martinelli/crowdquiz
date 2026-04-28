# Online Party Quiz

A real-time, browser-based quiz and poll system for groups. One person runs the game as the **host** on a laptop or TV; everyone else joins from their phones by scanning a QR code or visiting a URL. No accounts, no installs — just open a browser.

**Features**
- Two question types: **Quiz** (scored, correct answer revealed) and **Poll** (unscored, just shows the vote distribution)
- Live timer with pause/resume controls
- Scoreboard after every quiz question
- Final podium with confetti
- Players can rejoin mid-game if they disconnect
- Multiple quiz files — switch between them from the lobby

---

## Quick start (local network)

**Requirements:** Python 3.11+

```bash
# 1. Clone the repo and enter it
git clone git@github.com:flavio-martinelli/crowdquiz.git
cd crowdquiz

# 2. Create a virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Start the server
uvicorn server:asgi_app --host 0.0.0.0 --port 8000
```

Open **`http://localhost:8000/host`** on the machine running the server — this is the host view you project on a screen.

Players on the same Wi-Fi network open **`http://<your-local-ip>:8000`** (the IP is shown on the host screen as a QR code and a URL).

---

## Making it public with Cloudflare Tunnel

> **This is the key step.** The server runs on your laptop — Cloudflare Tunnel gives it a public URL so players anywhere can join from their phones. No account needed, no configuration, takes 30 seconds.

### 1. Install cloudflared

```bash
# macOS (Homebrew)
brew install cloudflared

# Windows / Linux: download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### 2. Start the quiz server

```bash
uvicorn server:asgi_app --host 0.0.0.0 --port 8000
```

### 3. Open a tunnel in a second terminal

```bash
cloudflared tunnel --url http://localhost:8000
```

After a few seconds it prints a randomly generated public URL:

```
https://random-words-here.trycloudflare.com
```

### 4. Tell the host view about the tunnel URL

The QR code on the host screen defaults to your local IP. Paste the Cloudflare URL into the **"Paste tunnel URL here…"** field at the top of the lobby and press **Set**. The QR code and join link update instantly — players anywhere in the world can now scan in.

Keep the `cloudflared` terminal open for the duration of the game. The URL is temporary and changes every time you run the command.

---

## How to play

| Who | URL | Purpose |
|-----|-----|---------|
| Host | `/host` | Controls the game, displayed on a shared screen |
| Players | `/` (root) | Join screen, shown on each player's phone |

**Host flow:**
1. Pick a quiz from the lobby.
2. Wait for players to join (they scan the QR code).
3. Press **START**.
4. After each question the host clicks **NEXT** to move through results → scoreboard → next question.
5. Use **PAUSE** to freeze the timer, **STOP QUIZ** to reset to the lobby at any time.

**Player flow:**
1. Scan the QR code or open the URL.
2. Enter a name and pick an emoji.
3. Tap an answer before time runs out.
4. See if you were right and watch the scoreboard.

---

## Creating a new quiz file

Quiz files live in the `quizzes/` directory as plain JSON. Add a new `.json` file there and it appears automatically in the host lobby picker.

### File structure

```json
{
  "title": "My Quiz",
  "description": "A short description shown in the lobby",
  "questions": []
}
```

### Quiz question (scored)

```json
{
  "type": "quiz",
  "text": "What is the capital of France?",
  "options": ["Berlin", "Madrid", "Paris", "Rome"],
  "correct": 2,
  "time_limit": 20
}
```

- `correct` is the **0-based index** of the right answer (`2` → "Paris").
- `time_limit` is in seconds (default: 20).

### Poll question (unscored)

```json
{
  "type": "poll",
  "text": "What was the highlight of the trip?",
  "options": ["The food", "The hike", "The games night", "The weather"],
  "time_limit": 30
}
```

- No `correct` field — everyone votes and the distribution is shown.
- Polls skip the scoreboard, going straight to the next question.

### Full example

```json
{
  "title": "🎉 Office Trivia",
  "description": "How well do you know the team?",
  "questions": [
    {
      "type": "quiz",
      "text": "In what year was the company founded?",
      "options": ["2018", "2019", "2020", "2021"],
      "correct": 1,
      "time_limit": 15
    },
    {
      "type": "poll",
      "text": "Best team lunch spot?",
      "options": ["Pizza place", "Sushi bar", "Burger joint", "Thai restaurant"],
      "time_limit": 30
    }
  ]
}
```

Save the file as `quizzes/office-trivia.json`, restart the server (or just reload the host page), and it will appear in the quiz picker.

---

## Project structure

```
online_party_quiz/
├── server.py          # FastAPI + Socket.IO server, HTTP routes, event handlers
├── game.py            # Game state machine (phases, scoring, player management)
├── requirements.txt   # Python dependencies
├── quizzes/           # Quiz JSON files — add yours here
│   ├── demo.json
│   └── ...
└── static/
    ├── host/          # Host UI (HTML, CSS, JS)
    ├── player/        # Player UI
    └── common/        # Shared styles
```
