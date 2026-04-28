"""FastAPI + Socket.IO server for the party quiz system."""

from __future__ import annotations

import asyncio
import json
import os
import socket
import time

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from game import Game, GamePhase

QUIZZES_DIR = "quizzes"

# --- App setup ---

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = FastAPI()
asgi_app = socketio.ASGIApp(sio, other_asgi_app=app)

game = Game()
game.load_questions(os.path.join(QUIZZES_DIR, "demo.json"))


def list_quizzes() -> list[dict]:
    """Scan the quizzes directory and return metadata for each quiz file."""
    quizzes = []
    for filename in sorted(os.listdir(QUIZZES_DIR)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(QUIZZES_DIR, filename)
        try:
            with open(path) as f:
                data = json.load(f)
            quizzes.append({
                "file": filename,
                "title": data.get("title", filename),
                "description": data.get("description", ""),
                "question_count": len(data.get("questions", [])),
            })
        except Exception:
            pass
    return quizzes

timer_task: asyncio.Task | None = None


# --- Helpers ---

def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "localhost"
    finally:
        s.close()


async def run_timer(question_index: int) -> None:
    """Background task: ticks the timer and auto-closes the question."""
    q = game.get_current_question()
    if q is None:
        return
    remaining = q.time_limit
    while remaining > 0:
        if game.current_question_index != question_index:
            return
        if game.phase != GamePhase.SHOWING_QUESTION:
            return
        # If paused, just wait without ticking
        if game.paused:
            game.pause_remaining = remaining
            await asyncio.sleep(0.2)
            continue
        await sio.emit("game:tick", {"remaining": remaining})
        await asyncio.sleep(1)
        remaining -= 1
    # Time's up
    if game.phase == GamePhase.SHOWING_QUESTION and game.current_question_index == question_index:
        await reveal_results()


async def reveal_results() -> None:
    """Close the current question and broadcast results."""
    global timer_task
    if timer_task and not timer_task.done():
        timer_task.cancel()
        timer_task = None

    results = game.close_question()
    await sio.emit("game:results", results)

    # Send individual player results
    for sid, player in game.players.items():
        player_result = game.get_player_result(sid)
        await sio.emit("game:player_result", player_result, to=sid)


# --- HTTP routes ---

@app.get("/")
async def root():
    return RedirectResponse("/player/")


@app.get("/player/")
async def player_view():
    return FileResponse("static/player/index.html")


@app.get("/host")
async def host_view():
    return FileResponse("static/host/index.html")


@app.get("/api/info")
async def api_info():
    return {"local_ip": get_local_ip(), "port": 8000, "title": game.title}


@app.get("/api/quizzes")
async def api_quizzes():
    return list_quizzes()


app.mount("/static", StaticFiles(directory="static"), name="static")


# --- Socket.IO events ---

@sio.event
async def connect(sid, environ):
    pass


@sio.event
async def disconnect(sid):
    was_player = sid in game.players
    game.remove_player(sid)
    if was_player:
        await sio.emit("lobby:update", {
            "players": game.get_player_list(),
            "count": len(game.players),
        })
        # Check if all remaining players answered
        if game.phase == GamePhase.SHOWING_QUESTION and game.all_answered():
            await reveal_results()


@sio.on("player:join")
async def player_join(sid, data):
    name = data.get("name", "").strip()
    emoji = data.get("emoji", "😀")
    success, error, is_rejoin = game.add_player(sid, name, emoji)

    if success:
        player = game.players[sid]
        await sio.emit("game:joined", {
            "success": True,
            "name": player.name,
            "emoji": player.emoji,
            "rejoin": is_rejoin,
        }, to=sid)
        await sio.emit("lobby:update", {
            "players": game.get_player_list(),
            "count": len(game.players),
        })
        # Late join / rejoin: send current game state so they catch up
        if game.phase == GamePhase.SHOWING_QUESTION:
            payload = game.get_question_payload()
            # Include remaining time so their timer is accurate
            if game.question_start_time:
                q = game.get_current_question()
                elapsed = time.time() - game.question_start_time
                remaining = max(0, int(q.time_limit - elapsed)) if q else 0
                payload["remaining"] = remaining
            await sio.emit("game:question", payload, to=sid)
        elif game.phase == GamePhase.SHOWING_RESULTS:
            # They missed it, just show waiting
            pass
        elif game.phase == GamePhase.SHOWING_SCOREBOARD:
            scoreboard = game.get_scoreboard()
            await sio.emit("game:scoreboard", scoreboard, to=sid)

        # Update host answer count if mid-question
        if game.phase == GamePhase.SHOWING_QUESTION and game.host_sid:
            answered, total = game.get_answer_count()
            await sio.emit("game:answer_count", {"answered": answered, "total": total}, to=game.host_sid)
    else:
        await sio.emit("game:joined", {"success": False, "error": error}, to=sid)


@sio.on("host:connect")
async def host_connect(sid, data=None):
    game.host_sid = sid
    # If game is in progress, send current state for reconnection
    state = game.get_state_for_reconnect()
    state["quizzes"] = list_quizzes()
    state["current_quiz"] = game.current_quiz_file
    await sio.emit("game:state", state, to=sid)


@sio.on("host:select_quiz")
async def host_select_quiz(sid, data):
    if sid != game.host_sid:
        return
    if game.phase != GamePhase.LOBBY:
        return
    filename = data.get("file", "")
    # Sanitize: only allow filenames, no path traversal
    if "/" in filename or "\\" in filename or not filename.endswith(".json"):
        return
    path = os.path.join(QUIZZES_DIR, filename)
    if not os.path.isfile(path):
        return
    game.load_questions(path)
    # Send updated state so lobby shows new title
    state = game.get_state_for_reconnect()
    state["quizzes"] = list_quizzes()
    state["current_quiz"] = game.current_quiz_file
    await sio.emit("game:state", state, to=sid)


@sio.on("host:start")
async def host_start(sid, data=None):
    global timer_task
    if sid != game.host_sid:
        return
    if not game.start_game():
        await sio.emit("game:error", {"message": "Cannot start game"}, to=sid)
        return
    payload = game.get_question_payload()
    await sio.emit("game:question", payload)
    timer_task = asyncio.create_task(run_timer(game.current_question_index))


@sio.on("player:answer")
async def player_answer(sid, data):
    answer_index = data.get("answer")
    if answer_index is None:
        return
    accepted = game.submit_answer(sid, answer_index)
    if accepted:
        await sio.emit("game:answer_ack", {"received": True}, to=sid)
        answered, total = game.get_answer_count()
        if game.host_sid:
            await sio.emit("game:answer_count", {"answered": answered, "total": total}, to=game.host_sid)
        # Auto-reveal if all answered
        if game.all_answered():
            await reveal_results()


@sio.on("host:next")
async def host_next(sid, data=None):
    global timer_task
    if sid != game.host_sid:
        return

    new_phase = game.advance()

    if new_phase == GamePhase.SHOWING_SCOREBOARD:
        scoreboard = game.get_scoreboard()
        await sio.emit("game:scoreboard", scoreboard)

    elif new_phase == GamePhase.SHOWING_QUESTION:
        payload = game.get_question_payload()
        await sio.emit("game:question", payload)
        timer_task = asyncio.create_task(run_timer(game.current_question_index))

    elif new_phase == GamePhase.FINISHED:
        final = game.get_final_results()
        await sio.emit("game:finished", final)


@sio.on("host:pause")
async def host_pause(sid, data=None):
    if sid != game.host_sid:
        return
    if game.phase != GamePhase.SHOWING_QUESTION:
        return
    game.paused = not game.paused
    await sio.emit("game:paused", {"paused": game.paused})


@sio.on("host:reveal")
async def host_reveal(sid, data=None):
    if sid != game.host_sid:
        return
    if game.phase == GamePhase.SHOWING_QUESTION:
        await reveal_results()


@sio.on("host:reset")
async def host_reset(sid, data=None):
    """Reset the game back to lobby."""
    global timer_task, game
    if sid != game.host_sid:
        return
    if timer_task and not timer_task.done():
        timer_task.cancel()
        timer_task = None
    prev_quiz = game.current_quiz_file
    game = Game()
    game.load_questions(prev_quiz)
    game.host_sid = sid
    await sio.emit("game:reset", {})
    state = game.get_state_for_reconnect()
    state["quizzes"] = list_quizzes()
    state["current_quiz"] = game.current_quiz_file
    await sio.emit("game:state", state, to=sid)
