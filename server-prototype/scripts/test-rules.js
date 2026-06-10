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
  assert.ok(smith.inventory.includes('Бусы телепортации'));
});

test('createGame — колода перетасована и непустая', () => {
  const g = freshGame();
  assert.ok(g.deck.length > 0);
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

  assert.equal(g.turn.dice, null);
  assert.throws(() => apply(g, 'p1', 'turn:roll'), /в этом ходу/i);
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
  from.inventory = []; // опустошаем
  assert.throws(() => apply(g, 'p1', 'action:transfer', { fromId: from.id, toId: to.id, dieIndex: 0 }), /нет карт/i);
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

test('moveSum — перемещает персонажа и тратит оба кубика', () => {
  const g = freshGame();
  g.turn.dice = [2, 3];
  g.turn.mode = 'moveSum';
  const warrior = g.characters.find(c => c.owner === 'p1' && c.role === 'V');
  const targets = availableMoveTargets(g, 'p1', warrior.id);
  const target = targets.sort((a, b) => b.distance - a.distance)[0];

  apply(g, 'p1', 'action:move', {
    characterId: warrior.id,
    toCell: target.cellId,
  });

  assert.equal(warrior.position, target.cellId);
  assert.equal(g.turn.dice, null);
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
  assert.equal(g.winnerId, 'p1');
  assert.equal(g.over, true);
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
  assert.equal(g.turn.dice, null);
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
  apply(g, 'p1', 'action:draw',     { characterId: k.id, dieIndex: 0 });
  apply(g, 'p1', 'action:transfer', { fromId: k.id, toId: p.id, dieIndex: 1 });
  assert.equal(g.turn.dice, null);
  assert.deepEqual(g.turn.usedDice, [false, false]);
});
