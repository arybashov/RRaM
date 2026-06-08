import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply } from '../src/rules.js';
import { rankBotActions, runBotTurn } from '../src/bot.js';

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
}

function botCharacter(game, role = 'V') {
  return game.characters.find(
    (character) => character.owner === 'bot' && character.role === role,
  );
}

test('bot ranks movement and draw actions on the server map', () => {
  const game = freshGame();
  prepareBotTurn(game);

  const ranked = rankBotActions(game, 'bot', 0);

  assert.ok(ranked.length > 0);
  assert.ok(ranked.some((action) => action.type === 'action:draw'));
  assert.ok(ranked.some((action) => action.type === 'action:move'));
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

test('bot can finish a full race to the enemy island', async () => {
  const game = freshGame();
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

  assert.equal(game.over, true);
  assert.equal(game.winnerId, 'bot');
});
