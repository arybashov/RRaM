// Общие константы правил RRaM. Держим отдельно от сетевого кода,
// чтобы движок правил можно было переиспользовать и менять без транспорта.

// ⚠️ ВЕРСИЯ СБОРКИ — ЕДИНЫЙ ИСТОЧНИК. Должна совпадать с APP_VERSION в
// prototype-web/game.js и с ?v= у game.js/styles.css в index.html.
// Клиент сравнивает свою версию с этой и просит обновиться при расхождении.
// Не правьте вручную по отдельности — бампайте все разом:
//   node server-prototype/scripts/bump-version.mjs <новая-версия>
// Деплой роняет себя, если версии разъехались (scripts/check-version.mjs).
export const BUILD_VERSION = '20260701-22';

export const ROLES = ['K', 'P', 'V', 'O', 'S'];

export const ROLE_NAMES = Object.freeze({
  K: 'Кузнец',
  P: 'Помощник',
  V: 'Воин',
  O: 'Охотник',
  S: 'Шаман',
});

export const PLAYER_LIMIT = 2;
export const ROLLS_PER_GAME = 10;
export const INVENTORY_LIMIT = 10;
export const CHARACTER_HP = 100;

// Идентификатор карты телепортации (см. BASE_CARD_CATALOG). Карты в инвентаре
// и колодах хранятся как id; человекочитаемое имя резолвится через CARD_BY_ID.
export const TELEPORT_CARD = 'teleport_beads';
export const GOLD_FEATHER_OWN = 'gold_feather_own';
export const GOLD_FEATHER_ENEMY = 'gold_feather_enemy';
export const GOLD_FEATHER_CARDS = Object.freeze([GOLD_FEATHER_OWN, GOLD_FEATHER_ENEMY]);
export const GEM_CARDS = Object.freeze([
  'art_lake_001',
  'art_lake_002',
  'art_lake_003',
  'art_lake_004',
  'art_fairy_glade_001',
]);

// Параметры зверей (встречи на красных клетках и в лесу).
// damage — урон персонажу в начале каждого хода владельца, пока зверь не убит;
// killOn — значение кубика для мгновенного убийства;
// successOn/needed — меньшие значения копят успехи, needed успехов убивают зверя.
export const BEASTS = Object.freeze({
  sheep_ram:    { damage: 1,  killOn: 3, successOn: 1, needed: 2 },
  boar_red:    { damage: 5,  killOn: 4, successOn: 2, needed: 3 },
  boar_forest: { damage: 5,  killOn: 4, successOn: 2, needed: 3 },
  wolf:        { damage: 5,  killOn: 5, successOn: 2, needed: 3 },
  beast_bear:  { damage: 10, killOn: 5, successOn: 5, needed: 3 },
  art_trophy_001: { damage: 10, killOn: 5, successOn: 5, needed: 3 },
  art_trophy_002: { damage: 10, killOn: 5, successOn: 5, needed: 3 },
  // Феникс на Сказочной опушке (квест Иерихон). Баланс MVP, тюнится.
  phoenix_1:   { damage: 15, killOn: 6, successOn: 5, needed: 3 },
  phoenix_2:   { damage: 15, killOn: 6, successOn: 5, needed: 3 },
});

// Цепочка крафта Дубины (по правилам):
//   убил зверя → «Шкура убитого зверя» (сырая) → шаман обрабатывает (кубик ≥2)
//   → «Очищенная шкура зверя» → воин открывает Дубину очищенной шкурой.
//
// Лут с убитого зверя: какая сырая шкура падает за какого зверя.
export const BEAST_HIDE_DROP = Object.freeze({
  sheep_ram:    'sheep_hide_r',
  boar_red:    'boar_hide',
  wolf:        'wolf_hide',
  beast_bear:  'bear_hide',
  art_trophy_001: 'bear_hide',
  art_trophy_002: 'bear_hide',
  boar_forest: 'boar_hide',
});
// Трофеи (не шкуры) с убитого зверя. Отдельно от BEAST_HIDE_DROP: трофей —
// особый предмет квеста, не материал обработки шкур.
// phoenix_2 (перо к кузнецу врага) — доставка пера сопернику отложена, пока
// падает так же владельцу-убийце.
export const BEAST_TROPHY_DROP = Object.freeze({
  phoenix_1: GOLD_FEATHER_OWN,
  phoenix_2: GOLD_FEATHER_ENEMY,
});

// Сырые шкуры → материалы после обработки шаманом.
export const RAW_HIDE_TO_CLEAN = Object.freeze({
  sheep_hide_r: ['sheep_hide_c', 'sheep_wool'],
  raw_hide:     'beast_hide',
  raw_hide_red: 'hide_red',
  boar_hide:    'beast_hide',
  wolf_hide:    'beast_hide',
  bear_hide:    'beast_hide',
});
// Шаман бросает один кубик; значение ≥ этого — шкура очищена.
export const HIDE_CLEAN_MIN = 2;
// Материал для открытия Дубины — очищенная шкура зверя.
export const CLUB_MATERIALS = Object.freeze(['beast_hide', 'hide_red']);
export const SHAMAN_CARPET_MATERIALS = Object.freeze([
  'raw_hide',
  'raw_hide_red',
  'boar_hide',
  'wolf_hide',
  'bear_hide',
  'beast_hide',
  'hide_red',
  'sheep_hide_r',
  'sheep_hide_c',
]);

// Рецепты крафта базовых изделий — строго по PnP (без выдуманных «игл»).
// via — карта чертежа/рецепта; result — открываемое изделие (locked-карта);
// materials — список «слотов», в каждом перечислены допустимые id (любой подходит).
// Чертёж/рецепт и материалы расходуются, на result снимается замок.
export const CRAFT_RECIPES = Object.freeze({
  // Воин: убитый зверь → шкуру очищает шаман → очищенной шкурой открыть Дубину
  club:   { role: 'V', via: 'bp_club_base',   result: 'club',   materials: [['beast_hide', 'hide_red']] },
  // Кузнец: смешанная (грязная) железная руда
  hammer: {
    role: 'K',
    via: 'bp_hammer_base',
    result: 'hammer',
    materials: [['ore_medium']],
    dice: { count: 2, min: 3 },
  },
  // Помощник: клубок + очищенная шкура барана
  sack: {
    role: 'P',
    via: 'recipe_sack',
    result: 'sack',
    materials: [['yarn'], ['sheep_hide_c']],
    dice: { count: 2, min: 3 },
  },
  // Шаман: клубок + любая шкура → Ковёр шамана
  shaman_carpet: {
    role: 'S',
    via: 'recipe_shaman_carpet',
    result: 'shaman_carpet',
    materials: [['yarn'], SHAMAN_CARPET_MATERIALS],
    dice: { count: 1, min: 3 },
  },
  art_lake_007: {
    role: 'S',
    via: 'recipe_sprouted_root',
    result: 'art_lake_007',
    materials: [['shaman_carpet']],
    keepMaterials: ['shaman_carpet'],
    dice: { count: 1, min: 3 },
  },
  // Shaman recipes from the recipes deck.
  armor_zhest: {
    role: 'S',
    via: 'recipe_armor',
    result: 'armor_zhest',
    materials: [['ore_medium', 'ore_coarse'], ['raw_hide', 'raw_hide_red', 'wolf_hide', 'boar_hide', 'bear_hide']],
    dice: { count: 2, min: 3 },
  },
  marvo: {
    role: 'S',
    via: 'recipe_obrud',
    result: 'marvo',
    materials: [['amanita_glade'], ['lake_frog']],
    dice: { count: 2, min: 2 },
  },
  // Irikon quest craft: task + golden feather.
  irikon: {
    role: 'K',
    via: 'task_irikon',
    result: 'irikon',
    materials: [GOLD_FEATHER_CARDS],
    dice: { count: 2, min: 3 },
  },
  shield_revenge: {
    via: 'art_dark_forest_031',
    result: 'shield_revenge',
    options: [
      { role: 'K', materials: [['art_forest_011'], ['art_forest_011']], dice: { count: 2, min: 4 } },
      { role: 'K', materials: [['art_dark_forest_002']], dice: { count: 2, min: 4 } },
      { role: 'P', materials: [['art_forest_011'], ['art_forest_011']], dice: { count: 1, min: 5 } },
      { role: 'P', materials: [['art_dark_forest_002']], dice: { count: 1, min: 5 } },
    ],
  },
  topormol: {
    via: 'art_dark_forest_013',
    result: 'topormol',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse'], ['ore_medium', 'ore_coarse'], ['art_forest_012', 'art_forest_007']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['art_mixed_001'], ['art_forest_012', 'art_forest_007']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['ore_medium', 'ore_coarse'], ['ore_medium', 'ore_coarse'], ['art_forest_012', 'art_forest_007']], dice: { count: 1, min: 4 } },
      { role: 'K', materials: [['art_mixed_001'], ['art_forest_012', 'art_forest_007']], dice: { count: 1, min: 4 } },
    ],
  },
  art_dark_forest_004: {
    via: 'art_dark_forest_003', result: 'art_dark_forest_004',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse'], ['ore_medium', 'ore_coarse']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['art_mixed_001']], dice: { count: 2, min: 3 } },
    ],
  },
  chainmail_light_ext: {
    via: 'art_dark_forest_005', result: 'chainmail_light',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse'], ['ore_medium', 'ore_coarse']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['art_mixed_001']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['ore_medium', 'ore_coarse'], ['ore_medium', 'ore_coarse']], dice: { count: 1, min: 5 } },
      { role: 'K', materials: [['art_mixed_001']], dice: { count: 1, min: 5 } },
    ],
  },
  art_dark_forest_008: {
    role: 'K', via: 'art_dark_forest_007', result: 'art_dark_forest_008',
    materials: [['art_forest_011'], ['art_forest_011']],
    dice: { count: 2, min: 3 },
  },
  shield_dr_ext: {
    via: 'art_dark_forest_009', result: 'shield_dr',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'bark', 'art_forest_005']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'bark', 'art_forest_005']], dice: { count: 1, min: 4 } },
    ],
  },
  shield_lom_ext: {
    via: 'art_dark_forest_011', result: 'shield_lom',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'art_forest_005']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'art_forest_005']], dice: { count: 1, min: 3 } },
    ],
  },
  shield_kalan_ext: {
    via: 'art_dark_forest_015', result: 'shield_kalan',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'bark']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'bark']], dice: { count: 1, min: 4 } },
    ],
  },
  sword_sech_ext: {
    via: 'art_dark_forest_017', result: 'sword_sech',
    options: [
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'art_mixed_001']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['ore_medium', 'ore_coarse', 'art_mixed_001']], dice: { count: 1, min: 3 } },
    ],
  },
  art_dark_forest_020: {
    via: 'art_dark_forest_019', result: 'art_dark_forest_020',
    options: [
      { role: 'K', materials: [['art_forest_005', 'art_forest_012'], ['raw_ruby']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['art_forest_005', 'art_forest_012'], ['raw_ruby']], dice: { count: 1, min: 3 } },
    ],
  },
  axe_sun_ext: {
    role: 'K', via: 'art_dark_forest_021', result: 'axe_sun',
    materials: [['art_forest_011', 'art_dark_forest_002']],
    dice: { count: 2, min: 4 },
  },
  sword_lorp_ext: {
    role: 'K', via: 'art_dark_forest_026', result: 'sword_lorp',
    materials: [['ore_medium', 'ore_coarse']],
    dice: { count: 1, min: 3 },
  },
  art_dark_forest_030: {
    via: 'art_dark_forest_029', result: 'art_dark_forest_030',
    options: [
      { role: 'K', materials: [['art_forest_011']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['art_mixed_001'], ['art_mixed_001']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['art_forest_011']], dice: { count: 1, min: 4 } },
      { role: 'K', materials: [['art_mixed_001'], ['art_mixed_001']], dice: { count: 1, min: 4 } },
    ],
  },
  art_dark_forest_034: {
    via: 'art_dark_forest_033', result: 'art_dark_forest_034',
    options: [
      { role: 'K', materials: [['art_mixed_001'], ['art_mixed_001']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['raw_ruby']], dice: { count: 2, min: 2 } },
      { role: 'K', materials: [['art_mixed_001'], ['art_mixed_001']], dice: { count: 1, min: 4 } },
      { role: 'K', materials: [['raw_ruby']], dice: { count: 1, min: 4 } },
    ],
  },
  helm_shem_ext: {
    role: 'K', via: 'art_dark_forest_035', result: 'helm_shem',
    materials: [['art_mixed_001'], ['gold_nugget', 'art_dark_forest_001']],
    dice: { count: 1, min: 5 },
  },
  art_dark_forest_038: {
    via: 'art_dark_forest_037', result: 'art_dark_forest_038',
    options: [
      { role: 'K', materials: [['art_forest_011'], ['art_forest_011']], dice: { count: 1, min: 5 } },
      { role: 'K', materials: [['art_mixed_001'], GOLD_FEATHER_CARDS], dice: { count: 1, min: 5 } },
    ],
  },
  art_dark_forest_040: {
    via: 'art_dark_forest_039', result: 'art_dark_forest_040',
    options: [
      { role: 'K', materials: [['art_forest_011'], ['art_mixed_001']], dice: { count: 2, min: 4 } },
      { role: 'P', materials: [['art_dark_forest_001']], dice: { count: 1, min: 5 } },
    ],
  },
  helm_ttm_ext: {
    via: 'art_dark_forest_041', result: 'helm_ttm',
    options: [
      { role: 'K', materials: [['art_mixed_001'], ['art_mixed_001'], ['gold_nugget', 'art_dark_forest_001']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['art_mixed_001'], ['art_mixed_001'], ['gold_nugget', 'art_dark_forest_001']], dice: { count: 1, min: 5 } },
    ],
  },
  armor_il_ext: {
    via: 'art_dark_forest_043', result: 'armor_il',
    options: [
      { role: 'K', materials: [['art_forest_011'], ['art_dark_forest_001']], dice: { count: 2, min: 3 } },
      { role: 'K', materials: [['art_forest_011'], ['art_dark_forest_001']], dice: { count: 1, min: 4 } },
    ],
  },
  art_recipes_004: {
    role: 'S', via: 'art_recipes_003', result: 'art_recipes_004',
    materials: [['art_forest_005', 'bark'], ['red_berries']],
    dice: { count: 2, min: 2 },
  },
  leather_shirt_ext: {
    role: 'S', via: 'art_recipes_005', result: 'leather_shirt',
    materials: [['beast_hide', 'hide_red', 'sheep_hide_c'], ['beast_hide', 'hide_red', 'sheep_hide_c'], ['yarn']],
    dice: { count: 2, min: 3 },
  },
  art_recipes_008: {
    via: 'art_recipes_007', result: 'art_recipes_008',
    options: [
      { role: 'S', materials: [['ore_medium', 'ore_coarse'], ['ore_medium', 'ore_coarse'], ['sheep_hide_r']], dice: { count: 2, min: 4 } },
      { role: 'S', materials: [['art_mixed_001'], ['sheep_hide_r']], dice: { count: 2, min: 4 } },
    ],
  },
  art_recipes_010: {
    role: 'S', via: 'art_recipes_009', result: 'art_recipes_010',
    materials: [['shaman_carpet'], ['bark', 'art_forest_005'], GEM_CARDS],
    dice: { count: 1, min: 6 },
  },
  art_recipes_012: {
    role: 'S', via: 'art_recipes_011', result: 'art_recipes_012',
    materials: [['shaman_carpet'], ['bark', 'art_forest_005']],
    dice: { count: 2, min: 3 },
  },
  art_recipes_014: {
    role: 'S', via: 'art_recipes_013', result: 'art_recipes_014',
    materials: [['shaman_carpet'], ['bark', 'art_forest_005'], ['art_forest_003']],
    dice: { count: 2, min: 2 },
  },
  art_recipes_016: {
    role: 'S', via: 'art_recipes_015', result: 'art_recipes_016',
    materials: [['shaman_carpet'], ['art_lake_007']],
    dice: { count: 2, min: 2 },
  },
  dil_bottle: {
    role: 'S',
    via: 'recipe_dil_bottle',
    result: 'dil_bottle',
    materials: [['shaman_carpet'], ['art_lake_007']],
    keepMaterials: ['shaman_carpet'],
    dice: { count: 2, min: 2 },
  },
  art_recipes_018: {
    role: 'S', via: 'art_recipes_017', result: 'art_recipes_018',
    materials: [['art_mixed_003']],
    dice: { count: 2, min: 2 },
  },
  art_recipes_020: {
    role: 'S', via: 'art_recipes_019', result: 'art_recipes_020',
    materials: [['art_forest_007', 'art_forest_012'], ['beast_hide', 'hide_red', 'sheep_hide_c']],
    dice: { count: 2, min: 2 },
  },
  art_recipes_021: {
    role: 'S', via: 'art_recipes_019', result: 'art_recipes_021',
    materials: [['art_forest_007', 'art_forest_012'], GEM_CARDS],
    dice: { count: 2, min: 3 },
  },
  art_recipes_024: {
    via: 'recipe_obrud', result: 'art_recipes_024',
    options: [
      { role: 'S', materials: [['amanita_glade'], ['art_mixed_003']], dice: { count: 2, min: 2 } },
      { role: 'S', materials: [['amanita_glade'], ['art_mixed_003']], dice: { count: 1, min: 5 } },
    ],
  },
  art_recipes_026: {
    role: 'S', via: 'art_recipes_025', result: 'art_recipes_026',
    materials: [['amanita', 'amanita_color'], ['art_mixed_003']],
    dice: { count: 2, min: 3 },
  },
  // Шерсть барана → Клубок; отдельная карта рецепта не требуется.
  yarn: {
    role: 'S',
    via: 'sheep_wool',
    result: 'yarn',
    materials: [],
    dice: { count: 1, min: 2 },
  },
});
// Дубина: враг в бою теряет 10 HP каждое начало хода владельца (без учёта брони)
export const CLUB_DAMAGE = 10;

// Молот Иерикон: бонус к урону атаки Кузнеца (без учёта защиты). Молот
// многоразовый — остаётся в инвентаре после атаки.
export const IRIKON_DAMAGE = 35;

// Карты-ловушки (механика Блефа). Выкладываются рубашкой вверх (faceDown) на
// свою фишку через action:terrainPlace. Срабатывают, когда владельца атакуют
// первым: карта вскрывается и бьёт по нападающему, затем уходит в сброс.
// Поля эффекта (применяются в attack() через resolveDefenderTraps):
//   negateIncoming — атака защищающемуся не наносит урона (для «лечения» и блока);
//   attackerSelfDamage — нападающий теряет столько HP (без учёта брони);
//   mirror — нападающий получает урон, равный фактически нанесённому им в атаке;
//   retreatAttacker — нападающий отходит к своему старту на столько бордов;
//   dot — нападающий получает дебафф: теряет столько HP в начале КАЖДОГО своего
//         хода, пока не стряхнёт карту (dischargeMin — кубик ≥ этого в режиме split);
//   stealCard — защищающийся забирает одну карту из инвентаря нападающего;
//   purgeIngredientsMin — если нанесённый урон ≥ этого, у всех персонажей
//         нападающего по 1 карте-ингредиенту уходит в сброс;
//   consume — карта одноразовая (true → в сброс после срабатывания).
export const TRAP_CARDS = Object.freeze({
  // Гриб мухомор: нападающий снимает со своего столба 10 карт. Одноразовый.
  amanita: { attackerSelfDamage: 10, consume: true, name: 'Гриб мухомор' },
  // Кольцо возврата: весь нанесённый урон зеркально получает нападающий.
  return_ring: { mirror: true, consume: true, name: 'Кольцо возврата' },
  // Чёрные ягоды: урон первой атаки возвращается владельцу лечением (net 0).
  // Моделируем как негейт входящего урона. Одноразовая.
  black_berries: { negateIncoming: true, consume: true, name: 'Чёрные ягоды' },
  // Обычная сова: нападающий не наносит урона и отходит к своему старту на 6 бордов.
  owl_common: { negateIncoming: true, retreatAttacker: 6, consume: true, name: 'Обычная сова' },
  // Полянка мухоморов: нападающий сразу теряет 20 HP, затем по 10 в начале каждого
  // своего хода. Сброс — кубик ≥5. Карта переходит дебаффом на нападающего.
  amanita_glade: { attackerSelfDamage: 20, dot: 10, dischargeMin: 5, name: 'Полянка мухоморов' },
  // Дикие красные ягоды: нападающий теряет по 5 HP в начале каждого своего хода.
  // Сброс — кубик ≥4.
  red_berries: { dot: 5, dischargeMin: 4, name: 'Дикие красные ягоды' },
  // Ночной филин: нападающий обязан отдать одну карту из инвентаря защищающемуся.
  // (Вариант «забрать карту с поля при пустом инвентаре» — упрощён, отложен.)
  owl_night: { stealCard: true, consume: true, name: 'Ночной филин' },
  raw_ruby: { stealFromRoles: ['K', 'S'], consume: true, name: 'Необработанный рубин' },
  // Порча: если нанесённый урон ≥25, у всех персонажей нападающего по одной
  // карте-ингредиенту возвращается в сброс. Одноразовая.
  porcha: { purgeIngredientsMin: 25, consume: true, name: 'Порча' },
});

// Карты брони/щитов. Выкладываются лицом вверх (активны) на свою фишку через
// action:terrainPlace и поглощают ОБЫЧНЫЙ урон входящей атаки (кубики + Гриффон).
// Урон «без учёта защиты» (Молот Иерихон и т.п.) броню игнорирует. Многоразовые —
// не переворачиваются. absorb — сколько HP урона поглощает за атаку.
export const ARMOR_CARDS = Object.freeze({
  // Кора дерева: −5 от общего урона (версия тёмного леса сильнее — отдельная карта).
  bark: { absorb: 5, name: 'Кора дерева' },
  // Щиты/броня §16 — флэт-поглощение. Условные эффекты (защита от зверей,
  // анти-магия, блок побега, отъём оружия) пока упрощены до базового поглощения.
  chainmail_light: { absorb: 15, name: 'Лёгкая кольчуга' },
  armor_zhest:     { absorb: 15, name: 'Жест' },
  shield_lom:      { absorb: 15, name: 'Ломщит' },
  shield_kalan:    { absorb: 10, name: 'Щит Калан' },
  shield_dr:       { absorb: 20, name: 'Щит Др' },
  shield_revenge:  { absorb: 25, name: 'Щит Отмщение' },
  art_dark_forest_004: { absorb: 15, name: 'Небрежная кольчуга' },
  art_dark_forest_008: { absorb: 50, name: 'Щит защита духа' },
  art_dark_forest_034: { absorb: 50, name: 'Щит луна' },
  art_dark_forest_040: { absorb: 25, name: 'Панцирь' },
  art_recipes_004: { absorb: 10, name: 'Каска-маска' },
  art_recipes_008: { absorb: 10, name: 'Разведка' },
  helm_shem:       { absorb: 20, name: 'Шлем Шем' },
  helm_ttm:        { absorb: 25, name: 'Шлем ТТМ' },
  armor_il:        { absorb: 25, name: 'Защита Ил' },
  leather_shirt:   { absorb: 20, name: 'Кожаная рубашка' },
});

// Оружие в инвентаре. При атаке берётся ЛУЧШЕЕ по урону доступное атакующему
// (role — ограничение класса, если задано). damage — бонус к урону по врагу;
// piercing — «без учёта защиты» (игнорирует броню). Многоразовое, остаётся в руке.
// Условные эффекты §16 (по зверю/дварфу, удвоение неиспользованных кубиков) пока
// не моделируются — берётся базовый урон по игроку.
export const WEAPON_CARDS = Object.freeze({
  hammer:     { damage: 15, piercing: false, role: 'K', name: 'Молоток' },
  irikon:     { damage: IRIKON_DAMAGE, piercing: true, role: 'K', name: 'Молот Иерихон' },
  topormol:   { damage: 25, piercing: true, name: 'Топормол' },
  sword_sech: { damage: 15, piercing: true, name: 'Меч Сеч' },
  sword_lorp: { damage: 15, piercing: true, name: 'Меч Лорп' },
  axe_sun:    { damage: 50, piercing: true, name: 'Секира Красное солнце' },
  art_dark_forest_038: { damage: 15, piercing: true, name: 'Топоры близнецы' },
  art_dark_forest_020: { damage: 25, piercing: false, name: 'Деревянный молоток' },
  art_recipes_020: { damage: 10, piercing: false, name: 'Обычный посох' },
  art_recipes_021: { damage: 15, piercing: false, name: 'Посох тэрниа' },
});

// Туман войны: вражеские персонажи видны только в радиусе N клеток от своих
export const FOG_RADIUS = 5;

// Карты сгруппированы по колодам. Каждый объект: { id, deck, type, copies }
// type: 'ingredient' | 'weapon' | 'armor' | 'beast' | 'blueprint' | 'recipe' | 'special' | 'provocation'
// Базовые карты персонажей НЕ входят в общие колоды — они выдаются при старте.

export const DECKS = Object.freeze({
  // Коричневая рубашка — смешанный/грязный грунт
  MIXED: 'mixed',
  // Зелёная рубашка — лес
  FOREST: 'forest',
  // Тёмная рубашка — тёмный лес
  DARK_FOREST: 'dark_forest',
  // Зелёные точки на карте — баран (не зверь)
  SHEEP: 'sheep',
  // Красные точки — агрессия/звери
  RED: 'red',
  // Озеро (самоцветы, жабы, заклинания)
  LAKE: 'lake',
  // Только шаман
  RECIPES: 'recipes',
  // Только кузнец
  BLUEPRINTS: 'blueprints',
  // Правый нижний остров
  FAIRY_GLADE: 'fairy_glade',
});

export const CARD_CATALOG = Object.freeze([
  // --- Смешанный грунт ---
  { id: 'ore_medium',    deck: 'mixed',       type: 'ingredient',  copies: 8, name: 'Грязная смешанная железная руда' },
  { id: 'ore_coarse',    deck: 'mixed',       type: 'ingredient',  copies: 6, name: 'Грязная смешанная железная руда' },

  // --- Лес ---
  { id: 'boar_forest',   deck: 'forest',      type: 'beast',       copies: 2, name: 'Дикий кабан' },
  { id: 'beast_hide',    deck: 'forest',      type: 'ingredient',  copies: 0, name: 'Очищенная шкура зверя' },
  { id: 'raw_hide',      deck: 'forest',      type: 'ingredient',  copies: 0, name: 'Шкура убитого зверя' },
  { id: 'boar_hide',     deck: 'trophy',      type: 'ingredient',  copies: 0, name: 'Шкура кабана' },
  { id: 'wolf_hide',     deck: 'trophy',      type: 'ingredient',  copies: 0, name: 'Шкура волка' },
  { id: 'bear_hide',     deck: 'trophy',      type: 'ingredient',  copies: 0, name: 'Шкура медведя' },
  { id: 'bark',          deck: 'forest',      type: 'armor',       copies: 3, name: 'Кора дерева' },
  { id: 'gold_nugget',   deck: 'forest',      type: 'special',     copies: 2, name: 'Малый золотой самородок' },
  { id: 'amanita_color', deck: 'forest',      type: 'ingredient',  copies: 3, name: 'Мухомор цвет' },
  { id: 'amanita',       deck: 'forest',      type: 'provocation', copies: 3, name: 'Гриб мухомор' },
  { id: 'owl_common',    deck: 'forest',      type: 'provocation', copies: 2, name: 'Обычная сова',
    desc: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он не наносит урона и отходит к своему старту на 6 бордов. Одноразовая.' },
  { id: 'amanita_glade', deck: 'forest',      type: 'provocation', copies: 2, name: 'Полянка мухоморов',
    desc: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он сразу теряет 20 HP, затем по 10 в начале каждого своего хода, пока не стряхнёт карту (кубик 5+).' },
  { id: 'owl_night',     deck: 'forest',      type: 'provocation', copies: 2, name: 'Ночной филин',
    desc: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он обязан отдать вам одну карту из своего инвентаря. Одноразовая.' },

  // --- Тёмный лес ---
  { id: 'dead_ore',      deck: 'dark_forest', type: 'ingredient',  copies: 6, name: 'Неживая руда высокого качества' },
  { id: 'return_ring',   deck: 'dark_forest', type: 'provocation', copies: 2, name: 'Кольцо возврата',
    desc: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, весь его урон зеркально получает он сам. Одноразовая.' },
  { id: 'black_berries', deck: 'dark_forest', type: 'provocation', copies: 2, name: 'Чёрные ягоды',
    desc: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, весь его урон возвращается владельцу лечением. Одноразовая.' },
  { id: 'red_berries',   deck: 'dark_forest', type: 'provocation', copies: 2, name: 'Дикие красные ягоды',
    desc: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он теряет по 5 HP в начале каждого своего хода, пока не стряхнёт карту (кубик 4+).' },
  // Готовое оружие (флэт-урон, без учёта защиты; держится в руке, многоразовое).
  { id: 'topormol',      deck: 'dark_forest', type: 'weapon',      copies: 0, name: 'Топормол',
    desc: 'Оружие. Атака по врагу: −25 HP без учёта защиты. По зверю убивает сразу. Многоразовое.' },
  { id: 'sword_sech',    deck: 'dark_forest', type: 'weapon',      copies: 0, name: 'Меч Сеч',
    desc: 'Оружие. Атака по врагу: −15 HP без учёта защиты. Многоразовое.' },
  { id: 'sword_lorp',    deck: 'dark_forest', type: 'weapon',      copies: 0, name: 'Меч Лорп',
    desc: 'Оружие. Атака по врагу: −15 HP без учёта защиты. Многоразовое.' },
  // Готовые щиты/броня (флэт-поглощение; выкладываются лицом вверх на свою фишку).
  { id: 'chainmail_light', deck: 'dark_forest', type: 'armor',     copies: 0, name: 'Лёгкая кольчуга',
    desc: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 15 урона входящей атаки. Многоразовая.' },
  { id: 'shield_lom',    deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Ломщит',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 15 урона за атаку. Многоразовый.' },
  { id: 'shield_kalan',  deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Щит Калан',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 10 урона за атаку. Многоразовый.' },
  { id: 'shield_dr',     deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Щит Др',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовый.' },
  { id: 'shield_revenge', deck: 'dark_forest', type: 'armor',      copies: 0, name: 'Щит Отмщение',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовый.' },
  { id: 'helm_shem',     deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Шлем Шем',
    desc: 'Шлем. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовый.' },
  { id: 'helm_ttm',      deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Шлем ТТМ',
    desc: 'Шлем. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовый.' },
  { id: 'armor_il',      deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Защита Ил',
    desc: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовая.' },
  { id: 'leather_shirt', deck: 'dark_forest', type: 'armor',       copies: 0, name: 'Кожаная рубашка',
    desc: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовая.' },

  // --- Баран (зелёные точки) ---
  { id: 'sheep_ram',     deck: 'sheep',       type: 'beast',       copies: 2, name: 'Баран' },
  { id: 'sheep_wool',    deck: 'sheep',       type: 'ingredient',  copies: 5, name: 'Шерсть барана' },
  { id: 'sheep_hide_r',  deck: 'sheep',       type: 'ingredient',  copies: 0, name: 'Шкура барана' },
  { id: 'sheep_hide_c',  deck: 'sheep',       type: 'ingredient',  copies: 0, name: 'Кожа барана' },

  // --- Красная / Агрессия ---
  { id: 'boar_red',      deck: 'red',         type: 'beast',       copies: 2, name: 'Дикий кабан' },
  { id: 'wolf',          deck: 'red',         type: 'beast',       copies: 2, name: 'Серый волк' },
  { id: 'beast_bear',    deck: 'red',         type: 'beast',       copies: 2, name: 'Мистический зверь-медведь' },
  { id: 'hide_red',      deck: 'red',         type: 'ingredient',  copies: 0, name: 'Очищенная шкура зверя' },
  { id: 'raw_hide_red',  deck: 'red',         type: 'ingredient',  copies: 0, name: 'Шкура убитого зверя' },
  { id: 'axe_sun',       deck: 'red',         type: 'weapon',      copies: 1, name: 'Секира Красное солнце' },
  { id: 'task_irikon',   deck: 'blueprints',  type: 'special',     copies: 0, name: 'Задание на молот Ирикон' },
  { id: 'irikon',        deck: 'blueprints',  type: 'weapon',      copies: 0, name: 'Ирикон' },

  // --- Озеро ---
  { id: 'lake_frog',     deck: 'lake',        type: 'special',     copies: 1, name: 'Озёрная лягушка' },
  { id: 'raw_ruby',      deck: 'lake',        type: 'ingredient',  copies: 1, name: 'Необработанный рубин' },

  // --- Рецепты (только шаман) ---
  { id: 'recipe_armor',  deck: 'recipes',     type: 'recipe',      copies: 2, name: 'Рецепт на жест' },
  { id: 'armor_zhest',   deck: 'recipes',     type: 'armor',       copies: 0, name: 'Жест' },
  { id: 'porcha',        deck: 'recipes',     type: 'provocation', copies: 0, name: 'Порча' },
  { id: 'recipe_obrud',  deck: 'recipes',     type: 'recipe',      copies: 2, name: 'Рецепт на обруд' },
  { id: 'marvo',         deck: 'recipes',     type: 'provocation', copies: 0, name: 'Марво трос' },
  { id: 'ritual_hide',   deck: 'recipes',     type: 'special',     copies: 1, name: 'Шкура ритуалов',
    desc: 'Шаман выкладывает лицом вверх. Кубик 4+ перезаряжает использованные Бусы телепортации, после попытки Шкура ритуалов переворачивается рубашкой вверх.' },

  // --- Таинственная опушка ---
  { id: 'phoenix_1',     deck: 'fairy_glade', type: 'beast',       copies: 1, name: 'Феникс (перо к своему кузнецу)' },
  { id: 'phoenix_2',     deck: 'fairy_glade', type: 'beast',       copies: 1, name: 'Феникс (перо к кузнецу врага)' },
  // copies:0 — не входит в случайную раздачу, появляется только как трофей феникса.
  { id: 'gold_feather_own', deck: 'fairy_glade', type: 'special',  copies: 0, name: 'Золотое перо: к своему кузнецу', public: true,
    desc: 'Маяк: носитель виден всем и не телепортируется. Доставьте на свой камень кузнеца или используйте для крафта Молота Иерихон.' },
  { id: 'gold_feather_enemy', deck: 'fairy_glade', type: 'special', copies: 0, name: 'Золотое перо: к кузнецу врага', public: true,
    desc: 'Маяк: носитель виден всем и не телепортируется. Доставьте на камень кузнеца врага или используйте для крафта Молота Иерихон.' },
  // --- FULL_ART_REGISTRY_EXTRA_CARDS_START ---
  { id: "art_mixed_001", deck: "mixed", type: "ingredient", copies: 5, name: "Железная руда среднего качества" },
  { id: "art_mixed_003", deck: "mixed", type: "ingredient", copies: 1, name: "Сухой череп" },
  { id: "art_forest_003", deck: "forest", type: "ingredient", copies: 1, name: "Дубовые желуди" },
  {
    id: "art_forest_005",
    deck: "forest",
    type: "ingredient",
    copies: 1,
    name: "Полена дерева",
    desc: "Если не применять как ингредиент: выложите в драке со зверем, чтобы получать на 5 HP меньше урона. В драке с противниками ваш урон умножается на 2.",
  },
  { id: "art_forest_007", deck: "forest", type: "special", copies: 1, name: "Гнущаяся палка" },
  { id: "art_forest_011", deck: "forest", type: "ingredient", copies: 1, name: "Железная руда высшего качества" },
  { id: "art_forest_012", deck: "forest", type: "special", copies: 1, name: "Толстая ветка" },
  { id: "art_forest_016", deck: "forest", type: "special", copies: 1, name: "Ветка куста", desc: "Не применима ни к чему." },
  { id: "art_lake_001", deck: "lake", type: "ingredient", copies: 1, name: "Мраморный самоцвет",
    desc: "Если положить эту карту в драке, весь ваш урон умножается на 2 до конца текущей драки, даже если в нее подключились новые враги. Можно использовать каждый 4-й раз сброса кубиков." },
  { id: "art_lake_002", deck: "lake", type: "ingredient", copies: 1, name: "Мутный изумруд" },
  { id: "art_lake_003", deck: "lake", type: "special", copies: 1, name: "Драгоценный камень" },
  { id: "art_lake_004", deck: "lake", type: "ingredient", copies: 1, name: "Крапленый аметист" },
  { id: "art_lake_007", deck: "lake", type: "ingredient", copies: 1, name: "Проросший корень" },
  { id: "art_trophy_001", deck: "red", type: "beast", copies: 1, name: "Бурый медведь" },
  { id: "art_trophy_002", deck: "dark_forest", type: "beast", copies: 1, name: "Агрессивный бурый медведь" },
  { id: "art_dark_forest_001", deck: "dark_forest", type: "ingredient", copies: 1, name: "Средний золотой самородок" },
  { id: "art_dark_forest_002", deck: "dark_forest", type: "ingredient", copies: 1, name: "Большой золотой самородок" },
  { id: "art_dark_forest_003", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на небрежную кольчугу" },
  { id: "art_dark_forest_004", deck: "dark_forest", type: "armor", copies: 0, name: "Небрежная кольчуга" },
  { id: "art_dark_forest_005", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на легкую кольчугу" },
  { id: "art_dark_forest_007", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на щит защита духа" },
  { id: "art_dark_forest_008", deck: "dark_forest", type: "armor", copies: 0, name: "Щит защита духа" },
  { id: "art_dark_forest_009", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на щит др." },
  { id: "art_dark_forest_011", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на ломщит" },
  { id: "art_dark_forest_013", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на топормол",
    desc: "Положите чертеж на основное игровое поле рядом с Кузнецом. Грязная или смешанная железная руда - 2 карты или железная руда среднего качества - 1 карта. Толстая ветка или гнущаяся палка - 1 карта. Кузнец кидает: 2 раза 2+ или 1 раз 4+." },
  { id: "art_dark_forest_015", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на щит калан" },
  { id: "art_dark_forest_017", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на меч сеч" },
  { id: "art_dark_forest_019", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на деревянный молоток" },
  { id: "art_dark_forest_020", deck: "blueprints", type: "weapon", copies: 0, name: "Деревянный молоток" },
  { id: "art_dark_forest_021", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на красное солнце" },
  { id: "art_dark_forest_026", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на меч лорп" },
  { id: "art_dark_forest_029", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на ошейник" },
  { id: "art_dark_forest_030", deck: "dark_forest", type: "special", copies: 0, name: "Ошейник приручения" },
  { id: "art_dark_forest_031", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на щит отмщение" },
  { id: "art_dark_forest_033", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на щит луна" },
  { id: "art_dark_forest_034", deck: "dark_forest", type: "armor", copies: 0, name: "Щит луна" },
  { id: "art_dark_forest_035", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж шема" },
  { id: "art_dark_forest_037", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на рецепт близнецы" },
  { id: "art_dark_forest_038", deck: "dark_forest", type: "weapon", copies: 0, name: "Топоры близнецы" },
  { id: "art_dark_forest_039", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на панцирь" },
  { id: "art_dark_forest_040", deck: "dark_forest", type: "armor", copies: 0, name: "Панцирь" },
  { id: "art_dark_forest_041", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на шлем ТТМ" },
  { id: "art_dark_forest_043", deck: "blueprints", type: "blueprint", copies: 1, name: "Чертеж на защиту Ил" },
  { id: "recipe_sprouted_root", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на проросший корень" },
  { id: "art_recipes_003", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на каска-маска" },
  { id: "art_recipes_004", deck: "recipes", type: "armor", copies: 0, name: "Каска-маска" },
  { id: "art_recipes_005", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на рубашку из кожи" },
  { id: "art_recipes_007", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на одежду разведчика" },
  { id: "art_recipes_008", deck: "recipes", type: "armor", copies: 0, name: "Разведка" },
  { id: "art_recipes_009", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на маску трехликого" },
  { id: "art_recipes_010", deck: "recipes", type: "special", copies: 0, name: "Маска трехликого" },
  { id: "art_recipes_011", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на бубун" },
  { id: "art_recipes_012", deck: "recipes", type: "special", copies: 0, name: "Маска бубун" },
  { id: "art_recipes_013", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на маску оху" },
  { id: "art_recipes_014", deck: "recipes", type: "special", copies: 0, name: "Маска оху" },
  { id: "art_recipes_015", deck: "forest", type: "recipe", copies: 1, name: "Рецепт на малый лечебный бутыль" },
  { id: "art_recipes_016", deck: "forest", type: "special", copies: 0, name: "Малый лечебный бутыль" },
  { id: "shaman_cauldron", deck: "forest", type: "special", copies: 0, name: "Котел шамана",
    desc: "Вы можете спрятаться в этом котле, положив эту карту на основное игровое поле на фишку персонажа." },
  { id: "recipe_dil_bottle", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на бутыль дил",
    desc: "Материалы: Проросший корень или плетённый корень — 1 карта. Шаман выкладывает Ковёр шамана на игровое поле и кидает 2 кубика: 2+. После успеха Ковёр возвращается в инвентарь, рецепт открывает Бутыль дил." },
  { id: "dil_bottle", deck: "recipes", type: "special", copies: 0, name: "Бутыль дил",
    desc: "Когда вы используете эту карту, к вашему общему урону добавляется +30 до конца драки. После завершения драки карта возвращается в инвентарь. Можно применить только один раз в драке." },
  { id: "art_recipes_017", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на маску злая" },
  { id: "art_recipes_018", deck: "recipes", type: "special", copies: 0, name: "Маска злая" },
  { id: "art_recipes_019", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на обычный посох" },
  { id: "art_recipes_020", deck: "recipes", type: "weapon", copies: 0, name: "Обычный посох" },
  { id: "art_recipes_021", deck: "recipes", type: "weapon", copies: 0, name: "Посох тэрниа" },
  { id: "art_recipes_024", deck: "recipes", type: "special", copies: 0, name: "Обряд трех" },
  { id: "art_recipes_025", deck: "recipes", type: "recipe", copies: 1, name: "Рецепт на заклятие хозяин" },
  { id: "art_recipes_026", deck: "recipes", type: "special", copies: 0, name: "Заклятие хозяин" },
  { id: "art_fairy_glade_001", deck: "fairy_glade", type: "ingredient", copies: 1, name: "Редкий самоцвет" },
  { id: "art_fairy_glade_005", deck: "fairy_glade", type: "special", copies: 1, name: "Жаба ворчун",
    desc: "Заклинание. Любой персонаж может применить в схватке со зверем, чтобы завершить её победой, или против соседнего противника, чтобы отключить оружие цели до броска суммы 7+. После снятия карта возвращается владельцу." },
  // --- FULL_ART_REGISTRY_EXTRA_CARDS_END ---
]);

// Базовые (стартовые) карты персонажей. Не входят в общие колоды — выдаются
// при создании партии. Печатаются в 2 экземплярах (по одному на игрока).
// Поле `locked: true` отмечает карту-результат крафта. Такая карта не выдаётся
// на старте и появляется в инвентаре только после успешного крафта.
export const BASE_CARD_CATALOG = Object.freeze([
  // Универсальная — есть у каждого персонажа
  { id: 'teleport_beads',   role: '*', type: 'special',    copies: 1, name: 'Бусы телепортации',
    desc: 'Одноразовая. Кубик 2+ телепортирует на свой старт или фиолетовую точку. После использования карта переворачивается рубашкой вверх.' },

  // Кузнец
  { id: 'bp_hammer_base',   role: 'K', type: 'blueprint',  copies: 1, name: 'Чертёж на молоток',
    desc: 'Материалы: смешанная железная руда. Испытание: два кубика, каждый не меньше 3. Открывает Молоток.' },
  { id: 'hammer',           role: 'K', type: 'tool',       copies: 1, name: 'Молоток', locked: true,
    desc: 'Класс: кузнец. На точке добычи — взять 2 карты вне зависимости от кубика.' },

  // Помощник кузнеца
  { id: 'sack',             role: 'P', type: 'tool',       copies: 1, name: 'Мешок', locked: true,
    desc: 'На точке добычи — взять 2 карты вне зависимости от кубика.' },
  { id: 'recipe_sack',      role: 'P', type: 'recipe',     copies: 1, name: 'Рецепт на мешок',
    desc: 'Материалы: клубок ×1 + очищенная шкура барана ×1. Кубик 2 раза не менее 3. Открывает Мешок.' },

  // Воин
  { id: 'bp_club_base',     role: 'V', type: 'blueprint',  copies: 1, name: 'Чертёж на дубину',
    desc: 'Материалы: убить кабана, медведя или волка → шкуру очищает шаман → очищенной шкурой открыть Дубину.' },
  { id: 'club',             role: 'V', type: 'weapon',     copies: 1, name: 'Дубина', locked: true, public: true,
    desc: 'Класс: воин. В начале хода враг теряет 10 HP. Против зверя кубик 4+ побеждает его одной атакой.' },

  // Охотник (в исходном дизайн-доке — «Орёл», переименован в «Гриффон» по требованию заказчика)
  { id: 'griffin',          role: 'O', type: 'companion',  copies: 1, name: 'Гриффон', public: true,
    desc: 'Атака по персонажу по сумме кубиков: 2 → 10, 3 → 20, 4 → 25, 5 и больше → 30 урона. После атаки переворачивается рубашкой вверх.' },

  // Шаман
  { id: 'recipe_shaman_carpet', role: 'S', type: 'recipe', copies: 1, name: 'Рецепт на Ковёр шамана',
    desc: 'Материалы: клубок ×1 + любая шкура ×1. Кубик 1 раз не менее 3. Открывает Ковёр шамана.' },
  { id: 'shaman_carpet', role: 'S', type: 'tool', copies: 1, name: 'Ковёр шамана', locked: true,
    desc: 'В начале хода Шаман и союзники на соседних клетках получают +5 HP без верхнего ограничения. Также применяется в обрядах и изделиях по рецептам.' },

  // Ингредиент — у нескольких ролей (кузнец, помощник, шаман)
  { id: 'yarn',             role: 'K,P,S', type: 'ingredient', copies: 1, name: 'Клубок сплетённой шерсти',
    desc: 'Ингредиент обрядов и изделий.' },
]);

// Базовые карты по ролям — id, выдаются при старте. Готовые изделия сюда не
// входят: они добавляются в инвентарь только после успешного крафта.
export const BASE_CARDS = Object.freeze({
  K: ['bp_hammer_base', 'ore_medium', 'teleport_beads'],
  P: ['recipe_sack', 'sheep_ram', 'teleport_beads'],
  V: ['bp_club_base', 'teleport_beads'],
  O: ['griffin', 'teleport_beads'],
  S: ['sheep_ram', 'recipe_shaman_carpet', 'teleport_beads'],
});

// Сводный справочник: id → описание карты (общие колоды + базовые).
export const CARD_BY_ID = Object.freeze(Object.fromEntries(
  [...CARD_CATALOG, ...BASE_CARD_CATALOG].map((card) => [card.id, card]),
));
