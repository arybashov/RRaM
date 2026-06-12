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
import { neighbors, startCell } from '../src/map.js';

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
});

test('createGame — колода перетасована и непустая', () => {
  const g = freshGame();
  assert.ok(g.deck.length > 0);
});

// ── Эффекты карт: Клубок (начало хода) ────────────────────────────

test('Клубок — шаман восстанавливает +2 HP в начале хода', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  assert.ok(shaman.inventory.includes('yarn'));
  shaman.hp = 50;
  apply(g, 'p1', 'turn:roll');
  assert.equal(shaman.hp, 52);
});

test('Клубок — не лечит выше 100', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.hp = 99;
  apply(g, 'p1', 'turn:roll');
  assert.equal(shaman.hp, 100);
});

test('Клубок — кузнец с yarn НЕ лечится (эффект только у шамана)', () => {
  const g = freshGame();
  const smith = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  assert.ok(smith.inventory.includes('yarn'));
  smith.hp = 50;
  apply(g, 'p1', 'turn:roll');
  assert.equal(smith.hp, 50);
});

test('Клубок — без карты yarn шаман не лечится', () => {
  const g = freshGame();
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  shaman.inventory = shaman.inventory.filter(id => id !== 'yarn');
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

test('move split — сохраняет область выбранного кубика до конца хода', () => {
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
  assert.equal(availableMoveTargets(g, 'p1', warrior.id, 1).length, 0);
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
  g.turn.dice = [1, 1];
  g.turn.mode = 'split';
  const shaman = g.characters.find(c => c.owner === 'p1' && c.role === 'S');
  const dest = startCell('red', 'K');          // стартовая клетка вражеского кузнеца
  const enemyK = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  enemyK.position = startCell('red', 'S');     // освобождаем dest

  apply(g, 'p1', 'action:teleport', {
    characterId: shaman.id,
    toCell: dest,
  });

  assert.equal(shaman.position, dest);
  assert.equal(g.winnerId, null);
  assert.equal(g.over, false);
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
  assert.equal(g.turn.dice, null);
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
  assert.deepEqual(char.beastFight, { cardId: 'wolf', successes: 0 });
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

test('fightBeast — кубик не ниже killOn убивает зверя сразу, туша в инвентаре', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.beastFight = { cardId: 'wolf', successes: 0 };
  g.turn.dice = [5, 1]; // wolf.killOn = 5
  g.turn.mode = 'split';
  g.turn.hasRolled = true;
  const result = apply(g, 'p1', 'action:fightBeast', { characterId: warrior.id, dieIndex: 0 });
  assert.equal(result.beastFought.killed, true);
  assert.equal(result.beastFought.value, 5);
  assert.equal(warrior.beastFight, null);
  assert.ok(warrior.inventory.includes('wolf'));
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
  assert.equal(warrior.beastFight, null);
  assert.ok(warrior.inventory.includes('wolf'));
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
  assert.deepEqual(warrior.beastFight, { cardId: 'beast_bear', successes: 0 });
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

test('оба кубика потрачены — turn.dice обнуляется', () => {
  const g = freshGame();
  rollAndSplit(g, 'p1');
  const k = g.characters.find(c => c.owner === 'p1' && c.role === 'K');
  const p = g.characters.find(c => c.owner === 'p1' && c.role === 'P');
  p.position = neighbors(k.position)[0]; // получатель рядом
  apply(g, 'p1', 'action:draw',     { characterId: k.id, dieIndex: 0 });
  apply(g, 'p1', 'action:transfer', { fromId: k.id, toId: p.id, dieIndex: 1 });
  assert.equal(g.turn.dice, null);
  assert.deepEqual(g.turn.usedDice, [false, false]);
});

// ── Крафт: Дубина по чертежу + трофей зверя ───────────────────────

test('craft — трофей волка открывает Дубину, чертёж и трофей в сброс', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('wolf'); // трофей убитого зверя
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  assert.ok(warrior.crafted.includes('club'));
  assert.ok(!warrior.inventory.includes('wolf'));
  assert.ok(!warrior.inventory.includes('bp_club_base'));
  assert.ok(warrior.inventory.includes('club')); // сама Дубина остаётся
  assert.ok(g.discard.includes('wolf'));
  assert.ok(g.discard.includes('bp_club_base'));
});

test('craft — без трофея отклоняется', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: warrior.id }), /трофей/i);
});

test('craft — повторно не открывается', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('wolf');
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  warrior.inventory.push('bp_club_base', 'wolf');
  assert.throws(() => apply(g, 'p1', 'action:craft', { characterId: warrior.id }), /уже открыта/i);
});

test('craft — кубики не тратятся (бесплатное действие)', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  warrior.inventory.push('boar_red');
  apply(g, 'p1', 'action:craft', { characterId: warrior.id });
  assert.deepEqual(g.turn.usedDice, [false, false]);
  assert.ok(g.turn.dice);
});

test('Дубина — враг в бою теряет 10 HP в начало хода владельца', () => {
  const g = freshGame();
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const enemy   = g.characters.find(c => c.owner === 'p2' && c.role === 'K');
  warrior.crafted.push('club');
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

test('move (split) — после выбора кубика область движения остаётся привязана к нему', () => {
  const g = freshGame();
  apply(g, 'p1', 'turn:roll');
  g.turn.dice = [1, 1]; g.turn.usedDice = [false, false];
  apply(g, 'p1', 'turn:setMode', { mode: 'split' });
  const v = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const t1 = availableMoveTargets(g, 'p1', v.id, 0)[0];
  apply(g, 'p1', 'action:move', { characterId: v.id, toCell: t1.cellId, dieIndex: 0 });
  assert.equal(availableMoveTargets(g, 'p1', v.id, 1).length, 0);
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
  g.turn.dice = [1, 1]; // сумма 2 → гриффон бьёт на 20
  g.turn.usedDice = [false, false];
  return { attacker, enemy };
}

test('Гриффон — охотник с гриффоном добавляет урон зверя (сумма 2 → +20)', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O'); // у Охотника гриффон с рождения
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 20);
  assert.equal(r.attacked.totalDamage, 22);
  assert.equal(enemy.hp, 78);
});

test('Гриффон — у не-Охотника бонуса нет (эффект только по классу)', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'V');
  attacker.inventory.push('griffin'); // передали воину — носить можно, применять нет
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 0);
  assert.equal(enemy.hp, 98); // только сумма кубиков
});

test('Гриффон — при сумме вне 2-4 бонуса нет', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  g.turn.dice = [3, 3]; // сумма 6 — гриффон не атакует
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 0);
  assert.equal(enemy.hp, 94);
});

test('Гриффон — охотник без гриффона в инвентаре бонуса не получает', () => {
  const g = freshGame();
  const { attacker, enemy } = setupGriffinAttack(g, 'O');
  attacker.inventory = attacker.inventory.filter(id => id !== 'griffin');
  const r = apply(g, 'p1', 'action:attack', { attackerId: attacker.id, targetId: enemy.id });
  assert.equal(r.attacked.griffinDamage, 0);
  assert.equal(enemy.hp, 98);
});
