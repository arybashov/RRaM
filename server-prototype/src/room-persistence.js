import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createRoomPersistence(options = {}) {
  const dbPath = options.dbPath ?? defaultDbPath();

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  const statements = {
    upsertRoom: db.prepare(`
      INSERT INTO room_snapshots (
        id, code, status, public, vs_bot, revision, created_at, updated_at, snapshot_json
      )
      VALUES (
        @id, @code, @status, @public, @vsBot, @revision, @createdAt, @updatedAt, @snapshotJson
      )
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        status = excluded.status,
        public = excluded.public,
        vs_bot = excluded.vs_bot,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        snapshot_json = excluded.snapshot_json
    `),
    deleteRoom: db.prepare('DELETE FROM room_snapshots WHERE id = ?'),
    allRooms: db.prepare(`
      SELECT snapshot_json
      FROM room_snapshots
      ORDER BY updated_at DESC
    `),
    insertRoomEvent: db.prepare(`
      INSERT INTO room_events (
        room_id, room_code, seq, kind, status,
        actor_player_id, actor_user_id, actor_side, action_type,
        players_json, payload_json, result_json, game_before_json, game_after_json,
        created_at
      )
      VALUES (
        @roomId, @roomCode, @seq, @kind, @status,
        @actorPlayerId, @actorUserId, @actorSide, @actionType,
        @playersJson, @payloadJson, @resultJson, @gameBeforeJson, @gameAfterJson,
        @createdAt
      )
    `),
    eventsByRoom: db.prepare(`
      SELECT *
      FROM room_events
      WHERE room_id = ?
      ORDER BY id ASC
    `),
  };

  function saveRoom(room) {
    if (!room?.id) return;
    const now = Date.now();
    room.createdAt ??= now;
    room.updatedAt = now;
    statements.upsertRoom.run({
      id: room.id,
      code: room.code,
      status: room.status ?? 'waiting',
      public: room.public ? 1 : 0,
      vsBot: room.vsBot ? 1 : 0,
      revision: Number(room.revision ?? 0),
      createdAt: Number(room.createdAt ?? now),
      updatedAt: now,
      snapshotJson: JSON.stringify(room),
    });
  }

  function deleteRoom(roomOrId) {
    const roomId = typeof roomOrId === 'string' ? roomOrId : roomOrId?.id;
    if (roomId) statements.deleteRoom.run(roomId);
  }

  function loadRooms() {
    return statements.allRooms.all()
      .map((row) => {
        try { return JSON.parse(row.snapshot_json); }
        catch { return null; }
      })
      .filter(Boolean);
  }

  function saveRoomEvent(event) {
    if (!event?.roomId || !event?.kind) return;
    const now = Date.now();
    statements.insertRoomEvent.run({
      roomId: event.roomId,
      roomCode: event.roomCode ?? '',
      seq: Number(event.seq ?? 0),
      kind: event.kind,
      status: event.status ?? '',
      actorPlayerId: event.actorPlayerId ?? null,
      actorUserId: event.actorUserId ?? null,
      actorSide: event.actorSide ?? null,
      actionType: event.actionType ?? null,
      playersJson: stringifyJson(event.players ?? null),
      payloadJson: stringifyJson(event.payload ?? null),
      resultJson: stringifyJson(event.result ?? null),
      gameBeforeJson: stringifyJson(event.gameBefore ?? null),
      gameAfterJson: stringifyJson(event.gameAfter ?? null),
      createdAt: Number(event.createdAt ?? now),
    });
  }

  function loadRoomEvents(roomId) {
    if (!roomId) return [];
    return statements.eventsByRoom.all(roomId).map(eventFromRow);
  }

  return {
    dbPath,
    saveRoom,
    deleteRoom,
    loadRooms,
    saveRoomEvent,
    loadRoomEvents,
  };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_snapshots (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0,
      vs_bot INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_room_snapshots_updated_at
      ON room_snapshots(updated_at);

    CREATE INDEX IF NOT EXISTS idx_room_snapshots_status
      ON room_snapshots(status);

    CREATE TABLE IF NOT EXISTS room_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      room_code TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      actor_player_id TEXT,
      actor_user_id TEXT,
      actor_side TEXT,
      action_type TEXT,
      players_json TEXT,
      payload_json TEXT,
      result_json TEXT,
      game_before_json TEXT,
      game_after_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_room_events_room_seq
      ON room_events(room_id, seq);

    CREATE INDEX IF NOT EXISTS idx_room_events_created_at
      ON room_events(created_at);

    CREATE INDEX IF NOT EXISTS idx_room_events_kind
      ON room_events(kind);
  `);
}

function defaultDbPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return process.env.RRAM_DB_PATH || join(here, '..', 'data', 'rram.sqlite');
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function eventFromRow(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomCode: row.room_code,
    seq: row.seq,
    kind: row.kind,
    status: row.status,
    actorPlayerId: row.actor_player_id,
    actorUserId: row.actor_user_id,
    actorSide: row.actor_side,
    actionType: row.action_type,
    players: parseJson(row.players_json),
    payload: parseJson(row.payload_json),
    result: parseJson(row.result_json),
    gameBefore: parseJson(row.game_before_json),
    gameAfter: parseJson(row.game_after_json),
    createdAt: row.created_at,
  };
}
