// Простой жадный бот RRaM: каждый ход добирает карты обоими кубиками.
// Запускается сервером асинхронно; применяет команды через store.applyCommand,
// после каждого действия вызывает broadcast — клиент видит анимацию хода.

const delay = ms => new Promise(r => setTimeout(r, ms));

function tryApply(applyCommand, broadcast, roomId, botPlayerId, type, payload = {}) {
  try {
    applyCommand({ roomId, playerId: botPlayerId, type, payload });
  } catch {
    // нарушение правил — пропускаем, кубик остаётся нетронутым
  }
  broadcast(roomId);
}

function bestChar(game, botPlayerId) {
  return game.characters
    .filter(c => c.owner === botPlayerId && c.inventory.length < 10)
    .sort((a, b) => a.inventory.length - b.inventory.length)[0] ?? null;
}

export async function runBotTurn({ applyCommand, getRoom, broadcast, roomId, botPlayerId }) {
  const act = (type, payload) =>
    tryApply(applyCommand, broadcast, roomId, botPlayerId, type, payload);

  // Бросок
  await delay(900);
  act('turn:roll');

  // Режим разделённых кубиков
  await delay(500);
  act('turn:setMode', { mode: 'split' });

  // Кубик 0 — добираем карту
  let room = getRoom(roomId);
  if (!room?.game?.turn.dice) { act('turn:end'); return; }
  const c0 = bestChar(room.game, botPlayerId);
  if (c0 && room.game.deck.length > 0) {
    await delay(700);
    act('action:draw', { characterId: c0.id, dieIndex: 0 });
  }

  // Кубик 1 — добираем ещё карту
  room = getRoom(roomId);
  if (!room?.game?.turn.dice) { await delay(500); act('turn:end'); return; }
  const c1 = bestChar(room.game, botPlayerId);
  if (c1 && room.game.deck.length > 0) {
    await delay(600);
    act('action:draw', { characterId: c1.id, dieIndex: 1 });
  }

  // Завершение хода
  await delay(600);
  act('turn:end');
}
