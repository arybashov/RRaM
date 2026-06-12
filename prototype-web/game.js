// RRaM Web Client — тонкий клиент, всё состояние на сервере.
// Движение пока локальное (сервер ждёт карту), кубики/карты/ходы — сервер.

// ── Конфигурация ──────────────────────────────────────────────────
const SERVER_URL = new URLSearchParams(location.search).get('server')
  ?? localStorage.getItem('rram_server')
  ?? 'wss://rram.com.ru/ws';

const SESSION_KEY = 'rram_session';

// ── Константы ─────────────────────────────────────────────────────
const ROLE_NAMES = { K: 'Кузнец', P: 'Помощник', V: 'Воин', O: 'Охотник', S: 'Шаман' };
const TELEPORT_ID = 'teleport_beads'; // id карты «Бусы телепортации» (сервер шлёт инвентарь как {id,name,type})
const ROLE_ART   = { K: 'blacksmith', P: 'assistant', V: 'warrior', O: 'hunter', S: 'shaman' };
const TOKEN_ART = {
  green: {
    K: 'blacksmith-figure-v1', P: 'assistant-figure-v1', V: 'warrior-figure-v2',
    O: 'hunter-figure-v1', S: 'shaman-figure-v1',
  },
  red: {
    K: 'blacksmith-figure-v1', P: 'assistant-figure-v1', V: 'warrior-figure-v1',
    O: 'hunter-figure-v1', S: 'shaman-figure-v1',
  },
};

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
let eventOverlayEl = null;            // окно находки карты
let eventOverlayCardEl = null;
let view = { s: 1, tx: 0, ty: 0 };    // зум и сдвиг в координатах viewBox
const MIN_S = 1, MAX_S = 6;
let gestureMoved = false;             // был ли drag/pinch (чтобы не считать его тапом)
const ptrs = new Map();               // активные указатели (touch/mouse)
let panStart = null, pinchStart = null;

// ── DOM ───────────────────────────────────────────────────────────
const boardEl        = document.querySelector('#board');
const charactersEl   = document.querySelector('#characters');
const inventoryEl    = document.querySelector('#inventory');
const inventoryTitleEl = document.querySelector('#inventoryTitle');
const logEl          = document.querySelector('#log');
const turnInfoEl     = document.querySelector('#turnInfo');
const diceHintEl     = document.querySelector('#diceHint');
const endTurnBtn     = document.querySelector('#endTurnBtn');
const dieButtons     = [document.querySelector('#die1'), document.querySelector('#die2')];

// Кнопка боя со зверем (красные клетки) — в index.html её нет, создаём из JS.
// Спрятана по умолчанию; видимость управляется в renderDice().
const fightBeastBtn = document.createElement('button');
fightBeastBtn.id = 'fightBeastBtn';
fightBeastBtn.type = 'button';
fightBeastBtn.textContent = '🐗 Бить зверя';
fightBeastBtn.hidden = true;
endTurnBtn?.before(fightBeastBtn);
fightBeastBtn.addEventListener('click', () => fightBeast());

// Лобби-DOM (создаётся динамически)
let lobbyEl, nameInput, createBtn, vsAiBtn,
    lobbyStatusEl, connBadgeEl, connRttEl, menuEl, menuBtn;
let settingsEl = null;
let matchResultEl = null;
let settingsReturnTo = 'lobby';
let reconnectTimer = null;
let cardBoxEl = null;        // оверлей «ящик» с картами команды
let cbxDrag = null;          // активное перетаскивание: { fromId, cardIndex, ghost, srcEl }
let combatEl = null, combatBtn = null; // экран боя + кнопка переоткрытия в шапке
let combatDismissed = false; // игрок свернул экран текущего боя
let combatActiveId = null;   // id моего бойца в текущем бою (для детекта нового боя)
let combatPreview = null;    // { mineId, enemyId } — окно боя ДО первой атаки (клик по врагу рядом)
let pendingApproach = null;  // { mineId, enemyId, until } — идём к врагу, бой откроется по прибытии
let heartbeatTimer = null;
let lastServerMsgAt = 0;
let pingSentAt = 0;         // метка времени последнего ping (для RTT)
let lastRtt = null;         // последний измеренный round-trip, мс
const HEARTBEAT_MS = 3000;  // ping каждые 3с (keepalive + живой замер RTT)
const STALE_MS = 28000;     // нет ни одного сообщения от сервера дольше → сокет мёртв

const NAME_KEY = 'rram_player_name';
const APP_VERSION = '20260611-27'; // единый источник; держать в синхроне с ?v= в index.html

// ── Старт ─────────────────────────────────────────────────────────
showAppVersion();
inventoryEl?.addEventListener('click', onInventoryClick);
// Игровой чат — поле в шторке журнала
{
  const gameChatInput = document.querySelector('#gameChatInput');
  const gameChatSendBtn = document.querySelector('#gameChatSend');
  const sendGameChat = () => {
    const text = gameChatInput?.value.trim();
    if (!text) return;
    wsSend('chat:send', { text, name: name() });
    gameChatInput.value = '';
    gameChatSendBtn?.classList.remove('visible');
  };
  gameChatSendBtn?.addEventListener('click', sendGameChat);
  gameChatInput?.addEventListener('input', () => {
    if (gameChatInput.value.trim()) {
      gameChatSendBtn?.classList.add('visible');
    } else {
      gameChatSendBtn?.classList.remove('visible');
    }
  });
  gameChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendGameChat(); }
  });
}
buildCardBox();
buildEventOverlay();
buildLobbyOverlay();
buildCombatScene();
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

// Версия в углу мелким шрифтом (для отладки «какая сборка у игрока»).
function showAppVersion() {
  const el = document.createElement('div');
  el.className = 'app-version';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = `v${APP_VERSION}`;
  document.body.appendChild(el);
}

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
    startHeartbeat();
    const saved = loadSession();
    if (saved) { pendingResume = true; wsSend('session:resume', saved); }
  };
  ws.onmessage = (e) => {
    lastServerMsgAt = Date.now(); // любое сообщение (вкл. pong) = сокет жив
    try { handleMsg(JSON.parse(e.data)); } catch {}
  };
  ws.onclose   = () => {
    if (ws === sock) { ws = null; }
    stopHeartbeat();
    setConnStatus('disconnected');
    scheduleReconnect();
  };
  ws.onerror   = () => setConnStatus('error');
}

// Heartbeat: шлём ping; если от сервера давно тишина — сокет «полуоткрытый»
// (onclose не выстрелил), форсим переподключение вручную.
function startHeartbeat() {
  stopHeartbeat();
  lastServerMsgAt = Date.now();
  const sendPing = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastServerMsgAt > STALE_MS) {
      forceReconnect();
      return;
    }
    pingSentAt = Date.now();
    wsSend('ping');
  };
  sendPing();                                   // сразу замерить, не ждать 3с
  heartbeatTimer = setInterval(sendPing, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// Принудительный разрыв и переподключение (мёртвый сокет / ручная кнопка).
// session:resume уйдёт автоматически в onopen, партия восстановится.
function forceReconnect() {
  stopHeartbeat();
  const sock = ws;
  ws = null;
  if (sock) { try { sock.onclose = null; sock.close(); } catch {} }
  setConnStatus('connecting');
  connect();
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

    case 'action:result':
      handleActionResult(payload);
      break;

    case 'chat:message':
      // Чат только в игре (room scope) — в журнал
      if (payload?.scope === 'room') {
        addLog(`💬 ${escapeHtml(payload.name ?? 'Игрок')}: ${escapeHtml(payload.text ?? '')}`, { type: 'chat' });
        renderLog();
      }
      break;

    case 'pong': // keepalive-ответ; живость отмечена в onmessage, тут считаем RTT
      if (pingSentAt) { lastRtt = Date.now() - pingSentAt; pingSentAt = 0; renderRtt(); }
      break;

    case 'server:connected':
      checkClientVersion(payload?.serverVersion);
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
      // Восстанавливаем логи при переподключении
      restoreFromLog();
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

function tokenArtHref(char) {
  const side = charSide(char);
  const art = TOKEN_ART[side]?.[char.role] ?? TOKEN_ART.green.V;
  return `./assets/tokens/${side}/${art}.png`;
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
        <div class="lobby-version">сборка v${APP_VERSION}</div>
        <p class="lobby-sub">Настольная игра онлайн</p>
        <div id="lobbyStatus" class="lobby-status"></div>
        <input id="playerName" type="text" placeholder="Ваше имя" maxlength="32" autocomplete="off" />
        <div id="lobbyList" class="lobby-list">
          <div class="lobby-list-title">Открытые игры</div>
          <div id="lobbyListItems" class="lobby-list-items"></div>
        </div>
        <div class="lobby-btns">
          <button id="createBtn">Создать партию</button>
          <button id="vsAiBtn" class="lobby-vsai-btn">Против ИИ</button>
        </div>
        <div id="codeDisplay" class="lobby-code hidden">
          <span class="lobby-code-hint">Ожидание второго игрока — партия видна в списке</span>
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
  createBtn     = lobbyEl.querySelector('#createBtn');
  vsAiBtn       = lobbyEl.querySelector('#vsAiBtn');
  lobbyStatusEl = lobbyEl.querySelector('#lobbyStatus');

  // Восстановить сохранённое имя
  nameInput.value = localStorage.getItem(NAME_KEY) || '';
  nameInput.addEventListener('input', () => localStorage.setItem(NAME_KEY, nameInput.value.trim()));

  createBtn.addEventListener('click', () => {
    if (!ws) { connect(); setLobbyStatus('Подключение… попробуйте ещё раз через секунду.'); return; }
    wsSend('room:create', { playerName: name(), public: true });
  });
  vsAiBtn.addEventListener('click', () => {
    if (!ws) { connect(); setLobbyStatus('Подключение… попробуйте ещё раз через секунду.'); return; }
    wsSend('room:create', { playerName: name(), vsBot: true });
  });
  lobbyEl.querySelector('#cancelWaitBtn').addEventListener('click', cancelWaitingRoom);

  // Настройки — открывают отдельный оверлей
  lobbyEl.querySelector('#settingsBtn').addEventListener('click', () => openSettings('lobby'));

  const reconnectBtn = lobbyEl.querySelector('#reconnectBtn');
  reconnectBtn.addEventListener('click', forceReconnect);

  // Значок соединения, счётчик RTT и кнопка меню — в правой части шапки
  const tbRight = document.querySelector('.topbar .tb-right');
  connRttEl = document.createElement('span');
  connRttEl.id = 'connRtt';
  connRttEl.className = 'conn-rtt';
  connRttEl.title = 'Задержка до сервера (round-trip)';
  tbRight.appendChild(connRttEl);
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
  lobbyEl.querySelector('#lobbyList').classList.remove('hidden');
  createBtn.disabled = false;
  vsAiBtn.disabled   = false;
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
      <button id="menuReconnectBtn" class="ghost">⟳ Переподключиться</button>
      <button id="menuNewBtn" class="ghost">🚪 Выйти в лобби</button>
      <button id="menuSettingsBtn" class="ghost">⚙ Настройки</button>
    </div>
  `;
  document.body.appendChild(menuEl);

  menuEl.querySelector('#menuResumeBtn').addEventListener('click', hideGameMenu);

  // Ручное восстановление, если у игрока всё «подвисло» (мёртвый сокет/стейт)
  menuEl.querySelector('#menuReconnectBtn').addEventListener('click', () => {
    hideGameMenu();
    forceReconnect();
  });

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

// ── Проверка версии клиент/сервер ─────────────────────────────────
// Частая беда: у игрока закэширована старая сборка и «ничего не работает».
// Сервер сообщает свою версию при подключении; при расхождении блокируем
// лобби баннером и просим обновиться (один авто-релоад с обходом кэша).
let versionMismatch = false;

function checkClientVersion(serverVersion) {
  if (!serverVersion || serverVersion === APP_VERSION) {
    versionMismatch = false;
    document.getElementById('versionBanner')?.remove();
    return;
  }
  versionMismatch = true;
  // Авто-релоад один раз на каждую серверную версию (без бесконечного цикла)
  const key = 'rram_reloaded_for';
  if (sessionStorage.getItem(key) !== serverVersion) {
    sessionStorage.setItem(key, serverVersion);
    hardReload();
    return;
  }
  showVersionBanner(serverVersion);
}

// Перезагрузка с обходом кэша: меняем query документа → браузер тянет свежий
// index.html (а с ним новые ?v= для game.js/styles.css). Параметр ?server= храним.
function hardReload() {
  const url = new URL(location.href);
  url.searchParams.set('_v', String(Date.now()));
  location.replace(url.toString());
}

function showVersionBanner(serverVersion) {
  let el = document.getElementById('versionBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'versionBanner';
    el.className = 'version-banner';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <span>⚠ Версия игры устарела — обновите страницу.
      <b>У вас v${APP_VERSION}, на сервере v${escapeHtml(serverVersion)}</b></span>
    <button id="versionReloadBtn">⟳ Обновить</button>`;
  el.querySelector('#versionReloadBtn').addEventListener('click', hardReload);
  // На старом клиенте партия всё равно сломается — блокируем старт
  if (createBtn) createBtn.disabled = true;
  if (vsAiBtn) vsAiBtn.disabled = true;
}

// Режим ожидания второго игрока (вход — только из списка открытых игр)
function showRoomCode() {
  lobbyEl.querySelector('#viewHome').classList.add('is-waiting');
  lobbyEl.querySelector('#codeDisplay').classList.remove('hidden');
  lobbyEl.querySelector('#lobbyList').classList.add('hidden');
  createBtn.disabled = true;
  vsAiBtn.disabled   = true;
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

  stopHeartbeat();
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
  if (s !== 'connected') lastRtt = null; // не показываем устаревший RTT при разрыве
  renderRtt();
}

// Счётчик задержки до сервера (round-trip) в шапке
function renderRtt() {
  if (!connRttEl) return;
  if (lastRtt == null || ws?.readyState !== WebSocket.OPEN) {
    connRttEl.textContent = '';
    connRttEl.className = 'conn-rtt';
    return;
  }
  connRttEl.textContent = `${lastRtt} мс`;
  const q = lastRtt < 150 ? 'good' : lastRtt < 600 ? 'mid' : 'bad';
  connRttEl.className = `conn-rtt rtt-${q}`;
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
      if (getGame().turn.movementArea) return;
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
    // «Передать» открывает «ящик» (drag-and-drop) — всегда доступно для просмотра
    if (mode === 'transfer') {
      openCardBox();
      return;
    }
    // «Взять карту» — прямое действие, а не переключение режима
    if (mode === 'draw') { directCardAction(mode); return; }

    setLocalMode(mode);
    render();
  });
});

endTurnBtn.addEventListener('click', () => wsSend('turn:end'));

function setLocalMode(mode) {
  if (getGame()?.turn.movementArea) return;
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

// Бой со зверем (красная клетка): тратим свободный кубик на удар.
// Серверу нужен split-режим — переключаем перед отправкой, как в directCardAction.
function fightBeast() {
  if (!isMyTurn() || !getDice()) return;
  const char = getSelChar();
  if (!char?.beastFight) return;

  const used = getGame().turn.usedDice;
  const dieIndex = used[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
  if (used[dieIndex]) { addLog('Оба кубика потрачены.', { type: 'err' }); render(); return; }

  if (getServMode() !== 'split') wsSend('turn:setMode', { mode: 'split' });
  wsSend('action:fightBeast', { characterId: char.id, dieIndex });
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
    if (!inv.some(c => c.id === TELEPORT_ID) || !isStartCell(targetId)) return;
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

// Если выбранный кубик уже потрачен — автоматически перейти на свободный
// и показать клетки хода сразу, без лишнего клика по кубику.
function syncDieSelection() {
  const g = getGame();
  if (!g?.turn.dice) return;
  if (g.turn.movementArea) {
    localMode = g.turn.movementArea.mode === 'moveSum' ? 'moveSum' : 'moveDie';
    if (g.turn.movementArea.dieIndex != null) {
      selectedDieIdx = g.turn.movementArea.dieIndex;
    }
    return;
  }
  const used = g.turn.usedDice;
  if (used[selectedDieIdx] && !used[1 - selectedDieIdx]) {
    selectedDieIdx = 1 - selectedDieIdx;
    if (localMode === 'moveSum') localMode = 'moveDie';
  }
}

function render() {
  syncDieSelection();
  renderTopbar();
  renderDice();
  renderBoard();
  renderCharacters();
  renderInventory();
  renderLog();
  if (cardBoxEl && !cardBoxEl.classList.contains('hidden')) renderCardBox();
  updateCombatScene();
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

const transferModeBtn = document.querySelector('.mode[data-mode="transfer"]');
const teleportModeBtn = document.querySelector('.mode[data-mode="teleport"]');
const drawModeBtn     = document.querySelector('.mode[data-mode="draw"]');

function renderDice() {
  const g = getGame();
  if (!g) {
    dieButtons.forEach(b => { b.textContent = '–'; b.disabled = true; b.className = 'die'; });
    fightBeastBtn.hidden = true;
    if (transferModeBtn) transferModeBtn.disabled = true;
    if (drawModeBtn) drawModeBtn.disabled = true;
    if (teleportModeBtn) teleportModeBtn.disabled = true;
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
    // «🎲» только когда реально можно бросить; потрачено всё — «–»
    btn.textContent = dice ? dice[i] : (canRoll ? '🎲' : '–');
    btn.disabled    = dice ? (!myTurn || used[i]) : !canRoll;
    btn.className   = 'die';
    if (canRoll)                                               btn.classList.add('rollable');
    const movementDie = g.turn.movementArea?.mode === 'split'
      && g.turn.movementArea.dieIndex === i;
    if (dice && ((!used[i] && selectedDieIdx === i && localMode !== 'moveSum') || movementDie)) {
      btn.classList.add('selected');
    }
    if (dice && used[i])                                       btn.classList.add('used');
  });

  // Кубики потрачены, бросать больше нельзя — подсветить «Конец хода»
  endTurnBtn.classList.toggle('attention', myTurn && !dice && g.turn.hasRolled);

  // «Передать» открывает «ящик» — теперь всегда доступно для просмотра карт команды
  if (transferModeBtn) {
    transferModeBtn.disabled = false;
    const canTrans = myTurn && (dice || transferRemaining() > 0);
    transferModeBtn.title = canTrans ? 'Передача карт между персонажами' : 'Просмотр карт команды (передача недоступна)';
  }
  // «Карта» — добор один раз за бросок
  if (drawModeBtn) {
    const free = dice && (!used[0] || !used[1]);
    drawModeBtn.disabled = !(myTurn && free && !g.turn.drawnThisTurn);
    drawModeBtn.title = g.turn.drawnThisTurn
      ? 'Карту в этом броске уже брали — второй кубик потратьте на другое действие'
      : 'Взять карту из колоды (тратит кубик)';
  }
  // «Телепорт» активен только если у выбранного персонажа есть Бусы (и нужны оба свободных кубика)
  if (teleportModeBtn) {
    const sel = getSelChar();
    const hasBeads = sel?.inventory?.some(c => c.id === TELEPORT_ID);
    const bothFree = dice && !used[0] && !used[1];
    teleportModeBtn.disabled = !(myTurn && hasBeads && bothFree);
    teleportModeBtn.title = hasBeads
      ? 'Телепорт на стартовую клетку (нужны оба кубика)'
      : 'У выбранного персонажа нет Бус телепортации';
  }

  // «Бить зверя»: показываем только когда выбранный персонаж дерётся со зверем
  // и есть хотя бы один свободный кубик в мой ход.
  const selBeast = getSelChar()?.beastFight;
  fightBeastBtn.hidden = !(myTurn && dice && selBeast && (!used[0] || !used[1]));
}

function renderBoard() {
  if (!boardSvg) return;
  boardSvg.querySelectorAll('.token').forEach(n => n.remove());
  const sel    = getSelChar();
  const valid  = sel ? validTargets(sel) : new Set();
  const game   = getGame();

  renderFog(null); // туман войны отключён (пока); вернуть: renderFog(fogVisibleCells())
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
  const charactersByDepth = [...game.characters].sort((a, b) => {
    const aPos = tokenDisplayPos.get(a.id) ?? characterPosition(a);
    const bPos = tokenDisplayPos.get(b.id) ?? characterPosition(b);
    return (cellCenter(aPos)?.cy ?? -Infinity) - (cellCenter(bPos)?.cy ?? -Infinity);
  });
  for (const char of charactersByDepth) {
    const pos  = tokenDisplayPos.get(char.id) ?? characterPosition(char);
    const ctr  = cellCenter(pos);
    if (!ctr) continue;
    const { cx, cy } = ctr;
    const g = document.createElementNS(svgNS, 'g');
    const isOwn = char.owner === myPlayerId;
    const tokenClasses = ['token', `side-${charSide(char)}`, `role-${char.role}`];
    if (isOwn) tokenClasses.push('own');
    if (char.combatOpponentId) tokenClasses.push('in-combat');
    if (char.beastFight) tokenClasses.push('beast-fight');
    if (attackTargets.has(char.id)) tokenClasses.push('attackable');
    if (char.id === selectedCharId) tokenClasses.push('active');
    g.setAttribute('class', tokenClasses.join(' '));
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    const myInCombat = getMyChars().find(c => c.combatOpponentId === char.id);
    const isAttackable = attackTargets.has(char.id);
    const adjacentChar = getMyChars().find(c => {
      const cPos = characterPosition(c);
      const targetPos = characterPosition(char);
      return cPos && targetPos && hexNeighbors(cPos).includes(targetPos);
    });

    if (isOwn) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Выбрать: ${ROLE_NAMES[char.role]}`);
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        if (gestureMoved) return;
        reopenCombatFor(char); // тап по воюющей фишке возвращает в бой
        selectCharacter(char.id);
      });
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectCharacter(char.id);
      });
    } else {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', isAttackable ? `Атаковать: ${ROLE_NAMES[char.role]}` : `Враг: ${ROLE_NAMES[char.role]}`);

      const onEnemyClick = (event) => {
        event.stopPropagation();
        if (gestureMoved) return;
        // Уже в бою с этим врагом — вернуться в сцену
        if (myInCombat) {
          selectCharacter(myInCombat.id);
          reopenCombatFor(myInCombat);
          render();
          return;
        }
        // Враг рядом — открываем окно боя (атака — кнопкой из окна, не сразу)
        const mineChar = (isAttackable ? getSelChar() : null) ?? adjacentChar;
        if (mineChar) {
          selectedCharId = mineChar.id;
          openCombatPreview(mineChar.id, char.id);
          return;
        }
        // Враг дальше: если он в досягаемости броска (кубики + 1 клетка рядом) —
        // подходим вплотную, окно боя откроется по прибытии
        const sel = getSelChar();
        if (sel && isMyTurn() && getDice()) {
          const turn = getGame().turn;
          if (turn.movedCharacterId && turn.movedCharacterId !== sel.id) {
            addLog('В этом броске уже двигался другой персонаж.', { type: 'err' });
            return;
          }
          const plan = planApproach(sel, char);
          if (plan) {
            pendingApproach = { mineId: sel.id, enemyId: char.id, until: Date.now() + 4000 };
            if (getServMode() !== plan.mode) wsSend('turn:setMode', { mode: plan.mode });
            wsSend('action:move', plan.payload);
            addLog(`${ROLE_NAMES[sel.role]} идёт к врагу: ${ROLE_NAMES[char.role]}…`, { type: 'my' });
            return;
          }
          addLog(`До ${ROLE_NAMES[char.role]} не дотянуться этим броском.`, { type: 'sys' });
          return;
        }
        addLog(`Враг: ${ROLE_NAMES[char.role]} (${char.hp} HP).`, { type: 'sys' });
      };
      g.addEventListener('click', onEnemyClick);
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onEnemyClick(event);
      });
    }
    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('class', 'token-halo');
    halo.setAttribute('r', (HEX_R * 0.74).toFixed(1));

    const figure = document.createElementNS(svgNS, 'image');
    const figureWidth = HEX_R * 3.38;
    const figureHeight = HEX_R * 4.6475;
    const figureHref = tokenArtHref(char);
    figure.setAttribute('class', 'token-figure');
    figure.setAttributeNS('http://www.w3.org/1999/xlink', 'href', figureHref);
    figure.setAttribute('href', figureHref);
    figure.setAttribute('x', (-figureWidth / 2).toFixed(2));
    figure.setAttribute('y', (-figureHeight * 0.7).toFixed(2));
    figure.setAttribute('width', figureWidth.toFixed(2));
    figure.setAttribute('height', figureHeight.toFixed(2));
    figure.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const glow = figure.cloneNode();
    glow.setAttribute('class', 'token-glow');

    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${ROLE_NAMES[char.role]} — ${char.hp} HP`;
    const hp = document.createElementNS(svgNS, 'text');
    hp.setAttribute('class', 'token-hp');
    hp.setAttribute('y', (HEX_R * 0.62).toFixed(1));
    hp.style.fontSize = '6.5px';
    hp.textContent = `${char.hp}`;
    g.appendChild(title);
    g.appendChild(halo);
    g.appendChild(glow);
    g.appendChild(figure);
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
    if (char.combatOpponentId) btn.classList.add('in-combat');
    btn.innerHTML = `
      <img class="portrait-img" src="./assets/characters/${side}/transparent/${ROLE_ART[char.role]}.png" alt="${ROLE_NAMES[char.role]}" />
      <strong>${ROLE_NAMES[char.role]}</strong>
      <span class="meta">HP ${hp} · ${cards} карт${char.combatOpponentId ? ' · БОЙ' : ''}${char.beastFight ? ' · ЗВЕРЬ' : ''}</span>
    `;
    btn.addEventListener('click', () => {
      reopenCombatFor(char); // тап по карточке воюющего персонажа возвращает в бой
      selectCharacter(char.id);
    });
    charactersEl.appendChild(btn);
  }
}

const expandedCards = new Set(); // индексы раскрытых карт текущего инвентаря
let invExpandedFor = null;       // для какого персонажа набор актуален

function renderInventory() {
  const char = getSelChar();
  if (inventoryTitleEl) inventoryTitleEl.textContent = char ? ROLE_NAMES[char.role] : 'Персонаж';
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
  if (char.id !== invExpandedFor) { expandedCards.clear(); invExpandedFor = char.id; }

  // Сводка по бою со зверем (красная клетка) — первым блоком, до карт
  const bf = char.beastFight;
  const beastInfo = bf
    ? `<div class="beast-info">🐗 ${escapeHtml(bf.name)} — урон ${bf.damage}/ход. `
      + `Убить: кубик ≥${bf.killOn} сразу, или ${bf.needed} успеха (≥${bf.successOn}). `
      + `Успехи: ${bf.successes}/${bf.needed}</div>`
    : '';

  // Крафт Дубины: чертёж + запертая Дубина + трофей зверя в одном инвентаре
  const canCraftClub = inv.some(c => c.id === 'bp_club_base')
    && inv.some(c => c.id === 'club' && c.locked)
    && inv.some(c => BEAST_TROPHY_IDS.includes(c.id));
  const craftInfo = canCraftClub
    ? `<div class="craft-info">🔨 Есть чертёж и трофей зверя — можно открыть Дубину! `
      + `<button id="craftClubBtn" ${isMyTurn() ? '' : 'disabled'}>Открыть Дубину</button></div>`
    : '';

  inventoryEl.className = (inv.length || bf) ? 'inventory' : 'inventory empty';
  inventoryEl.innerHTML = inv.length
    ? beastInfo + craftInfo + inv.map((c, i) => renderCard(c, i)).join('')
    : (beastInfo || 'Инвентарь пуст.');
  inventoryEl.querySelector('#craftClubBtn')?.addEventListener('click', (e) => {
    e.stopPropagation(); // не раскрывать карту под кнопкой
    wsSend('action:craft', { characterId: char.id });
  });
}

// Трофеи зверей — материал для чертежа на дубину (синхронно с сервером)
const BEAST_TROPHY_IDS = ['boar_red', 'boar_forest', 'wolf', 'beast_bear'];

const CARD_TYPE_LABELS = {
  weapon: 'оружие', armor: 'броня', tool: 'инструмент', ingredient: 'ингредиент',
  blueprint: 'чертёж', recipe: 'рецепт', companion: 'спутник', beast: 'зверь',
  special: 'особая', provocation: 'провокация',
};

function renderCard(c, i = 0, forceOpen = false) {
  // c = { id, name, type, locked, desc }; легаси-строку (если придёт) тоже покажем
  if (typeof c === 'string') return `<div class="card">${escapeHtml(c)}</div>`;
  const type = CARD_TYPE_LABELS[c.type] ?? '';
  const locked = c.locked ? '<span class="card-lock" title="Откроется после крафта">🔒</span>' : '';
  const hasDesc = Boolean(c.desc);
  const open = forceOpen || expandedCards.has(i);
  const caret = hasDesc ? `<span class="card-caret">${open ? '▾' : '▸'}</span>` : '';
  const desc = hasDesc && open ? `<div class="card-desc">${escapeHtml(c.desc)}</div>` : '';
  return `<div class="card card-${c.type ?? 'unknown'}${c.locked ? ' card-locked' : ''}${open ? ' expanded' : ''}" data-i="${i}"${hasDesc ? ' role="button" tabindex="0"' : ''}>`
    + `<div class="card-head">`
    +   `<span class="card-name">${escapeHtml(c.name)}</span>`
    +   (type ? `<span class="card-type">${type}</span>` : '')
    +   locked
    +   caret
    + `</div>`
    + desc
    + `</div>`;
}

// Тап по карте раскрывает/сворачивает её описание (делегирование — один слушатель)
function onInventoryClick(e) {
  const card = e.target.closest('.card[data-i]');
  if (!card || !inventoryEl.contains(card)) return;
  const i = Number(card.dataset.i);
  if (expandedCards.has(i)) expandedCards.delete(i); else expandedCards.add(i);
  renderInventory();
}

// ═════════════════════════════════════════════════════════════════
// «Ящик» — карты всей команды, передача перетаскиванием (drag-and-drop)
// ═════════════════════════════════════════════════════════════════

function buildCardBox() {
  cardBoxEl = document.createElement('div');
  cardBoxEl.id = 'cardBox';
  cardBoxEl.className = 'cardbox-overlay hidden';
  cardBoxEl.innerHTML = `
    <div class="cardbox">
      <div class="cardbox-head">
        <span class="cardbox-title">🧰 Карты команды</span>
        <button class="cardbox-close" id="cardBoxClose" aria-label="Закрыть">✕</button>
      </div>
      <div class="cardbox-rows" id="cardBoxRows"></div>
      <div class="cardbox-hint" id="cardBoxHint"></div>
    </div>`;
  document.body.appendChild(cardBoxEl);
  cardBoxEl.querySelector('#cardBoxClose').addEventListener('click', closeCardBox);
  cardBoxEl.addEventListener('click', (e) => { if (e.target === cardBoxEl) closeCardBox(); });
  const rows = cardBoxEl.querySelector('#cardBoxRows');
  rows.addEventListener('pointerdown', onCbxPointerDown);
  rows.addEventListener('pointermove', onCbxPointerMove);
  rows.addEventListener('pointerup', onCbxPointerUp);
  rows.addEventListener('pointercancel', onCbxPointerUp);
}

function openCardBox() {
  if (!cardBoxEl) buildCardBox();
  cardBoxEl.classList.remove('hidden');
  renderCardBox();
}

function closeCardBox() {
  cancelCbxDrag();
  cardBoxEl?.classList.add('hidden');
}

function transferRemaining() {
  return getGame()?.turn.transferRemaining ?? 0;
}

function hasFreeDie() {
  const g = getGame();
  return Boolean(g?.turn.dice && !(g.turn.usedDice[0] && g.turn.usedDice[1]));
}

function canTransferNow() {
  if (!isMyTurn()) return false;
  return transferRemaining() > 0 || hasFreeDie();
}

function renderCardBox() {
  if (!cardBoxEl) return;
  const rowsEl = cardBoxEl.querySelector('#cardBoxRows');
  rowsEl.innerHTML = getMyChars().map(renderCbxRow).join('');
  const can = canTransferNow();
  const left = transferRemaining();
  cardBoxEl.classList.toggle('can-transfer', can);
  let hint;
  if (!can) {
    hint = 'Передача — в ваш ход при свободном кубике. Сейчас доступен просмотр.';
  } else if (left > 0) {
    hint = `Передача открыта: можно переместить ещё ${left} карт${cardWordTail(left)}. Перетаскивайте.`;
  } else {
    hint = 'Перетащите карту на другого персонажа. Кубик задаёт, сколько карт можно передать (= его значению).';
  }
  cardBoxEl.querySelector('#cardBoxHint').textContent = hint;
}

// «карт» / «карту» / «карты» по числу
function cardWordTail(n) {
  const d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return 'у';
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'ы';
  return '';
}

function renderCbxRow(char) {
  const side = charSide(char);
  const inv = char.inventory ?? [];
  // Бусы телепортации — отдельный фиксированный слот справа в ряду персонажа
  // (как в физическом ящике). Берём ПОСЛЕДНИЕ Бусы в инвентаре, чтобы при
  // нескольких копиях остальные показались среди обычных карт.
  let teleI = -1;
  for (let i = inv.length - 1; i >= 0; i -= 1) {
    if ((inv[i].id ?? inv[i]) === TELEPORT_ID) { teleI = i; break; }
  }
  const otherSlots = inv
    .map((c, i) => (i === teleI ? '' : renderCbxCard(c, char.id, i)))
    .join('') || '<span class="cbx-empty">пусто</span>';
  const teleSlot = teleI >= 0
    ? renderCbxCard(inv[teleI], char.id, teleI)
    : '<div class="cbx-tele-empty" title="Слот Бус телепортации">∅</div>';
  const cell = char.position ? `<span class="cbx-cell">📍 ${char.position}</span>` : '';
  return `<div class="cbx-row" data-char-id="${char.id}">`
    + `<div class="cbx-portrait side-${side}">`
    +   `<img src="./assets/characters/${side}/transparent/${ROLE_ART[char.role]}.png" alt="${ROLE_NAMES[char.role]}" />`
    +   `<span>${ROLE_NAMES[char.role]}</span>`
    +   cell
    + `</div>`
    + `<div class="cbx-slots">${otherSlots}</div>`
    + `<div class="cbx-tele-slot">${teleSlot}</div>`
    + `</div>`;
}

function renderCbxCard(c, charId, i) {
  if (typeof c === 'string') c = { name: c, type: 'unknown', locked: false };
  const lock = c.locked ? '<span class="cbx-lock">🔒</span>' : '';
  return `<div class="cbx-card card-${c.type ?? 'unknown'}${c.locked ? ' card-locked' : ''}"`
    + ` data-char-id="${charId}" data-i="${i}" title="${escapeHtml(c.name)}">`
    + `<span class="cbx-card-name">${escapeHtml(c.name)}</span>${lock}`
    + `</div>`;
}

// ── Перетаскивание (pointer-based, работает на тач и мыши) ──
function onCbxPointerDown(e) {
  const cardEl = e.target.closest('.cbx-card');
  if (!cardEl || !canTransferNow()) return; // не свой ход / нет кубика → просто просмотр
  e.preventDefault();
  const ghost = cardEl.cloneNode(true);
  ghost.classList.add('cbx-ghost');
  document.body.appendChild(ghost);
  cardEl.classList.add('dragging');
  cbxDrag = { fromId: cardEl.dataset.charId, cardIndex: Number(cardEl.dataset.i), ghost, srcEl: cardEl };
  moveGhost(e);
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function onCbxPointerMove(e) {
  if (!cbxDrag) return;
  e.preventDefault();
  moveGhost(e);
  const row = rowUnder(e);
  cardBoxEl.querySelectorAll('.cbx-row').forEach(r =>
    r.classList.toggle('drop-target', r === row && r.dataset.charId !== cbxDrag.fromId));
}

function onCbxPointerUp(e) {
  if (!cbxDrag) return;
  const toId = rowUnder(e)?.dataset.charId;
  const { fromId, cardIndex } = cbxDrag;
  cancelCbxDrag();
  // Передача без ограничения расстояния — любому своему персонажу
  if (toId && toId !== fromId) attemptCardTransfer(fromId, toId, cardIndex);
}

function moveGhost(e) {
  if (!cbxDrag) return;
  cbxDrag.ghost.style.left = `${e.clientX}px`;
  cbxDrag.ghost.style.top = `${e.clientY}px`;
}

function rowUnder(e) {
  return document.elementFromPoint(e.clientX, e.clientY)?.closest('.cbx-row') ?? null;
}

function cancelCbxDrag() {
  if (!cbxDrag) return;
  cbxDrag.ghost?.remove();
  cbxDrag.srcEl?.classList.remove('dragging');
  cardBoxEl?.querySelectorAll('.cbx-row.drop-target').forEach(r => r.classList.remove('drop-target'));
  cbxDrag = null;
}

function attemptCardTransfer(fromId, toId, cardIndex) {
  if (!canTransferNow()) { renderCardBox(); return; }
  // Передача уже открыта (кубик потрачен) — двигаем в счёт бюджета, без кубика
  if (transferRemaining() > 0) {
    wsSend('action:transfer', { fromId, toId, cardIndex });
    return;
  }
  // Первый перенос за ход — тратим свободный кубик, его значение задаёт бюджет
  const used = getGame().turn.usedDice;
  const dieIndex = used[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
  if (used[dieIndex]) { addLog('Нет свободного кубика для передачи.', { type: 'err' }); renderCardBox(); return; }
  if (getServMode() !== 'split') wsSend('turn:setMode', { mode: 'split' });
  wsSend('action:transfer', { fromId, toId, cardIndex, dieIndex });
  // снапшот придёт и перерисует ящик
}

// ═════════════════════════════════════════════════════════════════
// Сцена боя: сверху противник (карты закрыты), снизу мой боец,
// в центре кубики и действия. Надстройка над обычными ходами.
// ═════════════════════════════════════════════════════════════════

function buildCombatScene() {
  combatEl = document.createElement('div');
  combatEl.id = 'combatScene';
  combatEl.className = 'combat-overlay hidden';
  combatEl.innerHTML = `
    <div class="combat">
      <div class="combat-head">
        <span class="combat-title">⚔ Бой</span>
        <button class="combat-min" id="combatMinBtn" title="Свернуть (бой продолжается)">— Свернуть</button>
      </div>
      <div class="combat-zone combat-enemy" id="combatEnemy"></div>
      <div class="combat-center" id="combatCenter"></div>
      <div class="combat-zone combat-mine" id="combatMine"></div>
    </div>`;
  document.body.appendChild(combatEl);
  combatEl.querySelector('#combatMinBtn').addEventListener('click', () => {
    combatDismissed = true;
    if (!myCombatChar()) combatPreview = null; // превью сворачивать незачем — закрываем
    combatEl.classList.add('hidden');
    updateCombatBtn();
  });

  // Кнопка «⚔» в шапке — вернуться к свёрнутому бою
  const tbRight = document.querySelector('.topbar .tb-right');
  combatBtn = document.createElement('button');
  combatBtn.id = 'combatBtn';
  combatBtn.className = 'topbar-combat-btn hidden';
  combatBtn.textContent = '⚔ В бою';
  combatBtn.title = 'Вернуться в бой';
  combatBtn.addEventListener('click', () => {
    combatDismissed = false;
    updateCombatScene();
  });
  tbRight?.insertBefore(combatBtn, tbRight.firstChild);
}

// Мой персонаж в бою (с игроком или зверем): выбранный, иначе первый
function myCombatChar() {
  const chars = getMyChars().filter(c => (c.combatOpponentId || c.beastFight) && c.hp > 0);
  if (!chars.length) return null;
  const sel = chars.find(c => c.id === selectedCharId);
  return sel ?? chars[0];
}

// Ключ текущего боя — чтобы заново раскрывать сцену при новой стычке
function combatKey(char) {
  return `${char.id}:${char.combatOpponentId ?? char.beastFight?.cardId ?? ''}`;
}

// Вернуться в свёрнутый бой тапом по воюющему персонажу (фишка/карточка)
function reopenCombatFor(char) {
  if (char.owner !== myPlayerId) return;
  if (!char.combatOpponentId && !char.beastFight) return;
  combatDismissed = false;
}

function updateCombatBtn() {
  combatBtn?.classList.toggle('hidden', !(myCombatChar() && combatDismissed));
}

// Открыть окно боя «противник рядом» — до первой атаки (клик по врагу)
function openCombatPreview(mineId, enemyId) {
  combatPreview = { mineId, enemyId };
  combatDismissed = false;
  render();
}

// Туман войны: клетки в радиусе FOG_RADIUS от моих живых персонажей.
// Остальной борд затемняется; врагов там сервер и так не присылает.
const FOG_RADIUS = 5;
function fogVisibleCells() {
  const g = getGame();
  if (!g) return null;
  const seen = new Set();
  for (const c of getMyChars()) {
    const p = characterPosition(c);
    if (!p || c.hp <= 0) continue;
    seen.add(p);
    const dist = new Map([[p, 0]]);
    const queue = [p];
    while (queue.length) {
      const cur = queue.shift();
      const d = dist.get(cur);
      if (d >= FOG_RADIUS) continue;
      for (const nb of hexNeighbors(cur)) {
        if (dist.has(nb)) continue;
        dist.set(nb, d + 1);
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
}

// Слой тумана: тёмный прямоугольник поверх арта с «окнами» (маска) вокруг
// видимых клеток. Лежит под фишками, клики пропускает.
function renderFog(visible) {
  if (!boardVp) return;
  let layer = boardVp.querySelector('#fogLayer');
  if (!visible) { layer?.remove(); return; }
  if (!layer) {
    layer = document.createElementNS(svgNS, 'g');
    layer.setAttribute('id', 'fogLayer');
    layer.setAttribute('pointer-events', 'none');
    layer.innerHTML = `<defs><mask id="fogMask">`
      + `<rect x="0" y="0" width="${VBW}" height="${VBH}" fill="white"/>`
      + `<g id="fogHoles"></g></mask></defs>`
      + `<rect x="0" y="0" width="${VBW}" height="${VBH}" fill="#070d16" opacity="0.82" mask="url(#fogMask)"/>`;
    boardVp.appendChild(layer);
  }
  const holes = layer.querySelector('#fogHoles');
  holes.innerHTML = [...visible].map(id => {
    const c = cellById.get(id);
    if (!c) return '';
    const cx = c.cx.toFixed(1), cy = c.cy.toFixed(1);
    // серое кольцо = полупрозрачная кромка тумана, чёрный центр = чистое окно
    return `<circle cx="${cx}" cy="${cy}" r="${(HEX_R * 2.2).toFixed(1)}" fill="#999"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${(HEX_R * 1.45).toFixed(1)}" fill="#000"/>`;
  }).join('');
}

// Кратчайшая дистанция по графу с учётом занятых клеток (зеркало серверного BFS)
function pathDistance(from, to, blocked) {
  if (from === to) return 0;
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of hexNeighbors(cur)) {
      if (dist.has(nb) || (blocked.has(nb) && nb !== to)) continue;
      dist.set(nb, dist.get(cur) + 1);
      if (nb === to) return dist.get(nb);
      queue.push(nb);
    }
  }
  return Infinity;
}

// План подхода к врагу: свободная клетка рядом с ним, достижимая этим броском.
// Предпочитаем один кубик (второй останется на действия), иначе сумму обоих.
function planApproach(sel, enemy) {
  const g = getGame();
  if (!g?.turn.dice) return null;
  const from = characterPosition(sel);
  const enemyPos = characterPosition(enemy);
  if (!from || !enemyPos) return null;
  const occupied = new Set(
    g.characters
      .filter(c => c.id !== sel.id && characterPosition(c))
      .map(c => characterPosition(c)),
  );
  let best = null; // ближайшая свободная клетка вплотную к врагу
  for (const cell of hexNeighbors(enemyPos)) {
    if (occupied.has(cell) || cell === from) continue;
    const d = pathDistance(from, cell, occupied);
    if (Number.isFinite(d) && (!best || d < best.steps)) best = { cell, steps: d };
  }
  if (!best) return null;
  const { dice, usedDice } = g.turn;
  for (const i of [selectedDieIdx, 1 - selectedDieIdx]) {
    if (usedDice[i]) continue;
    if (best.steps <= dice[i]) {
      return { mode: 'split', payload: { characterId: sel.id, toCell: best.cell, dieIndex: i } };
    }
  }
  if (!usedDice[0] && !usedDice[1] && best.steps <= dice[0] + dice[1]) {
    return { mode: 'moveSum', payload: { characterId: sel.id, toCell: best.cell } };
  }
  return null;
}

// Превью валидно, пока оба живы и стоят вплотную
function validCombatPreview() {
  if (!combatPreview) return null;
  const chars = getGame()?.characters ?? [];
  const mine = chars.find(c => c.id === combatPreview.mineId);
  const enemy = chars.find(c => c.id === combatPreview.enemyId);
  const minePos = mine && characterPosition(mine);
  const enemyPos = enemy && characterPosition(enemy);
  if (!mine || !enemy || mine.hp <= 0 || enemy.hp <= 0 || !minePos || !enemyPos) return null;
  if (!hexNeighbors(minePos).includes(enemyPos)) return null;
  return { mine, enemy };
}

// Вызывается из render(): открыть/закрыть/перерисовать сцену по снапшоту
function updateCombatScene() {
  if (!combatEl) return;
  // Шли к врагу — по прибытии (снапшот с новой позицией) открываем окно боя
  if (pendingApproach) {
    combatPreview = { mineId: pendingApproach.mineId, enemyId: pendingApproach.enemyId };
    if (validCombatPreview()) {
      pendingApproach = null;
      combatDismissed = false;
    } else {
      combatPreview = null;
      if (Date.now() > pendingApproach.until) pendingApproach = null; // не дошли — отменяем
    }
  }
  const mine = myCombatChar();
  if (mine) combatPreview = null; // реальный бой главнее превью
  if (!mine && combatPreview) {
    const pv = validCombatPreview();
    if (!pv) {
      combatPreview = null;
      combatEl.classList.add('hidden');
      updateCombatBtn();
      return;
    }
    if (combatDismissed) { combatEl.classList.add('hidden'); return; }
    combatEl.classList.remove('hidden');
    renderCombatScene(pv.mine, pv.enemy);
    return;
  }
  if (!mine) {
    combatActiveId = null;
    combatDismissed = false;
    combatEl.classList.add('hidden');
    updateCombatBtn();
    return;
  }
  const key = combatKey(mine);
  if (combatActiveId !== key) { // новый бой — показываем сцену заново
    combatActiveId = key;
    combatDismissed = false;
  }
  updateCombatBtn();
  if (combatDismissed) { combatEl.classList.add('hidden'); return; }
  combatEl.classList.remove('hidden');
  renderCombatScene(mine);
}

const BEAST_ICONS = { boar_red: '🐗', boar_forest: '🐗', wolf: '🐺', beast_bear: '🐻' };

// Лицевые карты: персонажи-орки (враг) и красные звери — арты из assets/cards
const CHAR_CARD_ART = {
  K: 'base/blacksmith/blacksmith-v1', P: 'base/assistant/assistant-v1',
  V: 'base/warrior/warrior-v3',       O: 'base/hunter/hunter-v1',
  S: 'base/shaman/shaman-v3',
};
const BEAST_CARD_ART = {
  wolf: 'beasts/red/gray-wolf-v1', beast_bear: 'beasts/red/mystical-bear-v1',
  boar_red: 'beasts/red/wild-boar-v1', boar_forest: 'beasts/red/wild-boar-v1',
};
const charCardArt  = (role) => `./assets/cards/${CHAR_CARD_ART[role] ?? 'base/warrior/warrior-v3'}.png`;
const beastCardArt = (id)   => `./assets/cards/${BEAST_CARD_ART[id] ?? 'beasts/red/wild-boar-v1'}.png`;

function renderCombatScene(mine, enemyOverride = null) {
  if (mine.beastFight) {
    combatEl.querySelector('.combat-title').textContent = '🐾 Схватка со зверем';
    renderBeastCombat(mine);
    return;
  }
  const g = getGame();
  const enemy = enemyOverride ?? g?.characters.find(c => c.id === mine.combatOpponentId);
  if (!enemy) return;
  const preview = !mine.combatOpponentId; // окно открыто до первой атаки
  combatEl.querySelector('.combat-title').textContent = preview ? '⚔ Противник рядом' : '⚔ Бой';
  const enemyOwner = serverRoom?.players.find(p => p.id === enemy.owner)?.name ?? 'Противник';

  // Верх: лицевая карта противника-орка + HP + закрытая рука
  const backs = Array.from({ length: enemy.cardCount ?? 0 }, () => '<div class="cb-back">🂠</div>').join('')
    || '<span class="cb-none">нет карт</span>';
  combatEl.querySelector('#combatEnemy').innerHTML = `
    <div class="cb-foe">
      <img class="cb-foe-card" src="${charCardArt(enemy.role)}" alt="${ROLE_NAMES[enemy.role]}" />
      <div class="cb-foe-info">
        <div class="cb-name">${ROLE_NAMES[enemy.role]} · ${escapeHtml(enemyOwner)}</div>
        <div class="cb-hpbar"><div style="width:${Math.max(0, enemy.hp)}%"></div></div>
        <div class="cb-hp">${enemy.hp} HP</div>
        <div class="cb-cards">${backs}</div>
      </div>
    </div>`;

  // Центр: кубики, урон, действия
  const dice = g.turn.dice;
  const used = g.turn.usedDice;
  const myTurn = isMyTurn();
  const bothFree = dice && !used[0] && !used[1];
  const canAttack = myTurn && bothFree
    && (g.legalTargets?.attacks?.[mine.id] ?? []).includes(enemy.id);
  let hint = '';
  if (bothFree) hint = `Урон: <b>${dice[0] + dice[1]}</b>`;
  else if (!myTurn) hint = 'Ход соперника…';
  else if (preview && dice) hint = 'Атака требует оба свободных кубика — со следующего броска';
  combatEl.querySelector('#combatCenter').innerHTML = `
    ${combatDiceHtml(g, myTurn)}
    <div class="cb-damage">${hint}</div>
    <div class="cb-actions">
      <button id="cbAttackBtn" ${canAttack ? '' : 'disabled'}>⚔ Атаковать</button>
      ${preview
        ? '<button id="cbCloseBtn" class="ghost">✕ Закрыть</button>'
        : `<button id="cbEscapeBtn" class="ghost" ${myTurn && dice ? '' : 'disabled'}>🏃 Сбежать</button>`}
      <button id="cbBoxBtn" class="ghost">🧰 Ящик</button>
      ${combatEndTurnHtml(g, myTurn)}
    </div>`;
  wireCombatDice();
  combatEl.querySelector('#cbAttackBtn').addEventListener('click', () => {
    wsSend('action:attack', { attackerId: mine.id, targetId: enemy.id });
  });
  combatEl.querySelector('#cbCloseBtn')?.addEventListener('click', () => {
    combatPreview = null;
    combatEl.classList.add('hidden');
    updateCombatBtn();
  });
  combatEl.querySelector('#cbEscapeBtn')?.addEventListener('click', () => {
    // Побег = движение: сворачиваем сцену и даём выбрать клетку на борде
    selectCharacter(mine.id);
    setLocalMode('moveSum');
    combatDismissed = true;
    combatEl.classList.add('hidden');
    updateCombatBtn();
    addLog('Побег: выберите клетку подальше от противника.', { type: 'sys' });
    render();
  });
  combatEl.querySelector('#cbBoxBtn').addEventListener('click', openCardBox); // подвоз карт — поверх сцены

  // Низ: мой боец, карты открыты
  const myCards = (mine.inventory ?? []).map(c => {
    const card = typeof c === 'string' ? { name: c, type: 'unknown', locked: false } : c;
    return `<div class="cb-card card-${card.type ?? 'unknown'}${card.locked ? ' card-locked' : ''}" title="${escapeHtml(card.name)}">`
      + `${escapeHtml(card.name)}${card.locked ? ' 🔒' : ''}</div>`;
  }).join('') || '<span class="cb-none">нет карт</span>';
  combatEl.querySelector('#combatMine').innerHTML = `
    <div class="cb-cards">${myCards}</div>
    ${combatMineCharHtml(mine)}`;
}

// Блок кубиков в центре сцены: бросок, значения, конец хода
function combatDiceHtml(g, myTurn) {
  const dice = g.turn.dice;
  if (dice) {
    const used = g.turn.usedDice;
    return `<div class="cb-dice">${dice.map((v, i) =>
      `<span class="cb-die${used[i] ? ' used' : ''}">${v}</span>`).join('')}</div>`;
  }
  if (!myTurn) return '<div class="cb-dice"><span class="cb-none">кубики не брошены</span></div>';
  const canRoll = !g.turn.hasRolled && (g.turn.rollsLeft[myPlayerId] ?? 0) > 0;
  return canRoll
    ? '<div class="cb-dice"><button id="cbRollBtn">🎲 Бросить кубики</button></div>'
    : '<div class="cb-dice"><span class="cb-none">кубики потрачены</span></div>';
}

// Кнопка «Конец хода» в ряду действий сцены; пульсирует, когда кубики потрачены
function combatEndTurnHtml(g, myTurn) {
  const attention = myTurn && !g.turn.dice && g.turn.hasRolled;
  return `<button id="cbEndTurnBtn" class="ghost${attention ? ' attention' : ''}" ${myTurn ? '' : 'disabled'}>Конец хода</button>`;
}

function wireCombatDice() {
  combatEl.querySelector('#cbRollBtn')?.addEventListener('click', () => wsSend('turn:roll'));
  combatEl.querySelector('#cbEndTurnBtn')?.addEventListener('click', () => wsSend('turn:end'));
}

// Блок «мой боец» — общий для боя с игроком и со зверем
function combatMineCharHtml(mine) {
  return `
    <div class="cb-char">
      <img src="./assets/characters/${charSide(mine)}/transparent/${ROLE_ART[mine.role]}.png" alt="" />
      <div class="cb-char-info">
        <div class="cb-name">${ROLE_NAMES[mine.role]} · вы</div>
        <div class="cb-hpbar mine"><div style="width:${mine.hp}%"></div></div>
      </div>
      <div class="cb-hp">${mine.hp} HP</div>
    </div>`;
}

// Сцена схватки со зверем: сверху зверь, в центре кубики и «Ударить»
function renderBeastCombat(mine) {
  const g = getGame();
  const bf = mine.beastFight;
  const icon = BEAST_ICONS[bf.cardId] ?? '🐾';
  const pct = Math.round((bf.successes / bf.needed) * 100);

  combatEl.querySelector('#combatEnemy').innerHTML = `
    <div class="cb-foe">
      <img class="cb-foe-card" src="${beastCardArt(bf.cardId)}" alt="${escapeHtml(bf.name)}" />
      <div class="cb-foe-info">
        <div class="cb-name">${icon} ${escapeHtml(bf.name)}</div>
        <div class="cb-beast-meta">Урон ${bf.damage}/ход · убить: кубик ≥${bf.killOn} сразу, или ${bf.needed} успеха (≥${bf.successOn})</div>
        <div class="cb-hpbar beast"><div style="width:${pct}%"></div></div>
        <div class="cb-hp">Успехи ${bf.successes}/${bf.needed}</div>
      </div>
    </div>`;

  const dice = g.turn.dice;
  const used = g.turn.usedDice;
  const myTurn = isMyTurn();
  const anyFree = dice && (!used[0] || !used[1]);
  combatEl.querySelector('#combatCenter').innerHTML = `
    ${combatDiceHtml(g, myTurn)}
    <div class="cb-damage">${myTurn ? (dice ? 'Удар тратит один кубик' : '') : 'Ход соперника…'}</div>
    <div class="cb-actions">
      <button id="cbHitBtn" ${myTurn && anyFree ? '' : 'disabled'}>${icon} Ударить</button>
      <button id="cbEscapeBtn" class="ghost" ${myTurn && dice ? '' : 'disabled'}>🏃 Сбежать</button>
      <button id="cbBoxBtn" class="ghost">🧰 Ящик</button>
      ${combatEndTurnHtml(g, myTurn)}
    </div>`;
  wireCombatDice();
  combatEl.querySelector('#cbHitBtn').addEventListener('click', () => {
    selectedCharId = mine.id; // fightBeast работает с выбранным персонажем
    fightBeast();
  });
  combatEl.querySelector('#cbEscapeBtn').addEventListener('click', () => {
    selectCharacter(mine.id);
    setLocalMode('moveSum');
    combatDismissed = true;
    combatEl.classList.add('hidden');
    updateCombatBtn();
    addLog('Побег: выберите клетку на борде.', { type: 'sys' });
    render();
  });
  combatEl.querySelector('#cbBoxBtn').addEventListener('click', openCardBox);

  const myCards = (mine.inventory ?? []).map(c => {
    const card = typeof c === 'string' ? { name: c, type: 'unknown', locked: false } : c;
    return `<div class="cb-card card-${card.type ?? 'unknown'}${card.locked ? ' card-locked' : ''}" title="${escapeHtml(card.name)}">`
      + `${escapeHtml(card.name)}${card.locked ? ' 🔒' : ''}</div>`;
  }).join('') || '<span class="cb-none">нет карт</span>';
  combatEl.querySelector('#combatMine').innerHTML = `
    <div class="cb-cards">${myCards}</div>
    ${combatMineCharHtml(mine)}`;
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
    if (!inv.some(c => c.id === TELEPORT_ID)) return result;
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
  // «Цветная» клетка — имеет собственный смысловой цвет (event/resource/start/колода/опушка).
  // Подсветка валидной цели для таких НЕ перекрашивает заливку, только усиливает обводку.
  if (cell?.pointClass || cell?.deck || cell?.side || (cell?.terrain && cell.terrain !== 'path')) {
    classes.push('colored');
  }
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
  boardEl.addEventListener('wheel', onWheel, { passive: false });
}

// Зум колесом мыши вокруг курсора (десктоп)
function onWheel(e) {
  e.preventDefault();
  const { rect, k } = svgK();
  const vbX = (e.clientX - rect.left) / k;
  const vbY = (e.clientY - rect.top) / k;
  // мировая точка под курсором (до зума)
  const cpX = (vbX - view.tx) / view.s;
  const cpY = (vbY - view.ty) / view.s;
  const factor = Math.exp(-e.deltaY * 0.0015);
  view.s = Math.max(MIN_S, Math.min(MAX_S, view.s * factor));
  // держим ту же точку под курсором
  view.tx = vbX - cpX * view.s;
  view.ty = vbY - cpY * view.s;
  clampView();
  applyView();
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

function initToasts() {
  if (toastContainer) return;
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
}

function showToast(text, type = 'info') {
  initToasts();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = text;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ═════════════════════════════════════════════════════════════════
// Оверлей находки карты (событие красной клетки / добор)
// ═════════════════════════════════════════════════════════════════

function buildEventOverlay() {
  if (eventOverlayEl) return;
  eventOverlayEl = document.createElement('div');
  eventOverlayEl.id = 'eventOverlay';
  eventOverlayEl.className = 'event-overlay hidden';
  eventOverlayEl.innerHTML = `
    <div class="event-card-reveal">
      <div class="event-title" id="eventTitle">Находка!</div>
      <div class="event-card-display" id="eventCardDisplay"></div>
      <button class="event-ok-btn" id="eventOkBtn">Принять</button>
    </div>`;
  document.body.appendChild(eventOverlayEl);
  eventOverlayEl.querySelector('#eventOkBtn').addEventListener('click', hideEventOverlay);
  eventOverlayEl.addEventListener('click', (e) => { if (e.target === eventOverlayEl) hideEventOverlay(); });
}

function showFoundCard(card, isDiscarded = false, overrideTitle = null) {
  if (!eventOverlayEl) buildEventOverlay();
  const title = eventOverlayEl.querySelector('#eventTitle');
  const display = eventOverlayEl.querySelector('#eventCardDisplay');
  
  title.textContent = overrideTitle || (isDiscarded ? 'Инвентарь полон!' : 'Находка!');
  title.style.color = overrideTitle ? 'var(--danger)' : (isDiscarded ? 'var(--danger)' : 'var(--gold)');
  
  display.innerHTML = renderCard(card, 999, true); // true = forceOpen
  const cardEl = display.querySelector('.card');
  if (cardEl) {
    if (isDiscarded) cardEl.style.opacity = '0.7';
  }

  eventOverlayEl.classList.remove('hidden');
}

function hideEventOverlay() {
  eventOverlayEl?.classList.add('hidden');
}

// Обработка прямого результата действия (нужна для мгновенной обратной связи)
function handleActionResult(result) {
  if (result.moved) {
    const m = result.moved;
  }

  if (result.redEvent) {
    const ev = result.redEvent;
    if (ev.empty) {
      showToast('На красной клетке пусто (колода исчерпана)', 'info');
      addLog('Событие на красной клетке: пусто.', { type: 'sys' });
    } else if (ev.beast) {
      // Зверь: только тост и лог, окно не показываем (бой виден в инвентаре)
      showToast(`🐗 Нападение зверя: ${ev.name}!`, 'danger');
      addLog(`На красной клетке: нападение зверя ${ev.name}!`, { type: 'err' });
    } else if (ev.toInventory) {
      const card = { id: ev.cardId, name: ev.name, type: ev.type, desc: ev.desc };
      showFoundCard(card, false);
      addLog(`На красной клетке найдено: ${ev.name}.`, { type: 'my' });
    } else if (ev.discarded) {
      const card = { id: ev.cardId, name: ev.name, type: ev.type, desc: ev.desc };
      showFoundCard(card, true);
      addLog(`На красной клетке найдено: ${ev.name} (инвентарь полон, в сброс).`, { type: 'sys' });
    }
  }

  if (result.drawn) {
    const d = result.drawn;
    const card = { id: d.card, name: d.name, type: d.type, desc: d.desc };
    showFoundCard(card, false);
    showToast(`Взято из колоды: ${d.name}`, 'success');
  }

  if (result.transferred) {
    const t = result.transferred;
    const name = t.name || getCardName(t.cardId);
    showToast(`Передано: ${name}`, 'info');
  }

  if (result.attacked) {
    const a = result.attacked;
    const attacker = getGame()?.characters.find(c => c.id === a.attackerId);
    const target = getGame()?.characters.find(c => c.id === a.targetId);
    const attackerName = attacker?.role || 'Персонаж';
    const targetName = target?.role || 'Персонаж';
    
    if (a.griffinDamage > 0) {
      showToast(`⚔️ Атака: ${a.damage} + Гриффон ${a.griffinDamage} = ${a.totalDamage} урона!`, 'danger');
      addLog(`${attackerName} атаковал ${targetName}: ${a.damage} урона + Гриффон ${a.griffinDamage} = ${a.totalDamage}`, { type: 'err' });
    } else {
      showToast(`⚔️ Атака: ${a.damage} урона!`, 'danger');
      addLog(`${attackerName} атаковал ${targetName}: ${a.damage} урона`, { type: 'err' });
    }
    
    if (a.defeated) {
      showToast(`💀 ${targetName} повержен!`, 'danger');
      addLog(`${targetName} повержен! Добыча: ${a.lootCount} карт${a.discardedCount > 0 ? ` (${a.discardedCount} в сброс)` : ''}`, { type: 'err' });
    }
  }
}

// Поиск имени карты по ID (для лога и тостов)
function getCardName(id) {
  const char = getSelChar();
  const card = char?.inventory?.find(c => c.id === id);
  if (card) return card.name;
  // Если в инвентаре ещё нет (или не выбран), пытаемся найти в других инвентарях
  for (const c of getMyChars()) {
    const found = c.inventory?.find(i => i.id === id);
    if (found) return found.name;
  }
  return id;
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
      // Урон в момент броска — это пассивы начала хода: Дубина или укус зверя.
      // Помечаем источник, иначе выглядит как «HP убыло само».
      const rolledNow = !prevG.turn.dice && nextG.turn.dice;
      const opp = nextG.characters.find(c => c.id === char.combatOpponentId);
      const myClubber = opp && opp.owner === myPlayerId && opp.role === 'V'
        && (opp.inventory ?? []).some(k => k.id === 'club' && !k.locked);
      if (rolledNow && char.owner !== myPlayerId && myClubber) {
        addLog(`⚔ Дубина: ${prefix}${ROLE_NAMES[char.role]} теряет ${damage} HP. HP: ${char.hp}.`, { type: 'my' });
        showEventToast(`⚔ Дубина бьёт: ${ROLE_NAMES[char.role]} врага −${damage} HP`);
      } else if (rolledNow && char.owner === myPlayerId && char.beastFight) {
        addLog(`🐗 ${escapeHtml(char.beastFight.name)} кусает: ${ROLE_NAMES[char.role]} теряет ${damage} HP. HP: ${char.hp}.`, { type: 'my' });
      } else {
        addLog(
          `${prefix}${ROLE_NAMES[char.role]} получает ${damage} урона. HP: ${char.hp}.`,
          { type: char.owner === myPlayerId ? 'my' : 'opp' },
        );
      }
      if (char.hp === 0) {
        addLog(`${prefix}${ROLE_NAMES[char.role]} выбыл из игры.`, { type: 'sys' });
      }
    } else if (prevChar && char.hp > prevChar.hp) {
      const heal = char.hp - prevChar.hp;
      const owner = nextRoom.players.find(p => p.id === char.owner);
      const prefix = char.owner === myPlayerId ? '' : `${owner?.name ?? 'Противник'}: `;
      addLog(
        `${prefix}${ROLE_NAMES[char.role]} восстанавливает +${heal} HP (Клубок). HP: ${char.hp}.`,
        { type: char.owner === myPlayerId ? 'my' : 'opp' },
      );
    }
    // Бой со зверем (красные клетки): нападение, победа, побег, успехи
    if (prevChar) {
      const prevBF = prevChar.beastFight;
      const nextBF = char.beastFight;
      const mine   = char.owner === myPlayerId;
      const bfType = mine ? 'my' : 'opp';
      const bfPrefix = mine
        ? ''
        : `${nextRoom.players.find(p => p.id === char.owner)?.name ?? 'Противник'}: `;
      if (!prevBF && nextBF) {
        addLog(`${bfPrefix}🐗 ${nextBF.name} напал на ${ROLE_NAMES[char.role]}!`, { type: bfType });
      } else if (prevBF && !nextBF) {
        if (prevChar.position !== char.position) {
          addLog(`${bfPrefix}${ROLE_NAMES[char.role]} сбежал от зверя.`, { type: bfType });
        } else if (char.hp > 0) {
          addLog(`${bfPrefix}${ROLE_NAMES[char.role]} победил зверя: ${prevBF.name}.`, { type: bfType });
        }
      } else if (prevBF && nextBF && nextBF.successes > prevBF.successes) {
        addLog(`${bfPrefix}Удар по зверю: успех ${nextBF.successes}/${nextBF.needed}.`, { type: bfType });
      }
      // Крафт: карта была заперта — стала открытой (видно только владельцу)
      if (prevChar.inventory && char.inventory) {
        for (const card of char.inventory) {
          if (!card.locked && prevChar.inventory.some(p => p.id === card.id && p.locked)) {
            addLog(`${bfPrefix}🔨 ${ROLE_NAMES[char.role]} открывает: ${card.name}!`, { type: bfType });
          }
        }
      }
    }
    if (!prevChar || prevChar.position === char.position) continue;
    if (!char.position) continue;
    const type = char.owner === myPlayerId ? 'my' : 'opp';
    const ownerName = char.owner === myPlayerId ? '' : `${oppName}: `;
    addLog(`${ownerName}${ROLE_NAMES[char.role]} → ${char.position}.`, { type });
    notifyRedCellEvent(prevG, nextG, prevChar, char);
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

// ═════════════════════════════════════════════════════════════════
// Красная клетка: явный исход события на экране (тост + журнал).
// Иначе непонятно, сработала ли клетка (зверь / находка / сброс / пусто).
// ═════════════════════════════════════════════════════════════════

function notifyRedCellEvent(prevG, nextG, prevChar, char) {
  if (cellById.get(char.position)?.terrain !== 'event') return;
  const mine = char.owner === myPlayerId;
  const role = ROLE_NAMES[char.role];

  // Зверь: сцена боя откроется сама, «напал» уже в журнале — тост не нужен
  if (char.beastFight) return;

  const drewEvent = (prevG.redDeckCount ?? 0) > (nextG.redDeckCount ?? 0);
  if (!drewEvent) {
    if (mine) {
      showEventToast('🟥 Красная клетка: колода событий пуста — ничего не произошло.');
      addLog(`Красная клетка ${char.position}: колода событий пуста.`, { type: 'sys' });
    }
    return;
  }

  // Карта вытянута, но это не зверь: находка в инвентарь или сброс при переполнении
  if (mine && prevChar.inventory && char.inventory) {
    const found = addedCard(prevChar.inventory, char.inventory);
    if (found) {
      showEventToast(`🟥 Событие! ${role} находит: <b>${escapeHtml(found.name)}</b>`);
      addLog(`🟥 ${role} находит на красной клетке: ${found.name}.`, { type: 'my' });
    } else {
      showEventToast('🟥 Событие! Находка не поместилась — инвентарь полон, карта ушла в сброс.');
      addLog('🟥 Находка с красной клетки ушла в сброс (инвентарь полон).', { type: 'my' });
    }
  } else if (!mine) {
    addLog(`Соперник: ${role} вытянул событие на красной клетке.`, { type: 'opp' });
  }
}

// Какая карта добавилась в инвентарь (сравнение счётчиков по id)
function addedCard(prevInv, nextInv) {
  const counts = new Map();
  for (const c of prevInv) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  for (const c of nextInv) {
    const left = (counts.get(c.id) ?? 0) - 1;
    if (left < 0) return c;
    counts.set(c.id, left);
  }
  return null;
}

let eventToastTimer = null;
function showEventToast(html) {
  let el = document.getElementById('eventToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'eventToast';
    el.className = 'event-toast hidden';
    el.addEventListener('click', () => el.classList.add('hidden'));
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  // перезапуск css-анимации появления
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = '';
  clearTimeout(eventToastTimer);
  eventToastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}
