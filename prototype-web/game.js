// RRaM Web Client — тонкий клиент, всё состояние на сервере.
// Движение пока локальное (сервер ждёт карту), кубики/карты/ходы — сервер.

// ── Конфигурация ──────────────────────────────────────────────────
const SERVER_URL = new URLSearchParams(location.search).get('server')
  ?? 'ws://localhost:8787/ws';

const SESSION_KEY = 'rram_session';

// ── Константы ─────────────────────────────────────────────────────
const ROLE_NAMES = { K: 'Кузнец', P: 'Помощник', V: 'Воин', O: 'Охотник', S: 'Шаман' };
const ROLE_ART   = { K: 'blacksmith', P: 'assistant', V: 'warrior', O: 'hunter', S: 'shaman' };

const STARTS = [
  { role: 'K', p1: [1, 1], p2: [13, 8] },
  { role: 'P', p1: [2, 1], p2: [12, 8] },
  { role: 'V', p1: [1, 2], p2: [13, 7] },
  { role: 'O', p1: [2, 2], p2: [12, 7] },
  { role: 'S', p1: [3, 2], p2: [11, 7] },
];

// Клиентский режим → серверный режим (для setMode)
const TO_SERVER_MODE = {
  moveSum:  'moveSum',
  moveDie:  'split',
  draw:     'split',
  transfer: 'split',
  teleport: 'split',
};

// ── WebSocket-состояние ───────────────────────────────────────────
let ws            = null;
let myPlayerId    = null;
let myRoomId      = null;
let mySessionToken = null;
let serverRoom    = null;   // последний state:snapshot
let autoModeSent  = false;  // флаг: setMode уже отправлен в этом броске

// ── Локальное UI-состояние ────────────────────────────────────────
const positions = new Map();  // characterId → cellId (до подключения карты)
let selectedCharId = null;
let selectedDieIdx = 0;
let localMode      = 'moveSum';
const eventLog     = [];

// ── Борд (геометрия) ──────────────────────────────────────────────
const cells = [];
const cols = 15, rows = 10;
const BASE = { hexW: 46, hexH: 53, colStep: 46, rowStep: 40, odd: 23 };
const GRID_W = (cols - 1) * BASE.colStep + BASE.odd + BASE.hexW;
const GRID_H = (rows - 1) * BASE.rowStep + BASE.hexH;
const svgNS = 'http://www.w3.org/2000/svg';
let scale = 1;
let boardSvg = null;

// ── DOM ───────────────────────────────────────────────────────────
const boardEl        = document.querySelector('#board');
const charactersEl   = document.querySelector('#characters');
const inventoryEl    = document.querySelector('#inventory');
const logEl          = document.querySelector('#log');
const turnInfoEl     = document.querySelector('#turnInfo');
const diceHintEl     = document.querySelector('#diceHint');
const endTurnBtn     = document.querySelector('#endTurnBtn');
const performBtn     = document.querySelector('#performActionBtn');
const dieButtons     = [document.querySelector('#die1'), document.querySelector('#die2')];
const lobbyBtn       = document.querySelector('#lobbyBtn');

// Лобби-DOM (создаётся динамически)
let lobbyEl, nameInput, joinCodeInput, createBtn, joinBtn, vsAiBtn,
    sharedCodeEl, lobbyStatusEl, connBadgeEl;

// ── Старт ─────────────────────────────────────────────────────────
buildBoard();
buildLobbyOverlay();
requestAnimationFrame(fitBoard);
connect();

// ═════════════════════════════════════════════════════════════════
// WebSocket
// ═════════════════════════════════════════════════════════════════

function connect() {
  setConnStatus('connecting');
  try { ws = new WebSocket(SERVER_URL); }
  catch { setConnStatus('error'); return; }

  ws.onopen = () => {
    setConnStatus('connected');
    const saved = loadSession();
    if (saved) wsSend('session:resume', saved);
  };
  ws.onmessage = (e) => { try { handleMsg(JSON.parse(e.data)); } catch {} };
  ws.onclose   = () => { setConnStatus('disconnected'); ws = null; };
  ws.onerror   = () => setConnStatus('error');
}

function wsSend(type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type, payload }));
}

function handleMsg({ type, payload }) {
  switch (type) {

    case 'server:connected':
      showLobby();
      break;

    case 'room:created':
      myPlayerId     = payload.playerId;
      myRoomId       = payload.roomId;
      mySessionToken = payload.sessionToken;
      saveSession({ roomId: myRoomId, sessionToken: mySessionToken });
      if (payload.vsBot) {
        setLobbyStatus('Партия против ИИ начинается…');
      } else {
        showRoomCode(payload.code);
      }
      break;

    case 'room:joined':
      myPlayerId     = payload.playerId;
      myRoomId       = payload.roomId;
      mySessionToken = payload.sessionToken;
      saveSession({ roomId: myRoomId, sessionToken: mySessionToken });
      hideLobby();
      break;

    case 'session:resumed':
      myPlayerId = payload.playerId;
      myRoomId   = payload.roomId;
      hideLobby();
      break;

    case 'state:snapshot': {
      const prevStatus = serverRoom?.status;
      serverRoom = payload.room;

      if (prevStatus !== 'active' && serverRoom.status === 'active') {
        initPositions();
        hideLobby();
        addLog('Партия началась!');
        autoModeSent = false;
      }

      // Авто-setMode: отправляем один раз после броска кубиков
      const g = getGame();
      if (g && isMyTurn() && g.turn.dice && !g.turn.mode && !autoModeSent) {
        const sm = TO_SERVER_MODE[localMode];
        if (sm) { autoModeSent = true; wsSend('turn:setMode', { mode: sm }); }
      }
      if (!g?.turn.dice) autoModeSent = false;

      render();
      break;
    }

    case 'server:error':
      // Ошибки режима (не-rolled, уже потрачен) — тихо; остальное — в лог
      if (!/режим|бросьте/i.test(payload.message))
        addLog(`Ошибка: ${payload.message}`);
      render();
      break;
  }
}

// ═════════════════════════════════════════════════════════════════
// Хелперы состояния
// ═════════════════════════════════════════════════════════════════

const getGame     = () => serverRoom?.game ?? null;
const isMyTurn    = () => getGame()?.turn.activePlayerId === myPlayerId;
const getDice     = () => getGame()?.turn.dice ?? null;
const getServMode = () => getGame()?.turn.mode ?? null;

function getMyChars() {
  return getGame()?.characters.filter(c => c.owner === myPlayerId) ?? [];
}

function getSelChar() {
  if (!selectedCharId) return null;
  return getGame()?.characters.find(c => c.id === selectedCharId) ?? null;
}

function getSelDieVal() {
  const dice = getDice(); if (!dice) return null;
  const used = getGame().turn.usedDice;
  return used[selectedDieIdx] ? null : dice[selectedDieIdx];
}

function charSide(char) {
  return serverRoom?.players.find(p => p.id === char.owner)?.side ?? 'green';
}

// ═════════════════════════════════════════════════════════════════
// Позиции (локальные, до карты заказчика)
// ═════════════════════════════════════════════════════════════════

function initPositions() {
  const green = serverRoom.players.find(p => p.side === 'green');
  const red   = serverRoom.players.find(p => p.side === 'red');
  for (const s of STARTS) {
    if (green) positions.set(`${green.id}:${s.role}`, cellId(s.p1[0], s.p1[1]));
    if (red)   positions.set(`${red.id}:${s.role}`,   cellId(s.p2[0], s.p2[1]));
  }
  const myWarrior = getGame()?.characters.find(c => c.owner === myPlayerId && c.role === 'V');
  if (myWarrior) selectedCharId = myWarrior.id;
}

// ═════════════════════════════════════════════════════════════════
// Лобби
// ═════════════════════════════════════════════════════════════════

function buildLobbyOverlay() {
  lobbyEl = document.createElement('div');
  lobbyEl.id = 'lobby';
  lobbyEl.innerHTML = `
    <div class="lobby-card">
      <div class="lobby-logo">RRaM</div>
      <p class="lobby-sub">Настольная игра онлайн</p>
      <div id="lobbyStatus" class="lobby-status"></div>
      <input id="playerName" type="text" placeholder="Ваше имя" maxlength="32" autocomplete="off" />
      <div class="lobby-btns">
        <button id="createBtn">Создать партию</button>
        <button id="joinBtn" class="ghost">Войти по коду</button>
      </div>
      <button id="vsAiBtn" class="lobby-vsai-btn">Против ИИ</button>
      <div id="joinSection" class="lobby-join hidden">
        <input id="joinCode" type="text" placeholder="Код (4 символа)" maxlength="4" autocomplete="off" />
        <button id="confirmJoinBtn">Войти</button>
      </div>
      <div id="codeDisplay" class="lobby-code hidden">
        Код партии: <strong id="sharedCode"></strong>
        <span class="lobby-code-hint">Передайте второму игроку</span>
      </div>
    </div>
  `;
  document.body.appendChild(lobbyEl);

  nameInput    = lobbyEl.querySelector('#playerName');
  joinCodeInput = lobbyEl.querySelector('#joinCode');
  createBtn    = lobbyEl.querySelector('#createBtn');
  joinBtn      = lobbyEl.querySelector('#joinBtn');
  vsAiBtn      = lobbyEl.querySelector('#vsAiBtn');
  sharedCodeEl = lobbyEl.querySelector('#sharedCode');
  lobbyStatusEl = lobbyEl.querySelector('#lobbyStatus');

  createBtn.addEventListener('click', () => {
    if (!ws) { setLobbyStatus('Нет соединения с сервером.'); return; }
    wsSend('room:create', { playerName: name() });
  });
  vsAiBtn.addEventListener('click', () => {
    if (!ws) { setLobbyStatus('Нет соединения с сервером.'); return; }
    wsSend('room:create', { playerName: name(), vsBot: true });
  });
  joinBtn.addEventListener('click', () => {
    lobbyEl.querySelector('#joinSection').classList.toggle('hidden');
  });
  lobbyEl.querySelector('#confirmJoinBtn').addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    wsSend('room:join', { code, playerName: name() });
  });

  // Значок соединения в topbar
  connBadgeEl = document.createElement('span');
  connBadgeEl.id = 'connBadge';
  document.querySelector('.topbar > div:first-child').appendChild(connBadgeEl);
}

const name = () => nameInput?.value.trim() || 'Игрок';

function showLobby()  { lobbyEl.classList.remove('hidden'); }
function hideLobby()  { lobbyEl.classList.add('hidden'); }

function showRoomCode(code) {
  sharedCodeEl.textContent = code;
  lobbyEl.querySelector('#codeDisplay').classList.remove('hidden');
  createBtn.disabled = true;
  vsAiBtn.disabled   = true;
  joinBtn.disabled   = true;
  setLobbyStatus('Ожидание второго игрока…');
}

function setLobbyStatus(text) {
  if (lobbyStatusEl) lobbyStatusEl.textContent = text;
}

function setConnStatus(s) {
  if (!connBadgeEl) return;
  connBadgeEl.className = `conn-badge conn-${s}`;
  connBadgeEl.textContent = { connecting: '⟳ Подключение', connected: '● Онлайн',
    disconnected: '○ Разрыв', error: '✕ Ошибка' }[s] ?? s;
}

// ── Возврат в лобби ───────────────────────────────────────────────
if (lobbyBtn) {
  lobbyBtn.addEventListener('click', () => {
    clearSession();
    serverRoom = null; myPlayerId = null; myRoomId = null;
    positions.clear(); selectedCharId = null;
    showLobby();
    render();
  });
}

// ═════════════════════════════════════════════════════════════════
// Сессия (localStorage)
// ═════════════════════════════════════════════════════════════════

function saveSession(data)  { try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {} }
function loadSession()      { try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; } }
function clearSession()     { try { localStorage.removeItem(SESSION_KEY); } catch {} }

// ═════════════════════════════════════════════════════════════════
// Обработчики игровых контролов
// ═════════════════════════════════════════════════════════════════

dieButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => {
    if (!getDice()) {
      wsSend('turn:roll');
    } else if (!getGame().turn.usedDice[i]) {
      selectedDieIdx = i;
      render();
    }
  });
});

document.querySelectorAll('.mode').forEach(btn => {
  btn.addEventListener('click', () => {
    localMode = btn.dataset.mode;
    document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Если режим draw/transfer/teleport — убедиться что сервер в split
    if (getDice() && getServMode() === null) {
      const sm = TO_SERVER_MODE[localMode];
      if (sm) { autoModeSent = true; wsSend('turn:setMode', { mode: sm }); }
    }
    render();
  });
});

endTurnBtn.addEventListener('click', () => wsSend('turn:end'));

performBtn.addEventListener('click', () => {
  if (!isMyTurn()) return;
  const char = getSelChar();
  if (!char) return;

  if (localMode === 'draw') {
    wsSend('action:draw', { characterId: char.id, dieIndex: selectedDieIdx });

  } else if (localMode === 'transfer') {
    const allies = getMyChars().filter(c => c.id !== char.id);
    if (!allies.length) { addLog('Нет союзников для передачи.'); return; }
    // Предпочитаем союзника на той же позиции
    const pos = positions.get(char.id);
    const target = allies.find(c => positions.get(c.id) === pos) ?? allies[0];
    wsSend('action:transfer', { fromId: char.id, toId: target.id, dieIndex: selectedDieIdx });
  }
});

// ═════════════════════════════════════════════════════════════════
// Клики по бордам (движение — локально, сервер ждёт карту)
// ═════════════════════════════════════════════════════════════════

function handleCellClick(targetId) {
  if (!isMyTurn() || !getGame()) return;
  const char = getSelChar();
  if (!char) return;

  if (localMode === 'teleport') {
    const inv = char.inventory ?? [];
    if (!inv.includes('Бусы телепортации') || !isStartCell(targetId)) return;
    positions.set(char.id, targetId);
    addLog(`${ROLE_NAMES[char.role]} телепортируется на ${targetId}.`);
    render(); return;
  }

  if (localMode !== 'moveSum' && localMode !== 'moveDie') return;

  const maxDist = getMoveDistance();
  const dist = cellDistance(positions.get(char.id), targetId);
  if (!maxDist || dist <= 0 || dist > maxDist) return;

  positions.set(char.id, targetId);
  addLog(`${ROLE_NAMES[char.role]} → ${targetId}.`);
  render();
}

function getMoveDistance() {
  const dice = getDice(); if (!dice) return 0;
  const used = getGame().turn.usedDice;
  if (localMode === 'moveSum') return (used[0] || used[1]) ? 0 : dice[0] + dice[1];
  return getSelDieVal() ?? 0;
}

// ═════════════════════════════════════════════════════════════════
// Рендер
// ═════════════════════════════════════════════════════════════════

function render() {
  renderTopbar();
  renderDice();
  renderBoard();
  renderCharacters();
  renderInventory();
  renderLog();
}

function renderTopbar() {
  const g = getGame();
  if (!g) {
    turnInfoEl.textContent = 'Ожидание второго игрока…';
    endTurnBtn.disabled = true;
    performBtn.disabled = true;
    return;
  }
  if (g.over) {
    const winner = serverRoom.players.find(p => p.id === g.winnerId)?.name ?? '?';
    turnInfoEl.textContent = `Партия завершена. Победитель: ${winner}`;
    endTurnBtn.disabled = true;
    performBtn.disabled = true;
    return;
  }
  const myTurn = isMyTurn();
  const rolls  = g.turn.rollsLeft[myPlayerId] ?? 0;
  const who    = serverRoom.players.find(p => p.id === g.turn.activePlayerId)?.name ?? '…';
  turnInfoEl.textContent = myTurn
    ? `Ваш ход. Осталось бросков: ${rolls}`
    : `Ход: ${who}`;
  endTurnBtn.disabled = !myTurn;
  performBtn.disabled  = !myTurn || !canPerformAction();
}

function canPerformAction() {
  if (localMode !== 'draw' && localMode !== 'transfer') return false;
  if (!getSelChar()) return false;
  return getSelDieVal() !== null;
}

function renderDice() {
  const g = getGame();
  if (!g) {
    dieButtons.forEach(b => { b.textContent = '–'; b.disabled = true; b.className = 'die'; });
    diceHintEl.textContent = 'Ожидание начала партии.';
    return;
  }
  const myTurn  = isMyTurn();
  const dice    = getDice();
  const used    = g.turn.usedDice;
  const canRoll = myTurn && !dice && (g.turn.rollsLeft[myPlayerId] ?? 0) > 0;

  dieButtons.forEach((btn, i) => {
    btn.textContent = dice ? dice[i] : '🎲';
    btn.disabled    = dice ? (!myTurn || used[i]) : !canRoll;
    btn.className   = 'die';
    if (canRoll)                                               btn.classList.add('rollable');
    if (dice && !used[i] && selectedDieIdx === i && localMode !== 'moveSum') btn.classList.add('selected');
    if (dice && used[i])                                       btn.classList.add('used');
  });

  if (!dice) {
    diceHintEl.textContent = canRoll ? 'Нажмите на кубики, чтобы бросить.' : 'Броски закончились.';
  } else if (getServMode() === 'moveSum') {
    diceHintEl.textContent = `Движение суммой: ${dice[0] + dice[1]} бордов.`;
  } else {
    const v = getSelDieVal();
    diceHintEl.textContent = v !== null
      ? `Кубик ${selectedDieIdx + 1}: значение ${v}.`
      : 'Оба кубика потрачены.';
  }
}

function renderBoard() {
  if (!boardSvg) return;
  boardSvg.querySelectorAll('.token').forEach(n => n.remove());
  const sel    = getSelChar();
  const valid  = sel ? validTargets(sel) : new Set();
  const game   = getGame();

  for (const el of boardSvg.querySelectorAll('.cell')) {
    const id = el.getAttribute('data-id');
    el.className = 'cell';
    if (isStartCell(id)) el.classList.add('start');
    if (game?.characters.some(c => positions.get(c.id) === id)) el.classList.add('occupied');
    if (sel && positions.get(sel.id) === id) el.classList.add('selected');
    if (valid.has(id)) el.classList.add('valid');
  }

  if (!game) return;
  for (const char of game.characters) {
    const pos  = positions.get(char.id);
    const cell = cells.find(c => c.id === pos);
    if (!cell) continue;
    const { cx, cy } = hexCenter(cell.q, cell.r);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `token side-${charSide(char)}`);
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('r', 13);
    const text = document.createElementNS(svgNS, 'text');
    text.textContent = char.role;
    g.appendChild(circle);
    g.appendChild(text);
    boardSvg.appendChild(g);
  }
}

function renderCharacters() {
  charactersEl.innerHTML = '';
  const game = getGame();
  if (!game) return;

  for (const char of getMyChars()) {
    const side   = charSide(char);
    const hp     = char.hp ?? 100;
    const cards  = char.cardCount ?? char.inventory?.length ?? 0;
    const btn    = document.createElement('button');
    btn.className = `character-card side-${side}`;
    if (char.id === selectedCharId) btn.classList.add('active');
    btn.innerHTML = `
      <img class="portrait-img" src="./assets/characters/${side}/transparent/${ROLE_ART[char.role]}.png" alt="${ROLE_NAMES[char.role]}" />
      <strong>${ROLE_NAMES[char.role]}</strong>
      <span class="meta">HP ${hp} · ${cards} карт</span>
    `;
    btn.addEventListener('click', () => { selectedCharId = char.id; render(); });
    charactersEl.appendChild(btn);
  }
}

function renderInventory() {
  const char = getSelChar();
  if (!char) {
    inventoryEl.className = 'inventory empty';
    inventoryEl.textContent = 'Выберите персонажа.';
    return;
  }
  const inv = char.inventory;
  if (!inv) {
    inventoryEl.className = 'inventory empty';
    inventoryEl.textContent = 'Инвентарь скрыт.';
    return;
  }
  inventoryEl.className = inv.length ? 'inventory' : 'inventory empty';
  inventoryEl.innerHTML = inv.length
    ? inv.map(c => `<div class="card">${c}</div>`).join('')
    : 'Инвентарь пуст.';
}

function renderLog() {
  logEl.innerHTML = eventLog.map(e => `<div class="log-entry">${e}</div>`).join('');
}

// ═════════════════════════════════════════════════════════════════
// Допустимые цели движения / телепорта
// ═════════════════════════════════════════════════════════════════

function validTargets(char) {
  const result = new Set();
  if (!getDice()) return result;

  if (localMode === 'teleport') {
    const inv = char.inventory ?? [];
    if (!inv.includes('Бусы телепортации')) return result;
    for (const s of STARTS) {
      result.add(cellId(s.p1[0], s.p1[1]));
      result.add(cellId(s.p2[0], s.p2[1]));
    }
    return result;
  }

  if (localMode !== 'moveSum' && localMode !== 'moveDie') return result;
  const maxDist = getMoveDistance();
  const from    = positions.get(char.id);
  for (const cell of cells) {
    const d = cellDistance(from, cell.id);
    if (d > 0 && d <= maxDist) result.add(cell.id);
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════
// Борд — геометрия
// ═════════════════════════════════════════════════════════════════

function hexCenter(q, r) {
  return {
    cx: q * BASE.colStep + (r % 2 ? BASE.odd : 0) + BASE.hexW / 2,
    cy: r * BASE.rowStep + BASE.hexH / 2,
  };
}

function hexPoints(q, r) {
  const { cx, cy } = hexCenter(q, r);
  const hw = BASE.hexW / 2, qh = BASE.hexH / 4, hh = BASE.hexH / 2;
  return [
    [cx, cy - hh], [cx + hw, cy - qh], [cx + hw, cy + qh],
    [cx, cy + hh], [cx - hw, cy + qh], [cx - hw, cy - qh],
  ].map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`).join(' ');
}

function cellId(q, r)   { return `${q}:${r}`; }
function isStartCell(id){ return STARTS.some(s => id === cellId(s.p1[0], s.p1[1]) || id === cellId(s.p2[0], s.p2[1])); }

function cellDistance(fromId, toId) {
  if (!fromId || !toId) return Infinity;
  const [fq, fr] = fromId.split(':').map(Number);
  const [tq, tr] = toId.split(':').map(Number);
  return Math.abs(fq - tq) + Math.abs(fr - tr);
}

function buildBoard() {
  boardEl.innerHTML = '';
  cells.length = 0;
  boardSvg = document.createElementNS(svgNS, 'svg');
  boardSvg.setAttribute('class', 'board-svg');
  boardSvg.setAttribute('viewBox', `0 0 ${GRID_W} ${GRID_H}`);
  boardSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const id = cellId(q, r);
      cells.push({ id, q, r });
      const poly = document.createElementNS(svgNS, 'polygon');
      poly.setAttribute('class', 'cell');
      poly.setAttribute('points', hexPoints(q, r));
      poly.setAttribute('data-id', id);
      poly.addEventListener('click', () => handleCellClick(id));
      boardSvg.appendChild(poly);
    }
  }

  for (const s of STARTS) {
    for (const [q, r] of [s.p1, s.p2]) {
      const { cx, cy } = hexCenter(q, r);
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('class', 'start-label');
      t.setAttribute('x', cx);
      t.setAttribute('y', cy);
      t.textContent = s.role;
      boardSvg.appendChild(t);
    }
  }

  boardEl.appendChild(boardSvg);
}

function layoutBoard() {
  const w = GRID_W * scale, h = GRID_H * scale;
  boardEl.style.width = `${w}px`;
  boardEl.style.height = `${h}px`;
  boardSvg.setAttribute('width', w);
  boardSvg.setAttribute('height', h);
}

function fitBoard() {
  const wrap = boardEl.parentElement; if (!wrap) return;
  const cs = getComputedStyle(wrap);
  const avW = wrap.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const avH = wrap.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
  scale = Math.max(0.3, Math.min(avW / GRID_W, avH / GRID_H));
  layoutBoard();
  if (serverRoom?.game) renderBoard();
}

window.addEventListener('resize', fitBoard);

// ═════════════════════════════════════════════════════════════════
// Лог
// ═════════════════════════════════════════════════════════════════

function addLog(text) {
  eventLog.unshift(text);
  if (eventLog.length > 40) eventLog.length = 40;
}
