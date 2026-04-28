const COLORS = [
    '#e21b3c', '#1368ce', '#d89e00', '#26890c',
    '#b620e0', '#0aa3cf', '#ff6b35', '#e84393'
];

const EMOJIS = [
    '🦊', '🐻', '🐼', '🐨', '🦁', '🐸', '🐧', '🦄',
    '🐶', '🐱', '🐭', '🐹', '🐰', '🐔', '🦀', '🐙',
    '🍕', '🍔', '🌮', '🍩', '🍦', '🎂', '🍿', '🧀',
    '⚽', '🎿', '🏔️', '🎸', '🚀', '💎', '🔥', '⭐'
];

const socket = io();

let myName = '';
let myEmoji = '';
let joined = false;  // Gate: ignore game events until joined
let selectedEmoji = null;
let currentTimeLimit = 20;
let currentQuestionType = 'quiz';
let pollSelection = null;

// --- DOM refs ---
const views = {
    join: document.getElementById('view-join'),
    waiting: document.getElementById('view-waiting'),
    answering: document.getElementById('view-answering'),
    answered: document.getElementById('view-answered'),
    result: document.getElementById('view-result'),
    scoreboard: document.getElementById('view-scoreboard'),
    gameover: document.getElementById('view-gameover'),
};

function showView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[name].classList.add('active');
}

// --- Join View ---
const nameInput = document.getElementById('name-input');
const emojiGrid = document.getElementById('emoji-grid');
const btnJoin = document.getElementById('btn-join');
const joinError = document.getElementById('join-error');

// Render emoji grid
EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = emoji;
    btn.type = 'button';
    btn.addEventListener('click', () => {
        document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedEmoji = emoji;
        updateJoinButton();
    });
    emojiGrid.appendChild(btn);
});

// Select a random default emoji
const randomIdx = Math.floor(Math.random() * EMOJIS.length);
emojiGrid.children[randomIdx].classList.add('selected');
selectedEmoji = EMOJIS[randomIdx];

nameInput.addEventListener('input', updateJoinButton);
nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnJoin.disabled) {
        btnJoin.click();
    }
});

function updateJoinButton() {
    btnJoin.disabled = !nameInput.value.trim() || !selectedEmoji;
}
updateJoinButton();

btnJoin.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name || !selectedEmoji) return;
    btnJoin.disabled = true;
    joinError.classList.add('hidden');
    socket.emit('player:join', { name, emoji: selectedEmoji });
});

// --- Auto-rejoin on page load / reconnect ---
function tryAutoRejoin() {
    const saved = localStorage.getItem('quizPlayer');
    if (saved) {
        try {
            const { name, emoji } = JSON.parse(saved);
            if (name) {
                showView('waiting');
                document.getElementById('my-emoji').textContent = emoji;
                document.getElementById('my-name').textContent = name;
                document.querySelector('#view-waiting .waiting-text').textContent = 'Reconnecting...';
                socket.emit('player:join', { name, emoji });
                return;
            }
        } catch (e) {}
    }
}

// --- Answering View ---
const playerTimerFill = document.getElementById('player-timer-fill');
const playerQCounter = document.getElementById('player-q-counter');
const playerQType = document.getElementById('player-q-type');
const playerQText = document.getElementById('player-q-text');
const playerOptions = document.getElementById('player-options');

function renderPlayerQuestion(data) {
    if (!joined) return;  // Don't show questions until joined
    showView('answering');
    playerQCounter.textContent = `${data.index + 1} / ${data.total}`;
    playerQType.textContent = data.type;
    playerQType.className = 'q-type-badge ' + data.type;
    playerQText.textContent = data.text;
    currentTimeLimit = data.time_limit;
    currentQuestionType = data.type;
    pollSelection = null;

    // Reset timer (use remaining time if rejoining mid-question)
    var startPct = 100;
    if (data.remaining !== undefined) {
        startPct = (data.remaining / data.time_limit) * 100;
    }
    playerTimerFill.style.transition = 'none';
    playerTimerFill.style.width = startPct + '%';
    playerTimerFill.classList.remove('urgent');
    if (data.remaining !== undefined && data.remaining <= 5) {
        playerTimerFill.classList.add('urgent');
    }
    void playerTimerFill.offsetWidth;

    playerOptions.innerHTML = '';

    if (data.type === 'quiz') {
        const count = data.options.length;
        playerOptions.className = `player-options grid-${count}`;
        data.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.type = 'button';
            btn.style.backgroundColor = COLORS[i % COLORS.length];
            btn.textContent = opt;
            btn.addEventListener('click', () => submitQuizAnswer(i));
            playerOptions.appendChild(btn);
        });
    } else {
        // Poll: scrollable list with confirm
        playerOptions.className = 'player-options poll-list';
        data.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'poll-answer-btn';
            btn.type = 'button';
            btn.innerHTML = `<span class="poll-check"></span><span>${escapeHtml(opt)}</span>`;
            btn.addEventListener('click', () => selectPollOption(i));
            playerOptions.appendChild(btn);
        });
        // Confirm button at the bottom
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'poll-confirm-btn';
        confirmBtn.type = 'button';
        confirmBtn.textContent = 'CONFIRM VOTE';
        confirmBtn.disabled = true;
        confirmBtn.id = 'poll-confirm';
        confirmBtn.addEventListener('click', () => {
            if (pollSelection !== null) {
                submitAnswer(pollSelection);
            }
        });
        playerOptions.appendChild(confirmBtn);
    }
}

function selectPollOption(index) {
    pollSelection = index;
    const btns = playerOptions.querySelectorAll('.poll-answer-btn');
    btns.forEach((btn, i) => {
        btn.classList.toggle('selected', i === index);
        btn.querySelector('.poll-check').textContent = i === index ? '✓' : '';
    });
    const confirmBtn = document.getElementById('poll-confirm');
    if (confirmBtn) confirmBtn.disabled = false;
}

function submitQuizAnswer(index) {
    // Immediately show selection and submit
    const btns = playerOptions.querySelectorAll('.answer-btn');
    btns.forEach((btn, i) => {
        btn.classList.toggle('selected', i === index);
        btn.classList.toggle('not-selected', i !== index);
    });
    submitAnswer(index);
}

function submitAnswer(index) {
    socket.emit('player:answer', { answer: index });
}

// --- Socket events ---

socket.on('connect', () => {
    // On every connect/reconnect, try to auto-rejoin
    if (!joined) {
        tryAutoRejoin();
    } else {
        // Already joined but socket reconnected (e.g., network blip)
        // Re-register with server
        socket.emit('player:join', { name: myName, emoji: myEmoji });
    }
});

socket.on('game:joined', (data) => {
    if (data.success) {
        myName = data.name;
        myEmoji = data.emoji;
        joined = true;
        // Save for auto-rejoin
        localStorage.setItem('quizPlayer', JSON.stringify({ name: myName, emoji: myEmoji }));
        document.getElementById('my-emoji').textContent = myEmoji;
        document.getElementById('my-name').textContent = myName;
        document.querySelector('#view-waiting .waiting-text').textContent = 'Waiting for host to start...';
        showView('waiting');
    } else {
        // If auto-rejoin failed (e.g., game was reset), show join form
        joined = false;
        localStorage.removeItem('quizPlayer');
        showView('join');
        if (data.error && data.error !== 'Name already taken') {
            joinError.textContent = data.error;
            joinError.classList.remove('hidden');
        }
        btnJoin.disabled = false;
    }
});

socket.on('game:question', renderPlayerQuestion);

socket.on('game:tick', (data) => {
    if (!joined) return;
    const pct = (data.remaining / currentTimeLimit) * 100;
    playerTimerFill.style.transition = 'width 1s linear';
    playerTimerFill.style.width = pct + '%';
    if (data.remaining <= 5) {
        playerTimerFill.classList.add('urgent');
    }
});

socket.on('game:answer_ack', () => {
    if (!joined) return;
    showView('answered');
});

socket.on('game:player_result', (data) => {
    if (!joined) return;
    showView('result');
    const icon = document.getElementById('result-icon');
    const text = document.getElementById('result-text');

    if (data.type === 'quiz') {
        if (data.correct) {
            icon.textContent = '✅';
            text.textContent = 'Correct! +1 point';
            text.style.color = 'var(--correct-green)';
        } else {
            icon.textContent = '❌';
            text.textContent = 'Wrong!';
            text.style.color = '#ff6b6b';
        }
    } else {
        icon.textContent = '📊';
        text.textContent = 'Thanks for voting!';
        text.style.color = 'var(--white)';
    }
});

socket.on('game:results', () => {
    if (!joined) return;
    // If we haven't received a player_result yet (e.g., didn't answer),
    // show a generic result
    if (views.answering.classList.contains('active')) {
        showView('result');
        document.getElementById('result-icon').textContent = '⏰';
        document.getElementById('result-text').textContent = "Time's up!";
        document.getElementById('result-text').style.color = 'var(--text-muted)';
    }
});

socket.on('game:scoreboard', (data) => {
    if (!joined) return;
    showView('scoreboard');
    var container = document.getElementById('player-scoreboard');
    container.innerHTML = '';

    var scores = data.scores || [];
    // Find my index
    var myIdx = scores.findIndex(function(s) { return s.name === myName; });

    if (myIdx === -1) {
        // Not found, just show top 3
        scores.slice(0, 3).forEach(function(entry) {
            container.appendChild(makeScoreRow(entry, false));
        });
        return;
    }

    var me = scores[myIdx];

    // Determine which rows to show: person above, me, person below
    // But also always show #1 if I'm not near the top
    var rowIndices = [];

    // Always show #1
    if (myIdx > 1) {
        rowIndices.push(0);
    }
    // Show ellipsis placeholder if gap
    if (myIdx > 2) {
        rowIndices.push(-1); // -1 = ellipsis
    }
    // Person above me
    if (myIdx > 0) {
        rowIndices.push(myIdx - 1);
    }
    // Me
    rowIndices.push(myIdx);
    // Person below me
    if (myIdx < scores.length - 1) {
        rowIndices.push(myIdx + 1);
    }

    rowIndices.forEach(function(idx) {
        if (idx === -1) {
            var dots = document.createElement('div');
            dots.className = 'score-ellipsis';
            dots.textContent = '···';
            container.appendChild(dots);
        } else {
            var isMe = idx === myIdx;
            container.appendChild(makeScoreRow(scores[idx], isMe));
        }
    });
});

function makeScoreRow(entry, isMe) {
    var row = document.createElement('div');
    row.className = 'player-score-row' + (isMe ? ' is-me' : '');
    var rankClass = entry.rank <= 3 ? ' rank-' + entry.rank : '';
    row.innerHTML =
        '<span class="ps-rank' + rankClass + '">#' + entry.rank + '</span>' +
        '<span class="ps-emoji">' + entry.emoji + '</span>' +
        '<span class="ps-name">' + escapeHtml(entry.name) + '</span>' +
        '<span class="ps-score">' + entry.score + '</span>';
    return row;
}

socket.on('game:finished', (data) => {
    if (!joined) return;
    showView('gameover');
    // Find our rank
    const me = data.podium.find(p => p.name === myName && p.emoji === myEmoji);
    const finalEmoji = document.getElementById('final-emoji');
    const finalRank = document.getElementById('final-rank');
    const finalScore = document.getElementById('final-score');
    const finalMessage = document.getElementById('final-message');

    if (me) {
        finalEmoji.textContent = myEmoji;
        finalRank.textContent = `#${me.rank} of ${data.podium.length}`;
        finalScore.textContent = `${me.score} point${me.score !== 1 ? 's' : ''}`;
        if (me.rank === 1) finalMessage.textContent = '🏆 You won!';
        else if (me.rank === 2) finalMessage.textContent = '🥈 So close!';
        else if (me.rank === 3) finalMessage.textContent = '🥉 Great job!';
        else if (me.rank <= 5) finalMessage.textContent = 'Nice effort!';
        else finalMessage.textContent = 'Better luck next time!';
    } else {
        finalEmoji.textContent = myEmoji;
        finalRank.textContent = 'Game Over';
        finalScore.textContent = '';
        finalMessage.textContent = 'Thanks for playing!';
    }
});

socket.on('game:reset', () => {
    joined = false;
    localStorage.removeItem('quizPlayer');
    showView('join');
    nameInput.value = '';
    joinError.classList.add('hidden');
    myName = '';
    myEmoji = '';
    updateJoinButton();
});

// --- Util ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
