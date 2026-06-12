#!/usr/bin/env node
// Guard синхронизации версий. Версия сборки живёт в 4 местах, и если они
// разъезжаются — у игроков «не работает клиент»: либо браузер тянет старый
// game.js (старый ?v=), либо проверка версий слепнет (APP_VERSION === BUILD_VERSION,
// хотя код другой). Этот скрипт падает с кодом 1 при любом расхождении.
// Запускается в deploy-web.sh и в CI до выкладки.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

const constantsPath = resolve(repo, 'server-prototype/src/constants.js');
const gamePath = resolve(repo, 'prototype-web/game.js');
const indexPath = resolve(repo, 'prototype-web/index.html');

function pick(label, text, re) {
  const m = text.match(re);
  if (!m) throw new Error(`Не нашёл версию: ${label}`);
  return { label, value: m[1] };
}

const [constants, game, index] = await Promise.all([
  readFile(constantsPath, 'utf8'),
  readFile(gamePath, 'utf8'),
  readFile(indexPath, 'utf8'),
]);

const found = [
  pick('BUILD_VERSION (constants.js)', constants, /BUILD_VERSION\s*=\s*'([^']+)'/),
  pick('APP_VERSION (game.js)', game, /APP_VERSION\s*=\s*'([^']+)'/),
  pick('game.js ?v= (index.html)', index, /game\.js\?v=([^"']+)/),
  pick('styles.css ?v= (index.html)', index, /styles\.css\?v=([^"']+)/),
];

const versions = new Set(found.map((f) => f.value));
if (versions.size !== 1) {
  console.error('❌ Версии сборки рассинхронизированы:');
  for (const f of found) console.error(`   ${f.value.padEnd(20)} ← ${f.label}`);
  console.error('\nСведите их одной командой:');
  console.error('   node server-prototype/scripts/bump-version.mjs <версия>');
  process.exit(1);
}

console.log(`✅ Версия сборки согласована во всех местах: ${[...versions][0]}`);
