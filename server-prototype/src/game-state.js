import { randomUUID } from 'node:crypto';
import { PLAYER_LIMIT } from './constants.js';
import * as rules from './rules.js';

// Хранилище комнат, игроков и сессий. Игровую логику не знает —
// делегирует движку правил (rules.js) и отдает персональные снимки.

export function createStore() {
  const rooms = new Map(); // roomId -> room
  const codes = new Map(); // code -> roomId

  function createRoom({ playerName, connectionId, vsBot = false }) {
    const room = {
      id: randomUUID(),
      code: makeUniqueCode(codes),
      revision: 0,
      status: 'waiting',
      players: [],
      game: null,
      vsBot: false,
    };

    const player = makePlayer({ playerName, connectionId, seatIndex: 0 });
    room.players.push(player);

    if (vsBot) {
      room.players.push({
        id: randomUUID(),
        sessionToken: randomUUID(),
        connectionId: null,
        connected: true,
        isBot: true,
        seatIndex: 1,
        side: 'red',
        name: 'ИИ',
      });
      room.vsBot = true;
      room.status = 'active';
      room.game = rules.createGame(room.players);
    }

    rooms.set(room.id, room);
    codes.set(room.code, room.id);
    return { room, player };
  }

  function joinRoom({ code, playerName, connectionId }) {
    const roomId = codes.get(normalizeCode(code));
    const room = roomId ? rooms.get(roomId) : null;

    if (!room) {
      throw new Error('Комната не найдена.');
    }
    if (room.players.length >= PLAYER_LIMIT) {
      throw new Error('Комната уже заполнена.');
    }

    const player = makePlayer({
      playerName,
      connectionId,
      seatIndex: room.players.length,
    });
    room.players.push(player);
    room.revision += 1;

    if (room.players.length === PLAYER_LIMIT) {
      room.status = 'active';
      room.game = rules.createGame(room.players);
    }

    return { room, player };
  }

  function resumeSession({ roomId, sessionToken, connectionId }) {
    const room = rooms.get(roomId);
    if (!room) {
      throw new Error('Комната не найдена.');
    }

    const player = room.players.find((p) => p.sessionToken === sessionToken);
    if (!player) {
      throw new Error('Сессия не найдена.');
    }

    player.connectionId = connectionId;
    player.connected = true;
    return { room, player };
  }

  function markDisconnected(connectionId) {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.connectionId === connectionId);
      if (player) {
        player.connected = false;
        return room;
      }
    }
    return null;
  }

  function applyCommand({ roomId, playerId, type, payload }) {
    const room = rooms.get(roomId);
    if (!room) {
      throw new Error('Комната не найдена.');
    }
    if (!room.game) {
      throw new Error('Игра еще не началась — ждем второго игрока.');
    }

    const result = rules.apply(room.game, playerId, type, payload);
    room.revision += 1;
    return { room, result };
  }

  function getRoom(roomId) {
    return rooms.get(roomId) ?? null;
  }

  // Персональный снимок: чужие руки скрыты, видны только счетчики карт.
  function snapshot(room, forPlayerId) {
    return {
      id: room.id,
      code: room.code,
      revision: room.revision,
      status: room.status,
      you: forPlayerId ?? null,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        side: p.side,
        seatIndex: p.seatIndex,
        connected: p.connected,
        isBot: p.isBot ?? false,
      })),
      game: room.game ? snapshotGame(room.game, forPlayerId) : null,
    };
  }

  return {
    createRoom,
    joinRoom,
    resumeSession,
    markDisconnected,
    applyCommand,
    getRoom,
    snapshot,
  };
}

function snapshotGame(game, forPlayerId) {
  return {
    over: game.over,
    winnerId: game.winnerId,
    deckCount: game.deck.length,
    discardCount: game.discard.length,
    turn: {
      activePlayerId: game.turn.activePlayerId,
      rollsLeft: game.turn.rollsLeft,
      dice: game.turn.dice,
      usedDice: game.turn.usedDice,
      mode: game.turn.mode,
    },
    characters: game.characters.map((c) => ({
      id: c.id,
      owner: c.owner,
      role: c.role,
      position: c.position,
      hp: c.hp,
      cardCount: c.inventory.length,
      // полный инвентарь — только владельцу
      inventory: c.owner === forPlayerId ? [...c.inventory] : undefined,
    })),
  };
}

function makePlayer({ playerName, connectionId, seatIndex }) {
  return {
    id: randomUUID(),
    sessionToken: randomUUID(),
    connectionId,
    connected: true,
    seatIndex,
    side: seatIndex === 0 ? 'green' : 'red',
    name: normalizePlayerName(playerName),
  };
}

function normalizePlayerName(playerName) {
  if (typeof playerName !== 'string' || playerName.trim().length === 0) {
    return 'Игрок';
  }
  return playerName.trim().slice(0, 32);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeUniqueCode(codes) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!codes.has(code)) {
      return code;
    }
  }
  throw new Error('Не удалось сгенерировать код комнаты.');
}

function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}
