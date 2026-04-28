const COLORS = [
    '#e21b3c', '#1368ce', '#d89e00', '#26890c',
    '#b620e0', '#0aa3cf', '#ff6b35', '#e84393'
];

const socket = io();

// --- DOM refs ---
const views = {
    lobby: document.getElementById('view-lobby'),
    question: document.getElementById('view-question'),
    results: document.getElementById('view-results'),
    scoreboard: document.getElementById('view-scoreboard'),
    finished: document.getElementById('view-finished'),
};

function showView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[name].classList.add('active');
    // Show mini QR during game, hide in lobby
    var miniQr = document.getElementById('mini-qr');
    if (name === 'lobby') {
        miniQr.classList.add('hidden');
    } else {
        miniQr.classList.remove('hidden');
    }
}

// --- Lobby ---
const gameTitle = document.getElementById('game-title');
const qrcodeEl = document.getElementById('qrcode');
const joinUrl = document.getElementById('join-url');
const playerCount = document.getElementById('player-count');
const playerList = document.getElementById('player-list');
const btnStart = document.getElementById('btn-start');

let currentJoinUrl = window.location.origin;

function setupLobby(title, quizzes, currentQuiz) {
    gameTitle.textContent = title || 'Quiz';
    // Restore saved tunnel URL if available
    const saved = localStorage.getItem('tunnelUrl');
    if (saved) currentJoinUrl = saved;
    updateQR(currentJoinUrl);
    // Render quiz picker
    if (quizzes && quizzes.length > 0) {
        renderQuizPicker(quizzes, currentQuiz);
    }
}

function renderQuizPicker(quizzes, currentQuiz) {
    var picker = document.getElementById('quiz-picker');
    picker.innerHTML = '';
    quizzes.forEach(function(q) {
        var card = document.createElement('div');
        var isSelected = currentQuiz && currentQuiz.endsWith(q.file);
        card.className = 'quiz-card' + (isSelected ? ' selected' : '');
        card.innerHTML =
            '<span class="quiz-card-title">' + escapeHtml(q.title) + '</span>' +
            '<span class="quiz-card-info">' + q.question_count + ' questions</span>';
        card.addEventListener('click', function() {
            socket.emit('host:select_quiz', { file: q.file });
        });
        picker.appendChild(card);
    });
}

function updateQR(url) {
    // Strip trailing slash
    url = url.replace(/\/+$/, '');
    currentJoinUrl = url;
    joinUrl.textContent = url;
    // Big QR for lobby
    qrcodeEl.innerHTML = '';
    new QRCode(qrcodeEl, { text: url, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
    // Mini QR for in-game
    var miniQrCode = document.getElementById('mini-qrcode');
    miniQrCode.innerHTML = '';
    new QRCode(miniQrCode, { text: url, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
}

// URL override for tunnel (called via inline onclick)
function setTunnelUrl() {
    var input = document.getElementById('url-input');
    var val = input.value.trim();
    if (val) {
        updateQR(val);
        localStorage.setItem('tunnelUrl', val);
        input.value = '';
        input.placeholder = 'Updated!';
        setTimeout(function() { input.placeholder = 'Paste tunnel URL here...'; }, 2000);
    }
}

// Pause / resume timer
function togglePause() {
    socket.emit('host:pause');
}

// Stop quiz — reset back to lobby
function stopQuiz() {
    if (confirm('Stop the quiz and return to lobby?')) {
        socket.emit('host:reset');
    }
}

btnStart.addEventListener('click', () => {
    socket.emit('host:start');
    btnStart.disabled = true;
});

// --- Question ---
const timerFill = document.getElementById('timer-fill');
const qCounter = document.getElementById('q-counter');
const qTypeBadge = document.getElementById('q-type-badge');
const answerCounter = document.getElementById('answer-counter');
const qText = document.getElementById('q-text');
const optionsContainer = document.getElementById('options-container');

let currentTimeLimit = 20;

function renderQuestion(data) {
    showView('question');
    // Reset pause button
    var pauseBtn = document.getElementById('btn-pause');
    pauseBtn.textContent = '⏸ PAUSE';
    pauseBtn.classList.remove('paused');

    qCounter.textContent = `${data.index + 1} / ${data.total}`;
    qTypeBadge.textContent = data.type;
    qTypeBadge.className = 'q-type-badge ' + data.type;
    answerCounter.textContent = '';
    qText.textContent = data.text;
    currentTimeLimit = data.time_limit;

    // Reset timer
    timerFill.style.transition = 'none';
    timerFill.style.width = '100%';
    timerFill.classList.remove('urgent');
    void timerFill.offsetWidth; // force reflow

    optionsContainer.innerHTML = '';

    if (data.type === 'quiz') {
        // Colored button grid
        const count = data.options.length;
        optionsContainer.className = `options-container grid-${count}`;
        data.options.forEach((opt, i) => {
            const block = document.createElement('div');
            block.className = 'option-block animate-in';
            block.style.backgroundColor = COLORS[i % COLORS.length];
            block.style.animationDelay = `${i * 0.05}s`;
            block.textContent = opt;
            optionsContainer.appendChild(block);
        });
    } else {
        // Poll: scrollable list
        optionsContainer.className = 'options-container poll-list';
        data.options.forEach((opt, i) => {
            const row = document.createElement('div');
            row.className = 'poll-option-row animate-in';
            row.style.animationDelay = `${i * 0.03}s`;
            row.innerHTML = `<span class="poll-option-num">${i + 1}.</span> ${escapeHtml(opt)}`;
            optionsContainer.appendChild(row);
        });
    }
}

// --- Results ---
const resultsQuestion = document.getElementById('results-question');
const resultsDisplay = document.getElementById('results-display');
const btnNextResults = document.getElementById('btn-next-results');

btnNextResults.addEventListener('click', () => socket.emit('host:next'));

function renderResults(data) {
    showView('results');
    resultsQuestion.textContent = data.text;
    resultsDisplay.innerHTML = '';

    const total = data.distribution.reduce((a, b) => a + b, 0);

    if (data.type === 'quiz') {
        data.options.forEach((opt, i) => {
            const isCorrect = i === data.correct;
            const el = document.createElement('div');
            el.className = `result-option ${isCorrect ? '' : 'dimmed'} animate-in`;
            el.style.backgroundColor = COLORS[i % COLORS.length];
            el.style.animationDelay = `${i * 0.08}s`;
            el.innerHTML = `
                <span class="result-check">${isCorrect ? '✓' : '✗'}</span>
                <span class="result-text">${escapeHtml(opt)}</span>
                <span class="result-count">${data.distribution[i]}</span>
            `;
            resultsDisplay.appendChild(el);
        });
    } else {
        // Poll: bar chart
        const maxVotes = Math.max(...data.distribution, 1);
        data.options.forEach((opt, i) => {
            const pct = total > 0 ? Math.round(data.distribution[i] / total * 100) : 0;
            const barWidth = Math.max(data.distribution[i] / maxVotes * 100, 0);
            const row = document.createElement('div');
            row.className = 'poll-result-row animate-in';
            row.style.animationDelay = `${i * 0.05}s`;
            row.innerHTML = `
                <span class="poll-result-label">${escapeHtml(opt)}</span>
                <div class="poll-result-bar-bg">
                    <div class="poll-result-bar" style="width: 0%; background: ${COLORS[i % COLORS.length]};">${pct}%</div>
                </div>
                <span class="poll-result-count">${data.distribution[i]}</span>
            `;
            resultsDisplay.appendChild(row);
            // Animate bar width
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    row.querySelector('.poll-result-bar').style.width = barWidth + '%';
                });
            });
        });
    }
}

// --- Scoreboard ---
const scoreboardList = document.getElementById('scoreboard-list');
const btnNextScoreboard = document.getElementById('btn-next-scoreboard');

btnNextScoreboard.addEventListener('click', () => socket.emit('host:next'));

function renderScoreboard(data) {
    showView('scoreboard');
    scoreboardList.innerHTML = '';
    data.scores.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'scoreboard-row';
        row.style.animationDelay = `${i * 0.08}s`;
        const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
        row.innerHTML = `
            <span class="rank ${rankClass}">#${entry.rank}</span>
            <span class="player-emoji">${entry.emoji}</span>
            <span class="player-name">${escapeHtml(entry.name)}</span>
            <span class="player-score">${entry.score}</span>
        `;
        scoreboardList.appendChild(row);
    });
}

// --- Finished ---
const podium = document.getElementById('podium');
const fullRankings = document.getElementById('full-rankings');
const btnPlayAgain = document.getElementById('btn-play-again');

btnPlayAgain.addEventListener('click', () => socket.emit('host:reset'));

function renderFinished(data) {
    showView('finished');
    podium.innerHTML = '';
    fullRankings.innerHTML = '';

    // Show top 3 as podium (order: 2nd, 1st, 3rd)
    const top = data.podium.slice(0, 3);
    const podiumOrder = top.length >= 3 ? [top[1], top[0], top[2]] : top;
    const barClasses = top.length >= 3 ? ['second', 'first', 'third'] : (top.length === 2 ? ['first', 'second'] : ['first']);
    const displayOrder = top.length >= 3 ? podiumOrder : top;

    displayOrder.forEach((entry, i) => {
        const place = document.createElement('div');
        place.className = 'podium-place';
        const barClass = top.length >= 3 ? barClasses[i] : barClasses[i];
        place.innerHTML = `
            <span class="podium-emoji">${entry.emoji}</span>
            <span class="podium-name">${escapeHtml(entry.name)}</span>
            <span class="podium-score">${entry.score} pts</span>
            <div class="podium-bar ${barClass}">#${entry.rank}</div>
        `;
        podium.appendChild(place);
    });

    // Full rankings below podium
    if (data.podium.length > 3) {
        data.podium.slice(3).forEach(entry => {
            const row = document.createElement('div');
            row.className = 'scoreboard-row';
            row.innerHTML = `
                <span class="rank">#${entry.rank}</span>
                <span class="player-emoji">${entry.emoji}</span>
                <span class="player-name">${escapeHtml(entry.name)}</span>
                <span class="player-score">${entry.score}</span>
            `;
            fullRankings.appendChild(row);
        });
    }

    // Confetti
    launchConfetti();
}

function launchConfetti() {
    const container = document.getElementById('confetti');
    container.innerHTML = '';
    const colors = COLORS;
    for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 2 + 's';
        piece.style.animationDuration = (2 + Math.random() * 2) + 's';
        piece.style.width = (6 + Math.random() * 8) + 'px';
        piece.style.height = (6 + Math.random() * 8) + 'px';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        container.appendChild(piece);
    }
}

// --- Socket events ---

socket.on('connect', () => {
    socket.emit('host:connect');
});

socket.on('game:state', (data) => {
    setupLobby(data.title, data.quizzes, data.current_quiz);
    if (data.phase === 'lobby') {
        showView('lobby');
        updatePlayerList(data.players, data.player_count);
    } else if (data.phase === 'question' && data.question) {
        renderQuestion(data.question);
    } else if (data.phase === 'scoreboard' && data.scoreboard) {
        renderScoreboard(data.scoreboard);
    } else if (data.phase === 'finished' && data.scoreboard) {
        renderFinished({ podium: data.scoreboard.scores });
    }
});

socket.on('lobby:update', (data) => {
    updatePlayerList(data.players, data.count);
});

function updatePlayerList(players, count) {
    playerCount.textContent = count;
    playerList.innerHTML = '';
    players.forEach(p => {
        const tag = document.createElement('span');
        tag.className = 'player-tag';
        tag.textContent = `${p.emoji} ${p.name}`;
        playerList.appendChild(tag);
    });
    btnStart.disabled = count === 0;
}

socket.on('game:question', renderQuestion);

socket.on('game:tick', (data) => {
    const pct = (data.remaining / currentTimeLimit) * 100;
    timerFill.style.transition = 'width 1s linear';
    timerFill.style.width = pct + '%';
    if (data.remaining <= 5) {
        timerFill.classList.add('urgent');
    }
});

socket.on('game:answer_count', (data) => {
    answerCounter.textContent = `${data.answered} / ${data.total} answered`;
});

socket.on('game:results', renderResults);
socket.on('game:scoreboard', renderScoreboard);
socket.on('game:finished', renderFinished);

socket.on('game:paused', (data) => {
    var btn = document.getElementById('btn-pause');
    if (data.paused) {
        btn.textContent = '▶ RESUME';
        btn.classList.add('paused');
        timerFill.style.transition = 'none';  // freeze the bar
    } else {
        btn.textContent = '⏸ PAUSE';
        btn.classList.remove('paused');
    }
});

socket.on('game:reset', () => {
    showView('lobby');
    btnStart.disabled = false;
});

// --- Util ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
