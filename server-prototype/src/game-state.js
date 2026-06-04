import { randomUUID } from 'node:crypto';

const PLAYER_LIMIT = 2;

export function createStore() {
  const rooms = new Map();

  function createRoom({ playerName, connectionId }) {
    const room = {
      id: randomUUID(),
      revision: 0,
      status: 'waiting',
      players: [],
      turn: {
        activePlayerId: null,
        rollsLeft: 10,
        lastRoll: null,
      },
    };

    const player = createPlayer({ playerName, connectionId });
    room.players.push(player);
    room.turn.activePlayerId = player.id;

    rooms.set(room.id, room);
    return { room: snapshotRoom(room), player };
  }

  function joinRoom({ roomId, playerName, connectionId }) {
    const room = rooms.get(roomId);

    if (!room) {
      throw new Error('Комната не найдена.');
    }

    if (room.players.length >= PLAYER_LIMIT) {
      throw new Error('Комната уже заполнена.');
    }

    const player = createPlayer({ playerName, connectionId });
    room.players.push(player);
    room.revision += 1;

    if (room.players.length === PLAYER_LIMIT) {
      room.status = 'ready';
    }

    return { room: snapshotRoom(room), player };
  }

  function getRoom(roomId) {
    const room = rooms.get(roomId);
    return room ? snapshotRoom(room) : null;
  }

  function rollTurn({ roomId, playerId }) {
    const room = rooms.get(roomId);

    if (!room) {
      throw new Error('Комната не найдена.');
    }

    if (room.turn.activePlayerId !== playerId) {
      throw new Error('Сейчас ход другого игрока.');
    }

    if (room.turn.rollsLeft <= 0) {
      throw new Error('Броски на этот ход закончились.');
    }

    const dice = [rollDie(), rollDie()];
    room.turn.rollsLeft -= 1;
    room.turn.lastRoll = dice;
    room.revision += 1;

    return {
      room: snapshotRoom(room),
      roll: {
        dice,
        total: dice[0] + dice[1],
        rollsLeft: room.turn.rollsLeft,
      },
    };
  }

  return {
    createRoom,
    joinRoom,
    getRoom,
    rollTurn,
  };
}

function createPlayer({ playerName, connectionId }) {
  return {
    id: randomUUID(),
    connectionId,
    name: normalizePlayerName(playerName),
  };
}

function normalizePlayerName(playerName) {
  if (typeof playerName !== 'string' || playerName.trim().length === 0) {
    return 'Игрок';
  }

  return playerName.trim().slice(0, 32);
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function snapshotRoom(room) {
  return {
    id: room.id,
    revision: room.revision,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
    })),
    turn: {
      activePlayerId: room.turn.activePlayerId,
      rollsLeft: room.turn.rollsLeft,
      lastRoll: room.turn.lastRoll,
    },
  };
}
