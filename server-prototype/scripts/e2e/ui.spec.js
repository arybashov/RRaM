import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  closeServer,
  createAndJoinRoom,
  endTurn,
  expectNoViewportOverflow,
  freePort,
  grantCard,
  newGamePage,
  openGamePage,
  rollTurn,
  selectRole,
  startStaticServer,
  waitForHttp,
} from './helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const serverRoot = resolve(here, '../..');
const repoRoot = resolve(serverRoot, '..');
const webRoot = resolve(repoRoot, 'prototype-web');
const tmpRoot = resolve(repoRoot, 'tmp', 'e2e');

let gameServer;
let staticServer;
let gamePort;
let webPort;

test.beforeAll(async () => {
  await mkdir(tmpRoot, { recursive: true });
  gamePort = await freePort();
  webPort = await freePort();

  gameServer = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(gamePort),
      DEBUG_COMMANDS: '1',
      RRAM_DB_PATH: join(tmpRoot, `rram-${Date.now()}-${process.pid}.sqlite`),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gameServer.stdout?.on('data', () => {});
  gameServer.stderr?.on('data', () => {});
  await waitForHttp(`http://127.0.0.1:${gamePort}/health`);

  staticServer = await startStaticServer(webRoot, webPort);
});

test.afterAll(async () => {
  await closeServer(staticServer);
  if (gameServer && !gameServer.killed) gameServer.kill();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

test('lobby creates and joins a two-player room through the UI', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);

  await expect(p1.getByTestId('board')).toBeVisible();
  await expect(p2.getByTestId('board')).toBeVisible();
  await expect(p1.getByTestId('turn-action')).toBeEnabled();
  await expect(p2.getByTestId('turn-action')).toBeDisabled();

  await p1.context().close();
  await p2.context().close();
});

test('spectator can watch an active public room from the lobby', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);

  const spectator = await newGamePage(browser, { webPort, gamePort, playerName: 'Carol' });
  await expect(spectator.getByTestId('join-room')).toHaveCount(0);
  await expect(spectator.getByTestId('watch-room')).toHaveCount(1);
  await spectator.getByTestId('watch-room').click();

  await expect(spectator.locator('#lobby.hidden')).toHaveCount(1);
  await expect(spectator.getByTestId('board')).toBeVisible();
  await expect(spectator.getByTestId('turn-action')).toBeDisabled();
  await expect(spectator.getByTestId(/^character-/)).toHaveCount(0);
  await expect(spectator.locator('#guidePanel')).toBeHidden();
  await expect(spectator.locator('#fogLayer')).toHaveCount(0);
  await expect(spectator.locator('.fog-hidden')).toHaveCount(0);
  await expect(spectator.locator('#sheet.spectator-sheet.open')).toHaveCount(1);
  await expect(spectator.locator('#inventory')).toBeHidden();
  await expect(spectator.locator('#gameChatInput')).toBeHidden();
  await expect(spectator.locator('#localJournal')).toBeVisible();
  await expect(spectator.locator('#localJournal h2')).toHaveText('События');

  await expect.poll(() => spectator.evaluate(() => ({
    spectatorMode,
    spectator: serverRoom?.spectator,
    you: serverRoom?.you,
    characters: getGame()?.characters?.length ?? 0,
    ownCharacters: getMyChars().length,
    inventories: getGame()?.characters?.filter((char) => Array.isArray(char.inventory)).length ?? 0,
    legalMoveTargets: Object.keys(getGame()?.legalTargets?.moveSum ?? {}).length,
    legalAttackTargets: Object.keys(getGame()?.legalTargets?.attacks ?? {}).length,
  }))).toEqual({
    spectatorMode: true,
    spectator: true,
    you: null,
    characters: 10,
    ownCharacters: 0,
    inventories: 0,
    legalMoveTargets: 0,
    legalAttackTargets: 0,
  });

  await p1.context().close();
  await p2.context().close();
  await spectator.context().close();
});

test('active player rolls and ends turn from the UI while opponent dice stay hidden', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);
  await rollTurn(p1);

  const p1Dice = await p1.getByTestId('board-dice').locator('.die').allTextContents();
  expect(p1Dice.every((text) => /^[1-6]$/.test(text.trim()))).toBe(true);

  const p2Dice = await p2.getByTestId('board-dice').locator('.die').allTextContents();
  expect(p2Dice.some((text) => /^[1-6]$/.test(text.trim()))).toBe(false);
  await expect.poll(() => p2.evaluate(() => getGame()?.turn?.dice)).toBe(null);
  await expect.poll(() => p2.evaluate(() => Object.keys(getGame()?.turn?.diceByCharacter ?? {}).length)).toBe(0);

  await endTurn(p1);
  await expect.poll(() => p2.evaluate(() => getGame()?.turn?.activePlayerId === getMyChars()?.[0]?.owner))
    .toBe(true);
  await expect(p1.getByTestId('turn-action')).toBeDisabled();
  await expect(p2.getByTestId('turn-action')).toBeEnabled();

  await p1.context().close();
  await p2.context().close();
});

test('draw button is disabled when selected character is not on a draw cell', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);
  await rollTurn(p1);
  await selectRole(p1, 'K');

  await expect(p1.getByTestId('mode-draw')).toBeDisabled();
  await expect.poll(() => p1.evaluate(() => {
    const selected = getSelChar();
    return {
      role: selected?.role,
      onDrawCell: isResourceCell(characterPosition(selected)),
      canDraw: canDrawNowWithCharacter(selected),
    };
  })).toEqual({ role: 'K', onDrawCell: false, canDraw: false });

  await p1.context().close();
  await p2.context().close();
});

test('cardbox transfers a card between own characters through the UI', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);
  await grantCard(p1, 'K', 'bark');
  await rollTurn(p1);
  await selectRole(p1, 'K');

  await p1.getByTestId('mode-transfer').click();
  await expect(p1.getByTestId('cardbox')).toBeVisible();
  const bark = await p1.evaluate(() => {
    const smith = getMyChars().find((char) => char.role === 'K');
    return {
      index: smith.inventory.findIndex((card) => (card.id ?? card) === 'bark'),
    };
  });
  await p1.locator(`[data-testid="cardbox-row-K"] [data-i="${bark.index}"] .cbx-transfer-btn`).click();
  await p1.getByTestId('cardbox-target-P').click();

  await expect.poll(() => p1.evaluate(() => {
    const smith = getMyChars().find((char) => char.role === 'K');
    const helper = getMyChars().find((char) => char.role === 'P');
    return {
      smithHasBark: smith?.inventory?.some((card) => (card.id ?? card) === 'bark') ?? false,
      helperHasBark: helper?.inventory?.some((card) => (card.id ?? card) === 'bark') ?? false,
    };
  })).toEqual({ smithHasBark: false, helperHasBark: true });

  await p1.context().close();
  await p2.context().close();
});

test('mobile cardbox tap with slight movement opens enlarged card preview', async ({ browser }) => {
  const p1 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Alice',
    viewport: { width: 720, height: 1280 },
  });
  const p2 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Bob',
    viewport: { width: 720, height: 1280 },
  });

  await createAndJoinRoom(p1, p2);
  await grantCard(p1, 'K', 'bark');
  await rollTurn(p1);
  await selectRole(p1, 'K');

  await p1.getByTestId('mode-transfer').click();
  await expect(p1.getByTestId('cardbox')).toBeVisible();
  const bark = await p1.evaluate(() => {
    const smith = getMyChars().find((char) => char.role === 'K');
    return {
      index: smith.inventory.findIndex((card) => (card.id ?? card) === 'bark'),
    };
  });
  const card = p1.locator(`[data-testid="cardbox-row-K"] [data-i="${bark.index}"]`);
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p1.mouse.move(x, y);
  await p1.mouse.down();
  await p1.mouse.move(x + 10, y + 8);
  await p1.mouse.up();

  await expect(p1.locator('#eventOverlay')).toBeVisible();
  await expect(p1.locator('#eventCardDisplay .card.card-face')).toBeVisible();
  await expect(p1.locator('#eventOkBtn')).toHaveText('Закрыть');

  await p1.context().close();
  await p2.context().close();
});

test('server catalog card preview does not show disconnected placeholder text', async ({ browser }) => {
  const p1 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Alice',
    viewport: { width: 720, height: 1280 },
  });
  const p2 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Bob',
    viewport: { width: 720, height: 1280 },
  });

  await createAndJoinRoom(p1, p2);
  await grantCard(p1, 'K', 'art_dark_forest_013');
  await grantCard(p1, 'K', 'art_mixed_003');
  await rollTurn(p1);
  await selectRole(p1, 'K');

  await p1.getByTestId('mode-transfer').click();
  await expect(p1.getByTestId('cardbox')).toBeVisible();
  const topormolBlueprint = await p1.evaluate(() => {
    const smith = getMyChars().find((char) => char.role === 'K');
    return {
      index: smith.inventory.findIndex((card) => (card.id ?? card) === 'art_dark_forest_013'),
    };
  });
  const card = p1.locator(`[data-testid="cardbox-row-K"] [data-i="${topormolBlueprint.index}"]`);
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p1.mouse.move(x, y);
  await p1.mouse.down();
  await p1.mouse.move(x + 8, y + 6);
  await p1.mouse.up();

  await expect(p1.locator('#eventOverlay')).toBeVisible();
  await expect(p1.locator('#eventCardDisplay')).not.toContainText('не подключена');
  await expect(p1.locator('#eventCardDisplay .inventory-card-art')).toHaveAttribute('src', /blueprint-topormol-v1\.png/);
  await p1.locator('#eventOkBtn').click();

  const drySkull = await p1.evaluate(() => {
    const smith = getMyChars().find((char) => char.role === 'K');
    return {
      index: smith.inventory.findIndex((card) => (card.id ?? card) === 'art_mixed_003'),
    };
  });
  const drySkullCard = p1.locator(`[data-testid="cardbox-row-K"] [data-i="${drySkull.index}"]`);
  const drySkullBox = await drySkullCard.boundingBox();
  expect(drySkullBox).not.toBeNull();
  await p1.mouse.move(drySkullBox.x + drySkullBox.width / 2, drySkullBox.y + drySkullBox.height / 2);
  await p1.mouse.down();
  await p1.mouse.move(drySkullBox.x + drySkullBox.width / 2 + 8, drySkullBox.y + drySkullBox.height / 2 + 6);
  await p1.mouse.up();

  await expect(p1.locator('#eventOverlay')).toBeVisible();
  await expect(p1.locator('#eventCardDisplay')).not.toContainText('не подключена');
  await expect(p1.locator('#eventCardDisplay')).toContainText('Ингредиент');
  await expect(p1.locator('#eventCardDisplay')).toContainText('Заклятия «Хозяин»');
  await p1.locator('#eventOkBtn').click();

  await p1.evaluate(() => {
    const smith = getMyChars().find((char) => char.role === 'K');
    const cardIndex = smith.inventory.findIndex((item) => (item.id ?? item) === 'art_dark_forest_013');
    wsSend('action:terrainPlace', {
      id: 'e2e-topormol-blueprint',
      characterId: smith.id,
      cardIndex,
      x: 140,
      y: 190,
      faceDown: false,
    });
  });
  const terrainImage = p1.locator('.terrain-card[data-uid="e2e-topormol-blueprint"] image');
  await expect(terrainImage).toHaveAttribute('href', /blueprint-topormol-v1\.png/);
  const terrainHref = await terrainImage.getAttribute('href');
  const terrainResponse = await p1.request.get(new URL(terrainHref, p1.url()).toString());
  expect(terrainResponse.ok()).toBe(true);

  await p1.context().close();
  await p2.context().close();
});

test('second player can use terrain card controls from the UI', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);
  await rollTurn(p1);
  await endTurn(p1);
  await expect.poll(() => p2.evaluate(() => getGame()?.turn?.activePlayerId === getMyChars()?.[0]?.owner))
    .toBe(true);

  await grantCard(p2, 'V', 'bark');
  await p2.evaluate(() => {
    document.querySelector('#sheet')?.classList.add('open');
    const warrior = getMyChars().find((char) => char.role === 'V');
    selectCharacter(warrior.id);
    const cardIndex = warrior.inventory.findIndex((card) => (card.id ?? card) === 'bark');
    wsSend('action:terrainPlace', {
      id: 'e2e-bark',
      characterId: warrior.id,
      cardIndex,
      x: 120,
      y: 180,
      faceDown: false,
    });
  });

  await expect(p2.locator('.placed-terrain-cards')).toBeVisible();
  await expect(p2.getByTestId('character-V').locator('.character-nav-hp')).toHaveText('105 HP');
  await expect(p2.locator('.token.own.role-V .token-hp.combat-hp')).toHaveText('105');
  await expect(p2.getByTestId('terrain-return')).toBeVisible();

  await p2.getByTestId('terrain-flip').click();
  await expect(p2.getByTestId('character-V').locator('.character-nav-hp')).toHaveText('100 HP');
  await expect(p2.locator('.token.own.role-V .token-hp.combat-hp')).toHaveCount(0);

  await p2.getByTestId('terrain-flip').click();
  await expect(p2.getByTestId('character-V').locator('.character-nav-hp')).toHaveText('105 HP');
  await expect(p2.locator('.token.own.role-V .token-hp.combat-hp')).toHaveText('105');

  await p2.getByTestId('terrain-return').click();

  await expect(p2.locator('.placed-terrain-cards')).toHaveCount(0);
  await expect(p2.getByTestId('character-V').locator('.character-nav-hp')).toHaveText('100 HP');
  await expect(p2.locator('.token.own.role-V .token-hp.combat-hp')).toHaveCount(0);
  await expect.poll(() => p2.evaluate(() => getSelChar()?.inventory?.some((card) => (card.id ?? card) === 'bark')))
    .toBe(true);

  await p1.context().close();
  await p2.context().close();
});

test('session resume restores the room after page reload', async ({ browser }) => {
  const p1 = await newGamePage(browser, { webPort, gamePort, playerName: 'Alice' });
  const p2 = await newGamePage(browser, { webPort, gamePort, playerName: 'Bob' });

  await createAndJoinRoom(p1, p2);
  const before = await p1.evaluate(() => ({ roomId: serverRoom.id, playerId: myPlayerId }));

  await openGamePage(p1, { webPort, gamePort });
  await expect(p1.getByTestId('connection-badge')).toHaveClass(/conn-connected/);
  await expect.poll(() => p1.evaluate(() => getGame()?.characters?.length ?? 0)).toBe(10);
  await expect(p1.locator('#lobby.hidden')).toHaveCount(1);
  await expect.poll(() => p1.evaluate(() => ({ roomId: serverRoom.id, playerId: myPlayerId }))).toEqual(before);

  await p1.context().close();
  await p2.context().close();
});

test('desktop inventory shows actions above cards without card strip scrolling', async ({ browser }) => {
  const p1 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Alice',
    viewport: { width: 1280, height: 900 },
  });
  const p2 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Bob',
    viewport: { width: 1280, height: 900 },
  });

  await createAndJoinRoom(p1, p2);
  await grantCard(p1, 'V', 'dead_ore');
  await selectRole(p1, 'V');
  await expect.poll(() => p1.locator('.inventory-action-row').count()).toBeGreaterThan(0);

  const layout = await p1.evaluate(() => {
    const actions = document.querySelector('.inventory-actions');
    const cards = document.querySelector('.inventory-cards-strip');
    if (!actions || !cards) return { found: false };
    const actionRect = actions.getBoundingClientRect();
    const cardsRect = cards.getBoundingClientRect();
    const cardRects = [...cards.querySelectorAll('.card.card-face')]
      .map((card) => card.getBoundingClientRect());
    const style = getComputedStyle(cards);
    return {
      found: true,
      actionsAboveCards: actionRect.bottom <= cardsRect.top + 1,
      noHorizontalScroll: cards.scrollWidth <= cards.clientWidth + 1,
      overflowX: style.overflowX,
      cardsInsideStrip: cardRects.every((rect) =>
        rect.left >= cardsRect.left - 1
        && rect.right <= cardsRect.right + 1
        && rect.width > 0
        && rect.height > 0),
    };
  });
  expect(layout).toEqual({
    found: true,
    actionsAboveCards: true,
    noHorizontalScroll: true,
    overflowX: 'visible',
    cardsInsideStrip: true,
  });

  await p1.context().close();
  await p2.context().close();
});

test('mobile inventory action buttons and cardbox stay inside the viewport', async ({ browser }) => {
  const p1 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Alice',
    viewport: { width: 720, height: 1280 },
  });
  const p2 = await newGamePage(browser, {
    webPort,
    gamePort,
    playerName: 'Bob',
    viewport: { width: 720, height: 1280 },
  });

  await createAndJoinRoom(p1, p2);
  await grantCard(p2, 'V', 'dead_ore');
  await p2.evaluate(() => document.querySelector('#sheet')?.classList.add('open'));
  await expect.poll(() => p2.locator('.inventory-action-row').count()).toBeGreaterThan(0);

  const actionLayout = await p2.evaluate(() => {
    const rows = [...document.querySelectorAll('.inventory-action-row')];
    const row = rows.find((candidate) => candidate.querySelectorAll('button').length >= 5);
    if (!row) return { found: false };
    const rowRect = row.getBoundingClientRect();
    const buttonRects = [...row.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
    return {
      found: true,
      noHorizontalScroll: row.scrollWidth <= row.clientWidth + 1,
      buttonsInsideRow: buttonRects.every((rect) =>
        rect.left >= rowRect.left - 1
        && rect.right <= rowRect.right + 1
        && rect.width > 0
        && rect.height > 0),
      buttonsInsideViewport: buttonRects.every((rect) =>
        rect.left >= -1
        && rect.right <= window.innerWidth + 1),
    };
  });
  expect(actionLayout).toEqual({
    found: true,
    noHorizontalScroll: true,
    buttonsInsideRow: true,
    buttonsInsideViewport: true,
  });

  await p2.getByTestId('mode-transfer').click();
  await expect(p2.getByTestId('cardbox')).toBeVisible();
  await expectNoViewportOverflow(p2, '[data-testid="cardbox"]');
  const cardboxLayout = await p2.evaluate(() => {
    const box = document.querySelector('.cardbox').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.cbx-row')].map((row) => row.getBoundingClientRect());
    return {
      rowsInsideBox: rows.every((row) => row.left >= box.left - 1 && row.right <= box.right + 1),
    };
  });
  expect(cardboxLayout).toEqual({ rowsInsideBox: true });

  await p1.context().close();
  await p2.context().close();
});
