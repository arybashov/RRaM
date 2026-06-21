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

  return {
    dbPath,
    saveRoom,
    deleteRoom,
    loadRooms,
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
  `);
}

function defaultDbPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return process.env.RRAM_DB_PATH || join(here, '..', 'data', 'rram.sqlite');
}
