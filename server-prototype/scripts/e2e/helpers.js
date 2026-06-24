import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import net from 'node:net';

export async function freePort() {
  return new Promise((resolveFreePort, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolveFreePort(port));
    });
  });
}

export async function waitForHttp(url) {
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

export async function startStaticServer(root, port) {
  await mkdir(root, { recursive: true });
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

export function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolveClose) => server.close(resolveClose));
}

export async function newGamePage(browser, { webPort, gamePort, playerName, viewport = { width: 390, height: 844 } }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await openGamePage(page, { webPort, gamePort });
  await page.getByTestId('player-name').fill(playerName);
  await expect(page.getByTestId('connection-badge')).toHaveClass(/conn-connected/);
  await page.waitForFunction(() => typeof window.wsSend === 'function');
  return page;
}

export async function openGamePage(page, { webPort, gamePort }) {
  const serverUrl = encodeURIComponent(`ws://127.0.0.1:${gamePort}/ws`);
  await page.goto(`http://127.0.0.1:${webPort}/index.html?server=${serverUrl}&e2e=${Date.now()}`);
}

export async function createAndJoinRoom(p1, p2) {
  await p1.getByTestId('create-room').click();
  await expect(p1.getByTestId('room-code')).toBeVisible();
  await expect(p2.getByTestId('join-room')).toHaveCount(1);
  await p2.getByTestId('join-room').click();
  await expect(p1.locator('#lobby.hidden')).toHaveCount(1);
  await expect(p2.locator('#lobby.hidden')).toHaveCount(1);
  await expect(p1.getByTestId(/^character-/)).toHaveCount(5);
  await expect(p2.getByTestId(/^character-/)).toHaveCount(5);
}

export async function selectRole(page, role) {
  await page.getByTestId(`character-${role}`).click();
  await expect(page.getByTestId(`character-${role}`)).toHaveAttribute('aria-pressed', 'true');
}

export async function endTurn(page) {
  await page.getByTestId('turn-action').click();
}

export async function rollTurn(page) {
  await page.getByTestId('turn-action').click();
  await expect.poll(() => page.evaluate(() => Boolean(getGame()?.turn?.hasRolled))).toBe(true);
}

export async function grantCard(page, role, cardId) {
  await page.evaluate(({ role: targetRole, cardId: targetCardId }) => {
    const character = getMyChars().find((char) => char.role === targetRole);
    selectCharacter(character.id);
    wsSend('debug:grantCard', { characterId: character.id, cardId: targetCardId });
  }, { role, cardId });
  await expect.poll(() => page.evaluate(({ role: targetRole, cardId: targetCardId }) => {
    const character = getMyChars().find((char) => char.role === targetRole);
    return character?.inventory?.some((card) => (card.id ?? card) === targetCardId) ?? false;
  }, { role, cardId })).toBe(true);
}

export async function expectNoViewportOverflow(page, selector) {
  const layout = await page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThan(0);
  expect(layout.left).toBeGreaterThanOrEqual(-1);
  expect(layout.top).toBeGreaterThanOrEqual(-1);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
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
