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

// ── Борд (data-driven из assets/board-map.json) ───────────────────
const cells = [];                    // [{ id, cx, cy }] в координатах viewBox
const cellById = new Map();          // id → { id, cx, cy, neighbors[] }
let boardMap = null;                 // загруженная карта (cells, starts, art, hex)
let startCellIds = new Set();        // id всех стартовых клеток
let VBW = 1000, VBH = 750;           // размер viewBox (по пропорции арта)
let HEX_R = 12;                      // радиус гекса в координатах viewBox
const STEP_MS = 140;                 // длительность одного шага фишки по клетке
const WIN_PAUSE_MS = 800;            // пауза после прихода фишки перед показом итога
const tokenDisplayPos = new Map();   // charId → клетка, где фишка показана СЕЙЧАС (во время анимации)
const animTokens = new Map();        // charId → id текущей анимации (для отмены устаревших)
const teleportedChars = new Set();   // charId, чей последний сдвиг — телепорт (прыжок, без шагов)
const svgNS = 'http://www.w3.org/2000/svg';
let scale = 1;
let boardSvg = null;
let boardVp  = null;                  // <g> вьюпорт: пан/зум применяются к нему
let view = { s: 1, tx: 0, ty: 0 };    // зум и сдвиг в координатах viewBox
const MIN_S = 1, MAX_S = 6;
let gestureMoved = false;             // был ли drag/pinch (чтобы не считать его тапом)
const ptrs = new Map();               // активные указатели (touch/mouse)
let panStart = null, pinchStart = null;

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
buildLobbyOverlay();
connect();
document.getElementById('fitBtn')?.addEventListener('click', fitAll);
document.getElementById('focusBtn')?.addEventListener('click', focusMine);
loadBoardMap().then(() => {
  buildBoard();
  requestAnimationFrame(() => {
    fitBoard();
    if (serverRoom?.game) { render(); focusMine(); }
  });
});

// Загрузка граф-карты (статический asset, один раз).
async function loadBoardMap() {
  try {
    const res = await fetch('./assets/board-map.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    boardMap = await res.json();
  } catch (e) {
    console.error('Не удалось загрузить карту', e);
    boardMap = { cells: [], starts: { green: {}, red: {} }, art: {}, hex: {}, editorSource: { centers: {} } };
  }
}

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
      const prevActive = serverRoom?.game?.turn?.activePlayerId;
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
        requestAnimationFrame(focusMine);   // старт партии — база с окружающими путями
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
      if (!g?.turn.dice) {
        autoModeSent = false;
        localMode = 'moveSum';
        selectedDieIdx = 0;
      }

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
  return getGame()?.characters.find(
    c => c.id === selectedCharId && c.hp > 0 && characterPosition(c),
  ) ?? null;
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

// Легаси (локальные позиции до серверной карты). При серверной карте не
// вызывается; оставлено как безопасная заглушка.
function initPositions() {
  positions.clear();
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
      const used = getGame().turn.usedDice;
      const canChangeMode = !used[0] && !used[1];
      if (localMode === 'moveDie' && selectedDieIdx === i && canChangeMode) {
        setLocalMode('moveSum');
      } else {
        selectedDieIdx = i;
        setLocalMode('moveDie');
      }
      render();
    }
  });
});

document.querySelectorAll('.mode').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    // «Взять карту» / «Передать» — прямое действие, а не переключение режима
    if (mode === 'draw' || mode === 'transfer') { directCardAction(mode); return; }

    setLocalMode(mode);
    render();
  });
});

endTurnBtn.addEventListener('click', () => wsSend('turn:end'));

function setLocalMode(mode) {
  localMode = mode;
  document.querySelectorAll('.mode').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  const game = getGame();
  if (!game?.turn.dice || !isMyTurn()) return;
  if (game.turn.usedDice[0] || game.turn.usedDice[1]) return;

  const serverMode = TO_SERVER_MODE[mode];
  if (serverMode && getServMode() !== serverMode) {
    autoModeSent = true;
    wsSend('turn:setMode', { mode: serverMode });
  }
}

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
      teleportedChars.add(char.id); // не анимировать шагами — это прыжок
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
  const canRoll = myTurn
    && !dice
    && !g.turn.hasRolled
    && (g.turn.rollsLeft[myPlayerId] ?? 0) > 0;

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
    el.setAttribute('class', cellClassName(cellById.get(id)));
    if (isStartCell(id)) el.classList.add('start');
    if (game?.characters.some(c => characterPosition(c) === id)) el.classList.add('occupied');
    if (sel && characterPosition(sel) === id) el.classList.add('selected');
    if (valid.has(id)) el.classList.add('valid');
  }

  if (!game) return;
  const attackTargets = new Set(
    sel ? (game.legalTargets?.attacks?.[sel.id] ?? []) : [],
  );
  for (const char of game.characters) {
    const pos  = tokenDisplayPos.get(char.id) ?? characterPosition(char);
    const ctr  = cellCenter(pos);
    if (!ctr) continue;
    const { cx, cy } = ctr;
    const g = document.createElementNS(svgNS, 'g');
    const isOwn = char.owner === myPlayerId;
    const tokenClasses = ['token', `side-${charSide(char)}`];
    if (isOwn) tokenClasses.push('own');
    if (attackTargets.has(char.id)) tokenClasses.push('attackable');
    if (char.id === selectedCharId) tokenClasses.push('active');
    g.setAttribute('class', tokenClasses.join(' '));
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    if (isOwn) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Выбрать: ${ROLE_NAMES[char.role]}`);
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!gestureMoved) selectCharacter(char.id);
      });
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectCharacter(char.id);
      });
    } else if (attackTargets.has(char.id)) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Атаковать: ${ROLE_NAMES[char.role]}`);
      const attack = (event) => {
        event.stopPropagation();
        if (gestureMoved) return;
        const attacker = getSelChar();
        if (!attacker) return;
        wsSend('action:attack', { attackerId: attacker.id, targetId: char.id });
      };
      g.addEventListener('click', attack);
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        attack(event);
      });
    }
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('r', (HEX_R * 0.82).toFixed(1));
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('font-size', (HEX_R * 0.95).toFixed(1));
    text.textContent = char.role;
    const hp = document.createElementNS(svgNS, 'text');
    hp.setAttribute('class', 'token-hp');
    hp.setAttribute('y', (HEX_R * 1.35).toFixed(1));
    hp.setAttribute('font-size', (HEX_R * 0.52).toFixed(1));
    hp.textContent = `${char.hp}`;
    g.appendChild(circle);
    g.appendChild(text);
    g.appendChild(hp);
    boardVp.appendChild(g);
  }
}

function renderCharacters() {
  if (!charactersEl) return;
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
    for (const id of startCellIds) {
      const occupied = getGame()?.characters.some(
        c => c.id !== char.id && characterPosition(c) === id,
      );
      if (!occupied) result.add(id);
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

function cellCenter(id) {
  const c = cellById.get(id);
  return c ? { cx: c.cx, cy: c.cy } : null;
}

// flat-top гекс вокруг центра радиусом r (в координатах viewBox)
function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function isStartCell(id) { return startCellIds.has(id); }

// Соседи клетки — из графа карты (тот же источник, что и на сервере).
function hexNeighbors(id) {
  return cellById.get(id)?.neighbors ?? [];
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

// Прошагать фишку по клеткам from→to. Телепорт — прыжок (без шагов):
// определяется по флагу teleportedChars (наш телепорт) либо по слишком
// длинному пути (телепорт соперника). Обычный ход — всегда анимируем.
function animateMove(charId, from, to) {
  if (teleportedChars.has(charId)) { teleportedChars.delete(charId); return; }
  const occupied = new Set(
    (getGame()?.characters ?? [])
      .filter(c => c.id !== charId)
      .map(c => characterPosition(c)),
  );
  const path = hexPath(from, to, occupied);
  if (path.length <= 1) return;
  if (path.length > 14) return; // подозрительно длинно — вероятно телепорт соперника

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

function artHref(src) {
  return typeof src === 'string' ? src.replace(/^\//, './') : '';
}

function buildBoard() {
  if (!boardMap) return;
  boardEl.innerHTML = '';
  cells.length = 0;
  cellById.clear();
  startCellIds = new Set();

  const art = boardMap.art || {};
  const src = boardMap.editorSource?.art || {};
  // viewBox — в пропорции ИСХОДНОЙ карты (центры нормированы к ней). Арт (target)
  // растягивается в это пространство и масштабируется scaleX/scaleY от (0,0) —
  // как backdrop в редакторе; так калибровка scaleX/scaleY сходится один-в-один.
  const srcAspect = (src.width && src.height) ? src.height / src.width
    : (art.width && art.height ? art.height / art.width : 0.75);
  VBW = 1000;
  VBH = Math.round(VBW * srcAspect);

  // Радиус гекса из карты (нормирован к max целевой карты) → в долю исходной ширины
  const tgtMax = Math.max(art.width || 1, art.height || 1);
  const srcW = src.width || art.width || 1;
  HEX_R = (boardMap.hex?.radius ?? 0.012) * (tgtMax / srcW) * VBW;

  const centers = boardMap.editorSource?.centers ?? {};
  for (const c of boardMap.cells) {
    const ctr = c.center ?? centers[c.id];
    if (!ctr) continue;
    const cx = ctr.u * VBW, cy = ctr.v * VBH;
    const cell = {
      id: c.id,
      cx,
      cy,
      neighbors: c.neighbors || [],
      terrain: c.terrain || null,
      pointClass: c.pointClass || null,
      deck: c.deck || null,
      side: c.side || null,
    };
    cells.push(cell);
    cellById.set(c.id, cell);
  }

  for (const side of Object.keys(boardMap.starts || {})) {
    for (const id of Object.values(boardMap.starts[side] || {})) {
      if (id) startCellIds.add(id);
    }
  }

  boardSvg = document.createElementNS(svgNS, 'svg');
  boardSvg.setAttribute('class', 'board-svg');
  boardSvg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`);
  boardSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Вьюпорт: пан/зум применяются трансформом к этой группе (арт+клетки+фишки)
  boardVp = document.createElementNS(svgNS, 'g');
  boardVp.setAttribute('class', 'board-vp');
  boardSvg.appendChild(boardVp);

  if (art.src) {
    // Арт растягивается в source-пространство и масштабируется scaleX/scaleY
    // от левого-верхнего угла (повторяет backdrop редактора).
    const img = document.createElementNS(svgNS, 'image');
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', artHref(art.src));
    img.setAttribute('href', artHref(art.src));
    img.setAttribute('x', 0);
    img.setAttribute('y', 0);
    img.setAttribute('width', VBW * (art.scaleX ?? 1));
    img.setAttribute('height', VBH * (art.scaleY ?? 1));
    img.setAttribute('preserveAspectRatio', 'none');
    boardVp.appendChild(img);
  }

  for (const c of cells) {
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('class', cellClassName(c));
    poly.setAttribute('points', hexPoints(c.cx, c.cy, HEX_R));
    poly.setAttribute('data-id', c.id);
    applyCellDisplay(poly, c);
    poly.addEventListener('click', () => { if (!gestureMoved) handleCellClick(c.id); });
    boardVp.appendChild(poly);
  }

  // Иконки колод (deckMarkers): картинка на клетке; размер = радиус·2·size,
  // оффсет — в долях радиуса. Поверх клеток, под фишками.
  const dm = boardMap.deckMarkers || {};
  const markerSize = HEX_R * 2 * (dm.size ?? 1.6);
  const markerOffsets = boardMap.editorSource?.markerOffsets ?? {};
  const assetRoot = artHref(dm.assetRoot || '/assets/cards/backs/markers');
  for (const c of boardMap.cells) {
    if (!c.marker?.class) continue;
    const ctr = cellById.get(c.id);
    if (!ctr) continue;
    const off = markerOffsets[c.id] ?? c.marker.offset ?? { x: 0, y: 0 };
    const href = `${assetRoot}/${c.marker.class}.png`;
    const mk = document.createElementNS(svgNS, 'image');
    mk.setAttribute('class', `deck-marker deck-marker--${c.marker.class}`);
    mk.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    mk.setAttribute('href', href);
    mk.setAttribute('x', (ctr.cx + (off.x || 0) * HEX_R - markerSize / 2).toFixed(2));
    mk.setAttribute('y', (ctr.cy + (off.y || 0) * HEX_R - markerSize / 2).toFixed(2));
    mk.setAttribute('width', markerSize.toFixed(2));
    mk.setAttribute('height', markerSize.toFixed(2));
    mk.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    mk.setAttribute('pointer-events', 'none');
    boardVp.appendChild(mk);
  }

  boardEl.appendChild(boardSvg);
  attachBoardGestures();
  applyView();
}

// ── Пан / зум / автофокус ─────────────────────────────────────────
function cellClassName(cell) {
  const classes = ['cell'];
  if (cell?.terrain) classes.push(`terrain-${cell.terrain}`);
  if (cell?.pointClass) classes.push(`point-${cell.pointClass.replaceAll('_', '-')}`);
  return classes.join(' ');
}

function applyCellDisplay(poly, cell) {
  const display = boardMap.display || {};
  const colors = display.colors || {};
  const fill = colors.points?.[cell.pointClass]
    || colors.decks?.[cell.deck]
    || colors.sides?.[cell.side]
    || colors.terrain?.[cell.terrain]
    || '#dbe8f7';
  const colored = Boolean(
    cell.pointClass || cell.deck || cell.side || (cell.terrain && cell.terrain !== 'path'),
  );

  poly.style.setProperty('--cell-fill', fill);
  poly.style.setProperty(
    '--cell-fill-opacity',
    String(colored ? (display.coloredCellOpacity ?? 0.45) : (display.cellOpacity ?? 0.22)),
  );
  poly.style.setProperty('--cell-stroke', display.cellStrokeColor || '#e8f0ff');
  poly.style.setProperty('--cell-stroke-opacity', String(display.cellStrokeOpacity ?? 1));
}

function applyView() {
  if (boardVp) {
    boardVp.setAttribute('transform',
      `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.s.toFixed(4)})`);
  }
}

function clampView() {
  view.s = Math.max(MIN_S, Math.min(MAX_S, view.s));
  view.tx = Math.max(VBW - VBW * view.s, Math.min(0, view.tx));
  view.ty = Math.max(VBH - VBH * view.s, Math.min(0, view.ty));
}

// px на единицу viewBox (учитывает текущий масштаб подгонки)
function svgK() {
  const rect = boardSvg.getBoundingClientRect();
  return { rect, k: (rect.width / VBW) || 1 };
}

function attachBoardGestures() {
  boardEl.addEventListener('pointerdown', onPtrDown);
  boardEl.addEventListener('pointermove', onPtrMove);
  boardEl.addEventListener('pointerup', onPtrUp);
  boardEl.addEventListener('pointercancel', onPtrUp);
}

function onPtrDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gestureMoved = false;
  if (ptrs.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    pinchStart = null;
  } else if (ptrs.size === 2) {
    startPinch();
  }
}

function startPinch() {
  const [a, b] = [...ptrs.values()];
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const { rect, k } = svgK();
  const vbMidX = ((a.x + b.x) / 2 - rect.left) / k;
  const vbMidY = ((a.y + b.y) / 2 - rect.top) / k;
  pinchStart = {
    dist,
    s: view.s,
    cpX: (vbMidX - view.tx) / view.s,
    cpY: (vbMidY - view.ty) / view.s,
  };
  panStart = null;
}

function onPtrMove(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (ptrs.size >= 2 && pinchStart) {
    boardEl.setPointerCapture?.(e.pointerId);
    const [a, b] = [...ptrs.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const { rect, k } = svgK();
    view.s = Math.max(MIN_S, Math.min(MAX_S, pinchStart.s * (dist / pinchStart.dist)));
    const vbMidX = ((a.x + b.x) / 2 - rect.left) / k;
    const vbMidY = ((a.y + b.y) / 2 - rect.top) / k;
    view.tx = vbMidX - pinchStart.cpX * view.s;
    view.ty = vbMidY - pinchStart.cpY * view.s;
    clampView();
    applyView();
    gestureMoved = true;
  } else if (ptrs.size === 1 && panStart) {
    const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
    if (!gestureMoved && Math.hypot(dx, dy) <= 8) return;
    gestureMoved = true;
    boardEl.setPointerCapture?.(e.pointerId);
    const { k } = svgK();
    view.tx = panStart.tx + dx / k;
    view.ty = panStart.ty + dy / k;
    clampView();
    applyView();
  }
}

function onPtrUp(e) {
  if (boardEl.hasPointerCapture?.(e.pointerId)) {
    boardEl.releasePointerCapture(e.pointerId);
  }
  ptrs.delete(e.pointerId);
  if (ptrs.size === 1) {
    const [p] = [...ptrs.values()];
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty };
    pinchStart = null;
  } else if (ptrs.size === 0) {
    panStart = null; pinchStart = null;
  }
}

// Кадрировать набор клеток (по id) с отступом
function focusCells(ids, padFactor = 2.5, maxScale = MAX_S) {
  if (!boardVp) return;
  const pts = ids.map(id => cellById.get(id)).filter(Boolean);
  if (!pts.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.cx); maxX = Math.max(maxX, p.cx);
    minY = Math.min(minY, p.cy); maxY = Math.max(maxY, p.cy);
  }
  const pad = HEX_R * padFactor;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  view.s = Math.max(MIN_S, Math.min(maxScale, Math.min(VBW / bw, VBH / bh)));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  view.tx = VBW / 2 - cx * view.s;
  view.ty = VBH / 2 - cy * view.s;
  clampView();
  applyView();
}

function focusMine() {
  const ids = (getGame()?.characters ?? [])
    .filter(c => c.owner === myPlayerId)
    .map(c => characterPosition(c))
    .filter(Boolean);
  if (ids.length) focusCells(ids, 4, 2.5);
}

function fitAll() {
  view = { s: MIN_S, tx: 0, ty: 0 };
  applyView();
}

function layoutBoard() {
  const w = VBW * scale, h = VBH * scale;
  boardEl.style.width = `${w}px`;
  boardEl.style.height = `${h}px`;
  boardSvg.setAttribute('width', w);
  boardSvg.setAttribute('height', h);
}

function fitBoard() {
  if (!boardSvg) return;
  const wrap = boardEl.parentElement; if (!wrap) return;
  const cs = getComputedStyle(wrap);
  const avW = wrap.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const avH = wrap.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
  scale = Math.max(0.05, Math.min(avW / VBW, avH / VBH));
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
    if (prevChar && char.hp < prevChar.hp) {
      const damage = prevChar.hp - char.hp;
      const owner = nextRoom.players.find(p => p.id === char.owner);
      const prefix = char.owner === myPlayerId ? '' : `${owner?.name ?? 'Противник'}: `;
      addLog(
        `${prefix}${ROLE_NAMES[char.role]} получает ${damage} урона. HP: ${char.hp}.`,
        { type: char.owner === myPlayerId ? 'my' : 'opp' },
      );
      if (char.hp === 0) {
        addLog(`${prefix}${ROLE_NAMES[char.role]} выбыл из игры.`, { type: 'sys' });
      }
    }
    if (!prevChar || prevChar.position === char.position) continue;
    if (!char.position) continue;
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
