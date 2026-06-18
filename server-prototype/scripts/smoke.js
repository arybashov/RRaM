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

// --- Чат вне комнаты игнорируется (в лобби чата нет) ---
a.send('chat:send', { text: 'есть кто?', name: 'Алиса' });

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
const ownAStart = snapA.game.characters.filter(c => c.owner === playerA);
check('свои стартовые позиции опубликованы',
  ownAStart.length === 5 && ownAStart.every(c => typeof c.position === 'string'));
// Туман войны: чужие фишки вне зоны видимости скрыты (position null + hidden),
// внутри — видны. Флаг hidden обязан совпадать с тем, скрыта ли позиция.
const enemyAStart = snapA.game.characters.filter(c => c.owner !== playerA);
check('вражеские фишки согласованы с туманом',
  enemyAStart.every(c => (c.position === null) === Boolean(c.hidden)));
check('стартовая колода mixed = 14', snapA.game.deckCount === 14);
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

// Ведём кузнеца на соседнюю клетку добычи (H014, рубашка mixed): по правилу
// «добор только на ресурсе» карту во втором броске можно взять лишь там.
const DRAW_CELL = 'H014';
a.send('turn:setMode', { mode: 'moveSum' });
await a.waitFor('state:snapshot');
const kMoveTargets = a.lastSnapshot.game.legalTargets.moveSum[`${playerA}:K`] ?? [];
check('сервер опубликовал легальные цели движения', kMoveTargets.includes(DRAW_CELL));
a.send('action:move', { characterId: `${playerA}:K`, toCell: DRAW_CELL });
await a.waitFor('state:snapshot');
check(
  'движение подтверждено сервером',
  a.lastSnapshot.game.characters.find(c => c.id === `${playerA}:K`)?.position === DRAW_CELL,
);
const movedK = a.lastSnapshot.game.characters.find(c => c.id === `${playerA}:K`);
check('вход на точку добычи сразу добирает карту', movedK.cardCount === 4);
check('автодобор уменьшил колоду (14-1=13)', a.lastSnapshot.game.deckCount === 13);

// Один бросок на ход: перед вторым броском делаем полный круг ходов.
a.send('turn:end', {});
await a.waitFor('state:snapshot');
b.send('turn:end', {});
await a.waitFor('state:snapshot');

a.send('turn:roll', {});
await a.waitFor('state:snapshot');
a.send('turn:setMode', { mode: 'split' });
await a.waitFor('state:snapshot');
check('режим split установлен', a.lastSnapshot.game.turn.mode === 'split');

// --- Добор ---
const blacksmithA = `${playerA}:K`;
a.send('action:draw', { characterId: blacksmithA, dieIndex: 0 });
await a.waitFor('state:snapshot');
// K стартует с 3 базовыми картами, 1 взял автодобором при входе на H014 и ещё 1 — ручным добором.
const myK = a.lastSnapshot.game.characters.find((c) => c.id === blacksmithA);
check('кузнец A добрал карту повторно в новом броске (3 базовых + 2 = 5)', myK.cardCount === 5 && Array.isArray(myK.inventory) && myK.inventory.length === 5);
check('колода уменьшилась (14-2=12)', a.lastSnapshot.game.deckCount === 12);

// --- Скрытие чужих карт (ждем тот же снимок у B) ---
const bSnap = await snapshotAtLeast(b, a.lastSnapshot.revision);
const bSeesA = bSnap.game.characters.find((c) => c.id === blacksmithA);
check('B видит счетчик карт A (5)', bSeesA.cardCount === 5);
check('B НЕ видит инвентарь A', bSeesA.inventory === undefined);
const bSeesAHunter = bSnap.game.characters.find((c) => c.id === `${playerA}:O`);
check(
  'B видит публичного Грифона A, но не остальные карты Охотника',
  bSeesAHunter.inventory === undefined
    && bSeesAHunter.cardCount === 2
    && bSeesAHunter.publicCards?.length === 1
    && bSeesAHunter.publicCards[0].id === 'griffin',
);
const bSeesOwnShaman = bSnap.game.characters.find((c) => c.id === `${playerB}:S`);
check('B видит свой инвентарь (Бусы у шамана)', Array.isArray(bSeesOwnShaman.inventory) && bSeesOwnShaman.inventory.some((c) => c.id === 'teleport_beads'));

// --- Игровой чат: сообщение участникам комнаты, имя авторитетное ---
await new Promise((r) => setTimeout(r, 600)); // переждать троттлинг чата (500 мс)
a.send('chat:send', { text: 'удачи!', name: 'подделка' });
const roomMsg = await b.waitFor('chat:message');
check('игровой чат доходит сопернику',
  roomMsg.payload.scope === 'room' && roomMsg.payload.text === 'удачи!' && roomMsg.payload.name === 'Алиса');

// --- Второй добор за бросок отклонён (правило: 1 карта за бросок) ---
a.send('action:draw', { characterId: `${playerA}:P`, dieIndex: 1 });
const drawErr = await a.waitFor('server:error');
check('второй добор за бросок отклонён', /один раз за бросок/i.test(drawErr.payload.message ?? ''));

// --- Передача через всё поле (расстояние не ограничено) ---
const pBefore = a.lastSnapshot.game.characters.find((c) => c.id === `${playerA}:P`).cardCount;
a.send('action:transfer', { fromId: blacksmithA, toId: `${playerA}:P`, dieIndex: 1 });
await a.waitFor('state:snapshot');
const pAfter = a.lastSnapshot.game.characters.find((c) => c.id === `${playerA}:P`);
check('передача через всё поле прошла', pAfter.cardCount > pBefore);
check(
  'оба кубика потрачены — значения видны до конца хода',
  Array.isArray(a.lastSnapshot.game.turn.dice)
    && a.lastSnapshot.game.turn.usedDice.every(Boolean),
);

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
