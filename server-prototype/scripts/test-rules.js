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
import { neighbors, startCell, shortestDistance, cellTerrain, pointClassCells } from '../src/map.js';

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
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.throws(() => apply(g, 'p1', 'turn:setMode', { mode: 'moveSum' }), /нельзя менять/i);
});

// ── Добор карты ──────────────────────────────────────────────────

test('draw — добирает карту в инвентарь', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  const before = char.inventory.length;
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.equal(char.inventory.length, before + 1);
});

test('draw — уменьшает колоду', () => {
  const g = freshGame();
  const deckBefore = g.deck.length;
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
  apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 });
  assert.equal(g.deck.length, deckBefore - 1);
});

test('draw — тратит кубик', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const char = g.characters.find(c => c.owner === 'p1');
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
  assert.throws(() => apply(g, 'p1', 'action:draw', { characterId: char.id, dieIndex: 0 }), /split/i);
});

test('draw — нельзя добрать сверх лимита инвентаря (10)', () => {
  const g = freshGame();
  const char = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
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

test('moveSum — фиксирует область суммы и позволяет переставлять фигурку внутри неё', () => {
  const g = freshGame();
  g.turn.dice = [2, 3];
  g.turn.mode = 'moveSum';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const initialTargets = availableMoveTargets(g, 'p1', warrior.id);
  const first = initialTargets.find(target => target.distance >= 2) ?? initialTargets[0];
  const second = initialTargets.find(target => target.cellId !== first.cellId);

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
  assert.deepEqual(g.turn.usedDice, [true, true]);
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

test('combat — участник боя не может брать карту или телепортироваться', () => {
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
  assert.throws(
    () => apply(g, 'p2', 'action:teleport', {
      characterId: target.id,
      toCell: startCell(target.side, 'O'),
    }),
    /в бою нельзя телепортироваться/i,
  );
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

test('attack — для атаки нужны оба свободных кубика', () => {
  const g = freshGame();
  const { attacker, target } = prepareAdjacentCombat(g);
  g.turn.usedDice[0] = true;

  assert.throws(
    () => apply(g, 'p1', 'action:attack', {
      attackerId: attacker.id,
      targetId: target.id,
    }),
    /оба неиспользованных кубика/i,
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

test('createGame — красная колода: только звери (5 карт)', () => {
  const g = freshGame();
  assert.equal(g.redDeck.length, 5); // кабан×2, волк×2, медведь×1
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

test('красная клетка — пустая колода пересобирается, бой всё равно начинается', () => {
  const g = freshGame();
  const { char, result } = stepOnEventCell(g, []);
  assert.ok(char.beastFight, 'зверь должен напасть даже при пустой колоде');
  assert.equal(result.redEvent.beast, true);
  assert.ok(['boar_red', 'wolf', 'beast_bear'].includes(char.beastFight.cardId));
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

test('Дубина — Воин убивает любого зверя одним кубиком 4+', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'beast_bear', successes: 0 };
  warrior.crafted.push('club');
  warrior.inventory.push('club');
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
});

test('закрытая Дубина не даёт бонус против зверя', () => {
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

test('зверь — в схватке нельзя брать карты и телепортироваться', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'boar_red', successes: 0 };
  assert.throws(
    () => apply(g, 'p1', 'action:draw', { characterId: warrior.id, dieIndex: 0 }),
    /зверем.*не может брать карты/i,
  );
  assert.throws(
    () => apply(g, 'p1', 'action:teleport', { characterId: warrior.id, toCell: startCell('red', 'K') }),
    /зверем нельзя телепортироваться/i,
  );
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

test('craft — изделие открывает только свой класс', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('hide_red');
  // кузнец пытается открыть Дубину (изделие воина)
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: smith.id, item: 'club' }), /только Воин/i);
});

test('craft — повторно не открывается', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('hide_red');
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  warrior.inventory.push('bp_club_base', 'hide_red');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: warrior.id }), /уже открыт/i);
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

test('Дубина — враг в бою теряет 10 HP в начало хода владельца', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy   = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  warrior.crafted.push('club');
  warrior.inventory.push('club');
  warrior.combatOpponentId = enemy.id;
  enemy.combatOpponentId = warrior.id;
  enemy.hp = 35;
  apply(g, 'p1', 'turn:roll');
  assert.equal(enemy.hp, 25);
});

test('Дубина — добивание врага отдаёт добычу владельцу', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy   = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  warrior.crafted.push('club');
  warrior.inventory.push('club');
  warrior.combatOpponentId = enemy.id;
  enemy.combatOpponentId = warrior.id;
  enemy.hp = 10;
  enemy.inventory = ['loot-1'];
  const before = warrior.inventory.length;
  apply(g, 'p1', 'turn:roll');
  assert.equal(enemy.hp, 0);
  assert.equal(enemy.position, null);
  assert.ok(warrior.inventory.includes('loot-1'));
  assert.equal(warrior.inventory.length, before + 1);
  assert.equal(warrior.combatOpponentId, null);
});

test('Дубина — без крафта эффекта нет', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy   = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  warrior.combatOpponentId = enemy.id;
  enemy.combatOpponentId = warrior.id;
  enemy.hp = 35;
  apply(g, 'p1', 'turn:roll');
  assert.equal(enemy.hp, 35);
});

// ── Классовые ограничения по правилам ─────────────────────────────

test('craft — Дубину может открыть только Воин (по классу)', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  smith.inventory.push('bp_club_base', 'club', 'wolf');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: smith.id }), /только Воин/i);
});

test('Дубина — у не-Воина эффекта нет даже если карта в инвентаре с crafted', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const enemy = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  smith.inventory.push('club');
  smith.crafted = ['club']; // искусственно — обходим проверку класса в craft()
  smith.combatOpponentId = enemy.id;
  enemy.combatOpponentId = smith.id;
  enemy.hp = 35;
  apply(g, 'p1', 'turn:roll');
  assert.equal(enemy.hp, 35); // эффект Дубины не сработал — Кузнец не Воин
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

// ── Один бросок: один движущийся персонаж, один добор ─────────────

test('move (split) — нельзя двигать двух разных персонажей в одном броске', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [2, 2]; g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const t1 = availableMoveTargets(g, 'p1', v.id, 0)[0];
  apply(g, 'p1', 'action:move', { characterId: v.id, toCell: t1.cellId, dieIndex: 0 });
  // вторым кубиком другим персонажем — запрещено
  assert.equal(availableMoveTargets(g, 'p1', k.id, 1).length, 0);
  assert.throws(
    () => apply(g, 'p1', 'action:move', { characterId: k.id, toCell: 'H001', dieIndex: 1 }),
    /одного персонажа/i,
  );
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
    id: `griffin-${attacker.role}`,
    characterId: attacker.id,
    cardIndex,
    x: 100,
    y: 200,
    faceDown,
  });
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
    id: 'griffin-O',
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
      id: 'griffin-O',
      faceDown: false,
    }),
    /только владелец/i,
  );
});
