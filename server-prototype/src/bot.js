import { INVENTORY_LIMIT } from './constants.js';
import { availableAttackTargets, availableMoveTargets } from './rules.js';
import { enemyIslandCells, shortestDistance } from './map.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROLE_ORDER = Object.freeze(['V', 'O', 'S', 'K', 'P']);
const TARGET_COLLECTION_KEYS = Object.freeze([
  'botGoals',
  'goals',
  'objectives',
  'targetCells',
]);

// Только ЖИВЫЕ на доске: collectors/goals выше предполагают, что персонаж может
// ходить/атаковать/брать. Мёртвый (hp=0, position=null) ломает availableMoveTargets
// и т.п. (ownCharacter() бросает «Персонаж выбыл из игры»), из-за чего после
// первой потери бот переставал ходить.
function ownCharacters(game, botPlayerId) {
  return (game.characters ?? []).filter(
    (character) => character.owner === botPlayerId
      && character.hp > 0
      && character.position,
  );
}

function positionId(position) {
  if (typeof position === 'string') return position;
  return position?.id ?? position?.cellId ?? position?.boardCellId ?? null;
}

function cellId(cell) {
  if (typeof cell === 'string') return cell;
  return cell?.id ?? cell?.cellId ?? cell?.boardCellId ?? null;
}

function availableCells(game) {
  const collections = [
    game.cells,
    game.map?.cells,
    game.map?.boardCells,
    game.board?.cells,
    game.boardCells,
  ];
  return collections.find(Array.isArray) ?? [];
}

function isTraversable(cell) {
  return cell?.blocked !== true
    && cell?.walkable !== false
    && cell?.terrainType !== 'blocked';
}

function buildCellIndex(game) {
  return new Map(
    availableCells(game)
      .filter(isTraversable)
      .map((cell) => [cellId(cell), cell])
      .filter(([id]) => id),
  );
}

function targetId(target) {
  if (typeof target === 'string') return target;
  return target?.toCell
    ?? target?.targetCell
    ?? target?.cellId
    ?? target?.boardCellId
    ?? target?.position
    ?? null;
}

function appliesToBot(target, botPlayerId) {
  const owner = target?.playerId ?? target?.owner ?? target?.ownerPlayerId;
  return owner == null || owner === botPlayerId;
}

function collectTargets(game, botPlayerId, cellIndex) {
  const targets = [];

  for (const key of TARGET_COLLECTION_KEYS) {
    const collection = game[key];
    if (!Array.isArray(collection)) continue;
    for (const target of collection) {
      if (!appliesToBot(target, botPlayerId)) continue;
      const id = targetId(target);
      if (id && cellIndex.has(id)) {
        targets.push({
          id,
          priority: Number.isFinite(target?.priority) ? target.priority : 1,
          source: key,
        });
      }
    }
  }

  for (const cell of cellIndex.values()) {
    const owner = cell.owner ?? cell.ownerPlayerId;
    const markedTarget = cell.isTarget === true
      || cell.target === true
      || cell.terrainType === 'target'
      || cell.type === 'target';
    if (markedTarget && (owner == null || owner === botPlayerId)) {
      targets.push({
        id: cellId(cell),
        priority: Number.isFinite(cell.priority) ? cell.priority : 1,
        source: 'cells',
      });
    }
  }

  const unique = new Map();
  for (const target of targets) {
    const previous = unique.get(target.id);
    if (!previous || target.priority > previous.priority) {
      unique.set(target.id, target);
    }
  }
  return [...unique.values()];
}

function coordinateDistance(from, to) {
  if (![from?.q, from?.r, to?.q, to?.r].every(Number.isFinite)) return Infinity;
  return Math.abs(from.q - to.q) + Math.abs(from.r - to.r);
}

function neighborsOf(cell, cellIndex) {
  if (Array.isArray(cell.neighbors)) {
    return cell.neighbors
      .map((neighbor) => cellIndex.get(cellId(neighbor)))
      .filter(Boolean);
  }

  return [...cellIndex.values()].filter(
    (candidate) => coordinateDistance(cell, candidate) === 1,
  );
}

function distancesFrom(startId, cellIndex, maxDistance = Infinity) {
  if (!cellIndex.has(startId)) return new Map();

  const distances = new Map([[startId, 0]]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index];
    const distance = distances.get(currentId);
    if (distance >= maxDistance) continue;

    for (const neighbor of neighborsOf(cellIndex.get(currentId), cellIndex)) {
      const neighborId = cellId(neighbor);
      if (distances.has(neighborId)) continue;
      distances.set(neighborId, distance + 1);
      queue.push(neighborId);
    }
  }
  return distances;
}

function roleRotationBonus(role, game, botPlayerId, dieIndex) {
  const rollsLeft = game.turn.rollsLeft[botPlayerId] ?? 0;
  const preferredIndex = (rollsLeft + dieIndex) % ROLE_ORDER.length;
  const roleIndex = ROLE_ORDER.indexOf(role);
  return roleIndex === preferredIndex ? 5 : 0;
}

function collectDrawActions({ game, botPlayerId, dieIndex }) {
  if ((game.deck?.length ?? 0) === 0) return [];
  if (game.turn.drawnThisTurn) return []; // добор — раз за бросок

  return ownCharacters(game, botPlayerId)
    .filter((character) => character.inventory.length < INVENTORY_LIMIT
      && !character.beastFight) // в схватке со зверем добор запрещён
    .map((character) => ({
      type: 'action:draw',
      payload: { characterId: character.id, dieIndex },
      facts: {
        character,
        freeSlots: INVENTORY_LIMIT - character.inventory.length,
      },
    }));
}

function collectTransferActions({ game, botPlayerId, dieIndex }) {
  const dieValue = game.turn.dice?.[dieIndex];
  if (!Number.isFinite(dieValue)) return [];

  const characters = ownCharacters(game, botPlayerId);
  const actions = [];

  for (const from of characters) {
    for (const to of characters) {
      if (from.id === to.id || from.inventory.length === 0) continue;
      const capacity = INVENTORY_LIMIT - to.inventory.length;
      const imbalance = from.inventory.length - to.inventory.length;
      if (capacity <= 0 || imbalance < 3) continue;

      actions.push({
        type: 'action:transfer',
        payload: { fromId: from.id, toId: to.id, dieIndex },
        facts: {
          from,
          to,
          imbalance,
          count: Math.min(dieValue, from.inventory.length, capacity),
        },
      });
    }
  }
  return actions;
}

function collectAttackActions({ game, botPlayerId }) {
  if (game.turn.usedDice?.some(Boolean)) return [];

  const damage = (game.turn.dice ?? []).reduce((total, value) => total + value, 0);
  if (!Number.isInteger(damage) || damage <= 0) return [];

  const actions = [];
  for (const attacker of ownCharacters(game, botPlayerId)) {
    if (attacker.hp <= 0 || !attacker.position) continue;

    for (const targetId of availableAttackTargets(
      game,
      botPlayerId,
      attacker.id,
    )) {
      const target = game.characters.find((character) => character.id === targetId);
      if (!target) continue;

      actions.push({
        type: 'action:attack',
        payload: { attackerId: attacker.id, targetId },
        facts: {
          attacker,
          target,
          damage,
          lethal: target.hp <= damage,
        },
      });
    }
  }
  return actions;
}

function collectMoveActions({ game, botPlayerId, dieIndex, state }) {
  const dieValue = game.turn.dice?.[dieIndex];
  if (!Number.isInteger(dieValue) || dieValue <= 0) return [];

  if (game.mapId) {
    const actions = [];
    for (const character of ownCharacters(game, botPlayerId)) {
      const enemyStarts = enemyIslandCells(character.side);
      const before = Math.min(
        ...enemyStarts.map((target) => shortestDistance(character.position, target)),
      );
      for (const target of availableMoveTargets(
        game,
        botPlayerId,
        character.id,
        dieIndex,
      )) {
        const remainingDistance = Math.min(
          ...enemyStarts.map((goal) => shortestDistance(target.cellId, goal)),
        );
        const progress = before - remainingDistance;
        if (progress <= 0) continue;
        actions.push({
          type: 'action:move',
          payload: {
            characterId: character.id,
            toCell: target.cellId,
            dieIndex,
          },
          facts: {
            character,
            target: {
              id: enemyStarts.includes(target.cellId) ? target.cellId : 'enemy-island',
              priority: enemyStarts.includes(target.cellId) ? 100 : 3,
            },
            steps: target.distance,
            progress,
            remainingDistance,
          },
        });
      }
    }
    return actions;
  }

  const cellIndex = buildCellIndex(state);
  const targets = collectTargets(state, botPlayerId, cellIndex);
  if (cellIndex.size === 0 || targets.length === 0) return [];

  const actions = [];
  for (const character of ownCharacters(game, botPlayerId)) {
    const fromId = positionId(character.position);
    if (!fromId || !cellIndex.has(fromId)) continue;

    const reachable = distancesFrom(fromId, cellIndex, dieValue);
    for (const target of targets) {
      const distancesToTarget = distancesFrom(target.id, cellIndex);
      const before = distancesToTarget.get(fromId);
      if (!Number.isFinite(before) || before === 0) continue;

      for (const [toCell, steps] of reachable) {
        if (toCell === fromId || steps === 0) continue;
        const after = distancesToTarget.get(toCell);
        const progress = before - after;
        if (!Number.isFinite(after) || progress <= 0) continue;

        actions.push({
          type: 'action:move',
          payload: { characterId: character.id, toCell, dieIndex },
          facts: {
            character,
            target,
            steps,
            progress,
            remainingDistance: after,
          },
        });
      }
    }
  }
  return actions;
}

// Схватка со зверем: бьём зверя доступным кубиком (режим split).
function collectFightBeastActions({ game, botPlayerId, dieIndex }) {
  const value = game.turn.dice?.[dieIndex];
  if (!Number.isFinite(value)) return [];

  return ownCharacters(game, botPlayerId)
    .filter((character) => character.beastFight && character.hp > 0 && character.position)
    .map((character) => ({
      type: 'action:fightBeast',
      payload: { characterId: character.id, dieIndex },
      facts: { character, value },
    }));
}

const ACTION_GENERATORS = Object.freeze([
  collectFightBeastActions,
  collectAttackActions,
  collectDrawActions,
  collectTransferActions,
  collectMoveActions,
]);

const DEFAULT_GOALS = Object.freeze([
  {
    // Зверя нельзя игнорировать — он кусает каждый ход, поэтому
    // схватка важнее добора, передачи и движения.
    id: 'fight-beast',
    evaluate(action) {
      if (action.type !== 'action:fightBeast') return null;
      const { character, value } = action.facts;
      return {
        score: 5000 + value * 10,
        reason: `fightBeast:${character.role}:value=${value}`,
      };
    },
  },
  {
    id: 'attack-adjacent',
    evaluate(action) {
      if (action.type !== 'action:attack') return null;
      const { target, damage, lethal } = action.facts;
      return {
        score: 10000 + damage * 10 + (lethal ? 5000 : 0) - target.hp,
        reason: `attack:${target.id}:damage=${damage}${lethal ? ':lethal' : ''}`,
      };
    },
  },
  {
    id: 'gain-cards',
    evaluate(action, context) {
      if (action.type !== 'action:draw') return null;
      const { character, freeSlots } = action.facts;
      return {
        score: 100 + freeSlots * 8
          + roleRotationBonus(
            character.role,
            context.game,
            context.botPlayerId,
            context.dieIndex,
          ),
        reason: `draw:${character.role}:free=${freeSlots}`,
      };
    },
  },
  {
    id: 'balance-inventories',
    evaluate(action) {
      if (action.type !== 'action:transfer') return null;
      const { from, to, imbalance, count } = action.facts;
      return {
        score: 45 + imbalance * 7 + count * 3,
        reason: `transfer:${from.role}->${to.role}:count=${count}`,
      };
    },
  },
  {
    id: 'reach-targets',
    evaluate(action) {
      if (action.type !== 'action:move') return null;
      const { target, progress, remainingDistance, steps } = action.facts;
      return {
        score: 105 + target.priority * 20 + progress * 12
          - remainingDistance - Math.max(0, steps - progress),
        reason: `move:${target.id}:progress=${progress}:left=${remainingDistance}`,
      };
    },
  },
]);

function scoreAction(action, context, goals) {
  const evaluations = goals
    .map((goal) => goal.evaluate(action, context))
    .filter(Boolean);
  if (evaluations.length === 0) return null;

  return {
    ...action,
    score: evaluations.reduce((total, evaluation) => total + evaluation.score, 0),
    reason: evaluations.map((evaluation) => evaluation.reason).filter(Boolean).join('|'),
  };
}

export function rankBotActions(
  game,
  botPlayerId,
  dieIndex,
  { state = game, goals = DEFAULT_GOALS } = {},
) {
  if (!game?.turn?.dice || game.turn.usedDice?.[dieIndex]) return [];
  if (dieIndex !== 0 && dieIndex !== 1) return [];

  const context = { game, state, botPlayerId, dieIndex };
  // Каждый генератор — в try/catch, чтобы одна осечка не сваливала весь список
  const actions = ACTION_GENERATORS.flatMap((generator) => {
    try { return generator(context); } catch { return []; }
  })
    .map((action) => scoreAction(action, context, goals))
    .filter(Boolean)
    .map(({ facts, ...action }) => action);

  return actions.sort((a, b) =>
    b.score - a.score
    || a.type.localeCompare(b.type)
    || JSON.stringify(a.payload).localeCompare(JSON.stringify(b.payload)));
}

function tryApply(applyCommand, broadcast, roomId, botPlayerId, action) {
  try {
    applyCommand({
      roomId,
      playerId: botPlayerId,
      type: action.type,
      payload: action.payload,
    });
    broadcast(roomId);
    return true;
  } catch {
    return false;
  }
}

function applySimple(applyCommand, broadcast, roomId, botPlayerId, type, payload = {}) {
  return tryApply(applyCommand, broadcast, roomId, botPlayerId, {
    type,
    payload,
  });
}

function performBestAction({
  applyCommand,
  getRoom,
  broadcast,
  roomId,
  botPlayerId,
  dieIndex,
}) {
  const room = getRoom(roomId);
  if (!room?.game) return false;

  const ranked = rankBotActions(room.game, botPlayerId, dieIndex, { state: room.game });
  for (const action of ranked) {
    if (tryApply(applyCommand, broadcast, roomId, botPlayerId, action)) {
      return true;
    }
  }
  return false;
}

export async function runBotTurn({
  applyCommand,
  getRoom,
  broadcast,
  roomId,
  botPlayerId,
  wait = delay,
}) {
  const simple = (type, payload) =>
    applySimple(applyCommand, broadcast, roomId, botPlayerId, type, payload);

  await wait(650);
  if (!simple('turn:roll')) {
    simple('turn:end');
    return;
  }

  // moveSum: одно перемещение на сумму кубиков за ход (а не два раздельных).
  // Карты победы пока не реализованы, поэтому бот использует сумму кубиков
  // для движения к территории противника или побега из боя.
  // Исключение — схватка со зверем: переходим в split, чтобы бить зверя
  // кубиками (action:fightBeast доступен только в split).
  const inBeastFight = (getRoom(roomId)?.game?.characters ?? []).some(
    (character) =>
      character.owner === botPlayerId
      && character.hp > 0
      && character.position
      && character.beastFight,
  );

  await wait(350);
  if (!simple('turn:setMode', { mode: inBeastFight ? 'split' : 'moveSum' })) {
    simple('turn:end');
    return;
  }

  await wait(500);
  performBestAction({
    applyCommand,
    getRoom,
    broadcast,
    roomId,
    botPlayerId,
    dieIndex: 0,
  });

  if (inBeastFight) {
    // Второй кубик — ещё одна попытка добить зверя (или другое действие).
    await wait(300);
    performBestAction({
      applyCommand,
      getRoom,
      broadcast,
      roomId,
      botPlayerId,
      dieIndex: 1,
    });
  }

  await wait(450);
  simple('turn:end');
}
