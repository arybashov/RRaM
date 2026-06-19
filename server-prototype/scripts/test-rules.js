// Юнит-тесты движка правил (rules.js).
// Без сети, без DOM — только чистая логика.
// Запуск: node --test scripts/test-rules.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  apply,
  availableAttackTargets,
  availableMoveTargets,
} from '../src/rules.js';
import { neighbors, startCell, shortestDistance, cellTerrain, cellDeck, pointClassCells, terrainCells, deckCells, blacksmithStoneCells, blacksmithStoneSide } from '../src/map.js';
import { snapshotGame } from '../src/game-state.js';

// ── Хелперы ──────────────────────────────────────────────────────

function makePlayers() {
  return [
    { id: 'p1', seatIndex: 0, side: 'green', name: 'Алиса' },
    { id: 'p2', seatIndex: 1, side: 'red',   name: 'Боб'   },
  ];
}

function freshGame() {
  return createGame(makePlayers());
}

function placeOnResource(character) {
  character.position = 'H002';
}

function blacksmithStoneForSide(side) {
  return blacksmithStoneCells().find((cellId) => blacksmithStoneSide(cellId) === side);
}

// Бросает кубики и переводит в режим split
function rollAndSplit(game, pid) {
  apply(game, pid, 'turn:roll');
  apply(game, pid, 'turn:setMode', { mode: 'split' });
}

// ── Создание игры ─────────────────────────────────────────────────

test('createGame — 10 персонажей (5 + 5)', () => {
  const g = freshGame();
  assert.equal(g.characters.length, 10);
});

test('createGame — у каждого игрока по 5 персонажей', () => {
  const g = freshGame();
  assert.equal(g.characters.filter(c => c.owner === 'p1').length, 5);
  assert.equal(g.characters.filter(c => c.owner === 'p2').length, 5);
});

test('createGame — каждый персонаж имеет 100 HP', () => {
  const g = freshGame();
  assert.ok(g.characters.every(c => c.hp === 100));
});

test('createGame — у кузнеца есть базовые карты', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  assert.ok(smith.inventory.includes('teleport_beads'));
  assert.ok(smith.inventory.includes('ore_medium'));
});

test('createGame — у шамана есть Баран, но нет шкур барана', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  assert.ok(shaman.inventory.includes('sheep_ram'));
  assert.ok(!shaman.inventory.includes('yarn'));
  assert.ok(shaman.inventory.includes('recipe_shaman_carpet'));
  assert.ok(!shaman.inventory.includes('sheep_hide_r'));
  assert.ok(!shaman.inventory.includes('sheep_hide_c'));
});

test('createGame — у помощника есть рецепт Мешка и Баран, но нет Клубка и шкуры', () => {
  const g = freshGame();
  const helper = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  assert.ok(helper.inventory.includes('recipe_sack'));
  assert.ok(!helper.inventory.includes('yarn'));
  assert.ok(helper.inventory.includes('sheep_ram'));
  assert.ok(!helper.inventory.includes('sheep_hide_r'));
  assert.ok(!helper.inventory.includes('sheep_hide_c'));
  assert.ok(!helper.inventory.includes('sack'));
});

test('createGame — точные стартовые наборы базовых карт', () => {
  const g = freshGame();
  const inventory = (role) => g.characters
    .find(c => c.owner === 'p1' && c.role === role)
    .inventory
    .slice()
    .sort();

  assert.deepEqual(inventory('V'), ['bp_club_base', 'teleport_beads'].sort());
  assert.deepEqual(inventory('K'), ['bp_hammer_base', 'ore_medium', 'teleport_beads'].sort());
  assert.deepEqual(inventory('O'), ['griffin', 'teleport_beads'].sort());
  assert.deepEqual(inventory('S'), ['recipe_shaman_carpet', 'sheep_ram', 'teleport_beads'].sort());
  assert.deepEqual(inventory('P'), ['recipe_sack', 'sheep_ram', 'teleport_beads'].sort());
});

test('createGame — готовые базовые изделия отсутствуют до крафта', () => {
  const g = freshGame();
  const expected = { K: 'hammer', P: 'sack', V: 'club', S: 'shaman_carpet' };
  for (const [role, cardId] of Object.entries(expected)) {
    const character = g.characters.find(c => c.owner === 'p1' && c.role === role);
    assert.ok(!character.inventory.includes(cardId));
    assert.ok(!character.crafted.includes(cardId));
  }
});

test('createGame — колода перетасована и непустая', () => {
  const g = freshGame();
  assert.ok(g.deck.length > 0);
});

test('createGame — ресурсный добор не содержит карты Ирикона', () => {
  const g = freshGame();
  assert.ok(!g.deck.includes('irikon'));
  assert.ok(!g.deck.includes('task_irikon'));
  assert.ok(!g.deck.includes('blueprint_irikon'));
});

test('debug:grantCard — выдаёт любую карту своему персонажу', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const result = apply(g, 'p1', 'debug:grantCard', {
    characterId: smith.id,
    cardId: 'irikon',
  });

  assert.equal(result.debugGranted.cardId, 'irikon');
  assert.ok(smith.inventory.includes('irikon'));
});

test('debug:grantCard — закрытое изделие сразу отмечается как открытое', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  apply(g, 'p1', 'debug:grantCard', {
    characterId: warrior.id,
    cardId: 'club',
  });

  assert.ok(warrior.inventory.includes('club'));
  assert.ok(warrior.crafted.includes('club'));
});

test('debug:grantCard — нельзя выдать карту чужому персонажу', () => {
  const g = freshGame();
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'K');

  assert.throws(
    () => apply(g, 'p1', 'debug:grantCard', {
      characterId: enemy.id,
      cardId: 'irikon',
    }),
    /не ваш персонаж/i,
  );
});

test('gold_nugget — лечит персонажа на 20 HP и уходит в сброс', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.hp = 70;
  warrior.inventory.push('gold_nugget');

  const result = apply(g, 'p1', 'action:useGoldNugget', { characterId: warrior.id });

  assert.equal(warrior.hp, 90);
  assert.equal(result.goldNuggetUsed.healed, 20);
  assert.ok(!warrior.inventory.includes('gold_nugget'));
  assert.ok(g.discard.includes('gold_nugget'));
});

test('gold_nugget — не лечит выше 100 HP', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.hp = 90;
  warrior.inventory.push('gold_nugget');

  const result = apply(g, 'p1', 'action:useGoldNugget', { characterId: warrior.id });

  assert.equal(warrior.hp, 100);
  assert.equal(result.goldNuggetUsed.healed, 10);
  assert.ok(g.discard.includes('gold_nugget'));
});

test('gold_nugget — нельзя потратить при полном HP', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.hp = 100;
  warrior.inventory.push('gold_nugget');

  assert.throws(
    () => apply(g, 'p1', 'action:useGoldNugget', { characterId: warrior.id }),
    /полностью здоров/i,
  );
  assert.ok(warrior.inventory.includes('gold_nugget'));
  assert.ok(!g.discard.includes('gold_nugget'));
});

test('gold_nugget — нельзя применить к чужому персонажу', () => {
  const g = freshGame();
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  enemy.hp = 70;
  enemy.inventory.push('gold_nugget');
  assert.throws(
    () => apply(g, 'p1', 'action:useGoldNugget', { characterId: enemy.id }),
    /не ваш/i,
  );
});

test('dead_ore — расходуется и берёт карту из выбранной обычной колоды', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('dead_ore');
  g.decks = { forest: ['bark'] };

  const result = apply(g, 'p1', 'action:useDeadOre', {
    characterId: warrior.id,
    deck: 'forest',
  });

  assert.equal(result.deadOreUsed.card, 'bark');
  assert.equal(result.deadOreUsed.deck, 'forest');
  assert.ok(warrior.inventory.includes('bark'));
  assert.ok(!warrior.inventory.includes('dead_ore'));
  assert.ok(g.discard.includes('dead_ore'));
});

test('dead_ore — нельзя брать из рецептов и чертежей', () => {
  for (const deck of ['recipes', 'blueprints']) {
    const g = freshGame();
    const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
    warrior.inventory.push('dead_ore');
    assert.throws(
      () => apply(g, 'p1', 'action:useDeadOre', { characterId: warrior.id, deck }),
      /кроме чертежей и рецептов/i,
    );
    assert.ok(warrior.inventory.includes('dead_ore'));
  }
});

test('dead_ore — нельзя применять в бою', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  attacker.combatOpponentId = target.id;
  target.combatOpponentId = attacker.id;
  attacker.inventory.push('dead_ore');

  assert.throws(
    () => apply(g, 'p1', 'action:useDeadOre', { characterId: attacker.id, deck: 'forest' }),
    /нельзя применять в бою/i,
  );
});

test('use cards — самородок на террейне лечит и уходит в сброс', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.hp = 80;
  g.terrainCards.push({
    id: 'terrain-gold',
    ownerId: 'p1',
    characterId: warrior.id,
    cardIndex: 0,
    cardId: 'gold_nugget',
    faceDown: false,
    x: 0,
    y: 0,
  });

  const result = apply(g, 'p1', 'action:useGoldNugget', {
    characterId: warrior.id,
    terrainCardId: 'terrain-gold',
  });

  assert.equal(result.goldNuggetUsed.source, 'terrain');
  assert.equal(warrior.hp, 100);
  assert.equal(g.terrainCards.length, 0);
  assert.ok(g.discard.includes('gold_nugget'));
});

test('use cards — неживая руда на террейне берёт карту и уходит в сброс', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  g.decks.forest = ['bark'];
  g.terrainCards.push({
    id: 'terrain-dead-ore',
    ownerId: 'p1',
    characterId: warrior.id,
    cardIndex: 0,
    cardId: 'dead_ore',
    faceDown: false,
    x: 0,
    y: 0,
  });

  const result = apply(g, 'p1', 'action:useDeadOre', {
    characterId: warrior.id,
    terrainCardId: 'terrain-dead-ore',
    deck: 'forest',
  });

  assert.equal(result.deadOreUsed.source, 'terrain');
  assert.ok(warrior.inventory.includes('bark'));
  assert.equal(g.terrainCards.length, 0);
  assert.ok(g.discard.includes('dead_ore'));
});

// ── Эффекты карт: Ковёр шамана (начало хода) ─────────────────────

test('Ковёр шамана — восстанавливает +2 HP в начале хода', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('shaman_carpet');
  shaman.crafted.push('shaman_carpet');
  shaman.hp = 50;
  apply(g, 'p1', 'turn:roll');
  assert.equal(shaman.hp, 52);
});

test('Ковёр шамана — не лечит выше 100', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('shaman_carpet');
  shaman.crafted.push('shaman_carpet');
  shaman.hp = 99;
  apply(g, 'p1', 'turn:roll');
  assert.equal(shaman.hp, 100);
});

test('Клубок — отсутствует на старте', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  assert.ok(!shaman.inventory.includes('yarn'));
  assert.ok(!shaman.inventory.includes('shaman_carpet'));
  shaman.hp = 50;
  apply(g, 'p1', 'turn:roll');
  assert.equal(shaman.hp, 50);
});

test('Ковёр шамана — не лечит кузнеца', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('shaman_carpet');
  smith.crafted.push('shaman_carpet');
  smith.hp = 50;
  apply(g, 'p1', 'turn:roll');
  assert.equal(smith.hp, 50);
});

test('Ковёр шамана — без карты в инвентаре не лечит', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.crafted.push('shaman_carpet');
  shaman.hp = 50;
  apply(g, 'p1', 'turn:roll');
  assert.equal(shaman.hp, 50);
});

test('createGame — первый ход у первого игрока', () => {
  const g = freshGame();
  assert.equal(g.turn.activePlayerId, 'p1');
});

test('createGame — у каждого по 10 бросков', () => {
  const g = freshGame();
  assert.equal(g.turn.rollsLeft['p1'], 10);
  assert.equal(g.turn.rollsLeft['p2'], 10);
});

test('createGame — все персонажи получают уникальные стартовые позиции', () => {
  const g = freshGame();
  const positions = g.characters.map((character) => character.position);
  assert.ok(positions.every(Boolean));
  assert.equal(new Set(positions).size, 10);
});

// ── Бросок кубиков ────────────────────────────────────────────────

test('roll — возвращает два кубика', () => {
  const g = freshGame();
  const r = apply(g, 'p1', 'turn:roll');
  assert.equal(r.roll.dice.length, 2);
  assert.ok(r.roll.dice.every(d => d >= 1 && d <= 6));
});

test('roll — создает отдельную пару кубиков для каждого активного персонажа', () => {
  const g = freshGame();
  const r = apply(g, 'p1', 'turn:roll');
  const active = g.characters.filter(c => c.owner === 'p1' && c.hp > 0 && c.position);
  assert.equal(Object.keys(r.roll.diceByCharacter).length, active.length);
  for (const character of active) {
    assert.equal(g.turn.diceByCharacter[character.id].length, 2);
    assert.deepEqual(g.turn.usedDiceByCharacter[character.id], [false, false]);
  }
  assert.deepEqual(g.turn.usedDice, [false, false]);
});

test('legalTargets — снапшот не перезаписывает разные кубики персонажей одной парой', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  const active = g.characters.filter(c => c.owner === 'p1' && c.hp > 0 && c.position);
  assert.ok(active.length >= 2);
  g.turn.diceByCharacter[active[0].id] = [1, 2];
  g.turn.diceByCharacter[active[1].id] = [5, 6];
  g.turn.dice = g.turn.diceByCharacter[active[0].id];
  g.turn.activeDiceCharacterId = active[0].id;

  snapshotGame(g, 'p1');

  assert.deepEqual(g.turn.diceByCharacter[active[0].id], [1, 2]);
  assert.deepEqual(g.turn.diceByCharacter[active[1].id], [5, 6]);
  assert.equal(g.turn.activeDiceCharacterId, active[0].id);
});

test('roll — уменьшает счётчик бросков', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  assert.equal(g.turn.rollsLeft['p1'], 9);
});

test('roll — нельзя бросить дважды подряд', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  assert.throws(() => apply(g, 'p1', 'turn:roll'), /уже брошены/i);
});

test('roll — нельзя бросить повторно после расходования кубиков в том же ходу', () => {
  const g = freshGame();
  g.turn.dice = [1, 1];
  g.turn.mode = 'moveSum';
  g.turn.hasRolled = true;
  const character = g.characters.find(c => c.owner === 'p1');
  const target = availableMoveTargets(g, 'p1', character.id)[0];

  apply(g, 'p1', 'action:move', {
    characterId: character.id,
    toCell: target.cellId,
  });

  assert.deepEqual(g.turn.dice, [1, 1]);
  assert.throws(() => apply(g, 'p1', 'turn:roll'), /уже брошены/i);
});

test('roll — снова доступен после передачи хода и возврата к игроку', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:end');
  apply(g, 'p2', 'turn:end');

  assert.doesNotThrow(() => apply(g, 'p1', 'turn:roll'));
});

test('roll — нельзя бросить в чужой ход', () => {
  const g = freshGame();
  assert.throws(() => apply(g, 'p2', 'turn:roll'), /ход другого игрока/i);
});

// ── Режим ────────────────────────────────────────────────────────

test('setMode — устанавливается moveSum', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:setMode', { mode: 'moveSum' });
  assert.equal(g.turn.mode, 'moveSum');
});

test('setMode — устанавливается split', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  assert.equal(g.turn.mode, 'split');
});

test('setMode — невалидный режим отклоняется', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  assert.throws(() => apply(g, 'p1', 'turn:setMode', { mode: 'fly' }), /режим должен быть/i);
});

test('setMode — нельзя менять после траты кубика', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  placeOnResource(char);
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.throws(() => apply(g, 'p1', 'turn:setMode', { mode: 'moveSum' }), /нельзя менять/i);
});

// ── Добор карты ──────────────────────────────────────────────────

test('draw — добирает карту в инвентарь', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  placeOnResource(char);
  const before = char.inventory.length;
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.equal(char.inventory.length, before + 1);
});

test('draw — уменьшает колоду', () => {
  const g = freshGame();
  const deckBefore = g.deck.length;
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  placeOnResource(char);
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.equal(g.deck.length, deckBefore - 1);
});

test('draw — тратит кубик', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  placeOnResource(char);
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.equal(g.turn.usedDice[0], true);
});

test('draw — нельзя добрать чужим персонажем', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const enemyChar = g.characters.find(c => c.owner === 'p2');
  assert.throws(() => apply(g, 'p1', 'action:draw', { characterId: enemyChar.id, dieIndex: 0 }), /не ваш/i);
});

test('draw — нельзя добрать в режиме moveSum', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:setMode', { mode: 'moveSum' });
  const char = g.characters.find(c => c.owner === 'p1');
  placeOnResource(char);
  assert.throws(() => apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 }), /split/i);
});

// Подсветка «Взять»: в moveSum снапшот отдаёт одиночную дальность каждого
// кубика. Ресурс, достижимый ОДНИМ кубиком, попадает в legalTargets.dice
// (кнопка включится); достижимый только СУММОЙ — нет (кубика на карту не
// останется, кнопка выключена).
test('legalTargets.dice (moveSum) — ресурс одним кубиком виден, только-суммой — нет', () => {
  const g = freshGame();
  const char = g.characters.find(c => c.owner === 'p1');
  // Чистая топология: на поле остаётся только наш персонаж.
  for (const c of g.characters) if (c !== char) c.position = null;
  const resource = 'H010'; // от стартовой клетки H007 — расстояние 2
  assert.equal(shortestDistance(char.position, resource), 2);

  apply(g, 'p1', 'turn:roll');
  g.turn.mode = 'moveSum';
  g.turn.usedDice = [false, false];

  // Кубики [1,1]: до ресурса достаёт только сумма (2), одиночный (1) — нет.
  g.turn.dice = [1, 1];
  const sumOnly = snapshotGame(g, 'p1').legalTargets;
  assert.ok(sumOnly.moveSum[char.id].includes(resource), 'суммой ресурс достижим');
  assert.ok(!sumOnly.dice[0][char.id].includes(resource), 'одиночным кубиком 1 — нет');
  assert.ok(!sumOnly.dice[1][char.id].includes(resource), 'одиночным кубиком 1 — нет');

  // Кубик 2: одиночный достаёт ресурс — кнопка должна включиться.
  g.turn.dice = [2, 1];
  const single = snapshotGame(g, 'p1').legalTargets;
  assert.ok(single.dice[0][char.id].includes(resource), 'кубик 2 одиночным достаёт ресурс');
  assert.ok(!single.dice[1][char.id].includes(resource), 'кубик 1 одиночным — нет');
});

test('draw — нельзя добрать не на ресурсной клетке', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  char.position = 'H001';
  assert.notEqual(cellTerrain(char.position), 'resource');
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 }),
    /точке ресурса/i,
  );
});

test('draw — работает на каждой клетке добора карты', () => {
  const drawCells = [...new Set([
    ...terrainCells('resource'),
    ...deckCells().filter(cellId => cellDeck(cellId) !== 'fairy_glade'),
  ])];
  assert.ok(drawCells.length > 0);
  for (const cellId of drawCells) {
    const g = freshGame();
    const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
    char.position = cellId;
    g.turn.dice = [3, 4];
    g.turn.mode = 'split';
    g.turn.hasRolled = true;

    const result = apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });

    assert.equal(result.drawn.characterId, char.id);
    assert.equal(result.drawn.count, 1);
    assert.deepEqual(g.turn.usedDice, [true, false]);
  }
});

test('draw — берёт карту из колоды по рубашке клетки', () => {
  const cases = [
    { cellId: 'H014', deck: 'mixed', pile: 'deck', cardId: 'ore_coarse' },
    { cellId: 'H011', deck: 'forest', pile: 'forest', cardId: 'bark' },
    { cellId: 'H101', deck: 'dark_forest', pile: 'dark_forest', cardId: 'topormol' },
    { cellId: 'H010', deck: 'blueprints', pile: 'blueprints', cardId: 'blueprint_irikon' },
    { cellId: 'H229', deck: 'recipes', pile: 'recipes', cardId: 'recipe_armor' },
    { cellId: 'H042', deck: 'lake', pile: 'lake', cardId: 'raw_ruby' },
  ];

  for (const item of cases) {
    const g = freshGame();
    const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
    char.position = item.cellId;
    if (item.pile === 'deck') {
      g.deck = [item.cardId];
    } else {
      g.decks[item.pile] = [item.cardId];
    }
    g.turn.dice = [3, 4];
    g.turn.mode = 'split';
    g.turn.hasRolled = true;

    const result = apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });

    assert.equal(result.drawn.deck, item.deck);
    assert.equal(result.drawn.card, item.cardId);
    assert.ok(char.inventory.includes(item.cardId));
    if (item.pile === 'deck') {
      assert.equal(g.deck.length, 0);
    } else {
      assert.equal(g.decks[item.pile].length, 0);
    }
  }
});

test('move — после постановки фишки на ресурс автоматически добирает и фиксирует выбор клетки', () => {
  const g = freshGame();
  const helper = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  helper.position = 'H006';
  g.deck = ['ore_medium', ...g.deck.filter(cardId => cardId !== 'ore_medium')];
  g.turn.dice = [1, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:move', {
    characterId: helper.id,
    toCell: 'H002',
    dieIndex: 0,
  });
  assert.equal(helper.position, 'H002');
  assert.equal(result.drawn.card, 'ore_medium');
  assert.equal(g.turn.movementArea.locked, true);
  assert.deepEqual(g.turn.usedDice, [true, false]);
  assert.throws(
    () => apply(g, 'p1', 'turn:resetMove', { characterId: helper.id }),
    /нельзя отменить/i,
  );
});

test('draw — ресурсный добор не кладёт карты Ирикона в руку или сброс', () => {
  const g = freshGame();
  const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  placeOnResource(char);
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  const forbidden = ['irikon', 'task_irikon', 'blueprint_irikon'];

  assert.ok(!forbidden.includes(result.drawn.card));
  assert.ok(!forbidden.some(cardId => char.inventory.includes(cardId)));
  assert.ok(!forbidden.some(cardId => g.discard.includes(cardId)));
});

test('draw — нельзя добрать сверх лимита инвентаря (10)', () => {
  const g = freshGame();
  const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  placeOnResource(char);
  // Набиваем инвентарь до предела
  for (let i = 0; i < 10; i++) char.inventory.push(`карта_${i}`);
  rollAndSplit(g, 'p1');
  assert.throws(() => apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 }), /полон/i);
});

// ── Передача карт ────────────────────────────────────────────────

test('transfer — карта переходит от одного персонажа к другому', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  // Добираем карту для передачи
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'K'); // у кузнеца 2 карты
  const to   = g.characters.find(c => c.owner === 'p1' && c.role === 'V'); // у воина 2 карты
  to.position = neighbors(from.position)[0]; // получатель рядом — на соседней клетке
  const fromBefore = from.inventory.length;
  const toBefore   = to.inventory.length;
  apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, dieIndex: 0 });
  assert.ok(from.inventory.length < fromBefore);
  assert.ok(to.inventory.length > toBefore);
});

test('transfer — нельзя передать самому себе', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  assert.throws(() => apply(g, 'p1', 'action:transfer', { fromId: char.id, toId: char.id, dieIndex: 0 }), /два разных/i);
});

test('transfer — нельзя передать от пустого персонажа', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const to   = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  to.position = neighbors(from.position)[0]; // рядом
  from.inventory = []; // опустошаем
  assert.throws(() => apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, dieIndex: 0 }), /нет карт/i);
});

test('transfer — передача конкретной карты по cardIndex (ящик)', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const to   = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  to.position = neighbors(from.position)[0]; // рядом
  from.inventory = ['ore_medium', 'bark', 'yarn'];
  to.inventory = [];
  apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 1, dieIndex: 0 });
  assert.deepEqual(from.inventory, ['ore_medium', 'yarn']); // ушла именно bark
  assert.deepEqual(to.inventory, ['bark']);
});

test('transfer — неверный cardIndex отклоняется', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const to   = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  to.position = neighbors(from.position)[0]; // рядом
  assert.throws(
    () => apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 99, dieIndex: 0 }),
    /не найдена/i,
  );
});

test('transfer — один кубик двигает несколько карт (бюджет = значению)', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [3, 1];                 // фиксируем значения
  g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const to   = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  to.position = neighbors(from.position)[0]; // рядом
  from.inventory = ['a', 'b', 'c', 'd'];
  to.inventory = [];
  // 1-й перенос тратит кубик 0 (значение 3) → бюджет 2
  apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 0, dieIndex: 0 });
  assert.equal(g.turn.usedDice[0], true);
  assert.equal(g.turn.transferRemaining, 2);
  // ещё два переноса — без кубика, по бюджету
  apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 0 });
  apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 0 });
  assert.equal(g.turn.transferRemaining, 0);
  assert.deepEqual(to.inventory, ['a', 'b', 'c']);
  assert.deepEqual(from.inventory, ['d']);
});

test('transfer — бюджет сбрасывается в конце хода', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [4, 2];
  g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const from = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const to   = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  to.position = neighbors(from.position)[0]; // рядом
  from.inventory = ['a', 'b'];
  to.inventory = [];
  apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, cardIndex: 0, dieIndex: 0 });
  assert.equal(g.turn.transferRemaining, 3);
  apply(g, 'p1', 'turn:end');
  assert.equal(g.turn.transferRemaining, 0);
});

// ── Движение и карта ─────────────────────────────────────────────

test('move split — перемещает персонажа и тратит выбранный кубик', () => {
  const g = freshGame();
  g.turn.dice = [2, 4];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = availableMoveTargets(g, 'p1', warrior.id, 0)[0];

  apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: target.cellId,
    dieIndex: 0,
  });

  assert.equal(warrior.position, target.cellId);
  assert.equal(g.turn.usedDice[0], true);
  assert.equal(g.turn.usedDice[1], false);
});

const isDrawCellTest = (id) =>
  cellTerrain(id) === 'resource' || Boolean(cellDeck(id) && cellDeck(id) !== 'fairy_glade');

test('moveSum — фиксирует область суммы и позволяет переставлять фигурку внутри неё', () => {
  const g = freshGame();
  g.turn.dice = [2, 3];
  g.turn.mode = 'moveSum';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const initialTargets = availableMoveTargets(g, 'p1', warrior.id);
  // Берём не-draw цель, иначе сработает автосплит (тратит один кубик, не оба).
  const plain = initialTargets.filter(t => !isDrawCellTest(t.cellId) && cellTerrain(t.cellId) !== 'event');
  const first = plain.find(target => target.distance >= 2) ?? plain[0];
  const second = plain.find(target => target.cellId !== first.cellId);

  apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: first.cellId,
  });

  assert.equal(warrior.position, first.cellId);
  assert.deepEqual(g.turn.usedDice, [true, true]);
  assert.deepEqual(g.turn.dice, [2, 3]);
  assert.equal(g.turn.movementArea.origin, startCell('green', 'V'));
  assert.ok(
    availableMoveTargets(g, 'p1', warrior.id)
      .some(target => target.cellId === second.cellId),
  );

  apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: second.cellId,
  });
  assert.equal(warrior.position, second.cellId);
});

test('автосплит — выход на ресурс в пределах одного кубика тратит наименьший и автоматически добирает карту', () => {
  const g = freshGame();
  g.turn.dice = [2, 5];
  g.turn.mode = 'moveSum';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  // H014 — draw-клетка (колода 'mixed'), distance 2 от старта воина H009
  const target = availableMoveTargets(g, 'p1', warrior.id).find(t => t.cellId === 'H014');
  assert.ok(target && target.distance === 2 && isDrawCellTest('H014'));

  const beforeInv = warrior.inventory.length;
  const beforeDeck = g.deck.length;
  const result = apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: 'H014' });

  assert.equal(warrior.position, 'H014');
  assert.deepEqual(g.turn.usedDice, [true, false]); // потрачен кубик 2 (idx 0), 5 свободен
  assert.equal(g.turn.mode, 'split');
  assert.equal(g.turn.movementArea.mode, 'split');
  assert.equal(g.turn.movementArea.dieIndex, 0);
  assert.equal(g.turn.movementArea.locked, true);
  assert.equal(g.turn.drawnThisTurn, true);
  assert.equal(warrior.inventory.length, beforeInv + 1);
  assert.equal(g.deck.length, beforeDeck - 1);
  assert.equal(result.drawn.characterId, warrior.id);
  assert.equal(result.drawn.deck, 'mixed');
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: warrior.id, dieIndex: 1 }),
    /один раз за бросок/i,
  );
});

test('автосплит — ресурс дальше одиночного кубика: тратит оба, добор недоступен', () => {
  const g = freshGame();
  g.turn.dice = [3, 3]; // max одиночный = 3
  g.turn.mode = 'moveSum';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  // H270 — draw-клетка (колода 'recipes'), distance 4 (> 3, дойти можно только суммой)
  const target = availableMoveTargets(g, 'p1', warrior.id).find(t => t.cellId === 'H270');
  assert.ok(target && target.distance === 4 && isDrawCellTest('H270'));

  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: 'H270' });

  assert.deepEqual(g.turn.usedDice, [true, true]); // оба кубика
  assert.equal(g.turn.mode, 'moveSum');
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: warrior.id, dieIndex: 0 }),
    /split|потрач/i,
  );
});

test('move split — кубик первой ноги переставляет фишку внутри своей области', () => {
  const g = freshGame();
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const initialTargets = availableMoveTargets(g, 'p1', warrior.id, 0);
  const first = initialTargets[0];
  const second = initialTargets.find(target => target.cellId !== first.cellId);

  apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: first.cellId,
    dieIndex: 0,
  });

  assert.equal(g.turn.movementArea.mode, 'split');
  assert.equal(g.turn.movementArea.dieIndex, 0);
  // Тот же кубик — перестановка внутри области первой ноги (от origin).
  assert.ok(
    availableMoveTargets(g, 'p1', warrior.id, 0)
      .some(target => target.cellId === second.cellId),
  );

  apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: second.cellId,
    dieIndex: 0,
  });
  assert.equal(warrior.position, second.cellId);
});

test('move split — другой кубик открывает вторую ногу от текущей клетки', () => {
  const g = freshGame();
  g.turn.dice = [3, 3];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const start = warrior.position;
  const firstLeg = availableMoveTargets(g, 'p1', warrior.id, 0)
    .find(t => t.distance === 3);
  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: firstLeg.cellId, dieIndex: 0 });
  assert.equal(g.turn.usedDice[0], true);

  // Вторая нога вторым кубиком — поле считается от ТЕКУЩЕЙ клетки.
  const secondLegTargets = availableMoveTargets(g, 'p1', warrior.id, 1);
  assert.ok(secondLegTargets.length > 0);
  const secondLeg = secondLegTargets.find(t => t.distance === 3);
  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: secondLeg.cellId, dieIndex: 1 });

  assert.equal(warrior.position, secondLeg.cellId);
  assert.deepEqual(g.turn.usedDice, [true, true]);
  assert.equal(g.turn.movementArea.dieIndex, 1);
  assert.equal(g.turn.movementArea.prev.dieIndex, 0);
  // Инвариант: суммарная дальность от старта не превышает сумму кубиков.
  assert.ok(shortestDistance(start, warrior.position) <= 6);
});

test('resetMove — откат первой ноги возвращает фишку на старт и освобождает кубик', () => {
  const g = freshGame();
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const start = warrior.position;
  const target = availableMoveTargets(g, 'p1', warrior.id, 0).find(t => t.distance >= 1);
  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: target.cellId, dieIndex: 0 });
  assert.equal(g.turn.usedDice[0], true);

  apply(g, 'p1', 'turn:resetMove', { characterId: warrior.id });
  assert.equal(warrior.position, start);
  assert.deepEqual(g.turn.usedDice, [false, false]);
  assert.equal(g.turn.movementArea, null);
});

test('resetMove — откат второй ноги снова делает активной первую', () => {
  const g = freshGame();
  g.turn.dice = [3, 3];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const firstLeg = availableMoveTargets(g, 'p1', warrior.id, 0).find(t => t.distance >= 1);
  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: firstLeg.cellId, dieIndex: 0 });
  const afterFirst = warrior.position;
  const secondLeg = availableMoveTargets(g, 'p1', warrior.id, 1).find(t => t.distance >= 1);
  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: secondLeg.cellId, dieIndex: 1 });

  apply(g, 'p1', 'turn:resetMove', { characterId: warrior.id });
  assert.equal(warrior.position, afterFirst);       // вернулись к концу первой ноги
  assert.equal(g.turn.usedDice[1], false);          // второй кубик свободен
  assert.equal(g.turn.usedDice[0], true);           // первая нога ещё активна
  assert.equal(g.turn.movementArea.dieIndex, 0);
});

test('resetMove — после красной клетки откат запрещён', () => {
  const g = freshGame();
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  g.redDeck = ['wolf'];
  g.redIrkonDropped = true;
  const redTarget = availableMoveTargets(g, 'p1', warrior.id, 0)
    .find(t => cellTerrain(t.cellId) === 'event');
  if (!redTarget) return; // нет красной в радиусе — пропускаем
  apply(g, 'p1', 'action:move', { characterId: warrior.id, toCell: redTarget.cellId, dieIndex: 0 });
  assert.ok(warrior.beastFight);
  assert.throws(
    () => apply(g, 'p1', 'turn:resetMove', { characterId: warrior.id }),
    /нельзя отменить/i,
  );
});

test('move — занятая клетка не входит в доступные цели', () => {
  const g = freshGame();
  g.turn.dice = [6, 1];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const occupied = g.characters.find(c => c.owner === 'p1' && c.role === 'K').position;

  const targets = availableMoveTargets(g, 'p1', warrior.id, 0);

  assert.ok(!targets.some((target) => target.cellId === occupied));
});

test('move — сервер отклоняет клетку за пределами карты', () => {
  const g = freshGame();
  g.turn.dice = [6, 1];
  g.turn.mode = 'split';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');

  assert.throws(
    () => apply(g, 'p1', 'action:move', {
      characterId: warrior.id,
      toCell: '99:99',
      dieIndex: 0,
    }),
    /пределами карты/i,
  );
});

test('teleport — переносит персонажа на свободную стартовую клетку', () => {
  const g = freshGame();
  g.turn.dice = [2, 1];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const dest = startCell('green', 'K');
  const ownK = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  ownK.position = neighbors(ownK.position)[0];

  const result = apply(g, 'p1', 'action:teleport', {
    characterId: shaman.id,
    toCell: dest,
    dieIndex: 0,
  });

  assert.equal(shaman.position, dest);
  assert.equal(result.teleported.value, 2);
  assert.equal(result.teleported.success, true);
  assert.ok(shaman.inventory.includes('teleport_beads'));
  assert.ok(shaman.exhaustedCards.includes('teleport_beads'));
  assert.ok(!g.discard.includes('teleport_beads'));
  assert.deepEqual(g.turn.usedDice, [true, false]);
  assert.equal(g.winnerId, null);
  assert.equal(g.over, false);
});

test('teleport — персонаж с Золотым пером не может телепортироваться', () => {
  const g = freshGame();
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const originalPosition = shaman.position;
  const dest = startCell('green', 'K');
  const ownK = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  ownK.position = neighbors(ownK.position)[0];
  shaman.inventory.push('gold_feather_own');

  assert.throws(
    () => apply(g, 'p1', 'action:teleport', {
      characterId: shaman.id,
      toCell: dest,
      dieIndex: 0,
    }),
    /пером не может телепортироваться/i,
  );
  assert.equal(shaman.position, originalPosition);
  assert.deepEqual(g.turn.usedDice, [false, false]);
  assert.ok(!shaman.exhaustedCards.includes('teleport_beads'));
});

test('teleport — кубик 1 тратится, но Бусы и позиция сохраняются', () => {
  const g = freshGame();
  g.turn.dice = [1, 5];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const before = shaman.position;
  const dest = startCell('green', 'K');
  const ownK = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  ownK.position = neighbors(ownK.position)[0];

  const result = apply(g, 'p1', 'action:teleport', {
    characterId: shaman.id,
    toCell: dest,
    dieIndex: 0,
  });

  assert.equal(result.teleported.success, false);
  assert.equal(shaman.position, before);
  assert.ok(shaman.inventory.includes('teleport_beads'));
  assert.ok(!shaman.exhaustedCards.includes('teleport_beads'));
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('teleport — переносит персонажа на фиолетовую точку', () => {
  const g = freshGame();
  g.turn.dice = [3, 1];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const dest = pointClassCells('teleport')[0];

  const result = apply(g, 'p1', 'action:teleport', {
    characterId: shaman.id,
    toCell: dest,
    dieIndex: 0,
  });

  assert.equal(result.teleported.success, true);
  assert.equal(shaman.position, dest);
  assert.ok(shaman.exhaustedCards.includes('teleport_beads'));
});

test('teleport — использованные Бусы нельзя применить повторно', () => {
  const g = freshGame();
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.exhaustedCards.push('teleport_beads');

  assert.throws(
    () => apply(g, 'p1', 'action:teleport', {
      characterId: shaman.id,
      toCell: pointClassCells('teleport')[0],
      dieIndex: 0,
    }),
    /уже использованы/i,
  );
});

test('teleport — Шкура ритуалов перезаряжает использованные Бусы на 4+', () => {
  const g = freshGame();
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.exhaustedCards.push('teleport_beads');
  g.terrainCards.push({
    id: 'ritual-hide-terrain',
    ownerId: 'p1',
    characterId: shaman.id,
    cardIndex: 0,
    cardId: 'ritual_hide',
    faceDown: false,
    x: 0,
    y: 0,
  });

  const result = apply(g, 'p1', 'action:rechargeTeleport', {
    characterId: shaman.id,
    targetId: warrior.id,
    terrainCardId: 'ritual-hide-terrain',
    dieIndex: 0,
  });

  assert.equal(result.teleportRecharged.success, true);
  assert.equal(result.teleportRecharged.value, 4);
  assert.ok(!warrior.exhaustedCards.includes('teleport_beads'));
  assert.equal(g.terrainCards[0].faceDown, true);
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('teleport — провал перезарядки оставляет Бусы использованными', () => {
  const g = freshGame();
  g.turn.dice = [3, 6];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.exhaustedCards.push('teleport_beads');
  g.terrainCards.push({
    id: 'ritual-hide-terrain',
    ownerId: 'p1',
    characterId: shaman.id,
    cardIndex: 0,
    cardId: 'ritual_hide',
    faceDown: false,
    x: 0,
    y: 0,
  });

  const result = apply(g, 'p1', 'action:rechargeTeleport', {
    characterId: shaman.id,
    targetId: shaman.id,
    terrainCardId: 'ritual-hide-terrain',
    dieIndex: 0,
  });

  assert.equal(result.teleportRecharged.success, false);
  assert.ok(shaman.exhaustedCards.includes('teleport_beads'));
  assert.equal(g.terrainCards[0].faceDown, true);
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('teleport — перезарядка требует открытую Шкуру ритуалов на террейне Шамана', () => {
  const g = freshGame();
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('ritual_hide');
  shaman.exhaustedCards.push('teleport_beads');

  assert.throws(
    () => apply(g, 'p1', 'action:rechargeTeleport', {
      characterId: shaman.id,
      targetId: shaman.id,
      dieIndex: 0,
    }),
    /выложить лицом вверх/i,
  );
});

test('terrain — карта убирается из руки и возвращается на прежнее место', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const original = [...warrior.inventory];

  apply(g, 'p1', 'action:terrainPlace', {
    id: 'terrain-test',
    characterId: warrior.id,
    cardIndex: 0,
    x: 100,
    y: 200,
    faceDown: true,
  });

  assert.equal(g.terrainCards[0].faceDown, true);
  assert.equal(warrior.inventory.length, original.length - 1);
  apply(g, 'p1', 'action:terrainRemove', { id: 'terrain-test' });
  assert.deepEqual(warrior.inventory, original);
});

test('terrain — соперник не может вернуть чужую карту', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  apply(g, 'p1', 'action:terrainPlace', {
    id: 'terrain-test',
    characterId: warrior.id,
    cardIndex: 0,
    x: 100,
    y: 200,
  });
  g.turn.activePlayerId = 'p2';
  assert.throws(
    () => apply(g, 'p2', 'action:terrainRemove', { id: 'terrain-test' }),
    /только владелец/i,
  );
});

test('teleport — стартовые клетки противника запрещены', () => {
  const g = freshGame();
  g.turn.dice = [6, 1];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');

  assert.throws(
    () => apply(g, 'p1', 'action:teleport', {
      characterId: shaman.id,
      toCell: startCell('red', 'K'),
      dieIndex: 0,
    }),
    /свои стартовые/i,
  );
});

// ── Бой игрок против игрока ──────────────────────────────────────

function prepareAdjacentCombat(game) {
  const attacker = game.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = game.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(attacker.position)[0];
  game.turn.dice = [3, 4];
  game.turn.mode = 'moveSum';
  game.turn.hasRolled = true;
  return { attacker, target };
}

test('attack — соседний противник получает урон на сумму двух кубиков', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);

  assert.deepEqual(availableAttackTargets(g, 'p1', attacker.id), [target.id]);
  const result = apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(result.attacked.damage, 7);
  assert.equal(target.hp, 93);
  assert.equal(attacker.combatOpponentId, target.id);
  assert.equal(target.combatOpponentId, attacker.id);
  assert.deepEqual(g.turn.dice, [3, 4]);
  assert.equal(result.attacked.dieIndex, 0);
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('attack — несколько соседних персонажей могут бить одну уже связанную боем цель', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const second = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(attacker.position)
    .find(cell => !g.characters.some(c => c.position === cell));
  second.position = neighbors(target.position)
    .find(cell => cell !== attacker.position && !g.characters.some(c => c.position === cell));
  assert.ok(target.position);
  assert.ok(second.position);

  g.turn.diceByCharacter = {
    [attacker.id]: [3, 4],
    [second.id]: [2, 2],
  };
  g.turn.usedDiceByCharacter = {
    [attacker.id]: [false, false],
    [second.id]: [false, false],
  };
  g.turn.dice = g.turn.diceByCharacter[attacker.id];
  g.turn.usedDice = g.turn.usedDiceByCharacter[attacker.id];
  g.turn.activeDiceCharacterId = attacker.id;
  g.turn.mode = 'moveSum';
  g.turn.hasRolled = true;

  apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });
  assert.equal(target.combatOpponentId, attacker.id);
  assert.deepEqual(g.turn.usedDiceByCharacter[attacker.id], [true, false]);
  assert.deepEqual(g.turn.usedDiceByCharacter[second.id], [false, false]);

  const result = apply(g, 'p1', 'action:attack', { attackerId: second.id, targetId: target.id });
  assert.equal(result.attacked.attackerId, second.id);
  assert.equal(result.attacked.targetId, target.id);
  assert.equal(result.attacked.damage, 4);
  assert.deepEqual(g.turn.usedDiceByCharacter[attacker.id], [true, false]);
  assert.deepEqual(g.turn.usedDiceByCharacter[second.id], [true, false]);
});

test('combat — подход к выбранному противнику фиксирует бой и тратит только кубик движения', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  const destination = neighbors(target.position)
    .find(cell => !g.characters.some(c => c.position === cell));
  assert.ok(destination);
  attacker.position = neighbors(destination)
    .find(cell => cell !== target.position && !g.characters.some(c => c.position === cell));
  assert.ok(attacker.position);
  g.turn.dice = [1, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:move', {
    characterId: attacker.id,
    toCell: destination,
    dieIndex: 0,
    engageTargetId: target.id,
  });

  assert.equal(result.moved.engagedTargetId, target.id);
  assert.equal(attacker.combatOpponentId, target.id);
  assert.equal(target.combatOpponentId, attacker.id);
  assert.deepEqual(g.turn.usedDice, [true, false]);
  assert.equal(g.turn.movementArea.locked, true);
});

test('combat — клик по соседнему противнику фиксирует бой без удара и расхода кубиков', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(attacker.position)
    .find(cell => !g.characters.some(c => c.position === cell));
  assert.ok(target.position);
  g.turn.dice = [3, 4];
  g.turn.usedDice = [true, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:engage', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(result.engaged.targetId, target.id);
  assert.equal(attacker.combatOpponentId, target.id);
  assert.equal(target.combatOpponentId, attacker.id);
  assert.equal(target.hp, 100);
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('combat — нельзя зафиксировать бой с несоседним противником', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p1', 'action:engage', {
      attackerId: attacker.id,
      targetId: target.id,
    }),
    /соседней клетке/i,
  );
});

test('combat — нельзя вступить в бой до броска кубиков', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(attacker.position)
    .find(cell => !g.characters.some(c => c.position === cell));
  assert.ok(target.position);

  assert.throws(
    () => apply(g, 'p1', 'action:engage', {
      attackerId: attacker.id,
      targetId: target.id,
    }),
    /сначала бросьте кубики/i,
  );
});

test('combat — подход не связывает бой с несоседней целью', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  const destination = neighbors(attacker.position)
    .find(cell => !g.characters.some(c => c.position === cell));
  assert.ok(destination);
  g.turn.dice = [1, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p1', 'action:move', {
      characterId: attacker.id,
      toCell: destination,
      dieIndex: 0,
      engageTargetId: target.id,
    }),
    /не удалось вступить в бой/i,
  );
});

test('combat — участник боя не может брать карту, но может телепортироваться', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  g.turn.activePlayerId = 'p2';
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p2', 'action:draw', {
      characterId: target.id,
      dieIndex: 0,
    }),
    /в бою.*не может брать карты/i,
  );
  const destination = startCell(target.side, 'O');
  const occupant = g.characters.find(c => c.owner === 'p2' && c.role === 'O');
  occupant.position = neighbors(occupant.position)[0];
  const result = apply(g, 'p2', 'action:teleport', {
    characterId: target.id,
    toCell: destination,
    dieIndex: 0,
  });
  assert.equal(result.teleported.success, true);
  assert.equal(result.teleported.escapedCombat, true);
  assert.equal(target.position, destination);
  assert.equal(target.combatOpponentId, null);
  assert.equal(attacker.combatOpponentId, null);
});

test('combat — побег требует сумму кубиков и разрывает соседство', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  g.turn.activePlayerId = 'p2';
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  assert.deepEqual(availableMoveTargets(g, 'p2', target.id, 0), []);

  g.turn.mode = 'moveSum';
  const escapeTargets = availableMoveTargets(g, 'p2', target.id);
  assert.ok(escapeTargets.length > 0);
  assert.ok(escapeTargets.every(
    ({ cellId }) => !neighbors(attacker.position).includes(cellId),
  ));

  const escape = escapeTargets[0];
  const result = apply(g, 'p2', 'action:move', {
    characterId: target.id,
    toCell: escape.cellId,
  });

  assert.equal(result.moved.escapedCombat, true);
  assert.equal(attacker.combatOpponentId, null);
  assert.equal(target.combatOpponentId, null);
  assert.deepEqual(g.turn.dice, [3, 4]);
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('attack — нельзя атаковать несоседнего противника', () => {
  const g = freshGame();
  g.turn.dice = [3, 4];
  g.turn.mode = 'moveSum';
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');

  assert.throws(
    () => apply(g, 'p1', 'action:attack', {
      attackerId: attacker.id,
      targetId: target.id,
    }),
    /соседней клетке/i,
  );
});

test('attack — можно ударить вторым кубиком после траты первого', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  g.turn.usedDice[0] = true;

  assert.deepEqual(availableAttackTargets(g, 'p1', attacker.id), [target.id]);
  const result = apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(result.attacked.damage, 7);
  assert.equal(result.attacked.dieIndex, 1);
  assert.equal(target.hp, 93);
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('attack — нельзя атаковать без свободного кубика', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  g.turn.usedDice = [true, true];

  assert.deepEqual(availableAttackTargets(g, 'p1', attacker.id), []);
  assert.throws(
    () => apply(g, 'p1', 'action:attack', {
      attackerId: attacker.id,
      targetId: target.id,
    }),
    /свободный кубик/i,
  );
});

test('attack — погибший снимается с поля, а его карты переходят победителю', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  target.hp = 7;
  attacker.inventory = Array(8).fill('attacker-card');
  target.inventory = ['loot-1', 'loot-2', 'overflow'];

  const result = apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(result.attacked.defeated, true);
  assert.equal(target.position, null);
  assert.equal(target.inventory.length, 0);
  assert.equal(attacker.inventory.length, 10);
  assert.equal(result.attacked.lootCount, 2);
  assert.equal(result.attacked.discardedCount, 1);
  assert.ok(g.discard.includes('overflow'));
});

test('attack — уничтожение последнего персонажа завершает партию', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  for (const character of g.characters.filter(c => c.owner === 'p2' && c.id !== target.id)) {
    character.hp = 0;
    character.position = null;
  }
  target.hp = 7;

  apply(g, 'p1', 'action:attack', {
    attackerId: attacker.id,
    targetId: target.id,
  });

  assert.equal(g.over, true);
  assert.equal(g.winnerId, 'p1');
});

// ── Завершение хода ──────────────────────────────────────────────

test('endTurn — ход переходит ко второму игроку', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:end');
  assert.equal(g.turn.activePlayerId, 'p2');
});

test('endTurn — кубики сбрасываются', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:end');
  assert.equal(g.turn.dice, null);
});

test('endTurn — нельзя завершить чужой ход', () => {
  const g = freshGame();
  assert.throws(() => apply(g, 'p2', 'turn:end'), /ход другого игрока/i);
});

test('endTurn — ходы чередуются p1→p2→p1', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  apply(g, 'p1', 'turn:end');
  apply(g, 'p2', 'turn:roll');
  apply(g, 'p2', 'turn:end');
  assert.equal(g.turn.activePlayerId, 'p1');
});

test('endTurn — после общего цикла броски обновляются без ложной победы', () => {
  const g = freshGame();
  g.turn.rollsLeft = { p1: 0, p2: 0 };

  const result = apply(g, 'p1', 'turn:end');

  assert.equal(result.rollsReset, true);
  assert.deepEqual(g.turn.rollsLeft, { p1: 10, p2: 10 });
  assert.equal(g.over, false);
  assert.equal(g.winnerId, null);
});

// ── События на красных клетках (звери) ───────────────────────────

// H015 — клетка terrain === 'event' из board-map.json; H012 — её сосед-path.
const EVENT_CELL = 'H015';
const EVENT_NEIGHBOR = 'H012';

// Ставит персонажа p1 рядом с красной клеткой, подкручивает красную колоду
// и делает ход на неё одним кубиком (split).
function stepOnEventCell(g, redDeck, role = 'V') {
  const char = g.characters.find(c => c.owner === 'p1' && c.role === role);
  char.position = EVENT_NEIGHBOR;
  g.redDeck = redDeck;
  g.turn.dice = [1, 2];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:move', {
    characterId: char.id,
    toCell: EVENT_CELL,
    dieIndex: 0,
  });
  return { char, result };
}

test('createGame — красная колода: все красные кроме Ирикона, медведь чаще зверей', () => {
  const g = freshGame();
  assert.ok(g.redDeck.length > 6);
  assert.equal(g.redDeck.includes('irikon'), false);
  assert.equal(g.redDeck.filter(cardId => cardId === 'beast_bear').length, 4);
  assert.equal(g.redDeck.filter(cardId => cardId === 'boar_red').length, 2);
  assert.equal(g.redDeck.filter(cardId => cardId === 'wolf').length, 2);
  assert.ok(g.redDeck.includes('task_irikon'));
  assert.ok(g.deck.length > 0); // общая колода не пострадала
});

test('красная клетка — зверь сверху колоды начинает схватку', () => {
  const g = freshGame();
  const { char, result } = stepOnEventCell(g, ['wolf', 'boar_red']);
  assert.deepEqual(char.beastFight, { cardId: 'wolf', successes: 0, cellId: EVENT_CELL });
  assert.equal(result.redEvent.cardId, 'wolf');
  assert.equal(result.redEvent.beast, true);
  assert.deepEqual(g.redDeck, ['boar_red']);
});

test('красная клетка — красная находка попадает в инвентарь без схватки', () => {
  const g = freshGame();
  const originalRandom = Math.random;
  Math.random = () => 0.5; // исключаем отдельный 2% дроп Ирикона
  try {
    const { char, result } = stepOnEventCell(g, ['task_irikon', 'wolf']);
    assert.equal(char.beastFight, null);
    assert.equal(result.redEvent.cardId, 'task_irikon');
    assert.equal(result.redEvent.beast, false);
    assert.equal(result.redEvent.acquired, true);
    assert.ok(char.inventory.includes('task_irikon'));
    assert.deepEqual(g.redDeck, ['wolf']);
  } finally {
    Math.random = originalRandom;
  }
});

test('красная клетка — после красной находки нельзя повторно зайти и фармить событие', () => {
  const g = freshGame();
  const originalRandom = Math.random;
  Math.random = () => 0.5; // исключаем отдельный 2% дроп Ирикона
  try {
    const { char } = stepOnEventCell(g, ['task_irikon', 'axe_sun']);

    assert.equal(g.turn.movementArea.locked, true);
    assert.deepEqual(
      availableMoveTargets(g, 'p1', char.id, 0),
      [],
    );
    assert.throws(
      () => apply(g, 'p1', 'action:move', {
        characterId: char.id,
        toCell: EVENT_NEIGHBOR,
        dieIndex: 0,
      }),
      /другую клетку/i,
    );
    assert.equal(char.inventory.filter(cardId => cardId === 'task_irikon').length, 1);
    assert.equal(char.inventory.includes('axe_sun'), false);
    assert.deepEqual(g.redDeck, ['axe_sun']);
  } finally {
    Math.random = originalRandom;
  }
});

test('красная клетка — старт броска на ней не позволяет уйти-вернуться и снова получить событие', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.position = EVENT_CELL;
  g.redDeck = ['task_irikon'];
  g.turn.dice = [1, 1];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  g.turn.rollStartPositions = Object.fromEntries(
    g.characters.map((character) => [character.id, character.position ?? null]),
  );
  const awayCell = neighbors(EVENT_CELL).find((cellId) =>
    !g.characters.some((character) => character.id !== warrior.id && character.position === cellId));

  const away = apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: awayCell,
    dieIndex: 0,
  });
  assert.equal(away.redEvent, null);

  const back = apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: EVENT_CELL,
    dieIndex: 1,
  });
  assert.equal(back.redEvent, null);
  assert.equal(warrior.inventory.includes('task_irikon'), false);
  assert.deepEqual(g.redDeck, ['task_irikon']);
});

test('красная клетка — Ирикон выпадает отдельным шансом 2%', () => {
  const g = freshGame();
  const originalRandom = Math.random;
  Math.random = () => 0.01;
  try {
    const { char, result } = stepOnEventCell(g, ['wolf']);
    assert.equal(char.beastFight, null);
    assert.equal(result.redEvent.cardId, 'irikon');
    assert.equal(result.redEvent.specialRoll, true);
    assert.equal(result.redEvent.acquired, true);
    assert.ok(char.inventory.includes('irikon'));
    assert.deepEqual(g.redDeck, ['wolf']);
  } finally {
    Math.random = originalRandom;
  }
});

test('красная клетка — Ирикон по редкому шансу выпадает только один раз', () => {
  const g = freshGame();
  const originalRandom = Math.random;
  Math.random = () => 0.01;
  try {
    const first = stepOnEventCell(g, ['wolf']).result;
    assert.equal(first.redEvent.cardId, 'irikon');

    const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
    warrior.position = EVENT_NEIGHBOR;
    warrior.beastFight = null;
    g.turn.movementArea = null;
    g.turn.movedCharacterId = null;
    g.turn.dice = [1, 2];
    g.turn.usedDice = [false, false];
    g.turn.mode = 'split';
    g.turn.hasRolled = true;
    const second = apply(g, 'p1', 'action:move', {
      characterId: warrior.id,
      toCell: EVENT_CELL,
      dieIndex: 0,
    });

    assert.notEqual(second.redEvent.cardId, 'irikon');
    assert.equal(second.redEvent.cardId, 'wolf');
  } finally {
    Math.random = originalRandom;
  }
});

test('красная клетка — пустая колода пересобирается и даёт красное событие', () => {
  const g = freshGame();
  const originalRandom = Math.random;
  Math.random = () => 0.5; // исключаем отдельный 2% дроп Ирикона
  try {
    const { char, result } = stepOnEventCell(g, []);
    assert.ok(result.redEvent);
    assert.ok(['boar_red', 'wolf', 'beast_bear', 'hide_red', 'raw_hide_red', 'axe_sun', 'task_irikon'].includes(result.redEvent.cardId));
    if (result.redEvent.beast) {
      assert.ok(char.beastFight, 'зверь должен напасть при звериной карте');
    } else {
      assert.ok(char.inventory.includes(result.redEvent.cardId) || g.discard.includes(result.redEvent.cardId));
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('зверь — кусает в начале хода владельца', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  apply(g, 'p1', 'turn:roll');
  assert.equal(warrior.hp, 95); // wolf.damage = 5
});

test('зверь — медведь кусает на 10, погибший персонаж снимается с поля', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'beast_bear', successes: 0 };
  warrior.hp = 10;
  apply(g, 'p1', 'turn:roll');
  assert.equal(warrior.hp, 0);
  assert.equal(warrior.position, null);
  assert.equal(warrior.beastFight, null);
  assert.equal(warrior.inventory.length, 0);
  assert.ok(g.discard.includes('teleport_beads')); // инвентарь ушёл в сброс
  assert.equal(g.over, false); // остальные персонажи живы
});

test('зверь — гибель последнего персонажа отдаёт победу противнику', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  for (const c of g.characters.filter(x => x.owner === 'p1' && x.id !== warrior.id)) {
    c.hp = 0;
    c.position = null;
  }
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  warrior.hp = 5;
  apply(g, 'p1', 'turn:roll');
  assert.equal(g.over, true);
  assert.equal(g.winnerId, 'p2');
});

test('fightBeast — kill даёт «Шкуру убитого зверя», туша зверя в сброс', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  g.turn.dice = [5, 1]; // wolf.killOn = 5
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 });
  assert.equal(result.beastFought.killed, true);
  assert.equal(result.beastFought.value, 5);
  assert.equal(result.beastFought.hide, 'wolf_hide');
  assert.equal(warrior.beastFight, null);
  assert.ok(warrior.inventory.includes('wolf_hide'));
  assert.ok(!warrior.inventory.includes('wolf')); // сам зверь в инвентарь не падает
  assert.ok(g.discard.includes('wolf'));
  assert.equal(g.turn.usedDice[0], true);
});

test('fightBeast — успехи копятся, мелкий кубик не считается', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  g.turn.dice = [1, 2]; // wolf.successOn = 2
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const miss = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 });
  assert.equal(miss.beastFought.killed, false);
  assert.equal(warrior.beastFight.successes, 0);
  const hit = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 1 });
  assert.equal(hit.beastFought.killed, false);
  assert.equal(warrior.beastFight.successes, 1);
});

test('fightBeast — needed успехов добивают зверя', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'wolf', successes: 2 }; // wolf.needed = 3
  g.turn.dice = [2, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 });
  assert.equal(result.beastFought.killed, true);
  assert.equal(result.beastFought.successes, 3);
  assert.equal(result.beastFought.damage, 1);
  assert.equal(warrior.beastFight, null);
  assert.ok(warrior.inventory.includes('wolf_hide'));
});

test('fightBeast — промах не снимает здоровье зверя', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'beast_bear', successes: 0 };
  g.turn.dice = [4, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:fightBeast', {
    characterId: warrior.id,
    dieIndex: 0,
  });

  assert.equal(result.beastFought.killed, false);
  assert.equal(result.beastFought.successes, 0);
  assert.equal(result.beastFought.damage, 0);
});

test('Гриффон — на террейне даёт Охотнику +1 к кубику против зверя', () => {
  const g = freshGame();
  const hunter = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  hunter.beastFight = { cardId: 'wolf', successes: 0 };
  g.turn.dice = [1, 6];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  placeGriffin(g, hunter);

  const result = apply(g, 'p1', 'action:fightBeast', {
    characterId: hunter.id,
    dieIndex: 0,
  });

  assert.equal(result.beastFought.value, 1);
  assert.equal(result.beastFought.effectiveValue, 2);
  assert.equal(result.beastFought.successes, 1);
  assert.ok(!g.discard.includes('griffin'));
  assert.equal(g.terrainCards.length, 1);
  assert.equal(g.terrainCards[0].faceDown, true);
});

test('Гриффон — два экземпляра на террейне дают Охотнику +2 против зверя', () => {
  const g = freshGame();
  const hunter = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  hunter.beastFight = { cardId: 'wolf', successes: 0 };
  hunter.inventory.push('griffin');
  g.turn.dice = [1, 6];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  placeGriffin(g, hunter);
  placeGriffin(g, hunter);

  const result = apply(g, 'p1', 'action:fightBeast', {
    characterId: hunter.id,
    dieIndex: 0,
  });

  assert.equal(result.beastFought.value, 1);
  assert.equal(result.beastFought.effectiveValue, 3);
  assert.equal(result.beastFought.successes, 1);
  assert.ok(g.terrainCards.every(card => card.faceDown));
});

test('Дубина — Воин убивает любого зверя одним кубиком 4+', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'beast_bear', successes: 0 };
  placeClub(g, warrior);
  g.turn.dice = [4, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:fightBeast', {
    characterId: warrior.id,
    dieIndex: 0,
  });

  assert.equal(result.beastFought.killed, true);
  assert.equal(result.beastFought.clubUsed, true);
  assert.equal(warrior.beastFight, null);
  assert.equal(g.terrainCards[0].faceDown, false);
  assert.deepEqual(result.beastFought.terrainCardsTurnedFaceDown, []);
});

test('закрытая Дубина не даёт бонус против зверя', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'beast_bear', successes: 0 };
  placeClub(g, warrior, true);
  g.turn.dice = [4, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:fightBeast', {
    characterId: warrior.id,
    dieIndex: 0,
  });

  assert.equal(result.beastFought.killed, false);
  assert.equal(result.beastFought.clubUsed, false);
});

test('fightBeast — без схватки отклоняется', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  assert.throws(
    () => apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 }),
    /не сражается со зверем/i,
  );
});

test('Озёрная лягушка — Шаман завершает схватку со зверем и карта возвращается', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('lake_frog');
  shaman.beastFight = { cardId: 'wolf', successes: 0, cellId: shaman.position };

  const result = apply(g, 'p1', 'action:useLakeFrog', { characterId: shaman.id });

  assert.equal(result.lakeFrogUsed.mode, 'beast');
  assert.equal(result.lakeFrogUsed.beastId, 'wolf');
  assert.equal(shaman.beastFight, null);
  assert.ok(g.discard.includes('wolf'));
  assert.ok(shaman.inventory.includes('lake_frog'));
  assert.ok(shaman.inventory.includes('wolf_hide'));
});

test('Озёрная лягушка — против игрока отключает оружие цели', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemySmith = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemySmith.position = neighbors(shaman.position)[0];
  shaman.inventory.push('lake_frog');
  enemySmith.inventory.push('irikon');

  const cast = apply(g, 'p1', 'action:useLakeFrog', { characterId: shaman.id, targetId: enemySmith.id });
  assert.equal(cast.lakeFrogUsed.mode, 'player');
  assert.ok(enemySmith.frogSpell);
  assert.ok(!shaman.inventory.includes('lake_frog'));

  g.turn.activePlayerId = 'p2';
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.hasRolled = true;
  const attack = apply(g, 'p2', 'action:attack', { attackerId: enemySmith.id, targetId: shaman.id });

  assert.equal(attack.attacked.weaponDisabledByLakeFrog, true);
  assert.equal(attack.attacked.weaponDamage, 0);
  assert.equal(attack.attacked.totalDamage, 7);
});

test('Озёрная лягушка — активная карта на террейне отключает оружие цели', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemySmith = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemySmith.position = neighbors(shaman.position)[0];
  enemySmith.inventory.push('irikon');
  g.terrainCards.push({
    id: 'terrain-frog',
    ownerId: 'p1',
    characterId: shaman.id,
    cardIndex: 0,
    cardId: 'lake_frog',
    faceDown: false,
    x: 0,
    y: 0,
  });

  const cast = apply(g, 'p1', 'action:useLakeFrog', {
    characterId: shaman.id,
    terrainCardId: 'terrain-frog',
    targetId: enemySmith.id,
  });

  assert.equal(cast.lakeFrogUsed.source, 'terrain');
  assert.ok(enemySmith.frogSpell);
  assert.equal(g.terrainCards.length, 0);
  assert.ok(!g.discard.includes('lake_frog'));
});

test('Озёрная лягушка — бросок суммы 8+ снимает заклятие и возвращает карту Шаману', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemySmith = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemySmith.position = neighbors(shaman.position)[0];
  shaman.inventory.push('lake_frog');
  apply(g, 'p1', 'action:useLakeFrog', { characterId: shaman.id, targetId: enemySmith.id });

  g.turn.activePlayerId = 'p2';
  g.turn.dice = null;
  g.turn.usedDice = [false, false];
  g.turn.hasRolled = false;
  const originalRandom = Math.random;
  Math.random = () => 0.5; // 4 + 4
  try {
    const result = apply(g, 'p2', 'turn:roll');
    assert.equal(result.roll.total, 8);
    assert.equal(enemySmith.frogSpell, null);
    assert.ok(shaman.inventory.includes('lake_frog'));
    assert.equal(result.roll.lakeFrogReleased.length, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('fightBeast — недоступен в режиме moveSum', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  g.turn.dice = [5, 1];
  g.turn.mode = 'moveSum';
  g.turn.hasRolled = true;
  assert.throws(
    () => apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 }),
    /split/i,
  );
});

test('зверь — в схватке нельзя брать карты, но можно телепортироваться', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  g.turn.dice = [2, 6];
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'boar_red', successes: 0 };
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: warrior.id, dieIndex: 0 }),
    /зверем.*не может брать карты/i,
  );
  const destination = startCell('green', 'K');
  const occupant = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  occupant.position = neighbors(occupant.position)[0];
  const result = apply(g, 'p1', 'action:teleport', {
    characterId: warrior.id,
    toCell: destination,
    dieIndex: 0,
  });
  assert.equal(result.teleported.success, true);
  assert.equal(result.teleported.escapedBeast, true);
  assert.equal(warrior.position, destination);
  assert.equal(warrior.beastFight, null);
});

test('зверь — атаковать игроков в схватке нельзя', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  enemy.position = neighbors(warrior.position)[0];
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  g.turn.dice = [3, 4];
  g.turn.mode = 'moveSum';
  g.turn.hasRolled = true;
  assert.deepEqual(availableAttackTargets(g, 'p1', warrior.id), []);
  assert.throws(
    () => apply(g, 'p1', 'action:attack', { attackerId: warrior.id, targetId: enemy.id }),
    /зверем нельзя атаковать/i,
  );
});

test('зверь — движение является побегом и сбрасывает схватку', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.position = EVENT_CELL;
  warrior.beastFight = { cardId: 'beast_bear', successes: 1 };
  g.redDeck = []; // чтобы новая встреча не началась
  g.turn.dice = [1, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const target = availableMoveTargets(g, 'p1', warrior.id, 0)[0];
  const result = apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: target.cellId,
    dieIndex: 0,
  });
  assert.equal(result.moved.escapedBeast, true);
  assert.equal(warrior.beastFight, null);
});

test('зверь — побег на соседнюю красную клетку начинает новую встречу', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.position = EVENT_NEIGHBOR;
  warrior.beastFight = { cardId: 'wolf', successes: 2 };
  g.redDeck = ['beast_bear'];
  g.redIrkonDropped = true;
  g.turn.dice = [1, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: EVENT_CELL,
    dieIndex: 0,
  });
  assert.equal(result.moved.escapedBeast, true);
  assert.equal(result.redEvent.cardId, 'beast_bear');
  assert.equal(result.redEvent.beast, true);
  assert.deepEqual(warrior.beastFight, {
    cardId: 'beast_bear',
    successes: 0,
    cellId: EVENT_CELL,
  });
});

// ── Граничные случаи ─────────────────────────────────────────────

test('команда в завершённой партии отклоняется', () => {
  const g = freshGame();
  g.over = true;
  assert.throws(() => apply(g, 'p1', 'turn:roll'), /партия завершена/i);
});

test('неизвестная команда отклоняется', () => {
  const g = freshGame();
  assert.throws(() => apply(g, 'p1', 'action:fly'), /недоступна/i);
});

test('оба кубика потрачены — значения остаются на столе до конца хода', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const p = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  placeOnResource(k);
  p.position = neighbors(k.position)[0]; // получатель рядом
  apply(g, 'p1', 'action:draw',     { characterId: k.id, dieIndex: 0 });
  apply(g, 'p1', 'action:transfer', { fromId: k.id, toId: p.id, dieIndex: 1 });
  assert.ok(Array.isArray(g.turn.dice));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

// ── Обработка шкуры шаманом ────────────────────────────────────────

test('processHide — шаман превращает сырую шкуру в очищенную (кубик ≥2)', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('wolf_hide');
  g.turn.dice = [3, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:processHide', { characterId: shaman.id, dieIndex: 0 });
  assert.equal(result.hideProcessed.success, true);
  assert.equal(result.hideProcessed.cleaned, 'beast_hide');
  assert.ok(shaman.inventory.includes('beast_hide'));
  assert.ok(!shaman.inventory.includes('wolf_hide'));
  assert.equal(g.turn.usedDice[0], true);
});

test('processHide — обрабатывает выбранную шкуру по индексу', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('boar_hide', 'sheep_hide_r');
  const sheepIndex = shaman.inventory.indexOf('sheep_hide_r');
  g.turn.dice = [3, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:processHide', {
    characterId: shaman.id,
    dieIndex: 0,
    cardIndex: sheepIndex,
  });

  assert.equal(result.hideProcessed.rawId, 'sheep_hide_r');
  assert.deepEqual(result.hideProcessed.produced, ['sheep_hide_c', 'sheep_wool']);
  assert.ok(shaman.inventory.includes('boar_hide'));
  assert.ok(!shaman.inventory.includes('sheep_hide_r'));
});

test('processHide — кубик 1 не очищает, шкура остаётся, кубик потрачен', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('raw_hide');
  g.turn.dice = [1, 4];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:processHide', { characterId: shaman.id, dieIndex: 0 });
  assert.equal(result.hideProcessed.success, false);
  assert.ok(shaman.inventory.includes('raw_hide'));
  assert.ok(!shaman.inventory.includes('beast_hide'));
  assert.equal(g.turn.usedDice[0], true);
});

test('processHide — только Шаман', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('raw_hide_red');
  g.turn.dice = [3, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  assert.throws(() => apply(g, 'p1', 'action:processHide', { characterId: warrior.id, dieIndex: 0 }), /Шаман/i);
});

// ── Крафт: Дубина по чертежу + очищенная шкура ─────────────────────

test('craft — очищенная шкура открывает Дубину, чертёж и шкура в сброс', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('hide_red'); // очищенная шкура от шамана
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  assert.ok(warrior.crafted.includes('club'));
  assert.ok(!warrior.inventory.includes('hide_red'));
  assert.ok(!warrior.inventory.includes('bp_club_base'));
  assert.ok(warrior.inventory.includes('club')); // сама Дубина остаётся
  assert.ok(g.discard.includes('hide_red'));
  assert.ok(g.discard.includes('bp_club_base'));
});

test('craft — сырая шкура НЕ открывает Дубину (нужна очищенная)', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('raw_hide_red'); // ещё не обработана — не материал дубины
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: warrior.id }), /материал/i);
});

test('craft — без материалов отклоняется', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: warrior.id }), /материал/i);
});

test('craft Молоток — открывается стартовой смешанной рудой при двух кубиках 3+', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  g.turn.dice = [3, 5];
  g.turn.hasRolled = true;
  apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'hammer' });
  assert.ok(smith.crafted.includes('hammer'));
  assert.ok(!smith.inventory.includes('ore_medium'));
  assert.ok(!smith.inventory.includes('bp_hammer_base'));
  assert.ok(smith.inventory.includes('hammer'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('craft Молоток — неудачное испытание сохраняет материалы', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  g.turn.dice = [2, 6];
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'hammer' });

  assert.equal(result.craftAttempt.success, false);
  assert.ok(smith.inventory.includes('ore_medium'));
  assert.ok(smith.inventory.includes('bp_hammer_base'));
  assert.ok(!smith.crafted.includes('hammer'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('craft Молоток — без смешанной руды отклоняется', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory = smith.inventory.filter(id => id !== 'ore_medium');
  g.turn.dice = [3, 5];
  g.turn.hasRolled = true;
  assert.throws(
    () => apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'hammer' }),
    /материал/i,
  );
});

test('Молоток — Кузнец на точке добычи берёт две карты', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.position = 'H002';
  smith.crafted.push('hammer');
  smith.inventory.push('hammer');
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const before = smith.inventory.length;

  const result = apply(g, 'p1', 'action:draw', { characterId: smith.id, dieIndex: 0 });

  assert.equal(result.drawn.count, 2);
  assert.equal(result.drawn.hammerUsed, true);
  assert.equal(result.drawn.bonusTool, 'hammer');
  assert.equal(smith.inventory.length, before + 2);
});

test('Молоток — два экземпляра на террейне дают три карты и переворачиваются', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.position = 'H002';
  smith.inventory = ['hammer', 'hammer'];
  smith.crafted = ['hammer'];
  for (let i = 0; i < 2; i += 1) {
    apply(g, 'p1', 'action:terrainPlace', {
      id: `hammer-${i}`,
      characterId: smith.id,
      cardIndex: 0,
      x: 100 + i * 20,
      y: 200,
    });
  }
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:draw', {
    characterId: smith.id,
    dieIndex: 0,
  });

  assert.equal(result.drawn.count, 3);
  assert.equal(result.drawn.bonusToolCount, 2);
  assert.ok(g.terrainCards.every(card => card.faceDown));
});

test('craft Мешок — клубок + очищенная шкура барана (помощник), без иглы', () => {
  const g = freshGame();
  const helper = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  helper.inventory.push('yarn');
  helper.inventory.push('sheep_hide_c');
  g.turn.dice = [3, 3];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  apply(g, 'p1', 'action:craft', { characterId: helper.id, item: 'sack' });
  assert.ok(helper.crafted.includes('sack'));
  assert.ok(!helper.inventory.includes('yarn'));        // клубок израсходован
  assert.ok(!helper.inventory.includes('sheep_hide_c'));
  assert.ok(!helper.inventory.includes('recipe_sack'));
  assert.ok(helper.inventory.includes('sack'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('craft Клубок — можно повторять из новой шерсти', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory = ['yarn', 'sheep_wool'];
  shaman.crafted = ['yarn'];
  g.turn.dice = [2, 6];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'yarn',
    dieIndex: 0,
  });

  assert.equal(shaman.inventory.filter(id => id === 'yarn').length, 2);
  assert.ok(!shaman.inventory.includes('sheep_wool'));
});

test('craft Мешок — без очищенной шкуры барана отклоняется', () => {
  const g = freshGame();
  const helper = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: helper.id, item: 'sack' }), /материал/i);
});

test('цепочка Мешка — Баран даёт шкуру, Шаман получает кожу и шерсть, Помощник крафтит Мешок', () => {
  const g = freshGame();
  const helper = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');

  g.turn.dice = [3, 6];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const fight = apply(g, 'p1', 'action:fightBeast', {
    characterId: helper.id,
    dieIndex: 0,
  });
  assert.equal(fight.beastFought.killed, true);
  assert.ok(helper.inventory.includes('sheep_hide_r'));
  assert.ok(!helper.inventory.includes('sheep_ram'));

  helper.inventory.splice(helper.inventory.indexOf('sheep_hide_r'), 1);
  shaman.inventory.push('sheep_hide_r');
  g.turn.dice = [2, 6];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  const cleaned = apply(g, 'p1', 'action:processHide', {
    characterId: shaman.id,
    dieIndex: 0,
  });
  assert.deepEqual(cleaned.hideProcessed.cleaned, ['sheep_hide_c', 'sheep_wool']);
  assert.deepEqual(cleaned.hideProcessed.produced, ['sheep_hide_c', 'sheep_wool']);
  assert.ok(shaman.inventory.includes('sheep_hide_c'));
  assert.ok(shaman.inventory.includes('sheep_wool'));

  g.turn.dice = [2, 6];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'yarn',
    dieIndex: 0,
  });
  assert.ok(shaman.inventory.includes('yarn'));
  assert.ok(!shaman.inventory.includes('sheep_wool'));

  shaman.inventory.splice(shaman.inventory.indexOf('sheep_hide_c'), 1);
  shaman.inventory.splice(shaman.inventory.indexOf('yarn'), 1);
  helper.inventory.push('sheep_hide_c');
  helper.inventory.push('yarn');
  g.turn.dice = [3, 3];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  apply(g, 'p1', 'action:craft', {
    characterId: helper.id,
    item: 'sack',
  });
  assert.ok(helper.inventory.includes('sack'));
  assert.ok(helper.crafted.includes('sack'));
});

test('Мешок — Помощник на точке добычи берёт две карты', () => {
  const g = freshGame();
  const helper = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  helper.position = 'H002';
  helper.crafted.push('sack');
  helper.inventory.push('sack');
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const before = helper.inventory.length;

  const result = apply(g, 'p1', 'action:draw', { characterId: helper.id, dieIndex: 0 });

  assert.equal(result.drawn.count, 2);
  assert.equal(result.drawn.bonusTool, 'sack');
  assert.equal(helper.inventory.length, before + 2);
});

test('craft Ковёр шамана — расходует Клубок и шкуру медведя при кубике 3+', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('yarn');
  shaman.inventory.push('bear_hide');
  g.turn.dice = [3, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'shaman_carpet',
    dieIndex: 0,
  });

  assert.ok(shaman.crafted.includes('shaman_carpet'));
  assert.ok(shaman.inventory.includes('shaman_carpet'));
  assert.ok(!shaman.inventory.includes('yarn'));
  assert.ok(!shaman.inventory.includes('bear_hide'));
  assert.ok(!shaman.inventory.includes('recipe_shaman_carpet'));
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('Ковёр шамана — два экземпляра на террейне лечат на 4 HP', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory = ['shaman_carpet', 'shaman_carpet'];
  shaman.crafted = ['shaman_carpet'];
  shaman.hp = 80;
  for (let i = 0; i < 2; i += 1) {
    apply(g, 'p1', 'action:terrainPlace', {
      id: `carpet-${i}`,
      characterId: shaman.id,
      cardIndex: 0,
      x: 100 + i * 20,
      y: 200,
    });
  }

  apply(g, 'p1', 'turn:roll');

  assert.equal(shaman.hp, 84);
  assert.ok(g.terrainCards.every(card => card.faceDown));
});

test('craft Ковёр шамана — кубик ниже 3 сохраняет рецепт и материалы', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('yarn');
  shaman.inventory.push('bear_hide');
  g.turn.dice = [2, 6];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'shaman_carpet',
    dieIndex: 0,
  });

  assert.equal(result.craftAttempt.success, false);
  assert.ok(!shaman.crafted.includes('shaman_carpet'));
  assert.ok(shaman.inventory.includes('yarn'));
  assert.ok(shaman.inventory.includes('bear_hide'));
  assert.ok(shaman.inventory.includes('recipe_shaman_carpet'));
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('craft Жест — рецепт брони шамана работает и расходует руду со шкурой', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('recipe_armor', 'ore_coarse', 'raw_hide');
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'armor_zhest',
  });

  assert.equal(result.crafted.item, 'armor_zhest');
  assert.ok(shaman.inventory.includes('armor_zhest'));
  assert.ok(shaman.crafted.includes('armor_zhest'));
  assert.ok(!shaman.inventory.includes('recipe_armor'));
  assert.ok(!shaman.inventory.includes('ore_coarse'));
  assert.ok(!shaman.inventory.includes('raw_hide'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('craft Жест — провал проверки сохраняет рецепт и материалы', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('recipe_armor', 'ore_medium', 'raw_hide_red');
  g.turn.dice = [2, 5];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'armor_zhest',
  });

  assert.equal(result.craftAttempt.success, false);
  assert.ok(!shaman.inventory.includes('armor_zhest'));
  assert.ok(shaman.inventory.includes('recipe_armor'));
  assert.ok(shaman.inventory.includes('ore_medium'));
  assert.ok(shaman.inventory.includes('raw_hide_red'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('craft Марво трос — рецепт обруда работает', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory.push('recipe_obrud', 'amanita_glade', 'lake_frog');
  g.turn.dice = [2, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:craft', {
    characterId: shaman.id,
    item: 'marvo',
  });

  assert.equal(result.crafted.item, 'marvo');
  assert.ok(shaman.inventory.includes('marvo'));
  assert.ok(shaman.crafted.includes('marvo'));
  assert.ok(!shaman.inventory.includes('recipe_obrud'));
  assert.ok(!shaman.inventory.includes('amanita_glade'));
  assert.ok(!shaman.inventory.includes('lake_frog'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('Марво трос — Обряд трёх наносит кубик ×10 по двум врагам рядом', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemyWarrior = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  const enemySmith = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemyWarrior.position = neighbors(shaman.position)[0];
  enemySmith.position = neighbors(shaman.position)[1];
  shaman.inventory.push('marvo');
  g.terrainCards.push({
    id: 'weapon-for-marvo',
    ownerId: shaman.owner,
    characterId: shaman.id,
    cardIndex: 0,
    cardId: 'sword_sech',
    faceDown: false,
    x: 0,
    y: 0,
  });
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:useMarvo', { characterId: shaman.id, dieIndex: 0 });

  assert.equal(result.marvoUsed.value, 3);
  assert.equal(result.marvoUsed.damage, 30);
  assert.equal(result.marvoUsed.targets.length, 2);
  assert.equal(enemyWarrior.hp, 70);
  assert.equal(enemySmith.hp, 70);
  assert.ok(g.discard.includes('marvo'));
  assert.ok(!shaman.inventory.includes('marvo'));
  assert.deepEqual(g.turn.usedDice, [true, false]);
});

test('Марво трос — активная карта на террейне тоже запускает Обряд трёх', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemyWarrior = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  const enemySmith = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemyWarrior.position = neighbors(shaman.position)[0];
  enemySmith.position = neighbors(shaman.position)[1];
  g.terrainCards.push({
    id: 'terrain-marvo',
    ownerId: shaman.owner,
    characterId: shaman.id,
    cardIndex: 0,
    cardId: 'marvo',
    faceDown: false,
    x: 0,
    y: 0,
  });
  g.terrainCards.push({
    id: 'weapon-for-terrain-marvo',
    ownerId: shaman.owner,
    characterId: shaman.id,
    cardIndex: 1,
    cardId: 'sword_sech',
    faceDown: false,
    x: 0,
    y: 0,
  });
  g.turn.dice = [4, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:useMarvo', {
    characterId: shaman.id,
    terrainCardId: 'terrain-marvo',
    dieIndex: 0,
  });

  assert.equal(result.marvoUsed.source, 'terrain');
  assert.equal(result.marvoUsed.damage, 40);
  assert.equal(enemyWarrior.hp, 60);
  assert.equal(enemySmith.hp, 60);
  assert.ok(g.discard.includes('marvo'));
  assert.deepEqual(g.terrainCards.map(card => card.id), ['weapon-for-terrain-marvo']);
});

test('Марво трос — без активного оружия на террейне не срабатывает', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemyWarrior = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  const enemySmith = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemyWarrior.position = neighbors(shaman.position)[0];
  enemySmith.position = neighbors(shaman.position)[1];
  shaman.inventory.push('marvo');
  g.turn.dice = [3, 4];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p1', 'action:useMarvo', { characterId: shaman.id, dieIndex: 0 }),
    /активное оружие/i,
  );
  assert.ok(shaman.inventory.includes('marvo'));
  assert.ok(!g.discard.includes('marvo'));
});

test('craft — изделие открывает только свой класс', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('hide_red');
  // кузнец пытается открыть Дубину (изделие воина)
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'club' }), /только Воин/i);
});

test('craft — повторный чертёж создаёт ещё один экземпляр изделия', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('hide_red');
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  warrior.inventory.push('bp_club_base', 'hide_red');
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  assert.equal(warrior.inventory.filter(id => id === 'club').length, 2);
});

test('craft — кубики не тратятся (бесплатное действие)', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('beast_hide');
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  assert.deepEqual(g.turn.usedDice, [false, false]);
  assert.ok(g.turn.dice);
});

test('Дубина — после броска хода сама не бьёт и не переворачивается', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy   = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  placeClub(g, warrior);
  warrior.combatOpponentId = enemy.id;
  enemy.combatOpponentId = warrior.id;
  enemy.hp = 35;
  apply(g, 'p1', 'turn:roll');
  assert.equal(enemy.hp, 35);
  assert.equal(g.terrainCards[0].faceDown, false);
});

test('Дубина — две активные карты на террейне добавляют 20 HP к атаке по клику', () => {
  const g = freshGame();
  const { warrior, enemy } = setupClubAttack(g);
  placeClub(g, warrior);
  placeClub(g, warrior);
  enemy.hp = 35;

  const r = apply(g, 'p1', 'action:attack', { attackerId: warrior.id, targetId: enemy.id });

  assert.equal(r.attacked.damage, 7);
  assert.equal(r.attacked.clubDamage, 20);
  assert.equal(r.attacked.clubCount, 2);
  assert.equal(r.attacked.totalDamage, 27);
  assert.equal(enemy.hp, 8);
  assert.ok(g.terrainCards.every(card => !card.faceDown));
});

test('Дубина — добивание атакой отдаёт добычу владельцу', () => {
  const g = freshGame();
  const { warrior, enemy } = setupClubAttack(g, [1, 1]);
  placeClub(g, warrior);
  enemy.hp = 12;
  enemy.inventory = ['loot-1'];
  const before = warrior.inventory.length;
  const r = apply(g, 'p1', 'action:attack', { attackerId: warrior.id, targetId: enemy.id });
  assert.equal(enemy.hp, 0);
  assert.equal(r.attacked.clubDamage, 10);
  assert.equal(r.attacked.totalDamage, 12);
  assert.equal(enemy.position, null);
  assert.ok(warrior.inventory.includes('loot-1'));
  assert.equal(warrior.inventory.length, before + 1);
  assert.equal(warrior.combatOpponentId, null);
});

test('Дубина — в инвентаре без выкладывания не даёт бонус к атаке', () => {
  const g = freshGame();
  const { warrior, enemy } = setupClubAttack(g);
  warrior.crafted.push('club');
  warrior.inventory.push('club');
  enemy.hp = 35;
  const r = apply(g, 'p1', 'action:attack', { attackerId: warrior.id, targetId: enemy.id });
  assert.equal(r.attacked.clubDamage, 0);
  assert.equal(enemy.hp, 28);
});

// ── Классовые ограничения по правилам ─────────────────────────────

test('craft — Дубину может открыть только Воин (по классу)', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('bp_club_base', 'club', 'wolf');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: smith.id }), /только Воин/i);
});

test('Дубина — у не-Воина эффекта нет даже если карта выложена и есть в crafted', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  smith.inventory.push('club');
  smith.crafted = ['club']; // искусственно — обходим проверку класса в craft()
  enemy.position = neighbors(smith.position).find(id => !g.characters.some(c => c.position === id));
  apply(g, 'p1', 'action:terrainPlace', {
    id: 'club-smith',
    characterId: smith.id,
    cardIndex: smith.inventory.indexOf('club'),
    x: 120,
    y: 220,
    faceDown: false,
  });
  enemy.hp = 35;
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];
  g.turn.hasRolled = true;
  const r = apply(g, 'p1', 'action:attack', { attackerId: smith.id, targetId: enemy.id });
  assert.equal(r.attacked.clubDamage, 0);
  assert.equal(enemy.hp, 28); // только кубики — Кузнец не Воин
  assert.equal(g.terrainCards[0].faceDown, false);
});

// ── Передача только в пределах одной клетки ───────────────────────

test('transfer (ящик) — работает на любом расстоянии', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const o = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  // Стартовые позиции K и O разные и не соседние — передача всё равно проходит
  assert.notEqual(k.position, o.position);
  o.inventory = [];
  const card = k.inventory[0];
  apply(g, 'p1', 'action:transfer', { fromId: k.id, toId: o.id, cardIndex: 0, dieIndex: 0 });
  assert.equal(o.inventory[0], card);
});

test('transfer (легаси) — работает на любом расстоянии', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const o = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  assert.notEqual(k.position, o.position);
  o.inventory = [];
  const before = k.inventory.length;
  apply(g, 'p1', 'action:transfer', { fromId: k.id, toId: o.id, dieIndex: 0 });
  assert.ok(k.inventory.length < before);
  assert.ok(o.inventory.length > 0);
});

// ── Один бросок: кубики можно распределить между персонажами, добор один ─────────────

test('move (split) — каждый персонаж тратит свои кубики в одном ходу', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [2, 2]; g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  g.turn.diceByCharacter[v.id] = [2, 2];
  g.turn.diceByCharacter[k.id] = [2, 2];
  g.turn.usedDiceByCharacter[v.id] = [false, false];
  g.turn.usedDiceByCharacter[k.id] = [false, false];
  g.turn.activeDiceCharacterId = v.id;
  g.turn.dice = g.turn.diceByCharacter[v.id];
  g.turn.usedDice = g.turn.usedDiceByCharacter[v.id];
  const t1 = availableMoveTargets(g, 'p1', v.id, 0)[0];
  apply(g, 'p1', 'action:move', { characterId: v.id, toCell: t1.cellId, dieIndex: 0 });
  assert.deepEqual(g.turn.usedDiceByCharacter[v.id], [true, false]);
  assert.deepEqual(g.turn.usedDiceByCharacter[k.id], [false, false]);

  // Другой персонаж использует свой кубик: остатки очков первого кубика ему не передаются.
  g.turn.activeDiceCharacterId = k.id;
  g.turn.dice = g.turn.diceByCharacter[k.id];
  g.turn.usedDice = g.turn.usedDiceByCharacter[k.id];
  const t2 = availableMoveTargets(g, 'p1', k.id, 0)[0];
  assert.ok(t2);
  apply(g, 'p1', 'action:move', { characterId: k.id, toCell: t2.cellId, dieIndex: 0 });
  assert.equal(k.position, t2.cellId);
  assert.deepEqual(g.turn.usedDiceByCharacter[v.id], [true, false]);
  assert.deepEqual(g.turn.usedDiceByCharacter[k.id], [true, false]);
  assert.equal(g.turn.movementArea.characterId, k.id);
});

test('move (split) — другой кубик открывает вторую ногу, активная нога остаётся за первым', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1]; g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const t1 = availableMoveTargets(g, 'p1', v.id, 0)[0];
  apply(g, 'p1', 'action:move', { characterId: v.id, toCell: t1.cellId, dieIndex: 0 });
  // Второй кубик теперь открывает ногу от текущей клетки (не пусто).
  assert.ok(availableMoveTargets(g, 'p1', v.id, 1).length > 0);
  // Пока ход вторым кубиком не сделан — активной остаётся первая нога.
  assert.equal(g.turn.movementArea.dieIndex, 0);
});

test('draw — второй добор в одном броске отклоняется', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const p = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  placeOnResource(k);
  placeOnResource(p);
  apply(g, 'p1', 'action:draw', { characterId: k.id, dieIndex: 0 });
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: p.id, dieIndex: 1 }),
    /один раз за бросок/i,
  );
});

test('ограничения движения/добора сбрасываются с новым броском', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1]; g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  placeOnResource(k);
  const t1 = availableMoveTargets(g, 'p1', v.id, 0)[0];
  apply(g, 'p1', 'action:move', { characterId: v.id, toCell: t1.cellId, dieIndex: 0 });
  apply(g, 'p1', 'action:draw', { characterId: k.id, dieIndex: 1 });
  // полный круг ходов → новый бросок p1
  apply(g, 'p1', 'turn:end');
  apply(g, 'p2', 'turn:end');
  apply(g, 'p1', 'turn:roll');
  assert.equal(g.turn.movedCharacterId, null);
  assert.equal(g.turn.drawnThisTurn, false);
});

test('transfer — в бою можно передать карты бойцу с соседней клетки (подвоз)', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const fighter = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const ally    = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemy   = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  // Боец в бою с врагом, союзник подошёл на соседнюю клетку
  fighter.combatOpponentId = enemy.id;
  enemy.combatOpponentId = fighter.id;
  ally.position = neighbors(fighter.position)[0];
  ally.inventory = ['bark'];
  const before = fighter.inventory.length;
  apply(g, 'p1', 'action:transfer', { fromId: ally.id, toId: fighter.id, cardIndex: 0, dieIndex: 0 });
  assert.equal(fighter.inventory.length, before + 1);
  assert.ok(fighter.inventory.includes('bark'));
});

// ── Гриффон: спутник Охотника, бонусный урон при слабом броске ─────

function setupGriffinAttack(g, role) {
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === role);
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemy.position = neighbors(attacker.position)[0];
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1]; // сумма 2 → гриффон бьёт на 10
  g.turn.usedDice = [false, false];
  return { attacker, enemy };
}

function placeGriffin(g, attacker, faceDown = false) {
  const cardIndex = attacker.inventory.indexOf('griffin');
  apply(g, 'p1', 'action:terrainPlace', {
    id: `griffin-${attacker.role}-${g.terrainCards.length}`,
    characterId: attacker.id,
    cardIndex,
    x: 100,
    y: 200,
    faceDown,
  });
}

function placeClub(g, warrior, faceDown = false) {
  if (!warrior.crafted.includes('club')) warrior.crafted.push('club');
  if (!warrior.inventory.includes('club')) warrior.inventory.push('club');
  const cardIndex = warrior.inventory.indexOf('club');
  apply(g, warrior.owner, 'action:terrainPlace', {
    id: `club-${warrior.id}-${g.terrainCards.length}`,
    characterId: warrior.id,
    cardIndex,
    x: 120,
    y: 220,
    faceDown,
  });
}

function setupClubAttack(g, dice = [3, 4]) {
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemy.position = neighbors(warrior.position).find(id =>
    !g.characters.some(c => c.position === id));
  g.turn.dice = dice;
  g.turn.usedDice = [false, false];
  g.turn.hasRolled = true;
  return { warrior, enemy };
}

test('Гриффон — сумма 2 даёт +10 и переворачивает карту рубашкой вверх', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O'); // у Охотника гриффон с рождения
  placeGriffin(g, attacker);
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 10);
  assert.equal(r.attacked.totalDamage, 12);
  assert.equal(enemy.hp, 88);
  assert.ok(!g.discard.includes('griffin'));
  assert.equal(g.terrainCards.length, 1);
  assert.equal(g.terrainCards[0].faceDown, true);
});

test('Гриффон — два активных экземпляра складывают бонусный урон', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  placeGriffin(g, attacker);
  attacker.inventory.push('griffin');
  placeGriffin(g, attacker);

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });

  assert.equal(r.attacked.griffinDamage, 20);
  assert.equal(r.attacked.totalDamage, 22);
  assert.equal(enemy.hp, 78);
  assert.ok(g.terrainCards.every(card => card.faceDown));
});
test('Гриффон — у не-Охотника бонуса нет (эффект только по классу)', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'V');
  attacker.inventory.push('griffin'); // передали воину — носить можно, применять нет
  placeGriffin(g, attacker);
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 0);
  assert.equal(enemy.hp, 98); // только сумма кубиков
});

test('Гриффон — закрытая карта не наносит дополнительный урон', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  placeGriffin(g, attacker, true);
  g.turn.dice = [1, 2];
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 0);
  assert.equal(enemy.hp, 97);
});

test('Гриффон — охотник без Гриффона на террейне бонуса не получает', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 0);
  assert.equal(enemy.hp, 98);
});

test('Гриффон — сумма 3 даёт +20', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  placeGriffin(g, attacker);
  g.turn.dice = [1, 2];
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 20);
  assert.equal(r.attacked.totalDamage, 23);
  assert.equal(enemy.hp, 77);
});

test('Гриффон — сумма 4 даёт +25 урона', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  placeGriffin(g, attacker);
  g.turn.dice = [2, 2];
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 25);
  assert.equal(r.attacked.totalDamage, 29);
  assert.equal(enemy.hp, 71);
});

test('Гриффон — сумма 5 даёт +30 урона', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  placeGriffin(g, attacker);
  g.turn.dice = [2, 3];
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 30);
  assert.equal(r.attacked.totalDamage, 35);
  assert.equal(enemy.hp, 65);
});

test('Гриффон — сумма 6 и выше сохраняет максимальный урон +30', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  placeGriffin(g, attacker);
  g.turn.dice = [3, 3];
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 30);
  assert.equal(r.attacked.totalDamage, 36);
  assert.equal(enemy.hp, 64);
});

test('terrain — владелец может снова открыть использованного Гриффона', () => {
  const g = freshGame();
  const hunter = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  placeGriffin(g, hunter, true);

  const result = apply(g, 'p1', 'action:terrainFlip', {
    id: 'griffin-O-0',
    faceDown: false,
  });

  assert.equal(result.terrainFlipped.faceDown, false);
  assert.equal(g.terrainCards[0].faceDown, false);
});

test('terrain — противник не может перевернуть чужую карту', () => {
  const g = freshGame();
  const hunter = g.characters.find(c => c.owner === 'p1' && c.role === 'O');
  placeGriffin(g, hunter, true);
  g.turn.activePlayerId = 'p2';

  assert.throws(
    () => apply(g, 'p2', 'action:terrainFlip', {
      id: 'griffin-O-0',
      faceDown: false,
    }),
    /только владелец/i,
  );
});

// ── Феникс и перо (квест Иерихон) ─────────────────────────────────

// H141 — клетка terrain 'event', deck 'fairy_glade' (вход на Сказочную опушку);
// H134 — её сосед-path.
const FAIRY_CELL = 'H141';
const FAIRY_NEIGHBOR = 'H134';

// Ставит персонажа p1 рядом со Сказочной опушкой, подкручивает колоду феникса
// и делает ход на опушку одним кубиком (split). Запускает схватку с фениксом.
function stepOnFairyCell(g, fairyDeck = ['phoenix_1', 'phoenix_2'], role = 'V') {
  const char = g.characters.find(c => c.owner === 'p1' && c.role === role);
  char.position = FAIRY_NEIGHBOR;
  g.fairyDeck = fairyDeck;
  g.turn.dice = [1, 2];
  g.turn.usedDice = [false, false];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:move', {
    characterId: char.id,
    toCell: FAIRY_CELL,
    dieIndex: 0,
  });
  return { char, result };
}

test('Сказочная опушка — вход запускает схватку с фениксом', () => {
  const g = freshGame();
  const { char, result } = stepOnFairyCell(g, ['phoenix_1', 'phoenix_2']);
  assert.ok(char.beastFight, 'феникс должен напасть');
  assert.equal(char.beastFight.cardId, 'phoenix_1');
  assert.equal(result.redEvent.cardId, 'phoenix_1');
  assert.equal(result.redEvent.beast, true);
  assert.deepEqual(g.fairyDeck, ['phoenix_2']);
});

test('Сказочная опушка — пустая колода феникса не создаёт события', () => {
  const g = freshGame();
  const { char, result } = stepOnFairyCell(g, []);
  assert.equal(char.beastFight, null, 'фениксы кончились — события нет');
  assert.equal(result.redEvent, null);
});

test('Феникс — убийство (кубик 6) кладёт золотое перо в инвентарь', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'phoenix_1', successes: 0, cellId: warrior.position };
  g.turn.dice = [6, 1]; // phoenix.killOn = 6
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 });
  assert.equal(result.beastFought.killed, true);
  assert.equal(result.beastFought.trophy, 'gold_feather_own');
  assert.equal(warrior.beastFight, null);
  assert.ok(warrior.inventory.includes('gold_feather_own'));
  assert.ok(g.discard.includes('phoenix_1')); // туша феникса в сброс
});

test('Феникс — второй вариант кладёт перо к кузнецу врага', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'phoenix_2', successes: 0, cellId: warrior.position };
  g.turn.dice = [6, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 });
  assert.equal(result.beastFought.killed, true);
  assert.equal(result.beastFought.trophy, 'gold_feather_enemy');
  assert.ok(warrior.inventory.includes('gold_feather_enemy'));
  assert.ok(g.discard.includes('phoenix_2'));
});

test('Перо-маяк — носитель не скрывается туманом в снапшоте соперника', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  // Уносим персонажа далеко от чужих фишек, чтобы он был вне радиуса тумана p2.
  warrior.position = FAIRY_CELL;
  warrior.inventory.push('gold_feather_own');
  const snap = snapshotGame(g, 'p2');
  const view = snap.characters.find(c => c.id === warrior.id);
  assert.equal(view.beacon, true);
  assert.equal(view.hidden, false);
  assert.equal(view.position, FAIRY_CELL, 'позиция видна даже вне радиуса тумана');
});

test('Перо-маяк — без пера враг вне радиуса тумана скрыт', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.position = FAIRY_CELL;
  const snap = snapshotGame(g, 'p2');
  const view = snap.characters.find(c => c.id === warrior.id);
  assert.equal(view.beacon, false);
  assert.equal(view.hidden, true);
  assert.equal(view.position, null);
});

test('Перо — видно сопернику в publicCards', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('gold_feather_own');
  const snap = snapshotGame(g, 'p2');
  const view = snap.characters.find(c => c.id === warrior.id);
  assert.ok(view.publicCards.some(card => card.id === 'gold_feather_own'));
});

test('Перо — нельзя передать дистанционно обычной передачей', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  warrior.inventory.unshift('gold_feather_own');
  warrior.position = FAIRY_CELL;
  g.turn.dice = [3, 1];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  assert.throws(
    () => apply(g, 'p1', 'action:transfer', {
      fromId: warrior.id,
      toId: smith.id,
      dieIndex: 0,
    }),
    /перо нельзя передать через поле/i,
  );
});

test('Перо — доставка на свой камень кузнеца завершает матч победой', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const stone = blacksmithStoneForSide('green');
  warrior.position = neighbors(stone).find(id => !g.characters.some(c => c.position === id));
  warrior.inventory.push('gold_feather_own');
  g.turn.dice = [1, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: stone,
    dieIndex: 0,
  });

  assert.equal(g.over, true);
  assert.equal(g.winnerId, 'p1');
  assert.equal(result.featherVictory.cellId, stone);
  assert.equal(result.featherVictory.cardId, 'gold_feather_own');
});

test('Перо — доставка на вражеский камень кузнеца завершает матч победой носителя', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const stone = blacksmithStoneForSide('red');
  warrior.position = neighbors(stone).find(id => !g.characters.some(c => c.position === id));
  warrior.inventory.push('gold_feather_enemy');
  g.turn.dice = [1, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const result = apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: stone,
    dieIndex: 0,
  });

  assert.equal(g.over, true);
  assert.equal(g.winnerId, 'p1');
  assert.equal(result.featherVictory.cellId, stone);
  assert.equal(result.featherVictory.characterId, warrior.id);
  assert.equal(result.featherVictory.cardId, 'gold_feather_enemy');
});

test('сценарий пера — Феникс, маяк, передача Кузнецу и крафт Ирикон', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');

  const { result: eventResult } = stepOnFairyCell(g, ['phoenix_1'], 'V');
  assert.equal(eventResult.redEvent.cardId, 'phoenix_1');
  assert.equal(warrior.beastFight.cardId, 'phoenix_1');

  g.turn.usedDice = [false, false];
  g.turn.dice = [6, 1];
  const fightResult = apply(g, 'p1', 'action:fightBeast', {
    characterId: warrior.id,
    dieIndex: 0,
  });
  assert.equal(fightResult.beastFought.killed, true);
  assert.equal(fightResult.beastFought.trophy, 'gold_feather_own');
  assert.ok(warrior.inventory.includes('gold_feather_own'));

  const enemyViewBeforeTransfer = snapshotGame(g, 'p2')
    .characters.find(c => c.id === warrior.id);
  assert.equal(enemyViewBeforeTransfer.beacon, true);
  assert.equal(enemyViewBeforeTransfer.hidden, false);
  assert.ok(enemyViewBeforeTransfer.publicCards.some(card => card.id === 'gold_feather_own'));

  const featherIndex = warrior.inventory.indexOf('gold_feather_own');
  g.turn.usedDice = [false, false];
  g.turn.dice = [1, 4];
  assert.throws(
    () => apply(g, 'p1', 'action:transfer', {
      fromId: warrior.id,
      toId: smith.id,
      cardIndex: featherIndex,
      dieIndex: 1,
    }),
    /перо нельзя передать через поле/i,
  );

  warrior.position = neighbors(smith.position)[0];
  g.turn.usedDice = [false, false];
  g.turn.dice = [1, 4];
  const transferResult = apply(g, 'p1', 'action:transfer', {
    fromId: warrior.id,
    toId: smith.id,
    cardIndex: featherIndex,
    dieIndex: 1,
  });
  assert.equal(transferResult.transferred.cardId, 'gold_feather_own');
  assert.ok(!warrior.inventory.includes('gold_feather_own'));
  assert.ok(smith.inventory.includes('gold_feather_own'));

  smith.inventory.push('blueprint_irikon', 'task_irikon');
  g.turn.usedDice = [false, false];
  g.turn.dice = [3, 4];
  const craftResult = apply(g, 'p1', 'action:craft', {
    characterId: smith.id,
    item: 'irikon',
  });
  assert.equal(craftResult.crafted.item, 'irikon');
  assert.ok(smith.crafted.includes('irikon'));
  assert.ok(smith.inventory.includes('irikon'));
  assert.ok(!smith.inventory.includes('blueprint_irikon'));
  assert.ok(!smith.inventory.includes('task_irikon'));
  assert.ok(!smith.inventory.includes('gold_feather_own'));
});

test('craft Ирикон — чертёж + задание + перо при двух кубиках 3+', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('blueprint_irikon', 'task_irikon', 'gold_feather_own');
  g.turn.dice = [3, 4];
  g.turn.hasRolled = true;
  apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'irikon' });
  assert.ok(smith.crafted.includes('irikon'));
  assert.ok(smith.inventory.includes('irikon'));
  assert.ok(!smith.inventory.includes('blueprint_irikon'));
  assert.ok(!smith.inventory.includes('task_irikon'));
  assert.ok(!smith.inventory.includes('gold_feather_own'));
  assert.deepEqual(g.turn.usedDice, [true, true]);
});

test('craft Ирикон — кубик ниже 3 проваливает крафт без расхода', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('blueprint_irikon', 'task_irikon', 'gold_feather_own');
  g.turn.dice = [2, 5];
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'irikon' });
  assert.equal(result.craftAttempt.success, false);
  assert.ok(!smith.crafted.includes('irikon'));
  assert.ok(smith.inventory.includes('blueprint_irikon'));
  assert.ok(smith.inventory.includes('task_irikon'));
  assert.ok(smith.inventory.includes('gold_feather_own'));
});

test('Ирикон — атака Кузнеца +35 урона, Молот остаётся в инвентаре', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  enemy.position = neighbors(smith.position)[0];
  smith.inventory.push('irikon');
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1]; // базовый урон 2
  g.turn.usedDice = [false, false];
  const r = apply(g, 'p1', 'action:attack', { attackerId: smith.id, targetId: enemy.id });
  assert.equal(r.attacked.weaponDamage, 35);
  assert.equal(r.attacked.weaponName, 'Молот Иерихон');
  assert.equal(r.attacked.totalDamage, 37); // 2 (кубики) + 35
  assert.equal(enemy.hp, 63);
  assert.ok(smith.inventory.includes('irikon'), 'Молот многоразовый — остаётся в инвентаре');
});

test('Ирикон — активный молот на террейне тоже работает в бою', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  enemy.position = neighbors(smith.position)[0];
  g.terrainCards.push({
    id: 'weapon-irikon',
    ownerId: 'p1',
    characterId: smith.id,
    cardIndex: 0,
    cardId: 'irikon',
    faceDown: false,
    x: 0,
    y: 0,
  });
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1];
  g.turn.usedDice = [false, false];
  const r = apply(g, 'p1', 'action:attack', { attackerId: smith.id, targetId: enemy.id });
  assert.equal(r.attacked.weaponDamage, 35);
  assert.equal(r.attacked.weaponName, 'Молот Иерихон');
  assert.equal(r.attacked.weaponPiercing, true);
  assert.equal(r.attacked.dealtDamage, 37);
  assert.equal(enemy.hp, 63);
  assert.equal(g.terrainCards[0].faceDown, false);
});

test('Ирикон — у не-Кузнеца не срабатывает и возвращает причину', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  enemy.position = neighbors(shaman.position)[0];
  shaman.inventory.push('irikon');
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [3, 4];
  g.turn.usedDice = [false, false];

  const r = apply(g, 'p1', 'action:attack', { attackerId: shaman.id, targetId: enemy.id });

  assert.equal(r.attacked.weaponDamage, 0);
  assert.equal(r.attacked.weaponSuppressedReason, 'wrong_role');
  assert.equal(r.attacked.weaponSuppressedName, 'Молот Иерихон');
  assert.equal(r.attacked.weaponSuppressedRole, 'K');
  assert.equal(r.attacked.totalDamage, 7);
  assert.equal(enemy.hp, 93);
});

// ── Ловушки (Блеф) ───────────────────────────────────────────────

// Кладёт карту-ловушку рубашкой вверх на фишку защищающегося напрямую
// (placeTrap минует ход владельца — для изоляции логики attack()).
function placeTrap(game, defender, cardId, { faceDown = true } = {}) {
  game.terrainCards.push({
    id: `trap-${cardId}`, ownerId: defender.owner, characterId: defender.id,
    cardIndex: 0, cardId, faceDown, x: 0, y: 0,
  });
}

test('ловушка Мухомор — атакованный владелец бьёт нападающего на 10 и сбрасывает карту', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  placeTrap(g, target, 'amanita');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.traps.length, 1);
  assert.equal(r.attacked.traps[0].cardId, 'amanita');
  assert.equal(r.attacked.traps[0].attackerSelfDamage, 10);
  assert.equal(attacker.hp, 90);          // нападающий потерял 10
  assert.equal(target.hp, 93);            // удар по цели прошёл как обычно
  assert.equal(g.terrainCards.length, 0); // ловушка ушла с поля
  assert.ok(g.discard.includes('amanita'));
});

test('ловушка Мухомор — лицом вверх не срабатывает как ловушка', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  placeTrap(g, target, 'amanita', { faceDown: false });

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.traps.length, 0);
  assert.equal(attacker.hp, 100);
  assert.equal(g.terrainCards.length, 1); // осталась на поле
});

test('ловушка Мухомор — добивает нападающего (attackerDefeated)', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  attacker.hp = 8;
  placeTrap(g, target, 'amanita');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.attackerDefeated, true);
  assert.equal(attacker.hp, 0);
  assert.equal(attacker.position, null); // выбыл с поля
});

test('ловушка Кольцо возврата — зеркалит весь урон нападающему', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g); // кубики [3,4] → урон 7
  placeTrap(g, target, 'return_ring');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.totalDamage, 7);
  assert.equal(target.hp, 93);
  assert.equal(r.attacked.traps[0].cardId, 'return_ring');
  assert.equal(r.attacked.traps[0].attackerSelfDamage, 7); // зеркало = нанесённый урон
  assert.equal(attacker.hp, 93);                            // нападающий получил столько же
  assert.equal(g.terrainCards.length, 0);
  assert.ok(g.discard.includes('return_ring'));
});

test('ловушка Чёрные ягоды — атака не наносит урона (возврат лечением)', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  placeTrap(g, target, 'black_berries');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.dealtDamage, 0);
  assert.equal(target.hp, 100);                 // урон возвращён лечением, net 0
  assert.equal(r.attacked.traps[0].negated, true);
  assert.equal(attacker.hp, 100);               // нападающий невредим
  assert.ok(g.discard.includes('black_berries'));
});

test('ловушка Обычная сова — атака гасится и нападающий отброшен к старту', () => {
  const g = freshGame();
  const attacker = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  const start = startCell('green', 'V');
  const occupied = id => g.characters.some(c => c.hp > 0 && c.position === id);
  // нападающий — в одном борде от своего старта (сам старт свободен, он с него сошёл),
  // цель — другой свободный сосед, не на стартовой клетке.
  attacker.position = neighbors(start).find(n => !occupied(n));
  assert.ok(attacker.position);
  target.position = neighbors(attacker.position).find(n => n !== start && !occupied(n));
  assert.ok(target.position);
  g.turn.dice = [3, 4];
  g.turn.mode = 'moveSum';
  g.turn.hasRolled = true;
  placeTrap(g, target, 'owl_common');

  const distBefore = shortestDistance(attacker.position, start);
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.dealtDamage, 0);
  assert.equal(target.hp, 100);
  assert.equal(r.attacked.traps[0].retreat, 6);
  assert.ok(shortestDistance(attacker.position, start) < distBefore); // отошёл к старту
  assert.equal(attacker.combatOpponentId, null);                       // бой разорван
  assert.ok(g.discard.includes('owl_common'));
});

// ── DoT-ловушки (урон во времени) ────────────────────────────────

test('ловушка Полянка мухоморов — сразу -20 и вешает DoT на нападающего', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  placeTrap(g, target, 'amanita_glade');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.traps[0].dot, 10);
  assert.equal(r.attacked.traps[0].attackerSelfDamage, 20);
  assert.equal(attacker.hp, 80);            // -20 сразу
  assert.equal(attacker.dots.length, 1);
  assert.equal(attacker.dots[0].cardId, 'amanita_glade');
  assert.equal(target.hp, 93);              // обычный удар по цели прошёл
  assert.equal(g.terrainCards.length, 0);   // карта ушла с поля защитника
});

test('DoT — тикает в начале хода носителя', () => {
  const g = freshGame();
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  v.dots.push({ cardId: 'red_berries', damagePerTurn: 5, dischargeMin: 4, name: 'Дикие красные ягоды' });

  apply(g, 'p1', 'turn:roll'); // applyTurnStartEffects тикает DoT

  assert.equal(v.hp, 95);
});

test('dischargeDot — кубик 5+ снимает Полянку', () => {
  const g = freshGame();
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  v.dots.push({ cardId: 'amanita_glade', damagePerTurn: 10, dischargeMin: 5, name: 'Полянка мухоморов' });
  g.turn.dice = [5, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const r = apply(g, 'p1', 'action:dischargeDot', { characterId: v.id, dotIndex: 0, dieIndex: 0 });

  assert.equal(r.dotDischarged.success, true);
  assert.equal(v.dots.length, 0);
  assert.ok(g.discard.includes('amanita_glade'));
});

test('dischargeDot — кубик ниже порога оставляет ловушку', () => {
  const g = freshGame();
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  v.dots.push({ cardId: 'amanita_glade', damagePerTurn: 10, dischargeMin: 5, name: 'Полянка мухоморов' });
  g.turn.dice = [3, 2];
  g.turn.mode = 'split';
  g.turn.hasRolled = true;

  const r = apply(g, 'p1', 'action:dischargeDot', { characterId: v.id, dotIndex: 0, dieIndex: 0 });

  assert.equal(r.dotDischarged.success, false);
  assert.equal(v.dots.length, 1);
  assert.deepEqual(g.turn.usedDice, [true, false]); // кубик потрачен
});

test('ловушка Ночной филин — забирает карту из инвентаря нападающего', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  const stolenCandidate = attacker.inventory[0];
  const attackerCountBefore = attacker.inventory.length;
  const targetCountBefore = target.inventory.length;
  placeTrap(g, target, 'owl_night');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.traps[0].cardId, 'owl_night');
  assert.ok(r.attacked.traps[0].stolen);
  assert.equal(attacker.inventory.length, attackerCountBefore - 1);
  assert.equal(target.inventory.length, targetCountBefore + 1);
  assert.ok(target.inventory.includes(stolenCandidate));
  assert.ok(g.discard.includes('owl_night'));
});

test('ловушка Необработанный рубин — забирает карту у кузнеца нападающего', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  const smith = g.characters.find(c => c.owner === attacker.owner && c.role === 'K');
  smith.inventory = ['ore_medium'];
  const targetCountBefore = target.inventory.length;
  placeTrap(g, target, 'raw_ruby');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.traps[0].cardId, 'raw_ruby');
  assert.ok(r.attacked.traps[0].stolen);
  assert.deepEqual(smith.inventory, []);
  assert.equal(target.inventory.length, targetCountBefore + 1);
  assert.ok(target.inventory.includes('ore_medium'));
  assert.ok(g.discard.includes('raw_ruby'));
});

test('ловушка Необработанный рубин — если кузнец пустой, забирает карту у шамана нападающего', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  const smith = g.characters.find(c => c.owner === attacker.owner && c.role === 'K');
  const shaman = g.characters.find(c => c.owner === attacker.owner && c.role === 'S');
  smith.inventory = [];
  shaman.inventory = ['recipe_shaman_carpet'];
  placeTrap(g, target, 'raw_ruby');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.traps[0].cardId, 'raw_ruby');
  assert.ok(r.attacked.traps[0].stolen);
  assert.deepEqual(shaman.inventory, []);
  assert.ok(target.inventory.includes('recipe_shaman_carpet'));
  assert.ok(g.discard.includes('raw_ruby'));
});

test('ловушка Порча — при уроне 25+ возвращает ингредиенты нападающего', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(smith.position)[0];
  smith.inventory.push('irikon'); // +35 урона → точно ≥25
  assert.ok(smith.inventory.includes('ore_medium')); // базовый ингредиент кузнеца
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1];
  g.turn.usedDice = [false, false];
  placeTrap(g, target, 'porcha');

  const r = apply(g, 'p1', 'action:attack', { attackerId: smith.id, targetId: target.id });

  assert.ok(r.attacked.totalDamage >= 25);
  assert.ok(r.attacked.traps[0].purged >= 1);
  assert.ok(!smith.inventory.includes('ore_medium')); // ингредиент кузнеца возвращён
  assert.ok(g.discard.includes('porcha'));
});

// ── Броня (поглощение урона) ─────────────────────────────────────

// Кладёт активную (лицом вверх) броню на фишку защищающегося.
function placeArmor(game, defender, cardId) {
  game.terrainCards.push({
    id: `armor-${cardId}`, ownerId: defender.owner, characterId: defender.id,
    cardIndex: 0, cardId, faceDown: false, x: 0, y: 0,
  });
}

test('броня Кора дерева — поглощает 5 урона обычной атаки', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g); // урон 7
  placeArmor(g, target, 'bark');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.armorAbsorbed, 5);
  assert.equal(r.attacked.dealtDamage, 2); // 7 - 5
  assert.equal(target.hp, 98);
});

test('броня Кора дерева — Молот Иерихон пробивает защиту', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(smith.position)[0];
  smith.inventory.push('irikon');
  placeArmor(g, target, 'bark');
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1]; // обычный урон 2, пробивающий 35
  g.turn.usedDice = [false, false];

  const r = apply(g, 'p1', 'action:attack', { attackerId: smith.id, targetId: target.id });

  // обычные 2 поглощены корой (2-5→0), пробивающие 35 проходят полностью
  assert.equal(r.attacked.armorAbsorbed, 5);
  assert.equal(r.attacked.dealtDamage, 35);
  assert.equal(target.hp, 65);
});

// ── Оружие и щиты (флэт-эффекты §16) ─────────────────────────────

test('оружие Топормол — +25 урона без учёта защиты, остаётся в руке', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g); // кубики [3,4] = 7
  attacker.inventory.push('topormol');
  placeArmor(g, target, 'bark'); // -5, но топормол пробивает

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.weaponDamage, 25);
  assert.equal(r.attacked.weaponName, 'Топормол');
  assert.equal(r.attacked.weaponPiercing, true);
  // обычные 7 поглощены частично (7-5=2), пробивающие 25 проходят → 27
  assert.equal(r.attacked.dealtDamage, 27);
  assert.equal(target.hp, 73);
  assert.ok(attacker.inventory.includes('topormol'), 'оружие многоразовое');
});

test('оружие — берётся лучшее из инвентаря (Секира > Меч)', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  attacker.inventory.push('sword_sech'); // 15
  attacker.inventory.push('axe_sun');    // 50

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.weaponDamage, 50);
  assert.equal(r.attacked.weaponName, 'Секира Красное солнце');
});

test('щит Лёгкая кольчуга — поглощает 15 обычного урона', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g); // урон 7
  placeArmor(g, target, 'chainmail_light');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.armorAbsorbed, 15);
  assert.equal(r.attacked.dealtDamage, 0); // 7 - 15 → 0
  assert.equal(target.hp, 100);
});

test('броня Жест — поглощает 15 обычного урона', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g); // урон 7
  placeArmor(g, target, 'armor_zhest');

  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: target.id });

  assert.equal(r.attacked.armorAbsorbed, 15);
  assert.equal(r.attacked.dealtDamage, 0);
  assert.equal(target.hp, 100);
});

test('щиты складываются — Кора + Щит Др поглощают 25', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const target = g.characters.find(c => c.owner === 'p2' && c.role === 'V');
  target.position = neighbors(smith.position)[0];
  placeArmor(g, target, 'bark');       // 5
  placeArmor(g, target, 'shield_dr');  // 20
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [6, 6]; // обычный урон 12
  g.turn.usedDice = [false, false];

  const r = apply(g, 'p1', 'action:attack', { attackerId: smith.id, targetId: target.id });

  assert.equal(r.attacked.armorAbsorbed, 25);
  assert.equal(r.attacked.dealtDamage, 0); // 12 - 25 → 0
});
