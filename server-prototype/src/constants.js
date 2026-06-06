// Общие константы правил RRaM. Держим отдельно от сетевого кода,
// чтобы движок правил можно было переиспользовать и менять без транспорта.

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

export const TELEPORT_CARD = 'Бусы телепортации';

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

// Базовые карты по ролям — выдаются при старте, не входят в колоды
export const BASE_CARDS = Object.freeze({
  K: ['Базовый чертёж на дубину', TELEPORT_CARD],
  P: ['Мешок', TELEPORT_CARD],
  V: ['Базовый чертёж на дубину', TELEPORT_CARD],
  O: [TELEPORT_CARD],
  S: [TELEPORT_CARD],
});
