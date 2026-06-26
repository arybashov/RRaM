// Отладочный тест для проверки отправки redEvent
import { createGame, apply } from '../src/rules.js';

function makePlayers() {
  return [
    { id: 'p1', seatIndex: 0, side: 'green', name: 'Алиса' },
    { id: 'p2', seatIndex: 1, side: 'red', name: 'Боб' },
  ];
}

const EVENT_CELL = 'H015';
const EVENT_NEIGHBOR = 'H012';

// Создаём игру
const game = createGame(makePlayers());

// Находим персонажа
const char = game.characters.find(c => c.owner === 'p1' && c.role === 'V');

// Ставим на клетку рядом с красной
char.position = EVENT_NEIGHBOR;

// Подкручиваем красную колоду
game.redDeck = ['wolf', 'hide_red'];

// Настраиваем кубики
game.turn.dice = [1, 2];
game.turn.usedDice = [false, false];
game.turn.mode = 'split';
game.turn.hasRolled = true;

console.log('=== Тест: шаг на красную клетку ===');
console.log('Персонаж:', char.id, char.role);
console.log('Позиция до:', char.position);
console.log('Красная колода:', game.redDeck);
console.log('Целевая клетка:', EVENT_CELL);

// Делаем ход
const result = apply(game, 'p1', 'action:move', {
  characterId: char.id,
  toCell: EVENT_CELL,
  dieIndex: 0,
});

console.log('\n=== Результат действия ===');
console.log('result:', JSON.stringify(result, null, 2));
console.log('\n=== Состояние персонажа ===');
console.log('Позиция после:', char.position);
console.log('beastFight:', char.beastFight);
console.log('Красная колода после:', game.redDeck);

if (result.redEvent) {
  console.log('\n✓ redEvent присутствует в результате!');
  console.log('  - cardId:', result.redEvent.cardId);
  console.log('  - name:', result.redEvent.name);
  console.log('  - beast:', result.redEvent.beast);
} else {
  console.log('\n✗ redEvent ОТСУТСТВУЕТ в результате!');
  console.log('  result.redEvent =', result.redEvent);
}
