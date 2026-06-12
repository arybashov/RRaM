// Общие константы правил RRaM. Держим отдельно от сетевого кода,
// чтобы движок правил можно было переиспользовать и менять без транспорта.

// ⚠️ ВЕРСИЯ СБОРКИ: держать В СИНХРОНЕ с APP_VERSION в prototype-web/game.js
// и ?v= в index.html. Клиент сравнивает свою версию с этой и просит обновиться.
export const BUILD_VERSION = '20260611-27';

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
  boar_red:    { damage: 5,  killOn: 4, successOn: 2, needed: 3 },
  boar_forest: { damage: 5,  killOn: 4, successOn: 2, needed: 3 },
  wolf:        { damage: 5,  killOn: 5, successOn: 2, needed: 3 },
  beast_bear:  { damage: 10, killOn: 5, successOn: 5, needed: 3 },
});

// Трофеи убитых зверей — материал для базового чертежа на дубину
// (по правилам: «убить кабана, медведя или волка»).
export const BEAST_TROPHIES = Object.freeze(['boar_red', 'boar_forest', 'wolf', 'beast_bear']);
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
  { id: 'ore_medium',    deck: 'mixed',       type: 'ingredient',  copies: 8, name: 'Железная руда среднего качества' },
  { id: 'ore_coarse',    deck: 'mixed',       type: 'provocation', copies: 6, name: 'Грубая смешанная железная руда' },

  // --- Лес ---
  { id: 'boar_forest',   deck: 'forest',      type: 'beast',       copies: 2, name: 'Дикий кабан' },
  { id: 'beast_hide',    deck: 'forest',      type: 'ingredient',  copies: 4, name: 'Очищенная шкура зверя' },
  { id: 'raw_hide',      deck: 'forest',      type: 'ingredient',  copies: 4, name: 'Шкура убитого зверя' },
  { id: 'bark',          deck: 'forest',      type: 'armor',       copies: 3, name: 'Кора дерева' },
  { id: 'gold_nugget',   deck: 'forest',      type: 'special',     copies: 2, name: 'Малый золотой самородок' },
  { id: 'amanita_color', deck: 'forest',      type: 'ingredient',  copies: 3, name: 'Мухомор цвет' },
  { id: 'amanita',       deck: 'forest',      type: 'provocation', copies: 3, name: 'Гриб мухомор' },

  // --- Тёмный лес ---
  { id: 'dead_ore',      deck: 'dark_forest', type: 'ingredient',  copies: 6, name: 'Неживая руда высокого качества' },

  // --- Баран (зелёные точки) ---
  { id: 'sheep_ram',     deck: 'sheep',       type: 'beast',       copies: 2, name: 'Боран' },
  { id: 'sheep_wool',    deck: 'sheep',       type: 'ingredient',  copies: 5, name: 'Шерсть барана' },
  { id: 'sheep_hide_r',  deck: 'sheep',       type: 'ingredient',  copies: 4, name: 'Шкура барана' },
  { id: 'sheep_hide_c',  deck: 'sheep',       type: 'ingredient',  copies: 3, name: 'Очищенная шкура барана' },

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
// Поле `locked: true` — карта-результат крафта (открывается чертежом/рецептом);
// механика крафта пока не реализована, карта выдаётся, но эффекта не несёт.
export const BASE_CARD_CATALOG = Object.freeze([
  // Универсальная — есть у каждого персонажа
  { id: 'teleport_beads',   role: '*', type: 'special',    copies: 1, name: 'Бусы телепортации',
    desc: 'Одноразовая. Бросьте один кубик не менее 2 раз — телепортируетесь на старт своей партии. Перезарядка — у шамана.' },

  // Кузнец
  { id: 'bp_hammer_base',   role: 'K', type: 'blueprint',  copies: 1, name: 'Базовый чертёж на молоток',
    desc: 'Материалы: смешанная руда + игла зверя. Кубик 2 раза не менее 3. До 4 попыток. Открывает Молоток.' },
  { id: 'hammer',           role: 'K', type: 'tool',       copies: 1, name: 'Молоток', locked: true,
    desc: 'Класс: кузнец. На точке добычи — взять 2 карты вне зависимости от кубика.' },

  // Помощник кузнеца
  { id: 'sack',             role: 'P', type: 'tool',       copies: 1, name: 'Мешок',
    desc: 'На точке добычи — взять 2 карты вне зависимости от кубика.' },
  { id: 'recipe_sack',      role: 'P', type: 'recipe',     copies: 1, name: 'Рецепт на мешок',
    desc: 'Материалы: клубок + сшивная игла. Кубик 2 раза не менее 3. Открывает Мешок.' },

  // Воин
  { id: 'bp_club_base',     role: 'V', type: 'blueprint',  copies: 1, name: 'Базовый чертёж на дубину',
    desc: 'Материалы: убить кабана, медведя или волка. Открывает Дубину.' },
  { id: 'club',             role: 'V', type: 'weapon',     copies: 1, name: 'Дубина', locked: true,
    desc: 'Класс: воин. Каждое начало хода враг теряет 10 HP без учёта брони.' },

  // Охотник (в исходном дизайн-доке — «Орёл», переименован в «Гриффон» по требованию заказчика)
  { id: 'griffin',          role: 'O', type: 'companion',  copies: 1, name: 'Гриффон',
    desc: 'HP 10. Атака по персонажу: 2 → 20, 3 → 25, 4 → 30 урона.' },

  // Шаман
  { id: 'recipe_yarn_base', role: 'S', type: 'recipe',     copies: 1, name: 'Базовый рецепт на клубок',
    desc: 'Материалы: шерсть барана. Кубик 1 раз не менее 3. Открывает Клубок.' },

  // Ингредиент — у нескольких ролей (кузнец, помощник, шаман)
  { id: 'yarn',             role: 'K,P,S', type: 'ingredient', copies: 1, name: 'Клубок',
    desc: 'Ингредиент обрядов и изделий. Каждое начало хода шаман получает +2 HP.' },
]);

// Базовые карты по ролям — id, выдаются при старте.
export const BASE_CARDS = Object.freeze({
  K: ['bp_hammer_base', 'hammer', 'yarn', 'teleport_beads'],
  P: ['sack', 'recipe_sack', 'yarn', 'teleport_beads'],
  V: ['bp_club_base', 'club', 'teleport_beads'],
  O: ['griffin', 'teleport_beads'],
  S: ['recipe_yarn_base', 'yarn', 'teleport_beads'],
});

// Сводный справочник: id → описание карты (общие колоды + базовые).
export const CARD_BY_ID = Object.freeze(Object.fromEntries(
  [...CARD_CATALOG, ...BASE_CARD_CATALOG].map((card) => [card.id, card]),
));
