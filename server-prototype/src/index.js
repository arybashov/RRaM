import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { createStore } from './game-state.js';
import { ClientCommand, ServerEvent } from './protocol.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = Fastify({ logger: true });
const store = createStore();
const clients = new Map();

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
  });

  send(socket, ServerEvent.CONNECTED, { connectionId });

  socket.on('message', (rawMessage) => {
    handleMessage(connectionId, rawMessage);
  });

  socket.on('close', () => {
    clients.delete(connectionId);
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
    case ClientCommand.ROOM_CREATE: {
      const { room, player } = store.createRoom({
        playerName: message.payload?.playerName,
        connectionId,
      });

      client.roomId = room.id;
      client.playerId = player.id;

      send(client.socket, ServerEvent.ROOM_CREATED, {
        roomId: room.id,
        playerId: player.id,
      });
      broadcastRoom(room.id, ServerEvent.ROOM_SNAPSHOT, { room });
      break;
    }

    case ClientCommand.ROOM_JOIN: {
      const { room, player } = store.joinRoom({
        roomId: message.payload?.roomId,
        playerName: message.payload?.playerName,
        connectionId,
      });

      client.roomId = room.id;
      client.playerId = player.id;

      send(client.socket, ServerEvent.ROOM_JOINED, {
        roomId: room.id,
        playerId: player.id,
      });
      broadcastRoom(room.id, ServerEvent.ROOM_SNAPSHOT, { room });
      break;
    }

    case ClientCommand.TURN_ROLL: {
      assertJoined(client);

      const { room, roll } = store.rollTurn({
        roomId: client.roomId,
        playerId: client.playerId,
      });

      broadcastRoom(room.id, ServerEvent.TURN_ROLLED, { roll, room });
      break;
    }

    default:
      throw new Error(`Неизвестная команда: ${message.type}`);
  }
}

function assertJoined(client) {
  if (!client.roomId || !client.playerId) {
    throw new Error('Сначала нужно создать комнату или войти в нее.');
  }
}

function broadcastRoom(roomId, type, payload) {
  for (const client of clients.values()) {
    if (client.roomId === roomId) {
      send(client.socket, type, payload);
    }
  }
}

function send(socket, type, payload) {
  socket.send(JSON.stringify({ type, payload }));
}
