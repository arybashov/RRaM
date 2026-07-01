import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  apply,
  __setDwarfDiceRoller,
} from '../src/rules.js';
import { neighbors, dwarfRoute } from '../src/map.js';

function makePlayers() {
  return [
    { id: 'p1', seatIndex: 0, side: 'green', name: 'Alice' },
    { id: 'p2', seatIndex: 1, side: 'red', name: 'Bob' },
  ];
}

function freshGame() {
  return createGame(makePlayers());
}

function prepareAdjacentCombat(game, dice = [3, 4]) {
  const attacker = game.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = game.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(attacker.position)[0];
  game.turn.dice = [...dice];
  game.turn.mode = 'moveSum';
  game.turn.hasRolled = true;
  return { attacker, target };
}

function placeCauldron(game, character, id = 'cauldron-test') {
  game.terrainCards.push({
    id,
    ownerId: character.owner,
    characterId: character.id,
    cardId: 'shaman_cauldron',
    faceDown: false,
    source: { sourceDeck: 'forest', sourceBack: 'forest' },
  });
}

test('shaman cauldron blocks player attack below 8', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g, [3, 4]);
  placeCauldron(g, target, 'cauldron-player-low');

  const result = apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(result.shamanCauldronBlocked.success, false);
  assert.equal(result.shamanCauldronBlocked.rollTotal, 7);
  assert.equal(target.hp, 100);
  assert.equal(g.terrainCards.length, 1);
  assert.equal(g.discard.includes('shaman_cauldron'), false);
  assert.equal(attacker.combatOpponentId, null);
  assert.equal(target.combatOpponentId, null);
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('shaman cauldron is removed on player attack total 8+', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g, [4, 4]);
  placeCauldron(g, target, 'cauldron-player-high');

  const result = apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(result.shamanCauldronBlocked.success, true);
  assert.equal(result.shamanCauldronBlocked.rollTotal, 8);
  assert.equal(target.hp, 100);
  assert.equal(g.terrainCards.length, 0);
  assert.ok(g.discard.includes('shaman_cauldron'));
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('shaman cauldron blocks dwarf attack and is removed on total 8+', () => {
  const g = freshGame();
  const route = dwarfRoute();
  const victim = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  for (const character of g.characters) character.position = null;
  g.dwarves.entryTurn = 0;
  g.dwarves.active = true;
  g.dwarves.mainTurnsCompleted = 1;
  g.dwarves.units.forEach((dwarf) => {
    dwarf.position = null;
    dwarf.routeIndex = -1;
    dwarf.alive = true;
    dwarf.exited = false;
  });
  const unit = g.dwarves.units[0];
  unit.position = route[0];
  unit.routeIndex = 0;
  unit.hp = 100;
  victim.position = neighbors(route[0])[0];
  victim.hp = 100;
  placeCauldron(g, victim, 'cauldron-dwarf-high');
  __setDwarfDiceRoller(() => [4, 4]);

  apply(g, 'p1', 'turn:end');
  const result = apply(g, 'p2', 'turn:end');
  const attack = result.dwarves.attacks.find(item => item.targetId === victim.id);

  assert.ok(attack);
  assert.equal(attack.shamanCauldron.success, true);
  assert.equal(attack.shamanCauldron.rollTotal, 8);
  assert.equal(attack.dealtDamage, 0);
  assert.equal(victim.hp, 100);
  assert.equal(g.terrainCards.length, 0);
  assert.ok(g.discard.includes('shaman_cauldron'));
  __setDwarfDiceRoller();
});
