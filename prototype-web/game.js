const roles = {
  K: "Кузнец",
  P: "Помощник",
  V: "Воин",
  O: "Охотник",
  S: "Шаман",
};

// Файлы транспарентного арта персонажей по роли; цвет — по игроку.
const roleArt = {
  K: "blacksmith",
  P: "assistant",
  V: "warrior",
  O: "hunter",
  S: "shaman",
};

function characterArt(character) {
  const color = character.player === 1 ? "green" : "red";
  return `./assets/characters/${color}/transparent/${roleArt[character.role]}.png`;
}

const starts = [
  { role: "K", p1: [1, 1], p2: [13, 8] },
  { role: "P", p1: [2, 1], p2: [12, 8] },
  { role: "V", p1: [1, 2], p2: [13, 7] },
  { role: "O", p1: [2, 2], p2: [12, 7] },
  { role: "S", p1: [3, 2], p2: [11, 7] },
];

const deck = [
  "Бусы телепортации",
  "Железная руда",
  "Кожаный ремень",
  "Травы шамана",
  "Охотничий трофей",
  "Короткий меч",
  "Оберег дороги",
  "Карта переправы",
];

const state = {
  activePlayer: 1,
  rollsLeft: { 1: 10, 2: 10 },
  dice: [null, null],
  usedDice: [false, false],
  dieActions: [null, null],
  mode: "moveSum",
  selectedDie: 0,
  selectedCharacterId: null,
  characters: [],
  log: [],
};

const boardEl = document.querySelector("#board");
const charactersEl = document.querySelector("#characters");
const inventoryEl = document.querySelector("#inventory");
const logEl = document.querySelector("#log");
const turnInfoEl = document.querySelector("#turnInfo");
const diceHintEl = document.querySelector("#diceHint");
const endTurnBtn = document.querySelector("#endTurnBtn");
const resetBtn = document.querySelector("#resetBtn");
const performActionBtn = document.querySelector("#performActionBtn");
const dieButtons = [document.querySelector("#die1"), document.querySelector("#die2")];

const cells = [];
const cols = 15;
const rows = 10;
// Гексы pointy-top. Сетка рисуется одним inline-SVG (векторные polygon),
// без clip-path и растрового фона — это надёжно на любой видеокарте.
// Координаты — в логических единицах viewBox; масштаб задаёт только размер SVG.
const BASE = { hexW: 46, hexH: 53, colStep: 46, rowStep: 40, odd: 23 };
const svgNS = "http://www.w3.org/2000/svg";
const GRID_W = (cols - 1) * BASE.colStep + BASE.odd + BASE.hexW;
const GRID_H = (rows - 1) * BASE.rowStep + BASE.hexH;
let scale = 1;
let boardSvg = null;

function hexCenter(q, r) {
  return {
    cx: q * BASE.colStep + (r % 2 ? BASE.odd : 0) + BASE.hexW / 2,
    cy: r * BASE.rowStep + BASE.hexH / 2,
  };
}

function hexPoints(q, r) {
  const { cx, cy } = hexCenter(q, r);
  const hw = BASE.hexW / 2;
  const qh = BASE.hexH / 4;
  const hh = BASE.hexH / 2;
  return [
    [cx, cy - hh],
    [cx + hw, cy - qh],
    [cx + hw, cy + qh],
    [cx, cy + hh],
    [cx - hw, cy + qh],
    [cx - hw, cy - qh],
  ]
    .map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`)
    .join(" ");
}

function cellId(q, r) {
  return `${q}:${r}`;
}

function createMatch() {
  state.activePlayer = 1;
  state.rollsLeft = { 1: 10, 2: 10 };
  state.dice = [null, null];
  state.usedDice = [false, false];
  state.dieActions = [null, null];
  state.mode = "moveSum";
  state.selectedDie = 0;
  state.characters = [];
  state.log = [];

  for (const start of starts) {
    state.characters.push(makeCharacter(1, start.role, start.p1));
    state.characters.push(makeCharacter(2, start.role, start.p2));
  }

  state.characters.find((c) => c.player === 1 && c.role === "S").inventory.push("Бусы телепортации");
  state.characters.find((c) => c.player === 2 && c.role === "S").inventory.push("Бусы телепортации");
  state.selectedCharacterId = state.characters.find((c) => c.player === 1 && c.role === "V").id;
  addLog("Матч создан. Игрок 1 начинает на левом острове.");
  render();
}

function makeCharacter(player, role, position) {
  return {
    id: `p${player}-${role}`,
    player,
    role,
    name: roles[role],
    position: cellId(position[0], position[1]),
    inventory: [],
  };
}

function buildBoard() {
  boardEl.innerHTML = "";
  cells.length = 0;

  boardSvg = document.createElementNS(svgNS, "svg");
  boardSvg.setAttribute("class", "board-svg");
  boardSvg.setAttribute("viewBox", `0 0 ${GRID_W} ${GRID_H}`);
  boardSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  for (let r = 0; r < rows; r += 1) {
    for (let q = 0; q < cols; q += 1) {
      const id = cellId(q, r);
      cells.push({ id, q, r });

      const poly = document.createElementNS(svgNS, "polygon");
      poly.setAttribute("class", "cell");
      poly.setAttribute("points", hexPoints(q, r));
      poly.setAttribute("data-id", id);
      poly.addEventListener("click", () => handleCellClick(id));
      boardSvg.appendChild(poly);
    }
  }

  // Статичные подписи стартовых клеток.
  for (const cell of cells) {
    const label = getStartLabel(cell.id);
    if (!label) continue;
    const { cx, cy } = hexCenter(cell.q, cell.r);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("class", "start-label");
    text.setAttribute("x", cx);
    text.setAttribute("y", cy);
    text.textContent = label;
    boardSvg.appendChild(text);
  }

  boardEl.appendChild(boardSvg);
  layoutBoard();
}

function layoutBoard() {
  const w = GRID_W * scale;
  const h = GRID_H * scale;
  boardEl.style.width = `${w}px`;
  boardEl.style.height = `${h}px`;
  boardSvg.setAttribute("width", w);
  boardSvg.setAttribute("height", h);
}

function render() {
  renderTopbar();
  renderDice();
  renderBoard();
  renderCharacters();
  renderInventory();
  renderLog();
}

function renderTopbar() {
  turnInfoEl.textContent = `Ход игрока ${state.activePlayer}. Осталось бросков: ${state.rollsLeft[state.activePlayer]}`;
  performActionBtn.disabled = !canPerformPanelAction();
}

function renderDice() {
  const notRolled = state.dice[0] === null;
  const canRoll = state.rollsLeft[state.activePlayer] > 0;
  dieButtons.forEach((button, index) => {
    button.textContent = state.dice[index] ?? "🎲";
    button.disabled = notRolled ? !canRoll : state.usedDice[index] || state.mode === "moveSum";
    button.classList.toggle("rollable", notRolled && canRoll);
    button.classList.toggle("selected", !notRolled && state.selectedDie === index && state.mode !== "moveSum");
    button.classList.toggle("used", state.usedDice[index]);
  });

  const selectedValue = getSelectedDieValue();
  if (notRolled) {
    diceHintEl.textContent = canRoll
      ? "Нажмите на кубики, чтобы бросить."
      : "Броски закончились — завершите ход.";
  } else if (state.mode === "moveSum") {
    diceHintEl.textContent = `Движение на сумму: ${state.dice[0] + state.dice[1]} бордов.`;
  } else if (selectedValue !== null) {
    const usedActions = state.dieActions
      .map((action, index) => (action ? `К${index + 1}: ${getActionLabel(action)}` : null))
      .filter(Boolean)
      .join(", ");
    diceHintEl.textContent = `Выбран кубик ${state.selectedDie + 1}: значение ${selectedValue}.${usedActions ? ` Уже потрачено: ${usedActions}.` : ""}`;
  } else {
    diceHintEl.textContent = "Выберите доступный непотраченный кубик.";
  }
}

function renderBoard() {
  boardSvg.querySelectorAll(".token").forEach((node) => node.remove());
  const selected = getSelectedCharacter();
  const validTargets = selected ? getValidTargets(selected) : new Set();

  for (const el of boardSvg.querySelectorAll(".cell")) {
    const id = el.getAttribute("data-id");
    el.setAttribute("class", "cell");
    el.classList.toggle("start", Boolean(getStartLabel(id)));
    el.classList.toggle("occupied", state.characters.some((c) => c.position === id));
    el.classList.toggle("selected", selected?.position === id);
    el.classList.toggle("valid", validTargets.has(id));
  }

  for (const character of state.characters) {
    const cell = cells.find((c) => c.id === character.position);
    if (!cell) continue;

    const { cx, cy } = hexCenter(cell.q, cell.r);
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", `token p${character.player}`);
    g.setAttribute("transform", `translate(${cx} ${cy})`);

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 13);

    const text = document.createElementNS(svgNS, "text");
    text.textContent = character.role;

    g.appendChild(circle);
    g.appendChild(text);
    boardSvg.appendChild(g);
  }
}

function renderCharacters() {
  charactersEl.innerHTML = "";
  for (const character of state.characters.filter((c) => c.player === state.activePlayer)) {
    const button = document.createElement("button");
    button.className = `character-card p${character.player}`;
    button.classList.toggle("active", character.id === state.selectedCharacterId);
    button.innerHTML = `
      <img class="portrait-img" src="${characterArt(character)}" alt="${character.name}" />
      <strong>${character.name}</strong>
      <span class="meta">Позиция ${character.position} · карт: ${character.inventory.length}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedCharacterId = character.id;
      render();
    });
    charactersEl.appendChild(button);
  }
}

function renderInventory() {
  const character = getSelectedCharacter();
  if (!character) {
    inventoryEl.className = "inventory empty";
    inventoryEl.textContent = "Выберите персонажа.";
    return;
  }

  inventoryEl.className = character.inventory.length ? "inventory" : "inventory empty";
  inventoryEl.innerHTML = character.inventory.length
    ? character.inventory.map((card) => `<div class="card">${card}</div>`).join("")
    : "Инвентарь пуст.";
}

function renderLog() {
  logEl.innerHTML = state.log.map((entry) => `<div class="log-entry">${entry}</div>`).join("");
}

function handleCellClick(targetId) {
  const character = getSelectedCharacter();
  if (!character || state.dice[0] === null) return;

  if (state.mode === "teleport") {
    teleport(character, targetId);
    return;
  }

  if (state.mode !== "moveSum" && state.mode !== "moveDie") return;

  const maxDistance = getMoveDistance();
  if (!maxDistance) return;

  const distance = getDistance(character.position, targetId);
  if (distance <= 0 || distance > maxDistance) return;

  const from = character.position;
  character.position = targetId;
  spendMoveDice();
  addLog(`${character.name} игрока ${character.player}: ${from} -> ${targetId}, потрачено ${distance}.`);
  render();
}

function getValidTargets(character) {
  const targets = new Set();
  if (state.dice[0] === null) return targets;

  if (state.mode === "teleport") {
    if (state.dice[0] === null) return targets;
    if (!character.inventory.includes("Бусы телепортации")) return targets;
    for (const start of starts) {
      targets.add(cellId(start.p1[0], start.p1[1]));
      targets.add(cellId(start.p2[0], start.p2[1]));
    }
    return targets;
  }

  if (state.mode !== "moveSum" && state.mode !== "moveDie") return targets;

  const maxDistance = getMoveDistance();
  for (const cell of cells) {
    const distance = getDistance(character.position, cell.id);
    if (distance > 0 && distance <= maxDistance) {
      targets.add(cell.id);
    }
  }
  return targets;
}

function rollDice() {
  if (state.rollsLeft[state.activePlayer] <= 0 || state.dice[0] !== null) return;
  state.dice = [rollDie(), rollDie()];
  state.usedDice = [false, false];
  state.rollsLeft[state.activePlayer] -= 1;
  addLog(`Игрок ${state.activePlayer} бросил ${state.dice[0]} и ${state.dice[1]}.`);
  render();
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function endTurn() {
  state.activePlayer = state.activePlayer === 1 ? 2 : 1;
  state.dice = [null, null];
  state.usedDice = [false, false];
  state.selectedDie = 0;
  state.selectedCharacterId = state.characters.find((c) => c.player === state.activePlayer)?.id ?? null;
  addLog(`Ход перешел к игроку ${state.activePlayer}.`);
  render();
}

function drawCard() {
  const character = getSelectedCharacter();
  const dieValue = getSelectedDieValue();
  if (!character || dieValue === null) return;

  const card = deck[Math.floor(Math.random() * deck.length)];
  character.inventory.push(card);
  state.usedDice[state.selectedDie] = true;
  addLog(`${character.name} добирает карту: ${card}. Значение кубика не увеличивает добор.`);
  clearDiceIfSpent();
  render();
}

function transferCards() {
  const from = getSelectedCharacter();
  const dieValue = getSelectedDieValue();
  if (!from || dieValue === null) return;

  const allies = state.characters.filter((c) => c.player === state.activePlayer && c.id !== from.id);
  const target = allies.find((c) => c.position === from.position) ?? allies[0];
  const count = Math.min(dieValue, from.inventory.length);

  if (count === 0) {
    addLog(`${from.name}: нет карт для передачи.`);
    return;
  }

  const cards = from.inventory.splice(0, count);
  target.inventory.push(...cards);
  state.usedDice[state.selectedDie] = true;
  addLog(`${from.name} передает ${cards.length} карт персонажу ${target.name}. Лимит кубика: ${dieValue}.`);
  clearDiceIfSpent();
  render();
}

function performPanelAction() {
  if (state.mode === "draw") {
    drawCard();
  } else if (state.mode === "transfer") {
    transferCards();
  }
}

function canPerformPanelAction() {
  if (state.mode !== "draw" && state.mode !== "transfer") return false;
  if (!getSelectedCharacter()) return false;
  return getSelectedDieValue() !== null;
}

function teleport(character, targetId) {
  const isStart = Boolean(getStartLabel(targetId));
  if (state.dice[0] === null || !isStart || !character.inventory.includes("Бусы телепортации")) return;

  const from = character.position;
  const beadIndex = character.inventory.indexOf("Бусы телепортации");
  character.position = targetId;
  character.inventory.splice(beadIndex, 1);
  state.usedDice = [true, true];
  addLog(`${character.name} использует Бусы телепортации: ${from} -> ${targetId}.`);
  clearDiceIfSpent();
  render();
}

function getSelectedCharacter() {
  return state.characters.find((c) => c.id === state.selectedCharacterId) ?? null;
}

function getSelectedDieValue() {
  if (state.dice[0] === null) return null;
  if (state.usedDice[state.selectedDie]) return null;
  return state.dice[state.selectedDie];
}

function getMoveDistance() {
  if (state.dice[0] === null) return 0;
  if (state.mode === "moveSum") {
    return state.usedDice[0] || state.usedDice[1] ? 0 : state.dice[0] + state.dice[1];
  }
  return getSelectedDieValue() ?? 0;
}

function spendMoveDice() {
  if (state.mode === "moveSum") {
    state.usedDice = [true, true];
  } else {
    state.usedDice[state.selectedDie] = true;
  }
  clearDiceIfSpent();
}

function clearDiceIfSpent() {
  if (state.usedDice.every(Boolean)) {
    state.dice = [null, null];
    state.usedDice = [false, false];
  }
}

function getDistance(fromId, toId) {
  const [fromQ, fromR] = fromId.split(":").map(Number);
  const [toQ, toR] = toId.split(":").map(Number);
  return Math.abs(fromQ - toQ) + Math.abs(fromR - toR);
}

function getStartLabel(id) {
  for (const start of starts) {
    if (id === cellId(start.p1[0], start.p1[1])) return start.role;
    if (id === cellId(start.p2[0], start.p2[1])) return start.role;
  }
  return "";
}

function addLog(text) {
  state.log.unshift(text);
  state.log = state.log.slice(0, 40);
}

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    render();
  });
});

dieButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    if (state.dice[0] === null) {
      rollDice();
      return;
    }
    state.selectedDie = index;
    render();
  });
});

endTurnBtn.addEventListener("click", endTurn);
resetBtn.addEventListener("click", createMatch);
performActionBtn.addEventListener("click", performPanelAction);

// Равномерно вписываем поле в его рамку, сохраняя пропорции гексов.
// Меняем геометрию (а не transform), чтобы контуры не «рвались» при растяжении.
function fitBoard() {
  const wrap = boardEl.parentElement;
  if (!wrap) return;
  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const gridW = (cols - 1) * BASE.colStep + BASE.odd + BASE.hexW;
  const gridH = (rows - 1) * BASE.rowStep + BASE.hexH;
  scale = Math.max(0.3, Math.min(availW / gridW, availH / gridH));
  layoutBoard();
  renderBoard();
}

window.addEventListener("resize", fitBoard);

buildBoard();
createMatch();
requestAnimationFrame(fitBoard);
