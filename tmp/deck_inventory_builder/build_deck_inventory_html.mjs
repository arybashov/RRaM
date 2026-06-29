import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";

const ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const PROJECT_FILE = path.join(ROOT, "rram-deck-overlay-project.json");
const REGISTRY_FILE = path.join(ROOT, "prototype-web/assets/cards/card-art-registry.js");
const GAME_FILE = path.join(ROOT, "prototype-web/game.js");
const CARDS_DIR = path.join(ROOT, "prototype-web/assets/cards");
const OUTPUT_DIR = path.join(ROOT, "outputs/deck_inventory_20260630");
const ASSET_DIR = path.join(OUTPUT_DIR, "html-assets");
const OUTPUT_HTML = path.join(OUTPUT_DIR, "deck_inventory.html");

const BACK_ART = {
  base: "backs/base-cards",
  mixed: "backs/mixed-ground",
  forest: "backs/forest",
  forest_trail: "backs/forest-trail",
  dark_forest: "backs/dark-forest",
  sheep: "backs/sheep",
  red: "backs/red-beasts",
  lake: "backs/lake",
  recipes: "backs/recipes",
  blueprints: "backs/blueprints",
  fairy_glade: "backs/fairy-glade",
  trophy: "backs/mixed-ground",
};

const LABEL_TO_DECK = {
  "Базовые карты": "base",
  "Смешанный грунт": "mixed",
  "Колода Лес": "forest",
  "Лесная тропа": "forest_trail",
  "Тёмный лес": "dark_forest",
  "Озеро": "lake",
  "Чертежи": "blueprints",
  "Рецепты": "recipes",
  "Таинственная опушка": "fairy_glade",
  "Бараны": "sheep",
  "Красная колода": "red",
  "Трофеи": "trophy",
};

function readable(value) {
  if (value == null) return "";
  const str = String(value);
  if (!/[ÐÑ]/.test(str)) return str;
  try {
    return Buffer.from(str, "latin1").toString("utf8");
  } catch {
    return str;
  }
}

function norm(value) {
  return readable(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function keyFromName(name) {
  return `name:${norm(name)}`;
}

function canonKey(value, fallbackName = "") {
  const str = readable(value || "");
  if (str.startsWith("name:")) return `name:${norm(str.slice(5))}`;
  if (str) return str;
  return keyFromName(fallbackName);
}

function comparePosition(a, b) {
  return (a.page || 0) - (b.page || 0) || (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
}

function beforeOrAt(a, b) {
  if ((a.page || 0) < (b.page || 0)) return true;
  if ((a.page || 0) > (b.page || 0)) return false;
  return (a.y || 0) <= (b.y || 0);
}

function artPath(art) {
  if (!art) return "";
  const rel = art.endsWith(".png") ? art : `${art}.png`;
  return path.join(CARDS_DIR, rel);
}

function sanitizeFileName(value) {
  return norm(value).replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 80) || "image";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeThumb(sourcePath, key, width = 180, height = 250) {
  if (!sourcePath || !(await exists(sourcePath))) return "";
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const fileName = `${sanitizeFileName(key)}.png`;
  const destPath = path.join(ASSET_DIR, fileName);
  if (!(await exists(destPath))) {
    await sharp(sourcePath)
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(destPath);
  }
  return `html-assets/${encodeURIComponent(fileName)}`;
}

function addDesc(map, key, text) {
  const clean = readable(text || "").trim();
  if (!key || !clean) return;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, clean);
  } else if (!prev.split("\n---\n").includes(clean)) {
    map.set(key, `${prev}\n---\n${clean}`);
  }
}

function mode(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function loadRegistry() {
  const code = readFileSync(REGISTRY_FILE, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: REGISTRY_FILE });
  return sandbox.window.CARD_ART_REGISTRY || [];
}

function extractFrozenObject(code, name) {
  const marker = `const ${name} = Object.freeze(`;
  const start = code.indexOf(marker);
  if (start < 0) return {};
  let pos = start + marker.length;
  let depth = 0;
  let quote = "";
  let escaped = false;
  const bodyStart = pos;
  for (; pos < code.length; pos += 1) {
    const ch = code[pos];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  const literal = code.slice(bodyStart, pos);
  try {
    return vm.runInNewContext(`(${literal})`, {}, { filename: `${GAME_FILE}:${name}` }) || {};
  } catch {
    return {};
  }
}

function loadGameData() {
  const code = readFileSync(GAME_FILE, "utf8");
  return {
    usage: extractFrozenObject(code, "CARD_USAGE_DESCRIPTIONS"),
    catalog: extractFrozenObject(code, "CARD_CATALOG_META"),
  };
}

function instructionFallback(row) {
  const type = norm(row.type);
  if (type === "beast") return "Зверь: при встрече начинается схватка. Точные броски, урон и добычу нужно уточнить по карте или игровому правилу.";
  if (type === "ingredient") return "Ингредиент: хранится в инвентаре и используется в рецептах или чертежах. Конкретный рецепт нужно сверить по карте.";
  if (type === "weapon") return "Оружие: применяется в атаке после получения/активации. Точные цифры урона нужно уточнить по карте или правилу игры.";
  if (type === "armor") return "Защита: выкладывается на персонажа и уменьшает входящий урон. Точное значение защиты нужно уточнить по карте.";
  if (type === "blueprint") return "Чертеж: открывает предмет после выполнения условий крафта. Нужные материалы и броски нужно сверить по карте.";
  if (type === "recipe") return "Рецепт: открывает предмет или эффект после выполнения условий. Нужные материалы и броски нужно сверить по карте.";
  if (type === "provocation") return "Ловушка/провокация: обычно выкладывается рубашкой вверх и срабатывает при атаке противника. Точный эффект нужно сверить по карте.";
  if (type === "special") return "Особая карта: применяется по тексту карты или отдельному правилу. Если точного текста нет, нужно уточнить эффект.";
  if (type === "companion") return "Спутник: помогает персонажу по специальному правилу. Точный эффект нужно сверить в игровой инструкции.";
  return "Точного правила в игровых данных нет. Нужно уточнить назначение карты перед внесением в игру.";
}

function isPhoenixRow(row) {
  return [...(row.ids || []), ...(row.gameIds || []), ...(row.registryIds || []), row.id, row.gameId, row.registryId]
    .filter(Boolean)
    .some((id) => String(id).startsWith("phoenix_"));
}

function manualMechanicFor(row) {
  const name = norm(row.name);
  if (name.includes("золотое перо") && name.includes("кузнецу противника")) {
    return "Маяк: носитель виден всем и не телепортируется. Доставьте перо на камень кузнеца врага; работает так же, как золотое перо к своему кузнецу, только цель доставки - кузнец противника.";
  }
  return "";
}

function instructionFor(row, gameUsageById, gameCatalogById) {
  const manual = manualMechanicFor(row);
  if (manual) return manual;
  const candidates = [...(row.ids || []), ...(row.gameIds || []), ...(row.registryIds || []), row.id, row.gameId, row.registryId].filter(Boolean);
  if (isPhoenixRow(row)) {
    for (const id of candidates) {
      if (gameUsageById.has(id)) return readable(gameUsageById.get(id));
    }
  }
  if (row.hasProjectDescription && row.description) return `По описанию из JSON: ${row.description}`;
  for (const id of candidates) {
    if (gameUsageById.has(id)) return readable(gameUsageById.get(id));
  }
  for (const id of candidates) {
    const meta = gameCatalogById.get(id);
    if (meta?.desc) return readable(meta.desc);
  }
  if (row.description && row.description !== "описания нет") return `По тексту карты: ${row.description}`;
  return instructionFallback(row);
}

function questionsFor(row) {
  if (isPhoenixRow(row)) return "Вопросов нет. Игровой механизм Феникса не меняем.";
  if (manualMechanicFor(row)) return "Вопросов нет.";
  const questions = [];
  if (!row.description) {
    questions.push("Нет текста карты. Нужно описать эффект и условия применения.");
  }
  const instruction = row.instruction || "";
  if (/нужно уточнить|точного правила|сверить по карте|если точного текста нет/i.test(instruction)) {
    questions.push("Нет точного правила в игровых данных. Как карта должна работать?");
  }
  if (row.hasProjectDescription && (row.ids || []).length > 1) {
    const gameInstructions = new Set();
    for (const id of [...(row.ids || []), ...(row.gameIds || [])]) {
      if (row.gameUsageById?.has(id)) gameInstructions.add(row.gameUsageById.get(id));
    }
    if (gameInstructions.size > 1) {
      questions.push("У объединённых вариантов разные игровые правила. Какое правило считать правильным?");
    }
  }
  if (questions.length === 0) return "Вопросов нет.";
  return questions.map((text, index) => `${index + 1}. ${text}`).join("\n");
}

function buildData(project, registry, gameData) {
  const registryById = new Map();
  const registryByName = new Map();
  for (const card of registry) {
    registryById.set(card.id, card);
    if (card.gameId) registryById.set(card.gameId, card);
    registryByName.set(keyFromName(card.name), card);
  }

  const fallbackDescByKey = new Map();
  for (const card of registry) addDesc(fallbackDescByKey, keyFromName(card.name), card.desc);
  const projectDescByKey = new Map();
  const gameUsageById = new Map(Object.entries(gameData.usage || {}).map(([id, text]) => [id, readable(text)]));
  const gameCatalogById = new Map(Object.entries(gameData.catalog || {}).map(([id, meta]) => [id, meta || {}]));

  const placedByUid = new Map((project.placed || []).map((item) => [item.uid, item]));
  for (const box of project.textBoxes || []) {
    const related = box.cardUid ? placedByUid.get(box.cardUid) : null;
    const key = canonKey(box.cardKey || related?.cardKey, related?.name || "");
    addDesc(projectDescByKey, key, box.text);
  }

  const separators = (project.deckSeparators || [])
    .map((sep, idx) => ({
      ...sep,
      order: idx + 1,
      label: readable(sep.label || `Разделитель ${idx + 1}`),
      deckKey: LABEL_TO_DECK[readable(sep.label || "")] || "",
    }))
    .sort(comparePosition);

  const faceItems = (project.placed || [])
    .filter((item) => item.kind === "card" && item.face !== "back")
    .sort(comparePosition);

  const itemSections = [];
  for (const item of faceItems) {
    let section = separators[0] || { label: "Без разделителя", page: 0, y: 0, deckKey: item.deck || "" };
    for (const sep of separators) {
      if (beforeOrAt(sep, item)) section = sep;
      else break;
    }
    itemSections.push({ item, section });
  }

  const deckItemDecks = new Map();
  for (const { item, section } of itemSections) {
    if (!deckItemDecks.has(section.label)) deckItemDecks.set(section.label, []);
    deckItemDecks.get(section.label).push(item.deck);
  }

  for (const sep of separators) {
    if (!sep.deckKey) sep.deckKey = mode(deckItemDecks.get(sep.label) || []);
  }

  const rowsByKey = new Map();
  for (const { item, section } of itemSections) {
    const name = readable(item.name || "");
    const cardKey = canonKey(item.cardKey, name);
    const reg = registryById.get(item.registryId) || registryById.get(item.cardId) || registryByName.get(cardKey) || {};
    const gameMeta = gameCatalogById.get(item.registryId) || gameCatalogById.get(item.cardId) || {};
    const rowKey = cardKey;
    const row = rowsByKey.get(rowKey) || {
      deckLabels: new Set(),
      deckKeys: new Set(),
      countsByDeck: new Map(),
      deckKey: section.deckKey || item.deck || "",
      name,
      type: readable(reg.type || gameMeta.type || item.type || ""),
      count: 0,
      descriptions: new Set(),
      ids: new Set(),
      registryIds: new Set(),
      gameIds: new Set(),
      cardKey,
      arts: new Set(),
      sourcePages: new Set(),
      itemDecks: [],
    };
    row.count += 1;
    row.deckLabels.add(section.label);
    if (section.deckKey) row.deckKeys.add(section.deckKey);
    row.countsByDeck.set(section.label, (row.countsByDeck.get(section.label) || 0) + 1);
    const projectDesc = projectDescByKey.get(cardKey) || "";
    const desc = projectDesc || fallbackDescByKey.get(cardKey) || readable(reg.desc || gameMeta.desc || "");
    if (desc) row.descriptions.add(desc);
    if (projectDesc) row.hasProjectDescription = true;
    if (reg.id || item.registryId || item.cardId) row.ids.add(readable(reg.id || item.registryId || item.cardId));
    if (item.registryId) row.registryIds.add(readable(item.registryId));
    if (reg.gameId || item.cardId) row.gameIds.add(readable(reg.gameId || item.cardId));
    if (item.art) row.arts.add(item.art);
    if (item.page) row.sourcePages.add(item.page);
    row.itemDecks.push(item.deck);
    rowsByKey.set(rowKey, row);
  }

  for (const row of rowsByKey.values()) {
    if (row.descriptions.size === 0) {
      const fallbackDesc = projectDescByKey.get(keyFromName(row.name)) || fallbackDescByKey.get(keyFromName(row.name)) || "";
      if (fallbackDesc) row.descriptions.add(fallbackDesc);
      if (projectDescByKey.get(keyFromName(row.name))) row.hasProjectDescription = true;
    }
    row.deckLabels = [...row.deckLabels];
    row.deckKeys = [...row.deckKeys];
    row.ids = [...row.ids];
    row.registryIds = [...row.registryIds];
    row.gameIds = [...row.gameIds];
    row.arts = [...row.arts];
    row.sourcePages = [...row.sourcePages].sort((a, b) => a - b);
    row.description = [...row.descriptions].join("\n---\n");
    row.id = row.ids.join(", ");
    row.registryId = row.registryIds[0] || "";
    row.gameId = row.gameIds[0] || "";
    row.art = row.arts[0] || "";
    row.deckKey = row.deckKeys[0] || mode(row.itemDecks);
    row.sourcePage = row.sourcePages.join(", ");
    row.gameUsageById = gameUsageById;
    row.instruction = instructionFor(row, gameUsageById, gameCatalogById);
    row.questions = questionsFor(row);
    delete row.gameUsageById;
  }

  const cardRows = [...rowsByKey.values()].sort((a, b) => {
    const sepA = Math.min(...a.deckLabels.map((label) => separators.find((sep) => sep.label === label)?.order || 999));
    const sepB = Math.min(...b.deckLabels.map((label) => separators.find((sep) => sep.label === label)?.order || 999));
    return sepA - sepB || a.name.localeCompare(b.name, "ru");
  });

  const deckStats = separators.map((sep) => {
    const rows = cardRows.filter((row) => row.deckLabels.includes(sep.label));
    const deckKey = sep.deckKey || mode(rows.flatMap((row) => row.deckKeys));
    return {
      label: sep.label,
      deckKey,
      page: sep.page,
      y: sep.y,
      total: rows.reduce((sum, row) => sum + (row.countsByDeck.get(sep.label) || 0), 0),
      unique: rows.length,
      backArt: BACK_ART[deckKey] || BACK_ART.base,
    };
  });

  return { cardRows, deckStats };
}

async function enrichImages(cardRows, deckStats) {
  const backImageByDeck = new Map();
  for (const deck of deckStats) {
    const src = await makeThumb(artPath(deck.backArt), `back_${deck.deckKey}`, 96, 140);
    deck.backImg = src;
    backImageByDeck.set(deck.deckKey, src);
  }

  for (const row of cardRows) {
    row.faceImgs = [];
    for (const art of row.arts) {
      const src = await makeThumb(artPath(art), `face_${row.id}_${row.name}_${art}`, 120, 166);
      if (src && !row.faceImgs.includes(src)) row.faceImgs.push(src);
    }
    row.backImgs = [];
    for (const deckKey of row.deckKeys.length ? row.deckKeys : [row.deckKey || mode(row.itemDecks)]) {
      const src = backImageByDeck.get(deckKey);
      if (src && !row.backImgs.includes(src)) row.backImgs.push(src);
    }
  }
}

function renderHtml(cardRows, deckStats) {
  const totalCards = deckStats.reduce((sum, deck) => sum + deck.total, 0);
  const deckButtons = deckStats
    .map((deck) => `<button class="deck-tab" type="button" data-deck="${htmlEscape(deck.label)}">${htmlEscape(deck.label)} <span>${deck.total}</span></button>`)
    .join("");
  const summaryCards = deckStats
    .map((deck) => `
      <article class="summary-card" data-deck="${htmlEscape(deck.label)}">
        <img src="${htmlEscape(deck.backImg)}" alt="">
        <div>
          <h2>${htmlEscape(deck.label)}</h2>
          <p>${deck.total} карт, ${deck.unique} уникальных лиц</p>
          <small>стр. ${deck.page}, y ${deck.y}</small>
        </div>
      </article>`)
    .join("");
  const rows = cardRows
    .map((row) => `
      <tr data-decks="${htmlEscape(row.deckLabels.join("|"))}" data-search="${htmlEscape(`${row.deckLabels.join(" ")} ${row.name} ${row.type} ${row.id} ${row.instruction} ${row.questions}`.toLowerCase())}">
        <td class="image-cell image-stack">${row.faceImgs.map((src) => `<img class="card-face" src="${htmlEscape(src)}" alt="">`).join("")}</td>
        <td class="image-cell image-stack">${row.backImgs.map((src) => `<img class="card-back" src="${htmlEscape(src)}" alt="">`).join("")}</td>
        <td class="card-title">${htmlEscape(row.name)}<small>${htmlEscape(row.id)}</small></td>
        <td>${htmlEscape(row.type || "—")}</td>
        <td class="count">${row.count}</td>
        <td class="instruction">${htmlEscape(row.instruction || "нужно уточнить")}</td>
        <td class="questions">${htmlEscape(row.questions)}</td>
      </tr>`)
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Таблица колод</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111827;
      --panel: #172033;
      --panel-2: #202b42;
      --line: #35425c;
      --text: #e8eef8;
      --muted: #aab6cb;
      --accent: #38bdf8;
      --accent-2: #f5d56a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 15px;
    }
    header {
      position: static;
      z-index: 5;
      background: rgba(17, 24, 39, .96);
      border-bottom: 1px solid var(--line);
      padding: 16px 22px 14px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .meta {
      display: flex;
      gap: 16px;
      color: var(--muted);
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 360px) 1fr;
      gap: 12px;
      align-items: start;
    }
    input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0d1423;
      color: var(--text);
      padding: 10px 12px;
      font: inherit;
    }
    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      padding: 8px 10px;
      font: inherit;
      cursor: pointer;
    }
    button.active {
      border-color: var(--accent);
      color: #dff6ff;
      background: #123047;
    }
    button span {
      color: var(--accent-2);
      font-weight: 700;
      margin-left: 4px;
    }
    main {
      padding: 18px 22px 32px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .summary-card {
      display: flex;
      gap: 12px;
      align-items: center;
      min-height: 118px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 10px;
    }
    .summary-card img {
      width: 54px;
      height: 78px;
      object-fit: contain;
      flex: 0 0 auto;
    }
    .summary-card h2 {
      margin: 0 0 6px;
      font-size: 18px;
      line-height: 1.2;
    }
    .summary-card p {
      margin: 0 0 4px;
      color: var(--text);
      font-weight: 700;
    }
    small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.25;
      margin-top: 4px;
    }
    .table-wrap {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: auto;
      background: var(--panel);
    }
    table {
      width: 100%;
      min-width: 1420px;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 3;
      background: #243047;
      color: #f8fbff;
      text-align: left;
      padding: 10px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    tbody td {
      vertical-align: top;
      padding: 10px;
      border-bottom: 1px solid #2c3850;
    }
    tbody tr:hover {
      background: rgba(56, 189, 248, .08);
    }
    .image-cell {
      text-align: center;
    }
    .image-stack {
      white-space: normal;
    }
    th:nth-child(1), td:nth-child(1) { width: 120px; }
    th:nth-child(2), td:nth-child(2) { width: 180px; }
    th:nth-child(3), td:nth-child(3) { width: 250px; }
    th:nth-child(4), td:nth-child(4) { width: 110px; }
    th:nth-child(5), td:nth-child(5) { width: 78px; }
    th:nth-child(6), td:nth-child(6) { width: 430px; }
    th:nth-child(7), td:nth-child(7) { width: 420px; }
    .card-face {
      width: 62px;
      max-height: 88px;
      object-fit: contain;
      display: inline-block;
      margin: 0 3px 6px;
      vertical-align: top;
    }
    .card-back {
      width: 50px;
      max-height: 74px;
      object-fit: contain;
      display: inline-block;
      margin: 0 3px 6px;
      vertical-align: top;
    }
    .card-title {
      width: 240px;
      font-weight: 800;
      font-size: 16px;
    }
    .count {
      text-align: right;
      font-weight: 800;
      color: var(--accent-2);
    }
    .questions {
      white-space: pre-wrap;
      min-width: 380px;
      max-width: 560px;
      line-height: 1.35;
      color: #d9e2f2;
    }
    .instruction {
      white-space: pre-wrap;
      min-width: 420px;
      max-width: 620px;
      line-height: 1.35;
      color: #f2e8c9;
    }
    .hidden { display: none !important; }
    @media (max-width: 800px) {
      header { position: static; }
      .toolbar { grid-template-columns: 1fr; }
      thead th { top: 0; }
      main { padding: 14px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Таблица колод по ручным разделителям</h1>
    <div class="meta">
      <span>Колод: ${deckStats.length}</span>
      <span>Карт всего: ${totalCards}</span>
      <span>Уникальных строк: ${cardRows.length}</span>
    </div>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Поиск по карте, описанию, типу">
      <div class="tabs">
        <button class="deck-tab active" type="button" data-deck="">Все <span>${totalCards}</span></button>
        ${deckButtons}
      </div>
    </div>
  </header>
  <main>
    <section class="summary">${summaryCards}</section>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Лицо</th>
            <th>Рубашка</th>
            <th>Карта</th>
            <th>Тип</th>
            <th>Кол-во</th>
            <th>Чёткая инструкция</th>
            <th>Вопросы</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </main>
  <script>
    const search = document.getElementById('search');
    const tabs = [...document.querySelectorAll('.deck-tab')];
    const rows = [...document.querySelectorAll('tbody tr')];
    const cards = [...document.querySelectorAll('.summary-card')];
    let deck = '';

    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      let visible = 0;
      for (const row of rows) {
        const rowDecks = (row.dataset.decks || '').split('|');
        const okDeck = !deck || rowDecks.includes(deck);
        const okSearch = !q || row.dataset.search.includes(q);
        row.classList.toggle('hidden', !(okDeck && okSearch));
        if (okDeck && okSearch) visible += Number(row.querySelector('.count').textContent || 0);
      }
      for (const card of cards) card.classList.toggle('hidden', !!deck && card.dataset.deck !== deck);
      document.title = visible ? 'Таблица колод - ' + visible + ' карт' : 'Таблица колод';
    }

    tabs.forEach((button) => {
      button.addEventListener('click', () => {
        deck = button.dataset.deck;
        tabs.forEach((tab) => tab.classList.toggle('active', tab === button));
        applyFilter();
      });
    });
    search.addEventListener('input', applyFilter);
  </script>
</body>
</html>`;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(ASSET_DIR, { recursive: true });
  const project = JSON.parse(await fs.readFile(PROJECT_FILE, "utf8"));
  const registry = loadRegistry();
  const gameData = loadGameData();
  const { cardRows, deckStats } = buildData(project, registry, gameData);
  await enrichImages(cardRows, deckStats);
  await fs.writeFile(OUTPUT_HTML, renderHtml(cardRows, deckStats), "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_HTML,
    decks: deckStats.length,
    rows: cardRows.length,
    totalCards: deckStats.reduce((sum, deck) => sum + deck.total, 0),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
