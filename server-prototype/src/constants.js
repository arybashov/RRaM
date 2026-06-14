// Общие константы правил RRaM. Держим отдельно от сетевого кода,
// чтобы движок правил можно было переиспользовать и менять без транспорта.

// ⚠️ ВЕРСИЯ СБОРКИ — ЕДИНЫЙ ИСТОЧНИК. Должна совпадать с APP_VERSION в
// prototype-web/game.js и с ?v= у game.js/styles.css в index.html.
// Клиент сравнивает свою версию с этой и просит обновиться при расхождении.
// Не правьте вручную по отдельности — бампайте все разом:
//   node server-prototype/scripts/bump-version.mjs <новая-версия>
// Деплой роняет себя, если версии разъехались (scripts/check-version.mjs).
export const BUILD_VERSION = '20260614-12';

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

  // --- Тёмный лес ---
  { id: 'dead_ore',      deck: 'dark_forest', type: 'ingredient',  copies: 6, name: 'Неживая руда высокого качества' },

  // --- Баран (зелёные точки) ---
  { id: 'sheep_ram',     deck: 'sheep',       type: 'beast',       copies: 2, name: 'Баран' },
  { id: 'sheep_wool',    deck: 'sheep',       type: 'ingredient',  copies: 5, name: 'Шерсть барана' },
  { id: 'sheep_hide_r',  deck: 'sheep',       type: 'ingredient',  copies: 4, name: 'Шкура барана' },
  { id: 'sheep_hide_c',  deck: 'sheep',       type: 'ingredient',  copies: 3, name: 'Кожа барана' },

  // --- Красная / Агрессия ---
  { id: 'boar_red',      deck: 'red',         type: 'beast',       copies: 2, name: 'Дикий кабан' },
  { id: 'wolf',          deck: 'red',         type: 'beast',       copies: 2, name: 'Серый волк' },
  { id: 'beast_bear',    deck: 'red',         type: 'beast',       copies: 1, name: 'Мистический зверь-медведь' },
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

  // --- Чертежи (только кузнец) ---
  { id: 'blueprint_club',   deck: 'blueprints', type: 'blueprint', copies: 2, name: 'Чертёж на дубину' },
  { id: 'blueprint_hammer', deck: 'blueprints', type: 'blueprint', copies: 2, name: 'Чертёж на молоток' },
  { id: 'blueprint_irikon', deck: 'blueprints', type: 'blueprint', copies: 1, name: 'Чертёж Ирикон' },

  // --- Сказочная опушка ---
  { id: 'phoenix_1',     deck: 'fairy_glade', type: 'beast',       copies: 1, name: 'Феникс (перо к своему кузнецу)' },
  { id: 'phoenix_2',     deck: 'fairy_glade', type: 'beast',       copies: 1, name: 'Феникс (перо к кузнецу врага)' },
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
  { id: 'bp_hammer_base',   role: 'K', type: 'blueprint',  copies: 1, name: 'Базовый чертёж на молоток',
    desc: 'Материалы: смешанная железная руда. Испытание: два кубика, каждый не меньше 3. Открывает Молоток.' },
  { id: 'hammer',           role: 'K', type: 'tool',       copies: 1, name: 'Молоток', locked: true,
    desc: 'Класс: кузнец. На точке добычи — взять 2 карты вне зависимости от кубика.' },

  // Помощник кузнеца
  { id: 'sack',             role: 'P', type: 'tool',       copies: 1, name: 'Мешок', locked: true,
    desc: 'На точке добычи — взять 2 карты вне зависимости от кубика.' },
  { id: 'recipe_sack',      role: 'P', type: 'recipe',     copies: 1, name: 'Рецепт на мешок',
    desc: 'Материалы: клубок ×1 + очищенная шкура барана ×1. Кубик 2 раза не менее 3. Открывает Мешок.' },

  // Воин
  { id: 'bp_club_base',     role: 'V', type: 'blueprint',  copies: 1, name: 'Базовый чертёж на дубину',
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
