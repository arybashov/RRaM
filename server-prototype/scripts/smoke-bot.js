// Смоук-тест бота: создаёт партию против ИИ, делает ход,
// ждёт пока бот ответит, проверяет что ход вернулся и карты добраны.
// Запуск: npm run smoke:bot

import { WebSocket } from 'ws';

const PORT = 8800;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';

await import('../src/index.js');

const URL = `ws://127.0.0.1:${PORT}/ws`;
let failures = 0;

function check(name, condition) {
  if (condition) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}`); }
}

class Client {
  constructor(label) {
    this.label = label;
    this.buffer = [];
    this.waiters = [];
    this.lastSnapshot = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'state:snapshot') this.lastSnapshot = msg.payload.room;
        const idx = this.waiters.findIndex(w => w.type === msg.type);
        if (idx !== -1) this.waiters.splice(idx, 1)[0].resolve(msg);
        else this.buffer.push(msg);
      });
    });
  }

  send(type, payload = {}) { this.ws.send(JSON.stringify({ type, payload })); }

  waitFor(type, timeoutMs = 3000) {
    const found = this.buffer.findIndex(m => m.type === type);
    if (found !== -1) return Promise.resolve(this.buffer.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label}: таймаут ${type}`)), timeoutMs);
      this.waiters.push({ type, resolve: msg => { clearTimeout(t); resolve(msg); } });
    });
  }

  close() { this.ws.close(); }
}

// Ждём пока activePlayerId станет нужным, затем сбрасываем буфер.
// Бот шлёт несколько снимков подряд; без сброса они загрязняют
// последующие waitFor и тест читает устаревшее состояние.
async function waitForTurn(client, playerId, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      client.lastSnapshot?.game?.turn.activePlayerId === playerId
      || client.lastSnapshot?.game?.over
    ) {
      client.buffer = client.buffer.filter(m => m.type !== 'state:snapshot');
      return client.lastSnapshot;
    }
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`Таймаут: ход не перешёл к ${playerId}`);
}

// ── Тест ───────────────────────────────────────────────────────────

const a = new Client('A');
await a.connect();
await a.waitFor('server:connected');

// --- Создание партии против бота ---
a.send('room:create', { playerName: 'Алиса', vsBot: true });
const created = await a.waitFor('room:created');
const { playerId, sessionToken } = created.payload;

check('vsBot флаг в room:created', created.payload.vsBot === true);
check('sessionToken получен', typeof sessionToken === 'string');

const snap0 = await a.waitFor('state:snapshot');
const room0 = snap0.payload.room;
check('игра активна сразу без ожидания', room0.status === 'active');
check('10 персонажей (5 + 5)', room0.game.characters.length === 10);
check('первый ход у игрока', room0.game.turn.activePlayerId === playerId);

const bot = room0.players.find(p => p.isBot);
check('бот присутствует в комнате', Boolean(bot));
check('бот.isBot === true', bot?.isBot === true);
check('бот на красной стороне', bot?.side === 'red');
check('у бота нет sessionToken в снимке', !('sessionToken' in (bot ?? {})));

// --- Ход игрока: бросок + добор одним кубиком + завершение ---
a.send('turn:roll', {});
await a.waitFor('state:snapshot');

a.send('turn:setMode', { mode: 'split' });
await a.waitFor('state:snapshot');

a.send('action:draw', { characterId: `${playerId}:K`, dieIndex: 0 });
await a.waitFor('state:snapshot');
check('кузнец добрал карту (стало 3)', a.lastSnapshot.game.characters.find(c => c.id === `${playerId}:K`)?.inventory?.length === 3);

a.send('turn:end', {});
await a.waitFor('state:snapshot');
check('ход перешёл боту', a.lastSnapshot.game.turn.activePlayerId === bot.id);

const botCardsBefore = a.lastSnapshot.game.characters
  .filter(c => c.owner === bot.id)
  .reduce((s, c) => s + c.cardCount, 0);
const botPositionsBefore = new Map(
  a.lastSnapshot.game.characters
    .filter(c => c.owner === bot.id)
    .map(c => [c.id, c.position]),
);
const botRollsBefore = a.lastSnapshot.game.turn.rollsLeft[bot.id];

// --- Ждём пока бот сходит (~3.5 с) ---
console.log('  …  ожидание хода бота (~3.5 с)');
const snapAfterBot1 = await waitForTurn(a, playerId, 9000);
check('ход вернулся к игроку (1-й цикл)', snapAfterBot1.game.turn.activePlayerId === playerId);

const botCardsAfter1 = snapAfterBot1.game.characters
  .filter(c => c.owner === bot.id)
  .reduce((s, c) => s + c.cardCount, 0);
const botMovedAfter1 = snapAfterBot1.game.characters
  .filter(c => c.owner === bot.id)
  .some(c => botPositionsBefore.get(c.id) !== c.position);
check(
  'бот совершил полезное действие за первый ход',
  botCardsAfter1 > botCardsBefore || botMovedAfter1,
);
check('rollsLeft бота уменьшился на 1', snapAfterBot1.game.turn.rollsLeft[bot.id] === botRollsBefore - 1);

// --- Второй ход: игрок только бросает и передаёт ход ---
a.send('turn:roll', {});
await a.waitFor('state:snapshot');
a.send('turn:end', {});
await a.waitFor('state:snapshot');
check('второй ход перешёл боту', a.lastSnapshot.game.turn.activePlayerId === bot.id);

console.log('  …  ожидание хода бота (2-й цикл)');
const snapAfterBot2 = await waitForTurn(a, playerId, 9000);
check(
  'бот завершил 2-й цикл или выиграл партию',
  snapAfterBot2.game.turn.activePlayerId === playerId || snapAfterBot2.game.over,
);
check('rollsLeft бота уменьшился ещё на 1', snapAfterBot2.game.turn.rollsLeft[bot.id] === botRollsBefore - 2);

a.close();
console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
