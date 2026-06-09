// RRaM Web Client — тонкий клиент, всё состояние на сервере.
// Движение пока локальное (сервер ждёт карту), кубики/карты/ходы — сервер.

// ── Конфигурация ──────────────────────────────────────────────────
const SERVER_URL = new URLSearchParams(location.search).get('server')
  ?? localStorage.getItem('rram_server')
  ?? 'wss://rram.com.ru/ws';

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
let pendingResume = false;  // флаг: ждём ответа на session:resume
let currentRoomId = null;   // ID комнаты для которой уже инициализированы позиции
let pendingOver   = false;  // партия завершена, но ждём конца анимации шага
let matchResultLogged = false; // итог уже записан в журнал (чтобы не дублировать)

// ── Локальное UI-состояние ────────────────────────────────────────
const positions = new Map();  // characterId → cellId (до подключения карты)
let selectedCharId = null;
let selectedDieIdx = 0;
let localMode      = 'moveSum';
let localUsedDice  = [false, false]; // трекинг хода до синхронизации движения с сервером
const eventLog     = []; // { msg: string, charId?: string, to?: string }

// ── Борд (геометрия) ──────────────────────────────────────────────
const cells = [];
const cols = 15, rows = 10;
const STEP_MS = 140;                 // длительность одного шага фишки по клетке
const WIN_PAUSE_MS = 800;            // пауза после прихода фишки перед показом итога
const tokenDisplayPos = new Map();   // charId → клетка, где фишка показана СЕЙЧАС (во время анимации)
const animTokens = new Map();        // charId → id текущей анимации (для отмены устаревших)
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
const dieButtons     = [document.querySelector('#die1'), document.querySelector('#die2')];

// Лобби-DOM (создаётся динамически)
let lobbyEl, nameInput, joinCodeInput, createBtn, joinBtn, vsAiBtn,
    sharedCodeEl, lobbyStatusEl, connBadgeEl, menuEl, menuBtn;
let settingsEl = null;
let matchResultEl = null;
let settingsReturnTo = 'lobby';
let reconnectTimer = null;

const NAME_KEY = 'rram_player_name';

// ── Старт ─────────────────────────────────────────────────────────
buildBoard();
buildLobbyOverlay();
requestAnimationFrame(fitBoard);
connect();

// ═════════════════════════════════════════════════════════════════
// WebSocket
// ═════════════════════════════════════════════════════════════════

function connect() {
  if (ws) return; // уже подключены
  clearTimeout(reconnectTimer);
  setConnStatus('connecting');
  let sock;
  try { sock = new WebSocket(SERVER_URL); }
  catch { setConnStatus('error'); scheduleReconnect(); return; }

  ws = sock;

  ws.onopen = () => {
    setConnStatus('connected');
    const saved = loadSession();
    if (saved) { pendingResume = true; wsSend('session:resume', saved); }
  };
  ws.onmessage = (e) => { try { handleMsg(JSON.parse(e.data)); } catch {} };
  ws.onclose   = () => {
    if (ws === sock) { ws = null; }
    setConnStatus('disconnected');
    scheduleReconnect();
  };
  ws.onerror   = () => setConnStatus('error');
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!ws) connect();
  }, 3000);
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

    case 'lobby:list':
      renderLobbyList(payload.rooms || []);
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
      pendingResume = false;
      myPlayerId = payload.playerId;
      myRoomId   = payload.roomId;
      hideLobby();
      break;

    case 'state:snapshot': {
      const prevRoom   = serverRoom;
      const prevDice   = serverRoom?.game?.turn?.dice;
      serverRoom = payload.room;

      // Сброс локального трекинга кубиков при смене состояния
      const newDice = serverRoom?.game?.turn?.dice;
      if (!newDice || prevDice?.[0] !== newDice[0] || prevDice?.[1] !== newDice[1]) {
        localUsedDice = [false, false];
      }

      if (serverRoom.status === 'active' && serverRoom.id !== currentRoomId) {
        currentRoomId = serverRoom.id;
        if (usesServerPositions()) {
          positions.clear();
          const myWarrior = getGame()?.characters.find(
            c => c.owner === myPlayerId && c.role === 'V',
          );
          if (myWarrior) selectedCharId = myWarrior.id;
        } else {
          initPositions();
          restoreFromLog();
        }
        hideLobby();
        if (currentRoomId !== myRoomId) addLog('Партия началась!', { type: 'sys' });
        autoModeSent = false;
      } else if (serverRoom.status === 'active' && prevRoom?.game) {
        diffAndLog(prevRoom, serverRoom);
        animateMovesFromDiff(prevRoom, serverRoom);
      }

      // Авто-setMode: отправляем один раз после броска кубиков
      const g = getGame();
      if (g && isMyTurn() && g.turn.dice && !g.turn.mode && !autoModeSent) {
        const sm = TO_SERVER_MODE[localMode];
        if (sm) { autoModeSent = true; wsSend('turn:setMode', { mode: sm }); }
      }
      if (!g?.turn.dice) autoModeSent = false;

      render();
      if (serverRoom?.game?.over) {
        // Фишка должна дойти и постоять, и лишь потом — итог
        if (animTokens.size > 0) pendingOver = true; // покажем после анимации
        else scheduleMatchResult();                  // анимации нет — просто пауза
      } else {
        pendingOver = false;
        matchResultLogged = false;
        hideMatchResult();
      }
      break;
    }

    case 'server:error':
      if (pendingResume) {
        // Сервер перезапустился — старая сессия недействительна, молча сбрасываем
        pendingResume = false;
        clearSession();
        showLobby();
        break;
      }
      // Ошибки входа по коду — в статус лобби, не в лог игры
      if (/комната не найдена/i.test(payload.message)) {
        setLobbyStatus('Комната не найдена. Проверьте код.');
        break;
      }
      // Ошибки режима (не-rolled, уже потрачен) — тихо; остальное — в лог
      if (!/режим|бросьте/i.test(payload.message))
        addLog(`Ошибка: ${payload.message}`, { type: 'err' });
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

function selectCharacter(charId) {
  const char = getGame()?.characters.find(c => c.id === charId);
  if (!char || char.owner !== myPlayerId) return;
  selectedCharId = char.id;
  render();
}

function getSelDieVal() {
  const dice = getDice(); if (!dice) return null;
  const used = getGame().turn.usedDice;
  return used[selectedDieIdx] ? null : dice[selectedDieIdx];
}

function charSide(char) {
  return serverRoom?.players.find(p => p.id === char.owner)?.side ?? 'green';
}

function usesServerPositions() {
  return getGame()?.positionAuthority === 'server-v1';
}

function characterPosition(char) {
  return usesServerPositions() ? char?.position : positions.get(char?.id);
}

// ═════════════════════════════════════════════════════════════════
// Позиции (локальные, до карты заказчика)
// ═════════════════════════════════════════════════════════════════

function initPositions() {
  positions.clear();
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

      <!-- Вид: главный экран -->
      <div class="lobby-view" id="viewHome">
        <div class="lobby-logo">RRaM</div>
        <p class="lobby-sub">Настольная игра онлайн</p>
        <div id="lobbyStatus" class="lobby-status"></div>
        <input id="playerName" type="text" placeholder="Ваше имя" maxlength="32" autocomplete="off" />
        <div id="lobbyList" class="lobby-list">
          <div class="lobby-list-title">Открытые игры</div>
          <div id="lobbyListItems" class="lobby-list-items"></div>
        </div>
        <div class="lobby-btns">
          <button id="createBtn">Создать партию</button>
          <button id="joinBtn" class="ghost">Войти по коду</button>
        </div>
        <label class="lobby-check">
          <input id="privateToggle" type="checkbox" /> Скрытая партия (только по коду)
        </label>
        <button id="vsAiBtn" class="lobby-vsai-btn">Против ИИ</button>
        <div id="joinSection" class="lobby-join hidden">
          <input id="joinCode" type="text" placeholder="Код (4 символа)" maxlength="4" autocomplete="off" />
          <button id="confirmJoinBtn">Войти</button>
        </div>
        <div id="codeDisplay" class="lobby-code hidden">
          Код партии: <strong id="sharedCode"></strong>
          <span class="lobby-code-hint">Передайте второму игроку</span>
          <button id="cancelWaitBtn" class="lobby-cancel-btn">Отменить ожидание</button>
        </div>
        <div class="lobby-bottom-row">
          <button id="settingsBtn" class="lobby-link-btn">⚙ Настройки</button>
          <button id="reconnectBtn" class="lobby-link-btn hidden">⟳ Переподключиться</button>
        </div>
      </div>


    </div>
  `;
  document.body.appendChild(lobbyEl);

  nameInput     = lobbyEl.querySelector('#playerName');
  joinCodeInput = lobbyEl.querySelector('#joinCode');
  createBtn     = lobbyEl.querySelector('#createBtn');
  joinBtn       = lobbyEl.querySelector('#joinBtn');
  vsAiBtn       = lobbyEl.querySelector('#vsAiBtn');
  sharedCodeEl  = lobbyEl.querySelector('#sharedCode');
  lobbyStatusEl = lobbyEl.querySelector('#lobbyStatus');

  // Восстановить сохранённое имя
  nameInput.value = localStorage.getItem(NAME_KEY) || '';
  nameInput.addEventListener('input', () => localStorage.setItem(NAME_KEY, nameInput.value.trim()));

  createBtn.addEventListener('click', () => {
    if (!ws) { connect(); setLobbyStatus('Подключение… попробуйте ещё раз через секунду.'); return; }
    const isPrivate = lobbyEl.querySelector('#privateToggle')?.checked === true;
    wsSend('room:create', { playerName: name(), public: !isPrivate });
  });
  vsAiBtn.addEventListener('click', () => {
    if (!ws) { connect(); setLobbyStatus('Подключение… попробуйте ещё раз через секунду.'); return; }
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
  lobbyEl.querySelector('#cancelWaitBtn').addEventListener('click', cancelWaitingRoom);

  // Настройки — открывают отдельный оверлей
  lobbyEl.querySelector('#settingsBtn').addEventListener('click', () => openSettings('lobby'));

  const reconnectBtn = lobbyEl.querySelector('#reconnectBtn');
  reconnectBtn.addEventListener('click', () => { ws?.close(); connect(); });

  // Значок соединения и кнопка меню — в правой части шапки
  const tbRight = document.querySelector('.topbar .tb-right');
  connBadgeEl = document.createElement('span');
  connBadgeEl.id = 'connBadge';
  tbRight.appendChild(connBadgeEl);

  // Кнопка меню (видна только во время игры)
  menuBtn = document.createElement('button');
  menuBtn.id = 'menuBtn';
  menuBtn.textContent = '☰';
  menuBtn.classList.add('hidden', 'topbar-menu-btn');
  menuBtn.setAttribute('aria-label', 'Меню');
  tbRight.appendChild(menuBtn);
  menuBtn.addEventListener('click', showGameMenu);

  // Сворачиваемая шторка «Журнал · Инвентарь»
  const sheetHandle = document.querySelector('#sheetHandle');
  sheetHandle?.addEventListener('click', () => {
    const sheet = document.querySelector('#sheet');
    const open = sheet.classList.toggle('open');
    sheetHandle.setAttribute('aria-expanded', String(open));
  });

  buildGameMenu();
  buildSettingsOverlay();
  buildMatchResultOverlay();
}

function showLobbyView(view) {
  lobbyEl.querySelectorAll('.lobby-view').forEach(el => el.classList.add('hidden'));
  lobbyEl.querySelector(`#view${view.charAt(0).toUpperCase() + view.slice(1)}`).classList.remove('hidden');
  if (view === 'settings') {
    lobbyEl.querySelector('#settingsName').value = localStorage.getItem(NAME_KEY) || '';
    lobbyEl.querySelector('#settingsServer').value = localStorage.getItem('rram_server') || '';
  }
}

function resetLobby() {
  showLobbyView('home');
  setLobbyStatus('');
  lobbyEl.querySelector('#viewHome').classList.remove('is-waiting');
  lobbyEl.querySelector('#codeDisplay').classList.add('hidden');
  lobbyEl.querySelector('#joinSection').classList.add('hidden');
  lobbyEl.querySelector('#lobbyList').classList.remove('hidden');
  createBtn.disabled = false;
  vsAiBtn.disabled   = false;
  joinBtn.disabled   = false;
}

// ── Игровое меню (пауза) ──────────────────────────────────────────

function buildGameMenu() {
  menuEl = document.createElement('div');
  menuEl.id = 'gameMenu';
  menuEl.classList.add('hidden');
  menuEl.innerHTML = `
    <div class="menu-card">
      <div class="menu-title">Меню</div>
      <button id="menuResumeBtn">▶ Продолжить игру</button>
      <button id="menuNewBtn" class="ghost">🚪 Выйти в лобби</button>
      <button id="menuSettingsBtn" class="ghost">⚙ Настройки</button>
    </div>
  `;
  document.body.appendChild(menuEl);

  menuEl.querySelector('#menuResumeBtn').addEventListener('click', hideGameMenu);

  menuEl.querySelector('#menuNewBtn').addEventListener('click', () => {
    const active = serverRoom?.game && !serverRoom.game.over;
    if (active && !confirm('Выйти из игры?\nСопернику будет засчитана победа.')) return;
    if (myRoomId) wsSend('room:leave'); // уведомить сервер и соперника
    resetToLobby();
  });

  menuEl.querySelector('#menuSettingsBtn').addEventListener('click', () => {
    hideGameMenu();
    openSettings('game');
  });
}

function showGameMenu() { menuEl.classList.remove('hidden'); }
function hideGameMenu() { menuEl.classList.add('hidden'); }

function resetToLobby() {
  hideGameMenu();
  hideMatchResult();
  clearSession();
  serverRoom = null;
  myPlayerId = null;
  myRoomId = null;
  currentRoomId = null;
  positions.clear();
  selectedCharId = null;
  eventLog.length = 0;
  resetLobby();
  showLobby();
  render();
}

function buildMatchResultOverlay() {
  matchResultEl = document.createElement('div');
  matchResultEl.id = 'matchResult';
  matchResultEl.classList.add('hidden');
  matchResultEl.innerHTML = `
    <div class="match-result-card">
      <div id="matchResultTitle" class="match-result-title"></div>
      <p id="matchResultText" class="match-result-text"></p>
      <button id="matchResultNewBtn">Новая партия</button>
      <button id="matchResultCloseBtn" class="ghost">Посмотреть поле</button>
    </div>
  `;
  document.body.appendChild(matchResultEl);
  matchResultEl.querySelector('#matchResultNewBtn').addEventListener('click', resetToLobby);
  matchResultEl.querySelector('#matchResultCloseBtn').addEventListener('click', hideMatchResult);
}

function showMatchResult() {
  const game = getGame();
  if (!matchResultEl || !game?.over) return;
  const won = game.winnerId === myPlayerId;
  const winner = serverRoom?.players.find(player => player.id === game.winnerId)?.name;
  matchResultEl.querySelector('#matchResultTitle').textContent = won ? 'Победа' : 'Поражение';
  matchResultEl.querySelector('#matchResultText').textContent = winner
    ? `Партия завершена. Победитель: ${winner}.`
    : 'Партия завершена.';
  matchResultEl.classList.toggle('is-win', won);
  matchResultEl.classList.toggle('is-loss', !won);
  matchResultEl.classList.remove('hidden');
}

function hideMatchResult() {
  matchResultEl?.classList.add('hidden');
}

// Пауза «фишка постояла» и затем итог (если партия всё ещё завершена).
function scheduleMatchResult() {
  setTimeout(() => { if (serverRoom?.game?.over) revealMatchResult(); }, WIN_PAUSE_MS);
}

// Показать итог партии (с записью в журнал один раз). Вызывается после паузы:
// сразу (если хода-анимации не было) либо по завершении анимации шага.
function revealMatchResult() {
  pendingOver = false;
  if (!serverRoom?.game?.over) return;
  showMatchResult();
  if (!matchResultLogged) {
    matchResultLogged = true;
    const won = serverRoom.game.winnerId === myPlayerId;
    addLog(won ? 'Партия завершена: вы победили.' : 'Партия завершена: победил соперник.', {
      type: won ? 'my' : 'opp',
    });
    renderLog();
  }
}

// ── Настройки (отдельный оверлей, не зависит от лобби) ───────────


function buildSettingsOverlay() {
  settingsEl = document.createElement('div');
  settingsEl.id = 'settingsOverlay';
  settingsEl.classList.add('hidden');
  settingsEl.innerHTML = `
    <div class="settings-card">
      <div class="settings-title">Настройки</div>
      <label class="lobby-label">Имя игрока
        <input id="setName" type="text" maxlength="32" autocomplete="off" />
      </label>
      <label class="lobby-label">Адрес сервера
        <input id="setServer" type="text" autocomplete="off" />
      </label>
      <p class="lobby-label-hint">Оставьте пустым — основной сервер rram.com.ru. Можно указать другой адрес (например, запасной).</p>
      <div class="lobby-btns">
        <button id="setSaveBtn">Сохранить</button>
        <button id="setBackBtn" class="ghost">← Назад</button>
      </div>
    </div>
  `;
  document.body.appendChild(settingsEl);

  settingsEl.querySelector('#setSaveBtn').addEventListener('click', () => {
    const n = settingsEl.querySelector('#setName').value.trim();
    const s = settingsEl.querySelector('#setServer').value.trim();
    if (n) { localStorage.setItem(NAME_KEY, n); if (nameInput) nameInput.value = n; }
    if (s) localStorage.setItem('rram_server', s);
    else   localStorage.removeItem('rram_server');
    closeSettings('Настройки сохранены.');
  });

  settingsEl.querySelector('#setBackBtn').addEventListener('click', () => closeSettings());
}

function openSettings(from) {
  settingsReturnTo = from;
  settingsEl.querySelector('#setName').value   = localStorage.getItem(NAME_KEY) || '';
  settingsEl.querySelector('#setServer').value = localStorage.getItem('rram_server') || '';
  settingsEl.classList.remove('hidden');
}

function closeSettings(statusMsg) {
  settingsEl.classList.add('hidden');
  if (settingsReturnTo === 'lobby') {
    if (statusMsg) setLobbyStatus(statusMsg);
  } else {
    // Вернуться в игру — ничего не показываем
  }
}

const name = () => nameInput?.value.trim() || localStorage.getItem(NAME_KEY) || 'Игрок';

function showLobby()  {
  lobbyEl.classList.remove('hidden');
  menuBtn?.classList.add('hidden');
  wsSend('lobby:subscribe'); // получать список открытых игр (no-op если сокет не открыт)
}
function hideLobby()  {
  lobbyEl.classList.add('hidden');
  menuBtn?.classList.remove('hidden');
  wsSend('lobby:unsubscribe');
}

function showRoomCode(code) {
  sharedCodeEl.textContent = code;
  lobbyEl.querySelector('#viewHome').classList.add('is-waiting');
  lobbyEl.querySelector('#codeDisplay').classList.remove('hidden');
  lobbyEl.querySelector('#lobbyList').classList.add('hidden');
  createBtn.disabled = true;
  vsAiBtn.disabled   = true;
  joinBtn.disabled   = true;
  setLobbyStatus('Ожидание второго игрока…');
}

function cancelWaitingRoom() {
  clearSession();
  myPlayerId = null;
  myRoomId = null;
  serverRoom = null;
  currentRoomId = null;
  positions.clear();
  selectedCharId = null;
  resetLobby();

  const socket = ws;
  ws = null;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }
  connect();
}

function setLobbyStatus(text) {
  if (lobbyStatusEl) lobbyStatusEl.textContent = text;
}

// Список открытых игр в лобби (приходит пушем по 'lobby:list').
function renderLobbyList(rooms) {
  const box = lobbyEl?.querySelector('#lobbyListItems');
  if (!box) return;
  if (rooms.length === 0) {
    box.innerHTML = '<div class="lobby-list-empty">Нет открытых игр — создайте первую.</div>';
    return;
  }
  box.innerHTML = rooms.map(r => `
    <div class="lobby-list-row">
      <span class="lobby-list-name">${escapeHtml(r.hostName)}</span>
      <span class="lobby-list-count">${r.playerCount}/${r.playerLimit}</span>
      <button class="lobby-list-join" data-room="${r.roomId}">Войти</button>
    </div>
  `).join('');
  box.querySelectorAll('.lobby-list-join').forEach(btn => {
    btn.addEventListener('click', () => {
      wsSend('lobby:join', { roomId: btn.dataset.room, playerName: name() });
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function setConnStatus(s) {
  if (!connBadgeEl) return;
  connBadgeEl.className = `conn-badge conn-${s}`;
  // Компактно в тонкой шапке: только значок, полный текст — в подсказке.
  connBadgeEl.textContent = { connecting: '⟳', connected: '●',
    disconnected: '○', error: '✕' }[s] ?? s;
  connBadgeEl.title = { connecting: 'Подключение…', connected: 'Онлайн',
    disconnected: 'Разрыв связи', error: 'Ошибка связи' }[s] ?? s;
  const reconnectBtn = lobbyEl?.querySelector('#reconnectBtn');
  if (reconnectBtn) {
    reconnectBtn.classList.toggle('hidden', s === 'connected' || s === 'connecting');
  }
}


// ═════════════════════════════════════════════════════════════════
// Сессия (localStorage)
// ═════════════════════════════════════════════════════════════════

function saveSession(data)  { try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {} }
function loadSession()      { try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; } }
function clearSession()     { try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY + '_log'); } catch {} }

function saveLog() {
  try { localStorage.setItem(SESSION_KEY + '_log', JSON.stringify(eventLog)); } catch {}
}

function restoreFromLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY + '_log') ?? 'null');
    if (!Array.isArray(saved)) return false;
    eventLog.length = 0;
    saved.forEach(e => eventLog.push(e));
    // Журнал хранится от новых записей к старым. Применяем его от старых к новым,
    // чтобы последняя позиция каждого персонажа осталась итоговой.
    for (const e of [...eventLog].reverse()) {
      if (e.charId && e.to) positions.set(e.charId, e.to);
    }
    return true;
  } catch { return false; }
}

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
    const mode = btn.dataset.mode;
    // «Взять карту» / «Передать» — прямое действие, а не переключение режима
    if (mode === 'draw' || mode === 'transfer') { directCardAction(mode); return; }

    localMode = mode;
    document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (getDice() && getServMode() === null) {
      const sm = TO_SERVER_MODE[localMode];
      if (sm) { autoModeSent = true; wsSend('turn:setMode', { mode: sm }); }
    }
    render();
  });
});

endTurnBtn.addEventListener('click', () => wsSend('turn:end'));

// Прямое карточное действие (без отдельной кнопки «Выполнить»):
// берём выбранную фишку и свободный кубик, при необходимости переключаем сервер в split.
function directCardAction(mode) {
  if (!isMyTurn() || !getDice()) return;
  const char = getSelChar();
  if (!char) { addLog('Сначала выберите персонажа.', { type: 'err' }); render(); return; }

  const used = getGame().turn.usedDice;
  let dieIndex = used[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
  if (used[dieIndex]) { addLog('Оба кубика потрачены.', { type: 'err' }); render(); return; }

  if (getServMode() !== 'split') wsSend('turn:setMode', { mode: 'split' });

  if (mode === 'draw') {
    wsSend('action:draw', { characterId: char.id, dieIndex });
  } else {
    const allies = getMyChars().filter(c => c.id !== char.id);
    if (!allies.length) { addLog('Нет союзников для передачи.', { type: 'err' }); render(); return; }
    const pos = characterPosition(char);
    const target = allies.find(c => characterPosition(c) === pos) ?? allies[0];
    wsSend('action:transfer', { fromId: char.id, toId: target.id, dieIndex });
  }
}

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
    if (usesServerPositions()) {
      wsSend('action:teleport', { characterId: char.id, toCell: targetId });
      return;
    }
    if (localUsedDice[0] && localUsedDice[1]) return;
    positions.set(char.id, targetId);
    localUsedDice = [true, true];
    addLog(`${ROLE_NAMES[char.role]} телепортируется на ${targetId}.`, { charId: char.id, to: targetId, type: 'my' });
    render(); return;
  }

  if (localMode !== 'moveSum' && localMode !== 'moveDie') return;

  if (usesServerPositions()) {
    if (!validTargets(char).has(targetId)) return;
    const payload = { characterId: char.id, toCell: targetId };
    if (localMode === 'moveDie') payload.dieIndex = selectedDieIdx;
    wsSend('action:move', payload);
    return;
  }

  const maxDist = getMoveDistance();
  const dist = cellDistance(positions.get(char.id), targetId);
  if (!maxDist || dist <= 0 || dist > maxDist) return;

  positions.set(char.id, targetId);

  if (localMode === 'moveSum') {
    localUsedDice = [true, true];
  } else {
    localUsedDice[selectedDieIdx] = true;
  }

  addLog(`${ROLE_NAMES[char.role]} → ${targetId}.`, { charId: char.id, to: targetId, type: 'my' });
  render();
}

function getMoveDistance() {
  const dice = getDice(); if (!dice) return 0;
  const srv  = getGame().turn.usedDice;
  const used = [srv[0] || localUsedDice[0], srv[1] || localUsedDice[1]];
  if (localMode === 'moveSum') return (used[0] || used[1]) ? 0 : dice[0] + dice[1];
  if (used[selectedDieIdx]) return 0;
  return dice[selectedDieIdx] ?? 0;
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
    return;
  }
  if (g.over) {
    const winner = serverRoom.players.find(p => p.id === g.winnerId)?.name ?? '?';
    turnInfoEl.textContent = `Партия завершена. Победитель: ${winner}`;
    endTurnBtn.disabled = true;
    return;
  }
  const myTurn = isMyTurn();
  const rolls  = g.turn.rollsLeft[myPlayerId] ?? 0;
  const who    = serverRoom.players.find(p => p.id === g.turn.activePlayerId)?.name ?? '…';
  turnInfoEl.textContent = myTurn
    ? `Ваш ход · Ходов: ${rolls}`
    : `Ход соперника`;
  endTurnBtn.disabled = !myTurn;
}

function renderDice() {
  const g = getGame();
  if (!g) {
    dieButtons.forEach(b => { b.textContent = '–'; b.disabled = true; b.className = 'die'; });
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

}

function renderBoard() {
  if (!boardSvg) return;
  boardSvg.querySelectorAll('.token').forEach(n => n.remove());
  const sel    = getSelChar();
  const valid  = sel ? validTargets(sel) : new Set();
  const game   = getGame();

  for (const el of boardSvg.querySelectorAll('.cell')) {
    const id = el.getAttribute('data-id');
    el.setAttribute('class', 'cell');
    if (isStartCell(id)) el.classList.add('start');
    if (game?.characters.some(c => characterPosition(c) === id)) el.classList.add('occupied');
    if (sel && characterPosition(sel) === id) el.classList.add('selected');
    if (valid.has(id)) el.classList.add('valid');
  }

  if (!game) return;
  for (const char of game.characters) {
    const pos  = tokenDisplayPos.get(char.id) ?? characterPosition(char);
    const cell = cells.find(c => c.id === pos);
    if (!cell) continue;
    const { cx, cy } = hexCenter(cell.q, cell.r);
    const g = document.createElementNS(svgNS, 'g');
    const isOwn = char.owner === myPlayerId;
    const tokenClasses = ['token', `side-${charSide(char)}`];
    if (isOwn) tokenClasses.push('own');
    if (char.id === selectedCharId) tokenClasses.push('active');
    g.setAttribute('class', tokenClasses.join(' '));
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    if (isOwn) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Выбрать: ${ROLE_NAMES[char.role]}`);
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        selectCharacter(char.id);
      });
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectCharacter(char.id);
      });
    }
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
    btn.addEventListener('click', () => selectCharacter(char.id));
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
  logEl.innerHTML = eventLog.map(e => {
    const cls = e.type ? ` log-${e.type}` : '';
    return `<div class="log-entry${cls}">${e.msg ?? e}</div>`;
  }).join('');
}

// ═════════════════════════════════════════════════════════════════
// Допустимые цели движения / телепорта
// ═════════════════════════════════════════════════════════════════

function validTargets(char) {
  const result = new Set();
  if (!isMyTurn() || !getDice()) return result;

  if (localMode === 'teleport') {
    const inv = char.inventory ?? [];
    if (!inv.includes('Бусы телепортации')) return result;
    for (const s of STARTS) {
      for (const [q, r] of [s.p1, s.p2]) {
        const id = cellId(q, r);
        const occupied = getGame()?.characters.some(
          c => c.id !== char.id && characterPosition(c) === id,
        );
        if (!occupied) result.add(id);
      }
    }
    return result;
  }

  if (localMode !== 'moveSum' && localMode !== 'moveDie') return result;
  if (usesServerPositions()) {
    const legal = getGame()?.legalTargets;
    const targets = localMode === 'moveSum'
      ? legal?.moveSum?.[char.id]
      : legal?.dice?.[selectedDieIdx]?.[char.id];
    return new Set(targets ?? []);
  }
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

// Соседи гекса (odd-r) — ДОЛЖНЫ совпадать с server/map.js neighbors().
function hexNeighbors(id) {
  const [q, r] = id.split(':').map(Number);
  const even = [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  const odd  = [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
  return (r % 2 === 0 ? even : odd)
    .map(([dq, dr]) => [q + dq, r + dr])
    .filter(([a, b]) => a >= 0 && a < cols && b >= 0 && b < rows)
    .map(([a, b]) => `${a}:${b}`);
}

// Кратчайший путь по гексам (BFS), огибая занятые клетки. Конечную клетку
// блокировкой не считаем. Нет пути — возвращаем [from, to] (будет «прыжок»).
function hexPath(from, to, blocked = new Set()) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of hexNeighbors(cur)) {
      if (prev.has(nb) || (blocked.has(nb) && nb !== to)) continue;
      prev.set(nb, cur);
      if (nb === to) {
        const path = [];
        for (let c = nb; c !== null; c = prev.get(c)) path.unshift(c);
        return path;
      }
      queue.push(nb);
    }
  }
  return [from, to];
}

// Прошагать фишку по клеткам from→to. Телепорт (далёкий прыжок на стартовую
// клетку) не анимируем — он визуально именно мгновенный.
function animateMove(charId, from, to) {
  const occupied = new Set(
    (getGame()?.characters ?? [])
      .filter(c => c.id !== charId)
      .map(c => characterPosition(c)),
  );
  const path = hexPath(from, to, occupied);
  if (path.length <= 1) return;
  if (isStartCell(to) && path.length > 3) return; // похоже на телепорт — мгновенно

  const token = Symbol('anim');
  animTokens.set(charId, token);
  tokenDisplayPos.set(charId, path[0]);

  let i = 1;
  const step = () => {
    if (animTokens.get(charId) !== token) return; // отменена более новой анимацией
    tokenDisplayPos.set(charId, path[i]);
    renderBoard();
    if (++i < path.length) {
      setTimeout(step, STEP_MS);
    } else {
      animTokens.delete(charId);
      tokenDisplayPos.delete(charId);
      renderBoard();
      // фишка дошла — пусть постоит, затем покажем итог (если ждали)
      if (pendingOver && animTokens.size === 0) { pendingOver = false; scheduleMatchResult(); }
    }
  };
  setTimeout(step, STEP_MS);
}

// Сравнить позиции до/после снапшота и запустить шаги для сдвинувшихся фишек.
function animateMovesFromDiff(prevRoom, nextRoom) {
  const prevChars = prevRoom?.game?.characters;
  const nextChars = nextRoom?.game?.characters;
  if (!prevChars || !nextChars) return;
  for (const next of nextChars) {
    const prev = prevChars.find(c => c.id === next.id);
    if (prev && next.position && prev.position && prev.position !== next.position) {
      animateMove(next.id, prev.position, next.position);
    }
  }
}

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

function addLog(text, extra = {}) {
  // extra: { charId, to } для ходов — нужны для восстановления позиций
  eventLog.unshift({ msg: text, ...extra });
  if (eventLog.length > 60) eventLog.length = 60;
  saveLog();
}

// Сравниваем два снапшота и логируем действия противника
function diffAndLog(prevRoom, nextRoom) {
  const prevG = prevRoom?.game;
  const nextG = nextRoom?.game;
  if (!prevG || !nextG || !myPlayerId) return;

  const oppPlayer = nextRoom.players.find(p => p.id !== myPlayerId);
  if (!oppPlayer) return;
  const oppId   = oppPlayer.id;
  const oppName = oppPlayer.name ?? 'Противник';

  const prevActive = prevG.turn.activePlayerId;
  const nextActive = nextG.turn.activePlayerId;

  for (const char of nextG.characters) {
    const prevChar = prevG.characters.find(c => c.id === char.id);
    if (!prevChar || prevChar.position === char.position) continue;
    const type = char.owner === myPlayerId ? 'my' : 'opp';
    const ownerName = char.owner === myPlayerId ? '' : `${oppName}: `;
    addLog(`${ownerName}${ROLE_NAMES[char.role]} → ${char.position}.`, { type });
  }

  // Смена хода
  if (prevActive !== nextActive) {
    addLog(nextActive === myPlayerId ? 'Ваш ход.' : `Ход ${oppName}.`, { type: 'sys' });
    return;
  }

  // Действия противника в его ход
  if (nextActive !== myPlayerId) {
    // Бросок кубиков
    if (!prevG.turn.dice && nextG.turn.dice) {
      addLog(`${oppName} бросил [${nextG.turn.dice[0]}, ${nextG.turn.dice[1]}].`, { type: 'opp' });
    }
    // Изменения инвентаря (добор / передача)
    for (const char of nextG.characters.filter(c => c.owner === oppId)) {
      const prevChar = prevG.characters.find(c => c.id === char.id);
      if (!prevChar?.inventory || !char.inventory) continue;
      const delta = char.inventory.length - prevChar.inventory.length;
      if (delta > 0) addLog(`${oppName}: ${ROLE_NAMES[char.role]} добрал карту.`, { type: 'opp' });
      if (delta < 0) addLog(`${oppName}: ${ROLE_NAMES[char.role]} передал карту.`, { type: 'opp' });
    }
  }
}
