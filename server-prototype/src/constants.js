// Общие константы правил RRaM. Держим отдельно от сетевого кода,
// чтобы движок правил можно было переиспользовать и менять без транспорта.

// ⚠️ ВЕРСИЯ СБОРКИ — ЕДИНЫЙ ИСТОЧНИК. Должна совпадать с APP_VERSION в
// prototype-web/game.js и с ?v= у game.js/styles.css в index.html.
// Клиент сравнивает свою версию с этой и просит обновиться при расхождении.
// Не правьте вручную по отдельности — бампайте все разом:
//   node server-prototype/scripts/bump-version.mjs <новая-версия>
// Деплой роняет себя, если версии разъехались (scripts/check-version.mjs).
export const BUILD_VERSION = '20260619-15';

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
  // Шаман: клубок + шкура медведя → Ковёр шамана
  shaman_carpet: {
    role: 'S',
    via: 'recipe_shaman_carpet',
    result: 'shaman_carpet',
    materials: [['yarn'], ['bear_hide']],
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
  // Irikon quest craft: blueprint + task + golden feather.
  irikon: {
    role: 'K',
    via: 'blueprint_irikon',
    result: 'irikon',
    materials: [['task_irikon'], GOLD_FEATHER_CARDS],
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
  irikon:     { damage: IRIKON_DAMAGE, piercing: true, role: 'K', name: 'Молот Иерихон' },
  topormol:   { damage: 25, piercing: true, name: 'Топормол' },
  sword_sech: { damage: 15, piercing: true, name: 'Меч Сеч' },
  sword_lorp: { damage: 15, piercing: true, name: 'Меч Лорп' },
  axe_sun:    { damage: 50, piercing: true, name: 'Секира Красное солнце' },
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
  { id: 'ore_medium',    deck: 'mixed',       type: 'ingredient',  copies: 8, name: 'Смешанная железная руда' },
  { id: 'ore_coarse',    deck: 'mixed',       type: 'provocation', copies: 6, name: 'Грубая смешанная железная руда' },

  // --- Лес ---
  { id: 'boar_forest',   deck: 'forest',      type: 'beast',       copies: 2, name: 'Дикий кабан' },
  { id: 'beast_hide',    deck: 'forest',      type: 'ingredient',  copies: 4, name: 'Очищенная шкура зверя' },
  { id: 'raw_hide',      deck: 'forest',      type: 'ingredient',  copies: 4, name: 'Шкура убитого зверя' },
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
  { id: 'topormol',      deck: 'dark_forest', type: 'weapon',      copies: 1, name: 'Топормол',
    desc: 'Оружие. Атака по врагу: −25 HP без учёта защиты. Многоразовое.' },
  { id: 'sword_sech',    deck: 'dark_forest', type: 'weapon',      copies: 1, name: 'Меч Сеч',
    desc: 'Оружие. Атака по врагу: −15 HP без учёта защиты. Многоразовое.' },
  { id: 'sword_lorp',    deck: 'dark_forest', type: 'weapon',      copies: 1, name: 'Меч Лорп',
    desc: 'Оружие. Атака по врагу: −15 HP без учёта защиты. Многоразовое.' },
  // Готовые щиты/броня (флэт-поглощение; выкладываются лицом вверх на свою фишку).
  { id: 'chainmail_light', deck: 'dark_forest', type: 'armor',     copies: 1, name: 'Лёгкая кольчуга',
    desc: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 15 урона входящей атаки. Многоразовая.' },
  { id: 'shield_lom',    deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Ломщит',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 15 урона за атаку. Многоразовый.' },
  { id: 'shield_kalan',  deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Щит Калан',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 10 урона за атаку. Многоразовый.' },
  { id: 'shield_dr',     deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Щит Др',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовый.' },
  { id: 'shield_revenge', deck: 'dark_forest', type: 'armor',      copies: 1, name: 'Щит Отмщение',
    desc: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовый.' },
  { id: 'helm_shem',     deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Шлем Шем',
    desc: 'Шлем. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовый.' },
  { id: 'helm_ttm',      deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Шлем ТТМ',
    desc: 'Шлем. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовый.' },
  { id: 'armor_il',      deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Защита Ил',
    desc: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовая.' },
  { id: 'leather_shirt', deck: 'dark_forest', type: 'armor',       copies: 1, name: 'Кожаная рубашка',
    desc: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовая.' },

  // --- Баран (зелёные точки) ---
  { id: 'sheep_ram',     deck: 'sheep',       type: 'beast',       copies: 2, name: 'Баран' },
  { id: 'sheep_wool',    deck: 'sheep',       type: 'ingredient',  copies: 5, name: 'Шерсть барана' },
  { id: 'sheep_hide_r',  deck: 'sheep',       type: 'ingredient',  copies: 4, name: 'Шкура барана' },
  { id: 'sheep_hide_c',  deck: 'sheep',       type: 'ingredient',  copies: 3, name: 'Кожа барана' },

  // --- Красная / Агрессия ---
  { id: 'boar_red',      deck: 'red',         type: 'beast',       copies: 2, name: 'Дикий кабан' },
  { id: 'wolf',          deck: 'red',         type: 'beast',       copies: 2, name: 'Серый волк' },
  { id: 'beast_bear',    deck: 'red',         type: 'beast',       copies: 2, name: 'Мистический зверь-медведь' },
  { id: 'hide_red',      deck: 'red',         type: 'ingredient',  copies: 3, name: 'Очищенная шкура зверя' },
  { id: 'raw_hide_red',  deck: 'red',         type: 'ingredient',  copies: 3, name: 'Шкура убитого зверя' },
  { id: 'axe_sun',       deck: 'red',         type: 'weapon',      copies: 1, name: 'Секира Красное солнце' },
  { id: 'task_irikon',   deck: 'red',         type: 'special',     copies: 1, name: 'Задание на молот Ирикон' },
  { id: 'irikon',        deck: 'red',         type: 'weapon',      copies: 1, name: 'Ирикон' },

  // --- Озеро ---
  { id: 'lake_frog',     deck: 'lake',        type: 'special',     copies: 1, name: 'Озёрная лягушка' },
  { id: 'raw_ruby',      deck: 'lake',        type: 'ingredient',  copies: 1, name: 'Необработанный рубин' },

  // --- Рецепты (только шаман) ---
  { id: 'recipe_armor',  deck: 'recipes',     type: 'recipe',      copies: 2, name: 'Рецепт на жест' },
  { id: 'armor_zhest',   deck: 'recipes',     type: 'armor',       copies: 2, name: 'Жест' },
  { id: 'porcha',        deck: 'recipes',     type: 'provocation', copies: 2, name: 'Порча' },
  { id: 'recipe_obrud',  deck: 'recipes',     type: 'recipe',      copies: 2, name: 'Рецепт на обруд' },
  { id: 'marvo',         deck: 'recipes',     type: 'provocation', copies: 2, name: 'Марво трос' },
  { id: 'ritual_hide',   deck: 'recipes',     type: 'special',     copies: 1, name: 'Шкура ритуалов',
    desc: 'Шаман выкладывает лицом вверх. Кубик 4+ перезаряжает использованные Бусы телепортации, после попытки Шкура ритуалов переворачивается рубашкой вверх.' },

  // --- Чертежи (только кузнец) ---
  { id: 'blueprint_irikon', deck: 'blueprints', type: 'blueprint', copies: 1, name: 'Чертёж Ирикон' },

  // --- Сказочная опушка ---
  { id: 'phoenix_1',     deck: 'fairy_glade', type: 'beast',       copies: 1, name: 'Феникс (перо к своему кузнецу)' },
  { id: 'phoenix_2',     deck: 'fairy_glade', type: 'beast',       copies: 1, name: 'Феникс (перо к кузнецу врага)' },
  // copies:0 — не входит в случайную раздачу, появляется только как трофей феникса.
  { id: 'gold_feather_own', deck: 'fairy_glade', type: 'special',  copies: 0, name: 'Золотое перо: к своему кузнецу', public: true,
    desc: 'Маяк: носитель виден всем и не телепортируется. Доставьте на свой камень кузнеца или используйте для крафта Молота Иерихон.' },
  { id: 'gold_feather_enemy', deck: 'fairy_glade', type: 'special', copies: 0, name: 'Золотое перо: к кузнецу врага', public: true,
    desc: 'Маяк: носитель виден всем и не телепортируется. Доставьте на камень кузнеца врага или используйте для крафта Молота Иерихон.' },
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
    desc: 'Материалы: клубок ×1 + шкура медведя ×1. Кубик 1 раз не менее 3. Открывает Ковёр шамана.' },
  { id: 'shaman_carpet', role: 'S', type: 'tool', copies: 1, name: 'Ковёр шамана', locked: true,
    desc: 'Каждое начало хода Шаман восстанавливает 2 HP. Также применяется в обрядах и изделиях по рецептам.' },

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
