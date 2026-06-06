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
  BASE_CARDS,
} from './constants.js';

const MAP_PENDING =
  'Карта еще не подключена — движение и телепорт появятся после загрузки карты.';

export function createGame(players) {
  const characters = [];
  for (const player of players) {
    for (const role of ROLES) {
      characters.push({
        id: `${player.id}:${role}`,
        owner: player.id,
        role,
        position: null, // появится вместе с картой
        hp: CHARACTER_HP,
        inventory: [...(BASE_CARDS[role] ?? [])],
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
    characters,
    deck: buildDeck(),
    discard: [],
    turn: {
      activePlayerId: players[0].id,
      rollsLeft,
      dice: null,
      usedDice: [false, false],
      mode: null, // 'moveSum' | 'split'
    },
  };
}

export function apply(game, playerId, type, payload = {}) {
  switch (type) {
    case 'turn:roll':
      return roll(game, playerId);
    case 'turn:setMode':
      return setMode(game, playerId, payload);
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
    default:
      throw new Error(`Команда недоступна в игре: ${type}`);
  }
}

function roll(game, playerId) {
  assertActive(game, playerId);
  if (game.turn.dice) {
    throw new Error('Кубики уже брошены — потратьте их или завершите ход.');
  }
  if (game.turn.rollsLeft[playerId] <= 0) {
    throw new Error('Броски закончились — завершите ход.');
  }

  const dice = [rollDie(), rollDie()];
  game.turn.dice = dice;
  game.turn.usedDice = [false, false];
  game.turn.mode = null;
  game.turn.rollsLeft[playerId] -= 1;

  return {
    roll: { dice, total: dice[0] + dice[1], rollsLeft: game.turn.rollsLeft[playerId] },
  };
}

function setMode(game, playerId, { mode } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  if (game.turn.usedDice[0] || game.turn.usedDice[1]) {
    throw new Error('Режим нельзя менять после траты кубика.');
  }
  if (mode !== 'moveSum' && mode !== 'split') {
    throw new Error('Режим должен быть moveSum или split.');
  }
  game.turn.mode = mode;
  return { mode };
}

function draw(game, playerId, { characterId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  dieValue(game, dieIndex); // только валидируем доступность; значение на добор не влияет

  const character = ownCharacter(game, playerId, characterId);
  if (game.deck.length === 0) {
    throw new Error('Колода пуста.');
  }
  if (character.inventory.length >= INVENTORY_LIMIT) {
    throw new Error('Инвентарь персонажа полон.');
  }

  const card = game.deck.shift();
  character.inventory.push(card);
  spendDie(game, dieIndex);

  return { drawn: { characterId, card } };
}

function transfer(game, playerId, { fromId, toId, dieIndex } = {}) {
  assertActive(game, playerId);
  assertRolled(game);
  requireSplit(game);
  if (fromId === toId) {
    throw new Error('Нужны два разных персонажа.');
  }

  const limit = dieValue(game, dieIndex);
  const from = ownCharacter(game, playerId, fromId);
  const to = ownCharacter(game, playerId, toId);

  // TODO(map): после загрузки карты требовать одну борду — from.position === to.position.
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
  spendDie(game, dieIndex);

  return { transferred: { fromId, toId, count } };
}

function move(game, playerId) {
  assertActive(game, playerId);
  assertRolled(game);
  throw new Error(MAP_PENDING);
}

function teleport(game, playerId) {
  assertActive(game, playerId);
  assertRolled(game);
  throw new Error(MAP_PENDING);
}

function endTurn(game, playerId) {
  assertActive(game, playerId);

  const playerIds = Object.keys(game.turn.rollsLeft);
  const other = playerIds.find((id) => id !== playerId);
  game.turn.activePlayerId = other ?? playerId;
  game.turn.dice = null;
  game.turn.usedDice = [false, false];
  game.turn.mode = null;

  // Победа по гонке на остров противника появится с картой.
  // Пока партия просто завершается, когда у обоих кончились броски.
  if (playerIds.every((id) => game.turn.rollsLeft[id] <= 0)) {
    game.over = true;
  }

  return { activePlayerId: game.turn.activePlayerId, over: game.over };
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
  return character;
}

function spendDie(game, dieIndex) {
  game.turn.usedDice[dieIndex] = true;
  if (game.turn.usedDice[0] && game.turn.usedDice[1]) {
    game.turn.dice = null;
    game.turn.usedDice = [false, false];
    game.turn.mode = null;
  }
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

// Строит общую игровую колоду из смешанного грунта и леса.
// Рецепты, чертежи, колода барана, красная и сказочная опушка — отдельные стеки (TODO).
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

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
