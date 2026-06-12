import { randomUUID } from 'node:crypto';
import { PLAYER_LIMIT, CARD_BY_ID, BEASTS, FOG_RADIUS } from './constants.js';
import * as rules from './rules.js';
import { mapSnapshot, reachableCells } from './map.js';

// Хранилище комнат, игроков и сессий. Игровую логику не знает —
// делегирует движку правил (rules.js) и отдает персональные снимки.

export function createStore() {
  const rooms = new Map(); // roomId -> room
  const codes = new Map(); // code -> roomId

  function createRoom({ playerName, connectionId, vsBot = false, isPublic = false }) {
    const room = {
      id: randomUUID(),
      code: makeUniqueCode(codes),
      revision: 0,
      status: 'waiting',
      players: [],
      game: null,
      vsBot: false,
      public: vsBot ? false : isPublic === true,
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
    return addPlayer({ room, playerName, connectionId });
  }

  function joinById({ roomId, playerName, connectionId }) {
    const room = roomId ? rooms.get(roomId) : null;
    return addPlayer({ room, playerName, connectionId });
  }

  function addPlayer({ room, playerName, connectionId }) {
    if (!room) {
      throw new Error('Комната не найдена.');
    }
    if (room.status !== 'waiting' || room.players.length >= PLAYER_LIMIT) {
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

  // Открытые игры для лобби: публичные, ждут второго, не против ИИ,
  // и хост ещё на связи.
  function listPublicRooms() {
    const list = [];
    for (const room of rooms.values()) {
      if (
        room.public
        && room.status === 'waiting'
        && !room.vsBot
        && room.players.length < PLAYER_LIMIT
        && room.players.some((p) => !p.isBot && p.connected)
      ) {
        const host = room.players.find((p) => !p.isBot);
        list.push({
          roomId: room.id,
          hostName: host?.name ?? 'Игрок',
          playerCount: room.players.length,
          playerLimit: PLAYER_LIMIT,
        });
      }
    }
    return list;
  }

  // Игрок осознанно покидает комнату (кнопка «Выйти»).
  // В ожидании — убираем его (и пустую комнату); в активной партии —
  // засчитываем сдачу: победа сопернику.
  function leaveRoom({ roomId, playerId }) {
    const room = rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { room };

    if (room.status === 'waiting') {
      room.players = room.players.filter((p) => p.id !== playerId);
      room.revision += 1;
      if (!room.players.some((p) => !p.isBot)) {
        rooms.delete(room.id);
        codes.delete(room.code);
      }
    } else if (room.game && !room.game.over) {
      const opponent = room.players.find((p) => p.id !== playerId);
      room.game.over = true;
      room.game.winnerId = opponent ? opponent.id : null;
      room.revision += 1;
    }
    return { room };
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
        // Брошенную комнату, которая ещё не стартовала и где не осталось
        // живых людей, удаляем — иначе она будет висеть мусором в лобби.
        if (
          room.status === 'waiting'
          && !room.players.some((p) => !p.isBot && p.connected)
        ) {
          rooms.delete(room.id);
          codes.delete(room.code);
        }
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
    joinById,
    leaveRoom,
    listPublicRooms,
    resumeSession,
    markDisconnected,
    applyCommand,
    getRoom,
    snapshot,
  };
}

// id карты → представление для клиента. Неизвестный id (легаси) показываем как есть.
// Карта-результат крафта показывается открытой, если персонаж её скрафтил.
function cardView(id, character) {
  const card = CARD_BY_ID[id];
  if (!card) return { id, name: id, type: 'unknown', locked: false, desc: '' };
  const locked = (card.locked ?? false) && !character?.crafted?.includes(id);
  return { id, name: card.name, type: card.type, locked, desc: card.desc ?? '' };
}

// Схватка со зверем → представление для клиента: имя и параметры зверя.
function beastFightView(beastFight) {
  if (!beastFight) return null;
  const beast = BEASTS[beastFight.cardId] ?? {};
  return {
    cardId: beastFight.cardId,
    name: CARD_BY_ID[beastFight.cardId]?.name ?? beastFight.cardId,
    damage: beast.damage ?? 0,
    successes: beastFight.successes ?? 0,
    needed: beast.needed ?? 0,
    killOn: beast.killOn ?? 0,
    successOn: beast.successOn ?? 0,
  };
}

// Туман войны: клетки в радиусе FOG_RADIUS от живых персонажей игрока.
// Вражеские персонажи вне этой зоны скрываются из снапшота (position: null).
function fogVisibleCells(game, forPlayerId) {
  const seen = new Set();
  for (const c of game.characters) {
    if (c.owner !== forPlayerId || c.hp <= 0 || !c.position) continue;
    seen.add(c.position);
    for (const t of reachableCells(c.position, FOG_RADIUS, new Set())) {
      seen.add(t.cellId);
    }
  }
  return seen;
}

function snapshotGame(game, forPlayerId) {
  const visible = null; // туман войны отключён (пока): forPlayerId ? fogVisibleCells(game, forPlayerId) : null
  return {
    over: game.over,
    winnerId: game.winnerId,
    positionAuthority: 'server-v1',
    map: mapSnapshot(),
    deckCount: game.deck.length,
    redDeckCount: game.redDeck?.length ?? 0,
    discardCount: game.discard.length,
    turn: {
      activePlayerId: game.turn.activePlayerId,
      rollsLeft: game.turn.rollsLeft,
      dice: game.turn.dice,
      usedDice: game.turn.usedDice,
      movementArea: game.turn.movementArea
        ? {
            characterId: game.turn.movementArea.characterId,
            mode: game.turn.movementArea.mode,
            dieIndex: game.turn.movementArea.dieIndex,
          }
        : null,
      mode: game.turn.mode,
      hasRolled: Boolean(game.turn.hasRolled),
      transferRemaining: game.turn.transferRemaining ?? 0,
      movedCharacterId: game.turn.movedCharacterId ?? null,
      drawnThisTurn: Boolean(game.turn.drawnThisTurn),
    },
    characters: game.characters.map((c) => {
      // Враг вне радиуса тумана — позицию скрываем (фишка не рисуется)
      const fogged = visible
        && c.owner !== forPlayerId
        && c.position
        && !visible.has(c.position);
      return {
        id: c.id,
        owner: c.owner,
        role: c.role,
        position: fogged ? null : c.position,
        hidden: Boolean(fogged),
        hp: c.hp,
        combatOpponentId: c.combatOpponentId ?? null,
        // схватка со зверем публична — видна обоим игрокам
        beastFight: beastFightView(c.beastFight),
        cardCount: c.inventory.length,
        // полный инвентарь — только владельцу; id резолвим в карточку для UI
        inventory: c.owner === forPlayerId ? c.inventory.map((id) => cardView(id, c)) : undefined,
      };
    }),
    legalTargets: snapshotLegalTargets(game, forPlayerId),
  };
}

function snapshotLegalTargets(game, forPlayerId) {
  const empty = { moveSum: {}, dice: [{}, {}], attacks: {} };
  if (
    !forPlayerId
    || game.over
    || game.turn.activePlayerId !== forPlayerId
    || !game.turn.dice
  ) {
    return empty;
  }

  const characters = game.characters.filter((character) =>
    character.owner === forPlayerId && character.hp > 0 && character.position);
  for (const character of characters) {
    empty.attacks[character.id] = rules.availableAttackTargets(
      game,
      forPlayerId,
      character.id,
    );
  }
  if (game.turn.mode === 'moveSum') {
    for (const character of characters) {
      empty.moveSum[character.id] = rules
        .availableMoveTargets(game, forPlayerId, character.id)
        .map((target) => target.cellId);
    }
  } else if (game.turn.mode === 'split') {
    for (const dieIndex of [0, 1]) {
      const movementDie = game.turn.movementArea?.mode === 'split'
        && game.turn.movementArea.dieIndex === dieIndex;
      if (game.turn.usedDice[dieIndex] && !movementDie) continue;
      for (const character of characters) {
        empty.dice[dieIndex][character.id] = rules
          .availableMoveTargets(game, forPlayerId, character.id, dieIndex)
          .map((target) => target.cellId);
      }
    }
  }
  return empty;
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
