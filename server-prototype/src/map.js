export const BOARD_COLS = 15;
export const BOARD_ROWS = 10;
export const MAP_ID = 'prototype-15x10-v1';
export const MAP_LAYOUT = 'odd-r';

export const START_CELLS = Object.freeze({
  green: Object.freeze({
    K: '1:1',
    P: '2:1',
    V: '1:2',
    O: '2:2',
    S: '3:2',
  }),
  red: Object.freeze({
    K: '13:8',
    P: '12:8',
    V: '13:7',
    O: '12:7',
    S: '11:7',
  }),
});

export const ISLAND_CELLS = Object.freeze({
  green: Object.freeze(
    Array.from({ length: 3 }, (_, r) =>
      Array.from({ length: 4 }, (_, q) => `${q}:${r}`)).flat(),
  ),
  red: Object.freeze(
    Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 4 }, (_, col) => `${11 + col}:${7 + row}`)).flat(),
  ),
});

export function parseCell(cellId) {
  if (typeof cellId !== 'string') return null;
  const match = /^(\d+):(\d+)$/.exec(cellId);
  if (!match) return null;
  const q = Number(match[1]);
  const r = Number(match[2]);
  if (q < 0 || q >= BOARD_COLS || r < 0 || r >= BOARD_ROWS) return null;
  return { q, r };
}

export function isBoardCell(cellId) {
  return parseCell(cellId) !== null;
}

export function cellDistance(fromId, toId) {
  return shortestDistance(fromId, toId);
}

export function cellId(q, r) {
  return `${q}:${r}`;
}

export function neighbors(cellIdValue) {
  const cell = parseCell(cellIdValue);
  if (!cell) return [];
  const evenDeltas = [
    [-1, 0], [1, 0],
    [-1, -1], [0, -1],
    [-1, 1], [0, 1],
  ];
  const oddDeltas = [
    [-1, 0], [1, 0],
    [0, -1], [1, -1],
    [0, 1], [1, 1],
  ];
  const deltas = cell.r % 2 === 0 ? evenDeltas : oddDeltas;
  return deltas
    .map(([dq, dr]) => cellId(cell.q + dq, cell.r + dr))
    .filter(isBoardCell);
}

export function reachableCells(fromId, maxSteps, blocked = new Set()) {
  if (!isBoardCell(fromId) || maxSteps <= 0) return [];
  const queue = [{ cellId: fromId, distance: 0 }];
  const visited = new Set([fromId]);
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.distance >= maxSteps) continue;
    for (const next of neighbors(current.cellId)) {
      if (visited.has(next) || blocked.has(next)) continue;
      visited.add(next);
      const distance = current.distance + 1;
      result.push({ cellId: next, distance });
      queue.push({ cellId: next, distance });
    }
  }
  return result;
}

export function shortestDistance(fromId, toId, blocked = new Set()) {
  if (!isBoardCell(fromId) || !isBoardCell(toId)) return Infinity;
  if (fromId === toId) return 0;
  const queue = [{ cellId: fromId, distance: 0 }];
  const visited = new Set([fromId]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of neighbors(current.cellId)) {
      if (visited.has(next) || blocked.has(next)) continue;
      if (next === toId) return current.distance + 1;
      visited.add(next);
      queue.push({ cellId: next, distance: current.distance + 1 });
    }
  }
  return Infinity;
}

export function startCell(side, role) {
  return START_CELLS[side]?.[role] ?? null;
}

export function enemySide(side) {
  return side === 'red' ? 'green' : 'red';
}

export function isEnemyStartCell(side, cellId) {
  return Object.values(START_CELLS[enemySide(side)] ?? {}).includes(cellId);
}

export function enemyIslandCells(side) {
  return ISLAND_CELLS[enemySide(side)] ?? [];
}

export function isEnemyIslandCell(side, cellId) {
  return enemyIslandCells(side).includes(cellId);
}

export function allStartCells() {
  return [...new Set(Object.values(START_CELLS).flatMap(Object.values))];
}

export function mapSnapshot() {
  return {
    id: MAP_ID,
    layout: MAP_LAYOUT,
    cols: BOARD_COLS,
    rows: BOARD_ROWS,
    starts: START_CELLS,
    islands: ISLAND_CELLS,
  };
}
