import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply } from '../src/rules.js';
import { cellDeck, deckCells, terrainCells } from '../src/map.js';

function makePlayers() {
  return [
    { id: 'p1', seatIndex: 0, side: 'green', name: 'Alice' },
    { id: 'p2', seatIndex: 1, side: 'red', name: 'Bob' },
  ];
}

function freshGame() {
  return createGame(makePlayers());
}

const uniqueTopCard = Object.freeze({
  mixed: 'ore_coarse',
  forest_trail: 'bark',
  forest: 'shaman_cauldron',
  dark_forest: 'ore_medium',
  sheep: 'sheep_ram',
  lake: 'raw_ruby',
  blueprints: 'chainmail_light',
});

test('draw cells with explicit deck draw only from that deck', () => {
  const drawCells = [...new Set([
    ...terrainCells('resource').filter(cellId => cellDeck(cellId) && !['recipes', 'fairy_glade'].includes(cellDeck(cellId))),
    ...deckCells().filter(cellId => !['recipes', 'fairy_glade'].includes(cellDeck(cellId))),
  ])].sort();

  assert.ok(drawCells.length > 0);
  for (const cellId of drawCells) {
    const expectedDeck = cellDeck(cellId);
    const g = freshGame();
    const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
    char.position = cellId;
    g.deck = [uniqueTopCard.mixed];
    for (const [deck, cardId] of Object.entries(uniqueTopCard)) {
      if (deck !== 'mixed') g.decks[deck] = [cardId];
    }
    g.turn.dice = [3, 4];
    g.turn.mode = 'split';
    g.turn.hasRolled = true;

    const result = apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });

    assert.equal(result.drawn.deck, expectedDeck, cellId);
    assert.equal(result.drawn.card, uniqueTopCard[expectedDeck], cellId);
  }
});

test('resource cells without explicit deck do not fall back to mixed deck', () => {
  const noDeckResourceCells = terrainCells('resource')
    .filter(cellId => !cellDeck(cellId))
    .sort();

  assert.deepEqual(noDeckResourceCells, ['H001', 'H060', 'H082', 'H162', 'H184']);
  for (const cellId of noDeckResourceCells) {
    const g = freshGame();
    const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
    char.position = cellId;
    g.deck = ['ore_coarse'];
    g.turn.dice = [3, 4];
    g.turn.mode = 'split';
    g.turn.hasRolled = true;

    assert.throws(
      () => apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 }),
      /точке ресурса|колода добора|resource/i,
      cellId,
    );
    assert.deepEqual(g.deck, ['ore_coarse']);
  }
});
