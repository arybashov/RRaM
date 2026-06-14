// Авторитетный движок правил RRaM. Чистая логика без сетевого кода:
// сервер вызывает apply() на каждое намерение игрока, движок валидирует
// и меняет игровое состояние in-place. Любое нарушение правил — throw.
//
// Карта пока не подключена (придет от заказчика), поэтому действия,
// зависящие от позиций на поле (движение, телепорт), — заглушки.
// Логика карт, ходов и кубиков от карты не зависит и работает уже сейчас.

import {
  ROLES,
  ROLLS_PER_GAME,
  INVENTORY_LIMIT,
  CHARACTER_HP,
  TELEPORT_CARD,
  CARD_CATALOG,
  CARD_BY_ID,
  BASE_CARDS,
  ROLE_NAMES,
  BEASTS,
  BEAST_HIDE_DROP,
  RAW_HIDE_TO_CLEAN,
  HIDE_CLEAN_MIN,
  CRAFT_RECIPES,
  CLUB_DAMAGE,
} from './constants.js';
import {
  MAP_ID,
  cellTerrain,
  isBoardCell,
  neighbors,
  reachableCells,
  startCell,
  pointClassCells,
} from './map.js';

export function createGame(players) {
  const characters = [];
  for (const [playerIndex, player] of players.entries()) {
    const side = player.side ?? (playerIndex === 0 ? 'green' : 'red');
    for (const role of ROLES) {
      characters.push({
        id: `${player.id}:${role}`,
        owner: player.id,
        side,
        role,
        position: startCell(side, role),
        hp: CHARACTER_HP,
        inventory: [...(BASE_CARDS[role] ?? [])],
        exhaustedCards: [],
        combatOpponentId: null,
        beastFight: null, // { cardId, successes } — схватка со зверем с красной клетки
        crafted: [], // id карт, открытых крафтом (напр. 'club' по чертежу)
      });
    }
  }

  const rollsLeft = {};
  for (const player of players) {
    rollsLeft[player.id] = ROLLS_PER_GAME;
  }

  return {
    over: false,
    winnerId: null,
    mapId: MAP_ID,
    characters,
    deck: buildDeck(),
    redDeck: buildRedDeck(),
    discard: [],
    terrainCards: [],
    turn: {
      activePlayerId: players[0].id,
      rollsLeft,
      dice: null,
      usedDice: [false, false],
      movementArea: null, // { characterId, origin, mode, dieIndex, maxSteps }
      mode: null, // 'moveSum' | 'split'
      hasRolled: false,
      transferRemaining: 0, // «бюджет» передачи карт из ящика (= значению потраченного кубика)
      movedCharacterId: null, // кто уже двигался в этом броске (нельзя двигать двух разных)
      drawnThisTurn: false,   // карту в этом броске уже брали (добор — раз за бросок)
    },
  };
}

export function apply(game, playerId, type, payload = {}) {
  switch (type) {
    case 'turn:roll':
      return roll(game, playerId);
    case 'turn:setMode':
      return setMode(game, playerId, payload);
    case 'turn:resetMove':
      return resetMove(game, playerId, payload);
    case 'turn:end':
      return endTurn(game, playerId);
    case 'action:draw':
      return draw(game, playerId, payload);
    case 'action:transfer':
      return transfer(game, playerId, payload);
    case 'action:move':
      return move(game, playerId, payload);
    case 'action:teleport':
      return teleport(game, playerId, payload);
    case 'action:engage':
      return engage(game, playerId, payload);
    case 'action:attack':
      return attack(game, playerId, payload);
    case 'action:fightBeast':
      return fightBeast(game, playerId, payload);
    case 'action:processHide':
      return processHide(game, playerId, payload);
    case 'action:craft':
      return craft(game, playerId, payload);
    case 'action:terrainPlace':
      return terrainPlace(game, playerId, payload);
    case 'action:terrainRemove':
      return terrainRemove(game, playerId, payload);
    case 'action:terrainFlip':
      return terrainFlip(game, playerId, payload);
    default:
      throw new Error(`Команда недоступна в игре: ${type}`);
  }
}

function roll(game, playerId) {
  assertActive(game, playerId);
  if (game.turn.dice) {
    throw new Error('Кубики уже брошены — потратьте их или завершите ход.');
  }
  if (game.turn.hasRolled) {
    throw new Error('В этом ходу кубики уже бросали — завершите ход.');
  }
  if (game.turn.rollsLeft[playerId] <= 0) {
    throw new Error('Броски закончились — завершите ход.');
  }

  applyTurnStartEffects(game, playerId);

  const dice = [rollDie(), rollDie()];
  game.turn.dice = dice;
  game.turn.usedDice = [false, false];
  game.turn.movementArea = null;
  game.turn.mode = null;
  game.turn.hasRolled = true;
  game.turn.movedCharacterId = null;
  game.turn.drawnThisTurn = false;
  game.turn.rollsLeft[playerId] -= 1;

  return {
    roll: { dice, total: dice[0] + dice[1], rollsLeft: game.turn.rollsLeft[playerId] },
  };
}

function setMode(game, playerId, { mode } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  if (
    game.turn.usedDice[0]
    || game.turn.usedDice[1]
    || game.turn.movementArea
  ) {
    throw new Error('Режим нельзя менять после траты кубика.');
  }
  if (mode !== 'moveSum' && mode !== 'split') {
    throw new Error('Режим должен быть moveSum или split.');
  }
  game.turn.mode = mode;
  return { mode };
}

// Откат текущей «ноги» движения: вернуть фишку к началу ноги и освободить её
// кубик. Доступно, пока ход не зафиксирован жёстко (красная клетка / выход из
// боя / трата кубика на другое действие). Откат второй ноги снова делает
// активной первую — так клик по кубику работает как пошаговая отмена.
function resetMove(game, playerId, { characterId } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  const area = game.turn.movementArea;
  if (!area) {
    throw new Error('Нет хода для отмены.');
  }
  if (area.locked) {
    throw new Error('Этот ход уже нельзя отменить.');
  }
  const character = ownCharacter(game, playerId, characterId);
  if (area.characterId !== character.id) {
    throw new Error('Это не ваш ход движения.');
  }

  character.position = area.origin;
  if (area.mode === 'moveSum') {
    game.turn.usedDice = [false, false];
    game.turn.movementArea = null;
    game.turn.movedCharacterId = null;
  } else {
    game.turn.usedDice[area.dieIndex] = false;
    if (area.prev) {
      // Была вторая нога — снова активируем первую (фишка уже на её конце).
      game.turn.movementArea = {
        characterId,
        origin: area.prev.origin,
        mode: 'split',
        dieIndex: area.prev.dieIndex,
        maxSteps: area.prev.maxSteps,
        locked: false,
        prev: null,
      };
    } else {
      game.turn.movementArea = null;
      game.turn.movedCharacterId = null;
    }
  }
  return { reset: { characterId, position: character.position } };
}

// Зафиксировать незавершённое движение: после этого откат/смену кубика нельзя.
// Зовётся, когда второй кубик тратится на другое действие (карта/передача/бой).
function lockMovement(game) {
  if (game.turn.movementArea) {
    game.turn.movementArea.locked = true;
  }
}

function draw(game, playerId, { characterId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  dieValue(game, dieIndex); // только валидируем доступность; значение на добор не влияет

  const character = ownCharacter(game, playerId, characterId);
  if (game.turn.drawnThisTurn) {
    throw new Error('Взять карту можно один раз за бросок — второй кубик потратьте на другое действие.');
  }
  if (combatOpponent(game, character)) {
    throw new Error('В бою персонаж не может брать карты: атакуйте, передайте карты или убегайте.');
  }
  if (character.beastFight) {
    throw new Error('В схватке со зверем персонаж не может брать карты: добейте зверя или убегайте.');
  }
  const resourceDoubleDraw = cellTerrain(character.position) === 'resource'
    && (
      (character.role === 'K'
        && character.crafted?.includes('hammer')
        && character.inventory.includes('hammer'))
      || (character.role === 'P'
        && character.crafted?.includes('sack')
        && character.inventory.includes('sack'))
    );
  const drawCount = resourceDoubleDraw ? 2 : 1;
  if (game.deck.length < drawCount) {
    throw new Error('Колода пуста.');
  }
  if (character.inventory.length + drawCount > INVENTORY_LIMIT) {
    throw new Error(drawCount === 1
      ? 'Инвентарь персонажа полон.'
      : 'Для Молотка нужны два свободных места в инвентаре.');
  }

  const cardIds = game.deck.splice(0, drawCount);
  character.inventory.push(...cardIds);
  game.turn.drawnThisTurn = true;
  lockMovement(game); // движение в этот бросок зафиксировано — откат недоступен
  spendDie(game, dieIndex);

  const cards = cardIds.map((cardId) => {
    const card = CARD_BY_ID[cardId];
    return { card: cardId, name: card?.name, type: card?.type, desc: card?.desc };
  });
  return {
    drawn: {
      characterId,
      ...cards[0],
      cards,
      count: cards.length,
      bonusTool: drawCount === 2
        ? (character.role === 'K' ? 'hammer' : 'sack')
        : null,
      hammerUsed: drawCount === 2 && character.role === 'K',
    },
  };
}

function transfer(game, playerId, { fromId, toId, dieIndex, cardIndex } = {}) {
  assertActive(game, playerId);
  if (fromId === toId) {
    throw new Error('Нужны два разных персонажа.');
  }

  // Передача из «ящика»: по одной конкретной карте. Один кубик даёт «бюджет»
  // перемещений, равный своему значению — за ход можно перетащить до N карт.
  if (cardIndex != null) {
    if (game.turn.transferRemaining > 0) {
      // Продолжаем уже открытую передачу — кубик потрачен на первом переносе
      const cardId = moveOneCard(game, playerId, fromId, toId, cardIndex);
      game.turn.transferRemaining -= 1;
      return { transferred: { fromId, toId, count: 1, cardId, name: CARD_BY_ID[cardId]?.name, remaining: game.turn.transferRemaining } };
    }
    assertRolled(game);
    requireSplit(game);
    const value = dieValue(game, dieIndex); // валидирует доступность кубика
    const cardId = moveOneCard(game, playerId, fromId, toId, cardIndex);
    lockMovement(game);                     // фиксируем незавершённое движение
    spendDie(game, dieIndex);               // кубик тратится сразу, остаток значения — в бюджет
    game.turn.transferRemaining = value - 1;
    return { transferred: { fromId, toId, count: 1, cardId, name: CARD_BY_ID[cardId]?.name, remaining: game.turn.transferRemaining } };
  }

  // Легаси: первые N карт за один кубик (N = значение кубика)
  assertRolled(game);
  requireSplit(game);
  const limit = dieValue(game, dieIndex);
  const from = ownCharacter(game, playerId, fromId);
  const to = ownCharacter(game, playerId, toId);

  if (from.inventory.length === 0) {
    throw new Error('У персонажа нет карт для передачи.');
  }
  const capacity = INVENTORY_LIMIT - to.inventory.length;
  if (capacity <= 0) {
    throw new Error('У получателя нет места в инвентаре.');
  }

  const count = Math.min(limit, from.inventory.length, capacity);
  const cards = from.inventory.splice(0, count);
  to.inventory.push(...cards);
  moveExhaustedCards(from, to, cards);
  lockMovement(game);
  spendDie(game, dieIndex);

  return { transferred: { fromId, toId, count } };
}

// Переносит одну карту по индексу между персонажами игрока (для передачи из ящика).
// Расстояние не ограничено — передавать можно любому своему персонажу.
function moveOneCard(game, playerId, fromId, toId, cardIndex) {
  const from = ownCharacter(game, playerId, fromId);
  const to = ownCharacter(game, playerId, toId);
  if (INVENTORY_LIMIT - to.inventory.length <= 0) {
    throw new Error('У получателя нет места в инвентаре.');
  }
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= from.inventory.length) {
    throw new Error('Карта для передачи не найдена.');
  }
  const [card] = from.inventory.splice(cardIndex, 1);
  to.inventory.push(card);
  moveExhaustedCards(from, to, [card]);
  return card;
}

function moveExhaustedCards(from, to, cardIds) {
  for (const cardId of cardIds) {
    const exhaustedIndex = from.exhaustedCards?.indexOf(cardId) ?? -1;
    if (exhaustedIndex !== -1) {
      from.exhaustedCards.splice(exhaustedIndex, 1);
      to.exhaustedCards ??= [];
      to.exhaustedCards.push(cardId);
    }
    const craftedIndex = from.crafted?.indexOf(cardId) ?? -1;
    if (craftedIndex !== -1) {
      from.crafted.splice(craftedIndex, 1);
      to.crafted ??= [];
      to.crafted.push(cardId);
    }
  }
}

export function availableMoveTargets(game, playerId, characterId, dieIndex) {
  const character = ownCharacter(game, playerId, characterId);
  if (!game.turn.dice) return [];
  const opponent = combatOpponent(game, character);
  const movementArea = game.turn.movementArea;

  let maxSteps;
  let origin = character.position;
  if (movementArea) {
    if (movementArea.characterId !== character.id || character.beastFight) return [];
    if (movementArea.mode === 'split' && dieIndex !== movementArea.dieIndex) {
      // Вторая «нога»: ходим другим свободным кубиком от ТЕКУЩЕЙ клетки.
      // Недоступно после жёсткого коммита (красная клетка / выход из боя / другое действие).
      if (movementArea.locked || game.turn.usedDice[dieIndex]) return [];
      maxSteps = dieValue(game, dieIndex);
      origin = character.position;
    } else {
      maxSteps = movementArea.maxSteps;
      origin = movementArea.origin;
    }
  } else if (game.turn.mode === 'moveSum') {
    if (game.turn.usedDice[0] || game.turn.usedDice[1]) return [];
    maxSteps = game.turn.dice[0] + game.turn.dice[1];
  } else if (game.turn.mode === 'split') {
    if (opponent) return [];
    // Правило: нельзя разными кубиками одного броска двигать двух разных персонажей
    if (game.turn.movedCharacterId && game.turn.movedCharacterId !== character.id) return [];
    maxSteps = dieValue(game, dieIndex);
  } else {
    return [];
  }

  const blocked = new Set(
    game.characters
      .filter((item) => item.id !== character.id && item.position)
      .map((item) => item.position),
  );
  const targets = reachableCells(origin, maxSteps, blocked)
    .filter((target) => target.cellId !== character.position);
  if (!opponent) return targets;

  const opponentAdjacent = new Set(neighbors(opponent.position));
  return targets.filter((target) => !opponentAdjacent.has(target.cellId));
}

function move(game, playerId, {
  characterId,
  toCell,
  dieIndex,
  engageTargetId = null,
} = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  const character = ownCharacter(game, playerId, characterId);
  assertBoardTarget(toCell);

  if (
    game.turn.mode === 'split'
    && game.turn.movedCharacterId
    && game.turn.movedCharacterId !== characterId
  ) {
    throw new Error('В одном броске двигать можно только одного персонажа.');
  }
  const target = availableMoveTargets(game, playerId, characterId, dieIndex)
    .find((item) => item.cellId === toCell);
  if (!target) {
    throw new Error('Нужно выбрать другую клетку.');
  }

  const fromCell = character.position;
  const escapedCombat = Boolean(combatOpponent(game, character));
  const escapedBeast = Boolean(character.beastFight);
  let engagedTarget = null;
  if (engageTargetId) {
    engagedTarget = game.characters.find((item) => item.id === engageTargetId);
    const targetOpponent = combatOpponent(game, engagedTarget);
    if (
      escapedCombat
      || escapedBeast
      || !engagedTarget
      || engagedTarget.owner === playerId
      || engagedTarget.hp <= 0
      || !engagedTarget.position
      || engagedTarget.beastFight
      || targetOpponent
      || !neighbors(toCell).includes(engagedTarget.position)
    ) {
      throw new Error('Не удалось вступить в бой с выбранным противником.');
    }
  }
  const area = game.turn.movementArea;
  if (area && area.mode === 'split' && dieIndex !== area.dieIndex && !game.turn.usedDice[dieIndex]) {
    // Вторая «нога»: фиксируем первую (её кубик уже потрачен), начинаем новую
    // от текущей клетки другим кубиком. prev хранит первую ногу для отката.
    game.turn.movementArea = {
      characterId,
      origin: fromCell,
      mode: 'split',
      dieIndex,
      maxSteps: dieValue(game, dieIndex),
      locked: false,
      prev: { origin: area.origin, dieIndex: area.dieIndex, maxSteps: area.maxSteps },
    };
    character.position = toCell;
    game.turn.usedDice[dieIndex] = true;
  } else if (area) {
    // Перестановка фишки внутри текущей ноги — кубик не тратится повторно.
    character.position = toCell;
  } else if (game.turn.mode === 'moveSum') {
    game.turn.movementArea = {
      characterId,
      origin: fromCell,
      mode: 'moveSum',
      dieIndex: null,
      maxSteps: game.turn.dice[0] + game.turn.dice[1],
      locked: false,
      prev: null,
    };
    character.position = toCell;
    game.turn.usedDice = [true, true];
  } else if (game.turn.mode === 'split') {
    const maxSteps = dieValue(game, dieIndex);
    game.turn.movementArea = {
      characterId,
      origin: fromCell,
      mode: 'split',
      dieIndex,
      maxSteps,
      locked: false,
      prev: null,
    };
    character.position = toCell;
    game.turn.usedDice[dieIndex] = true;
  } else {
    throw new Error('Сначала выберите режим движения.');
  }
  if (escapedCombat) clearCombat(game, character);
  if (escapedBeast) {
    if (character.beastFight?.fromInventory) {
      character.inventory.push(character.beastFight.cardId);
    }
    character.beastFight = null; // движение — побег от зверя
  }
  game.turn.movedCharacterId = characterId; // в этом броске двигается только он

  if (engagedTarget) linkCombat(character, engagedTarget);

  // Красная клетка: встреча — верхняя карта красной колоды.
  let redEvent = null;
  const terrain = cellTerrain(toCell);
  if (
    terrain === 'event'
    && !character.beastFight
    && !combatOpponent(game, character)
  ) {
    redEvent = drawRedEvent(game, character);
  }

  // Жёсткий коммит: после необратимого события (зверь на красной, выход из боя
  // или от зверя) откат и смена кубика недоступны — ход зафиксирован.
  if (game.turn.movementArea && (redEvent || escapedCombat || escapedBeast || engagedTarget)) {
    game.turn.movementArea.locked = true;
  }

  return {
    moved: {
      characterId,
      fromCell,
      toCell,
      distance: target.distance,
      escapedCombat,
      escapedBeast,
      engagedTargetId: engagedTarget?.id ?? null,
    },
    redEvent,
    winnerId: game.winnerId,
  };
}

// Красная клетка — ВСЕГДА бой со зверем (решение 11.06: без находок).
// Колода зверей: верхняя карта; опустела — перетасовываем зверей заново,
// чтобы каждая красная клетка гарантированно давала встречу.
function drawRedEvent(game, character) {
  if (game.redDeck.length === 0) {
    game.redDeck = buildRedDeck();
  }
  const cardId = game.redDeck.shift();
  const card = CARD_BY_ID[cardId];
  character.beastFight = { cardId, successes: 0, cellId: character.position };
  return {
    cardId,
    name: card?.name,
    type: card?.type,
    desc: card?.desc,
    beast: true,
    cellId: character.position,
  };
}

// Схватка со зверем: один кубик за попытку. killOn и выше — мгновенное
// убийство; successOn и выше — успех, needed успехов добивают зверя.
// terrainCards — id карт, выложенных игроком на террейн (например, гриффон).
function fightBeast(game, playerId, { characterId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  const character = ownCharacter(game, playerId, characterId);
  if (!character.beastFight) {
    const ramIndex = character.inventory.indexOf('sheep_ram');
    if (ramIndex === -1) {
      throw new Error('Персонаж не сражается со зверем.');
    }
    character.inventory.splice(ramIndex, 1);
    character.beastFight = {
      cardId: 'sheep_ram',
      successes: 0,
      cellId: character.position,
      fromInventory: true,
    };
  }
  const beast = BEASTS[character.beastFight.cardId];
  if (!beast) {
    throw new Error('Неизвестный зверь — схватка невозможна.');
  }
  const encounterCellId = character.beastFight.cellId ?? character.position;

  const value = dieValue(game, dieIndex);
  lockMovement(game);
  spendDie(game, dieIndex);

  // Активные карты на террейне после применения остаются на поле рубашкой вверх.
  const deactivatedTerrainCards = [];
  let terrainBonus = 0; // бонус к значению кубика
  const placedCards = (game.terrainCards ?? []).filter(
    (card) => card.ownerId === playerId && card.characterId === characterId,
  );
  for (const card of placedCards) {
    if (card.cardId === 'griffin' && character.role === 'O' && !card.faceDown) {
      // Гриффон: +1 к значению кубика против зверя
      terrainBonus = 1;
      card.faceDown = true;
      deactivatedTerrainCards.push(card.cardId);
    }
    // Будущие эффекты других карт
  }

  const effectiveValue = value + terrainBonus;
  let killed = false;
  const previousSuccesses = character.beastFight.successes;
  let successes = previousSuccesses;
  const clubUsed = character.role === 'V'
    && character.crafted?.includes('club')
    && character.inventory.includes('club')
    && effectiveValue >= 4;
  if (clubUsed || effectiveValue >= beast.killOn) {
    killed = true;
  } else if (effectiveValue >= beast.successOn) {
    successes += 1;
    character.beastFight.successes = successes;
    if (successes >= beast.needed) killed = true;
  }

  let hide = null;
  if (killed) {
    const { cardId } = character.beastFight;
    character.beastFight = null;
    // С убитого зверя падает «Шкура убитого зверя» (сырая), сама туша — в сброс.
    game.discard.push(cardId);
    hide = BEAST_HIDE_DROP[cardId] ?? null;
    if (hide) {
      if (character.inventory.length < INVENTORY_LIMIT) {
        character.inventory.push(hide);
      } else {
        game.discard.push(hide); // нет места — шкура уходит в сброс
        hide = null;
      }
    }
  }

  return {
    beastFought: {
      characterId,
      cellId: encounterCellId,
      value,
      effectiveValue,
      killed,
      successes,
      needed: beast.needed,
      damage: killed
        ? Math.max(1, beast.needed - previousSuccesses)
        : Math.max(0, successes - previousSuccesses),
      hide,
      clubUsed,
      terrainCardsTurnedFaceDown: deactivatedTerrainCards,
    },
  };
}

function teleport(game, playerId, { characterId, toCell, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  const character = ownCharacter(game, playerId, characterId);
  if (combatOpponent(game, character)) {
    throw new Error('В бою нельзя телепортироваться: атакуйте, передайте карты или убегайте.');
  }
  if (character.beastFight) {
    throw new Error('В схватке со зверем нельзя телепортироваться: добейте зверя или убегайте.');
  }
  if (!character.inventory.includes(TELEPORT_CARD)) {
    throw new Error('У персонажа нет Бус телепортации.');
  }
  if (character.exhaustedCards?.includes(TELEPORT_CARD)) {
    throw new Error('Бусы телепортации уже использованы.');
  }
  const ownStartCells = ROLES.map((role) => startCell(character.side, role));
  const teleportCells = pointClassCells('teleport');
  if (![...ownStartCells, ...teleportCells].includes(toCell)) {
    throw new Error('Телепортация доступна на свои стартовые клетки или фиолетовые точки.');
  }
  if (game.characters.some((item) => item.id !== character.id && item.position === toCell)) {
    throw new Error('Стартовая клетка занята.');
  }
  if (character.position === toCell) {
    throw new Error('Персонаж уже находится на этой клетке.');
  }
  const value = dieValue(game, dieIndex);
  lockMovement(game);
  spendDie(game, dieIndex);
  if (value < 2) {
    return {
      teleported: {
        characterId,
        toCell: null,
        value,
        success: false,
        consumed: false,
      },
    };
  }

  character.position = toCell;
  character.exhaustedCards ??= [];
  character.exhaustedCards.push(TELEPORT_CARD);
  return {
    teleported: {
      characterId,
      toCell,
      value,
      success: true,
      consumed: true,
    },
    winnerId: game.winnerId,
  };
}

function terrainPlace(game, playerId, { id, characterId, cardIndex, x, y, faceDown = false } = {}) {
  assertActive(game, playerId);
  const character = ownCharacter(game, playerId, characterId);
  const cardId = character.inventory[cardIndex];
  if (!cardId || CARD_BY_ID[cardId]?.locked && !character.crafted?.includes(cardId)) {
    throw new Error('Эту карту нельзя выложить на террейн.');
  }
  if (character.exhaustedCards?.includes(cardId)) {
    throw new Error('Использованную карту нельзя выложить на террейн.');
  }
  if (!id || typeof id !== 'string' || id.length > 100 || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Некорректное размещение карты.');
  }
  if (game.terrainCards.some((card) =>
    card.characterId === characterId && card.cardIndex === cardIndex)) {
    throw new Error('Карта уже выложена на террейн.');
  }
  character.inventory.splice(cardIndex, 1);
  game.terrainCards.push({
    id,
    ownerId: playerId,
    characterId,
    cardIndex,
    cardId,
    faceDown: faceDown === true,
    x,
    y,
  });
  return {
    terrainPlaced: {
      id,
      cardId,
      name: CARD_BY_ID[cardId]?.name ?? cardId,
      faceDown: faceDown === true,
    },
  };
}

function terrainRemove(game, playerId, { id } = {}) {
  assertActive(game, playerId);
  const index = game.terrainCards.findIndex((card) => card.id === id);
  if (index === -1) throw new Error('Карта на террейне не найдена.');
  if (game.terrainCards[index].ownerId !== playerId) {
    throw new Error('Вернуть карту может только владелец.');
  }
  const [terrainCard] = game.terrainCards.splice(index, 1);
  const character = ownCharacter(game, playerId, terrainCard.characterId);
  const insertAt = Math.min(terrainCard.cardIndex, character.inventory.length);
  character.inventory.splice(insertAt, 0, terrainCard.cardId);
  return {
    terrainRemoved: {
      id,
      cardId: terrainCard.cardId,
      name: CARD_BY_ID[terrainCard.cardId]?.name ?? terrainCard.cardId,
    },
  };
}

function terrainFlip(game, playerId, { id, faceDown } = {}) {
  assertActive(game, playerId);
  const terrainCard = game.terrainCards.find((card) => card.id === id);
  if (!terrainCard) throw new Error('Карта на террейне не найдена.');
  if (terrainCard.ownerId !== playerId) {
    throw new Error('Переворачивать карту может только владелец.');
  }
  terrainCard.faceDown = typeof faceDown === 'boolean'
    ? faceDown
    : !terrainCard.faceDown;
  return {
    terrainFlipped: {
      id,
      faceDown: terrainCard.faceDown,
      cardId: terrainCard.cardId,
      name: CARD_BY_ID[terrainCard.cardId]?.name ?? terrainCard.cardId,
    },
  };
}

export function availableAttackTargets(game, playerId, characterId) {
  if (!game.turn.dice || game.turn.usedDice[0] || game.turn.usedDice[1]) return [];
  const attacker = ownCharacter(game, playerId, characterId);
  if (attacker.beastFight) return []; // занят зверем — игроков не атакует
  const currentOpponent = combatOpponent(game, attacker);
  const adjacent = new Set(neighbors(attacker.position));
  return game.characters
    .filter((character) =>
      character.owner !== playerId
      && character.hp > 0
      && character.position
      && (!currentOpponent || character.id === currentOpponent.id)
      && (!combatOpponent(game, character) || character.combatOpponentId === attacker.id)
      && adjacent.has(character.position))
    .map((character) => character.id);
}

function engage(game, playerId, { attackerId, targetId } = {}) {
  assertActive(game, playerId);
  const attacker = ownCharacter(game, playerId, attackerId);
  if (attacker.beastFight) {
    throw new Error('В схватке со зверем нельзя вступить в бой с игроком.');
  }
  const target = game.characters.find((character) => character.id === targetId);
  if (!target || target.owner === playerId || target.hp <= 0 || !target.position) {
    throw new Error('Цель боя недоступна.');
  }
  const currentOpponent = combatOpponent(game, attacker);
  if (currentOpponent) {
    if (currentOpponent.id === target.id) {
      return { engaged: { attackerId, targetId, alreadyEngaged: true } };
    }
    throw new Error('Персонаж уже сражается с другим противником.');
  }
  if (combatOpponent(game, target)) {
    throw new Error('Противник уже участвует в другом бою.');
  }
  if (!neighbors(attacker.position).includes(target.position)) {
    throw new Error('Вступить в бой можно только с противником на соседней клетке.');
  }
  linkCombat(attacker, target);
  lockMovement(game);
  return { engaged: { attackerId, targetId, alreadyEngaged: false } };
}

// Шаман обрабатывает сырую шкуру в материалы. Шкура барана даёт кожу и шерсть.
// Бросает один кубик: ≥ HIDE_CLEAN_MIN — успех; меньше — кубик потрачен,
// а шкура остаётся и её можно обработать ещё раз.
function processHide(game, playerId, { characterId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game); // обработка стоит один кубик (режим раздельных кубиков)
  const character = ownCharacter(game, playerId, characterId);
  if (character.role !== 'S') {
    throw new Error('Шкуру обрабатывает только Шаман.');
  }
  const rawIndex = character.inventory.findIndex((id) => RAW_HIDE_TO_CLEAN[id]);
  if (rawIndex === -1) {
    throw new Error('Нужна «Шкура убитого зверя» — добудьте её с убитого зверя.');
  }
  const value = dieValue(game, dieIndex);
  lockMovement(game);
  spendDie(game, dieIndex);

  const success = value >= HIDE_CLEAN_MIN;
  let cleaned = null;
  let produced = [];
  if (success) {
    const rawId = character.inventory[rawIndex];
    cleaned = RAW_HIDE_TO_CLEAN[rawId];
    produced = Array.isArray(cleaned) ? cleaned : [cleaned];
    character.inventory.splice(rawIndex, 1, ...produced);
  }
  return { hideProcessed: { characterId, value, success, cleaned, produced } };
}

// Крафт базового изделия по чертежу/рецепту (CRAFT_RECIPES, строго по PnP).
// Чертёж/рецепт и материалы расходуются, с изделия снимается замок. Бесплатное
// действие в свой ход (кубик не тратится). item по умолчанию — дубина (совместимость).
function craft(game, playerId, { characterId, item = 'club', dieIndex } = {}) {
  assertActive(game, playerId);
  const character = ownCharacter(game, playerId, characterId);
  const recipe = CRAFT_RECIPES[item];
  if (!recipe) {
    throw new Error('Неизвестное изделие для крафта.');
  }
  // Изделие класса: открыть может только его класс (и эффект работает только у него)
  if (character.role !== recipe.role) {
    throw new Error(`Это изделие может открыть только ${ROLE_NAMES[recipe.role]}.`);
  }
  if (character.crafted.includes(recipe.result)) {
    throw new Error('Изделие уже открыто.');
  }
  if (!character.inventory.includes(recipe.via)) {
    throw new Error('Нужен чертёж или рецепт на это изделие.');
  }
  // По одной карте на каждый слот материалов (без повторного использования карты).
  const consumedIdx = [];
  for (const slot of recipe.materials) {
    const idx = character.inventory.findIndex((id, i) => !consumedIdx.includes(i) && slot.includes(id));
    if (idx === -1) {
      throw new Error('Не хватает материалов для изделия.');
    }
    consumedIdx.push(idx);
  }
  if (recipe.dice) {
    assertRolled(game);
    let values;
    if (recipe.dice.count === 1) {
      values = [dieValue(game, dieIndex)];
      lockMovement(game);
      spendDie(game, dieIndex);
    } else {
      if (game.turn.usedDice[0] || game.turn.usedDice[1]) {
        throw new Error('Для испытания нужны оба неиспользованных кубика.');
      }
      values = [...game.turn.dice];
      spendAllDice(game);
    }
    const success = values.every((value) => value >= recipe.dice.min);
    if (!success) {
      return {
        craftAttempt: {
          characterId,
          item,
          values,
          min: recipe.dice.min,
          success: false,
        },
      };
    }
  }
  // Израсходовать материалы + чертёж/рецепт (удаляем с конца, чтобы не сбить индексы).
  const removeIdx = [...consumedIdx, character.inventory.indexOf(recipe.via)].sort((a, b) => b - a);
  const discarded = [];
  for (const i of removeIdx) {
    discarded.push(...character.inventory.splice(i, 1));
  }
  game.discard.push(...discarded);
  // Добавить изделие в инвентарь и пометить как открытое (crafted).
  if (!character.inventory.includes(recipe.result)) {
    character.inventory.push(recipe.result);
  }
  character.crafted.push(recipe.result);
  return { crafted: { characterId, item, result: recipe.result, materials: discarded } };
}

function attack(game, playerId, { attackerId, targetId } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  if (game.turn.usedDice[0] || game.turn.usedDice[1]) {
    throw new Error('Для атаки нужны оба неиспользованных кубика.');
  }

  const attacker = ownCharacter(game, playerId, attackerId);
  if (attacker.beastFight) {
    throw new Error('В схватке со зверем нельзя атаковать игрока: добейте зверя или убегайте.');
  }
  const target = game.characters.find((character) => character.id === targetId);
  if (!target || target.owner === playerId || target.hp <= 0 || !target.position) {
    throw new Error('Цель атаки недоступна.');
  }
  if (!availableAttackTargets(game, playerId, attackerId).includes(targetId)) {
    throw new Error('Атаковать можно только противника на соседней клетке.');
  }

  linkCombat(attacker, target);
  
  // Базовый урон — сумма кубиков
  let damage = game.turn.dice[0] + game.turn.dice[1];
  let griffinDamage = 0;
  
  // Гриффон срабатывает только у Охотника и только когда лежит лицом вверх.
  const placedGriffin = (game.terrainCards ?? []).find((card) =>
    card.ownerId === playerId
    && card.characterId === attacker.id
    && card.cardId === 'griffin'
    && !card.faceDown);
  if (attacker.role === 'O' && placedGriffin) {
    // Атака по персонажу: сумма 2 → 10, 3 → 20, 4 → 25, 5+ → 30 урона.
    if (damage === 2) griffinDamage = 10;
    else if (damage === 3) griffinDamage = 20;
    else if (damage === 4) griffinDamage = 25;
    else if (damage >= 5) griffinDamage = 30;
  }
  if (griffinDamage > 0) {
    placedGriffin.faceDown = true;
  }
  
  const totalDamage = damage + griffinDamage;
  target.hp = Math.max(0, target.hp - totalDamage);
  const defeated = target.hp === 0;
  let lootCount = 0;
  let discardedCount = 0;

  if (defeated) {
    ({ lootCount, discardedCount } = defeatByPlayer(game, target, attacker));
  }

  spendAllDice(game);
  return {
    attacked: {
      attackerId,
      targetId,
      damage,
      griffinDamage,
      griffinTurnedFaceDown: griffinDamage > 0,
      totalDamage,
      targetHp: target.hp,
      defeated,
      lootCount,
      discardedCount,
    },
    winnerId: game.winnerId,
  };
}

function endTurn(game, playerId) {
  assertActive(game, playerId);

  const playerIds = Object.keys(game.turn.rollsLeft);
  const other = playerIds.find((id) => id !== playerId);
  game.turn.activePlayerId = other ?? playerId;
  game.turn.dice = null;
  game.turn.usedDice = [false, false];
  game.turn.movementArea = null;
  game.turn.mode = null;
  game.turn.hasRolled = false;
  game.turn.transferRemaining = 0;
  game.turn.movedCharacterId = null;
  game.turn.drawnThisTurn = false;

  let rollsReset = false;
  if (playerIds.every((id) => game.turn.rollsLeft[id] <= 0)) {
    for (const id of playerIds) {
      game.turn.rollsLeft[id] = ROLLS_PER_GAME;
    }
    rollsReset = true;
  }

  return { activePlayerId: game.turn.activePlayerId, over: game.over, rollsReset };
}

// --- помощники валидации ---

function assertActive(game, playerId) {
  if (game.over) {
    throw new Error('Партия завершена.');
  }
  if (game.turn.activePlayerId !== playerId) {
    throw new Error('Сейчас ход другого игрока.');
  }
}

function assertRolled(game) {
  if (!game.turn.dice) {
    throw new Error('Сначала бросьте кубики.');
  }
}

function requireSplit(game) {
  if (game.turn.mode !== 'split') {
    throw new Error('Передача и добор доступны только в режиме раздельных кубиков (split).');
  }
}

function dieValue(game, dieIndex) {
  if (dieIndex !== 0 && dieIndex !== 1) {
    throw new Error('Кубик должен быть 0 или 1.');
  }
  if (!game.turn.dice) {
    throw new Error('Сначала бросьте кубики.');
  }
  if (game.turn.usedDice[dieIndex]) {
    throw new Error('Этот кубик уже потрачен.');
  }
  return game.turn.dice[dieIndex];
}

function ownCharacter(game, playerId, characterId) {
  const character = game.characters.find((c) => c.id === characterId);
  if (!character) {
    throw new Error('Персонаж не найден.');
  }
  if (character.owner !== playerId) {
    throw new Error('Это не ваш персонаж.');
  }
  if (character.hp <= 0 || !character.position) {
    throw new Error('Персонаж выбыл из игры.');
  }
  return character;
}

// Пассивные эффекты карт на начало хода игрока. Точка расширения: сюда же
// позже встанут Дубина (−10 HP врагу в бою), регенерация и т.п.
// Ковёр шамана: каждое начало хода восстанавливает владельцу +2 HP.
const SHAMAN_CARPET_HEAL = 2;

function applyTurnStartEffects(game, playerId) {
  for (const character of game.characters) {
    if (character.owner !== playerId || character.hp <= 0 || !character.position) continue;
    if (character.role === 'S'
      && character.crafted?.includes('shaman_carpet')
      && character.inventory.includes('shaman_carpet')
      && character.hp < CHARACTER_HP) {
      character.hp = Math.min(CHARACTER_HP, character.hp + SHAMAN_CARPET_HEAL);
    }
    // Дубина (открытая крафтом): враг в бою теряет 10 HP в начало хода владельца.
    // Эффект работает только у Воина (Класс: воин — иначе её даже не открыть).
    if (character.role === 'V' && character.crafted?.includes('club') && character.inventory.includes('club')) {
      const opponent = combatOpponent(game, character);
      if (opponent) {
        opponent.hp = Math.max(0, opponent.hp - CLUB_DAMAGE);
        if (opponent.hp === 0) defeatByPlayer(game, opponent, character);
      }
    }
    // Зверь кусает в начале каждого хода владельца, пока его не убили
    // или от него не убежали.
    const beast = character.beastFight ? BEASTS[character.beastFight.cardId] : null;
    if (beast) {
      character.hp = Math.max(0, character.hp - beast.damage);
      if (character.hp === 0) {
        character.position = null;
        character.beastFight = null;
        game.discard.push(...character.inventory.splice(0));
        if (!game.characters.some((c) => c.owner === playerId && c.hp > 0)) {
          game.over = true;
          game.winnerId = Object.keys(game.turn.rollsLeft)
            .find((id) => id !== playerId) ?? null;
        }
      }
    }
  }
}

function combatOpponent(game, character) {
  if (!character?.combatOpponentId) return null;
  const opponent = game.characters.find((item) => item.id === character.combatOpponentId);
  if (
    !opponent
    || opponent.hp <= 0
    || !opponent.position
    || opponent.combatOpponentId !== character.id
  ) {
    return null;
  }
  return opponent;
}

function linkCombat(first, second) {
  first.combatOpponentId = second.id;
  second.combatOpponentId = first.id;
}

// Гибель персонажа от руки игрока: победитель забирает добычу до лимита
// инвентаря, излишек — в сброс; гибель последнего персонажа — победа.
function defeatByPlayer(game, target, looter) {
  clearCombat(game, target);
  target.beastFight = null;
  target.position = null;
  const capacity = Math.max(0, INVENTORY_LIMIT - looter.inventory.length);
  const loot = target.inventory.splice(0, capacity);
  const overflow = target.inventory.splice(0);
  looter.inventory.push(...loot);
  game.discard.push(...overflow);
  if (!game.characters.some((c) => c.owner === target.owner && c.hp > 0)) {
    game.over = true;
    game.winnerId = looter.owner;
  }
  return { lootCount: loot.length, discardedCount: overflow.length };
}

function clearCombat(game, character) {
  const opponent = game.characters.find((item) => item.id === character.combatOpponentId);
  if (opponent?.combatOpponentId === character.id) {
    opponent.combatOpponentId = null;
  }
  character.combatOpponentId = null;
}

function spendDie(game, dieIndex) {
  game.turn.usedDice[dieIndex] = true;
  if (game.turn.usedDice[0] && game.turn.usedDice[1]) {
    if (game.turn.movementArea) return;
    game.turn.mode = null;
  }
}

function spendAllDice(game) {
  game.turn.usedDice = [true, true];
  game.turn.movementArea = null;
  game.turn.mode = null;
}

function assertBoardTarget(cellId) {
  if (!isBoardCell(cellId)) {
    throw new Error('Клетка находится за пределами карты.');
  }
}


function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

// Строит общую игровую колоду из смешанного грунта и леса.
// Рецепты, чертежи, колода барана, красная, озеро и сказочная опушка — отдельные стеки (TODO).
const GENERAL_DECKS = new Set(['mixed', 'forest', 'dark_forest']);

function buildDeck() {
  const deck = [];
  for (const card of CARD_CATALOG) {
    if (!GENERAL_DECKS.has(card.deck)) continue;
    for (let i = 0; i < card.copies; i += 1) {
      deck.push(card.id);
    }
  }
  return shuffle(deck);
}

// Красная колода — ТОЛЬКО звери (красные клетки = бой, без находок).
// Шкуры/оружие красной колоды приходят как трофеи и добыча, не с клеток.
function buildRedDeck() {
  const deck = [];
  for (const card of CARD_CATALOG) {
    if (card.deck !== 'red' || card.type !== 'beast') continue;
    for (let i = 0; i < card.copies; i += 1) {
      deck.push(card.id);
    }
  }
  return shuffle(deck);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
