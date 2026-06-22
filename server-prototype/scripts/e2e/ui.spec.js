import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

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

test('second player can use terrain card controls from the UI', async ({ browser }) => {
  const p1 = await newGamePage(browser, 'Alice');
  const p2 = await newGamePage(browser, 'Bob');

  await createAndJoinRoom(p1, p2);
  await p1.evaluate(() => wsSend('turn:end'));
  await expect.poll(() => p2.evaluate(() => getGame()?.turn?.activePlayerId === getMyChars()?.[0]?.owner))
    .toBe(true);

  await p2.evaluate(() => {
    const warrior = getMyChars().find((char) => char.role === 'V');
    selectCharacter(warrior.id);
    wsSend('debug:grantCard', { characterId: warrior.id, cardId: 'bark' });
  });
  await expect.poll(() => p2.evaluate(() => getSelChar()?.inventory?.some((card) => (card.id ?? card) === 'bark')))
    .toBe(true);

  await p2.evaluate(() => {
    document.querySelector('#sheet')?.classList.add('open');
    const warrior = getSelChar();
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
  await expect(p2.locator('.combat-stat-defense')).toContainText('5');
  await expect(p2.locator('.terrain-return-btn')).toBeVisible();

  await p2.locator('.terrain-return-btn').click();

  await expect(p2.locator('.placed-terrain-cards')).toHaveCount(0);
  await expect.poll(() => p2.evaluate(() => getSelChar()?.inventory?.some((card) => (card.id ?? card) === 'bark')))
    .toBe(true);

  await p1.context().close();
  await p2.context().close();
});

test('opponent dice values are hidden in the UI and snapshot', async ({ browser }) => {
  const p1 = await newGamePage(browser, 'Alice');
  const p2 = await newGamePage(browser, 'Bob');

  await createAndJoinRoom(p1, p2);
  await p1.evaluate(() => wsSend('turn:roll'));

  await expect.poll(() => p1.evaluate(() => Object.keys(getGame()?.turn?.diceByCharacter ?? {}).length))
    .toBeGreaterThan(0);
  await expect.poll(() => p2.evaluate(() => getGame()?.turn?.hasRolled))
    .toBe(true);

  const p1Dice = await p1.locator('.board-dice .die').allTextContents();
  expect(p1Dice.every((text) => /^[1-6]$/.test(text.trim()))).toBe(true);

  const p2Dice = await p2.locator('.board-dice .die').allTextContents();
  expect(p2Dice.some((text) => /^[1-6]$/.test(text.trim()))).toBe(false);
  await expect.poll(() => p2.evaluate(() => getGame()?.turn?.dice)).toBe(null);
  await expect.poll(() => p2.evaluate(() => Object.keys(getGame()?.turn?.diceByCharacter ?? {}).length)).toBe(0);

  await p1.context().close();
  await p2.context().close();
});

test('mobile inventory action buttons and cardbox stay inside the viewport', async ({ browser }) => {
  const p1 = await newGamePage(browser, 'Alice', { width: 720, height: 1280 });
  const p2 = await newGamePage(browser, 'Bob', { width: 720, height: 1280 });

  await createAndJoinRoom(p1, p2);
  await p2.evaluate(() => {
    document.querySelector('#sheet')?.classList.add('open');
    const warrior = getMyChars().find((char) => char.role === 'V');
    selectCharacter(warrior.id);
    wsSend('debug:grantCard', { characterId: warrior.id, cardId: 'dead_ore' });
  });
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

  await p2.locator('.mode[data-mode="transfer"]').click();
  await expect(p2.locator('#cardBox:not(.hidden)')).toBeVisible();
  const cardboxLayout = await p2.evaluate(() => {
    const box = document.querySelector('.cardbox').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.cbx-row')].map((row) => row.getBoundingClientRect());
    return {
      fitsViewport: box.left >= -1
        && box.top >= -1
        && box.right <= window.innerWidth + 1
        && box.bottom <= window.innerHeight + 1,
      rowsInsideBox: rows.every((row) => row.left >= box.left - 1 && row.right <= box.right + 1),
    };
  });
  expect(cardboxLayout).toEqual({ fitsViewport: true, rowsInsideBox: true });

  await p1.context().close();
  await p2.context().close();
});

async function newGamePage(browser, playerName, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${webPort}/index.html?server=${encodeURIComponent(`ws://127.0.0.1:${gamePort}/ws`)}&e2e=${Date.now()}`);
  await page.fill('#playerName', playerName);
  await page.waitForFunction(() => typeof window.wsSend === 'function' && document.querySelector('#connBadge')?.classList.contains('conn-connected'));
  return page;
}

async function createAndJoinRoom(p1, p2) {
  await p1.locator('#createBtn').click();
  await expect(p1.locator('#codeDisplay')).toBeVisible();
  await expect(p2.locator('.lobby-list-join')).toHaveCount(1);
  await p2.locator('.lobby-list-join').click();
  await expect(p1.locator('#lobby.hidden')).toHaveCount(1);
  await expect(p2.locator('#lobby.hidden')).toHaveCount(1);
  await expect(p1.locator('.character-nav-btn')).toHaveCount(5);
  await expect(p2.locator('.character-nav-btn')).toHaveCount(5);
}

function freePort() {
  return new Promise((resolveFreePort, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolveFreePort(port));
    });
  });
}

async function waitForHttp(url) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function startStaticServer(root, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const cleanPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = resolve(root, `.${cleanPath}`);
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolveServer, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolveServer(server));
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolveClose) => server.close(resolveClose));
}

function mimeFor(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
