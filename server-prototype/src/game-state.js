import { randomUUID } from 'node:crypto';
import { PLAYER_LIMIT, CARD_BY_ID, BEASTS, FOG_RADIUS, GOLD_FEATHER_CARDS } from './constants.js';
import * as rules from './rules.js';
import { mapSnapshot, reachableCells } from './map.js';

// Хранилище комнат, игроков и сессий. Игровую логику не знает —
// делегирует движку правил (rules.js) и отдает персональные снимки.

export function createStore({ roomPersistence = null } = {}) {
  const rooms = new Map(); // roomId -> room
  const codes = new Map(); // code -> roomId
  loadPersistedRooms();

  function createRoom({ playerName, userId = null, connectionId, vsBot = false, isPublic = false }) {
    const now = Date.now();
    const room = {
      id: randomUUID(),
      code: makeUniqueCode(codes),
      revision: 0,
      status: 'waiting',
      players: [],
      game: null,
      vsBot: false,
      public: vsBot ? false : isPublic === true,
      createdAt: now,
      updatedAt: now,
    };

    const player = makePlayer({ playerName, userId, connectionId, seatIndex: 0 });
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
    persistRoom(room);
    return { room, player };
  }

  function joinRoom({ code, playerName, userId = null, connectionId }) {
    const roomId = codes.get(normalizeCode(code));
    const room = roomId ? rooms.get(roomId) : null;
    return addPlayer({ room, playerName, userId, connectionId });
  }

  function joinById({ roomId, playerName, userId = null, connectionId }) {
    const room = roomId ? rooms.get(roomId) : null;
    return addPlayer({ room, playerName, userId, connectionId });
  }

  function watchRoom({ roomId, code }) {
    const resolvedRoomId = roomId || codes.get(normalizeCode(code));
    const room = resolvedRoomId ? rooms.get(resolvedRoomId) : null;
    if (!room) {
      throw new Error('Комната не найдена.');
    }
    if (room.vsBot || !room.public) {
      throw new Error('Комната недоступна для просмотра.');
    }
    if (room.game?.over) {
      throw new Error('Партия уже завершена. Просмотр закрыт.');
    }
    return { room };
  }

  function addPlayer({ room, playerName, userId = null, connectionId }) {
    if (!room) {
      throw new Error('Комната не найдена.');
    }
    if (room.status !== 'waiting' || room.players.length >= PLAYER_LIMIT) {
      throw new Error('Комната уже заполнена.');
    }

    const player = makePlayer({
      playerName,
      userId,
      connectionId,
      seatIndex: room.players.length,
    });
    room.players.push(player);
    room.revision += 1;

    let startedPvp = false;
    if (room.players.length === PLAYER_LIMIT) {
      room.status = 'active';
      room.game = rules.createGame(room.players);
      startedPvp = shouldRecordPvpRoom(room);
    }

    persistRoom(room);
    if (startedPvp) {
      recordPvpRoomEvent(room, {
        kind: 'game:start',
        seq: room.revision,
        gameAfter: cloneForRecord(room.game),
      });
    }
    return { room, player };
  }

  // Открытые игры для лобби: публичные, ждут второго, не против ИИ,
  // и хост ещё на связи.
  function listPublicRooms() {
    const list = [];
    for (const room of rooms.values()) {
      const canJoin = room.status === 'waiting' && room.players.length < PLAYER_LIMIT;
      const canWatch = room.status === 'active' && Boolean(room.game) && !room.game.over;
      if (
        room.public
        && !room.vsBot
        && (canJoin || canWatch)
        && room.players.some((p) => !p.isBot && p.connected)
      ) {
        const host = room.players.find((p) => !p.isBot);
        list.push({
          roomId: room.id,
          hostName: host?.name ?? 'Игрок',
          playerCount: room.players.length,
          playerLimit: PLAYER_LIMIT,
          status: room.status,
          canJoin,
          canWatch,
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
        deletePersistedRoom(room);
      } else {
        persistRoom(room);
      }
    } else if (room.game && !room.game.over) {
      const shouldRecord = shouldRecordPvpRoom(room);
      const gameBefore = shouldRecord ? cloneForRecord(room.game) : null;
      const opponent = room.players.find((p) => p.id !== playerId);
      room.game.over = true;
      room.game.winnerId = opponent ? opponent.id : null;
      room.revision += 1;
      persistRoom(room);
      if (shouldRecord) {
        recordPvpRoomEvent(room, {
          kind: 'game:forfeit',
          seq: room.revision,
          actor: player,
          actionType: 'room:leave',
          result: { winnerId: room.game.winnerId },
          gameBefore,
          gameAfter: cloneForRecord(room.game),
        });
      }
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
    room.revision += 1;
    persistRoom(room);
    return { room, player };
  }

  function markDisconnected(connectionId) {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.connectionId === connectionId);
      if (player) {
        player.connected = false;
        // Обычный дисконнект не удаляет комнату: ее можно открыть после рестарта.
        room.revision += 1;
        persistRoom(room);
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

    const shouldRecord = shouldRecordPvpRoom(room);
    const gameBefore = shouldRecord ? cloneForRecord(room.game) : null;
    const actor = room.players.find((p) => p.id === playerId);
    const seq = Number(room.revision ?? 0) + 1;
    const result = rules.apply(room.game, playerId, type, payload);
    room.revision = seq;
    persistRoom(room);
    if (shouldRecord) {
      recordPvpRoomEvent(room, {
        kind: 'command',
        seq,
        actor,
        actionType: type,
        payload: cloneForRecord(payload),
        result: cloneForRecord(result),
        gameBefore,
        gameAfter: cloneForRecord(room.game),
      });
    }
    return { room, result };
  }

  function getRoom(roomId) {
    return rooms.get(roomId) ?? null;
  }

  // Персональный снимок: чужие руки скрыты, видны только счетчики карт.
  function snapshot(room, forPlayerId, options = {}) {
    return {
      id: room.id,
      code: room.code,
      revision: room.revision,
      status: room.status,
      spectator: options.spectator === true,
      you: forPlayerId ?? null,
      players: room.players.map((p) => ({
        id: p.id,
        userId: p.userId ?? null,
        name: p.name,
        side: p.side,
        seatIndex: p.seatIndex,
        connected: p.connected,
        isBot: p.isBot ?? false,
      })),
      game: room.game ? snapshotGame(room.game, forPlayerId, options) : null,
    };
  }

  // Диагностический срез ВСЕХ комнат для админки (без скрытия — это серверная
  // сторона, отдаётся только под Basic Auth). Лёгкий, без карт инвентаря.
  function adminRooms() {
    const out = [];
    for (const room of rooms.values()) {
      out.push({
        code: room.code,
        status: room.status,
        type: room.vsBot ? 'vsBot' : (room.public ? 'public' : 'private'),
        players: room.players.map((p) => ({
          name: p.name,
          side: p.side ?? null,
          isBot: p.isBot ?? false,
          connected: p.connected ?? false,
        })),
        game: room.game ? {
          over: room.game.over ?? false,
          winnerId: room.game.winnerId ?? null,
          activePlayerId: room.game.turn?.activePlayerId ?? null,
          characters: (room.game.characters ?? []).map((c) => ({
            role: c.role,
            owner: c.owner,
            hp: c.hp,
            pos: c.position ?? null,
            dead: c.hp <= 0 || !c.position,
            beast: c.beastFight ? (c.beastFight.cardId ?? true) : null,
            combat: Boolean(c.combatOpponentId),
          })),
        } : null,
      });
    }
    return out;
  }

  function loadPersistedRooms() {
    const persistedRooms = roomPersistence?.loadRooms?.() ?? [];
    for (const persistedRoom of persistedRooms) {
      const room = normalizePersistedRoom(persistedRoom);
      if (!room || rooms.has(room.id) || codes.has(room.code)) continue;
      rooms.set(room.id, room);
      codes.set(room.code, room.id);
    }
  }

  function persistRoom(room) {
    if (!roomPersistence?.saveRoom || !room?.id) return;
    roomPersistence.saveRoom(room);
  }

  function deletePersistedRoom(room) {
    roomPersistence?.deleteRoom?.(room);
  }

  function recordPvpRoomEvent(room, {
    kind,
    seq,
    actor = null,
    actionType = null,
    payload = null,
    result = null,
    gameBefore = null,
    gameAfter = null,
  }) {
    if (!roomPersistence?.saveRoomEvent || !shouldRecordPvpRoom(room)) return;
    roomPersistence.saveRoomEvent({
      roomId: room.id,
      roomCode: room.code,
      seq,
      kind,
      status: room.status,
      actorPlayerId: actor?.id ?? null,
      actorUserId: actor?.userId ?? null,
      actorSide: actor?.side ?? null,
      actionType,
      players: room.players.map((player) => ({
        id: player.id,
        userId: player.userId ?? null,
        seatIndex: player.seatIndex,
        side: player.side,
        name: player.name,
      })),
      payload,
      result,
      gameBefore,
      gameAfter,
    });
  }

  return {
    createRoom,
    joinRoom,
    joinById,
    watchRoom,
    leaveRoom,
    listPublicRooms,
    resumeSession,
    markDisconnected,
    applyCommand,
    getRoom,
    snapshot,
    adminRooms,
  };
}

function shouldRecordPvpRoom(room) {
  return Boolean(
    room
    && room.status === 'active'
    && room.game
    && room.vsBot !== true
    && Array.isArray(room.players)
    && room.players.length >= PLAYER_LIMIT
    && room.players.every((player) => player?.isBot !== true)
  );
}

function cloneForRecord(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizePersistedRoom(room) {
  if (!room || typeof room !== 'object' || !room.id || !room.code) return null;
  const code = normalizeCode(room.code);
  if (!code) return null;
  const players = Array.isArray(room.players) ? room.players : [];
  if (players.length === 0) return null;

  const normalizedPlayers = players.map((player, index) => {
    const isBot = player?.isBot === true;
    return {
      ...player,
      id: player?.id || randomUUID(),
      userId: player?.userId ?? null,
      sessionToken: player?.sessionToken || randomUUID(),
      connectionId: null,
      connected: isBot,
      isBot,
      seatIndex: Number.isInteger(player?.seatIndex) ? player.seatIndex : index,
      side: player?.side ?? (index === 0 ? 'green' : 'red'),
      name: normalizePlayerName(player?.name),
    };
  });

  const status = room.status === 'active' && room.game ? 'active' : 'waiting';
  return {
    ...room,
    code,
    revision: Number(room.revision ?? 0),
    status,
    players: normalizedPlayers,
    vsBot: room.vsBot === true,
    public: room.public === true,
    game: status === 'active' ? room.game : null,
    createdAt: Number(room.createdAt ?? Date.now()),
    updatedAt: Number(room.updatedAt ?? room.createdAt ?? Date.now()),
  };
}

// id карты → представление для клиента. Неизвестный id (легаси) показываем как есть.
// Карта-результат крафта показывается открытой, если персонаж её скрафтил.
function sourceView(source) {
  if (!source || typeof source !== 'object') return { sourceDeck: null, sourceBack: null };
  const sourceDeck = source.sourceDeck ?? source.deck ?? null;
  const sourceBack = source.sourceBack ?? source.backDeck ?? sourceDeck;
  return { sourceDeck, sourceBack };
}

function cardView(id, character, source = null) {
  const sourceInfo = sourceView(source);
  const card = CARD_BY_ID[id];
  if (!card) return {
    id,
    name: id,
    type: 'unknown',
    locked: false,
    desc: '',
    exhausted: character?.exhaustedCards?.includes(id) ?? false,
    visibleToOpponent: false,
    ...sourceInfo,
  };
  const locked = (card.locked ?? false) && !character?.crafted?.includes(id);
  return {
    id,
    name: card.name,
    type: card.type,
    locked,
    desc: card.desc ?? '',
    exhausted: character?.exhaustedCards?.includes(id) ?? false,
    visibleToOpponent: card.public === true && !locked,
    ...sourceInfo,
  };
}

// Схватка со зверем → представление для клиента: имя и параметры зверя.
function beastFightView(beastFight) {
  if (!beastFight) return null;
  const beast = BEASTS[beastFight.cardId] ?? {};
  return {
    cardId: beastFight.cardId,
    cellId: beastFight.cellId ?? null,
    name: CARD_BY_ID[beastFight.cardId]?.name ?? beastFight.cardId,
    damage: beast.damage ?? 0,
    successes: beastFight.successes ?? 0,
    needed: beast.needed ?? 0,
    hp: Math.max(0, (beast.needed ?? 0) - (beastFight.successes ?? 0)),
    maxHp: beast.needed ?? 0,
    killOn: beast.killOn ?? 0,
    successOn: beast.successOn ?? 0,
  };
}

function frogSpellView(frogSpell) {
  if (!frogSpell) return null;
  const sourceInfo = sourceView(frogSpell.source);
  return {
    cardId: frogSpell.cardId,
    name: frogSpell.name ?? CARD_BY_ID[frogSpell.cardId]?.name ?? frogSpell.cardId,
    casterId: frogSpell.casterId ?? null,
    ownerId: frogSpell.ownerId ?? null,
    dischargeTotal: frogSpell.dischargeTotal ?? 8,
    ...sourceInfo,
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

export function snapshotGame(game, forPlayerId, { fogEnabled = true, revealAllInventories = false } = {}) {
  // Туман войны: видно клетки в радиусе FOG_RADIUS от своих живых персонажей;
  // вражеские фишки вне зоны скрываются (position: null). Движение туманом не
  // ограничено — ходить можно на длину кубиков и в неизведанное.
  const visible = forPlayerId && fogEnabled ? fogVisibleCells(game, forPlayerId) : null;
  const revealTurnDice = !forPlayerId || game.turn.activePlayerId === forPlayerId;
  return {
    over: game.over,
    winnerId: game.winnerId,
    positionAuthority: 'server-v1',
    map: mapSnapshot(),
    deckCount: game.deck.length,
    deckCounts: {
      mixed: game.deck.length,
      ...Object.fromEntries(Object.entries(game.decks ?? {}).map(([deck, cards]) => [deck, cards.length])),
      fairy_glade: game.fairyDeck?.length ?? 0,
      red: game.redDeck?.length ?? 0,
    },
    redDeckCount: game.redDeck?.length ?? 0,
    discardCount: game.discard.length,
    terrainCards: (game.terrainCards ?? []).map((entry) => {
      const character = game.characters.find((item) => item.id === entry.characterId);
      const hiddenFromViewer = entry.faceDown && entry.ownerId !== forPlayerId;
      return {
        id: entry.id,
        ownerId: entry.ownerId,
        characterId: entry.characterId,
        cardIndex: entry.cardIndex,
        faceDown: Boolean(entry.faceDown),
        upsideDown: Boolean(entry.upsideDown),
        ...sourceView(entry.source),
        x: entry.x,
        y: entry.y,
        card: hiddenFromViewer
          ? { id: null, name: 'Закрытая карта', type: 'hidden', desc: '', hidden: true }
          : cardView(entry.cardId, character, entry.source),
      };
      }),
    dwarves: dwarfStateView(game.dwarves, visible),
    turn: {
      activePlayerId: game.turn.activePlayerId,
      rollsLeft: game.turn.rollsLeft,
      dice: revealTurnDice ? game.turn.dice : null,
      usedDice: revealTurnDice ? game.turn.usedDice : [false, false],
      diceByCharacter: revealTurnDice ? game.turn.diceByCharacter ?? {} : {},
      usedDiceByCharacter: revealTurnDice ? game.turn.usedDiceByCharacter ?? {} : {},
      movementArea: sanitizeMovementArea(game.turn.movementArea),
      movementAreaByCharacter: Object.fromEntries(
        Object.entries(game.turn.movementAreaByCharacter ?? {})
          .map(([id, area]) => [id, sanitizeMovementArea(area)])
          .filter(([, area]) => area !== null),
      ),
      mode: game.turn.mode,
      modeByCharacter: game.turn.modeByCharacter ?? {},
      hasRolled: Boolean(game.turn.hasRolled),
      transferRemaining: game.turn.transferRemaining ?? 0,
      movedCharacterId: game.turn.movedCharacterId ?? null,
      drawnThisTurn: Boolean(game.turn.drawnThisTurn),
      drawnCharacterIdsThisTurn: game.turn.drawnCharacterIdsThisTurn ?? [],
    },
    characters: game.characters.map((c) => {
      const beacon = c.inventory?.some((id) => GOLD_FEATHER_CARDS.includes(id)) ?? false;
      const inventorySources = Array.isArray(c.inventorySources) ? c.inventorySources : [];
      // Враг вне радиуса тумана — позицию скрываем (фишка не рисуется)
      const fogged = visible
        && c.owner !== forPlayerId
        && c.position
        && !visible.has(c.position)
        && !beacon;
      return {
        id: c.id,
        owner: c.owner,
        role: c.role,
        position: fogged ? null : c.position,
        hidden: Boolean(fogged),
        beacon,
        hp: c.hp,
        combatOpponentId: c.combatOpponentId ?? null,
        // схватка со зверем публична — видна обоим игрокам
        beastFight: beastFightView(c.beastFight),
        frogSpell: frogSpellView(c.frogSpell),
        oakAcornsReadyRoll: Number(c.oakAcornsReadyRoll ?? 0),
        cardCount: c.inventory.length,
        // Полный инвентарь — только владельцу. Отдельные открытые карты
        // видны сопернику без раскрытия остальной руки.
        inventory: c.owner === forPlayerId || revealAllInventories
          ? c.inventory.map((id, index) => cardView(id, c, inventorySources[index]))
          : undefined,
        publicCards: c.owner !== forPlayerId
          ? c.inventory
              .map((id, index) => cardView(id, c, inventorySources[index]))
              .filter((card) => card.visibleToOpponent)
          : [],
      };
    }),
    legalTargets: snapshotLegalTargets(game, forPlayerId),
  };
}

function dwarfStateView(state, visible = null) {
  if (!state) return null;
  return {
    enabled: Boolean(state.enabled),
    active: Boolean(state.active),
    entryTurn: state.entryTurn ?? null,
    mainTurnsCompleted: state.mainTurnsCompleted ?? 0,
    routeIndex: visible ? null : state.routeIndex ?? -1,
    routeLength: state.route?.length ?? 0,
    units: (state.units ?? []).map((unit) => {
      const fogged = visible && unit.position && !visible.has(unit.position);
      return {
        id: unit.id,
        kind: unit.kind,
        name: unit.name,
        hp: unit.hp,
        position: fogged ? null : unit.position ?? null,
        routeIndex: fogged ? null : unit.routeIndex ?? -1,
        hidden: Boolean(fogged),
        alive: unit.alive !== false,
        cardCount: unit.inventory?.length ?? 0,
        frogSpell: fogged ? null : frogSpellView(unit.frogSpell),
      };
    }),
  };
}

function sanitizeMovementArea(area) {
  return area
    ? {
        characterId: area.characterId,
        mode: area.mode,
        dieIndex: area.dieIndex,
        locked: Boolean(area.locked),
      }
    : null;
}

function snapshotLegalTargets(game, forPlayerId) {
  const previousDice = game.turn.dice;
  const previousUsedDice = game.turn.usedDice;
  const previousMovementArea = game.turn.movementArea;
  const previousActiveDiceCharacterId = game.turn.activeDiceCharacterId;
  const empty = { moveSum: {}, dice: [{}, {}], attacks: {} };
  if (
    !forPlayerId
    || game.over
    || game.turn.activePlayerId !== forPlayerId
    || !hasAnyTurnDice(game)
  ) {
    return empty;
  }

  // Режим теперь на каждого персонажа: считаем цели по СВОЕМУ режиму каждого,
  // а не по одному глобальному. По умолчанию (нет явного split) — ход суммой.
  const characters = game.characters.filter((character) =>
    character.owner === forPlayerId && character.hp > 0 && character.position);
  for (const character of characters) {
    bindSnapshotDice(game, character.id);
    empty.attacks[character.id] = rules.availableAttackTargets(
      game,
      forPlayerId,
      character.id,
    );

    const area = game.turn.movementArea; // bindSnapshotDice уже привязал область персонажа
    // Тот же modeFor, что и в rules.js: персональный override → глобальный
    // дефолт → 'moveSum'. Совпадает с тем, что увидит availableMoveTargets.
    const charMode = area
      ? area.mode
      : (game.turn.modeByCharacter?.[character.id]
        ?? game.turn.mode
        ?? 'moveSum');

    if (charMode === 'split') {
      for (const dieIndex of [0, 1]) {
        const movementDie = area?.mode === 'split' && area.dieIndex === dieIndex;
        if (game.turn.usedDice[dieIndex] && !movementDie) continue;
        empty.dice[dieIndex][character.id] = rules
          .availableMoveTargets(game, forPlayerId, character.id, dieIndex)
          .map((target) => target.cellId);
      }
    } else {
      // Ход суммой по умолчанию: цели по сумме обоих кубиков. Плюс одиночная
      // дальность каждого кубика — чтобы клиент понимал, дотягивается ли ресурс
      // ОДНИМ кубиком (подсветка «Взять»), не путая с дальностью по сумме.
      empty.moveSum[character.id] = rules
        .availableMoveTargets(game, forPlayerId, character.id)
        .map((target) => target.cellId);
      for (const dieIndex of [0, 1]) {
        if (game.turn.usedDice[dieIndex]) continue;
        empty.dice[dieIndex][character.id] = rules
          .singleDieTargets(game, forPlayerId, character.id, dieIndex);
      }
    }
  }
  game.turn.dice = previousDice;
  game.turn.usedDice = previousUsedDice;
  game.turn.movementArea = previousMovementArea;
  game.turn.activeDiceCharacterId = previousActiveDiceCharacterId;
  return empty;
}

function hasAnyTurnDice(game) {
  return Boolean(
    game.turn.dice
    || Object.keys(game.turn.diceByCharacter ?? {}).length > 0,
  );
}

function bindSnapshotDice(game, characterId) {
  syncExternalSnapshotDice(game);
  const dice = game.turn.diceByCharacter?.[characterId];
  if (!dice) return;
  game.turn.dice = dice;
  game.turn.usedDice = game.turn.usedDiceByCharacter?.[characterId] ?? [false, false];
  game.turn.movementArea = game.turn.movementAreaByCharacter?.[characterId] ?? null;
  game.turn.activeDiceCharacterId = characterId;
}

function syncExternalSnapshotDice(game) {
  const activeId = game?.turn?.activeDiceCharacterId;
  if (!activeId) return;
  const diceMap = game.turn.diceByCharacter ?? {};
  if (game.turn.dice && diceMap[activeId] && game.turn.dice !== diceMap[activeId]) {
    for (const characterId of Object.keys(diceMap)) {
      diceMap[characterId] = [...game.turn.dice];
    }
  }
  const usedMap = game.turn.usedDiceByCharacter ?? {};
  if (game.turn.usedDice && usedMap[activeId] && game.turn.usedDice !== usedMap[activeId]) {
    usedMap[activeId] = [...game.turn.usedDice];
  }
}

function makePlayer({ playerName, userId = null, connectionId, seatIndex }) {
  return {
    id: randomUUID(),
    userId,
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
