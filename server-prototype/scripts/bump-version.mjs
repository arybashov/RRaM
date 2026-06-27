#!/usr/bin/env node
// Бамп версии сборки одной командой — пишет новое значение во все 4 места сразу,
// чтобы они не разъехались (см. check-version.mjs).
//   node server-prototype/scripts/bump-version.mjs 20260612-2
// Формат версии — на ваше усмотрение, обычно ГГГГММДД-N.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const next = process.argv[2];
if (!next || !/^[\w.-]+$/.test(next)) {
  console.error('Использование: node scripts/bump-version.mjs <версия>  (например 20260612-2)');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

// Каждый regex: группа 1 — префикс, дальше идут символы версии (без кавычки/
// разделителя). Замена $1<версия> сохраняет хвост (кавычку, "> и т.п.) на месте.
const edits = [
  {
    path: resolve(repo, 'server-prototype/src/constants.js'),
    re: /(BUILD_VERSION\s*=\s*')[^']+/,
  },
  {
    path: resolve(repo, 'prototype-web/game.js'),
    re: /(APP_VERSION\s*=\s*')[^']+/,
  },
  {
    path: resolve(repo, 'prototype-web/index.html'),
    re: /(game\.js\?v=)[^"']+/,
  },
  {
    path: resolve(repo, 'prototype-web/index.html'),
    re: /(styles\.css\?v=)[^"']+/,
  },
  {
    path: resolve(repo, 'prototype-web/index.html'),
    re: /(card-art-registry\.js\?v=)[^"']+/,
  },
  {
    path: resolve(repo, 'prototype-web/index.html'),
    re: /(dwarfs-entry\.mp4\?v=)[^"']+/,
  },
];

for (const { path, re } of edits) {
  const text = await readFile(path, 'utf8');
  if (!re.test(text)) {
    console.error(`❌ Не нашёл версию в ${path} по ${re}`);
    process.exit(1);
  }
  const updated = text.replace(re, (_, prefix) => `${prefix}${next}`);
  await writeFile(path, updated);
}

console.log(`✅ Версия сборки обновлена до ${next} во всех местах.`);
console.log('   Проверьте: node server-prototype/scripts/check-version.mjs');
