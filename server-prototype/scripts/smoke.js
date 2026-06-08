// Смоук-тест авторитетного сервера: поднимает сервер в этом же процессе
// и прогоняет полный сетевой сценарий через WebSocket.
// Запуск: npm run smoke

import { WebSocket } from 'ws';

const PORT = 8799;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';

// Импорт запускает сервер (top-level await app.listen в index.js).
await import('../src/index.js');

const URL = `ws://127.0.0.1:${PORT}/ws`;
let failures = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}`);
  }
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
        if (msg.type === 'state:snapshot') {
          this.lastSnapshot = msg.payload.room;
        }
        const idx = this.waiters.findIndex((w) => w.type === msg.type);
        if (idx !== -1) {
          this.waiters.splice(idx, 1)[0].resolve(msg);
        } else {
          this.buffer.push(msg);
        }
      });
    });
  }

  send(type, payload) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  waitFor(type, timeoutMs = 2000) {
    const found = this.buffer.findIndex((m) => m.type === type);
    if (found !== -1) {
      return Promise.resolve(this.buffer.splice(found, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: таймаут ожидания ${type}`)), timeoutMs);
      this.waiters.push({
        type,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  close() {
    this.ws.close();
  }
}

// Ждем, пока до клиента дойдет снимок не старее указанной ревизии.
async function snapshotAtLeast(client, revision) {
  while (!client.lastSnapshot || client.lastSnapshot.revision < revision) {
    await client.waitFor('state:snapshot');
  }
  return client.lastSnapshot;
}

const a = new Client('A');
const b = new Client('B');
await a.connect();
await b.connect();
await a.waitFor('server:connected');
await b.waitFor('server:connected');

// --- Комната ---
a.send('room:create', { playerName: 'Алиса' });
const created = await a.waitFor('room:created');
const { code, playerId: playerA, sessionToken: tokenA, roomId } = created.payload;
check('создание комнаты возвращает код', typeof code === 'string' && code.length === 4);
check('создание возвращает sessionToken', typeof tokenA === 'string');

await a.waitFor('state:snapshot'); // снимок комнаты в статусе ожидания

b.send('room:join', { code, playerName: 'Боб' });
const joined = await b.waitFor('room:joined');
const playerB = joined.payload.playerId;
check('второй игрок присоединился', Boolean(playerB) && playerB !== playerA);

const snapA = (await a.waitFor('state:snapshot')).payload.room;
check('игра стартовала при 2 игроках', snapA.status === 'active' && snapA.game !== null);
check('создано 10 персонажей (5+5)', snapA.game.characters.length === 10);
check('позиции авторитетно хранятся на сервере', snapA.game.positionAuthority === 'server-v1');
check('все стартовые позиции опубликованы', snapA.game.characters.every(c => typeof c.position === 'string'));
check('колода конечная (mixed+forest+dark_forest = 41)', snapA.game.deckCount === 41);
check('ход у первого игрока', snapA.game.turn.activePlayerId === playerA);

// --- Чужой ход запрещен ---
b.send('turn:roll', {});
const err1 = await b.waitFor('server:error');
check('бросок в чужой ход отклонен', /ход другого игрока/i.test(err1.payload.message));

// --- Бросок и режим ---
a.send('turn:roll', {});
await a.waitFor('state:snapshot');
check('кубики брошены, осталось 9 бросков', a.lastSnapshot.game.turn.rollsLeft[playerA] === 9);
check('два кубика на столе', Array.isArray(a.lastSnapshot.game.turn.dice) && a.lastSnapshot.game.turn.dice.length === 2);

// движение пока заглушка (карты нет)
a.send('turn:setMode', { mode: 'moveSum' });
await a.waitFor('state:snapshot');
const moveTarget = a.lastSnapshot.game.legalTargets.moveSum[`${playerA}:V`]?.[0];
check('сервер опубликовал легальные цели движения', typeof moveTarget === 'string');
a.send('action:move', { characterId: `${playerA}:V`, toCell: moveTarget });
await a.waitFor('state:snapshot');
check(
  'движение подтверждено сервером',
  a.lastSnapshot.game.characters.find(c => c.id === `${playerA}:V`)?.position === moveTarget,
);

a.send('turn:roll', {});
await a.waitFor('state:snapshot');
a.send('turn:setMode', { mode: 'split' });
await a.waitFor('state:snapshot');
check('режим split установлен', a.lastSnapshot.game.turn.mode === 'split');

// --- Добор ---
const blacksmithA = `${playerA}:K`;
a.send('action:draw', { characterId: blacksmithA, dieIndex: 0 });
await a.waitFor('state:snapshot');
// K стартует с 2 базовыми картами (чертёж + бусы), после добора — 3
const myK = a.lastSnapshot.game.characters.find((c) => c.id === blacksmithA);
check('кузнец A добрал карту (стало 3)', myK.cardCount === 3 && Array.isArray(myK.inventory) && myK.inventory.length === 3);
check('колода уменьшилась (41-1=40)', a.lastSnapshot.game.deckCount === 40);

// --- Скрытие чужих карт (ждем тот же снимок у B) ---
const bSnap = await snapshotAtLeast(b, a.lastSnapshot.revision);
const bSeesA = bSnap.game.characters.find((c) => c.id === blacksmithA);
check('B видит счетчик карт A (3)', bSeesA.cardCount === 3);
check('B НЕ видит инвентарь A', bSeesA.inventory === undefined);
const bSeesOwnShaman = bSnap.game.characters.find((c) => c.id === `${playerB}:S`);
check('B видит свой инвентарь (Бусы у шамана)', Array.isArray(bSeesOwnShaman.inventory) && bSeesOwnShaman.inventory.includes('Бусы телепортации'));

// --- Передача вторым кубиком ---
const kBefore = myK.cardCount; // 3
const pBefore = a.lastSnapshot.game.characters.find((c) => c.id === `${playerA}:P`).cardCount; // 2
a.send('action:transfer', { fromId: blacksmithA, toId: `${playerA}:P`, dieIndex: 1 });
await a.waitFor('state:snapshot');
const kAfter = a.lastSnapshot.game.characters.find((c) => c.id === blacksmithA);
const pAfter = a.lastSnapshot.game.characters.find((c) => c.id === `${playerA}:P`);
const transferred = kBefore - kAfter.cardCount;
check('кузнец передал хотя бы 1 карту', transferred >= 1);
check('помощник получил столько же карт', pAfter.cardCount === pBefore + transferred);
check('оба кубика потрачены — стол очищен', a.lastSnapshot.game.turn.dice === null);

// --- Конец хода ---
a.send('turn:end', {});
await a.waitFor('state:snapshot');
check('ход перешел игроку B', a.lastSnapshot.game.turn.activePlayerId === playerB);

// --- Переподключение ---
const c = new Client('A2');
await c.connect();
await c.waitFor('server:connected');
c.send('session:resume', { roomId, sessionToken: tokenA });
const resumed = await c.waitFor('session:resumed');
check('переподключение по токену вернуло playerId A', resumed.payload.playerId === playerA);
const resumedSnap = await c.waitFor('state:snapshot');
check('после resume снова виден инвентарь A', Array.isArray(resumedSnap.payload.room.game.characters.find((x) => x.id === `${playerA}:P`).inventory));

a.close();
b.close();
c.close();

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОШЛИ' : `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
