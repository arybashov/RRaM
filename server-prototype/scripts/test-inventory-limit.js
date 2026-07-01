import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  apply,
} from '../src/rules.js';
import { neighbors } from '../src/map.js';

function makePlayers() {
  return [
    { id: 'p1', seatIndex: 0, side: 'green', name: 'Alice' },
    { id: 'p2', seatIndex: 1, side: 'red', name: 'Bob' },
  ];
}

function freshGame() {
  return createGame(makePlayers());
}

function fillInventory(character, count, prefix = 'filler') {
  character.inventory = Array.from({ length: count }, (_, index) => `${prefix}_${index}`);
  character.inventorySources = character.inventory.map(() => ({ sourceDeck: 'test', sourceBack: 'test' }));
}

function placeTerrainCard(game, character, id = 'terrain-limit-card') {
  game.terrainCards.push({
    id,
    ownerId: character.owner,
    characterId: character.id,
    cardId: 'bark',
    faceDown: false,
    source: { sourceDeck: 'test', sourceBack: 'test' },
  });
}

test('inventory limit counts cards placed on terrain when drawing', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.position = 'H014';
  fillInventory(warrior, 9);
  placeTerrainCard(g, warrior);
  g.decks.forest_trail = ['bark'];
  g.turn.activePlayerId = 'p1';
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: warrior.id, dieIndex: 0 }),
    /Инвентарь персонажа полон|Ð˜Ð½Ð²ÐµÐ½Ñ‚Ð°Ñ€ÑŒ Ð¿ÐµÑ€ÑÐ¾Ð½Ð°Ð¶Ð° Ð¿Ð¾Ð»Ð¾Ð½/i,
  );
});

test('inventory limit counts receiver terrain cards when transferring', () => {
  const g = freshGame();
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const to = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  from.position = 'H014';
  to.position = neighbors(from.position)[0];
  fillInventory(from, 1, 'from');
  fillInventory(to, 9, 'to');
  placeTerrainCard(g, to, 'receiver-terrain-limit-card');
  g.turn.activePlayerId = 'p1';
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 0, dieIndex: 0 }),
    /нет места|Ð½ÐµÑ‚ Ð¼ÐµÑÑ‚Ð°/i,
  );
});

test('placing a card on terrain does not free an extra inventory slot', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.position = 'H014';
  fillInventory(warrior, 10);
  warrior.inventory[0] = 'bark';
  warrior.inventorySources[0] = { sourceDeck: 'forest_trail', sourceBack: 'forest_trail' };
  g.turn.activePlayerId = 'p1';
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  apply(g, 'p1', 'action:terrainPlace', {
    id: 'placed-from-full-inventory',
    characterId: warrior.id,
    cardIndex: 0,
    x: 10,
    y: 10,
  });
  g.decks.forest_trail = ['bark'];

  assert.equal(warrior.inventory.length, 9);
  assert.equal(g.terrainCards.length, 1);
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: warrior.id, dieIndex: 0 }),
    /Инвентарь персонажа полон|Ð˜Ð½Ð²ÐµÐ½Ñ‚Ð°Ñ€ÑŒ Ð¿ÐµÑ€ÑÐ¾Ð½Ð°Ð¶Ð° Ð¿Ð¾Ð»Ð¾Ð½/i,
  );
});
