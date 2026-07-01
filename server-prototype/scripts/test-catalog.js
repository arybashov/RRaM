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
import { CARD_GAME_DECK_IDS, DECK_CARD_COUNTS, createGame, gameDeckIdsForCard } from '../src/rules.js';

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

function hasAdjacentGroup(ids, groupOf) {
  for (let i = 1; i < ids.length; i += 1) {
    if (groupOf(ids[i]) === groupOf(ids[i - 1])) return true;
  }
  return false;
}

const SHUFFLE_TEST_GROUP_IDS = Object.freeze({
  berries: Object.freeze(['black_berries', 'red_berries']),
  ore: Object.freeze(['ore_medium', 'ore_coarse', 'dead_ore', 'art_mixed_001', 'art_forest_011']),
  hide: Object.freeze(['hide_red', 'raw_hide', 'raw_hide_red', 'beast_hide', 'boar_hide', 'wolf_hide', 'bear_hide', 'sheep_hide_r', 'sheep_hide_c']),
  mushroom: Object.freeze(['amanita', 'amanita_color', 'amanita_glade']),
  bird: Object.freeze(['owl_common', 'owl_night']),
  nugget: Object.freeze(['gold_nugget', 'art_dark_forest_001', 'art_dark_forest_002']),
  gem: Object.freeze(['raw_ruby', 'art_lake_001', 'art_lake_002', 'art_lake_003', 'art_lake_004', 'art_fairy_glade_001']),
  beast: Object.freeze(['boar_forest', 'boar_red', 'wolf', 'beast_bear', 'art_trophy_001', 'art_trophy_002', 'sheep_ram', 'phoenix_1', 'phoenix_2']),
  wood: Object.freeze(['bark', 'art_forest_005', 'art_forest_007', 'art_forest_012', 'art_forest_016']),
});
const SHUFFLE_TEST_GROUPS = Object.freeze(Object.fromEntries(
  Object.entries(SHUFFLE_TEST_GROUP_IDS).flatMap(([group, ids]) => ids.map((id) => [id, group])),
));

function shuffleTestGroup(id) {
  return SHUFFLE_TEST_GROUPS[id] ?? id;
}

function adjacentGroupCount(ids, groupOf) {
  let count = 0;
  for (let i = 1; i < ids.length; i += 1) {
    if (groupOf(ids[i]) === groupOf(ids[i - 1])) count += 1;
  }
  return count;
}

function unavoidableAdjacentGroupCount(ids, groupOf) {
  const counts = ids.reduce((acc, id) => {
    const group = groupOf(id);
    acc[group] = (acc[group] ?? 0) + 1;
    return acc;
  }, {});
  const maxCount = Math.max(...Object.values(counts));
  return Math.max(0, maxCount - ((ids.length - maxCount) + 1));
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
  assert.equal(CARD_CATALOG.length, 125);
  assert.equal(copies(CARD_CATALOG), 122);
  assert.equal(allCards.length, 136);
  assert.equal(copies(allCards), 133);
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
      blueprints: { unique: 22, copies: 19 },
      dark_forest: { unique: 25, copies: 15 },
      fairy_glade: { unique: 6, copies: 4 },
      forest: { unique: 19, copies: 26 },
      lake: { unique: 7, copies: 7 },
      mixed: { unique: 4, copies: 20 },
      recipes: { unique: 28, copies: 16 },
      red: { unique: 7, copies: 8 },
      sheep: { unique: 4, copies: 7 },
      trophy: { unique: 3, copies: 0 },
    },
  );
});

test('game deck ids are independent from visual card backs', () => {
  for (const [deckId, cards] of Object.entries(DECK_CARD_COUNTS)) {
    for (const cardId of Object.keys(cards)) {
      assert.ok(
        gameDeckIdsForCard(cardId).includes(deckId),
        `${cardId} must be bound to gameplay deck ${deckId}`,
      );
    }
  }

  assert.deepEqual(
    gameDeckIdsForCard('hide_red'),
    ['mixed', 'forest_trail', 'lake', 'forest', 'dark_forest', 'red'],
  );
  assert.deepEqual(gameDeckIdsForCard('bear_hide'), ['lake', 'dark_forest', 'red']);
  assert.deepEqual(CARD_GAME_DECK_IDS.recipe_dil_bottle, ['recipes']);
  assert.deepEqual(gameDeckIdsForCard('player_green'), []);
});

test('recipes and blueprints are classified by their visible titles', () => {
  const recipeTitleCards = allCards.filter((card) => startsWithRecipe(card.name));
  const blueprintTitleCards = allCards.filter((card) => startsWithBlueprint(card.name));

  assert.equal(recipeTitleCards.length, 16);
  assert.equal(copies(recipeTitleCards), 18);
  assert.ok(recipeTitleCards.every((card) => card.type === 'recipe'));
  assert.ok(recipeTitleCards.filter((card) => CARD_CATALOG.includes(card)).every((card) => ['forest', 'recipes'].includes(card.deck)));

  assert.equal(blueprintTitleCards.length, 21);
  assert.equal(copies(blueprintTitleCards), 21);
  assert.ok(blueprintTitleCards.every((card) => card.type === 'blueprint'));
  assert.ok(blueprintTitleCards.filter((card) => CARD_CATALOG.includes(card)).every((card) => card.deck === 'blueprints'));

  const twinAxesBlueprint = allCards.find((card) => card.id === 'art_dark_forest_037');
  assert.equal(twinAxesBlueprint?.type, 'blueprint');
  assert.equal(twinAxesBlueprint?.deck, 'blueprints');
});

test('all blueprint cards have one copy', () => {
  const blueprints = allCards.filter((card) => card.type === 'blueprint');
  assert.equal(blueprints.length, 21);
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
    },
    dark_forest: {
      art_dark_forest_001: 1,
      art_dark_forest_002: 1,
      art_trophy_002: 1,
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
      art_forest_016: 1,
      art_recipes_015: 1,
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
      recipe_sprouted_root: 1,
      art_recipes_003: 1,
      art_recipes_005: 1,
      art_recipes_007: 1,
      art_recipes_009: 1,
      art_recipes_011: 1,
      art_recipes_013: 1,
      recipe_dil_bottle: 1,
      art_recipes_017: 1,
      art_recipes_019: 1,
      art_recipes_025: 1,
      recipe_armor: 2,
      recipe_obrud: 2,
      ritual_hide: 1,
    },
    red: {
      art_trophy_001: 1,
      axe_sun: 1,
      beast_bear: 2,
      boar_red: 2,
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

test('long gameplay audit: created games build decks from the JSON separator inventory', () => {
  const expectedDrawDecks = {
    mixed: {
      amanita: 6,
      art_mixed_001: 13,
      art_mixed_003: 3,
      boar_forest: 6,
      gold_nugget: 6,
      hide_red: 6,
      ore_coarse: 14,
      raw_hide: 6,
    },
    forest_trail: {
      amanita: 4,
      amanita_glade: 1,
      art_forest_003: 6,
      art_forest_005: 3,
      art_forest_007: 3,
      art_forest_011: 3,
      art_forest_012: 2,
      art_mixed_001: 4,
      bark: 4,
      black_berries: 3,
      boar_forest: 5,
      gold_nugget: 2,
      hide_red: 5,
      owl_night: 5,
      raw_hide: 5,
      red_berries: 2,
    },
    forest: {
      amanita: 2,
      art_dark_forest_001: 3,
      art_dark_forest_002: 3,
      art_forest_003: 2,
      art_forest_011: 2,
      art_lake_007: 2,
      art_mixed_001: 2,
      art_mixed_003: 2,
      art_recipes_016: 3,
      bark: 4,
      black_berries: 2,
      hide_red: 3,
      owl_common: 2,
      owl_night: 1,
      raw_hide: 3,
      recipe_sprouted_root: 2,
      shaman_cauldron: 2,
      wolf: 3,
    },
    dark_forest: {
      amanita: 1,
      art_dark_forest_001: 5,
      art_dark_forest_002: 6,
      art_forest_003: 2,
      art_forest_005: 2,
      art_forest_007: 4,
      art_forest_011: 7,
      art_mixed_001: 7,
      art_trophy_002: 2,
      bark: 3,
      bear_hide: 2,
      hide_red: 2,
      ore_medium: 7,
      owl_night: 1,
      red_berries: 1,
    },
    sheep: {
      art_forest_016: 8,
      sheep_hide_c: 8,
      sheep_hide_r: 8,
      sheep_ram: 8,
      sheep_wool: 8,
      yarn: 8,
    },
    lake: {
      art_lake_001: 3,
      art_lake_002: 3,
      art_lake_003: 3,
      art_lake_004: 3,
      art_lake_007: 3,
      art_trophy_001: 2,
      bear_hide: 2,
      hide_red: 2,
      lake_frog: 2,
      raw_ruby: 3,
    },
    recipes: {
      armor_zhest: 2,
      art_recipes_003: 2,
      art_recipes_004: 2,
      art_recipes_005: 2,
      art_recipes_007: 2,
      art_recipes_008: 2,
      art_recipes_009: 2,
      art_recipes_010: 2,
      art_recipes_011: 2,
      art_recipes_012: 2,
      art_recipes_013: 2,
      art_recipes_014: 2,
      art_recipes_017: 2,
      art_recipes_018: 2,
      art_recipes_019: 2,
      art_recipes_020: 2,
      art_recipes_021: 2,
      art_recipes_024: 2,
      art_recipes_025: 2,
      art_recipes_026: 2,
      dil_bottle: 2,
      leather_shirt: 2,
      porcha: 2,
      recipe_armor: 2,
      recipe_dil_bottle: 2,
      recipe_obrud: 2,
      ritual_hide: 2,
    },
    blueprints: {
      armor_il: 2,
      art_dark_forest_003: 2,
      art_dark_forest_004: 3,
      art_dark_forest_005: 2,
      art_dark_forest_007: 2,
      art_dark_forest_008: 2,
      art_dark_forest_009: 2,
      art_dark_forest_011: 2,
      art_dark_forest_013: 2,
      art_dark_forest_015: 2,
      art_dark_forest_017: 2,
      art_dark_forest_019: 2,
      art_dark_forest_020: 2,
      art_dark_forest_021: 2,
      art_dark_forest_026: 2,
      art_dark_forest_029: 2,
      art_dark_forest_030: 2,
      art_dark_forest_031: 2,
      art_dark_forest_033: 2,
      art_dark_forest_034: 2,
      art_dark_forest_035: 2,
      art_dark_forest_037: 2,
      art_dark_forest_038: 2,
      art_dark_forest_039: 2,
      art_dark_forest_040: 2,
      art_dark_forest_041: 2,
      art_dark_forest_043: 2,
      axe_sun: 2,
      chainmail_light: 2,
      helm_shem: 2,
      helm_ttm: 2,
      irikon: 2,
      return_ring: 2,
      shield_dr: 2,
      shield_kalan: 2,
      shield_lom: 2,
      shield_revenge: 2,
      sword_lorp: 2,
      sword_sech: 2,
      task_irikon: 2,
      topormol: 2,
    },
  };
  const expectedRedDeck = {
    art_trophy_001: 2,
    art_trophy_002: 2,
    bear_hide: 4,
    boar_red: 2,
    hide_red: 7,
    raw_hide_red: 3,
    wolf: 1,
  };
  const expectedFairyDeck = {
    art_fairy_glade_001: 2,
    art_fairy_glade_005: 2,
    art_mixed_003: 4,
    gold_feather_enemy: 1,
    gold_feather_own: 1,
    phoenix_1: 2,
  };
  const drawDecks = Object.keys(expectedDrawDecks);

  for (let run = 0; run < 25; run += 1) {
    const game = createGame(makePlayers());
    for (const deck of drawDecks) {
      assert.deepEqual(countIds(game.decks[deck]), expectedDrawDecks[deck], `run ${run} draw deck ${deck}`);
      assert.ok(game.decks[deck].every((id) => allCards.some((card) => card.id === id)), `run ${run} known ids ${deck}`);
    }
    assert.deepEqual(countIds(game.redDeck), expectedRedDeck, `run ${run} red event deck`);
    assert.equal(game.redDeck.includes('irikon'), false, `run ${run} red deck excludes irikon`);
    assert.equal(game.redDeck.includes('task_irikon'), false, `run ${run} red deck excludes task_irikon`);
    assert.deepEqual(countIds(game.fairyDeck), expectedFairyDeck, `run ${run} fairy event deck`);
  }
});

test('created decks are softly spread like a real shuffled deck', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const game = createGame(makePlayers());
    const drawDecks = ['mixed', 'forest_trail', 'forest', 'dark_forest', 'lake', 'sheep', 'blueprints'];
    for (const deck of drawDecks) {
      assert.equal(
        hasAdjacentGroup(game.decks[deck], (id) => id),
        false,
        `${deck} has exact duplicate cards next to each other`,
      );
      assert.ok(
        adjacentGroupCount(game.decks[deck], shuffleTestGroup)
          <= unavoidableAdjacentGroupCount(game.decks[deck], shuffleTestGroup) + 1,
        `${deck} has avoidable semantic card clumps`,
      );
    }
    assert.equal(
      adjacentGroupCount(game.redDeck, shuffleTestGroup),
      unavoidableAdjacentGroupCount(game.redDeck, shuffleTestGroup),
      'red event deck has avoidable semantic card clumps',
    );
  } finally {
    Math.random = originalRandom;
  }
});
