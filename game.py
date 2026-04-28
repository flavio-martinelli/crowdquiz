"""Game state machine for the party quiz system."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from enum import Enum


class GamePhase(str, Enum):
    LOBBY = "lobby"
    SHOWING_QUESTION = "question"
    SHOWING_RESULTS = "results"
    SHOWING_SCOREBOARD = "scoreboard"
    FINISHED = "finished"


@dataclass
class Question:
    text: str
    options: list[str]
    type: str  # "quiz" or "poll"
    correct: int | None = None
    time_limit: int = 20

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "options": self.options,
            "type": self.type,
            "time_limit": self.time_limit,
        }


@dataclass
class Player:
    sid: str
    name: str
    emoji: str
    score: int = 0
    current_answer: int | None = None

    def to_dict(self) -> dict:
        return {"name": self.name, "emoji": self.emoji, "score": self.score}


class Game:
    def __init__(self) -> None:
        self.phase: GamePhase = GamePhase.LOBBY
        self.players: dict[str, Player] = {}  # sid -> Player
        self.disconnected: dict[str, Player] = {}  # name_lower -> Player (for rejoin)
        self.questions: list[Question] = []
        self.current_question_index: int = 0
        self.question_start_time: float | None = None
        self.host_sid: str | None = None
        self.title: str = "Quiz"
        self.current_quiz_file: str = ""
        self.paused: bool = False
        self.pause_remaining: int | None = None  # seconds left when paused

    def load_questions(self, path: str) -> None:
        with open(path) as f:
            data = json.load(f)
        self.current_quiz_file = path
        self.title = data.get("title", "Quiz")
        self.questions = [
            Question(
                text=q["text"],
                options=q["options"],
                type=q["type"],
                correct=q.get("correct"),
                time_limit=q.get("time_limit", 20),
            )
            for q in data["questions"]
        ]

    def add_player(self, sid: str, name: str, emoji: str) -> tuple[bool, str, bool]:
        """Add a player. Returns (success, error_message, is_rejoin).
        Allows joining during any phase (late join / rejoin)."""
        if self.phase == GamePhase.FINISHED:
            return False, "Game is over", False
        name_stripped = name.strip()[:16]
        if not name_stripped:
            return False, "Name cannot be empty", False
        name_lower = name_stripped.lower()

        # Check if this is a rejoin (disconnected player coming back)
        if name_lower in self.disconnected:
            old = self.disconnected.pop(name_lower)
            player = Player(sid=sid, name=old.name, emoji=old.emoji,
                            score=old.score, current_answer=old.current_answer)
            self.players[sid] = player
            return True, "", True

        # Check name not taken by active player
        for p in self.players.values():
            if p.name.lower() == name_lower:
                return False, "Name already taken", False

        self.players[sid] = Player(sid=sid, name=name_stripped, emoji=emoji)
        return True, "", False

    def remove_player(self, sid: str) -> None:
        """Remove player from active list, keep in disconnected for rejoin."""
        player = self.players.pop(sid, None)
        if player and self.phase != GamePhase.LOBBY:
            # Preserve for rejoin during an active game
            self.disconnected[player.name.lower()] = player

    def get_player_list(self) -> list[dict]:
        return [{"name": p.name, "emoji": p.emoji} for p in self.players.values()]

    def start_game(self) -> bool:
        if self.phase != GamePhase.LOBBY or not self.players:
            return False
        self.current_question_index = 0
        self.phase = GamePhase.SHOWING_QUESTION
        self._reset_answers()
        self.question_start_time = time.time()
        return True

    def get_current_question(self) -> Question | None:
        if 0 <= self.current_question_index < len(self.questions):
            return self.questions[self.current_question_index]
        return None

    def get_question_payload(self) -> dict:
        q = self.get_current_question()
        if q is None:
            return {}
        return {
            "index": self.current_question_index,
            "total": len(self.questions),
            "text": q.text,
            "options": q.options,
            "type": q.type,
            "time_limit": q.time_limit,
        }

    def submit_answer(self, sid: str, answer_index: int) -> bool:
        """Record a player's answer. Returns True if accepted."""
        if self.phase != GamePhase.SHOWING_QUESTION:
            return False
        player = self.players.get(sid)
        if player is None:
            return False
        if player.current_answer is not None:
            return False  # already answered
        q = self.get_current_question()
        if q is None:
            return False
        if answer_index < 0 or answer_index >= len(q.options):
            return False
        player.current_answer = answer_index
        return True

    def get_answer_count(self) -> tuple[int, int]:
        """Returns (answered_count, total_players)."""
        answered = sum(1 for p in self.players.values() if p.current_answer is not None)
        return answered, len(self.players)

    def all_answered(self) -> bool:
        return all(p.current_answer is not None for p in self.players.values()) and len(self.players) > 0

    def close_question(self) -> dict:
        """Close the current question, calculate scores, return results payload."""
        q = self.get_current_question()
        if q is None:
            return {}

        # Calculate distribution
        distribution = [0] * len(q.options)
        for p in self.players.values():
            if p.current_answer is not None:
                distribution[p.current_answer] += 1

        # Score quiz questions (+1 for correct, 0 for wrong)
        deltas: dict[str, int] = {}
        if q.type == "quiz" and q.correct is not None:
            for p in self.players.values():
                if p.current_answer == q.correct:
                    p.score += 1
                    deltas[p.sid] = 1
                else:
                    deltas[p.sid] = 0
        else:
            for p in self.players.values():
                deltas[p.sid] = 0

        self.phase = GamePhase.SHOWING_RESULTS

        result = {
            "type": q.type,
            "distribution": distribution,
            "options": q.options,
            "text": q.text,
        }
        if q.type == "quiz" and q.correct is not None:
            result["correct"] = q.correct

        return result

    def get_scoreboard(self) -> dict:
        """Get scoreboard sorted by score descending, then by name."""
        sorted_players = sorted(
            self.players.values(), key=lambda p: (-p.score, p.name)
        )
        scores = []
        for rank, p in enumerate(sorted_players, 1):
            scores.append({
                "name": p.name,
                "emoji": p.emoji,
                "score": p.score,
                "rank": rank,
            })
        return {
            "scores": scores,
            "question_index": self.current_question_index,
            "total": len(self.questions),
        }

    def advance(self) -> str:
        """Advance to the next phase. Returns the new phase name."""
        if self.phase == GamePhase.SHOWING_RESULTS:
            q = self.get_current_question()
            if q and q.type == "quiz":
                self.phase = GamePhase.SHOWING_SCOREBOARD
                return GamePhase.SHOWING_SCOREBOARD
            else:
                # Polls skip scoreboard, go directly to next question
                return self._next_question()

        if self.phase == GamePhase.SHOWING_SCOREBOARD:
            return self._next_question()

        return self.phase

    def _next_question(self) -> str:
        self.current_question_index += 1
        if self.current_question_index >= len(self.questions):
            self.phase = GamePhase.FINISHED
            return GamePhase.FINISHED
        self.phase = GamePhase.SHOWING_QUESTION
        self._reset_answers()
        self.question_start_time = time.time()
        return GamePhase.SHOWING_QUESTION

    def _reset_answers(self) -> None:
        for p in self.players.values():
            p.current_answer = None
        self.paused = False
        self.pause_remaining = None

    def get_player_result(self, sid: str) -> dict:
        """Get result feedback for a specific player."""
        q = self.get_current_question()
        player = self.players.get(sid)
        if q is None or player is None:
            return {}
        if q.type == "quiz" and q.correct is not None:
            is_correct = player.current_answer == q.correct
            return {
                "type": "quiz",
                "correct": is_correct,
                "your_answer": player.current_answer,
                "correct_answer": q.correct,
            }
        return {"type": "poll"}

    def get_final_results(self) -> dict:
        """Get final podium/rankings."""
        sorted_players = sorted(
            self.players.values(), key=lambda p: (-p.score, p.name)
        )
        podium = []
        for rank, p in enumerate(sorted_players, 1):
            podium.append({
                "name": p.name,
                "emoji": p.emoji,
                "score": p.score,
                "rank": rank,
            })
        return {"podium": podium, "title": self.title}

    def get_state_for_reconnect(self) -> dict:
        """Get full game state for host reconnection."""
        return {
            "phase": self.phase,
            "question": self.get_question_payload() if self.phase == GamePhase.SHOWING_QUESTION else None,
            "scoreboard": self.get_scoreboard() if self.phase in (GamePhase.SHOWING_SCOREBOARD, GamePhase.FINISHED) else None,
            "players": self.get_player_list(),
            "player_count": len(self.players),
            "title": self.title,
        }
