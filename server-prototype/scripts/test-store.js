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

  return {
    saved,
    deleted,
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
