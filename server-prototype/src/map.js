// Карта поля RRaM — теперь data-driven из board-map.json (граф клеток с
// явными соседями, экспортирован из редактора tools/board-editor).
// Клиент тянет полную карту как статический asset; сервер использует её
// для движения/дистанций/стартов. Интерфейс модуля сохранён.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(HERE, 'board-map.json'), 'utf8'));

export const MAP_ID = MAP.id;
export const MAP_REVISION = MAP.revision ?? 1;

const cellsById = new Map(MAP.cells.map((c) => [c.id, c]));
const neighborMap = new Map(
  MAP.cells.map((c) => [
    c.id,
    (c.neighbors || []).filter((n) => cellsById.has(n) && cellsById.get(n).walkable !== false),
  ]),
);

const STARTS = MAP.starts ?? { green: {}, red: {} };
const DWARF_ROUTE = Array.isArray(MAP.dwarfRoute)
  ? MAP.dwarfRoute.filter((id) => cellsById.has(id) && cellsById.get(id).walkable !== false)
  : [];

export function isBoardCell(id) {
  return cellsById.has(id);
}

export function neighbors(cellIdValue) {
  return neighborMap.get(cellIdValue) ?? [];
}

// Тип местности клетки: 'path' | 'resource' | 'event' | 'start' | null.
export function cellTerrain(id) {
  return cellsById.get(id)?.terrain ?? null;
}

export function cellRole(id) {
  return cellsById.get(id)?.role ?? null;
}

// Колода события на клетке: 'fairy_glade' и т.п., либо null. Используется для
// маршрутизации события (красная клетка vs Таинственная опушка с фениксом).
export function cellDeck(id) {
  return cellsById.get(id)?.deck ?? null;
}

export function cellSide(id) {
  return cellsById.get(id)?.side ?? null;
}

export function isBlacksmithStoneCell(id) {
  const cell = cellsById.get(id);
  return Boolean(cell && cell.walkable !== false && cell.pointClass === 'blacksmith_stone');
}

export function blacksmithStoneCells() {
  return MAP.cells
    .filter((cell) => isBlacksmithStoneCell(cell.id))
    .map((cell) => cell.id);
}

export function blacksmithStoneSide(id) {
  if (!isBlacksmithStoneCell(id)) return null;
  const explicitSide = cellSide(id);
  if (explicitSide) return explicitSide;

  let best = null;
  for (const side of Object.keys(STARTS)) {
    const starts = Object.values(STARTS[side] ?? {}).filter(Boolean);
    const distance = Math.min(...starts.map((start) => shortestDistance(id, start)));
    if (!best || distance < best.distance) best = { side, distance };
  }
  return best?.side ?? null;
}

// BFS по графу: клетки, достижимые не более чем за maxSteps шагов.
export function reachableCells(fromId, maxSteps, blocked = new Set()) {
  if (!isBoardCell(fromId) || maxSteps <= 0) return [];
  const visited = new Set([fromId]);
  const result = [];
  let frontier = [fromId];
  for (let step = 1; step <= maxSteps && frontier.length; step += 1) {
    const next = [];
    for (const id of frontier) {
      for (const nb of neighbors(id)) {
        if (visited.has(nb) || blocked.has(nb)) continue;
        visited.add(nb);
        result.push({ cellId: nb, distance: step });
        next.push(nb);
      }
    }
    frontier = next;
  }
  return result;
}

export function shortestDistance(fromId, toId, blocked = new Set()) {
  if (!isBoardCell(fromId) || !isBoardCell(toId)) return Infinity;
  if (fromId === toId) return 0;
  const visited = new Set([fromId]);
  let frontier = [fromId];
  let dist = 0;
  while (frontier.length) {
    dist += 1;
    const next = [];
    for (const id of frontier) {
      for (const nb of neighbors(id)) {
        if (visited.has(nb) || blocked.has(nb)) continue;
        if (nb === toId) return dist;
        visited.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function cellDistance(fromId, toId) {
  return shortestDistance(fromId, toId);
}

export function startCell(side, role) {
  return STARTS?.[side]?.[role] ?? null;
}

export function enemySide(side) {
  return side === 'red' ? 'green' : 'red';
}

export function allStartCells() {
  const out = [];
  for (const side of Object.keys(STARTS)) {
    for (const role of Object.keys(STARTS[side] ?? {})) {
      if (STARTS[side][role]) out.push(STARTS[side][role]);
    }
  }
  return [...new Set(out)];
}

export function pointClassCells(pointClass) {
  return MAP.cells
    .filter((cell) => cell.pointClass === pointClass && cell.walkable !== false)
    .map((cell) => cell.id);
}

export function dwarfRoute() {
  return [...DWARF_ROUTE];
}

export function terrainCells(terrain) {
  return MAP.cells
    .filter((cell) => cell.terrain === terrain && cell.walkable !== false)
    .map((cell) => cell.id);
}

export function deckCells() {
  return MAP.cells
    .filter((cell) => cell.deck && cell.walkable !== false)
    .map((cell) => cell.id);
}

// Цель гонки (заглушка победы): база противника — его стартовые клетки и
// клетки вокруг них. Сами старты заняты фишками, но соседи достижимы.
export function enemyIslandCells(side) {
  const starts = Object.values(STARTS?.[enemySide(side)] ?? {}).filter(Boolean);
  const zone = new Set(starts);
  for (const s of starts) for (const nb of neighbors(s)) zone.add(nb);
  return [...zone];
}

export function isEnemyIslandCell(side, cellId) {
  return enemyIslandCells(side).includes(cellId);
}

export function isEnemyStartCell(side, cellId) {
  return isEnemyIslandCell(side, cellId);
}

// Лёгкий снимок: клиент берёт полную карту как статику (assets/board-map.json),
// в снапшоте — только идентификатор и ревизия.
export function mapSnapshot() {
  return { id: MAP_ID, revision: MAP_REVISION };
}
