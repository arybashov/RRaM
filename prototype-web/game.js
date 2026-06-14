// RRaM Web Client — тонкий клиент, всё состояние на сервере.
// Движение пока локальное (сервер ждёт карту), кубики/карты/ходы — сервер.

// ── Конфигурация ──────────────────────────────────────────────────
const SERVER_URL = new URLSearchParams(location.search).get('server')
  ?? localStorage.getItem('rram_server')
  ?? 'wss://rram.com.ru/ws';

const SESSION_KEY = 'rram_session';
const FOG_ENABLED_KEY = 'rram_fog_enabled';
let fogEnabled = localStorage.getItem(FOG_ENABLED_KEY) !== 'false';

// ── Константы ─────────────────────────────────────────────────────
const ROLE_NAMES = { K: 'Кузнец', P: 'Помощник', V: 'Воин', O: 'Охотник', S: 'Шаман' };
const TELEPORT_ID = 'teleport_beads'; // id карты «Бусы телепортации» (сервер шлёт инвентарь как {id,name,type})
const USED_CARD_BACK_ART = './assets/cards/backs/mixed-ground.png';
const BASE_CARD_BACK_ART = './assets/cards/backs/base-cards.png';
const ROLE_ART   = { K: 'blacksmith', P: 'assistant', V: 'warrior', O: 'hunter', S: 'shaman' };
const CHAR_CARD_ART = {
  K: 'base/blacksmith/blacksmith-v1', P: 'base/assistant/assistant-v1',
  V: 'base/warrior/warrior-v3',       O: 'base/hunter/hunter-v1',
  S: 'base/shaman/shaman-v3',
};
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
const CHARACTER_NAV_ART = {
  K: 'blacksmith-v1',
  P: 'assistant-v1',
  V: 'warrior-v1',
  O: 'hunter-v1',
  S: 'shaman-v1',
};
const CARD_FACE_ART = {
  teleport_beads: 'base/common/teleport-beads-v1',
  bp_hammer_base: 'base/blacksmith/hammer-blueprint-v1',
  hammer: 'base/blacksmith/hammer-v1',
  ore_medium: 'base/blacksmith/mixed-iron-ore-v1',
  sack: 'base/assistant/sack-v1',
  recipe_sack: 'base/assistant/sack-recipe-v1',
  bp_club_base: 'base/warrior/club-blueprint-v1',
  club: 'base/warrior/club-v1',
  griffin: 'base/hunter/griffin-v1',
  sheep_ram: 'base/common/ram-v1',
  sheep_wool: 'base/common/ram-wool-v1',
  sheep_hide_r: 'base/common/ram-hide-v1',
  sheep_hide_c: 'base/common/clean-ram-hide-v1',
  recipe_shaman_carpet: 'base/shaman/shaman-carpet-recipe-v1',
  shaman_carpet: 'base/shaman/shaman-carpet-v1',
  yarn: 'base/common/yarn-v1',
  wolf: 'beasts/red/gray-wolf-v1',
  beast_bear: 'beasts/red/mystical-bear-v1',
  boar_red: 'beasts/red/wild-boar-v1',
  boar_forest: 'beasts/red/wild-boar-v1',
  boar_hide: 'materials/beast-hides/boar-hide-v1',
  wolf_hide: 'materials/beast-hides/wolf-hide-v1',
  bear_hide: 'materials/beast-hides/bear-hide-v1',
  beast_hide: 'materials/beast-hides/clean-beast-hide-v1',
  hide_red: 'materials/beast-hides/clean-beast-hide-v1',
};

const BASE_CARD_IDS = new Set([
  'teleport_beads',
  'bp_hammer_base',
  'hammer',
  'ore_medium',
  'sack',
  'recipe_sack',
  'bp_club_base',
  'club',
  'griffin',
  'sheep_ram',
  'recipe_shaman_carpet',
  'shaman_carpet',
  'yarn',
]);

function cardBackArt(cardId) {
  const art = BASE_CARD_IDS.has(cardId) ? BASE_CARD_BACK_ART : USED_CARD_BACK_ART;
  return `${art}?v=${APP_VERSION}`;
}

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
let pendingTeleport = null; // { characterId, toCell, dieIndex }
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
let eventOverlayEl = null;            // окно просмотра полученной/выложенной карты
let eventOverlayCardEl = null;
let toastContainer = null;
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

// Лобби-DOM (создаётся динамически)
let lobbyEl, nameInput, createBtn, vsAiBtn,
    lobbyStatusEl, connBadgeEl, connRttEl, menuEl, menuBtn;
let settingsEl = null;
let matchResultEl = null;
let settingsReturnTo = 'lobby';
let reconnectTimer = null;
let cardBoxEl = null;        // оверлей «ящик» с картами команды
let cbxDrag = null;          // активное перетаскивание: { fromId, cardIndex, ghost, srcEl }
let terrainCards = new Map(); // uid → { ownerId, cardIndex, cardId, x, y, cardData }
const beastCardRects = new Map(); // characterId → положение карты зверя на поле
let invDrag = null;          // перетаскивание из инвентаря: { cardIndex, ghost, srcEl }
let approachTarget = null;      // { mineId, enemyId, until } — подход к врагу
let attackFxTargetId = null;
let attackFxTimer = null;
let heartbeatTimer = null;
let lastServerMsgAt = 0;
let pingSentAt = 0;         // метка времени последнего ping (для RTT)
let lastRtt = null;         // последний измеренный round-trip, мс
const HEARTBEAT_MS = 3000;  // ping каждые 3с (keepalive + живой замер RTT)
const STALE_MS = 28000;     // нет ни одного сообщения от сервера дольше → сокет мёртв

const NAME_KEY = 'rram_player_name';
const APP_VERSION = '20260614-13'; // = BUILD_VERSION (сервер) и ?v= в index.html; бампать через scripts/bump-version.mjs

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
    try {
      handleMsg(JSON.parse(e.data));
    } catch (error) {
      console.error('Ошибка обработки сообщения сервера:', error);
    }
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
      wsSend('client:setFog', { enabled: fogEnabled });
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
      syncTerrainCards();

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
        if (eventLog.length === 0) addLog('Партия началась!', { type: 'sys' });
        autoModeSent = false;
        requestAnimationFrame(focusMine);   // старт партии — база с окружающими путями
      } else if (serverRoom.status === 'active' && prevRoom?.game) {
        diffAndLog(prevRoom, serverRoom);
        animateMovesFromDiff(prevRoom, serverRoom);
      }

      // Авто-setMode: отправляем один раз после броска кубиков
      const g = getGame();
      if (g && !getSelChar()) {
        const nextSelectable = getMyChars().find(c => c.hp > 0 && characterPosition(c));
        selectedCharId = nextSelectable?.id ?? null;
      }
      const allDiceSpent = g?.turn.usedDice?.every(Boolean);
      if (g && isMyTurn() && g.turn.dice && !allDiceSpent && !g.turn.mode && !autoModeSent) {
        const sm = TO_SERVER_MODE[localMode];
        if (sm) { autoModeSent = true; wsSend('turn:setMode', { mode: sm }); }
      }
      if (!g?.turn.dice || prevActive !== g.turn.activePlayerId) {
        autoModeSent = false;
        localMode = 'moveSum';
        selectedDieIdx = 0;
      }

      render();
      // If we queued a teleport while waiting for server to switch to split,
      // send it now when snapshot confirms split mode.
      if (pendingTeleport && getServMode() === 'split') {
        wsSend('action:teleport', pendingTeleport);
        pendingTeleport = null;
      }
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
        resetToLobby();
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

function syncTerrainCards() {
  terrainCards = new Map(
    (getGame()?.terrainCards ?? []).map((entry) => [
      entry.id,
      {
        ownerId: entry.ownerId,
        characterId: entry.characterId,
        cardIndex: entry.cardIndex,
        faceDown: entry.faceDown,
        cardId: entry.card?.id,
        x: entry.x,
        y: entry.y,
        cardData: entry.card,
      },
    ]),
  );
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

function characterNavArtHref(char) {
  const art = CHARACTER_NAV_ART[char.role] ?? CHARACTER_NAV_ART.V;
  return `./assets/ui/character-icons/${art}.png`;
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
  pendingResume = false;
  serverRoom = null;
  myPlayerId = null;
  myRoomId = null;
  mySessionToken = null;
  currentRoomId = null;
  positions.clear();
  selectedCharId = null;
  localUsedDice = [false, false];
  pendingTeleport = null;
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
      <label class="settings-toggle">
        <input id="setFogEnabled" type="checkbox" />
        <span>
          <strong>Туман войны</strong>
          <small>Скрывает карту и противников вне зоны видимости.</small>
        </span>
      </label>
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
    fogEnabled = settingsEl.querySelector('#setFogEnabled').checked;
    if (n) { localStorage.setItem(NAME_KEY, n); if (nameInput) nameInput.value = n; }
    if (s) localStorage.setItem('rram_server', s);
    else   localStorage.removeItem('rram_server');
    localStorage.setItem(FOG_ENABLED_KEY, String(fogEnabled));
    wsSend('client:setFog', { enabled: fogEnabled });
    renderBoard();
    closeSettings('Настройки сохранены.');
  });

  settingsEl.querySelector('#setBackBtn').addEventListener('click', () => closeSettings());
}

function openSettings(from) {
  settingsReturnTo = from;
  settingsEl.querySelector('#setName').value   = localStorage.getItem(NAME_KEY) || '';
  settingsEl.querySelector('#setServer').value = localStorage.getItem('rram_server') || '';
  settingsEl.querySelector('#setFogEnabled').checked = fogEnabled;
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
    if (!getDice()) { wsSend('turn:roll'); return; }
    if (!isMyTurn()) return;
    const g = getGame();
    const area = g.turn.movementArea;
    const used = g.turn.usedDice;

    // Есть незавершённое движение → клик по кубику работает как откат / смена ноги.
    if (area && !area.locked) {
      const activeDie = area.mode === 'split' ? area.dieIndex : null;
      if (area.mode === 'moveSum' || i === activeDie || used[i]) {
        // Активный кубик (или любой в режиме суммы, или уже потраченная нога) →
        // откат текущей ноги к её началу (сервер вернёт фишку и освободит кубик).
        wsSend('turn:resetMove', { characterId: area.characterId });
      } else {
        // Другой свободный кубик → выбрать его для второй ноги; поле покажет render.
        selectedDieIdx = i;
        localMode = 'moveDie';
        render();
      }
      return;
    }

    // Движения ещё нет — обычный выбор кубика/режима.
    if (!used[i]) {
      const canChangeMode = !used[0] && !used[1];
      if (localMode === 'moveDie' && selectedDieIdx === i && canChangeMode) {
        setLocalMode('moveSum');
        wsSend('turn:setMode', { mode: 'moveSum' });
      } else {
        selectedDieIdx = i;
        setLocalMode('moveDie');
        wsSend('turn:setMode', { mode: 'split' });
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
    if (mode === 'moveSum' || mode === 'split') {
      wsSend('turn:setMode', { mode });
    }
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
  const hasRam = char?.inventory?.some(card => card.id === 'sheep_ram');
  if (!char || (!char.beastFight && !hasRam)) return;

  const used = getGame().turn.usedDice;
  const dieIndex = used[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
  if (used[dieIndex]) { addLog('Оба кубика потрачены.', { type: 'err' }); render(); return; }

  // Собираем id карт на террейне для отправки (ключ — уникальный uid, значение — cardId)
  const terrainCardIds = [...terrainCards.values()].map(tc => tc.cardId);

  if (getServMode() !== 'split') wsSend('turn:setMode', { mode: 'split' });
  wsSend('action:fightBeast', { characterId: char.id, dieIndex, terrainCards: terrainCardIds });
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
    if (!inv.some(c => c.id === TELEPORT_ID && !c.exhausted) || !validTargets(char).has(targetId)) return;
    if (usesServerPositions()) {
      teleportedChars.add(char.id); // не анимировать шагами — это прыжок
      const used = getGame().turn.usedDice;
      const dieIndex = used[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
      if (used[dieIndex]) return;
      if (getServMode() !== 'split') {
        pendingTeleport = { characterId: char.id, toCell: targetId, dieIndex };
        wsSend('turn:setMode', { mode: 'split' });
        return;
      }
      wsSend('action:teleport', { characterId: char.id, toCell: targetId, dieIndex });
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
    const area = g.turn.movementArea;
    localMode = area.mode === 'moveSum' ? 'moveSum' : 'moveDie';
    if (area.mode === 'split' && area.dieIndex != null) {
      // Если игрок выбрал ДРУГОЙ свободный кубик (превью второй ноги) — уважаем
      // выбор; иначе держим выделение на активной ноге.
      const other = 1 - area.dieIndex;
      if (!(selectedDieIdx === other && !g.turn.usedDice[other] && !area.locked)) {
        selectedDieIdx = area.dieIndex;
      }
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
    if (transferModeBtn) transferModeBtn.disabled = true;
    if (drawModeBtn) drawModeBtn.disabled = true;
    if (teleportModeBtn) teleportModeBtn.disabled = true;
    return;
  }
  const myTurn  = isMyTurn();
  const dice    = getDice();
  const used    = g.turn.usedDice;
  const sel     = getSelChar();
  const movementArea = g.turn.movementArea;
  const effectiveUsed = movementArea && movementArea.mode === 'moveSum' && !movementArea.locked
    ? [false, false]
    : used;
  const canRoll = myTurn
    && !dice
    && !g.turn.hasRolled
    && (g.turn.rollsLeft[myPlayerId] ?? 0) > 0;

  // Пока движение не зафиксировано — потраченные кубики остаются кликабельны
  // (клик по ним = откат ноги к старту). После жёсткого коммита — недоступны.
  const resettable = Boolean(movementArea && !movementArea.locked && myTurn);
  dieButtons.forEach((btn, i) => {
    // «🎲» только когда реально можно бросить; потрачено всё — «–»
    btn.textContent = dice ? dice[i] : (canRoll ? '🎲' : '–');
    btn.disabled    = dice ? (!myTurn || (effectiveUsed[i] && !resettable)) : !canRoll;
    btn.className   = 'die';
    if (canRoll)                                               btn.classList.add('rollable');
    const movementDie = g.turn.movementArea?.mode === 'split'
      && g.turn.movementArea.dieIndex === i;
    if (dice && ((!effectiveUsed[i] && selectedDieIdx === i && localMode !== 'moveSum') || movementDie)) {
      btn.classList.add('selected');
    }
    if (dice && effectiveUsed[i])                              btn.classList.add('used');
  });

  // Кубики потрачены, бросать больше нельзя — подсветить «Конец хода»
  const allSpent = Boolean(dice) && used.every(Boolean);
  endTurnBtn.classList.toggle('attention', myTurn && allSpent && g.turn.hasRolled);

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
  // «Телепорт» активен, если у выбранного персонажа есть Бусы и свободен один кубик.
  if (teleportModeBtn) {
    const hasBeads = sel?.inventory?.some(c => c.id === TELEPORT_ID && !c.exhausted);
    const hasFreeDie = dice && (!used[0] || !used[1]);
    teleportModeBtn.disabled = !(myTurn && hasBeads && hasFreeDie);
    teleportModeBtn.title = hasBeads
      ? 'Кубик 2+: телепорт на свой старт или фиолетовую точку'
      : 'У персонажа нет готовых Бус телепортации';
  }

}

function renderBoard() {
  if (!boardSvg) return;
  boardSvg.querySelectorAll('.token').forEach(n => n.remove());
  const sel    = getSelChar();
  const valid  = sel ? validTargets(sel) : new Set();
  const game   = getGame();

  // Туман войны: чистые круглые окна вокруг своих живых фигур.
  // Сетка и маркеры вне кругов полностью скрыты, дальние цели туман не пробивают.
  const fogCircles = fogEnabled ? fogRevealCircles() : null;
  renderFog(fogCircles);
  for (const el of boardSvg.querySelectorAll('.cell')) {
    const id = el.getAttribute('data-id');
    el.setAttribute('class', cellClassName(cellById.get(id)));
    // Допустимые цели движения видны поверх тумана, но не открывают карту
    // и не показывают привязанные к клеткам маркеры.
    el.classList.toggle('fog-hidden', !fogContainsCell(fogCircles, id) && !valid.has(id));
    el.classList.toggle(
      'teleport-target',
      localMode === 'teleport' && valid.has(id) && cellById.get(id)?.pointClass === 'teleport',
    );
    el.classList.toggle(
      'teleport-destination',
      localMode === 'teleport' && valid.has(id),
    );
    if (isStartCell(id)) el.classList.add('start');
    if (game?.characters.some(c => characterPosition(c) === id)) el.classList.add('occupied');
    if (sel && characterPosition(sel) === id) el.classList.add('selected');
    if (valid.has(id)) el.classList.add('valid');
  }
  for (const marker of boardSvg.querySelectorAll('.deck-marker[data-cell-id]')) {
    marker.classList.toggle(
      'fog-hidden',
      !fogContainsCell(fogCircles, marker.getAttribute('data-cell-id')),
    );
  }

  if (!game) return;
  const attackerByTarget = new Map();
  for (const attacker of getMyChars()) {
    for (const targetId of game.legalTargets?.attacks?.[attacker.id] ?? []) {
      if (!attackerByTarget.has(targetId) || attacker.id === selectedCharId) {
        attackerByTarget.set(targetId, attacker);
      }
    }
  }
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
    if (attackerByTarget.has(char.id)) tokenClasses.push('attackable');
    if (char.id === attackFxTargetId) tokenClasses.push('attack-triggered');
    if (char.id === selectedCharId) tokenClasses.push('active');
    g.setAttribute('class', tokenClasses.join(' '));
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    const myInCombat = getMyChars().find(c => c.combatOpponentId === char.id);
    const directAttacker = attackerByTarget.get(char.id) ?? null;
    const isAttackable = Boolean(directAttacker);
    if (isOwn) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Выбрать: ${ROLE_NAMES[char.role]}`);
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        if (gestureMoved) return;
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
        const attacker = directAttacker ?? myInCombat;
        if (isAttackable && attacker) {
          selectedCharId = attacker.id;
          g.classList.add('attack-triggered');
          triggerAttackEffect(char.id);
          wsSend('action:attack', { attackerId: attacker.id, targetId: char.id });
          return;
        }
        if (myInCombat) {
          selectCharacter(myInCombat.id);
          addLog('Для атаки нужны оба свободных кубика.', { type: 'sys' });
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
            approachTarget = { mineId: sel.id, enemyId: char.id, until: Date.now() + 4000 };
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

    const hitArea = !isOwn && isAttackable
      ? document.createElementNS(svgNS, 'rect')
      : null;
    if (hitArea) {
      hitArea.setAttribute('class', 'token-hit-area');
      hitArea.setAttribute('x', (-figureWidth / 2).toFixed(2));
      hitArea.setAttribute('y', (-figureHeight * 0.7).toFixed(2));
      hitArea.setAttribute('width', figureWidth.toFixed(2));
      hitArea.setAttribute('height', figureHeight.toFixed(2));
    }

    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${ROLE_NAMES[char.role]} — ${char.hp} HP`;
    const hp = document.createElementNS(svgNS, 'text');
    hp.setAttribute('class', 'token-hp');
    hp.setAttribute('y', (HEX_R * 0.62).toFixed(1));
    hp.style.fontSize = '6.5px';
    hp.textContent = `${char.hp}`;
    g.appendChild(title);
    if (hitArea) g.appendChild(hitArea);
    g.appendChild(halo);
    g.appendChild(glow);
    g.appendChild(figure);
    g.appendChild(hp);
    boardVp.appendChild(g);
  }
  renderCombatBoardElements();
}

function renderCharacters() {
  if (!charactersEl) return;
  charactersEl.innerHTML = '';
  const game = getGame();
  if (!game) return;

  for (const char of getMyChars()) {
    const hp     = char.hp ?? 100;
    const btn    = document.createElement('button');
    btn.className = 'character-nav-btn';
    if (char.id === selectedCharId) btn.classList.add('active');
    if (char.combatOpponentId || char.beastFight) btn.classList.add('in-combat');
    const portrait = document.createElement('img');
    portrait.className = 'character-nav-portrait';
    portrait.src = characterNavArtHref(char);
    portrait.alt = '';
    portrait.draggable = false;
    btn.appendChild(portrait);
    btn.title = `${ROLE_NAMES[char.role]} · HP ${hp}`;
    btn.setAttribute(
      'aria-label',
      `${ROLE_NAMES[char.role]}, HP ${hp}${char.id === selectedCharId ? ', выбран' : ''}`,
    );
    btn.setAttribute('aria-pressed', char.id === selectedCharId ? 'true' : 'false');
    btn.disabled = char.hp <= 0 || !characterPosition(char);
    btn.addEventListener('click', () => {
      selectCharacter(char.id);
    });
    charactersEl.appendChild(btn);
  }
}

const expandedCards = new Set(); // индексы раскрытых карт текущего инвентаря
const faceDownCards = new Set(); // `${characterId}:${index}` — подготовлена рубашкой вверх
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
  // Обработка шкуры: шаман с «Шкурой убитого зверя» делает из неё очищенную
  // (бросок кубика ≥2). Нужен свободный кубик в свой ход.
  const dice = getDice();
  const used = getGame()?.turn.usedDice ?? [true, true];
  const hasFreeDie = Boolean(dice) && (!used[0] || !used[1]);
  const hasRam = !bf && inv.some(card => card.id === 'sheep_ram');
  const ramInfo = hasRam
    ? `<div class="beast-info">Баран: кубик 3+ побеждает сразу, либо нужны два удара. `
      + `<button id="fightRamBtn" ${(isMyTurn() && hasFreeDie) ? '' : 'disabled'}>Сразиться с Бараном</button></div>`
    : '';
  const canProcessHide = char.role === 'S' && inv.some(c => RAW_HIDE_IDS.includes(c.id));
  const hideInfo = canProcessHide
    ? `<div class="craft-info">🧵 Шаман может обработать шкуру. Шкура барана даст кожу и шерсть. `
      + `<button id="processHideBtn" ${(isMyTurn() && hasFreeDie) ? '' : 'disabled'}>Обработать шкуру</button></div>`
    : '';

  // Крафт базового изделия по классу: чертёж/рецепт + запертое изделие + материалы.
  const craftInfo = Object.entries(CRAFT_RECIPES)
    .filter(([, r]) => r.role === char.role)
    .map(([item, r]) => {
    const has = id => inv.some(c => c.id === id);
    const alreadyCrafted = char.crafted?.includes(r.result);
    const matsReady = r.materials.every(slot => slot.some(id => has(id)));
    if (!alreadyCrafted && has(r.via) && matsReady) {
      const diceReady = !r.diceCount
        || (r.diceCount === 2
          ? Boolean(dice && !used[0] && !used[1])
          : Boolean(dice && (!used[0] || !used[1])));
      return `<div class="craft-info">🔨 Есть материалы — можно открыть «${r.label}»! `
        + `<button class="craft-btn" data-item="${item}" ${(isMyTurn() && diceReady) ? '' : 'disabled'}>Открыть «${r.label}»</button>`
        + (r.diceCount === 2 && !diceReady ? ` Нужны оба свободных кубика, каждый ${r.diceMin}+.` : '')
        + (r.diceCount === 1 && !diceReady ? ` Нужен свободный кубик ${r.diceMin}+.` : '')
        + `</div>`;
    }
    return '';
  }).join('');

  const visibleCards = inv
    .map((card, index) => ({ card, index }));
  inventoryEl.className = (visibleCards.length || bf) ? 'inventory' : 'inventory empty';
  inventoryEl.innerHTML = visibleCards.length
    ? beastInfo + ramInfo + hideInfo + craftInfo
      + visibleCards.map(({ card, index }) => renderCard(card, index)).join('')
    : (beastInfo || 'Инвентарь пуст.');
  inventoryEl.querySelectorAll('.craft-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation(); // не раскрывать карту под кнопкой
    const u = getGame().turn.usedDice;
    const dieIndex = u[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
    wsSend('action:craft', {
      characterId: char.id,
      item: e.currentTarget.dataset.item,
      dieIndex,
    });
  }));
  inventoryEl.querySelector('#processHideBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const u = getGame().turn.usedDice;
    const dieIndex = u[selectedDieIdx] ? (selectedDieIdx === 0 ? 1 : 0) : selectedDieIdx;
    if (u[dieIndex]) { addLog('Нет свободного кубика для обработки.', { type: 'err' }); return; }
    if (getServMode() !== 'split') wsSend('turn:setMode', { mode: 'split' });
    wsSend('action:processHide', { characterId: char.id, dieIndex });
  });
  inventoryEl.querySelector('#fightRamBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fightBeast();
  });
}

// Сырые шкуры — вход обработки шамана (синхронно с сервером).
const RAW_HIDE_IDS = ['raw_hide', 'raw_hide_red', 'boar_hide', 'wolf_hide', 'bear_hide', 'sheep_hide_r'];

// Рецепты базовых изделий — зеркало server CRAFT_RECIPES (для кнопок крафта).
const CRAFT_RECIPES = {
  club:   { role: 'V', via: 'bp_club_base',   result: 'club',   label: 'Дубина',  materials: [['beast_hide', 'hide_red']] },
  hammer: { role: 'K', via: 'bp_hammer_base', result: 'hammer', label: 'Молоток', materials: [['ore_medium']], diceCount: 2, diceMin: 3 },
  sack:   { role: 'P', via: 'recipe_sack',    result: 'sack',   label: 'Мешок',   materials: [['yarn'], ['sheep_hide_c']], diceCount: 2, diceMin: 3 },
  shaman_carpet: { role: 'S', via: 'recipe_shaman_carpet', result: 'shaman_carpet', label: 'Ковёр шамана', materials: [['yarn'], ['bear_hide']], diceCount: 1, diceMin: 3 },
  yarn: { role: 'S', via: 'sheep_wool', result: 'yarn', label: 'Клубок сплетённой шерсти', materials: [], diceCount: 1, diceMin: 2 },
};

const CARD_TYPE_LABELS = {
  weapon: 'оружие', armor: 'броня', tool: 'инструмент', ingredient: 'ингредиент',
  blueprint: 'чертёж', recipe: 'рецепт', companion: 'спутник', beast: 'зверь',
  special: 'особая', provocation: 'провокация',
};

function renderCard(c, i = 0, forceOpen = false) {
  // c = { id, name, type, locked, desc }; легаси-строку (если придёт) тоже покажем
  if (typeof c === 'string') return `<div class="card">${escapeHtml(c)}</div>`;
  const art = CARD_FACE_ART[c.id];
  const type = CARD_TYPE_LABELS[c.type] ?? '';
  const locked = c.locked ? '<span class="card-lock" title="Откроется после крафта">🔒</span>' : '';
  const hasDesc = Boolean(c.desc);
  const open = forceOpen || expandedCards.has(i);
  const selected = getSelChar();
  const manuallyFaceDown = selected && faceDownCards.has(`${selected.id}:${i}`);
  const showBack = c.exhausted || c.hidden || manuallyFaceDown;
  const faceArt = showBack ? cardBackArt(c.id) : (art ? `./assets/cards/${art}.png` : null);
  const flipControl = !c.exhausted && !c.hidden && !c.locked
    ? `<button class="card-flip-btn" type="button" aria-label="${manuallyFaceDown ? 'Перевернуть лицом вверх' : 'Перевернуть рубашкой вверх'}" title="${manuallyFaceDown ? 'Перевернуть лицом вверх' : 'Перевернуть рубашкой вверх'}">↻</button>`
    : '';
  const caret = hasDesc ? `<span class="card-caret">${open ? '▾' : '▸'}</span>` : '';
  const desc = hasDesc && open ? `<div class="card-desc">${escapeHtml(c.desc)}</div>` : '';
  if (faceArt) {
    return `<div class="card card-face card-${c.type ?? 'unknown'}${c.locked ? ' card-locked' : ''}${c.exhausted ? ' card-exhausted' : ''}${manuallyFaceDown ? ' card-face-down' : ''}${open ? ' expanded' : ''}" data-i="${i}" title="${escapeHtml(c.name)}${c.exhausted ? ' — использована' : manuallyFaceDown ? ' — рубашкой вверх' : ''}"${!c.exhausted && !c.hidden ? ' role="button" tabindex="0"' : ''}>`
      + `<img class="inventory-card-art" src="${faceArt}" alt="${escapeHtml(c.name)}" draggable="false" />`
      + locked
      + flipControl
      + (c.exhausted ? '<span class="card-used-mark">использована</span>'
        : manuallyFaceDown ? '<span class="card-used-mark">скрыта</span>' : caret)
      + (showBack ? '' : desc)
      + `</div>`;
  }
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
  if (invDrag?.started) return; // был драг, не раскрываем
  const card = e.target.closest('.card[data-i]');
  if (!card || !inventoryEl.contains(card)) return;
  const i = Number(card.dataset.i);
  const char = getSelChar();
  const item = char?.inventory?.[i];
  if (e.target.closest('.card-flip-btn') && char && item && !item.exhausted && !item.locked) {
    e.stopPropagation();
    const key = `${char.id}:${i}`;
    if (faceDownCards.has(key)) faceDownCards.delete(key); else faceDownCards.add(key);
    renderInventory();
    return;
  }
  if (expandedCards.has(i)) expandedCards.delete(i); else expandedCards.add(i);
  renderInventory();
}

// ── Перетаскивание карт из инвентаря на террейн ──
// Используем pointer-события на inventoryEl, совместимые с click-to-expand.
const INV_DRAG_THRESHOLD = 8;

inventoryEl.addEventListener('pointerdown', (e) => {
  const cardEl = e.target.closest('.card.card-face[data-i]');
  if (!cardEl) return;
  const char = getSelChar();
  if (!char || !isMyTurn()) return;
  const i = Number(cardEl.dataset.i);
  const card = char.inventory[i];
  if (!card || card.locked || card.exhausted) return;
  cardEl.setPointerCapture?.(e.pointerId);
  invDrag = {
    cardIndex: i,
    ghost: null,
    srcEl: cardEl,
    captureEl: cardEl,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    started: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!invDrag || e.pointerId !== invDrag.pointerId) return;
  if (invDrag.started) {
    e.preventDefault();
    if (invDrag.ghost) moveInvGhost(e);
    return;
  }
  const dx = e.clientX - invDrag.startX;
  const dy = e.clientY - invDrag.startY;
  if (Math.hypot(dx, dy) > INV_DRAG_THRESHOLD) {
    e.preventDefault();
    invDrag.started = true;
    const ghost = invDrag.srcEl.cloneNode(true);
    ghost.classList.add('inv-drag-ghost');
    document.body.appendChild(ghost);
    invDrag.ghost = ghost;
    invDrag.srcEl.classList.add('dragging');
    moveInvGhost(e);
  }
});

document.addEventListener('pointercancel', (e) => {
  if (!invDrag || e.pointerId !== invDrag.pointerId) return;
  releaseInvPointerCapture(invDrag);
  if (invDrag.ghost) invDrag.ghost.remove();
  if (invDrag.srcEl) invDrag.srcEl.classList.remove('dragging');
  invDrag = null;
});

document.addEventListener('pointerup', (e) => {
  if (!invDrag || e.pointerId !== invDrag.pointerId) return;
  const { started, cardIndex } = invDrag;
  releaseInvPointerCapture(invDrag);
  if (invDrag.ghost) invDrag.ghost.remove();
  if (invDrag.srcEl) invDrag.srcEl.classList.remove('dragging');
  const drag = invDrag;
  invDrag = null;

  if (!started || !drag.started) return; // без драга — click сработает как обычно

  // Сброс на террейн: конвертируем клиентские координаты в viewBox
  if (!boardSvg) return;
  const rect = boardSvg.getBoundingClientRect();
  if (!rect || rect.width === 0) return;
  const { k } = svgK();
  const vbX = (e.clientX - rect.left) / k;
  const vbY = (e.clientY - rect.top) / k;
  const rawWorldX = (vbX - view.tx) / view.s;
  const rawWorldY = (vbY - view.ty) / view.s;
  const terrainCardW = HEX_R * 3.5;
  const terrainCardH = terrainCardW * (512 / 341);
  const worldX = Math.max(terrainCardW / 2, Math.min(VBW - terrainCardW / 2, rawWorldX));
  const worldY = Math.max(terrainCardH / 2, Math.min(VBH - terrainCardH / 2, rawWorldY));

  const char = getSelChar();
  if (!char) return;
  const card = char.inventory[cardIndex];
  if (!card) return;

  // Уникальный ключ для каждой карты на террейне
  const uid = `terrain_${card.id}_${Date.now()}`;
  const faceDownKey = `${char.id}:${cardIndex}`;
  const faceDown = faceDownCards.has(faceDownKey);
  wsSend('action:terrainPlace', {
    id: uid,
    characterId: char.id,
    cardIndex,
    x: worldX,
    y: worldY,
    faceDown,
  });
  faceDownCards.delete(faceDownKey);
});

function releaseInvPointerCapture(drag) {
  if (!drag?.captureEl?.hasPointerCapture?.(drag.pointerId)) return;
  drag.captureEl.releasePointerCapture(drag.pointerId);
}

function moveInvGhost(e) {
  if (!invDrag?.ghost) return;
  invDrag.ghost.style.left = `${e.clientX}px`;
  invDrag.ghost.style.top = `${e.clientY}px`;
}

function triggerAttackEffect(targetId) {
  attackFxTargetId = targetId;
  clearTimeout(attackFxTimer);
  attackFxTimer = setTimeout(() => {
    attackFxTargetId = null;
    renderBoard();
  }, 480);
}

function showDamageNumber({ charId = null, cellId = null, amount, overBeast = false }) {
  if (!boardVp || !amount) return;
  const char = charId ? getGame()?.characters.find(item => item.id === charId) : null;
  const pos = cellId ?? (char ? (tokenDisplayPos.get(char.id) ?? characterPosition(char)) : null);
  const ctr = cellCenter(pos);
  const beastRect = overBeast && charId ? beastCardRects.get(charId) : null;
  if (!ctr && !beastRect) return;

  const text = document.createElementNS(svgNS, 'text');
  const x = beastRect ? beastRect.x + beastRect.w / 2 : ctr.cx;
  const y = beastRect ? beastRect.y + beastRect.h * 0.48 : ctr.cy - HEX_R * 1.55;
  text.setAttribute('class', 'damage-float');
  text.setAttribute('x', x.toFixed(2));
  text.setAttribute('y', y.toFixed(2));
  text.style.fontSize = `${HEX_R * 1.45}px`;
  text.textContent = `−${amount}`;
  boardVp.appendChild(text);
  setTimeout(() => text.remove(), 1550);
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
  return `<div class="cbx-row" data-char-id="${char.id}">`
    + `<div class="cbx-portrait side-${side}">`
    +   `<img src="${charCardArt(char.role)}" alt="${ROLE_NAMES[char.role]}" />`
    +   `<span class="cbx-hp">${char.hp ?? 100}</span>`
    + `</div>`
    + `<div class="cbx-slots">${otherSlots}</div>`
    + `<div class="cbx-tele-slot">${teleSlot}</div>`
    + `</div>`;
}

function renderCbxCard(c, charId, i) {
  if (typeof c === 'string') c = { name: c, type: 'unknown', locked: false };
  const art = CARD_FACE_ART[c.id];
  const imageSrc = c.exhausted ? cardBackArt(c.id) : (art ? `./assets/cards/${art}.png` : null);
  const image = imageSrc
    ? `<img class="cbx-card-art" src="${imageSrc}" alt="" draggable="false" />`
    : '';
  const lock = c.locked ? '<span class="cbx-lock" aria-label="Карта закрыта">🔒</span>' : '';
  return `<div class="cbx-card card-${c.type ?? 'unknown'}${c.locked ? ' card-locked' : ''}${c.exhausted ? ' card-exhausted' : ''}"`
    + ` data-char-id="${charId}" data-i="${i}" title="${escapeHtml(c.name)}">`
    + image
    + (imageSrc ? '' : `<span class="cbx-card-name">${escapeHtml(c.name)}</span>`)
    + lock
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
// ═════════════════════════════════════════════════════════════════
// Combat on field — beast card on hex, terrain card system
// ═════════════════════════════════════════════════════════════════

const BEAST_CARD_ART = {
  wolf: 'beasts/red/gray-wolf-v1', beast_bear: 'beasts/red/mystical-bear-v1',
  boar_red: 'beasts/red/wild-boar-v1', boar_forest: 'beasts/red/wild-boar-v1',
};
const charCardArt  = (role) => `./assets/cards/${CHAR_CARD_ART[role] ?? 'base/warrior/warrior-v3'}.png`;
const beastCardArt = (id)   => `./assets/cards/${BEAST_CARD_ART[id] ?? 'beasts/red/wild-boar-v1'}.png`;

function rectsOverlap(a, b) {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
}

function placeBeastCard(ctr, w, h, occupiedCenters, placedRects) {
  const margin = HEX_R * 0.7;
  const labelSpace = HEX_R * 0.8;
  const gap = HEX_R * 1.1;
  const maxX = Math.max(margin, VBW - margin - w);
  const maxY = Math.max(margin, VBH - margin - h - labelSpace);
  const candidates = [
    { x: ctr.cx - w - gap, y: ctr.cy - h / 2 },
    { x: ctr.cx + gap, y: ctr.cy - h / 2 },
    { x: ctr.cx - w / 2, y: ctr.cy - h - gap },
    { x: ctr.cx - w / 2, y: ctr.cy + gap },
  ];

  return candidates
    .map((candidate, index) => {
      const rect = {
        x: Math.max(margin, Math.min(maxX, candidate.x)),
        y: Math.max(margin, Math.min(maxY, candidate.y)),
        w,
        h,
      };
      let score = Math.hypot(rect.x - candidate.x, rect.y - candidate.y) + index * 0.01;
      const tokenPadding = HEX_R * 1.45;
      for (const center of occupiedCenters) {
        if (
          center.cx >= rect.x - tokenPadding
          && center.cx <= rect.x + rect.w + tokenPadding
          && center.cy >= rect.y - tokenPadding
          && center.cy <= rect.y + rect.h + tokenPadding
        ) {
          score += 10000;
        }
      }
      for (const placed of placedRects) {
        if (rectsOverlap(rect, placed)) score += 20000;
      }
      return { rect, score };
    })
    .sort((a, b) => a.score - b.score)[0].rect;
}

// Рендер карты зверя рядом с гексом и карт на террейне (вызывается из renderBoard)
function renderCombatBoardElements() {
  if (!boardVp) return;
  boardVp.querySelectorAll('.combat-element').forEach(n => n.remove());
  beastCardRects.clear();

  const g = getGame();
  if (!g) return;

  const occupiedCenters = g.characters
    .map(char => cellCenter(tokenDisplayPos.get(char.id) ?? characterPosition(char)))
    .filter(Boolean);
  const placedBeastRects = [];

  // Карта зверя: для каждого своего персонажа в beastFight — карта над хексом
  for (const char of getMyChars()) {
    if (!char.beastFight) continue;
    const bf = char.beastFight;
    const pos = bf.cellId ?? characterPosition(char);
    const ctr = cellCenter(pos);
    if (!ctr) continue;
    const w = HEX_R * 5.5;
    const h = w * (512 / 341);
    const rect = placeBeastCard(ctr, w, h, occupiedCenters, placedBeastRects);
    const { x, y } = rect;
    placedBeastRects.push(rect);
    beastCardRects.set(char.id, rect);

    const gEl = document.createElementNS(svgNS, 'g');
    gEl.setAttribute('class', 'combat-element beast-card-on-hex');
    gEl.setAttribute('data-cell-id', pos);
    gEl.style.cursor = 'pointer';

    const cardImg = document.createElementNS(svgNS, 'image');
    cardImg.setAttribute('href', beastCardArt(bf.cardId));
    cardImg.setAttribute('x', x.toFixed(2));
    cardImg.setAttribute('y', y.toFixed(2));
    cardImg.setAttribute('width', w.toFixed(2));
    cardImg.setAttribute('height', h.toFixed(2));
    cardImg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    gEl.appendChild(cardImg);

    // Здоровье зверя показываем поверх нижней части карты.
    const txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('class', 'beast-card-hp');
    txt.setAttribute('x', (x + w / 2).toFixed(2));
    txt.setAttribute('y', (y + h - HEX_R * 0.55).toFixed(2));
    txt.style.textAnchor = 'middle';
    txt.style.fontSize = `${HEX_R * 0.68}px`;
    txt.style.pointerEvents = 'none';
    txt.textContent = `HP ${bf.hp}/${bf.maxHp}`;
    gEl.appendChild(txt);

    gEl.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedCharId = char.id;
      fightBeast();
    });

    boardVp.appendChild(gEl);
  }

  // Карты на террейне (свои)
  for (const [uid, tc] of terrainCards) {
    const cardId = tc.cardId;
    const w = HEX_R * 3.5;
    const h = w * (512 / 341);
    const x = tc.x - w / 2;
    const y = tc.y - h / 2;
    const art = CARD_FACE_ART[cardId];
    const imageHref = tc.faceDown
      ? cardBackArt(cardId)
      : (art ? `./assets/cards/${art}.png` : null);
    if (!imageHref) continue;

    const gEl = document.createElementNS(svgNS, 'g');
    gEl.setAttribute('class', 'combat-element terrain-card');
    gEl.setAttribute('data-uid', uid);
    gEl.style.cursor = 'pointer';
    gEl.setAttribute('role', 'button');
    gEl.setAttribute('tabindex', '0');
    gEl.setAttribute('aria-label', `Открыть карту: ${tc.cardData.name ?? cardId}`);

    const img = document.createElementNS(svgNS, 'image');
    img.setAttribute('href', imageHref);
    img.setAttribute('x', x.toFixed(2));
    img.setAttribute('y', y.toFixed(2));
    img.setAttribute('width', w.toFixed(2));
    img.setAttribute('height', h.toFixed(2));
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    gEl.appendChild(img);

    if (tc.ownerId === myPlayerId) {
      const flip = document.createElementNS(svgNS, 'g');
      flip.setAttribute('class', 'terrain-card-flip');
      flip.setAttribute('role', 'button');
      flip.setAttribute('tabindex', '0');
      flip.setAttribute(
        'aria-label',
        tc.faceDown ? 'Перевернуть карту лицом вверх' : 'Перевернуть карту рубашкой вверх',
      );
      flip.style.cursor = 'pointer';

      const flipBg = document.createElementNS(svgNS, 'circle');
      flipBg.setAttribute('cx', (x + w - HEX_R * 0.42).toFixed(2));
      flipBg.setAttribute('cy', (y + HEX_R * 0.42).toFixed(2));
      flipBg.setAttribute('r', (HEX_R * 0.36).toFixed(2));
      flipBg.setAttribute('class', 'terrain-card-flip-bg');
      flip.appendChild(flipBg);

      const flipIcon = document.createElementNS(svgNS, 'text');
      flipIcon.setAttribute('x', (x + w - HEX_R * 0.42).toFixed(2));
      flipIcon.setAttribute('y', (y + HEX_R * 0.43).toFixed(2));
      flipIcon.setAttribute('class', 'terrain-card-flip-icon');
      flipIcon.style.fontSize = `${HEX_R * 0.52}px`;
      flipIcon.textContent = '↻';
      flip.appendChild(flipIcon);

      const flipTerrainCard = (event) => {
        event.stopPropagation();
        wsSend('action:terrainFlip', { id: uid, faceDown: !tc.faceDown });
      };
      flip.addEventListener('click', flipTerrainCard);
      flip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        flipTerrainCard(event);
      });
      gEl.appendChild(flip);
    }

    const openTerrainCard = (e) => {
      e.stopPropagation();
      showTerrainCard(uid, tc);
    };
    gEl.addEventListener('click', openTerrainCard);
    gEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openTerrainCard(e);
    });

    boardVp.appendChild(gEl);
  }
}

// Туман войны: одно круглое окно вокруг каждой своей живой фигуры.
// Радиус окна строго равен пяти радиусам гекса.
const FOG_RADIUS_HEXES = 5;
function fogCellStep() {
  const distances = [];
  for (const cell of cells) {
    for (const neighborId of cell.neighbors) {
      const neighbor = cellById.get(neighborId);
      if (!neighbor) continue;
      distances.push(Math.hypot(neighbor.cx - cell.cx, neighbor.cy - cell.cy));
    }
  }
  if (!distances.length) return HEX_R * Math.sqrt(3);
  distances.sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)];
}

function fogRevealCircles() {
  if (!getGame()) return null;
  const circles = [];
  const radius = fogCellStep() * FOG_RADIUS_HEXES;
  for (const c of getMyChars()) {
    const p = tokenDisplayPos.get(c.id) ?? characterPosition(c);
    if (!p || c.hp <= 0) continue;
    const center = cellCenter(p);
    if (center) circles.push({ cx: center.cx, cy: center.cy, r: radius });
  }
  return circles;
}

function fogContainsCell(circles, cellId) {
  if (!circles) return true;
  const center = cellCenter(cellId);
  if (!center) return false;
  return circles.some(({ cx, cy, r }) => Math.hypot(center.cx - cx, center.cy - cy) <= r);
}

// Слой тумана: тёмный прямоугольник поверх арта и сетки с чистыми круглыми
// отверстиями. Пересекающиеся круги автоматически образуют единую область.
function renderFog(circles) {
  if (!boardVp) return;
  let layer = boardVp.querySelector('#fogLayer');
  if (!circles) { layer?.remove(); return; }
  const artScaleX = boardMap?.art?.scaleX ?? 1;
  const artScaleY = boardMap?.art?.scaleY ?? 1;
  if (!layer) {
    layer = document.createElementNS(svgNS, 'g');
    layer.setAttribute('id', 'fogLayer');
    layer.setAttribute('pointer-events', 'none');
    layer.innerHTML = `<defs>`
      + `<filter id="fogEdgeBlur" x="-25%" y="-25%" width="150%" height="150%">`
      + `<feGaussianBlur id="fogEdgeBlurNode" stdDeviation="0"/>`
      + `</filter>`
      + `<mask id="fogMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${VBW}" height="${VBH}">`
      + `<rect x="0" y="0" width="${VBW}" height="${VBH}" fill="white"/>`
      + `<g id="fogHoles" filter="url(#fogEdgeBlur)"></g></mask></defs>`
      + `<image id="fogTexture" href="./assets/fog-of-war-clouds.jpg" x="0" y="0" `
      + `width="${VBW * artScaleX}" height="${VBH * artScaleY}" `
      + `preserveAspectRatio="none" opacity="0.9" mask="url(#fogMask)"/>`;
    // Арт остаётся под туманом, клетки/маркеры — над ним. Невидимые клетки
    // скрываются классом, а допустимые цели могут подсвечиваться поверх маски.
    boardVp.insertBefore(layer, boardVp.querySelector('.cell'));
  }
  const texture = layer.querySelector('#fogTexture');
  texture?.setAttribute('width', (VBW * artScaleX).toFixed(2));
  texture?.setAttribute('height', (VBH * artScaleY).toFixed(2));
  // Мягкая кромка шириной примерно в два клеточных шага. Размываются только отверстия
  // маски; сама карта, сетка и фишки остаются резкими.
  layer.querySelector('#fogEdgeBlurNode')
    ?.setAttribute('stdDeviation', (fogCellStep() * 0.5).toFixed(2));
  const holes = layer.querySelector('#fogHoles');
  holes.innerHTML = circles.map(({ cx, cy, r }) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="black"/>`,
  ).join('');
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
      return {
        mode: 'split',
        payload: {
          characterId: sel.id,
          toCell: best.cell,
          dieIndex: i,
          engageTargetId: enemy.id,
        },
      };
    }
  }
  if (!usedDice[0] && !usedDice[1] && best.steps <= dice[0] + dice[1]) {
    return {
      mode: 'moveSum',
      payload: {
        characterId: sel.id,
        toCell: best.cell,
        engageTargetId: enemy.id,
      },
    };
  }
  return null;
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
    if (!inv.some(c => c.id === TELEPORT_ID && !c.exhausted)) return result;
    const ownStarts = Object.values(boardMap?.starts?.[charSide(char)] ?? {});
    const teleportPoints = cells
      .filter(cell => cell.pointClass === 'teleport')
      .map(cell => cell.id);
    for (const id of [...ownStarts, ...teleportPoints]) {
      if (id === characterPosition(char)) continue;
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
    mk.setAttribute('data-cell-id', c.id);
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
// Оверлей просмотра карты после добора или на террейне
// ═════════════════════════════════════════════════════════════════

function buildEventOverlay() {
  if (eventOverlayEl) return;
  eventOverlayEl = document.createElement('div');
  eventOverlayEl.id = 'eventOverlay';
  eventOverlayEl.className = 'event-overlay hidden';
  eventOverlayEl.innerHTML = `
    <div class="event-card-reveal">
      <div class="event-title" id="eventTitle">Взята карта</div>
      <div class="event-card-display" id="eventCardDisplay"></div>
      <button class="event-return-btn hidden" id="eventReturnBtn">Вернуть в инвентарь</button>
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
  const returnBtn = eventOverlayEl.querySelector('#eventReturnBtn');
  
  title.textContent = overrideTitle || (isDiscarded ? 'Инвентарь полон!' : 'Взята карта');
  title.classList.remove('hidden');
  title.style.color = overrideTitle ? 'var(--danger)' : (isDiscarded ? 'var(--danger)' : 'var(--gold)');
  
  display.innerHTML = renderCard(card, 999, true); // true = forceOpen
  returnBtn.classList.add('hidden');
  returnBtn.onclick = null;
  eventOverlayEl.querySelector('#eventOkBtn').textContent = 'Принять';
  const cardEl = display.querySelector('.card');
  if (cardEl) {
    if (isDiscarded) cardEl.style.opacity = '0.7';
  }

  eventOverlayEl.classList.remove('hidden');
}

function showTerrainCard(uid, terrainCard) {
  if (!eventOverlayEl) buildEventOverlay();
  const card = terrainCard.cardData;
  const own = terrainCard.ownerId === myPlayerId;
  const title = eventOverlayEl.querySelector('#eventTitle');
  title.textContent = '';
  title.classList.add('hidden');
  eventOverlayEl.querySelector('#eventCardDisplay').innerHTML = renderCard(card, 999, true);
  const returnBtn = eventOverlayEl.querySelector('#eventReturnBtn');
  returnBtn.classList.toggle('hidden', !own);
  returnBtn.onclick = own ? () => {
    wsSend('action:terrainRemove', { id: uid });
    hideEventOverlay();
  } : null;
  eventOverlayEl.querySelector('#eventOkBtn').textContent = 'Закрыть';
  eventOverlayEl.classList.remove('hidden');
}

function hideEventOverlay() {
  eventOverlayEl?.classList.add('hidden');
}

// Обработка прямого результата действия (нужна для мгновенной обратной связи)
function handleActionResult(result) {
  if (result.moved) {
    const m = result.moved;
    if (m.engagedTargetId) {
      const game = getGame();
      const attacker = game?.characters.find(char => char.id === m.characterId);
      const target = game?.characters.find(char => char.id === m.engagedTargetId);
      const attackerName = ROLE_NAMES[attacker?.role] ?? 'Персонаж';
      const targetName = ROLE_NAMES[target?.role] ?? 'противник';
      showToast(`${attackerName} вступает в бой: ${targetName}`, 'danger');
      addLog(`${attackerName} вступает в бой с ${targetName}.`, { type: 'my' });
    }
  }

  if (result.redEvent) {
    const ev = result.redEvent;
    if (ev.beast) {
      showToast(`🐗 Нападение зверя: ${ev.name}!`, 'danger');
      addLog(`На красной клетке: нападение зверя ${ev.name}!`, { type: 'err' });
    }
  }

  if (result.drawn) {
    const d = result.drawn;
    const card = { id: d.card, name: d.name, type: d.type, desc: d.desc };
    showFoundCard(card, false);
    const toolName = d.bonusTool === 'hammer' ? 'Молоток'
      : d.bonusTool === 'sack' ? 'Мешок'
      : null;
    showToast(toolName ? `${toolName}: взято 2 карты` : `Взято из колоды: ${d.name}`, 'success');
  }

  if (result.transferred) {
    const t = result.transferred;
    const name = t.name || getCardName(t.cardId);
    showToast(`Передано: ${name}`, 'info');
  }

  if (result.terrainPlaced) {
    const placed = result.terrainPlaced;
    const label = placed.faceDown ? 'Карта рубашкой вверх' : (placed.name ?? 'Карта');
    showToast(`${label} выложена на террейн`, 'info');
    addLog(`${label} выложена на террейн.`, { type: 'my' });
  }

  if (result.terrainRemoved) {
    showToast('Карта возвращена в инвентарь', 'info');
    addLog('Карта возвращена с террейна в инвентарь.', { type: 'my' });
  }

  if (result.terrainFlipped) {
    const flipped = result.terrainFlipped;
    const state = flipped.faceDown ? 'неактивна, рубашкой вверх' : 'активна, лицом вверх';
    showToast(`${flipped.name}: ${state}`, 'info');
    addLog(`${flipped.name}: ${state}.`, { type: 'my' });
  }

  if (result.teleported) {
    const t = result.teleported;
    if (t.success) {
      showToast(`Телепортация удалась: кубик ${t.value}`, 'success');
      addLog(`Бусы телепортации: кубик ${t.value}, персонаж перемещён. Карта перевёрнута рубашкой вверх.`, { type: 'my' });
    } else {
      teleportedChars.delete(t.characterId);
      showToast(`Телепортация не удалась: кубик ${t.value}`, 'info');
      addLog(`Бусы телепортации: кубик ${t.value}, нужно 2 или больше.`, { type: 'sys' });
    }
  }

  if (result.attacked) {
    const a = result.attacked;
    triggerAttackEffect(a.targetId);
    const attacker = getGame()?.characters.find(c => c.id === a.attackerId);
    const target = getGame()?.characters.find(c => c.id === a.targetId);
    const attackerName = attacker?.role || 'Персонаж';
    const targetName = target?.role || 'Персонаж';
    
    if (a.griffinDamage > 0) {
      showToast(`Гриффон: ${a.griffinDamage} урона, карта стала неактивной`, 'danger');
      addLog(`${attackerName} атаковал ${targetName}: кубики ${a.damage} + Гриффон ${a.griffinDamage} = ${a.totalDamage}. Гриффон перевёрнут рубашкой вверх.`, { type: 'err' });
    } else {
      showToast(`⚔️ Атака: ${a.damage} урона!`, 'danger');
      addLog(`${attackerName} атаковал ${targetName}: ${a.damage} урона`, { type: 'err' });
    }
    
    if (a.defeated) {
      showToast(`💀 ${targetName} повержен!`, 'danger');
      addLog(`${targetName} повержен! Добыча: ${a.lootCount} карт${a.discardedCount > 0 ? ` (${a.discardedCount} в сброс)` : ''}`, { type: 'err' });
    }
  }

  if (result.beastFought) {
    const b = result.beastFought;
    if (b.damage > 0) {
      showDamageNumber({
        charId: b.characterId,
        cellId: b.cellId,
        amount: b.damage,
        overBeast: true,
      });
    }
    if (b.killed) {
      const hideName = b.hide ? getCardName(b.hide) : null;
      const weapon = b.clubUsed ? ' Дубина сработала.' : '';
      showToast(hideName ? `🐗 Зверь убит!${weapon} Добыта: ${hideName}` : `🐗 Зверь убит!${weapon}`, 'success');
      addLog(hideName
        ? `Зверь убит (кубик ${b.value}). Добыта «${hideName}».`
        : `Зверь убит (кубик ${b.value}).`, { type: 'my' });
    } else {
      addLog(`Удар по зверю: кубик ${b.value}, успехи ${b.successes}/${b.needed}.`, { type: 'sys' });
    }
  }

  if (result.hideProcessed) {
    const h = result.hideProcessed;
    if (h.success) {
      showToast('🧵 Шкура очищена', 'success');
      addLog(`Шаман обработал шкуру (кубик ${h.value}) → «${getCardName(h.cleaned)}».`, { type: 'my' });
    } else {
      showToast('Обработка не удалась', 'info');
      addLog(`Обработка шкуры не удалась (кубик ${h.value}, нужно ≥2). Шкура осталась.`, { type: 'sys' });
    }
  }

  if (result.crafted) {
    const label = CRAFT_RECIPES[result.crafted.item]?.label ?? 'изделие';
    showToast(`🔨 Открыто: ${label}!`, 'success');
    addLog(`Открыто изделие «${label}» по чертежу/рецепту (материалы израсходованы).`, { type: 'my' });
  }

  if (result.craftAttempt && !result.craftAttempt.success) {
    const a = result.craftAttempt;
    const label = CRAFT_RECIPES[a.item]?.label ?? 'изделия';
    const requirement = a.values.length > 1
      ? `${a.min}+ на каждом кубике`
      : `${a.min}+ на кубике`;
    showToast(`Испытание «${label}» не пройдено: [${a.values.join(', ')}]`, 'info');
    addLog(`Испытание «${label}»: [${a.values.join(', ')}], нужно ${requirement}. Материалы сохранены.`, { type: 'sys' });
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
      showDamageNumber({
        charId: char.id,
        cellId: characterPosition(char) ?? characterPosition(prevChar),
        amount: damage,
      });
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
