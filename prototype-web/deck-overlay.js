const ASSET_ROOT = './assets/cards/';
const CARD_EXT = '.png';

const BACK_BY_DECK = {
  base: 'backs/base-cards',
  mixed: 'backs/mixed-ground',
  forest: 'backs/forest',
  forest_trail: 'backs/forest-trail',
  dark_forest: 'backs/dark-forest',
  sheep: 'backs/sheep',
  red: 'backs/red-beasts',
  lake: 'backs/lake',
  recipes: 'backs/recipes',
  blueprints: 'backs/blueprints',
  fairy_glade: 'backs/fairy-glade',
  trophy: 'backs/mixed-ground',
};

const DECK_LABELS = {
  base: 'Базовые карты',
  mixed: 'Смешанный грунт',
  forest: 'Колода Лес',
  forest_trail: 'Лесная тропа',
  dark_forest: 'Тёмный лес',
  sheep: 'Бараны',
  lake: 'Озеро',
  recipes: 'Рецепты',
  blueprints: 'Чертежи',
  red: 'Красная колода',
  fairy_glade: 'Таинственная опушка',
  trophy: 'Трофеи',
};

const NAME_OVERRIDES = {
  bp_club_base: 'Чертеж на дубину',
  bp_hammer_base: 'Чертеж на молоток',
  recipe_shaman_carpet: 'Рецепт на ковер шамана',
};

const PDF_PAGE_COUNT = 110;
const PDF_PAGE_PREFIX = './assets/card-sheets/cards-page-';
const PROJECT_STORAGE_KEY = 'rram.deckOverlay.project.v1';
const TESSERACT_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const PROJECT_FILE_NAME = 'rram-deck-overlay-project.json';
const REMOVED_FACE_CARD_IDS = new Set(['boar_hide', 'wolf_hide']);

const stage = document.getElementById('stage');
const connectionLayer = document.getElementById('connectionLayer');
const cardList = document.getElementById('cardList');
const backList = document.getElementById('backList');
const deckFilter = document.getElementById('deckFilter');
const searchInput = document.getElementById('searchInput');
const backgroundInput = document.getElementById('backgroundInput');
const layoutInput = document.getElementById('layoutInput');
const saveProjectBtn = document.getElementById('saveProjectBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const connectBtn = document.getElementById('connectBtn');
const unlinkBtn = document.getElementById('unlinkBtn');
const deckSeparatorBtn = document.getElementById('deckSeparatorBtn');
const textBoxBtn = document.getElementById('textBoxBtn');
const recognizeTextBtn = document.getElementById('recognizeTextBtn');
const attachTextBtn = document.getElementById('attachTextBtn');
const copyKitBtn = document.getElementById('copyKitBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const prevPdfPageBtn = document.getElementById('prevPdfPageBtn');
const nextPdfPageBtn = document.getElementById('nextPdfPageBtn');
const pdfPageInfo = document.getElementById('pdfPageInfo');
const zoomInput = document.getElementById('zoomInput');
const cardSizeInput = document.getElementById('cardSizeInput');
const selectionInfo = document.getElementById('selectionInfo');

const cardKeyAliases = new Map();

let cards = normalizeRegistry(window.CARD_ART_REGISTRY || []);
let placed = [];
let links = [];
let textBoxes = [];
let deckSeparators = [];
let recentSelection = [];
let selectedId = null;
let selectedTextId = null;
let selectedSeparatorId = null;
let nextId = 1;
let nextLinkId = 1;
let nextTextId = 1;
let nextSeparatorId = 1;
let stageSize = { width: 900, height: 620 };
let backgroundDataUrl = '';
let pdfPage = 1;
let textBoxMode = false;
let ocrEnginePromise = null;
let projectFileHandle = null;

function normalizeRegistry(registry) {
  const byFace = new Map();
  const entries = registry
    .filter(card => card && card.id && card.art)
    .filter(card => !REMOVED_FACE_CARD_IDS.has(card.gameId || card.id))
    .map(card => ({
      id: card.gameId || card.id,
      registryId: card.id,
      name: NAME_OVERRIDES[card.gameId || card.id] || readable(card.name || card.id),
      deck: card.deck || 'base',
      type: card.type || 'unknown',
      source: readable(card.source || ''),
      art: card.art,
      copies: Number.isFinite(Number(card.copies)) ? Number(card.copies) : 0,
      inGame: Boolean(card.inGame),
      desc: readable(card.desc || ''),
    }));
  cardKeyAliases.clear();
  for (const card of entries) {
    const key = cardFaceKey(card);
    card.cardKey = key;
    registerCardKeyAlias(card.registryId, key);
    registerCardKeyAlias(card.id, key);
    registerCardKeyAlias(card.name, key);
    const current = byFace.get(key);
    if (!current || isBetterPaletteCard(card, current)) {
      byFace.set(key, card);
    }
  }
  return [...byFace.values()];
}

function isBetterPaletteCard(candidate, current) {
  if (candidate.inGame !== current.inGame) return candidate.inGame;
  if (candidate.copies !== current.copies) return candidate.copies > current.copies;
  return false;
}

function cardFaceKey(card) {
  return `name:${String(card?.name || '').trim().toLocaleLowerCase('ru-RU')}`;
}

function registerCardKeyAlias(value, key) {
  const text = String(value || '').trim();
  if (!text || !key) return;
  cardKeyAliases.set(text, key);
  cardKeyAliases.set(`name:${text.toLocaleLowerCase('ru-RU')}`, key);
}

function canonicalCardKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return cardKeyAliases.get(text) || cardKeyAliases.get(`name:${text.toLocaleLowerCase('ru-RU')}`) || text;
}

function readable(value) {
  const text = String(value ?? '');
  if (!text.includes('Ð') && !text.includes('Ñ')) return text;
  try {
    const bytes = Uint8Array.from([...text].map(ch => ch.charCodeAt(0) & 255));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return text;
  }
}

function imgSrc(path) {
  if (!path) return '';
  return `${ASSET_ROOT}${path}${path.endsWith('.png') ? '' : CARD_EXT}`;
}

function backSrc(deck) {
  return imgSrc(BACK_BY_DECK[deck] || BACK_BY_DECK.mixed);
}

function pdfPageUrl(page) {
  return `${PDF_PAGE_PREFIX}${String(page).padStart(3, '0')}.jpg`;
}

function deckKeys() {
  return Object.keys(BACK_BY_DECK).filter(deck => deck !== 'trophy');
}

function init() {
  renderDeckFilter();
  renderBackList();
  renderPalette();
  updateStageScale();
  if (!loadSavedProject()) loadPdfPage(1);
}

function renderDeckFilter() {
  const decks = [...new Set([...deckKeys(), ...cards.map(card => card.deck)])];
  deckFilter.innerHTML = '<option value="">Все колоды</option>' + decks
    .sort((a, b) => (DECK_LABELS[a] || a).localeCompare(DECK_LABELS[b] || b, 'ru'))
    .map(deck => `<option value="${escapeAttr(deck)}">${escapeHtml(DECK_LABELS[deck] || deck)}</option>`)
    .join('');
}

function renderBackList() {
  backList.innerHTML = deckKeys().map(deck => `
    <button class="back-item" type="button" data-deck="${escapeAttr(deck)}">
      <img src="${escapeAttr(backSrc(deck))}" alt="" loading="lazy" />
      <span>${escapeHtml(DECK_LABELS[deck] || deck)}</span>
    </button>
  `).join('');
}

function renderPalette() {
  const q = searchInput.value.trim().toLowerCase();
  const deck = deckFilter.value;
  const filtered = cards.filter(card => {
    if (deck && card.deck !== deck) return false;
    if (!q) return true;
    return `${card.name} ${card.id} ${card.source}`.toLowerCase().includes(q);
  });
  const usage = cardUsageCounts();
  const descriptions = cardDescriptionCounts();

  cardList.innerHTML = filtered.map(card => renderPaletteCard(card, usage, descriptions)).join('');
}

function renderPaletteCard(card, usage, descriptions) {
  return `
    <article class="palette-card" data-card-id="${escapeAttr(card.id)}" data-registry-id="${escapeAttr(card.registryId)}" data-card-key="${escapeAttr(card.cardKey)}">
      <img src="${escapeAttr(imgSrc(card.art))}" alt="" loading="lazy" />
      <div>
        <div class="palette-name">${escapeHtml(card.name)}</div>
        <div class="palette-meta">${escapeHtml(DECK_LABELS[card.deck] || card.deck)} · ${escapeHtml(card.type)} · ${card.copies || 0} шт. <span class="palette-used">использовано: ${usage.get(card.cardKey) || 0}</span>${card.inGame ? '' : ' · не подключена'}</div>
        <div class="${escapeAttr(descriptionClass(descriptions.get(card.cardKey)))}">${escapeHtml(descriptionText(descriptions.get(card.cardKey)))}</div>
        <div class="palette-actions">
          <button type="button" data-add="front">Лицо</button>
          <button type="button" data-add="back">Рубашка</button>
          <button type="button" data-add="copies">+${Math.max(1, card.copies || 1)} шт.</button>
        </div>
      </div>
    </article>
  `;
}

function cardUsageCounts() {
  return placed.reduce((acc, item) => {
    if (!isFaceCard(item)) return acc;
    const key = cardDescriptionKey(item);
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
}

function cardDescriptionCounts() {
  const initial = cards.reduce((acc, card) => {
    if (!String(card.desc || '').trim()) return acc;
    const key = card.cardKey || canonicalCardKey(card.id);
    const entry = acc.get(key) || { total: 0, filled: 0 };
    entry.total += 1;
    entry.filled += 1;
    acc.set(key, entry);
    return acc;
  }, new Map());

  return textBoxes.reduce((acc, box) => {
    const key = textBoxDescriptionKey(box);
    if (!key) return acc;
    const entry = acc.get(key) || { total: 0, filled: 0 };
    entry.total += 1;
    if (String(box.text || '').trim()) entry.filled += 1;
    acc.set(key, entry);
    return acc;
  }, initial);
}

function textBoxDescriptionKey(box) {
  if (!box) return '';
  if (box.cardKey) return canonicalCardKey(box.cardKey);
  const card = placed.find(item => item.uid === box.cardUid);
  return cardDescriptionKey(card);
}

function descriptionText(entry) {
  if (!entry?.total) return 'описания нет';
  if (!entry.filled) return 'рамка описания';
  return entry.filled > 1 ? `описания: ${entry.filled}` : 'описание есть';
}

function descriptionClass(entry) {
  const state = entry?.filled ? 'filled' : entry?.total ? 'empty' : 'missing';
  return `palette-description is-${state}`;
}

function basePlacedItem(deck, name, face, art) {
  return {
    uid: `c${nextId++}`,
    kind: face === 'back' ? 'back' : 'card',
    cardId: face === 'back' ? `back:${deck}` : '',
    registryId: face === 'back' ? `back:${deck}` : '',
    name,
    deck,
    art,
    face,
    page: pdfPage,
    x: 40,
    y: 40,
    w: Number(cardSizeInput.value),
  };
}

function addCard(card, face = 'front', x = 40, y = 40) {
  const item = {
    ...basePlacedItem(card.deck, card.name, face, face === 'back' ? BACK_BY_DECK[card.deck] : card.art),
    cardId: card.id,
    registryId: card.registryId,
    cardKey: card.cardKey,
    x,
    y,
  };
  placed.push(item);
  selectCard(item.uid);
}

function addBack(deck, x = 40, y = 40) {
  const item = basePlacedItem(deck, DECK_LABELS[deck] || deck, 'back', BACK_BY_DECK[deck]);
  item.x = x;
  item.y = y;
  placed.push(item);
  selectCard(item.uid);
}

function visibleItems() {
  return placed.filter(item => item.page === pdfPage);
}

function itemImageSrc(item) {
  return item.face === 'back' ? backSrc(item.deck) : imgSrc(item.art);
}

function renderPlaced() {
  stage.querySelectorAll('.placed-card').forEach(node => node.remove());
  stage.querySelectorAll('.text-box').forEach(node => node.remove());
  stage.querySelectorAll('.page-deck-separator').forEach(node => node.remove());
  renderPageDeckSeparators();
  for (const item of visibleItems()) {
    const node = document.createElement('div');
    node.className = `placed-card${item.uid === selectedId ? ' selected' : ''}`;
    node.dataset.uid = item.uid;
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    node.style.setProperty('--card-w', `${item.w}px`);
    node.innerHTML = `<img src="${escapeAttr(itemImageSrc(item))}" alt="" draggable="false" /><div class="placed-label">${escapeHtml(item.name)}</div>`;
    stage.appendChild(node);
  }
  for (const box of textBoxes.filter(item => item.page === pdfPage)) {
    const node = document.createElement('div');
    node.className = `text-box${box.uid === selectedTextId ? ' selected' : ''}`;
    node.dataset.uid = box.uid;
    node.style.left = `${box.x}px`;
    node.style.top = `${box.y}px`;
    node.style.width = `${box.w}px`;
    node.style.height = `${box.h}px`;
    node.innerHTML = `<div class="text-box-head">текст${box.cardKey || box.cardUid ? ' · карта' : ''}</div><textarea spellcheck="false">${escapeHtml(box.text || '')}</textarea><div class="text-box-resize" aria-hidden="true"></div>`;
    stage.appendChild(node);
  }
  renderConnections();
  updateSelectionInfo();
  renderPaletteUsage();
}

function renderPageDeckSeparators() {
  for (const separator of deckSeparators.filter(item => item.page === pdfPage)) {
    const node = document.createElement('div');
    node.className = `page-deck-separator${separator.uid === selectedSeparatorId ? ' selected' : ''}`;
    node.dataset.uid = separator.uid;
    node.style.top = `${separator.y}px`;
    node.innerHTML = `<span>${escapeHtml(separator.label)}</span>`;
    stage.appendChild(node);
  }
}

function renderPaletteUsage() {
  const usage = cardUsageCounts();
  cardList.querySelectorAll('.palette-card').forEach(node => {
    const used = node.querySelector('.palette-used');
    if (!used) return;
    used.textContent = `использовано: ${usage.get(node.dataset.cardKey || canonicalCardKey(node.dataset.registryId)) || 0}`;
  });
  const descriptions = cardDescriptionCounts();
  cardList.querySelectorAll('.palette-card').forEach(node => {
    const description = node.querySelector('.palette-description');
    if (!description) return;
    const entry = descriptions.get(node.dataset.cardKey || canonicalCardKey(node.dataset.registryId));
    description.textContent = descriptionText(entry);
    description.className = descriptionClass(entry);
  });
}

function updateSelectionClasses() {
  stage.querySelectorAll('.placed-card').forEach(node => {
    node.classList.toggle('selected', node.dataset.uid === selectedId);
  });
  stage.querySelectorAll('.text-box').forEach(node => {
    node.classList.toggle('selected', node.dataset.uid === selectedTextId);
  });
  stage.querySelectorAll('.page-deck-separator').forEach(node => {
    node.classList.toggle('selected', node.dataset.uid === selectedSeparatorId);
  });
  updateSelectionInfo();
}

function selectCard(uid, shouldRender = true) {
  selectedId = uid;
  selectedTextId = null;
  selectedSeparatorId = null;
  recentSelection = [uid, ...recentSelection.filter(id => id !== uid)].slice(0, 2);
  if (shouldRender) renderPlaced();
  else updateSelectionClasses();
}

function selectTextBox(uid, shouldRender = true) {
  selectedTextId = uid;
  selectedId = null;
  selectedSeparatorId = null;
  if (shouldRender) renderPlaced();
  else updateSelectionClasses();
}

function selectDeckSeparator(uid, shouldRender = true) {
  selectedSeparatorId = uid;
  selectedId = null;
  selectedTextId = null;
  if (shouldRender) renderPlaced();
  else updateSelectionClasses();
}

function updateSelectionInfo() {
  const item = placed.find(card => card.uid === selectedId);
  const textBox = textBoxes.find(box => box.uid === selectedTextId);
  const separator = deckSeparators.find(item => item.uid === selectedSeparatorId);
  const relation = links.find(link => link.from === selectedId || link.to === selectedId);
  selectionInfo.textContent = textBox
    ? `Текст · стр. ${textBox.page}${textBox.cardKey || textBox.cardUid ? ' · прицеплен к карте' : ''}`
    : separator
    ? `Разделитель · ${separator.label} · стр. ${separator.page}`
    : item
    ? `${item.name} · стр. ${item.page}${relation ? ' · связана' : ''}`
    : 'Карта не выбрана';
}

function updateStageScale() {
  const scale = Number(zoomInput.value) / 100;
  stage.style.transform = `scale(${scale})`;
  stage.style.marginRight = `${stageSize.width * (scale - 1)}px`;
  stage.style.marginBottom = `${stageSize.height * (scale - 1)}px`;
}

function updateCardSize() {
  const width = Number(cardSizeInput.value);
  const selected = placed.find(card => card.uid === selectedId);
  if (selected) selected.w = width;
  renderPlaced();
}

function setStageBackground(url, width, height) {
  stageSize = { width, height };
  stage.style.width = `${stageSize.width}px`;
  stage.style.height = `${stageSize.height}px`;
  stage.style.backgroundImage = `url("${url}")`;
  stage.classList.add('has-bg');
  stage.querySelector('.empty-state')?.remove();
  updateStageScale();
  renderPlaced();
}

function setBackground(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      backgroundDataUrl = String(reader.result);
      setStageBackground(backgroundDataUrl, img.naturalWidth, img.naturalHeight);
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function loadPdfPage(page) {
  pdfPage = Math.min(PDF_PAGE_COUNT, Math.max(1, page));
  const img = new Image();
  img.onload = () => {
    backgroundDataUrl = '';
    setStageBackground(pdfPageUrl(pdfPage), img.naturalWidth, img.naturalHeight);
    pdfPageInfo.textContent = `PDF: ${pdfPage} / ${PDF_PAGE_COUNT}`;
    prevPdfPageBtn.disabled = pdfPage <= 1;
    nextPdfPageBtn.disabled = pdfPage >= PDF_PAGE_COUNT;
  };
  img.src = pdfPageUrl(pdfPage);
}

function itemCenter(item) {
  return {
    x: item.x + item.w / 2,
    y: item.y + (item.w * 512 / 336) / 2,
  };
}

function textBoxAnchor(box) {
  return {
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
  };
}

function addSvgLine(x1, y1, x2, y2, label = '', className = '') {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  if (className) line.setAttribute('class', className);
  connectionLayer.appendChild(line);
  if (!label) return;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String((x1 + x2) / 2 + 8));
  text.setAttribute('y', String((y1 + y2) / 2 - 8));
  text.textContent = label;
  connectionLayer.appendChild(text);
}

function renderConnections() {
  connectionLayer.replaceChildren();
  connectionLayer.setAttribute('width', String(stageSize.width));
  connectionLayer.setAttribute('height', String(stageSize.height));
  for (const link of links) {
    const from = placed.find(item => item.uid === link.from);
    const to = placed.find(item => item.uid === link.to);
    if (!from || !to) continue;
    if (from.page === pdfPage && to.page === pdfPage) {
      const a = itemCenter(from);
      const b = itemCenter(to);
      addSvgLine(a.x, a.y, b.x, b.y);
      continue;
    }
    if (from.page === pdfPage && to.page === pdfPage + 1) {
      const a = itemCenter(from);
      addSvgLine(a.x, a.y, stageSize.width - 12, a.y, `стр. ${to.page}`);
      continue;
    }
    if (to.page === pdfPage && from.page === pdfPage - 1) {
      const b = itemCenter(to);
      addSvgLine(12, b.y, b.x, b.y, `стр. ${from.page}`);
    }
  }
  for (const box of textBoxes.filter(item => item.page === pdfPage && (item.cardKey || item.cardUid))) {
    const a = textBoxAnchor(box);
    for (const card of cardsMatchingTextBox(box)) {
      if (card.page === pdfPage) {
        const b = itemCenter(card);
        addSvgLine(a.x, a.y, b.x, b.y, '', 'text-link');
        continue;
      }
      if (card.page === pdfPage + 1) {
        addSvgLine(a.x, a.y, stageSize.width - 12, a.y, `карта стр. ${card.page}`, 'text-link');
        continue;
      }
      if (card.page === pdfPage - 1) {
        addSvgLine(12, a.y, a.x, a.y, `карта стр. ${card.page}`, 'text-link');
      }
    }
  }
}

function connectSelected() {
  if (recentSelection.length < 2) {
    alert('Выберите рубашку и карту.');
    return;
  }
  let [aId, bId] = recentSelection;
  let a = placed.find(item => item.uid === aId);
  let b = placed.find(item => item.uid === bId);
  if (!a || !b || a.uid === b.uid) return;
  if (Math.abs(a.page - b.page) > 1) {
    alert('Связь можно провести только на той же странице или на следующую страницу.');
    return;
  }
  if (a.page > b.page) [a, b] = [b, a];
  if (a.page !== b.page && b.page !== a.page + 1) {
    alert('Линия может уходить только на следующую страницу.');
    return;
  }
  links = links.filter(link => link.from !== a.uid && link.to !== a.uid && link.from !== b.uid && link.to !== b.uid);
  links.push({ uid: `l${nextLinkId++}`, from: a.uid, to: b.uid });
  renderPlaced();
}

function unlinkSelected() {
  if (!selectedId) return;
  links = links.filter(link => link.from !== selectedId && link.to !== selectedId);
  renderPlaced();
}

function createTextBox(x, y, w, h, text = '') {
  const box = {
    uid: `t${nextTextId++}`,
    page: pdfPage,
    x,
    y,
    w: Math.max(60, w),
    h: Math.max(38, h),
    text,
    cardUid: null,
  };
  textBoxes.push(box);
  selectTextBox(box.uid);
  return box;
}

function defaultSeparatorLabel() {
  const selectedCard = placed.find(card => card.uid === selectedId && card.page === pdfPage);
  const deck = deckFilter.value || selectedCard?.deck || '';
  return deck ? (DECK_LABELS[deck] || deck) : 'Разделитель';
}

function visibleSeparatorY() {
  const scroller = document.getElementById('stageScroller');
  const scale = Number(zoomInput.value) / 100;
  const scrollTop = scroller ? scroller.scrollTop / scale : 0;
  const offset = scroller ? Math.min(140, scroller.clientHeight * 0.22 / scale) : 80;
  return Math.max(8, Math.min(stageSize.height - 24, Math.round(scrollTop + offset)));
}

function createDeckSeparator() {
  const separator = {
    uid: `s${nextSeparatorId++}`,
    page: pdfPage,
    y: visibleSeparatorY(),
    label: defaultSeparatorLabel(),
  };
  deckSeparators.push(separator);
  selectDeckSeparator(separator.uid);
}

function editDeckSeparatorLabel(separator) {
  if (!separator) return;
  const label = window.prompt('Название разделителя', separator.label || defaultSeparatorLabel());
  const trimmed = String(label || '').trim();
  if (!trimmed) return;
  separator.label = trimmed;
  renderPlaced();
}

function selectedLink() {
  if (!selectedId) return null;
  return links.find(link => link.from === selectedId || link.to === selectedId) || null;
}

function isFaceCard(item) {
  return Boolean(item && item.kind !== 'back' && item.face !== 'back');
}

function cardDescriptionKey(item) {
  if (!isFaceCard(item)) return '';
  return canonicalCardKey(item.cardKey)
    || canonicalCardKey(item.registryId)
    || canonicalCardKey(item.cardId)
    || canonicalCardKey(item.name)
    || String(item.registryId || item.cardId || item.name || '');
}

function cardsMatchingTextBox(box) {
  if (box.cardKey) {
    return placed.filter(item => isFaceCard(item) && cardDescriptionKey(item) === box.cardKey);
  }
  const legacyCard = placed.find(item => item.uid === box.cardUid);
  return isFaceCard(legacyCard) ? [legacyCard] : [];
}

function cardFromLink(link) {
  if (!link) return null;
  return [link.from, link.to]
    .map(uid => placed.find(item => item.uid === uid))
    .find(isFaceCard) || null;
}

function selectedOrRecentFaceCard() {
  const selected = placed.find(item => item.uid === selectedId);
  if (isFaceCard(selected)) return selected;
  for (const uid of recentSelection) {
    const item = placed.find(card => card.uid === uid);
    if (isFaceCard(item)) return item;
    const linkedCard = cardFromLink(links.find(link => link.from === uid || link.to === uid));
    if (linkedCard) return linkedCard;
  }
  return null;
}

function attachSelectedText() {
  const box = textBoxes.find(item => item.uid === selectedTextId);
  const card = selectedOrRecentFaceCard();
  if (!box || !card) {
    alert('Выберите текстовую рамку и лицевую карту. Описание к рубашке не цепляется.');
    return;
  }
  box.cardKey = cardDescriptionKey(card);
  box.cardUid = null;
  textBoxes = textBoxes.filter(item => item.uid === box.uid || item.cardKey !== box.cardKey);
  renderPlaced();
}

async function recognizeSelectedText() {
  const box = textBoxes.find(item => item.uid === selectedTextId);
  if (!box) {
    alert('Сначала выделите текстовую рамку.');
    return;
  }
  const originalLabel = recognizeTextBtn.textContent;
  recognizeTextBtn.disabled = true;
  setOcrStatus('OCR...');
  try {
    const canvas = await cropTextBoxToCanvas(box);
    let text = '';
    try {
      setOcrStatus('Загрузка OCR...');
      const Tesseract = await loadOcrEngine();
      const result = await Tesseract.recognize(canvas, 'rus+eng', {
        logger: message => {
          if (message.status === 'recognizing text') setOcrStatus(`OCR ${Math.round(message.progress * 100)}%`);
        },
      });
      text = result?.data?.text || '';
    } catch (tesseractError) {
      console.warn(tesseractError);
      if ('TextDetector' in window) {
        const detector = new window.TextDetector();
        const detected = await detector.detect(canvas);
        text = detected.map(item => item.rawValue).filter(Boolean).join('\n');
      } else {
        throw tesseractError;
      }
    }
    box.text = cleanOcrText(text);
    if (!box.text) alert('Текст не распознался. Попробуйте выделить рамку плотнее вокруг описания.');
    renderPlaced();
  } catch (error) {
    console.error(error);
    alert('OCR не запустился. Проверьте интернет для загрузки распознавания или попробуйте еще раз.');
  } finally {
    recognizeTextBtn.disabled = false;
    recognizeTextBtn.textContent = originalLabel;
    updateSelectionInfo();
  }
}

function setOcrStatus(label) {
  recognizeTextBtn.textContent = label;
  selectionInfo.textContent = label;
}

function loadOcrEngine() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!ocrEnginePromise) {
    ocrEnginePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TESSERACT_SCRIPT_URL;
      script.async = true;
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract did not load'));
      script.onerror = () => reject(new Error('Failed to load Tesseract'));
      document.head.appendChild(script);
    });
  }
  return ocrEnginePromise;
}

async function cropTextBoxToCanvas(box) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = backgroundDataUrl || pdfPageUrl(box.page);
  if (image.decode) await image.decode();
  else await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });

  const scale = 3;
  const sourceX = Math.max(0, Math.round(box.x));
  const sourceY = Math.max(0, Math.round(box.y));
  const sourceW = Math.max(1, Math.min(Math.round(box.w), image.naturalWidth - sourceX));
  const sourceH = Math.max(1, Math.min(Math.round(box.h), image.naturalHeight - sourceY));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, sourceW * scale);
  canvas.height = Math.max(1, sourceH * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height);
  improveOcrContrast(ctx, canvas.width, canvas.height);
  return canvas;
}

function improveOcrContrast(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    const boosted = gray < 170 ? Math.max(0, gray - 34) : Math.min(255, gray + 42);
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);
}

function cleanOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function copySelectedTextBox(offset = 24) {
  const box = textBoxes.find(item => item.uid === selectedTextId);
  if (!box) return null;
  const copy = {
    ...box,
    uid: `t${nextTextId++}`,
    x: box.x + offset,
    y: box.y + offset,
    cardUid: null,
    cardKey: '',
  };
  textBoxes.push(copy);
  selectTextBox(copy.uid);
  return copy;
}

function copySelectedKit() {
  const selectedText = textBoxes.find(box => box.uid === selectedTextId);
  const link = selectedLink() || links.find(item => {
    if (!selectedText) return false;
    return [item.from, item.to]
      .map(uid => placed.find(card => card.uid === uid))
      .some(card => cardsMatchingTextBox(selectedText).some(match => match.uid === card?.uid));
  });
  if (!link) {
    if (selectedTextId) copySelectedTextBox();
    else alert('Выберите карту или рубашку из связанного комплекта.');
    return;
  }
  const a = placed.find(item => item.uid === link.from);
  const b = placed.find(item => item.uid === link.to);
  if (!a || !b) return;
  const map = new Map();
  for (const item of [a, b]) {
    const copy = {
      ...item,
      uid: `c${nextId++}`,
      x: item.x + 28,
      y: item.y + 28,
    };
    placed.push(copy);
    map.set(item.uid, copy.uid);
  }
  const newLink = {
    uid: `l${nextLinkId++}`,
    from: map.get(link.from),
    to: map.get(link.to),
  };
  links.push(newLink);
  const newFaceCardUid = map.get([a, b].find(isFaceCard)?.uid);
  selectedId = newFaceCardUid || newLink.to;
  selectedTextId = null;
  recentSelection = [newLink.to, newLink.from].filter(Boolean);
  renderPlaced();
}

function projectData() {
  return {
    version: 2,
    stageSize,
    backgroundDataUrl,
    pdfPage,
    placed,
    links,
    textBoxes,
    deckSeparators,
  };
}

function applyProjectData(data) {
  stageSize = data.stageSize || stageSize;
  backgroundDataUrl = data.backgroundDataUrl || '';
  pdfPage = Number(data.pdfPage || pdfPage);
  placed = Array.isArray(data.placed) ? data.placed.map(item => ({ page: 1, ...item })) : [];
  links = Array.isArray(data.links) ? data.links.map((link, index) => ({ uid: `l${index + 1}`, ...link })) : [];
  deckSeparators = Array.isArray(data.deckSeparators)
    ? data.deckSeparators.map((item, index) => ({ uid: `s${index + 1}`, page: 1, y: 80, label: '', ...item }))
    : [];
  textBoxes = Array.isArray(data.textBoxes)
    ? data.textBoxes.map(item => {
      const box = { page: 1, text: '', cardUid: null, cardKey: '', ...item };
      if (!box.cardUid && box.linkId) box.cardUid = cardFromLink(links.find(link => link.uid === box.linkId))?.uid || null;
      if (!box.cardKey && box.cardUid) {
        const card = placed.find(placedItem => placedItem.uid === box.cardUid);
        box.cardKey = cardDescriptionKey(card);
      }
      if (box.cardKey) box.cardKey = canonicalCardKey(box.cardKey);
      if (box.cardKey) box.cardUid = null;
      delete box.linkId;
      return box;
    })
    : [];
  textBoxes = textBoxes.filter((box, index, list) => !box.cardKey || list.findIndex(item => textBoxDescriptionKey(item) === textBoxDescriptionKey(box)) === index);
  nextId = placed.reduce((max, item) => Math.max(max, Number(String(item.uid).replace(/\D/g, '')) || 0), 0) + 1;
  nextLinkId = links.reduce((max, item) => Math.max(max, Number(String(item.uid).replace(/\D/g, '')) || 0), 0) + 1;
  nextTextId = textBoxes.reduce((max, item) => Math.max(max, Number(String(item.uid).replace(/\D/g, '')) || 0), 0) + 1;
  nextSeparatorId = deckSeparators.reduce((max, item) => Math.max(max, Number(String(item.uid).replace(/\D/g, '')) || 0), 0) + 1;
  selectedId = placed[0]?.uid || null;
  selectedTextId = null;
  selectedSeparatorId = null;
  recentSelection = selectedId ? [selectedId] : [];
  if (backgroundDataUrl) {
    setStageBackground(backgroundDataUrl, stageSize.width, stageSize.height);
  } else {
    loadPdfPage(pdfPage);
  }
}

async function saveProject() {
  const data = projectData();
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(data));
  const savedToFile = await saveProjectToFile(data);
  selectionInfo.textContent = savedToFile
    ? `Проект сохранен в файл · ${new Date().toLocaleTimeString()}`
    : `Проект сохранен в браузере · ${new Date().toLocaleTimeString()}`;
}

function loadSavedProject() {
  const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!raw) return false;
  try {
    applyProjectData(JSON.parse(raw));
    return true;
  } catch {
    localStorage.removeItem(PROJECT_STORAGE_KEY);
    return false;
  }
}

function exportLayout() {
  const data = projectData();
  downloadProjectJson(data, `rram-card-layout-${new Date().toISOString().slice(0, 10)}.json`);
}

async function saveProjectToFile(data) {
  if ('showSaveFilePicker' in window) {
    try {
      if (!projectFileHandle) {
        projectFileHandle = await window.showSaveFilePicker({
          suggestedName: PROJECT_FILE_NAME,
          types: [{
            description: 'RRaM deck overlay project',
            accept: { 'application/json': ['.json'] },
          }],
        });
      }
      const writable = await projectFileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      console.warn(error);
    }
  }
  downloadProjectJson(data, PROJECT_FILE_NAME);
  return true;
}

function downloadProjectJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importLayout(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    applyProjectData(JSON.parse(String(reader.result)));
  };
  reader.readAsText(file);
}

function clearLayout() {
  placed = [];
  links = [];
  textBoxes = [];
  deckSeparators = [];
  recentSelection = [];
  selectedId = null;
  selectedTextId = null;
  selectedSeparatorId = null;
  localStorage.removeItem(PROJECT_STORAGE_KEY);
  renderPlaced();
}

backList.addEventListener('click', (event) => {
  const button = event.target.closest('.back-item');
  if (!button) return;
  addBack(button.dataset.deck);
});

backList.addEventListener('pointerdown', (event) => {
  const item = event.target.closest('.back-item');
  if (!item || event.button !== 0) return;
  startPaletteDrag(event, {
    kind: 'back',
    deck: item.dataset.deck,
    image: backSrc(item.dataset.deck),
  });
});

backList.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.back-item');
  if (!item) return;
  event.dataTransfer.setData('application/x-rram-card', JSON.stringify({
    kind: 'back',
    deck: item.dataset.deck,
  }));
  event.dataTransfer.effectAllowed = 'copy';
});

cardList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-add]');
  if (!button) return;
  const row = button.closest('.palette-card');
  const card = cards.find(item => item.id === row.dataset.cardId && item.registryId === row.dataset.registryId);
  if (!card) return;
  const mode = button.dataset.add;
  if (mode === 'copies') {
    const count = Math.max(1, card.copies || 1);
    for (let i = 0; i < count; i += 1) addCard(card, 'front', 36 + i * 18, 36 + i * 12);
    return;
  }
  addCard(card, mode);
});

cardList.addEventListener('pointerdown', (event) => {
  const item = event.target.closest('.palette-card');
  if (!item || event.button !== 0) return;
  const card = cards.find(candidate => candidate.id === item.dataset.cardId && candidate.registryId === item.dataset.registryId);
  if (!card) return;
  startPaletteDrag(event, {
    kind: 'card',
    cardId: card.id,
    registryId: card.registryId,
    image: imgSrc(card.art),
  });
});

cardList.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.palette-card');
  if (!item) return;
  event.dataTransfer.setData('application/x-rram-card', JSON.stringify({
    kind: 'card',
    cardId: item.dataset.cardId,
    registryId: item.dataset.registryId,
  }));
  event.dataTransfer.effectAllowed = 'copy';
});

stage.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('application/x-rram-card')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

stage.addEventListener('drop', (event) => {
  const raw = event.dataTransfer.getData('application/x-rram-card');
  if (!raw) return;
  event.preventDefault();
  const data = JSON.parse(raw);
  const point = stagePointFromEvent(event);
  if (data.kind === 'back') {
    addBack(data.deck, point.x, point.y);
    return;
  }
  const card = cards.find(item => item.id === data.cardId && item.registryId === data.registryId);
  if (card) addCard(card, 'front', point.x, point.y);
});

function startPaletteDrag(event, data) {
  event.preventDefault();
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `<img src="${escapeAttr(data.image)}" alt="" />`;
  document.body.appendChild(ghost);
  const moveGhost = (clientX, clientY) => {
    ghost.style.left = `${clientX}px`;
    ghost.style.top = `${clientY}px`;
  };
  moveGhost(event.clientX, event.clientY);

  const move = (moveEvent) => moveGhost(moveEvent.clientX, moveEvent.clientY);
  const up = (upEvent) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    ghost.remove();
    const rect = stage.getBoundingClientRect();
    const inside = upEvent.clientX >= rect.left && upEvent.clientX <= rect.right
      && upEvent.clientY >= rect.top && upEvent.clientY <= rect.bottom;
    if (!inside) return;
    const point = stagePointFromEvent(upEvent);
    if (data.kind === 'back') {
      addBack(data.deck, point.x, point.y);
      return;
    }
    const card = cards.find(item => item.id === data.cardId && item.registryId === data.registryId);
    if (card) addCard(card, 'front', point.x, point.y);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

stage.addEventListener('pointerdown', (event) => {
  const separatorNode = event.target.closest('.page-deck-separator');
  if (separatorNode) {
    event.preventDefault();
    selectDeckSeparator(separatorNode.dataset.uid, false);
    const separator = deckSeparators.find(item => item.uid === selectedSeparatorId);
    if (!separator) return;
    const scale = Number(zoomInput.value) / 100;
    const start = {
      pointerId: event.pointerId,
      y: event.clientY,
      separatorY: separator.y,
    };
    separatorNode.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      separator.y = Math.max(8, Math.round(start.separatorY + (moveEvent.clientY - start.y) / scale));
      separatorNode.style.top = `${separator.y}px`;
    };
    const up = (upEvent) => {
      if (upEvent.pointerId !== start.pointerId) return;
      separatorNode.releasePointerCapture(upEvent.pointerId);
      separatorNode.removeEventListener('pointermove', move);
      separatorNode.removeEventListener('pointerup', up);
      separatorNode.removeEventListener('pointercancel', up);
    };
    separatorNode.addEventListener('pointermove', move);
    separatorNode.addEventListener('pointerup', up);
    separatorNode.addEventListener('pointercancel', up);
    return;
  }

  const textNode = event.target.closest('.text-box');
  if (textNode) {
    selectTextBox(textNode.dataset.uid, false);
    const box = textBoxes.find(item => item.uid === selectedTextId);
    const resizeHandle = event.target.closest('.text-box-resize');
    if (box && resizeHandle) {
      event.preventDefault();
      const scale = Number(zoomInput.value) / 100;
      const start = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        boxW: box.w,
        boxH: box.h,
      };
      resizeHandle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        if (moveEvent.pointerId !== start.pointerId) return;
        box.w = Math.max(60, Math.round(start.boxW + (moveEvent.clientX - start.x) / scale));
        box.h = Math.max(38, Math.round(start.boxH + (moveEvent.clientY - start.y) / scale));
        textNode.style.width = `${box.w}px`;
        textNode.style.height = `${box.h}px`;
        renderConnections();
      };
      const up = (upEvent) => {
        if (upEvent.pointerId !== start.pointerId) return;
        resizeHandle.releasePointerCapture(upEvent.pointerId);
        resizeHandle.removeEventListener('pointermove', move);
        resizeHandle.removeEventListener('pointerup', up);
        resizeHandle.removeEventListener('pointercancel', up);
      };
      resizeHandle.addEventListener('pointermove', move);
      resizeHandle.addEventListener('pointerup', up);
      resizeHandle.addEventListener('pointercancel', up);
      return;
    }
    if (!box || !event.target.closest('.text-box-head')) return;
    const scale = Number(zoomInput.value) / 100;
    const start = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      boxX: box.x,
      boxY: box.y,
    };
    textNode.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      box.x = Math.round(start.boxX + (moveEvent.clientX - start.x) / scale);
      box.y = Math.round(start.boxY + (moveEvent.clientY - start.y) / scale);
      textNode.style.left = `${box.x}px`;
      textNode.style.top = `${box.y}px`;
      renderConnections();
    };
    const up = (upEvent) => {
      if (upEvent.pointerId !== start.pointerId) return;
      textNode.releasePointerCapture(upEvent.pointerId);
      textNode.removeEventListener('pointermove', move);
      textNode.removeEventListener('pointerup', up);
      textNode.removeEventListener('pointercancel', up);
    };
    textNode.addEventListener('pointermove', move);
    textNode.addEventListener('pointerup', up);
    textNode.addEventListener('pointercancel', up);
    return;
  }
  if (textBoxMode && !event.target.closest('.placed-card')) {
    event.preventDefault();
    const start = stagePointFromEvent(event, false);
    const draft = document.createElement('div');
    draft.className = 'text-draft';
    draft.style.left = `${start.x}px`;
    draft.style.top = `${start.y}px`;
    stage.appendChild(draft);
    const scale = Number(zoomInput.value) / 100;
    const move = (moveEvent) => {
      const current = {
        x: Math.round((moveEvent.clientX - stage.getBoundingClientRect().left) / scale),
        y: Math.round((moveEvent.clientY - stage.getBoundingClientRect().top) / scale),
      };
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);
      draft.style.left = `${x}px`;
      draft.style.top = `${y}px`;
      draft.style.width = `${w}px`;
      draft.style.height = `${h}px`;
    };
    const up = (upEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const current = {
        x: Math.round((upEvent.clientX - stage.getBoundingClientRect().left) / scale),
        y: Math.round((upEvent.clientY - stage.getBoundingClientRect().top) / scale),
      };
      draft.remove();
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);
      if (w > 12 && h > 12) createTextBox(x, y, w, h);
      textBoxMode = false;
      textBoxBtn.classList.remove('active');
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    return;
  }
  const node = event.target.closest('.placed-card');
  if (!node) return;
  selectCard(node.dataset.uid, false);
  const item = placed.find(card => card.uid === selectedId);
  if (!item) return;
  const scale = Number(zoomInput.value) / 100;
  const start = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    cardX: item.x,
    cardY: item.y,
  };
  node.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== start.pointerId) return;
    item.x = Math.round(start.cardX + (moveEvent.clientX - start.x) / scale);
    item.y = Math.round(start.cardY + (moveEvent.clientY - start.y) / scale);
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    renderConnections();
  };
  const up = (upEvent) => {
    if (upEvent.pointerId !== start.pointerId) return;
    node.releasePointerCapture(upEvent.pointerId);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
});

function stagePointFromEvent(event, centerCard = true) {
  const rect = stage.getBoundingClientRect();
  const scale = Number(zoomInput.value) / 100;
  const width = Number(cardSizeInput.value);
  const x = (event.clientX - rect.left) / scale;
  const y = (event.clientY - rect.top) / scale;
  if (!centerCard) {
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
    };
  }
  return {
    x: Math.max(0, Math.round(x - width / 2)),
    y: Math.max(0, Math.round(y - (width * 512 / 336) / 2)),
  };
}

stage.addEventListener('dblclick', (event) => {
  const separatorNode = event.target.closest('.page-deck-separator');
  if (separatorNode) {
    const separator = deckSeparators.find(item => item.uid === separatorNode.dataset.uid);
    editDeckSeparatorLabel(separator);
    return;
  }
  const node = event.target.closest('.placed-card');
  if (!node) return;
  const item = placed.find(card => card.uid === node.dataset.uid);
  if (!item) return;
  item.face = item.face === 'front' ? 'back' : 'front';
  item.kind = item.face === 'back' ? 'back' : 'card';
  renderPlaced();
});

function deleteSelected() {
  if (selectedSeparatorId) {
    deckSeparators = deckSeparators.filter(item => item.uid !== selectedSeparatorId);
    selectedSeparatorId = null;
    renderPlaced();
    return;
  }
  if (selectedTextId) {
    textBoxes = textBoxes.filter(box => box.uid !== selectedTextId);
    selectedTextId = textBoxes.at(-1)?.uid || null;
    renderPlaced();
    return;
  }
  if (!selectedId) {
    selectionInfo.textContent = 'Нечего удалять';
    return;
  }
  const item = placed.find(card => card.uid === selectedId);
  if (!item) {
    selectedId = null;
    updateSelectionInfo();
    return;
  }
  placed = placed.filter(card => card.uid !== selectedId);
  links = links.filter(link => link.from !== selectedId && link.to !== selectedId);
  textBoxes = textBoxes.filter(box => box.cardUid !== selectedId);
  recentSelection = recentSelection.filter(id => id !== selectedId);
  selectedId = placed.at(-1)?.uid || null;
  renderPlaced();
}

document.addEventListener('keydown', (event) => {
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSeparatorId) {
    deleteSelected();
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTextId) {
    if (document.activeElement?.tagName === 'TEXTAREA') return;
    deleteSelected();
    return;
  }
  const item = placed.find(card => card.uid === selectedId);
  if (!item) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelected();
  } else if (event.key.toLowerCase() === 'f') {
    item.face = item.face === 'front' ? 'back' : 'front';
    item.kind = item.face === 'back' ? 'back' : 'card';
    renderPlaced();
  } else if (event.key === '[') {
    item.w = Math.max(35, item.w - 5);
    renderPlaced();
  } else if (event.key === ']') {
    item.w += 5;
    renderPlaced();
  }
});

searchInput.addEventListener('input', renderPalette);
deckFilter.addEventListener('change', renderPalette);
backgroundInput.addEventListener('change', () => setBackground(backgroundInput.files?.[0]));
layoutInput.addEventListener('change', () => importLayout(layoutInput.files?.[0]));
saveProjectBtn.addEventListener('click', saveProject);
exportBtn.addEventListener('click', exportLayout);
clearBtn.addEventListener('click', clearLayout);
connectBtn.addEventListener('click', connectSelected);
unlinkBtn.addEventListener('click', unlinkSelected);
deckSeparatorBtn.addEventListener('click', createDeckSeparator);
deleteSelectedBtn.addEventListener('click', deleteSelected);
textBoxBtn.addEventListener('click', () => {
  textBoxMode = !textBoxMode;
  textBoxBtn.classList.toggle('active', textBoxMode);
  if (textBoxMode) selectionInfo.textContent = 'Обведите текст рамкой на странице';
  else updateSelectionInfo();
});
recognizeTextBtn.addEventListener('click', recognizeSelectedText);
attachTextBtn.addEventListener('click', attachSelectedText);
copyKitBtn.addEventListener('click', copySelectedKit);
prevPdfPageBtn.addEventListener('click', () => loadPdfPage(pdfPage - 1));
nextPdfPageBtn.addEventListener('click', () => loadPdfPage(pdfPage + 1));
zoomInput.addEventListener('input', updateStageScale);
cardSizeInput.addEventListener('input', updateCardSize);

stage.addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  const node = event.target.closest('.text-box');
  const box = textBoxes.find(item => item.uid === node?.dataset.uid);
  if (box) {
    box.text = event.target.value;
    renderPaletteUsage();
  }
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

init();
