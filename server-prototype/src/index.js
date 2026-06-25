import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './game-state.js';
import { ClientCommand, ServerEvent, GAME_COMMANDS } from './protocol.js';
import { runBotTurn } from './bot.js';
import { registerAdmin } from './admin.js';
import { registerAuth, getAuthUserFromRequest } from './auth.js';
import { createAuthStore } from './auth-store.js';
import { createRoomPersistence } from './room-persistence.js';
import { BASE_CARD_CATALOG, BUILD_VERSION, CARD_CATALOG, CRAFT_RECIPES } from './constants.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(process.env.WEB_ROOT ?? resolve(__dirname, '../../prototype-web'));
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DEBUG_COMMANDS_ENABLED = process.env.DEBUG_COMMANDS === '1'
  || (process.env.NODE_ENV !== 'production' && LOCAL_HOSTS.has(HOST));

// trustProxy: за nginx реальный IP клиента приходит в X-Forwarded-For (req.ip).
const app = Fastify({ logger: true, trustProxy: true });
const roomPersistence = createRoomPersistence();
const store = createStore({ roomPersistence });
const authStore = createAuthStore();
const clients = new Map();
const botRunning = new Set();        // roomId → бот сейчас ходит
const lobbySubscribers = new Set();  // connectionId → смотрит список открытых игр

await app.register(websocket);
registerAuth(app, { authStore });

// Админ-панель (/admin, /admin/data) — диагностика клиентов и комнат.
// Авторизация: форма логина с сессионной кукой (или Basic Auth для curl/nginx).
registerAdmin(app, { store, clients, lobbySubscribers, version: BUILD_VERSION });

app.get('/health', async () => ({
  ok: true,
  service: 'rram-server-prototype',
}));

app.get('/*', async (req, reply) => {
  if (!existsSync(WEB_ROOT)) {
    return reply.code(404).send('Not found');
  }
  const url = new URL(req.raw.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const cleanPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = resolve(WEB_ROOT, `.${cleanPath}`);
  if (!isPathInside(filePath, WEB_ROOT) || !existsSync(filePath)) {
    return reply.code(404).send('Not found');
  }
  return reply
    .type(mimeFor(filePath))
    .send(createReadStream(filePath));
});

app.get('/ws', { websocket: true }, (socket, req) => {
  const connectionId = randomUUID();
  const now = Date.now();
  const authUser = getAuthUserFromRequest(req, authStore);
  clients.set(connectionId, {
    socket,
    roomId: null,
    playerId: null,
    role: 'lobby',
    user: authUser,
    fogEnabled: true,
    // Диагностика для админки
    ip: req?.ip ?? '?',
    ua: String(req?.headers?.['user-agent'] ?? '').slice(0, 120),
    version: null,
    connectedAt: now,
    lastSeen: now,
  });

  send(socket, ServerEvent.CONNECTED, {
    connectionId,
    serverVersion: BUILD_VERSION,
    debugCommands: DEBUG_COMMANDS_ENABLED,
    localActionJournal: DEBUG_COMMANDS_ENABLED,
    authUser,
    cardCatalog: [...CARD_CATALOG, ...BASE_CARD_CATALOG],
    craftRecipes: CRAFT_RECIPES,
  });

  socket.on('message', (rawMessage) => {
    handleMessage(connectionId, rawMessage);
  });

  socket.on('close', () => {
    const client = clients.get(connectionId);
    const room = client?.roomId && client?.playerId ? store.markDisconnected(connectionId) : null;
    clients.delete(connectionId);
    lobbySubscribers.delete(connectionId);
    if (room) {
      broadcastState(room.id);
    }
    // Уход игрока мог освободить/удалить публичную комнату — обновим списки.
    broadcastLobby();
  });
});

await app.listen({ port: PORT, host: HOST });

// Серверный замер RTT до каждого клиента: шлём srv:ping со своей меткой времени,
// клиент эхом возвращает srv:pong с той же меткой → RTT = now - t (часы серверные,
// синхронизация не нужна). Значение показывается в админке. Заодно держит сокет тёплым.
const RTT_PING_MS = 5000;
setInterval(() => {
  const t = Date.now();
  for (const client of clients.values()) {
    if (client.socket?.readyState === 1 /* OPEN */) {
      try { send(client.socket, 'srv:ping', { t }); } catch { /* сокет закрывается */ }
    }
  }
}, RTT_PING_MS).unref();

function handleMessage(connectionId, rawMessage) {
  const client = clients.get(connectionId);
  if (!client) {
    return;
  }
  client.lastSeen = Date.now(); // для админки: «idle» клиента

  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    send(client.socket, ServerEvent.ERROR, { message: 'Ожидался JSON.' });
    return;
  }

  try {
    routeCommand(connectionId, message);
  } catch (error) {
    send(client.socket, ServerEvent.ERROR, {
      message: error.message || 'Неизвестная ошибка.',
    });
  }
}

function routeCommand(connectionId, message) {
  const client = clients.get(connectionId);

  if (!message || typeof message.type !== 'string') {
    throw new Error('У команды должно быть поле type.');
  }

  switch (message.type) {
    case 'ping': {
      // keepalive: клиент проверяет живость сокета (нужно без входа в комнату)
      send(client.socket, 'pong', {});
      break;
    }

    case 'client:hello': {
      // Клиент сообщает свою версию сборки — для админки (видно, кто на старом билде).
      const v = message.payload?.version;
      if (typeof v === 'string') client.version = v.slice(0, 32);
      break;
    }

    case 'srv:pong': {
      // Ответ на серверный srv:ping — считаем RTT по своей же метке времени.
      const t = message.payload?.t;
      if (typeof t === 'number') {
        client.rtt = Date.now() - t;
        client.rttAt = Date.now();
      }
      break;
    }

    case 'client:setFog': {
      client.fogEnabled = DEBUG_COMMANDS_ENABLED ? message.payload?.enabled !== false : true;
      const room = client.roomId ? store.getRoom(client.roomId) : null;
      if (room) {
        send(client.socket, ServerEvent.STATE_SNAPSHOT, {
          room: snapshotForClient(room, client),
        });
      }
      break;
    }

    case 'chat:send': {
      // Чат только в комнате (в лобби чата нет). Сообщение — участникам комнаты.
      const room = client.roomId ? store.getRoom(client.roomId) : null;
      if (!room) break;
      const text = String(message.payload?.text ?? '').trim().slice(0, 200);
      if (!text) break;
      const now = Date.now();
      if (now - (client.lastChatAt ?? 0) < 400) break; // троттлинг от флуда
      client.lastChatAt = now;
      const player = room.players.find((p) => p.id === client.playerId);
      if (!player) break;
      const msg = { scope: 'room', name: player?.name ?? 'Игрок', text, ts: now };
      for (const c of clients.values()) {
        if (c.roomId === client.roomId) send(c.socket, 'chat:message', msg);
      }
      break;
    }

    case ClientCommand.ROOM_CREATE: {
      const vsBot = message.payload?.vsBot === true;
      const isPublic = message.payload?.public === true;
      const { room, player } = store.createRoom({
        playerName: playerNameFor(client, message.payload),
        userId: client.user?.id ?? null,
        connectionId,
        vsBot,
        isPublic,
      });
      bindClient(client, room.id, player.id);
      lobbySubscribers.delete(connectionId); // хост больше не смотрит список
      send(client.socket, ServerEvent.ROOM_CREATED, {
        roomId: room.id,
        code: room.code,
        playerId: player.id,
        sessionToken: player.sessionToken,
        vsBot: room.vsBot,
        public: room.public,
      });
      broadcastState(room.id);
      broadcastLobby();
      break;
    }

    case ClientCommand.ROOM_JOIN: {
      const { room, player } = store.joinRoom({
        code: message.payload?.code,
        playerName: playerNameFor(client, message.payload),
        userId: client.user?.id ?? null,
        connectionId,
      });
      bindClient(client, room.id, player.id);
      lobbySubscribers.delete(connectionId);
      send(client.socket, ServerEvent.ROOM_JOINED, {
        roomId: room.id,
        code: room.code,
        playerId: player.id,
        sessionToken: player.sessionToken,
      });
      broadcastState(room.id);
      broadcastLobby();
      break;
    }

    case ClientCommand.ROOM_WATCH: {
      const { room } = store.watchRoom({
        roomId: message.payload?.roomId,
        code: message.payload?.code,
      });
      bindClient(client, room.id, null, 'spectator');
      lobbySubscribers.delete(connectionId);
      send(client.socket, ServerEvent.ROOM_WATCHED, {
        roomId: room.id,
        code: room.code,
      });
      send(client.socket, ServerEvent.STATE_SNAPSHOT, {
        room: snapshotForClient(room, client),
      });
      break;
    }

    case ClientCommand.ROOM_LEAVE: {
      if (client.roomId && !client.playerId) {
        bindClient(client, null, null);
        break;
      }
      if (client.roomId && client.playerId) {
        const roomId = client.roomId;
        store.leaveRoom({ roomId, playerId: client.playerId });
        bindClient(client, null, null);
        broadcastState(roomId); // соперник увидит сдачу/итог
        broadcastLobby();
      }
      break;
    }

    case ClientCommand.LOBBY_JOIN: {
      const { room, player } = store.joinById({
        roomId: message.payload?.roomId,
        playerName: playerNameFor(client, message.payload),
        userId: client.user?.id ?? null,
        connectionId,
      });
      bindClient(client, room.id, player.id);
      lobbySubscribers.delete(connectionId);
      send(client.socket, ServerEvent.ROOM_JOINED, {
        roomId: room.id,
        code: room.code,
        playerId: player.id,
        sessionToken: player.sessionToken,
      });
      broadcastState(room.id);
      broadcastLobby();
      break;
    }

    case ClientCommand.LOBBY_SUBSCRIBE: {
      lobbySubscribers.add(connectionId);
      send(client.socket, ServerEvent.LOBBY_LIST, { rooms: store.listPublicRooms() });
      break;
    }

    case ClientCommand.LOBBY_UNSUBSCRIBE: {
      lobbySubscribers.delete(connectionId);
      break;
    }

    case ClientCommand.SESSION_RESUME: {
      const { room, player } = store.resumeSession({
        roomId: message.payload?.roomId,
        sessionToken: message.payload?.sessionToken,
        connectionId,
      });
      bindClient(client, room.id, player.id);
      send(client.socket, ServerEvent.SESSION_RESUMED, {
        roomId: room.id,
        code: room.code,
        playerId: player.id,
      });
      broadcastState(room.id);
      break;
    }

    default: {
      if (!GAME_COMMANDS.has(message.type)) {
        throw new Error(`Неизвестная команда: ${message.type}`);
      }
      if (message.type === ClientCommand.DEBUG_GRANT_CARD && !DEBUG_COMMANDS_ENABLED) {
        throw new Error('Отладочная выдача карт отключена на этом сервере.');
      }
      assertJoined(client);
      const { result } = store.applyCommand({
        roomId: client.roomId,
        playerId: client.playerId,
        type: message.type,
        payload: message.payload,
      });
      if (result) {
        const actionResult = decorateActionResult(result, {
          actorId: client.playerId,
          commandType: message.type,
        });
        if (DEBUG_COMMANDS_ENABLED) {
          broadcastActionResult(client.roomId, actionResult);
        } else {
          send(client.socket, 'action:result', actionResult);
        }
      }
      broadcastState(client.roomId);
      break;
      }
      }
      }
function bindClient(client, roomId, playerId, role = playerId ? 'player' : 'lobby') {
  client.roomId = roomId;
  client.playerId = playerId;
  client.role = role;
}

function playerNameFor(client, payload = {}) {
  return client.user?.displayName ?? payload?.playerName;
}

function snapshotForClient(room, client) {
  const spectator = client.role === 'spectator' || !client.playerId;
  return store.snapshot(room, spectator ? null : client.playerId, {
    fogEnabled: spectator ? false : client.fogEnabled,
    revealAllInventories: DEBUG_COMMANDS_ENABLED && !spectator,
    spectator,
  });
}

function assertJoined(client) {
  if (!client.roomId || !client.playerId) {
    throw new Error('Сначала нужно создать комнату или войти в нее.');
  }
}

// Каждому клиенту в комнате — свой снимок (чужие карты скрыты).
function broadcastState(roomId) {
  const room = store.getRoom(roomId);
  if (!room) return;
  for (const client of clients.values()) {
    if (client.roomId === roomId) {
      send(client.socket, ServerEvent.STATE_SNAPSHOT, {
        room: snapshotForClient(room, client),
      });
    }
  }
  maybeTriggerBot(roomId);
}

function decorateActionResult(result, meta = {}) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    actorId: result.actorId ?? meta.actorId ?? null,
    commandType: result.commandType ?? meta.commandType ?? null,
  };
}

function broadcastActionResult(roomId, result, meta = {}) {
  const payload = decorateActionResult(result, meta);
  for (const client of clients.values()) {
    if (client.roomId === roomId) {
      send(client.socket, 'action:result', payload);
    }
  }
}

// Список открытых игр — всем, кто сейчас на экране лобби.
function broadcastLobby() {
  if (lobbySubscribers.size === 0) return;
  const rooms = store.listPublicRooms();
  for (const connectionId of lobbySubscribers) {
    const client = clients.get(connectionId);
    if (client) send(client.socket, ServerEvent.LOBBY_LIST, { rooms });
  }
}

function maybeTriggerBot(roomId) {
  if (botRunning.has(roomId)) return;
  const room = store.getRoom(roomId);
  if (!room?.vsBot || !room.game || room.game.over) return;
  const bot = room.players.find(p => p.isBot);
  if (!bot || room.game.turn.activePlayerId !== bot.id) return;

  botRunning.add(roomId);
  runBotTurn({
    applyCommand: store.applyCommand,
    getRoom:      store.getRoom,
    broadcast:    broadcastState,
    emitActionResult: (targetRoomId, result, meta = {}) => broadcastActionResult(targetRoomId, result, {
      actorId: bot.id,
      ...meta,
    }),
    roomId,
    botPlayerId:  bot.id,
  }).finally(() => botRunning.delete(roomId));
}

function send(socket, type, payload) {
  socket.send(JSON.stringify({ type, payload }));
}

function isPathInside(filePath, rootPath) {
  const rel = relative(rootPath, filePath);
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
}

function mimeFor(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
  }[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
