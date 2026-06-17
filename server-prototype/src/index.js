import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { createStore } from './game-state.js';
import { ClientCommand, ServerEvent, GAME_COMMANDS } from './protocol.js';
import { runBotTurn } from './bot.js';
import { BASE_CARD_CATALOG, BUILD_VERSION, CARD_CATALOG } from './constants.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DEBUG_COMMANDS_ENABLED = process.env.DEBUG_COMMANDS === '1'
  || (process.env.NODE_ENV !== 'production' && LOCAL_HOSTS.has(HOST));

const app = Fastify({ logger: true });
const store = createStore();
const clients = new Map();
const botRunning = new Set();        // roomId → бот сейчас ходит
const lobbySubscribers = new Set();  // connectionId → смотрит список открытых игр

await app.register(websocket);

app.get('/health', async () => ({
  ok: true,
  service: 'rram-server-prototype',
}));

app.get('/ws', { websocket: true }, (socket) => {
  const connectionId = randomUUID();
  clients.set(connectionId, {
    socket,
    roomId: null,
    playerId: null,
    fogEnabled: true,
  });

  send(socket, ServerEvent.CONNECTED, {
    connectionId,
    serverVersion: BUILD_VERSION,
    debugCommands: DEBUG_COMMANDS_ENABLED,
    cardCatalog: [...CARD_CATALOG, ...BASE_CARD_CATALOG],
  });

  socket.on('message', (rawMessage) => {
    handleMessage(connectionId, rawMessage);
  });

  socket.on('close', () => {
    const client = clients.get(connectionId);
    const room = client?.roomId ? store.markDisconnected(connectionId) : null;
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

function handleMessage(connectionId, rawMessage) {
  const client = clients.get(connectionId);
  if (!client) {
    return;
  }

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

    case 'client:setFog': {
      client.fogEnabled = message.payload?.enabled !== false;
      const room = client.roomId ? store.getRoom(client.roomId) : null;
      if (room) {
        send(client.socket, ServerEvent.STATE_SNAPSHOT, {
          room: store.snapshot(room, client.playerId, { fogEnabled: client.fogEnabled }),
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
        playerName: message.payload?.playerName,
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
        playerName: message.payload?.playerName,
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

    case ClientCommand.ROOM_LEAVE: {
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
        playerName: message.payload?.playerName,
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
        send(client.socket, 'action:result', result);
      }
      broadcastState(client.roomId);
      break;
      }
      }
      }
function bindClient(client, roomId, playerId) {
  client.roomId = roomId;
  client.playerId = playerId;
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
        room: store.snapshot(room, client.playerId, { fogEnabled: client.fogEnabled }),
      });
    }
  }
  maybeTriggerBot(roomId);
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
    roomId,
    botPlayerId:  bot.id,
  }).finally(() => botRunning.delete(roomId));
}

function send(socket, type, payload) {
  socket.send(JSON.stringify({ type, payload }));
}
