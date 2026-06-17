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
  BEAST_TROPHY_DROP,
  GOLD_FEATHER_CARDS,
  GOLD_FEATHER_OWN,
  GOLD_FEATHER_ENEMY,
  RAW_HIDE_TO_CLEAN,
  HIDE_CLEAN_MIN,
  CRAFT_RECIPES,
  CLUB_DAMAGE,
  TRAP_CARDS,
  ARMOR_CARDS,
  WEAPON_CARDS,
} from './constants.js';
import {
  MAP_ID,
  cellTerrain,
  cellDeck,
  blacksmithStoneSide,
  enemySide,
  isBlacksmithStoneCell,
  isBoardCell,
  neighbors,
  reachableCells,
  shortestDistance,
  startCell,
  pointClassCells,
} from './map.js';

const GOLD_FEATHER_SET = new Set(GOLD_FEATHER_CARDS);

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
        dots: [], // дебаффы-ловушки: [{ cardId, damagePerTurn, dischargeMin, name }]
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
    decks: buildDecks(),
    redDeck: buildRedDeck(),
    redIrkonDropped: false,
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
    case 'action:dischargeDot':
      return dischargeDot(game, playerId, payload);
    case 'action:terrainPlace':
      return terrainPlace(game, playerId, payload);
    case 'action:terrainRemove':
      return terrainRemove(game, playerId, payload);
    case 'action:terrainFlip':
      return terrainFlip(game, playerId, payload);
    case 'debug:grantCard':
      return debugGrantCard(game, playerId, payload);
    default:
      throw new Error(`Команда недоступна в игре: ${type}`);
  }
}

function debugGrantCard(game, playerId, { characterId, cardId } = {}) {
  const character = ownCharacter(game, playerId, characterId);
  const card = CARD_BY_ID[cardId];
  if (!card) {
    throw new Error('Неизвестная карта для отладочной выдачи.');
  }
  character.inventory.push(cardId);
  if (card.locked && !character.crafted?.includes(cardId)) {
    character.crafted ??= [];
    character.crafted.push(cardId);
  }
  return {
    debugGranted: {
      characterId,
      cardId,
      name: card.name ?? cardId,
      count: character.inventory.length,
      crafted: Boolean(card.locked),
    },
  };
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
  game.turn.rollStartPositions = Object.fromEntries(
    game.characters.map((character) => [character.id, character.position ?? null]),
  );
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
  if (!isDrawCell(character.position)) {
    throw new Error('Взять карту можно только на точке ресурса.');
  }
  const bonusTool = character.role === 'K' ? 'hammer'
    : character.role === 'P' ? 'sack'
      : null;
  const inventoryToolCount = bonusTool
    ? character.inventory.filter((cardId) => cardId === bonusTool).length
    : 0;
  const placedTools = bonusTool
    ? (game.terrainCards ?? []).filter((card) =>
      card.ownerId === playerId
      && card.characterId === character.id
      && card.cardId === bonusTool
      && !card.faceDown)
    : [];
  const bonusToolCount = isDrawCell(character.position)
    ? inventoryToolCount + placedTools.length
    : 0;
  const drawDeckName = drawDeckForCell(character.position);
  const drawPile = drawPileForDeck(game, drawDeckName);
  const drawCount = 1 + bonusToolCount;
  if (drawPile.length < drawCount) {
    throw new Error('Колода пуста.');
  }
  if (character.inventory.length + drawCount > INVENTORY_LIMIT) {
    throw new Error(drawCount === 1
      ? 'Инвентарь персонажа полон.'
      : `Для действия нужно ${drawCount} свободных места в инвентаре.`);
  }

  const cardIds = drawPile.splice(0, drawCount);
  character.inventory.push(...cardIds);
  for (const card of placedTools) card.faceDown = true;
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
      bonusTool: bonusToolCount > 0 ? bonusTool : null,
      bonusToolCount,
      deck: drawDeckName,
      hammerUsed: bonusToolCount > 0 && character.role === 'K',
      terrainCardsTurnedFaceDown: placedTools.map((card) => card.cardId),
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
  const cards = from.inventory.slice(0, count);
  assertCardTransferAllowed(from, to, cards);
  from.inventory.splice(0, count);
  to.inventory.push(...cards);
  moveExhaustedCards(from, to, cards);
  lockMovement(game);
  spendDie(game, dieIndex);

  return { transferred: { fromId, toId, count } };
}

// Переносит одну карту по индексу между персонажами игрока (для передачи из ящика).
function moveOneCard(game, playerId, fromId, toId, cardIndex) {
  const from = ownCharacter(game, playerId, fromId);
  const to = ownCharacter(game, playerId, toId);
  if (INVENTORY_LIMIT - to.inventory.length <= 0) {
    throw new Error('У получателя нет места в инвентаре.');
  }
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= from.inventory.length) {
    throw new Error('Карта для передачи не найдена.');
  }
  const card = from.inventory[cardIndex];
  assertCardTransferAllowed(from, to, [card]);
  from.inventory.splice(cardIndex, 1);
  to.inventory.push(card);
  moveExhaustedCards(from, to, [card]);
  return card;
}

function assertCardTransferAllowed(from, to, cardIds) {
  if (!cardIds.some(isGoldFeatherCard)) return;
  if (from.position && to.position && (from.position === to.position || neighbors(from.position).includes(to.position))) {
    return;
  }
  throw new Error('Золотое перо нельзя передать через поле — персонажи должны стоять рядом.');
}

function isGoldFeatherCard(cardId) {
  return GOLD_FEATHER_SET.has(cardId);
}

function carriedGoldFeatherId(character) {
  return character?.inventory?.find(isGoldFeatherCard) ?? null;
}

function goldFeatherTargetSide(character, cardId) {
  if (cardId === GOLD_FEATHER_OWN) return character.side;
  if (cardId === GOLD_FEATHER_ENEMY) return enemySide(character.side);
  return null;
}

function checkFeatherVictory(game, character) {
  const featherId = carriedGoldFeatherId(character);
  if (
    game.over
    || !character?.position
    || !featherId
    || !isBlacksmithStoneCell(character.position)
    || blacksmithStoneSide(character.position) !== goldFeatherTargetSide(character, featherId)
  ) {
    return null;
  }
  game.over = true;
  game.winnerId = character.owner;
  return {
    winnerId: character.owner,
    characterId: character.id,
    cellId: character.position,
    cardId: featherId,
  };
}

function isDrawCell(cellId) {
  if (cellTerrain(cellId) === 'resource') return true;
  const deck = cellDeck(cellId);
  return Boolean(deck && deck !== 'fairy_glade');
}

function drawDeckForCell(cellId) {
  const deck = cellDeck(cellId);
  if (deck && deck !== 'fairy_glade') return deck;
  return 'mixed';
}

function drawPileForDeck(game, deckName) {
  if (deckName === 'mixed') return game.deck;
  if (!game.decks) game.decks = buildDecks();
  if (!game.decks[deckName]) game.decks[deckName] = buildDeck(deckName);
  return game.decks[deckName];
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
    if (movementArea.locked) return [];
    if (movementArea.characterId !== character.id || character.beastFight) return [];
    if (movementArea.mode === 'split' && dieIndex !== movementArea.dieIndex) {
      // Вторая «нога»: ходим другим свободным кубиком от ТЕКУЩЕЙ клетки.
      // Недоступно после жёсткого коммита (красная клетка / выход из боя / другое действие).
      if (game.turn.usedDice[dieIndex]) return [];
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

// Клетки, достижимые РОВНО одним кубиком из текущей позиции, независимо от
// выбранного режима хода. В отличие от availableMoveTargets (в moveSum считает
// по сумме кубиков), здесь всегда одиночная дальность — нужно снапшоту, чтобы
// клиент понимал, дотягивается ли ресурс одним кубиком (подсветка «Взять»), и
// не путал это с дальностью по сумме. Возвращает массив cellId.
export function singleDieTargets(game, playerId, characterId, dieIndex) {
  const character = ownCharacter(game, playerId, characterId);
  if (!game.turn.dice || (dieIndex !== 0 && dieIndex !== 1)) return [];
  if (game.turn.usedDice[dieIndex]) return [];
  // В бою/схватке карту взять нельзя — планируемый добор неактуален.
  if (combatOpponent(game, character) || character.beastFight) return [];
  const maxSteps = game.turn.dice[dieIndex];
  const blocked = new Set(
    game.characters
      .filter((item) => item.id !== character.id && item.position)
      .map((item) => item.position),
  );
  return reachableCells(character.position, maxSteps, blocked)
    .filter((target) => target.cellId !== character.position)
    .map((target) => target.cellId);
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
    // Автосплит: если ход закончился на клетке добора (ресурс/колода карт, но не
    // событийной) и путь уложился в один кубик — тратим только ОДИН кубик
    // (наименьший достаточный), больший оставляем свободным на добор. Режим
    // переводим в split, чтобы стали доступны добор/передача. Иначе — обычное
    // движение суммой (оба кубика).
    // Побег из боя/схватки и вступление в бой — «жёсткий» ход, стоит сумму
    // (оба кубика). Автосплит на них не распространяется.
    const maxDie = Math.max(game.turn.dice[0], game.turn.dice[1]);
    const autoSplit = isDrawCell(toCell)
      && cellTerrain(toCell) !== 'event'
      && target.distance <= maxDie
      && !escapedCombat
      && !escapedBeast
      && !engagedTarget;
    if (autoSplit) {
      const dieIdx = [0, 1]
        .filter((i) => game.turn.dice[i] >= target.distance)
        .reduce((best, i) => (game.turn.dice[i] < game.turn.dice[best] ? i : best));
      game.turn.mode = 'split';
      game.turn.movementArea = {
        characterId,
        origin: fromCell,
        mode: 'split',
        dieIndex: dieIdx,
        maxSteps: game.turn.dice[dieIdx],
        locked: false,
        prev: null,
      };
      character.position = toCell;
      game.turn.usedDice[dieIdx] = true;
    } else {
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
    }
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

  // Клетка-событие: красная — зверь из красной колоды; Сказочная опушка
  // (deck 'fairy_glade') — феникс из колоды феникса (квест Иерихон).
  let redEvent = null;
  const terrain = cellTerrain(toCell);
  const startedRollOnCell = game.turn.rollStartPositions?.[character.id] === toCell;
  if (
    terrain === 'event'
    && !startedRollOnCell
    && !character.beastFight
    && !combatOpponent(game, character)
  ) {
    redEvent = cellDeck(toCell) === 'fairy_glade'
      ? drawFairyEvent(game, character)
      : drawRedEvent(game, character);
  }

  // Жёсткий коммит: после необратимого события (зверь на красной, выход из боя
  // или от зверя) откат и смена кубика недоступны — ход зафиксирован.
  if (game.turn.movementArea && (redEvent || escapedCombat || escapedBeast || engagedTarget)) {
    game.turn.movementArea.locked = true;
  }
  const featherVictory = checkFeatherVictory(game, character);

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
    featherVictory,
    winnerId: game.winnerId,
  };
}

// Красная клетка: 2% шанс найти Ирикон; иначе карта из красной колоды.
// Зверь начинает схватку, остальные красные карты попадают в инвентарь
// персонажа, если есть место.
function drawRedEvent(game, character) {
  let cardId = null;
  let specialRoll = false;
  if (!game.redIrkonDropped && Math.random() < 0.02) {
    cardId = 'irikon';
    game.redIrkonDropped = true;
    specialRoll = true;
  } else {
    if (game.redDeck.length === 0) {
      game.redDeck = buildRedDeck();
    }
    cardId = game.redDeck.shift();
  }
  const card = CARD_BY_ID[cardId];
  const beast = card?.type === 'beast';
  let acquired = false;
  let discarded = false;
  if (beast) {
    character.beastFight = { cardId, successes: 0, cellId: character.position };
  } else if (character.inventory.length < INVENTORY_LIMIT) {
    character.inventory.push(cardId);
    acquired = true;
  } else {
    game.discard.push(cardId);
    discarded = true;
  }
  return {
    cardId,
    name: card?.name,
    type: card?.type,
    desc: card?.desc,
    beast,
    acquired,
    discarded,
    specialRoll,
    cellId: character.position,
  };
}

// Сказочная опушка (квест Иерихон) — встреча с фениксом. Колода феникса
// уникальна: фениксы не возрождаются. Когда колода пуста — событие не
// происходит (возвращаем null), клетка при этом остаётся (норма для MVP).
function drawFairyEvent(game, character) {
  if (!game.fairyDeck) {
    game.fairyDeck = buildFairyDeck();
  }
  if (game.fairyDeck.length === 0) {
    return null; // фениксы кончились — больше не возрождаются
  }
  const cardId = game.fairyDeck.shift();
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
  const placedClubs = [];
  const placedCards = (game.terrainCards ?? []).filter(
    (card) => card.ownerId === playerId && card.characterId === characterId,
  );
  for (const card of placedCards) {
    if (card.cardId === 'griffin' && character.role === 'O' && !card.faceDown) {
      // Гриффон: +1 к значению кубика против зверя
      terrainBonus += 1;
      card.faceDown = true;
      deactivatedTerrainCards.push(card.cardId);
    }
    if (card.cardId === 'club' && character.role === 'V' && !card.faceDown) {
      placedClubs.push(card);
    }
    // Будущие эффекты других карт
  }

  const effectiveValue = value + terrainBonus;
  let killed = false;
  const previousSuccesses = character.beastFight.successes;
  let successes = previousSuccesses;
  const clubUsed = placedClubs.length > 0 && effectiveValue >= 4;
  if (clubUsed) {
    for (const card of placedClubs) {
      card.faceDown = true;
      deactivatedTerrainCards.push(card.cardId);
    }
  }
  if (clubUsed || effectiveValue >= beast.killOn) {
    killed = true;
  } else if (effectiveValue >= beast.successOn) {
    successes += 1;
    character.beastFight.successes = successes;
    if (successes >= beast.needed) killed = true;
  }

  let hide = null;
  let trophy = null;
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
    // Особый трофей (напр. золотое перо с феникса) — отдельно от шкуры.
    trophy = BEAST_TROPHY_DROP[cardId] ?? null;
    if (trophy) {
      if (character.inventory.length < INVENTORY_LIMIT) {
        character.inventory.push(trophy);
      } else {
        game.discard.push(trophy); // нет места — трофей уходит в сброс
        trophy = null;
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
      trophy,
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
  if (!character.inventory.includes(TELEPORT_CARD)) {
    throw new Error('У персонажа нет Бус телепортации.');
  }
  if (carriedGoldFeatherId(character)) {
    throw new Error('Персонаж с Золотым пером не может телепортироваться.');
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

  const escapedCombat = Boolean(combatOpponent(game, character));
  const escapedBeast = Boolean(character.beastFight);
  character.position = toCell;
  if (escapedCombat) clearCombat(game, character);
  if (escapedBeast) {
    if (character.beastFight?.fromInventory) {
      character.inventory.push(character.beastFight.cardId);
    }
    character.beastFight = null;
  }
  character.exhaustedCards ??= [];
  character.exhaustedCards.push(TELEPORT_CARD);
  const featherVictory = checkFeatherVictory(game, character);
  return {
    teleported: {
      characterId,
      toCell,
      value,
      success: true,
      consumed: true,
      escapedCombat,
      escapedBeast,
    },
    featherVictory,
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
  if (game.terrainCards.some((card) => card.id === id)) {
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
  assertRolled(game);
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
function processHide(game, playerId, { characterId, dieIndex, cardIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game); // обработка стоит один кубик (режим раздельных кубиков)
  const character = ownCharacter(game, playerId, characterId);
  if (character.role !== 'S') {
    throw new Error('Шкуру обрабатывает только Шаман.');
  }
  const rawIndex = Number.isInteger(cardIndex)
    ? cardIndex
    : character.inventory.findIndex((id) => RAW_HIDE_TO_CLEAN[id]);
  const rawId = character.inventory[rawIndex];
  if (rawIndex < 0 || !RAW_HIDE_TO_CLEAN[rawId]) {
    throw new Error('Нужна «Шкура убитого зверя» — добудьте её с убитого зверя.');
  }
  const value = dieValue(game, dieIndex);
  lockMovement(game);
  spendDie(game, dieIndex);

  const success = value >= HIDE_CLEAN_MIN;
  let cleaned = null;
  let produced = [];
  if (success) {
    cleaned = RAW_HIDE_TO_CLEAN[rawId];
    produced = Array.isArray(cleaned) ? cleaned : [cleaned];
    character.inventory.splice(rawIndex, 1, ...produced);
  }
  return {
    hideProcessed: {
      characterId,
      cardIndex: rawIndex,
      rawId,
      value,
      success,
      cleaned,
      produced,
    },
  };
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
  // Каждый новый чертёж/рецепт с новым комплектом материалов даёт ещё один экземпляр.
  character.inventory.push(recipe.result);
  if (!character.crafted.includes(recipe.result)) {
    character.crafted.push(recipe.result);
  }
  return { crafted: { characterId, item, result: recipe.result, materials: discarded } };
}

// Стряхнуть DoT-ловушку (Полянка/Дикие ягоды). Режим split, тратит один кубик.
// При значении ≥ dischargeMin карта снимается и уходит в сброс; иначе дебафф
// остаётся, а кубик потрачен.
function dischargeDot(game, playerId, { characterId, dotIndex = 0, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  const character = ownCharacter(game, playerId, characterId);
  const dots = character.dots ?? [];
  const dot = dots[dotIndex];
  if (!dot) {
    throw new Error('У персонажа нет ловушки для сброса.');
  }
  const value = dieValue(game, dieIndex);
  lockMovement(game);
  spendDie(game, dieIndex);
  const success = value >= dot.dischargeMin;
  if (success) {
    dots.splice(dotIndex, 1);
    game.discard.push(dot.cardId);
  }
  return {
    dotDischarged: {
      characterId,
      cardId: dot.cardId,
      name: dot.name,
      value,
      min: dot.dischargeMin,
      success,
    },
  };
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
  const placedGriffins = (game.terrainCards ?? []).filter((card) =>
    card.ownerId === playerId
    && card.characterId === attacker.id
    && card.cardId === 'griffin'
    && !card.faceDown);
  if (attacker.role === 'O' && placedGriffins.length > 0) {
    // Атака по персонажу: сумма 2 → 10, 3 → 20, 4 → 25, 5+ → 30 урона.
    let damagePerGriffin = 0;
    if (damage === 2) damagePerGriffin = 10;
    else if (damage === 3) damagePerGriffin = 20;
    else if (damage === 4) damagePerGriffin = 25;
    else if (damage >= 5) damagePerGriffin = 30;
    griffinDamage = damagePerGriffin * placedGriffins.length;
  }
  if (griffinDamage > 0) {
    for (const card of placedGriffins) card.faceDown = true;
  }

  // Оружие работает из руки и как активная карта на террейне у персонажа. Берём
  // лучшее по урону, доступное атакующему (role — ограничение класса).
  let weapon = null;
  const activeTerrainWeapons = (game.terrainCards ?? [])
    .filter((card) => card.ownerId === playerId
      && card.characterId === attacker.id
      && !card.faceDown
      && WEAPON_CARDS[card.cardId])
    .map((card) => card.cardId);
  for (const id of [...attacker.inventory, ...activeTerrainWeapons]) {
    const w = WEAPON_CARDS[id];
    if (!w || (w.role && w.role !== attacker.role)) continue;
    if (!weapon || w.damage > weapon.damage) weapon = { id, ...w };
  }
  const weaponDamage = weapon ? weapon.damage : 0;
  const weaponPiercing = weapon ? Boolean(weapon.piercing) : false;

  // Урон делится на обычный (кубики + Гриффон + непробивающее оружие) и пробивающий
  // («без учёта защиты»). Активная броня цели поглощает только обычную часть.
  const normalDamage = damage + griffinDamage + (weaponPiercing ? 0 : weaponDamage);
  const piercingDamage = weaponPiercing ? weaponDamage : 0;
  const armorAbsorb = (game.terrainCards ?? [])
    .filter((card) => card.ownerId === target.owner
      && card.characterId === target.id
      && !card.faceDown
      && ARMOR_CARDS[card.cardId])
    .reduce((sum, card) => sum + ARMOR_CARDS[card.cardId].absorb, 0);

  const totalDamage = normalDamage + piercingDamage; // до брони — для журнала
  const afterArmor = Math.max(0, normalDamage - armorAbsorb) + piercingDamage;

  // Ловушки защищающегося (Блеф): нападающий ударил первым — вскрываем выложенные
  // рубашкой вверх ловушки цели. Они могут погасить входящий урон (negate), бить
  // по нападающему (флэт/зеркало) или отбросить его к своему старту.
  const trap = resolveDefenderTraps(game, attacker, target, afterArmor);
  const dealtDamage = trap.incomingDamage;

  target.hp = Math.max(0, target.hp - dealtDamage);
  const defeated = target.hp === 0;
  let lootCount = 0;
  let discardedCount = 0;
  if (defeated) {
    ({ lootCount, discardedCount } = defeatByPlayer(game, target, attacker));
  }

  if (trap.attackerSelfDamage > 0) {
    attacker.hp = Math.max(0, attacker.hp - trap.attackerSelfDamage);
  }
  if (trap.retreatSteps > 0) {
    retreatToStart(game, attacker, trap.retreatSteps);
  }
  let attackerDefeated = false;
  if (attacker.hp === 0) {
    attackerDefeated = true;
    defeatByPlayer(game, attacker, target);
  }

  spendAllDice(game);
  return {
    attacked: {
      attackerId,
      targetId,
      damage,
      griffinDamage,
      griffinTurnedFaceDown: griffinDamage > 0,
      weaponDamage,
      weaponName: weapon?.name ?? null,
      weaponPiercing,
      totalDamage,
      armorAbsorbed: armorAbsorb,
      dealtDamage,
      targetHp: target.hp,
      defeated,
      lootCount,
      discardedCount,
      traps: trap.triggered,
      attackerDefeated,
      attackerHp: attacker.hp,
    },
    winnerId: game.winnerId,
  };
}

// Разрешение карт-ловушек защищающегося. Вскрывает выложенные рубашкой вверх
// (faceDown) карты из TRAP_CARDS, привязанные к атакованному персонажу. Сначала
// гасит входящий урон (negate), затем считает урон по нападающему (флэт + зеркало
// от фактически нанесённого) и отброс. Одноразовые карты уходят в сброс.
function resolveDefenderTraps(game, attacker, defender, intendedDamage = 0) {
  const cards = (game.terrainCards ?? []).filter((card) =>
    card.ownerId === defender.owner
    && card.characterId === defender.id
    && card.faceDown === true
    && TRAP_CARDS[card.cardId]);
  let incomingDamage = intendedDamage;
  for (const card of cards) {
    if (TRAP_CARDS[card.cardId].negateIncoming) incomingDamage = 0;
  }
  let attackerSelfDamage = 0;
  let retreatSteps = 0;
  const triggered = [];
  for (const card of cards) {
    const t = TRAP_CARDS[card.cardId];
    const selfDamage = (t.attackerSelfDamage ?? 0) + (t.mirror ? incomingDamage : 0);
    attackerSelfDamage += selfDamage;
    if (t.retreatAttacker) retreatSteps = Math.max(retreatSteps, t.retreatAttacker);
    // Ночной филин: защищающийся забирает одну карту из инвентаря нападающего.
    let stolen = null;
    if (t.stealCard && attacker.inventory.length > 0) {
      stolen = attacker.inventory.shift();
      if (defender.inventory.length < INVENTORY_LIMIT) defender.inventory.push(stolen);
      else game.discard.push(stolen); // нет места — карта в сброс
    }
    // Порча: при уроне ≥ порога у каждого персонажа нападающего по 1 ингредиенту
    // возвращается в сброс (упрощение «обратно в колоды»).
    let purged = 0;
    if (t.purgeIngredientsMin && incomingDamage >= t.purgeIngredientsMin) {
      for (const ch of game.characters) {
        if (ch.owner !== attacker.owner) continue;
        const idx = ch.inventory.findIndex((id) => CARD_BY_ID[id]?.type === 'ingredient');
        if (idx !== -1) {
          game.discard.push(ch.inventory.splice(idx, 1)[0]);
          purged += 1;
        }
      }
    }
    if (t.dot) {
      // Карта-ловушка переходит дебаффом на нападающего: тикает каждый его ход,
      // пока он не стряхнёт её (action:dischargeDot). С поля защищающегося уходит.
      attacker.dots = attacker.dots ?? [];
      attacker.dots.push({
        cardId: card.cardId,
        damagePerTurn: t.dot,
        dischargeMin: t.dischargeMin ?? 5,
        name: t.name ?? CARD_BY_ID[card.cardId]?.name ?? card.cardId,
      });
      const idx = game.terrainCards.indexOf(card);
      if (idx !== -1) game.terrainCards.splice(idx, 1);
    } else if (t.consume) {
      const idx = game.terrainCards.indexOf(card);
      if (idx !== -1) game.terrainCards.splice(idx, 1);
      game.discard.push(card.cardId);
    } else {
      card.faceDown = false; // вскрыта, остаётся на поле
    }
    triggered.push({
      id: card.id,
      cardId: card.cardId,
      name: t.name ?? CARD_BY_ID[card.cardId]?.name ?? card.cardId,
      attackerSelfDamage: selfDamage,
      negated: Boolean(t.negateIncoming),
      retreat: t.retreatAttacker ?? 0,
      dot: t.dot ?? 0,
      stolen: stolen ? (CARD_BY_ID[stolen]?.name ?? stolen) : null,
      purged,
      consumed: t.consume === true,
    });
  }
  return { incomingDamage, attackerSelfDamage, retreatSteps, triggered };
}

// Отброс персонажа к своему старту на steps бордов (эффект Совы). Жадно идём по
// соседям, уменьшая дистанцию до старта, не вставая на занятые клетки. Бой при
// этом разрывается — нападающий вынужденно покидает схватку.
function retreatToStart(game, character, steps) {
  const start = startCell(character.side, character.role);
  if (!start || !character.position) return;
  clearCombat(game, character);
  let current = character.position;
  for (let i = 0; i < steps && current !== start; i += 1) {
    let best = null;
    let bestDist = shortestDistance(current, start);
    for (const nb of neighbors(current)) {
      if (game.characters.some((c) => c.hp > 0 && c.id !== character.id && c.position === nb)) continue;
      const dist = shortestDistance(nb, start);
      if (dist < bestDist) {
        bestDist = dist;
        best = nb;
      }
    }
    if (!best) break;
    current = best;
  }
  character.position = current;
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
    const inventoryCarpets = character.role === 'S'
      ? character.inventory.filter((cardId) => cardId === 'shaman_carpet').length
      : 0;
    const placedCarpets = character.role === 'S'
      ? (game.terrainCards ?? []).filter((card) =>
        card.ownerId === playerId
        && card.characterId === character.id
        && card.cardId === 'shaman_carpet'
        && !card.faceDown)
      : [];
    const carpetCount = inventoryCarpets + placedCarpets.length;
    if (carpetCount > 0 && character.hp < CHARACTER_HP) {
      character.hp = Math.min(CHARACTER_HP, character.hp + SHAMAN_CARPET_HEAL * carpetCount);
      for (const card of placedCarpets) card.faceDown = true;
    }
    // Активная Дубина на террейне: враг в бою теряет 10 HP в начало хода владельца.
    const placedClubs = (game.terrainCards ?? []).filter((card) =>
      card.ownerId === playerId
      && card.characterId === character.id
      && card.cardId === 'club'
      && !card.faceDown);
    if (character.role === 'V' && placedClubs.length > 0) {
      const opponent = combatOpponent(game, character);
      if (opponent) {
        opponent.hp = Math.max(0, opponent.hp - CLUB_DAMAGE * placedClubs.length);
        for (const card of placedClubs) card.faceDown = true;
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
    // DoT-ловушки (Полянка мухоморов, Дикие красные ягоды): тикают в начале
    // каждого хода носителя, пока он их не стряхнёт (action:dischargeDot).
    if (Array.isArray(character.dots) && character.dots.length > 0 && character.hp > 0) {
      const dotDamage = character.dots.reduce((sum, d) => sum + d.damagePerTurn, 0);
      character.hp = Math.max(0, character.hp - dotDamage);
      if (character.hp === 0) {
        character.position = null;
        character.beastFight = null;
        character.dots = [];
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

// Добор по рубашке клетки. Красная колода и Сказочная опушка обрабатываются
// отдельными событиями, трофеи не входят в случайный добор.
const DRAW_DECKS = Object.freeze(['mixed', 'forest', 'dark_forest', 'sheep', 'lake', 'recipes', 'blueprints']);

function buildDeck(deckName = 'mixed') {
  const deck = [];
  for (const card of CARD_CATALOG) {
    if (card.deck !== deckName) continue;
    for (let i = 0; i < card.copies; i += 1) {
      deck.push(card.id);
    }
  }
  return shuffle(deck);
}

function buildDecks() {
  return Object.fromEntries(DRAW_DECKS.map((deckName) => [deckName, buildDeck(deckName)]));
}

// Красная колода: все красные карты кроме Ирикона. Сам Ирикон идёт
// отдельным редким шансом 2%, а медведь встречается чаще остальных зверей.
function buildRedDeck() {
  const deck = [];
  for (const card of CARD_CATALOG) {
    if (card.deck !== 'red' || card.id === 'irikon') continue;
    const copies = card.id === 'beast_bear' ? Math.max(card.copies, 4) : card.copies;
    for (let i = 0; i < copies; i += 1) {
      deck.push(card.id);
    }
  }
  return shuffle(deck);
}

// Колода феникса (Сказочная опушка). Два уникальных феникса; перетасованы,
// чтобы порядок появления не был детерминирован. Не пересобирается при опустошении.
function buildFairyDeck() {
  return shuffle(['phoenix_1', 'phoenix_2']);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
