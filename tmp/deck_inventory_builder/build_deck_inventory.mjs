import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const PROJECT_FILE = path.join(ROOT, "rram-deck-overlay-project.json");
const REGISTRY_FILE = path.join(ROOT, "prototype-web/assets/cards/card-art-registry.js");
const CARDS_DIR = path.join(ROOT, "prototype-web/assets/cards");
const OUTPUT_DIR = path.join(ROOT, "outputs/deck_inventory_20260630");
const THUMB_DIR = path.join(ROOT, "tmp/deck_inventory_builder/thumbs");
const OUTPUT_XLSX = path.join(OUTPUT_DIR, "deck_inventory_by_separators.xlsx");

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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function thumbDataUrl(sourcePath, key, width = 120, height = 170) {
  if (!sourcePath || !(await exists(sourcePath))) return "";
  await fs.mkdir(THUMB_DIR, { recursive: true });
  const thumbPath = path.join(THUMB_DIR, `${sanitizeFileName(key)}.png`);
  if (!(await exists(thumbPath))) {
    await sharp(sourcePath)
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(thumbPath);
  }
  const data = await fs.readFile(thumbPath);
  return `data:image/png;base64,${data.toString("base64")}`;
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

function loadRegistry() {
  const code = readFileSync(REGISTRY_FILE, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: REGISTRY_FILE });
  return sandbox.window.CARD_ART_REGISTRY || [];
}

function mode(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function cellRef(row, col) {
  let n = col;
  let letters = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    letters = String.fromCharCode(65 + m) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row}`;
}

function rangeRef(row1, col1, row2, col2) {
  return `${cellRef(row1, col1)}:${cellRef(row2, col2)}`;
}

function setHeader(range) {
  range.format = {
    fill: "#1F2937",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
}

function setTitle(range) {
  range.format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF", size: 14 },
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(THUMB_DIR, { recursive: true });

  const project = JSON.parse(await fs.readFile(PROJECT_FILE, "utf8"));
  const registry = loadRegistry();

  const registryById = new Map();
  const registryByName = new Map();
  for (const card of registry) {
    registryById.set(card.id, card);
    if (card.gameId) registryById.set(card.gameId, card);
    registryByName.set(keyFromName(card.name), card);
  }

  const descByKey = new Map();
  for (const card of registry) addDesc(descByKey, keyFromName(card.name), card.desc);

  const placedByUid = new Map((project.placed || []).map((item) => [item.uid, item]));
  for (const box of project.textBoxes || []) {
    const related = box.cardUid ? placedByUid.get(box.cardUid) : null;
    const key = canonKey(box.cardKey || related?.cardKey, related?.name || "");
    addDesc(descByKey, key, box.text);
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
    const label = section.label;
    if (!deckItemDecks.has(label)) deckItemDecks.set(label, []);
    deckItemDecks.get(label).push(item.deck);
  }

  for (const sep of separators) {
    if (!sep.deckKey) sep.deckKey = mode(deckItemDecks.get(sep.label) || []);
  }

  const rowsByKey = new Map();
  for (const { item, section } of itemSections) {
    const name = readable(item.name || "");
    const cardKey = canonKey(item.cardKey, name);
    const reg = registryById.get(item.registryId) || registryById.get(item.cardId) || registryByName.get(cardKey) || {};
    const rowKey = `${section.label}|${cardKey}|${item.art}`;
    const row = rowsByKey.get(rowKey) || {
      deckLabel: section.label,
      deckKey: section.deckKey || item.deck || "",
      name,
      type: readable(reg.type || item.type || ""),
      count: 0,
      description: descByKey.get(cardKey) || readable(reg.desc || ""),
      id: readable(reg.id || item.registryId || item.cardId || ""),
      cardKey,
      art: item.art,
      sourcePage: item.page,
      itemDecks: [],
    };
    row.count += 1;
    row.itemDecks.push(item.deck);
    row.sourcePage = Math.min(row.sourcePage, item.page || row.sourcePage);
    if (!row.description) row.description = descByKey.get(keyFromName(name)) || "";
    rowsByKey.set(rowKey, row);
  }

  const cardRows = [...rowsByKey.values()].sort((a, b) => {
    const sepA = separators.find((sep) => sep.label === a.deckLabel)?.order || 999;
    const sepB = separators.find((sep) => sep.label === b.deckLabel)?.order || 999;
    return sepA - sepB || a.name.localeCompare(b.name, "ru");
  });

  const deckStats = separators.map((sep) => {
    const rows = cardRows.filter((row) => row.deckLabel === sep.label);
    const deckKey = sep.deckKey || mode(rows.map((row) => row.deckKey));
    return {
      label: sep.label,
      deckKey,
      page: sep.page,
      y: sep.y,
      total: rows.reduce((sum, row) => sum + row.count, 0),
      unique: rows.length,
      backArt: BACK_ART[deckKey] || BACK_ART.base,
    };
  });

  const workbook = Workbook.create();
  const summary = workbook.worksheets.add("Сводка");
  const cards = workbook.worksheets.add("Карты");
  const seps = workbook.worksheets.add("Разделители");
  summary.showGridLines = false;
  cards.showGridLines = false;
  seps.showGridLines = false;

  summary.getRange("A1:F1").merge();
  summary.getRange("A1").values = [["Инвентаризация колод по ручным разделителям"]];
  setTitle(summary.getRange("A1"));
  summary.getRange("A3:F3").values = [["Колода", "Страница", "Y", "Карт всего", "Уникальных лиц", "Рубашка"]];
  setHeader(summary.getRange("A3:F3"));
  const summaryValues = deckStats.map((deck) => [deck.label, deck.page, deck.y, deck.total, deck.unique, ""]);
  if (summaryValues.length) summary.getRange(rangeRef(4, 1, 3 + summaryValues.length, 6)).values = summaryValues;
  summary.getRange("A1:A40").format.columnWidth = 24;
  summary.getRange("B1:E40").format.columnWidth = 14;
  summary.getRange("F1:F40").format.columnWidth = 16;
  const summaryBody = summary.getRange(rangeRef(4, 1, 3 + Math.max(summaryValues.length, 1), 6));
  summaryBody.format.wrapText = true;
  summaryBody.format.borders = { insideHorizontal: { style: "thin", color: "#D1D5DB" } };
  summary.freezePanes.freezeRows(3);

  for (let i = 0; i < deckStats.length; i += 1) {
    const row = 4 + i;
    summary.getRangeByIndexes(row - 1, 0, 1, 6).format.rowHeightPx = 84;
    const dataUrl = await thumbDataUrl(artPath(deckStats[i].backArt), `back_${deckStats[i].deckKey}`, 72, 96);
    if (dataUrl) {
      summary.images.add({
        dataUrl,
        anchor: { from: { row: row - 1, col: 5 }, extent: { widthPx: 48, heightPx: 70 } },
      });
    }
  }

  cards.getRange("A1:I1").merge();
  cards.getRange("A1").values = [["Карты по колодам: количество, описание, лицо и рубашка"]];
  setTitle(cards.getRange("A1"));
  const cardHeaders = ["Колода", "Название карты", "Тип", "Кол-во", "Описание", "ID", "Стр.", "Лицо", "Рубашка"];
  cards.getRange("A3:I3").values = [cardHeaders];
  setHeader(cards.getRange("A3:I3"));
  const cardValues = cardRows.map((row) => [
    row.deckLabel,
    row.name,
    row.type,
    row.count,
    row.description,
    row.id,
    row.sourcePage,
    "",
    "",
  ]);
  if (cardValues.length) cards.getRange(rangeRef(4, 1, 3 + cardValues.length, 9)).values = cardValues;
  cards.getRange(`A1:A${cardValues.length + 8}`).format.columnWidth = 22;
  cards.getRange(`B1:B${cardValues.length + 8}`).format.columnWidth = 32;
  cards.getRange(`C1:C${cardValues.length + 8}`).format.columnWidth = 16;
  cards.getRange(`D1:D${cardValues.length + 8}`).format.columnWidth = 9;
  cards.getRange(`E1:E${cardValues.length + 8}`).format.columnWidth = 64;
  cards.getRange(`F1:F${cardValues.length + 8}`).format.columnWidth = 24;
  cards.getRange(`G1:G${cardValues.length + 8}`).format.columnWidth = 8;
  cards.getRange(`H1:I${cardValues.length + 8}`).format.columnWidth = 16;
  const cardsBody = cards.getRange(rangeRef(4, 1, 3 + Math.max(cardValues.length, 1), 9));
  cardsBody.format.wrapText = true;
  cardsBody.format.borders = { insideHorizontal: { style: "thin", color: "#E5E7EB" } };
  cards.getRange(rangeRef(4, 4, 3 + Math.max(cardValues.length, 1), 4)).format.numberFormat = "#,##0";
  cards.freezePanes.freezeRows(3);
  cards.freezePanes.freezeColumns(2);

  for (let i = 0; i < cardRows.length; i += 1) {
    const row = 4 + i;
    cards.getRangeByIndexes(row - 1, 0, 1, 9).format.rowHeightPx = 106;
    const card = cardRows[i];
    const faceUrl = await thumbDataUrl(artPath(card.art), `face_${card.id}_${card.name}`, 84, 104);
    const backArt = BACK_ART[card.deckKey] || BACK_ART[mode(card.itemDecks)] || BACK_ART.base;
    const backUrl = await thumbDataUrl(artPath(backArt), `back_${card.deckKey || mode(card.itemDecks)}`, 72, 96);
    if (faceUrl) {
      cards.images.add({
        dataUrl: faceUrl,
        anchor: { from: { row: row - 1, col: 7 }, extent: { widthPx: 54, heightPx: 78 } },
      });
    }
    if (backUrl) {
      cards.images.add({
        dataUrl: backUrl,
        anchor: { from: { row: row - 1, col: 8 }, extent: { widthPx: 48, heightPx: 70 } },
      });
    }
  }

  seps.getRange("A1:E1").values = [["Порядок", "Колода", "Ключ рубашки", "Страница", "Y"]];
  setHeader(seps.getRange("A1:E1"));
  const sepValues = separators.map((sep) => [sep.order, sep.label, sep.deckKey, sep.page, sep.y]);
  if (sepValues.length) seps.getRange(rangeRef(2, 1, 1 + sepValues.length, 5)).values = sepValues;
  seps.getRange("A1:E40").format.columnWidth = 18;
  seps.freezePanes.freezeRows(1);

  const inspectSummary = await workbook.inspect({
    kind: "table",
    range: `Сводка!A1:F${Math.min(18, 3 + summaryValues.length)}`,
    include: "values,formulas",
    tableMaxRows: 20,
    tableMaxCols: 8,
    maxChars: 3000,
  });
  console.log(inspectSummary.ndjson);

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "formula error scan",
    maxChars: 1000,
  });
  console.log(errors.ndjson);

  for (const sheetName of ["Сводка", "Карты", "Разделители"]) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(
      path.join(OUTPUT_DIR, `${sheetName}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(OUTPUT_XLSX);

  console.log(JSON.stringify({
    output: OUTPUT_XLSX,
    cards: cardRows.length,
    decks: deckStats.length,
    totalCards: deckStats.reduce((sum, deck) => sum + deck.total, 0),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
