import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARMOR_CARDS,
  BASE_CARD_CATALOG,
  BEASTS,
  CARD_CATALOG,
  CRAFT_RECIPES,
  WEAPON_CARDS,
} from '../src/constants.js';
import { createGame } from '../src/rules.js';

const allCards = [...BASE_CARD_CATALOG, ...CARD_CATALOG];

function copies(cards) {
  return cards.reduce((total, card) => total + (Number.isFinite(card.copies) ? card.copies : 0), 0);
}

function byDeck(deck) {
  return CARD_CATALOG.filter((card) => card.deck === deck);
}

function countIds(ids) {
  return Object.fromEntries(
    Object.entries(ids.reduce((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {})).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function makePlayers() {
  return [
    { id: 'p1', seatIndex: 0, side: 'green', name: 'Alice' },
    { id: 'p2', seatIndex: 1, side: 'red', name: 'Bob' },
  ];
}

function startsWithRu(name, codePoints) {
  const prefix = String.fromCodePoint(...codePoints);
  return String(name ?? '').toLocaleLowerCase('ru').startsWith(prefix.toLocaleLowerCase('ru'));
}

function startsWithRecipe(name) {
  return startsWithRu(name, [0x420, 0x435, 0x446, 0x435, 0x43f, 0x442]);
}

function startsWithBlueprint(name) {
  return startsWithRu(name, [0x427, 0x435, 0x440, 0x442, 0x435, 0x436])
    || startsWithRu(name, [0x427, 0x435, 0x440, 0x442, 0x451, 0x436]);
}

test('card catalog totals are stable', () => {
  assert.equal(BASE_CARD_CATALOG.length, 11);
  assert.equal(copies(BASE_CARD_CATALOG), 11);
  assert.equal(CARD_CATALOG.length, 121);
  assert.equal(copies(CARD_CATALOG), 121);
  assert.equal(allCards.length, 132);
  assert.equal(copies(allCards), 132);
});

test('card ids are unique across base and draw catalogs', () => {
  const ids = allCards.map((card) => card.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('draw deck card counts are stable', () => {
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(CARD_CATALOG.map((card) => card.deck))]
        .sort()
        .map((deck) => [deck, { unique: byDeck(deck).length, copies: copies(byDeck(deck)) }]),
    ),
    {
      blueprints: { unique: 20, copies: 20 },
      dark_forest: { unique: 25, copies: 14 },
      fairy_glade: { unique: 6, copies: 4 },
      forest: { unique: 15, copies: 24 },
      lake: { unique: 7, copies: 7 },
      mixed: { unique: 4, copies: 20 },
      recipes: { unique: 27, copies: 15 },
      red: { unique: 10, copies: 10 },
      sheep: { unique: 4, copies: 7 },
      trophy: { unique: 3, copies: 0 },
    },
  );
});

test('recipes and blueprints are classified by their visible titles', () => {
  const recipeTitleCards = allCards.filter((card) => startsWithRecipe(card.name));
  const blueprintTitleCards = allCards.filter((card) => startsWithBlueprint(card.name));

  assert.equal(recipeTitleCards.length, 14);
  assert.equal(copies(recipeTitleCards), 16);
  assert.ok(recipeTitleCards.every((card) => card.type === 'recipe'));
  assert.ok(recipeTitleCards.filter((card) => CARD_CATALOG.includes(card)).every((card) => card.deck === 'recipes'));

  assert.equal(blueprintTitleCards.length, 22);
  assert.equal(copies(blueprintTitleCards), 22);
  assert.ok(blueprintTitleCards.every((card) => card.type === 'blueprint'));
  assert.ok(blueprintTitleCards.filter((card) => CARD_CATALOG.includes(card)).every((card) => card.deck === 'blueprints'));

  const twinAxesBlueprint = allCards.find((card) => card.id === 'art_dark_forest_037');
  assert.equal(twinAxesBlueprint?.type, 'blueprint');
  assert.equal(twinAxesBlueprint?.deck, 'blueprints');
});

test('all blueprint cards have one copy', () => {
  const blueprints = allCards.filter((card) => card.type === 'blueprint');
  assert.equal(blueprints.length, 22);
  assert.ok(blueprints.every((card) => card.copies === 1));
});

test('all visible recipes and blueprints are connected to craft rules', () => {
  const craftEntries = Object.values(CRAFT_RECIPES);
  const craftVia = new Set(craftEntries.map((recipe) => recipe.via).filter(Boolean));
  const craftResults = new Set(craftEntries.map((recipe) => recipe.result).filter(Boolean));
  const catalogIds = new Set(allCards.map((card) => card.id));

  const disconnectedSources = allCards
    .filter((card) => ['recipe', 'blueprint'].includes(card.type))
    .filter((card) => !craftVia.has(card.id))
    .map((card) => card.id)
    .sort();
  assert.deepEqual(disconnectedSources, []);

  const missingResults = [...craftResults]
    .filter((id) => !catalogIds.has(id))
    .sort();
  assert.deepEqual(missingResults, []);
});

test('combat catalog cards are connected to combat tables', () => {
  const missingArmor = allCards
    .filter((card) => card.type === 'armor')
    .filter((card) => !ARMOR_CARDS[card.id])
    .map((card) => card.id)
    .sort();
  assert.deepEqual(missingArmor, []);

  const weaponHandledElsewhere = new Set(['club']);
  const missingWeapons = allCards
    .filter((card) => card.type === 'weapon')
    .filter((card) => !weaponHandledElsewhere.has(card.id))
    .filter((card) => !WEAPON_CARDS[card.id])
    .map((card) => card.id)
    .sort();
  assert.deepEqual(missingWeapons, []);

  const missingBeasts = allCards
    .filter((card) => card.type === 'beast')
    .filter((card) => !BEASTS[card.id])
    .map((card) => card.id)
    .sort();
  assert.deepEqual(missingBeasts, []);
});

test('Жаба ворчун is a special card, not a beast encounter', () => {
  const toad = allCards.find((card) => card.id === 'art_fairy_glade_005');
  assert.equal(toad?.name, 'Жаба ворчун');
  assert.equal(toad?.deck, 'fairy_glade');
  assert.equal(toad?.type, 'special');
  assert.equal(BEASTS.art_fairy_glade_005, undefined);
});

test('sheep deck and ritual hide counts are stable', () => {
  assert.deepEqual(
    Object.fromEntries(byDeck('sheep').map((card) => [card.id, card.copies]).sort()),
    {
      sheep_hide_c: 0,
      sheep_hide_r: 0,
      sheep_ram: 2,
      sheep_wool: 5,
    },
  );

  const ritualHide = allCards.find((card) => card.id === 'ritual_hide');
  assert.equal(ritualHide?.deck, 'recipes');
  assert.equal(ritualHide?.type, 'special');
  assert.equal(ritualHide?.copies, 1);
});

test('recipes deck draw contains no finished craft results', () => {
  const drawableRecipes = byDeck('recipes').filter((card) => card.copies > 0);
  assert.deepEqual(
    drawableRecipes
      .filter((card) => card.type !== 'recipe' && card.id !== 'ritual_hide')
      .map((card) => card.id)
      .sort(),
    [],
  );

  for (const id of ['armor_zhest', 'porcha', 'marvo']) {
    const card = byDeck('recipes').find((item) => item.id === id);
    assert.equal(card?.copies, 0, `${id} must be crafted, not drawn from recipes deck`);
  }
});

test('long catalog audit: every card is in the expected gameplay deck', () => {
  const expectedByDeck = {
    blueprints: {
      art_dark_forest_003: 1,
      art_dark_forest_005: 1,
      art_dark_forest_007: 1,
      art_dark_forest_009: 1,
      art_dark_forest_011: 1,
      art_dark_forest_013: 1,
      art_dark_forest_015: 1,
      art_dark_forest_017: 1,
      art_dark_forest_019: 1,
      art_dark_forest_021: 1,
      art_dark_forest_026: 1,
      art_dark_forest_029: 1,
      art_dark_forest_031: 1,
      art_dark_forest_033: 1,
      art_dark_forest_035: 1,
      art_dark_forest_037: 1,
      art_dark_forest_039: 1,
      art_dark_forest_041: 1,
      art_dark_forest_043: 1,
      blueprint_irikon: 1,
    },
    dark_forest: {
      art_dark_forest_001: 1,
      art_dark_forest_002: 1,
      black_berries: 2,
      dead_ore: 6,
      red_berries: 2,
      return_ring: 2,
    },
    fairy_glade: {
      art_fairy_glade_001: 1,
      art_fairy_glade_005: 1,
      phoenix_1: 1,
      phoenix_2: 1,
    },
    forest: {
      amanita: 3,
      amanita_color: 3,
      amanita_glade: 2,
      art_forest_003: 1,
      art_forest_005: 1,
      art_forest_007: 1,
      art_forest_011: 1,
      art_forest_012: 1,
      bark: 3,
      boar_forest: 2,
      gold_nugget: 2,
      owl_common: 2,
      owl_night: 2,
    },
    lake: {
      art_lake_001: 1,
      art_lake_002: 1,
      art_lake_003: 1,
      art_lake_004: 1,
      art_lake_007: 1,
      lake_frog: 1,
      raw_ruby: 1,
    },
    mixed: {
      art_mixed_001: 5,
      art_mixed_003: 1,
      ore_coarse: 6,
      ore_medium: 8,
    },
    recipes: {
      art_recipes_003: 1,
      art_recipes_005: 1,
      art_recipes_007: 1,
      art_recipes_009: 1,
      art_recipes_011: 1,
      art_recipes_013: 1,
      art_recipes_015: 1,
      art_recipes_017: 1,
      art_recipes_019: 1,
      art_recipes_025: 1,
      recipe_armor: 2,
      recipe_obrud: 2,
      ritual_hide: 1,
    },
    red: {
      art_trophy_001: 1,
      art_trophy_002: 1,
      axe_sun: 1,
      beast_bear: 2,
      boar_red: 2,
      task_irikon: 1,
      wolf: 2,
    },
    sheep: {
      sheep_ram: 2,
      sheep_wool: 5,
    },
    trophy: {},
  };

  for (const [deck, expected] of Object.entries(expectedByDeck)) {
    assert.deepEqual(
      countIds(byDeck(deck).flatMap((card) => Array.from({ length: card.copies }, () => card.id))),
      expected,
      `catalog deck ${deck}`,
    );
  }
});

test('long gameplay audit: created games build full shuffled decks from the catalog', () => {
  const drawDecks = ['mixed', 'forest', 'dark_forest', 'sheep', 'lake', 'recipes', 'blueprints'];
  const expectedDrawDecks = Object.fromEntries(
    drawDecks.map((deck) => [
      deck,
      countIds(byDeck(deck).flatMap((card) => Array.from({ length: card.copies }, () => card.id))),
    ]),
  );
  const expectedRedDeck = countIds(
    CARD_CATALOG
      .filter((card) => card.deck === 'red' && card.id !== 'irikon')
      .flatMap((card) => Array.from(
        { length: card.id === 'beast_bear' ? Math.max(card.copies, 4) : card.copies },
        () => card.id,
      )),
  );

  for (let run = 0; run < 25; run += 1) {
    const game = createGame(makePlayers());
    for (const deck of drawDecks) {
      assert.deepEqual(countIds(game.decks[deck]), expectedDrawDecks[deck], `run ${run} draw deck ${deck}`);
      assert.ok(game.decks[deck].every((id) => allCards.some((card) => card.id === id)), `run ${run} known ids ${deck}`);
    }
    assert.deepEqual(countIds(game.redDeck), expectedRedDeck, `run ${run} red event deck`);
    assert.equal(game.redDeck.includes('irikon'), false, `run ${run} red deck excludes irikon`);
  }
});
