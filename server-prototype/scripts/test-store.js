import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/game-state.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoryPersistence(seed = []) {
  const rows = new Map(seed.map((room) => [room.id, clone(room)]));
  const saved = [];
  const deleted = [];
  const events = [];

  return {
    saved,
    deleted,
    events,
    loadRooms() {
      return [...rows.values()].map(clone);
    },
    saveRoom(room) {
      const snapshot = clone(room);
      rows.set(snapshot.id, snapshot);
      saved.push(snapshot);
    },
    deleteRoom(roomOrId) {
      const roomId = typeof roomOrId === 'string' ? roomOrId : roomOrId?.id;
      rows.delete(roomId);
      deleted.push(roomId);
    },
    saveRoomEvent(event) {
      events.push(clone(event));
    },
    loadRoomEvents(roomId) {
      return events
        .filter((event) => event.roomId === roomId)
        .map(clone);
    },
    get(roomId) {
      const row = rows.get(roomId);
      return row ? clone(row) : null;
    },
  };
}

test('store persistence restores an active room and resumes a session', () => {
  const persistence = memoryPersistence();
  const store = createStore({ roomPersistence: persistence });
  const { room, player } = store.createRoom({
    playerName: 'Alice',
    connectionId: 'conn-a',
    vsBot: true,
  });

  const savedRoom = persistence.get(room.id);
  assert.ok(savedRoom);
  assert.equal(savedRoom.status, 'active');
  assert.ok(savedRoom.game);

  const restoredPersistence = memoryPersistence([savedRoom]);
  const restoredStore = createStore({ roomPersistence: restoredPersistence });
  const restoredRoom = restoredStore.getRoom(room.id);
  assert.ok(restoredRoom);
  assert.equal(restoredRoom.status, 'active');
  assert.equal(restoredRoom.players[0].connected, false);
  assert.equal(restoredRoom.players[1].connected, true);

  const resumed = restoredStore.resumeSession({
    roomId: room.id,
    sessionToken: player.sessionToken,
    connectionId: 'conn-b',
  });

  assert.equal(resumed.player.id, player.id);
  assert.equal(resumed.player.connected, true);
  assert.equal(resumed.player.connectionId, 'conn-b');
  assert.equal(restoredPersistence.get(room.id).players[0].connected, true);
});

test('store persistence keeps disconnected waiting rooms reopenable', () => {
  const persistence = memoryPersistence();
  const store = createStore({ roomPersistence: persistence });
  const { room, player } = store.createRoom({
    playerName: 'Host',
    connectionId: 'conn-host',
    isPublic: true,
  });

  assert.equal(store.listPublicRooms().length, 1);
  store.markDisconnected('conn-host');

  assert.ok(store.getRoom(room.id));
  assert.equal(store.listPublicRooms().length, 0);
  assert.equal(persistence.get(room.id).players[0].connected, false);

  const restoredStore = createStore({ roomPersistence: memoryPersistence([persistence.get(room.id)]) });
  const resumed = restoredStore.resumeSession({
    roomId: room.id,
    sessionToken: player.sessionToken,
    connectionId: 'conn-restored',
  });

  assert.equal(resumed.room.id, room.id);
  assert.equal(resumed.player.connected, true);
});

test('store does not expose completed games for watching', () => {
  const store = createStore({ roomPersistence: memoryPersistence() });
  const { room } = store.createRoom({
    playerName: 'Alice',
    connectionId: 'conn-a',
    isPublic: true,
  });
  store.joinRoom({
    code: room.code,
    playerName: 'Bob',
    connectionId: 'conn-b',
  });

  assert.equal(store.listPublicRooms()[0]?.canWatch, true);
  room.game.over = true;

  assert.equal(store.listPublicRooms().length, 0);
  assert.throws(
    () => store.watchRoom({ roomId: room.id }),
    /Просмотр закрыт/,
  );
});

test('store persistence records PvP game events for training', () => {
  const persistence = memoryPersistence();
  const store = createStore({ roomPersistence: persistence });
  const { room, player: p1 } = store.createRoom({
    playerName: 'Alice',
    connectionId: 'conn-a',
    isPublic: true,
  });
  const { player: p2 } = store.joinRoom({
    code: room.code,
    playerName: 'Bob',
    connectionId: 'conn-b',
  });

  assert.equal(persistence.events.length, 1);
  assert.equal(persistence.events[0].kind, 'game:start');
  assert.equal(persistence.events[0].roomId, room.id);
  assert.equal(persistence.events[0].players.length, 2);
  assert.equal(persistence.events[0].players[0].id, p1.id);
  assert.equal(persistence.events[0].players[1].id, p2.id);
  assert.ok(persistence.events[0].gameAfter);

  store.applyCommand({
    roomId: room.id,
    playerId: p1.id,
    type: 'turn:roll',
    payload: {},
  });

  assert.equal(persistence.events.length, 2);
  const event = persistence.events[1];
  assert.equal(event.kind, 'command');
  assert.equal(event.actionType, 'turn:roll');
  assert.equal(event.actorPlayerId, p1.id);
  assert.equal(event.actorSide, 'green');
  assert.deepEqual(event.payload, {});
  assert.ok(event.result?.roll?.dice);
  assert.ok(event.gameBefore);
  assert.ok(event.gameAfter);
  assert.notDeepEqual(event.gameBefore.turn.dice, event.gameAfter.turn.dice);
});

test('store persistence does not record vsBot games as PvP training events', () => {
  const persistence = memoryPersistence();
  const store = createStore({ roomPersistence: persistence });
  const { room, player } = store.createRoom({
    playerName: 'Alice',
    connectionId: 'conn-a',
    vsBot: true,
  });

  store.applyCommand({
    roomId: room.id,
    playerId: player.id,
    type: 'turn:roll',
    payload: {},
  });

  assert.equal(persistence.events.length, 0);
});
