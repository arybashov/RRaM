import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply } from '../src/rules.js';
import { rankBotActions, runBotTurn } from '../src/bot.js';
import {
  blacksmithStoneCells,
  blacksmithStoneSide,
  cellDeck,
  deckCells,
  neighbors,
  shortestDistance,
} from '../src/map.js';

function freshGame() {
  return createGame([
    { id: 'p1' },
    { id: 'bot' },
  ]);
}

function prepareBotTurn(game, dice = [3, 4]) {
  game.turn.activePlayerId = 'bot';
  game.turn.dice = dice;
  game.turn.usedDice = [false, false];
  game.turn.mode = 'split';
  game.turn.hasRolled = true;
  game.turn.rollStartPositions = Object.fromEntries(
    game.characters.map((character) => [character.id, character.position ?? null]),
  );
}

function botCharacter(game, role = 'V') {
  return game.characters.find(
    (character) => character.owner === 'bot' && character.role === role,
  );
}

function fairyGladeCell() {
  return deckCells().find((id) => cellDeck(id) === 'fairy_glade');
}

function stoneForSide(side) {
  return blacksmithStoneCells().find((id) => blacksmithStoneSide(id) === side);
}

test('bot ranks movement and draw actions on the server map', () => {
  const game = freshGame();
  prepareBotTurn(game);

  const ranked = rankBotActions(game, 'bot', 0);

  assert.ok(ranked.length > 0);
  assert.ok(ranked.some((action) => action.type === 'action:draw'));
  assert.ok(ranked.some((action) => action.type === 'action:move'));
});

test('bot prioritizes the phoenix glade before carrying a feather', () => {
  const game = freshGame();
  prepareBotTurn(game, [6, 6]);
  const fairy = fairyGladeCell();

  const ranked = rankBotActions(game, 'bot', 0);
  const move = ranked.find((action) => action.type === 'action:move');
  const character = game.characters.find((item) => item.id === move.payload.characterId);

  assert.ok(move);
  assert.match(move.reason, /move:phoenix:/);
  assert.ok(shortestDistance(move.payload.toCell, fairy) < shortestDistance(character.position, fairy));
});

test('bot carrying own feather moves to its blacksmith stone and wins', () => {
  const game = freshGame();
  const warrior = botCharacter(game, 'V');
  const ownStone = stoneForSide(warrior.side);
  warrior.inventory.push('gold_feather_own');
  prepareBotTurn(game, [3, 1]);

  const move = rankBotActions(game, 'bot', 0).find((action) => action.type === 'action:move');

  assert.equal(move.payload.characterId, warrior.id);
  assert.equal(move.payload.toCell, ownStone);
  assert.match(move.reason, /move:feather:/);

  const result = apply(game, 'bot', move.type, move.payload);
  assert.equal(game.over, true);
  assert.equal(game.winnerId, 'bot');
  assert.equal(result.featherVictory.cardId, 'gold_feather_own');
  assert.equal(result.featherVictory.cellId, ownStone);
});

test('bot carrying enemy feather moves to the enemy blacksmith stone and wins', () => {
  const game = freshGame();
  const warrior = botCharacter(game, 'V');
  const enemyStone = stoneForSide('green');
  warrior.position = 'H001';
  warrior.inventory.push('gold_feather_enemy');
  prepareBotTurn(game, [1, 1]);

  const move = rankBotActions(game, 'bot', 0).find((action) => action.type === 'action:move');

  assert.equal(move.payload.characterId, warrior.id);
  assert.equal(move.payload.toCell, enemyStone);
  assert.match(move.reason, /move:feather:/);

  const result = apply(game, 'bot', move.type, move.payload);
  assert.equal(game.over, true);
  assert.equal(game.winnerId, 'bot');
  assert.equal(result.featherVictory.cardId, 'gold_feather_enemy');
  assert.equal(result.featherVictory.cellId, enemyStone);
});

test('bot prefers a character with more free inventory space', () => {
  const game = freshGame();
  prepareBotTurn(game);
  const characters = game.characters.filter((character) => character.owner === 'bot');
  for (const character of characters) {
    while (character.inventory.length < 8) character.inventory.push('card');
  }
  const shaman = botCharacter(game, 'S');
  shaman.inventory.length = 1;

  const ranked = rankBotActions(game, 'bot', 1);

  const bestDraw = ranked.find((action) => action.type === 'action:draw');
  assert.equal(bestDraw.payload.characterId, shaman.id);
});

test('bot does not draw into a full inventory', () => {
  const game = freshGame();
  prepareBotTurn(game);
  const warrior = botCharacter(game);
  while (warrior.inventory.length < 10) warrior.inventory.push('card');

  const ranked = rankBotActions(game, 'bot', 0);

  assert.ok(!ranked.some(
    (action) =>
      action.type === 'action:draw'
      && action.payload.characterId === warrior.id,
  ));
});

test('bot balances inventories by transfer when the deck is empty', () => {
  const game = freshGame();
  prepareBotTurn(game, [5, 2]);
  delete game.mapId;
  game.deck = [];
  const characters = game.characters.filter((character) => character.owner === 'bot');
  const from = botCharacter(game, 'K');
  const to = botCharacter(game, 'S');
  to.position = neighbors(from.position)[0]; // получатель рядом — на соседней клетке
  for (const character of characters) {
    while (character.inventory.length < 5) character.inventory.push('card');
  }
  while (from.inventory.length < 9) from.inventory.push('card');
  to.inventory.length = 1;

  const ranked = rankBotActions(game, 'bot', 0);

  assert.equal(ranked[0].type, 'action:transfer');
  assert.equal(ranked[0].payload.fromId, from.id);
  assert.equal(ranked[0].payload.toId, to.id);
});

test('bot creates movement candidates that advance along cell neighbors', () => {
  const game = freshGame();
  prepareBotTurn(game, [2, 4]);
  delete game.mapId;
  botCharacter(game).position = 'a';
  game.map = {
    cells: [
      { id: 'a', neighbors: ['b'] },
      { id: 'b', neighbors: ['a', 'c'] },
      { id: 'c', neighbors: ['b', 'd'] },
      { id: 'd', neighbors: ['c'] },
    ],
  };
  game.botGoals = [{ playerId: 'bot', targetCell: 'd', priority: 2 }];

  const moves = rankBotActions(game, 'bot', 0)
    .filter((action) => action.type === 'action:move');

  assert.ok(moves.length > 0);
  assert.deepEqual(moves[0].payload, {
    characterId: botCharacter(game).id,
    toCell: 'c',
    dieIndex: 0,
  });
  assert.match(moves[0].reason, /move:d:progress=2:left=1/);
});

test('bot can use q/r coordinates when neighbor lists are absent', () => {
  const game = freshGame();
  prepareBotTurn(game, [1, 4]);
  delete game.mapId;
  botCharacter(game, 'O').position = { cellId: '0:0' };
  const state = {
    ...game,
    cells: [
      { id: '0:0', q: 0, r: 0 },
      { id: '1:0', q: 1, r: 0 },
      { id: '2:0', q: 2, r: 0 },
    ],
    objectives: [{ owner: 'bot', boardCellId: '2:0' }],
  };

  const move = rankBotActions(game, 'bot', 0, { state })
    .find((action) => action.type === 'action:move');

  assert.deepEqual(move.payload, {
    characterId: botCharacter(game, 'O').id,
    toCell: '1:0',
    dieIndex: 0,
  });
});

test('high-priority target movement can outrank drawing', () => {
  const game = freshGame();
  prepareBotTurn(game, [1, 4]);
  delete game.mapId;
  botCharacter(game).position = 'start';
  game.board = {
    cells: [
      { id: 'start', neighbors: ['goal'] },
      { id: 'goal', neighbors: ['start'] },
    ],
  };
  game.goals = [{ ownerPlayerId: 'bot', toCell: 'goal', priority: 3 }];

  const ranked = rankBotActions(game, 'bot', 0);

  assert.equal(ranked[0].type, 'action:move');
  assert.equal(ranked[0].payload.toCell, 'goal');
});

test('custom goals can extend action scoring', () => {
  const game = freshGame();
  prepareBotTurn(game);
  delete game.mapId;
  const goals = [{
    evaluate(action) {
      if (action.type !== 'action:draw') return null;
      return {
        score: action.payload.characterId.endsWith(':P') ? 10 : 0,
        reason: 'custom-draw',
      };
    },
  }];

  const ranked = rankBotActions(game, 'bot', 0, { goals });

  assert.equal(ranked[0].payload.characterId, botCharacter(game, 'P').id);
  assert.equal(ranked[0].reason, 'custom-draw');
});

test('bot ignores invalid targets and blocked cells', () => {
  const game = freshGame();
  prepareBotTurn(game);
  delete game.mapId;
  botCharacter(game).position = 'a';
  game.cells = [
    { id: 'a', neighbors: ['blocked'] },
    { id: 'blocked', neighbors: ['a', 'goal'], terrainType: 'blocked' },
    { id: 'goal', neighbors: ['blocked'] },
  ];
  game.targetCells = ['goal', 'missing'];

  const ranked = rankBotActions(game, 'bot', 0);

  assert.ok(!ranked.some((action) => action.type === 'action:move'));
});

test('bot returns no action for a spent die', () => {
  const game = freshGame();
  prepareBotTurn(game);
  game.turn.usedDice[0] = true;

  assert.deepEqual(rankBotActions(game, 'bot', 0), []);
});

test('bot attacks an adjacent enemy before moving', () => {
  const game = freshGame();
  prepareBotTurn(game, [3, 4]);
  const attacker = botCharacter(game);
  const target = game.characters.find(
    (character) => character.owner === 'p1' && character.role === 'V',
  );
  target.position = neighbors(attacker.position)[0];

  const ranked = rankBotActions(game, 'bot', 0);

  assert.equal(ranked[0].type, 'action:attack');
  assert.deepEqual(ranked[0].payload, {
    attackerId: attacker.id,
    targetId: target.id,
  });
  assert.match(ranked[0].reason, /damage=7/);
});

test('bot охотится: есть ход к вражеской фишке', () => {
  const game = freshGame();
  prepareBotTurn(game, [3, 4]);

  const moves = rankBotActions(game, 'bot', 0)
    .filter((action) => action.type === 'action:move');
  assert.ok(moves.some((action) => /move:hunt:/.test(action.reason)),
    'бот должен генерировать ходы-охоту к вражеским фишкам');
});

test('bot наваливается: несколько фишек могут атаковать одного врага', () => {
  const game = freshGame();
  prepareBotTurn(game, [3, 4]);

  const enemy = game.characters.find((c) => c.owner === 'p1' && c.role === 'K');
  enemy.position = 'H100';
  const free = neighbors('H100').filter(
    (cell) => !game.characters.some((c) => c.position === cell));
  assert.ok(free.length >= 2);
  const botChars = game.characters.filter((c) => c.owner === 'bot' && c.hp > 0);
  botChars[0].position = free[0];
  botChars[1].position = free[1];

  const onEnemy = rankBotActions(game, 'bot', 0)
    .filter((a) => a.type === 'action:attack' && a.payload.targetId === enemy.id);
  assert.ok(onEnemy.length >= 2,
    'оба соседних персонажа должны мочь навалиться на одного врага');
});

test('bot emits action:result for its attack', async () => {
  const game = freshGame();
  game.turn.activePlayerId = 'bot';
  const attacker = botCharacter(game);
  const target = game.characters.find(
    (character) => character.owner === 'p1' && character.role === 'V',
  );
  target.position = neighbors(attacker.position)[0];

  const room = { id: 'room', game };
  const results = [];
  await runBotTurn({
    applyCommand: ({ playerId, type, payload }) => apply(game, playerId, type, payload),
    getRoom: () => room,
    broadcast: () => {},
    emitActionResult: (_roomId, result) => results.push(result),
    roomId: room.id,
    botPlayerId: 'bot',
    wait: async () => {},
  });

  const attackResult = results.find((result) => result?.attacked);
  assert.ok(attackResult);
  assert.equal(attackResult.attacked.attackerId, attacker.id);
  assert.equal(attackResult.attacked.targetId, target.id);
});

test('bot advances toward the enemy island without a false map victory', async () => {
  const game = freshGame();
  const initialPositions = new Map(
    game.characters
      .filter((character) => character.owner === 'bot')
      .map((character) => [character.id, character.position]),
  );
  const room = { id: 'room', game };
  const applyCommand = ({ playerId, type, payload }) =>
    apply(game, playerId, type, payload);

  for (let turn = 0; turn < 10 && !game.over; turn += 1) {
    if (game.turn.activePlayerId === 'p1') {
      apply(game, 'p1', 'turn:end');
    }
    await runBotTurn({
      applyCommand,
      getRoom: () => room,
      broadcast: () => {},
      roomId: room.id,
      botPlayerId: 'bot',
      wait: async () => {},
    });
  }

  assert.ok(game.characters.some(
    (character) =>
      character.owner === 'bot'
      && character.position !== initialPositions.get(character.id),
  ));
  assert.equal(game.over, false);
  assert.equal(game.winnerId, null);
});

test('бот находит действия даже когда один из его персонажей убит', () => {
  const game = freshGame();
  // Убиваем одного персонажа бота: hp=0, position=null, inventory пуст
  const killed = botCharacter(game, 'V');
  killed.hp = 0;
  killed.position = null;
  killed.inventory = [];
  prepareBotTurn(game, [3, 4]);
  // Не должно бросать и должен быть хотя бы один кандидат — иначе бот зависает
  const ranked = rankBotActions(game, 'bot', 0);
  assert.ok(ranked.length > 0, 'у бота должны быть кандидаты после потери персонажа');
  // ни одна payload не должна ссылаться на убитого
  const usesDead = ranked.some(a =>
    a.payload?.characterId === killed.id
    || a.payload?.attackerId === killed.id
    || a.payload?.fromId === killed.id
    || a.payload?.toId === killed.id);
  assert.equal(usesDead, false, 'бот не должен пытаться действовать убитым персонажем');
});

test('бот ходит за все 4 кубика подряд после потери персонажа (без зависания)', () => {
  const game = freshGame();
  const killed = botCharacter(game, 'V');
  killed.hp = 0; killed.position = null; killed.inventory = [];
  prepareBotTurn(game, [4, 3]);
  // Каждый ранк не пустой для обоих кубиков
  assert.ok(rankBotActions(game, 'bot', 0).length > 0);
  assert.ok(rankBotActions(game, 'bot', 1).length > 0);
});
