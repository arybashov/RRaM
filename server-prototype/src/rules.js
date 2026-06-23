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
  dwarfRoute,
} from './map.js';

const GOLD_FEATHER_SET = new Set(GOLD_FEATHER_CARDS);
// Дварфы выходят из ворот после 5-го полного круга основных игроков.
const DWARF_ENTRY_TURN = 5;
const DWARF_UNITS = Object.freeze([
  { id: 'dwarf:ordinary:1', kind: 'ordinary', name: 'Дварф', hp: 100 },
  { id: 'dwarf:ordinary:2', kind: 'ordinary', name: 'Дварф', hp: 100 },
  { id: 'dwarf:tank', kind: 'tank', name: 'Дварф-танк', hp: 140 },
  { id: 'dwarf:rifle:1', kind: 'rifle', name: 'Дварф с ружьём', hp: 100 },
  { id: 'dwarf:rifle:2', kind: 'rifle', name: 'Дварф с ружьём', hp: 100 },
]);
const DWARF_AGGRO_RADIUS = 5;
const DWARF_ROUTE_DEVIATION = 5;
const DWARF_ATTACK = Object.freeze({
  ordinary: { range: 1, damage: 10 },
  tank: { range: 1, damage: 15 },
  rifle: { range: 5, damage: 15 },
});

// Бросок кубиков дварфа = его дальность хода за раунд (как у персонажей: два
// кубика, дальность = сумме). Вынесено в переменную, чтобы тесты могли задать
// детерминированный бросок через __setDwarfDiceRoller.
let dwarfDiceRoller = () => [rollDie(), rollDie()];
export function __setDwarfDiceRoller(fn) {
  dwarfDiceRoller = typeof fn === 'function' ? fn : () => [rollDie(), rollDie()];
}

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
        frogSpell: null, // Озёрная лягушка: отключает оружие, пока цель не выбросит сумму 8+
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
    dwarves: createDwarfState(),
    turn: {
      activePlayerId: players[0].id,
      rollsLeft,
      dice: null,
      usedDice: [false, false],
      diceByCharacter: {},
      usedDiceByCharacter: {},
      modeByCharacter: {}, // режим хода на каждого персонажа; отсутствие = moveSum по умолчанию
      movementArea: null, // bound-вид области движения активного персонажа
      movementAreaByCharacter: {}, // { characterId, origin, mode, dieIndex, maxSteps } на каждого персонажа
      mode: null, // bound-вид режима активного персонажа; null трактуется как 'moveSum'
      hasRolled: false,
      transferRemaining: 0, // «бюджет» передачи карт из ящика (= значению потраченного кубика)
      movedCharacterId: null, // последний персонаж, который двигался в этом броске
      drawnThisTurn: false,   // совместимый флаг: в этом броске был хотя бы один добор
      drawnCharacterIdsThisTurn: [], // каждый персонаж может добрать один раз за бросок
    },
  };
}

function createDwarfState() {
  const route = dwarfRoute();
  const enabled = route.length > 0;
  const active = enabled && DWARF_ENTRY_TURN <= 0;
  return {
    enabled,
    active,
    entryTurn: DWARF_ENTRY_TURN,
    mainTurnsCompleted: 0,
    route,
    routeIndex: -1,
    units: DWARF_UNITS.map((unit) => ({
      ...unit,
      position: null,
      routeIndex: -1,
      inventory: [],
      alive: true,
      exited: false, // дошёл до конца маршрута (ворот) и ушёл с поля — не возвращается
    })),
  };
}

export function apply(game, playerId, type, payload = {}) {
  bindPayloadDice(game, payload);
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
    case 'action:drawProfession':
      return drawProfession(game, playerId, payload);
    case 'action:discardCard':
      return discardCard(game, playerId, payload);
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
    case 'action:useGoldNugget':
      return useGoldNugget(game, playerId, payload);
    case 'action:useDeadOre':
      return useDeadOre(game, playerId, payload);
    case 'action:useLakeFrog':
      return useLakeFrog(game, playerId, payload);
    case 'action:useMarvo':
      return useMarvo(game, playerId, payload);
    case 'action:rechargeTeleport':
      return rechargeTeleport(game, playerId, payload);
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
  if (hasRolledDice(game)) {
    throw new Error('Кубики уже брошены — потратьте их или завершите ход.');
  }
  if (game.turn.hasRolled) {
    throw new Error('В этом ходу кубики уже бросали — завершите ход.');
  }
  if (game.turn.rollsLeft[playerId] <= 0) {
    throw new Error('Броски закончились — завершите ход.');
  }

  applyTurnStartEffects(game, playerId);

  const activeCharacters = game.characters.filter((character) =>
    character.owner === playerId
    && character.hp > 0
    && character.position);
  const diceByCharacter = Object.fromEntries(
    activeCharacters.map((character) => [character.id, [rollDie(), rollDie()]]),
  );
  game.turn.diceByCharacter = diceByCharacter;
  game.turn.usedDiceByCharacter = Object.fromEntries(
    activeCharacters.map((character) => [character.id, [false, false]]),
  );
  const firstCharacter = activeCharacters[0];
  const dice = firstCharacter ? diceByCharacter[firstCharacter.id] : [rollDie(), rollDie()];
  game.turn.dice = dice;
  game.turn.usedDice = firstCharacter
    ? game.turn.usedDiceByCharacter[firstCharacter.id]
    : [false, false];
  game.turn.activeDiceCharacterId = firstCharacter?.id ?? null;
  game.turn.movementArea = null;
  game.turn.movementAreaByCharacter = {};
  game.turn.mode = null;
  game.turn.modeByCharacter = {};
  game.turn.hasRolled = true;
  game.turn.movedCharacterId = null;
  game.turn.drawnThisTurn = false;
  game.turn.drawnCharacterIdsThisTurn = [];
  game.turn.rollStartPositions = Object.fromEntries(
    game.characters.map((character) => [character.id, character.position ?? null]),
  );
  game.turn.rollsLeft[playerId] -= 1;
  const lakeFrogReleased = releaseLakeFrogSpellsForRoll(game, playerId, dice);

  return {
    roll: { dice, diceByCharacter, total: dice[0] + dice[1], rollsLeft: game.turn.rollsLeft[playerId], lakeFrogReleased },
  };
}

function setMode(game, playerId, { mode, characterId } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  const ownArea = game.turn.movementArea
    && game.turn.movementArea.characterId === (characterId ?? game.turn.activeDiceCharacterId);
  if (
    game.turn.usedDice[0]
    || game.turn.usedDice[1]
    || ownArea
  ) {
    throw new Error('Режим нельзя менять после траты кубика.');
  }
  if (mode !== 'moveSum' && mode !== 'split') {
    throw new Error('Режим должен быть moveSum или split.');
  }
  // С characterId — персональный режим персонажа; без него — глобальный дефолт
  // (легаси/тесты). Так split одного персонажа не утекает в ход суммой других.
  setCharacterMode(game, characterId, mode);
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
    setCurrentUsedDice(game, [false, false]);
    setMovementArea(game, null, characterId);
    game.turn.movedCharacterId = null;
    setCharacterMode(game, characterId, null); // полный откат → снова ход суммой
  } else {
    game.turn.usedDice[area.dieIndex] = false;
    if (area.prev) {
      // Была вторая нога — снова активируем первую (фишка уже на её конце).
      setMovementArea(game, {
        characterId,
        origin: area.prev.origin,
        mode: 'split',
        dieIndex: area.prev.dieIndex,
        maxSteps: area.prev.maxSteps,
        locked: false,
        prev: null,
      });
    } else {
      setMovementArea(game, null, characterId);
      game.turn.movedCharacterId = null;
      setCharacterMode(game, characterId, null); // первой ноги нет → ход суммой
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

function drawnCharacterIdsThisTurn(game) {
  game.turn.drawnCharacterIdsThisTurn ??= [];
  return game.turn.drawnCharacterIdsThisTurn;
}

function hasCharacterDrawnThisTurn(game, characterId) {
  return drawnCharacterIdsThisTurn(game).includes(characterId);
}

function markCharacterDrawnThisTurn(game, characterId) {
  const ids = drawnCharacterIdsThisTurn(game);
  if (!ids.includes(characterId)) ids.push(characterId);
  game.turn.drawnThisTurn = ids.length > 0;
}

function drawCardsFromCurrentCell(game, playerId, character) {
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

  const cards = cardIds.map((cardId) => {
    const card = CARD_BY_ID[cardId];
    return { card: cardId, name: card?.name, type: card?.type, desc: card?.desc };
  });
  return {
    characterId: character.id,
    ...cards[0],
    cards,
    count: cards.length,
    bonusTool: bonusToolCount > 0 ? bonusTool : null,
    bonusToolCount,
    deck: drawDeckName,
    hammerUsed: bonusToolCount > 0 && character.role === 'K',
    terrainCardsTurnedFaceDown: placedTools.map((card) => card.cardId),
  };
}

function draw(game, playerId, { characterId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game, characterId);
  dieValue(game, dieIndex); // только валидируем доступность; значение на добор не влияет

  const character = ownCharacter(game, playerId, characterId);
  if (hasCharacterDrawnThisTurn(game, character.id)) {
    throw new Error('Этот персонаж уже брал карту в этом броске — выберите другого персонажа или другое действие.');
  }
  if (combatOpponent(game, character)) {
    throw new Error('В бою персонаж не может брать карты: атакуйте, передайте карты или убегайте.');
  }
  if (character.beastFight) {
    throw new Error('В схватке со зверем персонаж не может брать карты: добейте зверя или убегайте.');
  }
  const drawn = drawCardsFromCurrentCell(game, playerId, character);
  markCharacterDrawnThisTurn(game, character.id);
  lockMovement(game); // движение в этот бросок зафиксировано — откат недоступен
  spendDie(game, dieIndex);

  return {
    drawn,
  };
}

// Профессиональные колоды (ТЗ: «рецепты — только шаман; чертежи — только кузнец»).
const PROFESSION_DECK_BY_ROLE = Object.freeze({ S: 'recipes', K: 'blueprints' });

// Добор из проф-колоды — без точки на карте: Шаман/Кузнец обращается к своей
// колоде за цену любого свободного кубика (значение не важно, как и обычный добор).
function drawProfession(game, playerId, { characterId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game, characterId);
  dieValue(game, dieIndex); // только валидируем доступность кубика; значение на добор не влияет

  const character = ownCharacter(game, playerId, characterId);
  const deckName = PROFESSION_DECK_BY_ROLE[character.role];
  if (!deckName) {
    throw new Error('Брать из проф-колоды могут только Кузнец (чертежи) и Шаман (рецепты).');
  }
  if (hasCharacterDrawnThisTurn(game, character.id)) {
    throw new Error('Этот персонаж уже брал карту в этом броске — выберите другого персонажа или другое действие.');
  }
  if (combatOpponent(game, character)) {
    throw new Error('В бою персонаж не может брать карты: атакуйте, передайте карты или убегайте.');
  }
  if (character.beastFight) {
    throw new Error('В схватке со зверем персонаж не может брать карты: добейте зверя или убегайте.');
  }
  if (character.inventory.length + 1 > INVENTORY_LIMIT) {
    throw new Error('Инвентарь персонажа полон.');
  }
  const pile = drawPileForDeck(game, deckName);
  if (pile.length < 1) {
    throw new Error('Колода пуста.');
  }

  const cardId = pile.shift();
  character.inventory.push(cardId);
  markCharacterDrawnThisTurn(game, character.id);
  lockMovement(game);
  spendDie(game, dieIndex);

  const card = CARD_BY_ID[cardId];
  return {
    drawn: {
      characterId: character.id,
      card: cardId,
      name: card?.name,
      type: card?.type,
      desc: card?.desc,
      cards: [{ card: cardId, name: card?.name, type: card?.type, desc: card?.desc }],
      count: 1,
      deck: deckName,
      profession: true, // клиент покажет флип-анимацию вместо обычного «Взята карта»
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
    requireSplit(game, fromId);
    const value = dieValue(game, dieIndex); // валидирует доступность кубика
    const cardId = moveOneCard(game, playerId, fromId, toId, cardIndex);
    lockMovement(game);                     // фиксируем незавершённое движение
    spendDie(game, dieIndex);               // кубик тратится сразу, остаток значения — в бюджет
    game.turn.transferRemaining = value - 1;
    return { transferred: { fromId, toId, count: 1, cardId, name: CARD_BY_ID[cardId]?.name, remaining: game.turn.transferRemaining } };
  }

  // Легаси: первые N карт за один кубик (N = значение кубика)
  assertRolled(game);
  requireSplit(game, fromId);
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

function discardCard(game, playerId, { characterId, cardIndex } = {}) {
  const character = ownCharacter(game, playerId, characterId);
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= character.inventory.length) {
    throw new Error('Карта для удаления не найдена.');
  }
  const [cardId] = character.inventory.splice(cardIndex, 1);
  game.discard.push(cardId);
  const exhaustedIndex = character.exhaustedCards?.indexOf(cardId) ?? -1;
  if (exhaustedIndex !== -1) {
    character.exhaustedCards.splice(exhaustedIndex, 1);
  }
  return {
    discardedCard: {
      characterId,
      cardId,
      name: CARD_BY_ID[cardId]?.name ?? cardId,
    },
  };
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
  const pileName = DRAW_DECK_ALIASES[deckName] ?? deckName;
  if (pileName === 'mixed') return game.deck;
  if (!game.decks) game.decks = buildDecks();
  if (!game.decks[pileName]) game.decks[pileName] = buildDeck(pileName);
  return game.decks[pileName];
}

function autoDrawAfterMove(game, playerId, character, {
  escapedCombat = false,
  escapedBeast = false,
  engagedTarget = null,
  redEvent = null,
} = {}) {
  if (
    hasCharacterDrawnThisTurn(game, character.id)
    || escapedCombat
    || escapedBeast
    || engagedTarget
    || redEvent
    || !isDrawCell(character.position)
    || cellTerrain(character.position) === 'event'
    || combatOpponent(game, character)
    || character.beastFight
  ) {
    return null;
  }
  try {
    const drawn = drawCardsFromCurrentCell(game, playerId, character);
    markCharacterDrawnThisTurn(game, character.id);
    lockMovement(game);
    return drawn;
  } catch {
    return null;
  }
}

function livingDwarfUnits(game) {
  return (game.dwarves?.units ?? []).filter((unit) =>
    unit.alive !== false && unit.position);
}

function findLivingDwarfUnit(game, unitId) {
  return livingDwarfUnits(game).find((unit) => unit.id === unitId) ?? null;
}

function occupiedStopCells(game, { exceptCharacterId = null, exceptDwarfId = null } = {}) {
  const occupied = new Set();
  for (const character of game.characters ?? []) {
    if (character.id === exceptCharacterId || character.hp <= 0 || !character.position) continue;
    occupied.add(character.position);
  }
  for (const unit of livingDwarfUnits(game)) {
    if (unit.id === exceptDwarfId) continue;
    occupied.add(unit.position);
  }
  return occupied;
}

function movementBlockedCells(game, {
  ownerId = null,
  exceptCharacterId = null,
  exceptDwarfId = null,
  includeDwarves = true,
} = {}) {
  const blocked = new Set();
  for (const character of game.characters ?? []) {
    if (character.id === exceptCharacterId || character.hp <= 0 || !character.position) continue;
    if (!ownerId || character.owner !== ownerId) blocked.add(character.position);
  }
  if (includeDwarves) {
    for (const unit of livingDwarfUnits(game)) {
      if (unit.id === exceptDwarfId) continue;
      blocked.add(unit.position);
    }
  }
  return blocked;
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
  bindTurnDice(game, characterId);
  if (!game.turn.dice) return [];
  const opponent = combatOpponent(game, character);
  const turnArea = game.turn.movementArea;
  const movementArea = turnArea?.characterId === character.id ? turnArea : null;

  let maxSteps;
  let origin = character.position;
  if (movementArea) {
    if (movementArea.locked) return [];
    if (character.beastFight) return [];
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
  } else if (modeFor(game, character.id) === 'split') {
    if (opponent) return [];
    maxSteps = dieValue(game, dieIndex);
  } else {
    // moveSum по умолчанию → ход суммой обоих кубиков.
    if (game.turn.usedDice[0] || game.turn.usedDice[1]) return [];
    maxSteps = game.turn.dice[0] + game.turn.dice[1];
  }

  const blocked = movementBlockedCells(game, { ownerId: playerId });
  const occupied = occupiedStopCells(game, { exceptCharacterId: character.id });
  const targets = reachableCells(origin, maxSteps, blocked)
    .filter((target) => target.cellId !== character.position)
    .filter((target) => !occupied.has(target.cellId));
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
  const blocked = movementBlockedCells(game, { ownerId: playerId });
  const occupied = occupiedStopCells(game, { exceptCharacterId: character.id });
  return reachableCells(character.position, maxSteps, blocked)
    .filter((target) => target.cellId !== character.position)
    .filter((target) => !occupied.has(target.cellId))
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
  dieIndex = resolveMoveDieIndex(game, playerId, character, toCell, dieIndex);
  if (!isDieIndex(dieIndex) && shouldRequireMoveDieIndex(game, character)) {
    throw new Error('Выберите кубик для движения.');
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
    if (
      escapedCombat
      || escapedBeast
      || !engagedTarget
      || engagedTarget.owner === playerId
      || engagedTarget.hp <= 0
      || !engagedTarget.position
      || engagedTarget.beastFight
      || !neighbors(toCell).includes(engagedTarget.position)
    ) {
      throw new Error('Не удалось вступить в бой с выбранным противником.');
    }
  }
  const turnArea = game.turn.movementArea;
  const area = turnArea?.characterId === characterId ? turnArea : null;
  if (area && area.mode === 'split' && dieIndex !== area.dieIndex && !game.turn.usedDice[dieIndex]) {
    // Вторая «нога»: фиксируем первую (её кубик уже потрачен), начинаем новую
    // от текущей клетки другим кубиком. prev хранит первую ногу для отката.
    setMovementArea(game, {
      characterId,
      origin: fromCell,
      mode: 'split',
      dieIndex,
      maxSteps: dieValue(game, dieIndex),
      locked: false,
      prev: { origin: area.origin, dieIndex: area.dieIndex, maxSteps: area.maxSteps },
    });
    character.position = toCell;
    game.turn.usedDice[dieIndex] = true;
  } else if (area) {
    // Перестановка фишки внутри текущей ноги — кубик не тратится повторно.
    character.position = toCell;
  } else if (modeFor(game, characterId) !== 'split') {
    // moveSum по умолчанию → ход суммой.
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
      setCharacterMode(game, characterId, 'split');
      setMovementArea(game, {
        characterId,
        origin: fromCell,
        mode: 'split',
        dieIndex: dieIdx,
        maxSteps: game.turn.dice[dieIdx],
        locked: false,
        prev: null,
      });
      character.position = toCell;
      game.turn.usedDice[dieIdx] = true;
    } else {
      setMovementArea(game, {
        characterId,
        origin: fromCell,
        mode: 'moveSum',
        dieIndex: null,
        maxSteps: game.turn.dice[0] + game.turn.dice[1],
        locked: false,
        prev: null,
      });
      character.position = toCell;
      setCurrentUsedDice(game, [true, true]);
    }
  } else {
    // Явный split: ход одним выбранным кубиком.
    const maxSteps = dieValue(game, dieIndex);
    setMovementArea(game, {
      characterId,
      origin: fromCell,
      mode: 'split',
      dieIndex,
      maxSteps,
      locked: false,
      prev: null,
    });
    character.position = toCell;
    game.turn.usedDice[dieIndex] = true;
  }
  if (escapedCombat) clearCombat(game, character);
  if (escapedBeast) {
    if (character.beastFight?.fromInventory) {
      character.inventory.push(character.beastFight.cardId);
    }
    character.beastFight = null; // движение — побег от зверя
  }
  game.turn.movedCharacterId = characterId; // последний двигавшийся персонаж

  if (engagedTarget) linkCombat(game, character, engagedTarget);

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

  const drawn = autoDrawAfterMove(game, playerId, character, {
    escapedCombat,
    escapedBeast,
    engagedTarget,
    redEvent,
  });

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
      dieIndex: isDieIndex(dieIndex) ? dieIndex : null,
      distance: target.distance,
      escapedCombat,
      escapedBeast,
      engagedTargetId: engagedTarget?.id ?? null,
    },
    redEvent,
    drawn,
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
  if (!game.turn.dice || (game.turn.usedDice[0] && game.turn.usedDice[1])) return [];
  const attacker = ownCharacter(game, playerId, characterId);
  if (attacker.beastFight) return []; // занят зверем — игроков не атакует
  const adjacent = new Set(neighbors(attacker.position));
  const targets = game.characters
    .filter((character) =>
      character.owner !== playerId
      && character.hp > 0
      && character.position
      && adjacent.has(character.position))
    .map((character) => character.id);
  for (const unit of livingDwarfUnits(game)) {
    if (adjacent.has(unit.position)) targets.push(unit.id);
  }
  return targets;
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
  if (!neighbors(attacker.position).includes(target.position)) {
    throw new Error('Вступить в бой можно только с противником на соседней клетке.');
  }
  linkCombat(game, attacker, target);
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

function useGoldNugget(game, playerId, { characterId, cardIndex, terrainCardId } = {}) {
  assertActive(game, playerId);
  const character = ownCharacter(game, playerId, characterId);
  const source = findUsableCard(game, playerId, character, 'gold_nugget', { cardIndex, terrainCardId });
  if (!source) {
    throw new Error('У персонажа нет малого золотого самородка для лечения.');
  }
  if (character.hp >= CHARACTER_HP) {
    throw new Error('Персонаж уже полностью здоров.');
  }
  const before = character.hp;
  character.hp = Math.min(CHARACTER_HP, character.hp + 20);
  const cardId = spendUsableCard(game, character, source);
  game.discard.push(cardId);
  return {
    goldNuggetUsed: {
      characterId,
      cardId,
      source: source.source,
      healed: character.hp - before,
      hp: character.hp,
      discarded: true,
    },
  };
}

const DEAD_ORE_ALLOWED_DECKS = Object.freeze(['mixed', 'forest', 'dark_forest', 'sheep', 'lake']);

function useDeadOre(game, playerId, { characterId, cardIndex, terrainCardId, deck } = {}) {
  assertActive(game, playerId);
  const character = ownCharacter(game, playerId, characterId);
  if (combatOpponent(game, character)) {
    throw new Error('Неживую руду нельзя применять в бою.');
  }
  if (character.beastFight) {
    throw new Error('Неживую руду нельзя применять в схватке со зверем.');
  }
  if (!DEAD_ORE_ALLOWED_DECKS.includes(deck)) {
    throw new Error('Этой рудой можно взять карту только из обычной колоды, кроме чертежей и рецептов.');
  }
  const source = findUsableCard(game, playerId, character, 'dead_ore', { cardIndex, terrainCardId });
  if (!source) {
    throw new Error('У персонажа нет неживой руды высокого качества.');
  }
  const pile = drawPileForDeck(game, deck);
  if (pile.length < 1) {
    throw new Error('Выбранная колода пуста.');
  }
  const spent = spendUsableCard(game, character, source);
  game.discard.push(spent);
  const cardId = pile.shift();
  character.inventory.push(cardId);
  const card = CARD_BY_ID[cardId];
  return {
    deadOreUsed: {
      characterId,
      spent,
      source: source.source,
      deck,
      card: cardId,
      name: card?.name,
      type: card?.type,
    },
  };
}

function useLakeFrog(game, playerId, { characterId, cardIndex, terrainCardId, targetId } = {}) {
  assertActive(game, playerId);
  const shaman = ownCharacter(game, playerId, characterId);
  if (shaman.role !== 'S') {
    throw new Error('Озёрную лягушку применяет только Шаман.');
  }
  const source = findUsableCard(game, playerId, shaman, 'lake_frog', { cardIndex, terrainCardId });
  if (!source) {
    throw new Error('У Шамана нет Озёрной лягушки.');
  }

  if (shaman.beastFight && (!targetId || targetId === shaman.id)) {
    const spent = spendUsableCard(game, shaman, source);
    const beastId = shaman.beastFight.cardId;
    const beastCard = CARD_BY_ID[beastId];
    shaman.beastFight = null;
    game.discard.push(beastId);

    const returned = returnLakeFrogCard(game, shaman.id, spent);
    const hide = addRewardCard(game, shaman, BEAST_HIDE_DROP[beastId] ?? null);
    const trophy = addRewardCard(game, shaman, BEAST_TROPHY_DROP[beastId] ?? null);
    return {
      lakeFrogUsed: {
        mode: 'beast',
        casterId: shaman.id,
        targetId: shaman.id,
        source: source.source,
        beastId,
        beastName: beastCard?.name ?? beastId,
        hide,
        trophy,
        returned,
      },
    };
  }

  const target = game.characters.find((character) => character.id === targetId);
  if (!target || target.owner === playerId || target.hp <= 0 || !target.position) {
    throw new Error('Цель для Озёрной лягушки недоступна.');
  }
  if (!shaman.position || !neighbors(shaman.position).includes(target.position)) {
    throw new Error('Озёрную лягушку можно наложить только на соседнего противника.');
  }
  if (target.frogSpell) {
    throw new Error('На этом персонаже уже действует Озёрная лягушка.');
  }

  const spent = spendUsableCard(game, shaman, source);
  target.frogSpell = {
    cardId: spent,
    casterId: shaman.id,
    ownerId: playerId,
    dischargeTotal: 8,
    name: CARD_BY_ID[spent]?.name ?? 'Озёрная лягушка',
  };
  return {
    lakeFrogUsed: {
      mode: 'player',
      casterId: shaman.id,
      targetId: target.id,
      source: source.source,
      targetRole: target.role,
      name: target.frogSpell.name,
      dischargeTotal: target.frogSpell.dischargeTotal,
    },
  };
}

function addRewardCard(game, character, cardId) {
  if (!cardId) return null;
  if (character.inventory.length < INVENTORY_LIMIT) {
    character.inventory.push(cardId);
    return cardId;
  }
  game.discard.push(cardId);
  return null;
}

function returnLakeFrogCard(game, casterId, cardId = 'lake_frog') {
  const caster = game.characters.find((character) => character.id === casterId && character.hp > 0);
  if (caster && caster.inventory.length < INVENTORY_LIMIT) {
    caster.inventory.push(cardId);
    return { casterId: caster.id, discarded: false };
  }
  game.discard.push(cardId);
  return { casterId: casterId ?? null, discarded: true };
}

function releaseLakeFrogSpell(game, target) {
  const spell = target?.frogSpell;
  if (!spell) return null;
  target.frogSpell = null;
  const returned = returnLakeFrogCard(game, spell.casterId, spell.cardId);
  return {
    targetId: target.id,
    casterId: spell.casterId,
    name: spell.name ?? CARD_BY_ID[spell.cardId]?.name ?? spell.cardId,
    returned,
  };
}

function releaseLakeFrogSpellsForRoll(game, playerId, dice) {
  const total = (dice?.[0] ?? 0) + (dice?.[1] ?? 0);
  const released = [];
  for (const character of game.characters) {
    if (character.owner !== playerId || !character.frogSpell) continue;
    if (total < (character.frogSpell.dischargeTotal ?? 8)) continue;
    released.push(releaseLakeFrogSpell(game, character));
  }
  return released.filter(Boolean);
}

function useMarvo(game, playerId, { characterId, cardIndex, terrainCardId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  const shaman = ownCharacter(game, playerId, characterId);
  if (shaman.role !== 'S') {
    throw new Error('Марво трос применяет только Шаман.');
  }
  if (!shaman.position) {
    throw new Error('Шаман не на поле.');
  }
  const source = findUsableCard(game, playerId, shaman, 'marvo', { cardIndex, terrainCardId });
  if (!source) {
    throw new Error('У Шамана нет Марво троса.');
  }
  const activeWeapon = (game.terrainCards ?? []).find((card) =>
    card.ownerId === playerId
    && card.characterId === shaman.id
    && !card.faceDown
    && WEAPON_CARDS[card.cardId]);
  if (!activeWeapon) {
    throw new Error('Для Обряда трёх нужно активное оружие, выложенное на террейн у Шамана.');
  }
  const targets = game.characters.filter((target) =>
    target.owner !== playerId
    && target.hp > 0
    && target.position
    && shortestDistance(shaman.position, target.position) <= 2);
  if (targets.length < 2) {
    throw new Error('Для Обряда трёх нужно минимум две вражеские цели в радиусе 2 бордов.');
  }

  const value = dieValue(game, dieIndex);
  const damage = value * 10;
  lockMovement(game);
  spendDie(game, dieIndex);
  const spent = spendUsableCard(game, shaman, source);
  game.discard.push(spent);

  const hit = [];
  for (const target of targets) {
    target.hp = Math.max(0, target.hp - damage);
    const defeated = target.hp === 0;
    let lootCount = 0;
    let discardedCount = 0;
    if (defeated) {
      ({ lootCount, discardedCount } = defeatByPlayer(game, target, shaman));
    }
    hit.push({
      targetId: target.id,
      role: target.role,
      damage,
      hp: target.hp,
      defeated,
      lootCount,
      discardedCount,
    });
  }

  return {
    marvoUsed: {
      casterId: shaman.id,
      dieIndex,
      value,
      damage,
      source: source.source,
      weaponCardId: activeWeapon.cardId,
      weaponName: CARD_BY_ID[activeWeapon.cardId]?.name ?? activeWeapon.cardId,
      targets: hit,
      discarded: true,
    },
    winnerId: game.winnerId,
  };
}

function rechargeTeleport(game, playerId, { characterId, targetId, terrainCardId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  const shaman = ownCharacter(game, playerId, characterId);
  if (shaman.role !== 'S') {
    throw new Error('Бусы телепортации перезаряжает только Шаман.');
  }
  const target = ownCharacter(game, playerId, targetId ?? characterId);
  if (!target.inventory.includes(TELEPORT_CARD)) {
    throw new Error('У цели нет Бус телепортации.');
  }
  if (!target.exhaustedCards?.includes(TELEPORT_CARD)) {
    throw new Error('Бусы телепортации уже заряжены.');
  }
  const source = findUsableCard(game, playerId, shaman, 'ritual_hide', { terrainCardId });
  if (!source || source.source !== 'terrain') {
    throw new Error('Шкуру ритуалов нужно выложить лицом вверх на террейн у Шамана.');
  }

  const value = dieValue(game, dieIndex);
  lockMovement(game);
  spendDie(game, dieIndex);
  const ritualCard = game.terrainCards[source.terrainIndex];
  ritualCard.faceDown = true;

  const success = value >= 4;
  if (success) {
    const exhaustedIndex = target.exhaustedCards.indexOf(TELEPORT_CARD);
    if (exhaustedIndex >= 0) {
      target.exhaustedCards.splice(exhaustedIndex, 1);
    }
  }

  return {
    teleportRecharged: {
      shamanId: shaman.id,
      targetId: target.id,
      value,
      success,
      cardId: TELEPORT_CARD,
      ritualCardId: 'ritual_hide',
      terrainCardId: ritualCard.id,
      terrainCardsTurnedFaceDown: [ritualCard.id],
    },
  };
}

function findUsableCard(game, playerId, character, cardId, { cardIndex, terrainCardId } = {}) {
  if (typeof terrainCardId === 'string') {
    const terrainIndex = (game.terrainCards ?? []).findIndex((card) =>
      card.id === terrainCardId
      && card.ownerId === playerId
      && card.characterId === character.id
      && card.cardId === cardId
      && !card.faceDown);
    if (terrainIndex >= 0) return { source: 'terrain', terrainIndex };
    return null;
  }
  const inventoryIndex = Number.isInteger(cardIndex) ? cardIndex : character.inventory.indexOf(cardId);
  if (inventoryIndex >= 0 && character.inventory[inventoryIndex] === cardId) {
    return { source: 'inventory', inventoryIndex };
  }
  const terrainIndex = (game.terrainCards ?? []).findIndex((card) =>
    card.ownerId === playerId
    && card.characterId === character.id
    && card.cardId === cardId
    && !card.faceDown);
  if (terrainIndex >= 0) return { source: 'terrain', terrainIndex };
  return null;
}

function spendUsableCard(game, character, source) {
  if (source.source === 'terrain') {
    const [card] = game.terrainCards.splice(source.terrainIndex, 1);
    return card.cardId;
  }
  const [cardId] = character.inventory.splice(source.inventoryIndex, 1);
  return cardId;
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
  const dieIndex = firstFreeDieIndex(game);
  if (dieIndex === -1) {
    throw new Error('Для атаки нужен свободный кубик.');
  }

  const attacker = ownCharacter(game, playerId, attackerId);
  if (attacker.beastFight) {
    throw new Error('В схватке со зверем нельзя атаковать игрока: добейте зверя или убегайте.');
  }
  const dwarfTarget = findLivingDwarfUnit(game, targetId);
  if (dwarfTarget) {
    if (!availableAttackTargets(game, playerId, attackerId).includes(targetId)) {
      throw new Error('Атаковать дварфа можно только на соседней клетке.');
    }
    return attackDwarf(game, playerId, attacker, dwarfTarget, dieIndex);
  }
  const target = game.characters.find((character) => character.id === targetId);
  if (!target || target.owner === playerId || target.hp <= 0 || !target.position) {
    throw new Error('Цель атаки недоступна.');
  }
  if (!availableAttackTargets(game, playerId, attackerId).includes(targetId)) {
    throw new Error('Атаковать можно только противника на соседней клетке.');
  }

  linkCombat(game, attacker, target);
  
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
  const weaponDisabledByLakeFrog = Boolean(attacker.frogSpell);
  const terrainCards = game.terrainCards ?? [];
  const activeTerrainWeapons = terrainCards
    .filter((card) => card.ownerId === playerId
      && card.characterId === attacker.id
      && !card.faceDown
      && WEAPON_CARDS[card.cardId])
    .map((card) => card.cardId);
  const faceDownTerrainWeapons = terrainCards
    .filter((card) => card.ownerId === playerId
      && card.characterId === attacker.id
      && card.faceDown
      && WEAPON_CARDS[card.cardId])
    .map((card) => card.cardId);
  const weaponCandidateIds = [...attacker.inventory, ...activeTerrainWeapons]
    .filter((id) => WEAPON_CARDS[id]);
  const roleBlockedWeapon = weaponCandidateIds
    .map((id) => ({ id, ...WEAPON_CARDS[id] }))
    .find((candidate) => candidate.role && candidate.role !== attacker.role);
  if (!weaponDisabledByLakeFrog) {
    for (const id of weaponCandidateIds) {
      const w = WEAPON_CARDS[id];
      if (!w || (w.role && w.role !== attacker.role)) continue;
      if (!weapon || w.damage > weapon.damage) weapon = { id, ...w };
    }
  }
  const weaponDamage = weapon ? weapon.damage : 0;
  const weaponPiercing = weapon ? Boolean(weapon.piercing) : false;
  let weaponSuppressedReason = null;
  let weaponSuppressedName = null;
  let weaponSuppressedRole = null;
  if (!weapon) {
    if (weaponDisabledByLakeFrog && weaponCandidateIds.length > 0) {
      const id = weaponCandidateIds[0];
      weaponSuppressedReason = 'lake_frog';
      weaponSuppressedName = WEAPON_CARDS[id].name;
      weaponSuppressedRole = WEAPON_CARDS[id].role ?? null;
    } else if (roleBlockedWeapon) {
      weaponSuppressedReason = 'wrong_role';
      weaponSuppressedName = roleBlockedWeapon.name;
      weaponSuppressedRole = roleBlockedWeapon.role ?? null;
    } else if (faceDownTerrainWeapons.length > 0) {
      const id = faceDownTerrainWeapons[0];
      weaponSuppressedReason = 'face_down';
      weaponSuppressedName = WEAPON_CARDS[id].name;
      weaponSuppressedRole = WEAPON_CARDS[id].role ?? null;
    }
  }
  const activeClubs = attacker.role === 'V'
    ? terrainCards.filter((card) =>
      card.ownerId === playerId
      && card.characterId === attacker.id
      && card.cardId === 'club'
      && !card.faceDown)
    : [];
  const clubDamage = CLUB_DAMAGE * activeClubs.length;

  // Урон делится на обычный (кубики + Гриффон + непробивающее оружие) и пробивающий
  // («без учёта защиты»). Активная броня цели поглощает только обычную часть.
  const normalDamage = damage + griffinDamage + clubDamage + (weaponPiercing ? 0 : weaponDamage);
  const piercingDamage = weaponPiercing ? weaponDamage : 0;
  const armorAbsorb = activeArmorAbsorb(game, target);

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

  lockMovement(game);
  spendDie(game, dieIndex);
  return {
    attacked: {
      attackerId,
      targetId,
      dieIndex,
      damage,
      griffinDamage,
      griffinTurnedFaceDown: griffinDamage > 0,
      clubDamage,
      clubCount: activeClubs.length,
      weaponDamage,
      weaponName: weapon?.name ?? null,
      weaponPiercing,
      weaponDisabledByLakeFrog,
      weaponSuppressedReason,
      weaponSuppressedName,
      weaponSuppressedRole,
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

function attackDwarf(game, playerId, attacker, unit, dieIndex) {
  const targetCell = unit.position;
  const damage = game.turn.dice[0] + game.turn.dice[1];
  let griffinDamage = 0;

  const terrainCards = game.terrainCards ?? [];
  const placedGriffins = terrainCards.filter((card) =>
    card.ownerId === playerId
    && card.characterId === attacker.id
    && card.cardId === 'griffin'
    && !card.faceDown);
  if (attacker.role === 'O' && placedGriffins.length > 0) {
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

  const weaponDisabledByLakeFrog = Boolean(attacker.frogSpell);
  const activeTerrainWeapons = terrainCards
    .filter((card) => card.ownerId === playerId
      && card.characterId === attacker.id
      && !card.faceDown
      && WEAPON_CARDS[card.cardId])
    .map((card) => card.cardId);
  const faceDownTerrainWeapons = terrainCards
    .filter((card) => card.ownerId === playerId
      && card.characterId === attacker.id
      && card.faceDown
      && WEAPON_CARDS[card.cardId])
    .map((card) => card.cardId);
  const weaponCandidateIds = [...attacker.inventory, ...activeTerrainWeapons]
    .filter((id) => WEAPON_CARDS[id]);
  const roleBlockedWeapon = weaponCandidateIds
    .map((id) => ({ id, ...WEAPON_CARDS[id] }))
    .find((candidate) => candidate.role && candidate.role !== attacker.role);
  let weapon = null;
  if (!weaponDisabledByLakeFrog) {
    for (const id of weaponCandidateIds) {
      const w = WEAPON_CARDS[id];
      if (!w || (w.role && w.role !== attacker.role)) continue;
      if (!weapon || w.damage > weapon.damage) weapon = { id, ...w };
    }
  }
  const weaponDamage = weapon ? weapon.damage : 0;
  const weaponPiercing = weapon ? Boolean(weapon.piercing) : false;
  let weaponSuppressedReason = null;
  let weaponSuppressedName = null;
  let weaponSuppressedRole = null;
  if (!weapon) {
    if (weaponDisabledByLakeFrog && weaponCandidateIds.length > 0) {
      const id = weaponCandidateIds[0];
      weaponSuppressedReason = 'lake_frog';
      weaponSuppressedName = WEAPON_CARDS[id].name;
      weaponSuppressedRole = WEAPON_CARDS[id].role ?? null;
    } else if (roleBlockedWeapon) {
      weaponSuppressedReason = 'wrong_role';
      weaponSuppressedName = roleBlockedWeapon.name;
      weaponSuppressedRole = roleBlockedWeapon.role ?? null;
    } else if (faceDownTerrainWeapons.length > 0) {
      const id = faceDownTerrainWeapons[0];
      weaponSuppressedReason = 'face_down';
      weaponSuppressedName = WEAPON_CARDS[id].name;
      weaponSuppressedRole = WEAPON_CARDS[id].role ?? null;
    }
  }

  const activeClubs = attacker.role === 'V'
    ? terrainCards.filter((card) =>
      card.ownerId === playerId
      && card.characterId === attacker.id
      && card.cardId === 'club'
      && !card.faceDown)
    : [];
  const clubDamage = CLUB_DAMAGE * activeClubs.length;
  const dealtDamage = damage + griffinDamage + clubDamage + weaponDamage;

  unit.hp = Math.max(0, unit.hp - dealtDamage);
  const defeated = unit.hp === 0;
  if (defeated) {
    unit.alive = false;
    unit.position = null;
    unit.routeIndex = -1;
  }

  lockMovement(game);
  spendDie(game, dieIndex);
  return {
    attacked: {
      attackerId: attacker.id,
      targetId: unit.id,
      targetType: 'dwarf',
      targetName: unit.name ?? 'Дварф',
      targetCell,
      dieIndex,
      damage,
      griffinDamage,
      griffinTurnedFaceDown: griffinDamage > 0,
      clubDamage,
      clubCount: activeClubs.length,
      weaponDamage,
      weaponName: weapon?.name ?? null,
      weaponPiercing,
      weaponDisabledByLakeFrog,
      weaponSuppressedReason,
      weaponSuppressedName,
      weaponSuppressedRole,
      totalDamage: dealtDamage,
      armorAbsorbed: 0,
      dealtDamage,
      targetHp: unit.hp,
      defeated,
      lootCount: 0,
      discardedCount: 0,
      traps: [],
      attackerDefeated: false,
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
  const attackerInventory = Array.isArray(attacker.inventory) ? attacker.inventory : [];
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
    if (t.stealCard && attackerInventory.length > 0) {
      stolen = attackerInventory.shift();
      if (defender.inventory.length < INVENTORY_LIMIT) defender.inventory.push(stolen);
      else game.discard.push(stolen); // нет места — карта в сброс
    }
    if (!stolen && Array.isArray(t.stealFromRoles) && attacker.owner) {
      const source = t.stealFromRoles
        .map((role) => game.characters.find((ch) =>
          ch.owner === attacker.owner
          && ch.role === role
          && ch.hp > 0
          && ch.inventory.length > 0))
        .find(Boolean);
      if (source) {
        stolen = source.inventory.shift();
        if (defender.inventory.length < INVENTORY_LIMIT) defender.inventory.push(stolen);
        else game.discard.push(stolen);
      }
    }
    // Порча: при уроне ≥ порога у каждого персонажа нападающего по 1 ингредиенту
    // возвращается в сброс (упрощение «обратно в колоды»).
    let purged = 0;
    if (t.purgeIngredientsMin && incomingDamage >= t.purgeIngredientsMin && attacker.owner) {
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
  game.turn.diceByCharacter = {};
  game.turn.usedDiceByCharacter = {};
  game.turn.activeDiceCharacterId = null;
  game.turn.movementArea = null;
  game.turn.movementAreaByCharacter = {};
  game.turn.mode = null;
  game.turn.modeByCharacter = {};
  game.turn.hasRolled = false;
  game.turn.transferRemaining = 0;
  game.turn.movedCharacterId = null;
  game.turn.drawnThisTurn = false;
  game.turn.drawnCharacterIdsThisTurn = [];

  let rollsReset = false;
  if (playerIds.every((id) => game.turn.rollsLeft[id] <= 0)) {
    for (const id of playerIds) {
      game.turn.rollsLeft[id] = ROLLS_PER_GAME;
    }
    rollsReset = true;
  }

  const shouldAdvanceDwarves = playerIds.length <= 1 || game.turn.activePlayerId === playerIds[0];
  const dwarves = shouldAdvanceDwarves ? advanceDwarves(game) : null;

  return { activePlayerId: game.turn.activePlayerId, over: game.over, rollsReset, dwarves };
}

// --- помощники валидации ---

function advanceDwarves(game) {
  const state = game.dwarves;
  if (!state?.enabled || !state.route?.length) return null;
  state.mainTurnsCompleted = (state.mainTurnsCompleted ?? 0) + 1;

  if (!state.active) {
    if (state.mainTurnsCompleted < (state.entryTurn ?? DWARF_ENTRY_TURN)) return null;
    state.active = true;
  }

  const entries = [];
  const moves = [];
  const attacks = [];

  // Первый выход: дварфы выходят из ворот колонной (route[0..n]). Дальше они
  // растягиваются по тропе сами за счёт задержек на погоне и прохода сквозь своих.
  const anyOnBoard = (state.units ?? []).some((unit) =>
    unit.alive !== false && unit.position);
  if (!anyOnBoard) {
    const occupied = occupiedStopCells(game);
    const waiting = (state.units ?? []).filter((unit) =>
      unit.alive !== false && !unit.position && !unit.exited);
    for (let index = 0; index < waiting.length && index < state.route.length; index += 1) {
      const toCell = state.route[index];
      if (occupied.has(toCell)) break;
      const unit = waiting[index];
      unit.position = toCell;
      unit.routeIndex = index;
      occupied.add(toCell);
      entries.push({ unitId: unit.id, toCell, routeIndex: index });
    }
    state.routeIndex = Math.max(
      -1,
      ...(state.units ?? []).map((unit) => unit.routeIndex ?? -1),
    );
    return {
      type: entries.length ? 'dwarfTurn' : 'wait',
      entries,
      moves,
      routeIndex: state.routeIndex,
      turn: state.mainTurnsCompleted,
    };
  }

  // Юниты, уже стоявшие на поле ДО этого хода, ходят сейчас; вышедший в этот ход
  // ждёт следующего. Лидер впереди (наибольший индекс) ходит первым — освобождает
  // клетку раньше, чем подойдёт следующий, поэтому колонна не застаивается.
  const unitsOnBoard = (state.units ?? [])
    .filter((unit) => unit.alive !== false && unit.position)
    .sort((a, b) => strictDwarfRouteIndex(state, b) - strictDwarfRouteIndex(state, a));

  // 1) Движение: каждый дварф проходит вдоль маршрута на сумму своих кубиков
  //    (можно отклоняться к цели ≤5 клеток), но останавливается, как только дошёл
  //    до цели в дальности атаки — чтобы не пройти мимо. Юниты проходят сквозь друг
  //    друга, но не встают на одну клетку. Разные броски → группа сама растягивается.
  moveDwarfColumn(game, state, unitsOnBoard, moves);

  // 2) Атака с конечной клетки: бьёт ближайшую цель в радиусе.
  for (const unit of unitsOnBoard) {
    if (unit.alive === false || !unit.position) continue;
    const attack = resolveDwarfAttack(game, unit);
    if (attack) attacks.push(attack);
  }

  // 3) Выход из ворот: по одному дварфу за ход, если клетка ворот свободна
  //    (только те, кто ещё не выходил; ушедшие с поля не возвращаются).
  const entryCell = state.route[0];
  const nextUnit = (state.units ?? []).find((unit) =>
    unit.alive !== false && !unit.position && !unit.exited);
  if (nextUnit && !occupiedStopCells(game).has(entryCell)) {
    nextUnit.position = entryCell;
    nextUnit.routeIndex = 0;
    entries.push({ unitId: nextUnit.id, toCell: entryCell, routeIndex: 0 });
  }

  state.routeIndex = Math.max(
    -1,
    ...(state.units ?? []).map((unit) => unit.routeIndex ?? -1),
  );
  if (!entries.length && !moves.length) {
    // Дварфы «закончили», когда все погибли или ушли с поля (прошли весь маршрут).
    const allFinished = (state.units ?? []).every((unit) =>
      unit.alive === false || unit.exited);
    return {
      type: allFinished ? 'finished' : 'wait',
      routeIndex: state.routeIndex,
      turn: state.mainTurnsCompleted,
      attacks,
    };
  }
  return {
    type: 'dwarfTurn',
    entries,
    moves,
    attacks,
    routeIndex: state.routeIndex,
    turn: state.mainTurnsCompleted,
  };
}

// Атака дварфа: бьёт ближайшую цель в радиусе и НЕ тратит шаг по маршруту.
// Возвращает запись об атаке или null, если бить некого.
function resolveDwarfAttack(game, unit) {
  const target = nearestDwarfTarget(game, unit);
  if (!target) return null;

  const attackProfile = DWARF_ATTACK[unit.kind] ?? DWARF_ATTACK.ordinary;
  if (target.distance > attackProfile.range) return null;

  const fromCell = unit.position;
  const targetCell = target.character.position ?? target.cellId;
  const beforeHp = target.character.hp;
  const armorAbsorb = activeArmorAbsorb(game, target.character);
  const afterArmor = Math.max(0, attackProfile.damage - armorAbsorb);
  const trap = resolveDefenderTraps(game, unit, target.character, afterArmor);
  const dealtDamage = trap.incomingDamage;

  target.character.hp = Math.max(0, target.character.hp - dealtDamage);
  const defeated = target.character.hp === 0;
  let discardedCount = 0;
  if (defeated) {
    discardedCount = defeatByDwarf(game, target.character);
  }

  if (trap.attackerSelfDamage > 0) {
    unit.hp = Math.max(0, (unit.hp ?? 100) - trap.attackerSelfDamage);
  }
  if (trap.retreatSteps > 0 && unit.alive !== false && unit.hp > 0) {
    retreatDwarf(game, unit, trap.retreatSteps);
  }
  const attackerDefeated = unit.hp <= 0;
  if (attackerDefeated) {
    unit.alive = false;
    unit.position = null;
    unit.routeIndex = -1;
  }

  return {
    unitId: unit.id,
    unitKind: unit.kind,
    targetId: target.character.id,
    fromCell,
    targetCell,
    distance: target.distance,
    damage: attackProfile.damage,
    totalDamage: attackProfile.damage,
    armorAbsorbed: armorAbsorb,
    dealtDamage,
    hpBefore: beforeHp,
    hpAfter: target.character.hp,
    defeated,
    discardedCount,
    traps: trap.triggered,
    attackerSelfDamage: trap.attackerSelfDamage,
    attackerHp: unit.hp ?? 0,
    attackerDefeated,
  };
}

function retreatDwarf(game, unit, steps) {
  const state = game.dwarves;
  const route = state?.route ?? [];
  if (!route.length || !unit.position || steps <= 0) return;
  const currentIndex = strictDwarfRouteIndex(state, unit);
  if (currentIndex < 0) return;
  const occupied = occupiedStopCells(game, { exceptDwarfId: unit.id });
  const minIndex = Math.max(0, currentIndex - steps);
  for (let index = minIndex; index < currentIndex; index += 1) {
    const cellId = route[index];
    if (!occupied.has(cellId)) {
      unit.position = cellId;
      unit.routeIndex = index;
      return;
    }
  }
}

// Шаг колонны за один ход дварфов. Лидеры (выше по индексу) ходят первыми и
// освобождают клетку до того, как туда шагнёт следующий — поэтому стоящий
// (атакующий или заблокированный) дварф больше не «замораживает» всю цепочку.
// Юниты могут проходить сквозь друг друга, но не могут закончить шаг на клетке,
// где в покое стоит другой юнит (дварф или персонаж).
function moveDwarfColumn(game, state, units, moves) {
  if (!state.route?.length) return;

  // Проход блокируют только ВРАГИ (персонажи). Сквозь своих проходить можно.
  const enemyCells = new Set();
  for (const character of game.characters ?? []) {
    if (character.hp > 0 && character.position) enemyCells.add(character.position);
  }
  // Клетки покоя: на одной клетке не могут стоять два юнита (свои или враги).
  const restingCells = new Set(enemyCells);
  for (const unit of units) restingCells.add(unit.position);

  for (const unit of units) {
    if (strictDwarfRouteIndex(state, unit) < 0) continue;

    const dice = dwarfDiceRoller(unit);
    const allowance = (dice[0] ?? 0) + (dice[1] ?? 0);
    const startCell = unit.position;
    const startIndex = strictDwarfRouteIndex(state, unit);
    restingCells.delete(startCell); // свою клетку освобождаем на время хода

    const lastIndex = state.route.length - 1;

    // 1) Проходим вдоль маршрута до суммы кубиков (свои — проходные, враги — нет),
    //    отклоняясь к цели ≤5; останавливаемся, дойдя до дальности атаки. Дойдя до
    //    конца маршрута (ворота), дварф уходит с поля.
    const path = []; // { cell, routeIndex } по пройденным клеткам
    let routeRecovery = false;
    let exited = false;
    for (let used = 0; used < allowance; used += 1) {
      if ((unit.routeIndex ?? -1) >= lastIndex) { exited = true; break; } // у ворот — уходит
      if (dwarfHasAttackTarget(game, unit)) break;
      const cur = unit.position;
      const curIndex = strictDwarfRouteIndex(state, unit);
      if (curIndex < 0) break;
      const remainingSteps = allowance - used - 1;
      const step = chooseDwarfNextCell(game, state, unit, enemyCells, restingCells, remainingSteps);
      if (!step || step === cur) break; // упёрся во врага/чокпоинт — стоп
      if (state.route[curIndex] !== cur) routeRecovery = true;
      const onRouteIndex = forwardDwarfRouteIndexForCell(state, curIndex, step);
      unit.position = step;
      if (onRouteIndex >= 0) unit.routeIndex = onRouteIndex;
      path.push({ cell: step, routeIndex: unit.routeIndex ?? curIndex });
    }

    // 2a) Дошёл до ворот — уходит с поля: снимаем фишку, больше не возвращается.
    if (exited) {
      const lastCell = path.length ? path[path.length - 1].cell : startCell;
      unit.position = null;
      unit.routeIndex = lastIndex;
      unit.exited = true;
      moves.push({
        unitId: unit.id,
        fromCell: startCell,
        toCell: lastCell,
        path: path.map((p) => p.cell),
        dice,
        steps: path.length,
        exit: true,
        routeIndex: lastIndex,
        ...(routeRecovery ? { routeRecovery: true } : {}),
      });
      continue;
    }

    // 2b) Встаём на самую дальнюю пройденную клетку, свободную в покое (нельзя
    //     закончить ход на клетке другого юнита — но мимо него можно было пройти).
    let restAt = -1;
    for (let i = path.length - 1; i >= 0; i -= 1) {
      if (!restingCells.has(path[i].cell)) { restAt = i; break; }
    }
    if (restAt < 0) {
      // Некуда встать (все пройденные клетки заняты) — остаёмся на старте.
      unit.position = startCell;
      unit.routeIndex = startIndex;
      restingCells.add(startCell);
      continue;
    }
    const rest = path[restAt];
    unit.position = rest.cell;
    unit.routeIndex = rest.routeIndex;
    restingCells.add(rest.cell);

    moves.push({
      unitId: unit.id,
      fromCell: startCell,
      toCell: rest.cell,
      path: path.slice(0, restAt + 1).map((p) => p.cell),
      dice,
      steps: restAt + 1,
      routeIndex: unit.routeIndex ?? startIndex,
      ...(routeRecovery ? { routeRecovery: true } : {}),
    });
  }
}

// Есть ли у дварфа цель прямо сейчас в дальности его атаки.
function dwarfHasAttackTarget(game, unit) {
  const target = nearestDwarfTarget(game, unit);
  if (!target) return false;
  const profile = DWARF_ATTACK[unit.kind] ?? DWARF_ATTACK.ordinary;
  return target.distance <= profile.range;
}

// Куда дварф шагнёт в этот ход. Приоритет: погоня за целью в пределах отклонения
// (≤5 клеток), иначе шаг к ближайшей СВОБОДНОЙ клетке маршрута впереди — с обходом
// препятствий (враг на тропе, остановившийся дварф). Всегда проверяет, что клетка
// назначения свободна в покое (`occupied`).
function chooseDwarfNextCell(game, state, unit, occupied, restingCells = occupied, remainingSteps = 0) {
  const fromCell = unit.position;
  const fromIndex = strictDwarfRouteIndex(state, unit);
  if (fromIndex < 0 || !state.route?.length) return null;

  // Погоня: цель в радиусе агро, но вне дальности атаки — отклоняемся к ней,
  // не дальше DWARF_ROUTE_DEVIATION от маршрута.
  const target = nearestDwarfTarget(game, unit);
  if (target) {
    const profile = DWARF_ATTACK[unit.kind] ?? DWARF_ATTACK.ordinary;
    if (target.distance > profile.range) {
      const chase = chooseDwarfStepToward(game, state, unit, target.character.position);
      if (chase && !occupied.has(chase)) return chase;
    }
  }

  // Цель шага — ближайшая свободная клетка маршрута впереди (пропускаем занятые:
  // врага на тропе, вставшего дварфа). Возврат на тропу после отклонения работает
  // тем же механизмом — цель всё равно ближайшая свободная точка маршрута.
  const goal = nextFreeRouteCell(state, fromIndex, fromCell, restingCells);
  if (!goal || goal.cellId === fromCell) return null;

  // Если клетка маршрута рядом и свободна — шагаем прямо на неё (обычное движение).
  if (neighbors(fromCell).includes(goal.cellId) && !occupied.has(goal.cellId)) {
    return goal.cellId;
  }
  // Иначе обходим препятствие соседней клеткой в сторону цели (в пределах отклонения).
  const stepBlockedCells = remainingSteps > 0 ? occupied : restingCells;
  return stepTowardRouteGoal(game, state, fromIndex, fromCell, goal.cellId, stepBlockedCells);
}

// Ближайшая впереди по маршруту клетка, свободная в покое. Маршрут односторонний
// (без зацикливания): за последней клеткой — выход с поля, поэтому индекс не
// заворачивается. Окно поиска ограничено отклонением.
function nextFreeRouteCell(state, fromIndex, fromCell, occupied) {
  const len = state.route.length;
  const lookahead = DWARF_ROUTE_DEVIATION + 3;
  for (let step = 1; step <= lookahead; step += 1) {
    const index = fromIndex + step;
    if (index >= len) break; // дальше маршрута нет — дварф уйдёт через ворота
    const cellId = state.route[index];
    if (cellId === fromCell) continue;
    if (!occupied.has(cellId)) return { cellId, index };
  }
  return null;
}

// Один свободный шаг-сосед в сторону клетки маршрута, строго сокращающий дистанцию
// и не уходящий дальше DWARF_ROUTE_DEVIATION от тропы. Так колонна обтекает
// препятствия и обгоняет друг друга по соседним клеткам.
function stepTowardRouteGoal(game, state, fromIndex, fromCell, goalCell, occupied) {
  const currentDistance = shortestDistance(fromCell, goalCell);
  const candidates = neighbors(fromCell)
    .filter((cellId) => !occupied.has(cellId))
    .map((cellId) => ({
      cellId,
      goalDistance: shortestDistance(cellId, goalCell),
      routeDistance: forwardDwarfRouteDistance(state, fromIndex, cellId),
    }))
    .filter((candidate) =>
      candidate.goalDistance < currentDistance
      && candidate.routeDistance <= DWARF_ROUTE_DEVIATION)
    .sort((a, b) =>
      a.goalDistance - b.goalDistance
      || a.routeDistance - b.routeDistance
      || a.cellId.localeCompare(b.cellId));
  return candidates[0]?.cellId ?? null;
}

function strictDwarfRouteIndex(state, unit) {
  if (!state.route?.length) return -1;
  if (Number.isInteger(unit.routeIndex)
    && unit.routeIndex >= 0
    && unit.routeIndex < state.route.length) {
    return unit.routeIndex;
  }
  return -1;
}

function nearestDwarfTarget(game, unit) {
  let best = null;
  for (const character of game.characters ?? []) {
    if (character.hp <= 0 || !character.position) continue;
    const distance = shortestDistance(unit.position, character.position);
    if (distance > DWARF_AGGRO_RADIUS) continue;
    if (!best || distance < best.distance || character.hp < best.character.hp) {
      best = { character, cellId: character.position, distance };
    }
  }
  return best;
}

function chooseDwarfStepToward(game, state, unit, targetCell) {
  const fromCell = unit.position;
  const fromIndex = strictDwarfRouteIndex(state, unit);
  if (fromIndex < 0) return null;
  const currentDistance = shortestDistance(fromCell, targetCell);
  const occupied = occupiedStopCells(game, { exceptDwarfId: unit.id });
  const candidates = neighbors(fromCell)
    .filter((cellId) => !occupied.has(cellId))
    .map((cellId) => ({
      cellId,
      targetDistance: shortestDistance(cellId, targetCell),
      routeDistance: forwardDwarfRouteDistance(state, fromIndex, cellId),
    }))
    .filter((candidate) =>
      candidate.targetDistance < currentDistance
      && isForwardDwarfRouteCandidate(state, fromIndex, candidate.cellId)
      && candidate.routeDistance <= DWARF_ROUTE_DEVIATION)
    .sort((a, b) =>
      a.targetDistance - b.targetDistance
      || a.routeDistance - b.routeDistance
      || a.cellId.localeCompare(b.cellId));
  return candidates[0]?.cellId ?? null;
}

function isForwardDwarfRouteCandidate(state, fromIndex, cellId) {
  const directIndex = forwardDwarfRouteIndexForCell(state, fromIndex, cellId);
  if (directIndex >= 0) return true;
  const isRouteCell = (state.route ?? []).includes(cellId);
  if (isRouteCell) return false;
  return true;
}

function forwardDwarfRouteIndexForCell(state, fromIndex, cellId) {
  if (!state.route?.length || fromIndex < 0) return -1;
  for (let step = 0; step <= DWARF_ROUTE_DEVIATION; step += 1) {
    const routeIndex = fromIndex + step;
    if (routeIndex >= state.route.length) break; // маршрут односторонний, без зацикливания
    if (state.route[routeIndex] === cellId) return routeIndex;
  }
  return -1;
}

function forwardDwarfRouteDistance(state, fromIndex, cellId) {
  if (!state.route?.length || fromIndex < 0) return Infinity;
  let best = Infinity;
  for (let step = 0; step <= DWARF_ROUTE_DEVIATION; step += 1) {
    const routeIndex = fromIndex + step;
    if (routeIndex >= state.route.length) break;
    const distance = shortestDistance(cellId, state.route[routeIndex]);
    if (distance < best) best = distance;
    if (best === 0) break;
  }
  return best;
}

function defeatByDwarf(game, target) {
  clearCombat(game, target);
  const discarded = target.inventory.splice(0);
  game.discard.push(...discarded);
  target.position = null;
  target.beastFight = null;
  target.dots = [];
  checkNeutralEliminationVictory(game, target.owner);
  return discarded.length;
}

function checkNeutralEliminationVictory(game, defeatedOwnerId) {
  if (game.over) return;
  if (game.characters.some((character) => character.owner === defeatedOwnerId && character.hp > 0)) return;
  game.over = true;
  game.winnerId = Object.keys(game.turn.rollsLeft)
    .find((id) => id !== defeatedOwnerId) ?? null;
}

function payloadCharacterId(payload = {}) {
  return payload.characterId
    ?? payload.attackerId
    ?? payload.fromId
    ?? null;
}

function bindPayloadDice(game, payload = {}) {
  const characterId = payloadCharacterId(payload);
  if (characterId) bindTurnDice(game, characterId);
}

function bindTurnDice(game, characterId) {
  syncExternalTurnOverrides(game);
  if (!characterId || !game?.turn?.diceByCharacter?.[characterId]) return;
  game.turn.dice = game.turn.diceByCharacter[characterId];
  game.turn.usedDiceByCharacter ??= {};
  game.turn.usedDiceByCharacter[characterId] ??= [false, false];
  game.turn.usedDice = game.turn.usedDiceByCharacter[characterId];
  game.turn.activeDiceCharacterId = characterId;
  // Область движения — тоже на персонажа: bound-вид указывает на запись по персонажу.
  game.turn.movementAreaByCharacter ??= {};
  game.turn.movementArea = game.turn.movementAreaByCharacter[characterId] ?? null;
}

// Записать/снять область движения активного (bound) персонажа: и bound-вид, и
// карту по персонажу. characterId берём из самой области либо из bound-персонажа.
function setMovementArea(game, area, characterId = area?.characterId ?? game.turn.activeDiceCharacterId) {
  game.turn.movementArea = area;
  game.turn.movementAreaByCharacter ??= {};
  if (!characterId) return;
  if (area) game.turn.movementAreaByCharacter[characterId] = area;
  else delete game.turn.movementAreaByCharacter[characterId];
}

// Режим хода конкретного персонажа: его персональный override, иначе глобальный
// дефолт хода, иначе 'moveSum'. Глобальный turn.mode задаётся только setMode без
// characterId (легаси/тесты); в продакшене клиент всегда шлёт characterId.
function modeFor(game, characterId) {
  return game.turn.modeByCharacter?.[characterId]
    ?? game.turn.mode
    ?? 'moveSum';
}

// Персональный режим персонажа (override). mode === null убирает override —
// персонаж возвращается к глобальному дефолту (т.е. к ходу суммой).
function setCharacterMode(game, characterId, mode) {
  if (!characterId) {
    game.turn.mode = mode;
    return;
  }
  game.turn.modeByCharacter ??= {};
  if (mode == null) delete game.turn.modeByCharacter[characterId];
  else game.turn.modeByCharacter[characterId] = mode;
}

function syncExternalTurnOverrides(game) {
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

function hasRolledDice(game) {
  return Boolean(
    game.turn.dice
    || Object.keys(game.turn.diceByCharacter ?? {}).length > 0,
  );
}

function setCurrentUsedDice(game, usedDice) {
  game.turn.usedDice = usedDice;
  const activeId = game.turn.activeDiceCharacterId;
  if (activeId && game.turn.usedDiceByCharacter?.[activeId]) {
    game.turn.usedDiceByCharacter[activeId] = usedDice;
  }
}

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

function requireSplit(game, characterId = game.turn.activeDiceCharacterId) {
  if (modeFor(game, characterId) !== 'split') {
    throw new Error('Передача и добор доступны только в режиме раздельных кубиков (split).');
  }
}

function isDieIndex(dieIndex) {
  return dieIndex === 0 || dieIndex === 1;
}

function dieValue(game, dieIndex) {
  if (!isDieIndex(dieIndex)) {
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

function shouldRequireMoveDieIndex(game, character) {
  const area = game.turn.movementArea?.characterId === character.id
    ? game.turn.movementArea
    : null;
  return Boolean(area?.mode === 'split' || (!area && modeFor(game, character.id) === 'split'));
}

function resolveMoveDieIndex(game, playerId, character, toCell, dieIndex) {
  if (isDieIndex(dieIndex)) return dieIndex;
  if (modeFor(game, character.id) !== 'split') return dieIndex;
  const area = game.turn.movementArea?.characterId === character.id
    ? game.turn.movementArea
    : null;
  const preferred = [
    ...(area?.mode === 'split' && isDieIndex(area.dieIndex) ? [area.dieIndex] : []),
    ...[0, 1]
      .filter((index) => !game.turn.usedDice[index])
      .sort((a, b) => (game.turn.dice[a] ?? 0) - (game.turn.dice[b] ?? 0)),
  ].filter((index, pos, list) => list.indexOf(index) === pos);
  for (const index of preferred) {
    try {
      const targets = availableMoveTargets(game, playerId, character.id, index);
      if (targets.some((target) => target.cellId === toCell)) return index;
    } catch {
      // Если кубик невалиден для текущей ноги, пробуем следующий.
    }
  }
  return dieIndex;
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

// Пассивные эффекты карт на начало хода игрока.
// Ковёр шамана: каждое начало хода восстанавливает Шаману и союзникам рядом +5 HP.
const SHAMAN_CARPET_HEAL = 5;

function applyTurnStartEffects(game, playerId) {
  applyShamanCarpetHeal(game, playerId);
  for (const character of game.characters) {
    if (character.owner !== playerId || character.hp <= 0 || !character.position) continue;
    // Зверь кусает в начале каждого хода владельца, пока его не убили
    // или от него не убежали.
    const beast = character.beastFight ? BEASTS[character.beastFight.cardId] : null;
    if (beast) {
      const armorAbsorb = activeArmorAbsorb(game, character);
      character.hp = Math.max(0, character.hp - Math.max(0, beast.damage - armorAbsorb));
      if (character.hp === 0) {
        releaseLakeFrogSpell(game, character);
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
        releaseLakeFrogSpell(game, character);
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

function applyShamanCarpetHeal(game, playerId) {
  const shamans = game.characters.filter((character) =>
    character.owner === playerId
    && character.role === 'S'
    && character.hp > 0
    && character.position);
  for (const shaman of shamans) {
    const inventoryCarpets = shaman.inventory.filter((cardId) => cardId === 'shaman_carpet').length;
    const placedCarpets = (game.terrainCards ?? []).filter((card) =>
      card.ownerId === playerId
      && card.characterId === shaman.id
      && card.cardId === 'shaman_carpet'
      && !card.faceDown);
    const carpetCount = inventoryCarpets + placedCarpets.length;
    if (carpetCount <= 0) continue;
    const heal = SHAMAN_CARPET_HEAL * carpetCount;
    for (const target of game.characters) {
      if (target.owner !== playerId || target.hp <= 0 || !target.position) continue;
      const inAura = target.id === shaman.id || neighbors(shaman.position).includes(target.position);
      if (inAura) target.hp += heal;
    }
    for (const card of placedCarpets) card.faceDown = true;
  }
}

function activeArmorAbsorb(game, character) {
  return (game.terrainCards ?? [])
    .filter((card) => card.ownerId === character.owner
      && card.characterId === character.id
      && !card.faceDown
      && ARMOR_CARDS[card.cardId])
    .reduce((sum, card) => sum + ARMOR_CARDS[card.cardId].absorb, 0);
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

// Связывает пару в бой. Несколько персонажей могут бить одного противника: при
// новом захвате снимаем прежние (возможно, односторонние) связи обеих сторон,
// чтобы не оставалось «висячих» ссылок — иначе прежний нападающий считается
// застрявшим в бою и не может атаковать/двигаться (и на клиенте, и на сервере).
function linkCombat(game, first, second) {
  clearCombat(game, first);
  clearCombat(game, second);
  first.combatOpponentId = second.id;
  second.combatOpponentId = first.id;
}

// Гибель персонажа от руки игрока: победитель забирает добычу до лимита
// инвентаря, излишек — в сброс; гибель последнего персонажа — победа.
function defeatByPlayer(game, target, looter) {
  clearCombat(game, target);
  releaseLakeFrogSpell(game, target);
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
    setCharacterMode(game, game.turn.activeDiceCharacterId, null);
  }
}

function firstFreeDieIndex(game) {
  if (!game.turn.dice) return -1;
  if (!game.turn.usedDice[0]) return 0;
  if (!game.turn.usedDice[1]) return 1;
  return -1;
}

function spendAllDice(game) {
  setCurrentUsedDice(game, [true, true]);
  setMovementArea(game, null);
  setCharacterMode(game, game.turn.activeDiceCharacterId, null);
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
const DRAW_DECK_ALIASES = Object.freeze({
  forest_trail: 'forest',
});

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
