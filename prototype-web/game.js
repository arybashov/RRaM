// RRaM Web Client — тонкий клиент, всё состояние на сервере.
// Движение пока локальное (сервер ждёт карту), кубики/карты/ходы — сервер.

// ── Конфигурация ──────────────────────────────────────────────────
function isLocalHostName(hostname) {
  return ['127.0.0.1', 'localhost', '::1'].includes(hostname);
}

const SERVER_URL = new URLSearchParams(location.search).get('server')
  ?? localStorage.getItem('rram_server')
  // Клиент, открытый с localhost, по умолчанию идёт на локальный игровой
  // сервер (ws://<host>:8788/ws). На продакшене — на удалённый.
  ?? (isLocalHostName(location.hostname)
    ? `ws://${location.hostname}:8787/ws`
    : 'wss://rram.com.ru/ws');

function isLocalDebugClient() {
  if (isLocalHostName(location.hostname)) return true;
  try {
    return isLocalHostName(new URL(SERVER_URL).hostname);
  } catch {
    return false;
  }
}

const SESSION_KEY = 'rram_session';
const FOG_ENABLED_KEY = 'rram_fog_enabled';
const TUTORIAL_ENABLED_KEY = 'rram_tutorial_enabled';
let fogEnabled = localStorage.getItem(FOG_ENABLED_KEY) !== 'false';
let tutorialEnabled = localStorage.getItem(TUTORIAL_ENABLED_KEY) !== 'false';
let serverDebugCommandsEnabled = false;
let serverLocalActionJournalEnabled = false;
let authUser = null;
let authMode = 'login';

// ── Константы ─────────────────────────────────────────────────────
const ROLE_NAMES = { K: 'Кузнец', P: 'Помощник', V: 'Воин', O: 'Охотник', S: 'Шаман' };
const DWARF_NAMES = {
  ordinary: 'Дварф',
  tank: 'Дварф-танк',
  rifle: 'Дварф с ружьём',
};
const DWARF_ART = {
  'dwarf:ordinary:1': 'dwarf-ordinary-1-v1.png',
  'dwarf:ordinary:2': 'dwarf-ordinary-2-v1.png',
  'dwarf:tank': 'dwarf-tank-v1.png',
  'dwarf:rifle:1': 'dwarf-rifle-1-v1.png',
  'dwarf:rifle:2': 'dwarf-rifle-2-v1.png',
};
const CHARACTER_ENCYCLOPEDIA = Object.freeze([
  { id: 'character_K', role: 'K', name: 'Кузнец', type: 'character', deck: 'characters', desc: 'Стартовый персонаж команды. Крафтит изделия кузнеца, использует Молоток для усиленного добора и участвует в цепочке Молота Иерихон.' },
  { id: 'character_P', role: 'P', name: 'Помощник', type: 'character', deck: 'characters', desc: 'Стартовый персонаж команды. Работает с Мешком и помогает переносить/собирать ресурсы для крафта.' },
  { id: 'character_V', role: 'V', name: 'Воин', type: 'character', deck: 'characters', desc: 'Стартовый персонаж команды. Основной боец: открывает Дубину, сражается со зверями и давит противника в ближнем бою.' },
  { id: 'character_O', role: 'O', name: 'Охотник', type: 'character', deck: 'characters', desc: 'Стартовый персонаж команды. Использует Гриффона в бою с игроками и зверями, включая Феникса.' },
  { id: 'character_S', role: 'S', name: 'Шаман', type: 'character', deck: 'characters', desc: 'Стартовый персонаж команды. Обрабатывает шкуры, создаёт Ковёр шамана и поддерживает команду лечением.' },
]);
const ENCYCLOPEDIA_RULES = Object.freeze([
  {
    title: 'Цель',
    text: 'Победите, доставив Золотое перо на камень кузнеца, или уничтожьте всех персонажей соперника.',
  },
  {
    title: 'Ход',
    text: 'В броске два кубика. Можно идти на сумму или разделить кубики на отдельные действия.',
  },
  {
    title: 'Добыча',
    text: 'На ресурсных клетках и клетках колод персонаж берёт карту соответствующей рубашки.',
  },
  {
    title: 'Опасные клетки',
    text: 'Красные клетки дают красные события и зверей. Сказочная опушка запускает схватку с Фениксом.',
  },
  {
    title: 'Бой',
    text: 'Атака по соседу тратит один свободный кубик. Оружие добавляет урон, броня поглощает, ловушки срабатывают рубашкой вверх.',
  },
  {
    title: 'Перо и Ирикон',
    text: 'Носитель пера виден всем и не телепортируется. Ирикон требует чертёж, задание и перо.',
  },
]);
const TELEPORT_ID = 'teleport_beads'; // id карты «Бусы телепортации» (сервер шлёт инвентарь как {id,name,type})
const GOLD_FEATHER_IDS = Object.freeze(['gold_feather_own', 'gold_feather_enemy']);
const GOLD_FEATHER_SET = new Set(GOLD_FEATHER_IDS);
const ROLE_ART   = { K: 'blacksmith', P: 'assistant', V: 'warrior', O: 'hunter', S: 'shaman' };
const CHAR_CARD_ART = {
  K: 'base/blacksmith/blacksmith-v1', P: 'base/assistant/assistant-v1',
  V: 'base/warrior/warrior-v3',       O: 'base/hunter/hunter-v1',
  S: 'base/shaman/shaman-v2',
};
const TOKEN_ART = {
  green: {
    K: 'blacksmith-figure-v1', P: 'assistant-figure-v1', V: 'warrior-figure-v2',
    O: 'hunter-figure-v1', S: 'shaman-figure-v1',
  },
  red: {
    K: 'blacksmith-figure-v1', P: 'assistant-figure-v1', V: 'warrior-figure-v1',
    O: 'hunter-figure-v1', S: 'shaman-figure-v1',
  },
};
const CHARACTER_NAV_ART = {
  K: 'blacksmith-v1',
  P: 'assistant-v1',
  V: 'warrior-v1',
  O: 'hunter-v1',
  S: 'shaman-v1',
};
const CARD_FACE_ART = {
  teleport_beads: 'base/common/teleport-beads-v1',
  bp_hammer_base: 'base/blacksmith/hammer-blueprint-v1',
  hammer: 'base/blacksmith/hammer-v1',
  ore_medium: 'base/blacksmith/mixed-iron-ore-v1',
  sack: 'base/assistant/sack-v1',
  recipe_sack: 'base/assistant/sack-recipe-v1',
  bp_club_base: 'base/warrior/club-blueprint-v1',
  club: 'base/warrior/club-v1',
  griffin: 'base/hunter/griffin-v1',
  sheep_ram: 'base/common/ram-v1',
  sheep_wool: 'base/common/ram-wool-v1',
  sheep_hide_r: 'base/common/ram-hide-v1',
  sheep_hide_c: 'base/common/clean-ram-hide-v1',
  recipe_shaman_carpet: 'base/shaman/shaman-carpet-recipe-v1',
  shaman_carpet: 'base/shaman/shaman-carpet-v1',
  yarn: 'base/common/yarn-v1',
  wolf: 'beasts/red/gray-wolf-v1',
  beast_bear: 'beasts/red/mystical-bear-v1',
  boar_red: 'beasts/red/wild-boar-v1',
  boar_forest: 'beasts/red/wild-boar-v1',
  boar_hide: 'materials/beast-hides/boar-hide-v1',
  wolf_hide: 'materials/beast-hides/wolf-hide-v1',
  bear_hide: 'materials/beast-hides/bear-hide-v1',
  beast_hide: 'materials/beast-hides/clean-beast-hide-v1',
  hide_red: 'materials/beast-hides/clean-beast-hide-v1',
  ore_coarse: 'mixed/ore-coarse-v1',
  raw_hide: 'forest/raw-hide-v1',
  bark: 'forest/bark-v1',
  gold_nugget: 'forest/gold-nugget-v1',
  amanita_color: 'forest/amanita-color-v1',
  amanita: 'forest/amanita-v1',
  owl_common: 'forest/common-owl-v1',
  amanita_glade: 'forest/amanita-glade-v1',
  owl_night: 'forest/night-owl-v1',
  dead_ore: 'dark-forest/dead-ore-v1',
  return_ring: 'dark-forest/return-ring-v1',
  black_berries: 'dark-forest/black-berries-v1',
  red_berries: 'dark-forest/red-berries-v1',
  topormol: 'dark-forest/topormol-v1',
  sword_sech: 'dark-forest/sword-sech-v1',
  sword_lorp: 'dark-forest/sword-lorp-v1',
  chainmail_light: 'dark-forest/light-chainmail-v1',
  shield_lom: 'dark-forest/shield-lom-v1',
  shield_kalan: 'dark-forest/shield-kalan-v1',
  shield_dr: 'dark-forest/shield-dr-v1',
  shield_revenge: 'dark-forest/shield-revenge-v1',
  helm_shem: 'dark-forest/helm-shem-v1',
  helm_ttm: 'dark-forest/helm-ttm-v1',
  armor_il: 'dark-forest/armor-il-v1',
  leather_shirt: 'dark-forest/leather-shirt-v1',
  raw_hide_red: 'red/raw-hide-red-v1',
  axe_sun: 'red/axe-sun-v1',
  task_irikon: 'red/task-irikon-v1',
  irikon: 'red/irikon-v1',
  lake_frog: 'lake/lake-frog-v1',
  raw_ruby: 'lake/raw-ruby-v1',
  recipe_armor: 'recipes/recipe-armor-v1',
  armor_zhest: 'recipes/armor-zhest-v1',
  porcha: 'recipes/porcha-v1',
  recipe_obrud: 'recipes/recipe-obrud-v1',
  marvo: 'recipes/marvo-v1',
  ritual_hide: 'recipes/ritual-hide-v1',
  blueprint_irikon: 'blueprints/blueprint-irikon-v1',
  phoenix_1: 'fairy-glade/phoenix-own-v1',
  phoenix_2: 'fairy-glade/phoenix-enemy-v1',
  gold_feather_own: 'fairy-glade/gold-feather-v1',
  gold_feather_enemy: 'fairy-glade/gold-feather-v1',
};

const CARD_USAGE_DESCRIPTIONS = Object.freeze({
  ore_medium: 'Материал для крафта. Держите у Кузнеца: вместе с чертежом Молотка и двумя кубиками 3+ открывает Молоток. Также подходит Шаману как руда для крафта Жеста.',
  ore_coarse: 'Материал для крафта Жеста. Передайте Шаману вместе с Рецептом на жест и любой подходящей шкурой; для успешного крафта нужны два кубика 3+.',
  boar_forest: 'Зверь. При встрече начинается схватка; сражайтесь кубиком через действие боя со зверем. Победа даёт шкуру кабана, которую можно очистить у Шамана.',
  beast_hide: 'Очищенная шкура зверя. Используется как готовый материал для крафта Дубины Воина и других изделий, где нужна очищенная шкура.',
  raw_hide: 'Сырая шкура зверя. Передайте Шаману и используйте обработку шкуры: кубик 2+ превращает её в очищенную шкуру зверя.',
  boar_hide: 'Трофей со зверя. Передайте Шаману и очистите кубиком 2+, затем используйте в крафте Дубины, Ковра шамана или Жеста.',
  wolf_hide: 'Трофей со зверя. Передайте Шаману и очистите кубиком 2+, затем используйте как шкуру для крафта боевых изделий.',
  bear_hide: 'Трофей со зверя. Подходит Шаману как шкура для Ковра шамана и Жеста.',
  bark: 'Броня. Выложите лицом вверх на свою фишку. Пока карта открыта, она поглощает 5 урона от входящей атаки.',
  gold_nugget: 'Лечение. Нажмите «Лечиться» в инвентаре или у активной карты на террейне: карта одноразово восстанавливает до 20 HP, но не выше 100.',
  amanita_color: 'Ингредиент. Держите как ресурс для будущих рецептов и обмена; прямого боевого действия у карты нет.',
  amanita: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он получает 10 урона, карта срабатывает один раз.',
  owl_common: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он не наносит урона и отходит к своему старту на 6 бордов. Одноразовая.',
  amanita_glade: 'Ловушка и материал. Выложите рубашкой вверх: первый атакующий враг получает 20 HP сразу и затем по 10 HP в начале хода, пока не стряхнёт кубиком 5+. Также нужна Шаману для Марво трос.',
  owl_night: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он отдаёт вам одну карту из инвентаря. Одноразовая.',
  dead_ore: 'Особый ресурс. Нажмите кнопку выбранной колоды в инвентаре или у активной карты на террейне: Неживая руда расходуется и берёт одну карту из mixed, forest, dark forest, sheep или lake. В бою не применяется.',
  return_ring: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, весь его урон отражается в него самого. Одноразовая.',
  black_berries: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, атака не наносит урона, а величина урона возвращается владельцу лечением. Одноразовая.',
  red_berries: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он получает по 5 HP урона в начале своего хода, пока не стряхнёт кубиком 4+.',
  topormol: 'Оружие. Держите в инвентаре или выложите лицом вверх: при атаке по соседнему врагу добавляет 25 урона без учёта защиты. Многоразовое.',
  sword_sech: 'Оружие. Держите в инвентаре или выложите лицом вверх: при атаке по соседнему врагу добавляет 15 урона без учёта защиты. Многоразовое.',
  sword_lorp: 'Оружие. Держите в инвентаре или выложите лицом вверх: при атаке по соседнему врагу добавляет 15 урона без учёта защиты. Многоразовое.',
  chainmail_light: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 15 урона каждой входящей атаки, пока карта активна.',
  shield_lom: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 15 урона за атаку.',
  shield_kalan: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 10 урона за атаку.',
  shield_dr: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку.',
  shield_revenge: 'Щит. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку.',
  helm_shem: 'Шлем. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку.',
  helm_ttm: 'Шлем. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку.',
  armor_il: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку.',
  leather_shirt: 'Броня. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку.',
  sheep_ram: 'Баран. Может дать шерсть и сырую шкуру барана: используйте действие Барана, кубик 3+ или накопленные два успешных удара.',
  sheep_wool: 'Материал. Передайте Шаману: из шерсти кубиком 2+ создаётся Клубок сплетённой шерсти для рецептов.',
  sheep_hide_r: 'Сырая шкура барана. Передайте Шаману и очистите кубиком 2+, чтобы получить Кожу барана для Мешка.',
  sheep_hide_c: 'Очищенная кожа барана. Нужна Помощнику вместе с Клубком и Рецептом на мешок для крафта Мешка.',
  boar_red: 'Красный зверь. При встрече начинается схватка; победите его кубиками или Дубиной Воина, чтобы получить шкуру кабана.',
  wolf: 'Красный зверь. При встрече начинается схватка; победа даёт шкуру волка, которую Шаман может использовать в крафте.',
  beast_bear: 'Сильный красный зверь. В схватке кусает больнее остальных; победа даёт шкуру медведя для рецептов Шамана.',
  hide_red: 'Очищенная красная шкура зверя. Используйте как готовую шкуру в рецептах, где требуется очищенная шкура.',
  raw_hide_red: 'Сырая красная шкура зверя. Передайте Шаману и очистите кубиком 2+, затем используйте в крафте.',
  axe_sun: 'Оружие. При атаке по соседнему врагу добавляет 50 урона без учёта защиты. Держите в инвентаре или активируйте на фишке.',
  task_irikon: 'Квестовый предмет. Передайте Кузнецу: вместе с Чертежом Ирикон и Золотым пером нужен для крафта Молота Иерихон.',
  irikon: 'Молот Иерихон. Оружие только Кузнеца: при атаке добавляет 35 урона без учёта защиты. Можно держать в инвентаре Кузнеца или выложить лицом вверх на Кузнеца.',
  lake_frog: 'Заклятие Шамана. Работает из инвентаря и активной карты на террейне. В схватке со зверем нажмите «На зверя», чтобы сразу победить. В бою с игроком нажмите «На врага», чтобы отключить оружие цели до броска суммы 8+.',
  raw_ruby: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, вы забираете карту у его Кузнеца, а если там пусто — у Шамана. Одноразовая.',
  recipe_armor: 'Рецепт Шамана. С рудой и подходящей шкурой открывает Жест; для крафта нужны два кубика 3+.',
  armor_zhest: 'Броня Шамана. Выложите лицом вверх на свою фишку. Поглощает 15 урона за атаку.',
  porcha: 'Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым и нанёс 25+ урона, у его команды сбрасываются ингредиенты. Одноразовая.',
  recipe_obrud: 'Рецепт Шамана. Вместе с Полянкой мухоморов и Озёрной лягушкой открывает Марво трос; для крафта нужны два кубика 2+.',
  marvo: 'Обряд трёх. Работает из инвентаря и активной карты на террейне. Шаман использует свободный кубик: Марво наносит значение кубика ×10 урона всем врагам рядом, если у Шамана есть активное оружие.',
  ritual_hide: 'Перезарядка Шамана. Выложите Шкуру ритуалов лицом вверх на Шамана: свободный кубик 4+ снова делает использованные Бусы телепортации доступными. После попытки карта переворачивается рубашкой вверх.',
  blueprint_irikon: 'Чертёж Кузнеца. Вместе с Заданием на молот Ирикон и Золотым пером открывает Молот Иерихон; для крафта нужны два кубика 3+.',
  phoenix_1: 'Феникс. На Сказочной опушке начинается схватка. Победите кубиком 6: Золотое перо появится для доставки к своему камню кузнеца.',
  phoenix_2: 'Феникс. На Сказочной опушке начинается схватка. Победите кубиком 6: Золотое перо появится для доставки к камню кузнеца врага.',
  gold_feather_own: 'Маяк. Носитель виден всем и не может телепортироваться. Доставьте перо на свой камень кузнеца для победы или используйте в крафте Ирикона.',
  gold_feather_enemy: 'Маяк. Носитель виден всем и не может телепортироваться. Доставьте перо на камень кузнеца врага для победы или используйте в крафте Ирикона.',
  teleport_beads: 'Одноразовый телепорт. Выберите действие Телепорт и кубик 2+: персонаж переносится на свой старт или фиолетовую точку; после использования карта переворачивается.',
  bp_hammer_base: 'Чертёж Кузнеца. Смешанная железная руда и два кубика 3+ открывают Молоток.',
  hammer: 'Инструмент Кузнеца. На точке добычи позволяет взять 2 карты вместо одной вне зависимости от значения кубика.',
  sack: 'Инструмент Помощника. На точке добычи позволяет взять 2 карты вместо одной вне зависимости от значения кубика.',
  recipe_sack: 'Рецепт Помощника. Клубок и очищенная кожа барана при двух кубиках 3+ открывают Мешок.',
  bp_club_base: 'Чертёж Воина. Очищенная шкура зверя открывает Дубину; шкуру добывают со зверя и очищают у Шамана.',
  club: 'Оружие Воина. Выложите лицом вверх на Воина: при атаке по соседнему игроку добавляет 10 HP урона за каждую активную Дубину и не переворачивается. Против зверя кубик 4+ сразу побеждает зверя.',
  griffin: 'Спутник Охотника. В атаке по игроку добавляет урон по сумме кубиков: 2 = 10, 3 = 20, 4 = 25, 5+ = 30; после атаки переворачивается.',
  recipe_shaman_carpet: 'Рецепт Шамана. Клубок и любая шкура при кубике 3+ открывают Ковёр шамана.',
  shaman_carpet: 'Инструмент Шамана. В начале хода Шаман и союзники на соседних клетках получают +5 HP без верхнего ограничения.',
  yarn: 'Материал. Создаётся Шаманом из шерсти барана кубиком 2+; нужен для Мешка, Ковра шамана и других рецептов.',
});

const CARD_CATALOG_META = Object.freeze({
  ore_medium: { deck: "mixed", type: "ingredient", copies: 8, name: "Смешанная железная руда" },
  ore_coarse: { deck: "mixed", type: "provocation", copies: 6, name: "Грубая смешанная железная руда" },
  boar_forest: { deck: "forest", type: "beast", copies: 2, name: "Дикий кабан" },
  beast_hide: { deck: "forest", type: "ingredient", copies: 4, name: "Очищенная шкура зверя" },
  raw_hide: { deck: "forest", type: "ingredient", copies: 4, name: "Шкура убитого зверя" },
  boar_hide: { deck: "trophy", type: "ingredient", copies: 0, name: "Шкура кабана" },
  wolf_hide: { deck: "trophy", type: "ingredient", copies: 0, name: "Шкура волка" },
  bear_hide: { deck: "trophy", type: "ingredient", copies: 0, name: "Шкура медведя" },
  bark: { deck: "forest", type: "armor", copies: 3, name: "Кора дерева" },
  gold_nugget: { deck: "forest", type: "special", copies: 2, name: "Малый золотой самородок" },
  amanita_color: { deck: "forest", type: "ingredient", copies: 3, name: "Мухомор цвет" },
  amanita: { deck: "forest", type: "provocation", copies: 3, name: "Гриб мухомор" },
  owl_common: { deck: "forest", type: "provocation", copies: 2, name: "Обычная сова", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он не наносит урона и отходит к своему старту на 6 бордов. Одноразовая." },
  amanita_glade: { deck: "forest", type: "provocation", copies: 2, name: "Полянка мухоморов", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он сразу теряет 20 HP, затем по 10 в начале каждого своего хода, пока не стряхнёт карту (кубик 5+)." },
  owl_night: { deck: "forest", type: "provocation", copies: 2, name: "Ночной филин", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он обязан отдать вам одну карту из своего инвентаря. Одноразовая." },
  dead_ore: { deck: "dark_forest", type: "ingredient", copies: 6, name: "Неживая руда высокого качества" },
  return_ring: { deck: "dark_forest", type: "provocation", copies: 2, name: "Кольцо возврата", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, весь его урон зеркально получает он сам. Одноразовая." },
  black_berries: { deck: "dark_forest", type: "provocation", copies: 2, name: "Чёрные ягоды", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, весь его урон возвращается владельцу лечением. Одноразовая." },
  red_berries: { deck: "dark_forest", type: "provocation", copies: 2, name: "Дикие красные ягоды", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, он теряет по 5 HP в начале каждого своего хода, пока не стряхнёт карту (кубик 4+)." },
  topormol: { deck: "dark_forest", type: "weapon", copies: 1, name: "Топормол", desc: "Оружие. Атака по врагу: −25 HP без учёта защиты. Многоразовое." },
  sword_sech: { deck: "dark_forest", type: "weapon", copies: 1, name: "Меч Сеч", desc: "Оружие. Атака по врагу: −15 HP без учёта защиты. Многоразовое." },
  sword_lorp: { deck: "dark_forest", type: "weapon", copies: 1, name: "Меч Лорп", desc: "Оружие. Атака по врагу: −15 HP без учёта защиты. Многоразовое." },
  chainmail_light: { deck: "dark_forest", type: "armor", copies: 1, name: "Лёгкая кольчуга", desc: "Броня. Выложите лицом вверх на свою фишку. Поглощает 15 урона входящей атаки. Многоразовая." },
  shield_lom: { deck: "dark_forest", type: "armor", copies: 1, name: "Ломщит", desc: "Щит. Выложите лицом вверх на свою фишку. Поглощает 15 урона за атаку. Многоразовый." },
  shield_kalan: { deck: "dark_forest", type: "armor", copies: 1, name: "Щит Калан", desc: "Щит. Выложите лицом вверх на свою фишку. Поглощает 10 урона за атаку. Многоразовый." },
  shield_dr: { deck: "dark_forest", type: "armor", copies: 1, name: "Щит Др", desc: "Щит. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовый." },
  shield_revenge: { deck: "dark_forest", type: "armor", copies: 1, name: "Щит Отмщение", desc: "Щит. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовый." },
  helm_shem: { deck: "dark_forest", type: "armor", copies: 1, name: "Шлем Шем", desc: "Шлем. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовый." },
  helm_ttm: { deck: "dark_forest", type: "armor", copies: 1, name: "Шлем ТТМ", desc: "Шлем. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовый." },
  armor_il: { deck: "dark_forest", type: "armor", copies: 1, name: "Защита Ил", desc: "Броня. Выложите лицом вверх на свою фишку. Поглощает 25 урона за атаку. Многоразовая." },
  leather_shirt: { deck: "dark_forest", type: "armor", copies: 1, name: "Кожаная рубашка", desc: "Броня. Выложите лицом вверх на свою фишку. Поглощает 20 урона за атаку. Многоразовая." },
  sheep_ram: { deck: "sheep", type: "beast", copies: 2, name: "Баран" },
  sheep_wool: { deck: "sheep", type: "ingredient", copies: 5, name: "Шерсть барана" },
  sheep_hide_r: { deck: "sheep", type: "ingredient", copies: 4, name: "Шкура барана" },
  sheep_hide_c: { deck: "sheep", type: "ingredient", copies: 3, name: "Кожа барана" },
  boar_red: { deck: "red", type: "beast", copies: 2, name: "Дикий кабан" },
  wolf: { deck: "red", type: "beast", copies: 2, name: "Серый волк" },
  beast_bear: { deck: "red", type: "beast", copies: 2, name: "Мистический зверь-медведь" },
  hide_red: { deck: "red", type: "ingredient", copies: 3, name: "Очищенная шкура зверя" },
  raw_hide_red: { deck: "red", type: "ingredient", copies: 3, name: "Шкура убитого зверя" },
  axe_sun: { deck: "red", type: "weapon", copies: 1, name: "Секира Красное солнце" },
  task_irikon: { deck: "red", type: "special", copies: 1, name: "Задание на молот Ирикон" },
  irikon: { deck: "red", type: "weapon", copies: 1, name: "Ирикон" },
  lake_frog: { deck: "lake", type: "special", copies: 1, name: "Озёрная лягушка", desc: "Только Шаман. Против зверя завершает схватку победой. Против игрока отключает оружие цели, пока цель не выбросит сумму 8+ на двух кубиках; после снятия карта возвращается Шаману." },
  raw_ruby: { deck: "lake", type: "ingredient", copies: 1, name: "Необработанный рубин", desc: "Ловушка. Выложите рубашкой вверх на свою фишку. Если враг атакует первым, вы забираете одну карту у его кузнеца; если у кузнеца пусто — у шамана. Одноразовая." },
  recipe_armor: { deck: "recipes", type: "recipe", copies: 2, name: "Рецепт на жест" },
  armor_zhest: { deck: "recipes", type: "armor", copies: 2, name: "Жест" },
  porcha: { deck: "recipes", type: "provocation", copies: 2, name: "Порча" },
  recipe_obrud: { deck: "recipes", type: "recipe", copies: 2, name: "Рецепт на обруд" },
  marvo: { deck: "recipes", type: "provocation", copies: 2, name: "Марво трос", desc: "Обряд трёх. Шаман запускает из инвентаря или активной карты на террейне: свободный кубик ×10 урона всем врагам рядом, если у Шамана есть активное оружие." },
  ritual_hide: { deck: "recipes", type: "special", copies: 1, name: "Шкура ритуалов", desc: "Шаман выкладывает лицом вверх. Кубик 4+ перезаряжает использованные Бусы телепортации; после попытки карта переворачивается рубашкой вверх." },
  blueprint_irikon: { deck: "blueprints", type: "blueprint", copies: 1, name: "Чертёж Ирикон" },
  phoenix_1: { deck: "fairy_glade", type: "beast", copies: 1, name: "Феникс (перо к своему кузнецу)" },
  phoenix_2: { deck: "fairy_glade", type: "beast", copies: 1, name: "Феникс (перо к кузнецу врага)" },
  gold_feather_own: { deck: "fairy_glade", type: "special", copies: 0, name: "Золотое перо: к своему кузнецу", desc: "Маяк: носитель виден всем и не телепортируется. Доставьте на свой камень кузнеца или используйте для крафта Молота Иерихон.", public: true },
  gold_feather_enemy: { deck: "fairy_glade", type: "special", copies: 0, name: "Золотое перо: к кузнецу врага", desc: "Маяк: носитель виден всем и не телепортируется. Доставьте на камень кузнеца врага или используйте для крафта Молота Иерихон.", public: true },
  teleport_beads: { role: "*", type: "special", copies: 1, name: "Бусы телепортации", desc: "Одноразовая. Кубик 2+ телепортирует на свой старт или фиолетовую точку. После использования карта переворачивается рубашкой вверх." },
  bp_hammer_base: { role: "K", type: "blueprint", copies: 1, name: "Чертёж на молоток", desc: "Материалы: смешанная железная руда. Испытание: два кубика, каждый не меньше 3. Открывает Молоток." },
  hammer: { role: "K", type: "tool", copies: 1, name: "Молоток", desc: "Класс: кузнец. На точке добычи — взять 2 карты вне зависимости от кубика.", locked: true },
  sack: { role: "P", type: "tool", copies: 1, name: "Мешок", desc: "На точке добычи — взять 2 карты вне зависимости от кубика.", locked: true },
  recipe_sack: { role: "P", type: "recipe", copies: 1, name: "Рецепт на мешок", desc: "Материалы: клубок ×1 + очищенная шкура барана ×1. Кубик 2 раза не менее 3. Открывает Мешок." },
  bp_club_base: { role: "V", type: "blueprint", copies: 1, name: "Чертёж на дубину", desc: "Материалы: убить кабана, медведя или волка → шкуру очищает шаман → очищенной шкурой открыть Дубину." },
  club: { role: "V", type: "weapon", copies: 1, name: "Дубина", desc: "Класс: воин. Выложите лицом вверх: атака по соседнему игроку получает +10 урона за каждую активную Дубину. После атаки не переворачивается. Против зверя кубик 4+ побеждает его одной атакой.", locked: true, public: true },
  griffin: { role: "O", type: "companion", copies: 1, name: "Гриффон", desc: "Атака по персонажу по сумме кубиков: 2 → 10, 3 → 20, 4 → 25, 5 и больше → 30 урона. После атаки переворачивается рубашкой вверх.", public: true },
  recipe_shaman_carpet: { role: "S", type: "recipe", copies: 1, name: "Рецепт на Ковёр шамана", desc: "Материалы: клубок ×1 + любая шкура ×1. Кубик 1 раз не менее 3. Открывает Ковёр шамана." },
  shaman_carpet: { role: "S", type: "tool", copies: 1, name: "Ковёр шамана", desc: "В начале хода Шаман и союзники на соседних клетках получают +5 HP без верхнего ограничения. Также применяется в обрядах и изделиях по рецептам.", locked: true },
  yarn: { role: "K,P,S", type: "ingredient", copies: 1, name: "Клубок сплетённой шерсти", desc: "Ингредиент обрядов и изделий." },
});

const MISSING_CARD_ART = Object.freeze(Object.fromEntries(
  Object.entries(CARD_CATALOG_META).filter(([cardId]) => !CARD_FACE_ART[cardId]),
));

const CARD_BACK_ART_BY_DECK = Object.freeze({
  base: 'backs/base-cards',
  mixed: 'backs/mixed-ground',
  forest: 'backs/forest',
  dark_forest: 'backs/dark-forest',
  sheep: 'backs/sheep',
  red: 'backs/red-beasts',
  lake: 'backs/lake',
  recipes: 'backs/recipes',
  blueprints: 'backs/blueprints',
  fairy_glade: 'backs/fairy-glade',
  trophy: 'backs/mixed-ground',
  unknown: 'backs/mixed-ground',
});

const CARD_DECK_BY_ID = Object.freeze({
  teleport_beads: 'base',
  bp_hammer_base: 'base',
  hammer: 'base',
  sack: 'base',
  recipe_sack: 'base',
  bp_club_base: 'base',
  club: 'base',
  griffin: 'base',
  recipe_shaman_carpet: 'base',
  shaman_carpet: 'base',
  yarn: 'base',
  ore_medium: 'mixed',
  boar_forest: 'forest',
  sheep_ram: 'sheep',
  sheep_wool: 'sheep',
  sheep_hide_r: 'sheep',
  sheep_hide_c: 'sheep',
  boar_red: 'red',
  wolf: 'red',
  beast_bear: 'red',
  hide_red: 'red',
  boar_hide: 'trophy',
  wolf_hide: 'trophy',
  bear_hide: 'trophy',
  beast_hide: 'forest',
});

const BASE_CARD_IDS = new Set([
  'teleport_beads',
  'bp_hammer_base',
  'hammer',
  'ore_medium',
  'sack',
  'recipe_sack',
  'bp_club_base',
  'club',
  'griffin',
  'sheep_ram',
  'recipe_shaman_carpet',
  'shaman_carpet',
  'yarn',
]);

function cardDeck(cardId) {
  return CARD_DECK_BY_ID[cardId] ?? CARD_CATALOG_META[cardId]?.deck ?? 'base';
}

function cardBackArt(cardId) {
  const deck = BASE_CARD_IDS.has(cardId) ? 'base' : cardDeck(cardId);
  const art = CARD_BACK_ART_BY_DECK[deck] ?? CARD_BACK_ART_BY_DECK.unknown;
  return `./assets/cards/${art}.png?v=${APP_VERSION}`;
}

function cardFaceArtUrl(art) {
  return art ? `./assets/cards/${art}.png?v=${APP_VERSION}` : null;
}

function featherMarkerUrl() {
  return `./assets/ui/feather-marker-v2.png?v=${APP_VERSION}`;
}

function cubeFaceArt(value) {
  const face = Math.max(1, Math.min(6, Number(value) || 1));
  return `./assets/cube/cube_${face - 1}.png?v=${APP_VERSION}`;
}

// Клиентский режим → серверный режим (для setMode)
const TO_SERVER_MODE = {
  moveSum:  'moveSum',
  moveDie:  'split',
  draw:     'split',
  transfer: 'split',
  teleport: 'split',
};

// ── WebSocket-состояние ───────────────────────────────────────────
let ws            = null;
let myPlayerId    = null;
let myRoomId      = null;
let mySessionToken = null;
let serverRoom    = null;   // последний state:snapshot
let autoModeSent  = false;  // флаг: setMode уже отправлен в этом броске
let pendingResume = false;  // флаг: ждём ответа на session:resume
let currentRoomId = null;   // ID комнаты для которой уже инициализированы позиции
let pendingOver   = false;  // партия завершена, но ждём конца анимации шага
let matchResultLogged = false; // итог уже записан в журнал (чтобы не дублировать)

// ── Локальное UI-состояние ────────────────────────────────────────
const positions = new Map();  // characterId → cellId (до подключения карты)
let selectedCharId = null;
let selectedDieIdx = 0;
let localMode      = 'moveSum';
let localUsedDice  = [false, false]; // трекинг хода до синхронизации движения с сервером
let pendingTeleport = null; // { characterId, toCell, dieIndex }
const eventLog     = []; // { msg: string, charId?: string, to?: string }

// ── Борд (data-driven из assets/board-map.json) ───────────────────
const cells = [];                    // [{ id, cx, cy }] в координатах viewBox
const cellById = new Map();          // id → { id, cx, cy, neighbors[] }
let boardMap = null;                 // загруженная карта (cells, starts, art, hex)
let startCellIds = new Set();        // id всех стартовых клеток
let VBW = 1000, VBH = 750;           // размер viewBox (по пропорции арта)
let HEX_R = 12;                      // радиус гекса в координатах viewBox
const STEP_MS = 140;                 // длительность одного шага фишки по клетке
const WIN_PAUSE_MS = 800;            // пауза после прихода фишки перед показом итога
const VIEW_FOCUS_ANIM_MS = 420;
const tokenDisplayPos = new Map();   // charId → клетка, где фишка показана СЕЙЧАС (во время анимации)
const animTokens = new Map();        // charId → id текущей анимации (для отмены устаревших)
const teleportedChars = new Set();   // charId, чей последний сдвиг — телепорт (прыжок, без шагов)
const svgNS = 'http://www.w3.org/2000/svg';
let scale = 1;
let boardSvg = null;
let boardVp  = null;                  // <g> вьюпорт: пан/зум применяются к нему
let eventOverlayEl = null;            // окно просмотра полученной/выложенной карты
let eventOverlayCardEl = null;
let toastContainer = null;
let view = { s: 1, tx: 0, ty: 0 };    // зум и сдвиг в координатах viewBox
let viewAnimFrame = null;
const MIN_S = 1, MAX_S = 6;
let gestureMoved = false;             // был ли drag/pinch (чтобы не считать его тапом)
const ptrs = new Map();               // активные указатели (touch/mouse)
let panStart = null, pinchStart = null;

// ── DOM ───────────────────────────────────────────────────────────
const boardEl        = document.querySelector('#board');
const charactersEl   = document.querySelector('#characters');
const characterDiceEl = document.querySelector('#characterDice');
const inventoryEl    = document.querySelector('#inventory');
const inventoryTitleEl = document.querySelector('#inventoryTitle');
const logEl          = document.querySelector('#log');
const localJournalEl = document.querySelector('#localJournal');
const guidePanelEl   = document.querySelector('#guidePanel');
const guideTurnStatusEl = document.querySelector('#guideTurnStatus');
const guideHintTitleEl = document.querySelector('#guideHintTitle');
const guideHintTextEl  = document.querySelector('#guideHintText');
const gameMessagesEl = document.querySelector('#gameMessages');
const turnInfoEl     = document.querySelector('#turnInfo');
const diceHintEl     = document.querySelector('#diceHint');
const endTurnBtn     = document.querySelector('#endTurnBtn');
const dieButtons     = [document.querySelector('#die1'), document.querySelector('#die2')];

// Лобби-DOM (создаётся динамически)
let lobbyEl, nameInput, createBtn, vsAiBtn,
    lobbyStatusEl, connBadgeEl, connRttEl, menuEl, menuBtn;
let authStatusEl = null;
let settingsEl = null;
let matchResultEl = null;
let encyclopediaEl = null;
let serverCardCatalog = null;
let settingsReturnTo = 'lobby';
let reconnectTimer = null;
let cardBoxEl = null;        // оверлей «ящик» с картами команды
let cbxDrag = null;          // активное перетаскивание: { fromId, cardIndex, ghost, srcEl }
let cbxTransferPick = null;  // передача без drag-and-drop: { fromId, cardIndex, cardName }
let cbxSuppressClick = false;
let terrainCards = new Map(); // uid → { ownerId, cardIndex, cardId, x, y, cardData }
const beastCardRects = new Map(); // characterId → положение карты зверя на поле
let invDrag = null;          // перетаскивание из инвентаря: { cardIndex, ghost, srcEl }
let invSuppressClickUntil = 0;
let approachTarget = null;      // { mineId, enemyId, until } — подход к врагу
let attackFxTargetId = null;
let attackFxTimer = null;
const characterNavHitIds = new Set();
const characterNavHitTimers = new Map();
let recentDamageLogSkips = [];
let heartbeatTimer = null;
let lastServerMsgAt = 0;
let pingSentAt = 0;         // метка времени последнего ping (для RTT)
let lastRtt = null;         // последний измеренный round-trip, мс
const HEARTBEAT_MS = 3000;  // ping каждые 3с (keepalive + живой замер RTT)
const STALE_MS = 28000;     // нет ни одного сообщения от сервера дольше → сокет мёртв

const NAME_KEY = 'rram_player_name';
const APP_VERSION = '20260621-17'; // = BUILD_VERSION (сервер) и ?v= в index.html; бампать через scripts/bump-version.mjs
const ROLL_TURN_ICON = './assets/ui/action-icons/roll-end-turn-v6.png';
const END_TURN_ICON = './assets/ui/action-icons/end-turn-v1.png';

// ── Старт ─────────────────────────────────────────────────────────
showAppVersion();
inventoryEl?.addEventListener('click', onInventoryClick);
// Игровой чат — поле в шторке журнала
{
  const gameChatInput = document.querySelector('#gameChatInput');
  const gameChatSendBtn = document.querySelector('#gameChatSend');
  const sendGameChat = () => {
    const text = gameChatInput?.value.trim();
    if (!text) return;
    wsSend('chat:send', { text, name: name() });
    gameChatInput.value = '';
    gameChatSendBtn?.classList.remove('visible');
  };
  gameChatSendBtn?.addEventListener('click', sendGameChat);
  gameChatInput?.addEventListener('input', () => {
    if (gameChatInput.value.trim()) {
      gameChatSendBtn?.classList.add('visible');
    } else {
      gameChatSendBtn?.classList.remove('visible');
    }
  });
  gameChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendGameChat(); }
  });
}
buildCardBox();
buildEventOverlay();
buildLobbyOverlay();
connect();
document.getElementById('fitBtn')?.addEventListener('click', fitAll);
document.getElementById('focusBtn')?.addEventListener('click', focusMine);
loadBoardMap().then(() => {
  buildBoard();
  requestAnimationFrame(() => {
    fitBoard();
    if (serverRoom?.game) { render(); focusMine(); }
  });
});

// Версия в углу мелким шрифтом (для отладки «какая сборка у игрока»).
function showAppVersion() {
  const el = document.createElement('div');
  el.className = 'app-version';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = `v${APP_VERSION}`;
  document.body.appendChild(el);
}

// Загрузка граф-карты (статический asset, один раз).
async function loadBoardMap() {
  try {
    const res = await fetch('./assets/board-map.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    boardMap = await res.json();
  } catch (e) {
    console.error('Не удалось загрузить карту', e);
    boardMap = { cells: [], starts: { green: {}, red: {} }, art: {}, hex: {}, editorSource: { centers: {} } };
  }
}

// ═════════════════════════════════════════════════════════════════
// WebSocket
// ═════════════════════════════════════════════════════════════════

function connect() {
  if (ws) return; // уже подключены
  clearTimeout(reconnectTimer);
  setConnStatus('connecting');
  let sock;
  try { sock = new WebSocket(SERVER_URL); }
  catch { setConnStatus('error'); scheduleReconnect(); return; }

  ws = sock;

  ws.onopen = () => {
    setConnStatus('connected');
    wsSend('client:hello', { version: APP_VERSION }); // версия клиента — для админки
    startHeartbeat();
    const saved = loadSession();
    if (saved) { pendingResume = true; wsSend('session:resume', saved); }
  };
  ws.onmessage = (e) => {
    lastServerMsgAt = Date.now(); // любое сообщение (вкл. pong) = сокет жив
    try {
      handleMsg(JSON.parse(e.data));
    } catch (error) {
      console.error('Ошибка обработки сообщения сервера:', error);
    }
  };
  ws.onclose   = () => {
    if (ws === sock) { ws = null; }
    stopHeartbeat();
    setConnStatus('disconnected');
    scheduleReconnect();
  };
  ws.onerror   = () => setConnStatus('error');
}

// Heartbeat: шлём ping; если от сервера давно тишина — сокет «полуоткрытый»
// (onclose не выстрелил), форсим переподключение вручную.
function startHeartbeat() {
  stopHeartbeat();
  lastServerMsgAt = Date.now();
  const sendPing = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastServerMsgAt > STALE_MS) {
      forceReconnect();
      return;
    }
    pingSentAt = Date.now();
    wsSend('ping');
  };
  sendPing();                                   // сразу замерить, не ждать 3с
  heartbeatTimer = setInterval(sendPing, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// Принудительный разрыв и переподключение (мёртвый сокет / ручная кнопка).
// session:resume уйдёт автоматически в onopen, партия восстановится.
function forceReconnect() {
  stopHeartbeat();
  const sock = ws;
  ws = null;
  if (sock) { try { sock.onclose = null; sock.close(); } catch {} }
  setConnStatus('connecting');
  connect();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!ws) connect();
  }, 3000);
}

// Возврат вкладки из фона / восстановление сети. Мобильная ОС при гашении
// экрана или сворачивании приложения замораживает вкладку: WebSocket подвисает,
// таймеры стоят, а onclose часто не стреляет вовремя — клиент остаётся с мёртвым
// сокетом (и RTT улетает «в космос»). На любом «пробуждении» проверяем живость
// и при сомнении форсим ЧИСТЫЙ reconnect (forceReconnect обнуляет ws, поэтому
// обходит залипание `if (ws) return` в connect).
function onResume() {
  if (document.hidden) return;
  // Нет сокета — просто подключаемся (не рвём несуществующее соединение).
  if (!ws) { connect(); return; }
  // Сокет ЕЩЁ ПОДКЛЮЧАЕТСЯ — не трогаем! На медленном мобильном коннект идёт
  // секунды, а pageshow/visibilitychange/online сыплются во время загрузки.
  // Раньше мы тут рвали CONNECTING-сокет в петле → «не заходит с телефона».
  if (ws.readyState === WebSocket.CONNECTING) return;
  pingSentAt = 0; // заброшенный ping из «до заморозки» не считаем как RTT
  const dead = ws.readyState !== WebSocket.OPEN;                     // CLOSING / CLOSED
  const idle = (Date.now() - lastServerMsgAt) > HEARTBEAT_MS + 1000; // пропущен ≥1 цикл heartbeat
  if (dead || idle) {
    forceReconnect();
  } else {
    startHeartbeat(); // сокет жив — просто свежий замер RTT
  }
}

document.addEventListener('visibilitychange', onResume);
window.addEventListener('pageshow', onResume); // восстановление из bfcache
window.addEventListener('online', onResume);   // сеть вернулась

function wsSend(type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type, payload }));
}

function handleMsg({ type, payload }) {
  switch (type) {

    case 'action:result':
      handleActionResult(payload);
      break;

    case 'chat:message':
      // Чат только в игре (room scope) — в журнал
      if (payload?.scope === 'room') {
        addLog(`💬 ${escapeHtml(payload.name ?? 'Игрок')}: ${escapeHtml(payload.text ?? '')}`, { type: 'chat' });
        renderLog();
      }
      break;

    case 'srv:ping': // серверный замер RTT — эхом возвращаем его метку времени
      wsSend('srv:pong', { t: payload?.t });
      break;

    case 'pong': // keepalive-ответ; живость отмечена в onmessage, тут считаем RTT
      if (pingSentAt) {
        const rtt = Date.now() - pingSentAt;
        pingSentAt = 0;
        // RTT в десятки секунд — это не сеть, а замороженная вкладка (мобильный
        // фон/сон): ping ушёл до заморозки, pong обработан после. Не показываем
        // «космос» — onResume уже переподключится и даст честный замер.
        if (rtt <= 15000) { lastRtt = rtt; renderRtt(); }
      }
      break;

    case 'server:connected':
      checkClientVersion(payload?.serverVersion);
      serverDebugCommandsEnabled = payload?.debugCommands === true;
      serverLocalActionJournalEnabled = payload?.localActionJournal === true;
      enforceFogAvailability();
      authUser = payload?.authUser ?? null;
      if (authUser?.displayName) localStorage.setItem(NAME_KEY, authUser.displayName);
      syncAuthUi();
      syncLocalDebugUi();
      if (Array.isArray(payload?.cardCatalog)) {
        serverCardCatalog = payload.cardCatalog;
      }
      wsSend('client:setFog', { enabled: canConfigureFog() ? fogEnabled : true });
      showLobby();
      break;

    case 'lobby:list':
      renderLobbyList(payload.rooms || []);
      break;

    case 'room:created':
      myPlayerId     = payload.playerId;
      myRoomId       = payload.roomId;
      mySessionToken = payload.sessionToken;
      saveSession({ roomId: myRoomId, sessionToken: mySessionToken });
      if (payload.vsBot) {
        setLobbyStatus('Партия против ИИ начинается…');
      } else {
        showRoomCode(payload.code);
      }
      break;

    case 'room:joined':
      myPlayerId     = payload.playerId;
      myRoomId       = payload.roomId;
      mySessionToken = payload.sessionToken;
      saveSession({ roomId: myRoomId, sessionToken: mySessionToken });
      hideLobby();
      break;

    case 'session:resumed':
      pendingResume = false;
      myPlayerId = payload.playerId;
      myRoomId   = payload.roomId;
      // Восстанавливаем логи при переподключении
      restoreFromLog();
      hideLobby();
      break;

    case 'state:snapshot': {
      const prevRoom   = serverRoom;
      const prevDice   = serverRoom?.game?.turn?.dice;
      const prevActive = serverRoom?.game?.turn?.activePlayerId;
      serverRoom = payload.room;
      syncTerrainCards();

      // Сброс локального трекинга кубиков при смене состояния
      const newDice = serverRoom?.game?.turn?.dice;
      if (!turnHasAnyDice(serverRoom?.game?.turn) || prevDice?.[0] !== newDice?.[0] || prevDice?.[1] !== newDice?.[1]) {
        localUsedDice = [false, false];
      }

      if (serverRoom.status === 'active' && serverRoom.id !== currentRoomId) {
        currentRoomId = serverRoom.id;
        if (usesServerPositions()) {
          positions.clear();
          const myWarrior = getGame()?.characters.find(
            c => c.owner === myPlayerId && c.role === 'V',
          );
          if (myWarrior) selectedCharId = myWarrior.id;
        } else {
          initPositions();
          restoreFromLog();
        }
        hideLobby();
        if (eventLog.length === 0) addLog('Партия началась!', { type: 'sys' });
        autoModeSent = false;
        requestAnimationFrame(focusMine);   // старт партии — база с окружающими путями
      } else if (serverRoom.status === 'active' && prevRoom?.game) {
        diffAndLog(prevRoom, serverRoom);
        animateMovesFromDiff(prevRoom, serverRoom);
      }

      // Авто-setMode: отправляем один раз после броска кубиков
      const g = getGame();
      if (g && !getSelChar()) {
        const nextSelectable = getMyChars().find(c => c.hp > 0 && characterPosition(c));
        selectedCharId = nextSelectable?.id ?? null;
      }
      const selForMode = getSelChar();
      const allDiceSpent = getUsedDice(selForMode?.id).every(Boolean);
      if (g && isMyTurn() && getDice(selForMode?.id) && !allDiceSpent && !getServMode(selForMode?.id) && !autoModeSent) {
        const sm = TO_SERVER_MODE[localMode];
        if (sm) { autoModeSent = true; wsSend('turn:setMode', { mode: sm, characterId: selForMode.id }); }
      }
      if (!hasAnyDice() || prevActive !== g.turn.activePlayerId) {
        autoModeSent = false;
        localMode = 'moveSum';
        selectedDieIdx = 0;
      }

      render();
      // If we queued a teleport while waiting for server to switch to split,
      // send it now when snapshot confirms split mode.
      if (pendingTeleport && getServMode(pendingTeleport.characterId) === 'split') {
        wsSend('action:teleport', pendingTeleport);
        pendingTeleport = null;
      }
      if (serverRoom?.game?.over) {
        // Фишка должна дойти и постоять, и лишь потом — итог
        if (animTokens.size > 0) pendingOver = true; // покажем после анимации
        else scheduleMatchResult();                  // анимации нет — просто пауза
      } else {
        pendingOver = false;
        matchResultLogged = false;
        hideMatchResult();
      }
      break;
    }

    case 'server:error':
      if (pendingResume) {
        // Сессия недействительна (сервер перезапустился / комната очищена) —
        // возвращаем в лобби с понятным статусом, а не зависаем «на входе».
        pendingResume = false;
        resetToLobby();
        setLobbyStatus('Сессия устарела — выберите игру заново.');
        break;
      }
      // Ошибки входа по коду — в статус лобби, не в лог игры
      if (/комната не найдена/i.test(payload.message)) {
        setLobbyStatus('Комната не найдена. Проверьте код.');
        break;
      }
      showActionWarning(payload.message);
      render();
      break;
  }
}

// ═════════════════════════════════════════════════════════════════
// Хелперы состояния
// ═════════════════════════════════════════════════════════════════

const getGame     = () => serverRoom?.game ?? null;
const isMyTurn    = () => getGame()?.turn.activePlayerId === myPlayerId;
const getDice     = (characterId = selectedCharId) => {
  const turn = getGame()?.turn;
  if (!turn) return null;
  return turn.diceByCharacter?.[characterId] ?? turn.dice ?? null;
};
const getUsedDice = (characterId = selectedCharId) => {
  const turn = getGame()?.turn;
  if (!turn) return [false, false];
  return turn.usedDiceByCharacter?.[characterId] ?? turn.usedDice ?? [false, false];
};
const turnHasAnyDice = (turn) => Boolean(
  turn?.dice || Object.keys(turn?.diceByCharacter ?? {}).length > 0,
);
const hasAnyDice = () => {
  const turn = getGame()?.turn;
  return turnHasAnyDice(turn);
};
// Режим хода — на каждого персонажа (modeByCharacter). Отсутствие записи =
// ход суммой по умолчанию (null). На глобальный turn.mode откатываемся только
// для старого сервера без modeByCharacter.
const getServMode = (characterId = selectedCharId) => {
  const turn = getGame()?.turn;
  if (!turn) return null;
  if (turn.modeByCharacter && characterId) {
    return turn.modeByCharacter[characterId] ?? null;
  }
  return turn.mode ?? null;
};

// Область движения конкретного персонажа (ноги/откат — на каждого свои). На
// глобальный turn.movementArea откатываемся только для старого сервера.
const areaFor = (characterId = selectedCharId) => {
  const turn = getGame()?.turn;
  if (!turn) return null;
  if (turn.movementAreaByCharacter && characterId) {
    return turn.movementAreaByCharacter[characterId] ?? null;
  }
  return turn.movementArea ?? null;
};

function getMyChars() {
  return getGame()?.characters.filter(c => c.owner === myPlayerId) ?? [];
}

function getSelChar() {
  if (!selectedCharId) return null;
  return getGame()?.characters.find(
    c => c.id === selectedCharId && c.hp > 0 && characterPosition(c),
  ) ?? null;
}

function showActionWarning(message) {
  if (!message) return;
  showToast(`⚠ ${message}`, 'error');
  addLog(`⚠ ${message}`, { type: 'err' });
}

function syncTerrainCards() {
  terrainCards = new Map(
    (getGame()?.terrainCards ?? []).map((entry) => [
      entry.id,
      {
        ownerId: entry.ownerId,
        characterId: entry.characterId,
        cardIndex: entry.cardIndex,
        faceDown: entry.faceDown,
        cardId: entry.card?.id,
        x: entry.x,
        y: entry.y,
        cardData: entry.card,
      },
    ]),
  );
}

function selectCharacter(charId) {
  const char = getGame()?.characters.find(c => c.id === charId);
  if (!char || char.owner !== myPlayerId) return;
  // Режим следует за выбранным персонажем: split не «прилипает» с прошлого.
  // По умолчанию у нового персонажа — ход суммой; split только если он реально
  // в split (свой override / уже начатая раздельная нога). teleport не трогаем.
  if (char.id !== selectedCharId && localMode !== 'teleport') {
    localMode = getServMode(char.id) === 'split' ? 'moveDie' : 'moveSum';
  }
  selectedCharId = char.id;
  render();
}

function selectCharacterDie(characterId, dieIndex) {
  const char = getGame()?.characters.find(c => c.id === characterId);
  if (!char || char.owner !== myPlayerId) return;
  if (!isMyTurn()) return;
  const dice = getDice(char.id);
  if (!dice) return;
  const used = getUsedDice(char.id);
  const area = areaFor(char.id); // область движения именно этого персонажа

  // Есть незавершённое движение этого персонажа → клик по кубику = откат / смена ноги.
  if (area && !area.locked) {
    const activeDie = area.mode === 'split' ? area.dieIndex : null;
    if (area.mode === 'moveSum' || dieIndex === activeDie || used[dieIndex]) {
      wsSend('turn:resetMove', { characterId: area.characterId });
      return;
    }
    // Другой свободный кубик → выбрать его для второй ноги (поле покажет render).
    selectedCharId = char.id;
    selectedDieIdx = dieIndex;
    localMode = 'moveDie';
    render();
    return;
  }

  // Движения ещё нет. Клик по кубику включает ручной сплит на нём; повторный клик
  // по тому же кубику (пока ничего не потрачено) — выключает, возвращая ход суммой.
  const wasSelected = selectedCharId === char.id;
  if (used[dieIndex]) {
    selectedCharId = char.id;
    selectedDieIdx = dieIndex;
    render();
    return;
  }
  const canToggleOff = wasSelected
    && !used[0] && !used[1]
    && localMode === 'moveDie'
    && selectedDieIdx === dieIndex
    && getServMode(char.id) === 'split';
  selectedCharId = char.id;
  if (canToggleOff) {
    setLocalMode('moveSum');
    wsSend('turn:setMode', { mode: 'moveSum', characterId: char.id });
  } else {
    selectedDieIdx = dieIndex;
    setLocalMode('moveDie');
    if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });
  }
  render();
}

function getSelDieVal() {
  const dice = getDice(selectedCharId); if (!dice) return null;
  const dieIndex = firstFreeDieIndexFor(selectedCharId);
  return dieIndex == null ? null : dice[dieIndex];
}

function charSide(char) {
  return serverRoom?.players.find(p => p.id === char.owner)?.side ?? 'green';
}

function tokenArtHref(char) {
  const side = charSide(char);
  const art = TOKEN_ART[side]?.[char.role] ?? TOKEN_ART.green.V;
  return `./assets/tokens/${side}/${art}.png`;
}

function dwarfArtHref(unit) {
  const art = DWARF_ART[unit.id] ?? DWARF_ART['dwarf:ordinary:1'];
  return `./assets/tokens/dwarves/${art}?v=${APP_VERSION}`;
}

function characterNavArtHref(char) {
  const art = CHARACTER_NAV_ART[char.role] ?? CHARACTER_NAV_ART.V;
  return `./assets/ui/character-icons/${art}.png`;
}

function usesServerPositions() {
  return getGame()?.positionAuthority === 'server-v1';
}

function characterPosition(char) {
  return usesServerPositions() ? char?.position : positions.get(char?.id);
}

function isResourceCell(cellId) {
  const cell = cellById.get(cellId)
    ?? boardMap?.cells?.find(item => item.id === cellId);
  return cell?.terrain === 'resource' || Boolean(cell?.deck && cell.deck !== 'fairy_glade');
}

function canDrawWithCharacter(char) {
  return Boolean(char && isResourceCell(characterPosition(char)));
}

function hasCharacterDrawnThisTurn(characterId) {
  return (getGame()?.turn.drawnCharacterIdsThisTurn ?? []).includes(characterId);
}

function drawableCharacters() {
  return getMyChars().filter(canDrawWithCharacter);
}

function activeMovementCharacter() {
  // Незавершённое движение теперь у каждого персонажа своё: сперва смотрим
  // выбранного, иначе — любой свой персонаж с открытой (не залоченной) областью.
  const selArea = areaFor(selectedCharId);
  if (selArea && !selArea.locked) {
    const c = getGame()?.characters.find(c => c.id === selArea.characterId && c.owner === myPlayerId);
    if (c) return c;
  }
  const map = getGame()?.turn.movementAreaByCharacter ?? {};
  for (const [charId, area] of Object.entries(map)) {
    if (!area || area.locked) continue;
    const c = getGame()?.characters.find(c => c.id === charId && c.owner === myPlayerId);
    if (c) return c;
  }
  return null;
}

function getDrawCharacter(preferred = getSelChar()) {
  const moving = activeMovementCharacter();
  if (canDrawWithCharacter(moving)) return moving;
  if (canDrawWithCharacter(preferred)) return preferred;
  return preferred;
}

function plannedResourceDraw(preferred = getSelChar()) {
  const g = getGame();
  // Работает в любом режиме (в т.ч. moveSum) — сервер теперь отдаёт одиночную
  // дальность по каждому кубику. Считаем план «дойти одним кубиком до ресурса,
  // взять карту вторым» именно по ОДИНОЧНОЙ дальности, а не по сумме.
  if (!hasAnyDice()) return null;
  const chars = preferred ? [preferred] : getMyChars();
  for (const char of chars) {
    if (!char || char.owner !== myPlayerId || char.hp <= 0) continue;
    if (areaFor(char.id)) continue; // у этого персонажа уже идёт движение
    if (hasCharacterDrawnThisTurn(char.id)) continue;
    const dice = getDice(char.id);
    const used = getUsedDice(char.id);
    if (!dice) continue;
    for (const moveDieIndex of [0, 1]) {
      const drawDieIndex = moveDieIndex === 0 ? 1 : 0;
      if (used[moveDieIndex] || used[drawDieIndex]) continue;
      const targets = g.legalTargets?.dice?.[moveDieIndex]?.[char.id] ?? [];
      const resourceCell = targets.find(isResourceCell);
      if (resourceCell) return { character: char, moveDieIndex, drawDieIndex, cellId: resourceCell };
    }
  }
  return null;
}

function hasDrawOpportunity(preferred = getSelChar()) {
  return canDrawWithCharacter(getDrawCharacter(preferred)) || Boolean(plannedResourceDraw(preferred));
}

// Свободный кубик «завис» после автосплита/добора: движение зафиксировано
// (область залочена) и персонаж уже добрал — ходить и добирать им нельзя.
// Гасим такой кубик визуально, чтобы он не выглядел доступным.
function dieStranded(characterId = selectedCharId) {
  const area = areaFor(characterId);
  return Boolean(area?.locked) && hasCharacterDrawnThisTurn(characterId);
}

function drawDieIndex(characterId = selectedCharId) {
  const g = getGame();
  if (!getDice(characterId)) return null;
  const used = getUsedDice(characterId);
  const area = areaFor(characterId);
  if (area && !area.locked) {
    if (area.mode === 'split') {
      return used[0] ? (used[1] ? null : 1) : 0;
    }
    return null;
  }
  return firstFreeDieIndexFor(characterId);
}

function isDieIndex(index) {
  return index === 0 || index === 1;
}

function firstFreeDieIndexFor(characterId = selectedCharId) {
  const used = getUsedDice(characterId);
  if (isDieIndex(selectedDieIdx) && !used[selectedDieIdx]) return selectedDieIdx;
  if (!used[0]) return 0;
  if (!used[1]) return 1;
  return null;
}

function moveDieIndexForTarget(char, targetId) {
  if (!char || !targetId) return null;
  const used = getUsedDice(char.id);
  const legalDice = getGame()?.legalTargets?.dice ?? {};
  const preferred = isDieIndex(selectedDieIdx)
    ? [selectedDieIdx, 1 - selectedDieIdx]
    : [0, 1];
  for (const dieIndex of preferred) {
    if (!isDieIndex(dieIndex) || used[dieIndex]) continue;
    const targets = legalDice?.[dieIndex]?.[char.id] ?? [];
    if (targets.includes(targetId)) return dieIndex;
  }
  return null;
}

function effectiveMoveMode(characterId = selectedCharId) {
  return localMode === 'moveSum' && getServMode(characterId) === 'split'
    ? 'moveDie'
    : localMode;
}

function carriesGoldFeather(char) {
  return Boolean(goldFeatherCardId(char));
}

function goldFeatherCardId(char) {
  return char?.inventory?.map(card => card.id ?? card).find(cardId => GOLD_FEATHER_SET.has(cardId)) ?? null;
}

// ═════════════════════════════════════════════════════════════════
// Позиции (локальные, до карты заказчика)
// ═════════════════════════════════════════════════════════════════

// Легаси (локальные позиции до серверной карты). При серверной карте не
// вызывается; оставлено как безопасная заглушка.
function initPositions() {
  positions.clear();
  const myWarrior = getGame()?.characters.find(c => c.owner === myPlayerId && c.role === 'V');
  if (myWarrior) selectedCharId = myWarrior.id;
}

// ═════════════════════════════════════════════════════════════════
// Лобби
// ═════════════════════════════════════════════════════════════════

function buildLobbyOverlay() {
  lobbyEl = document.createElement('div');
  lobbyEl.id = 'lobby';
  lobbyEl.innerHTML = `
    <div class="lobby-card">

      <!-- Вид: главный экран -->
      <div class="lobby-view" id="viewHome">
        <div class="lobby-logo">RRaM</div>
        <div class="lobby-version">сборка v${APP_VERSION}</div>
        <p class="lobby-sub">Настольная игра онлайн</p>
        <div id="lobbyStatus" class="lobby-status"></div>
        <section id="authPanel" class="lobby-auth" aria-label="Аккаунт">
          <div id="authSignedOut" class="auth-signed-out">
            <div class="auth-title">Аккаунт</div>
            <div class="auth-mode-tabs" role="tablist" aria-label="Режим входа">
              <button id="authModeLogin" class="active" type="button">Вход</button>
              <button id="authModeRegister" type="button">Регистрация</button>
            </div>
            <div class="auth-fields">
              <input id="authLogin" type="text" placeholder="Логин" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false" />
              <input id="authEmail" class="hidden" type="email" placeholder="Почта" maxlength="254" autocomplete="email" autocapitalize="off" spellcheck="false" />
              <input id="authPassword" type="password" placeholder="Пароль" maxlength="128" autocomplete="current-password" />
            </div>
            <div class="auth-actions">
              <button id="authSubmitBtn" type="button">Войти</button>
            </div>
          </div>
          <div id="authSignedIn" class="auth-signed-in hidden">
            <div>
              <div class="auth-title">Вы вошли</div>
              <div id="authUserName" class="auth-user-name"></div>
            </div>
            <button id="authLogoutBtn" type="button">Выйти</button>
          </div>
          <div id="authStatus" class="auth-status"></div>
        </section>
        <input id="playerName" type="text" placeholder="Ваше имя" maxlength="32" autocomplete="off" />
        <div id="lobbyList" class="lobby-list">
          <div class="lobby-list-title">Открытые игры</div>
          <div id="lobbyListItems" class="lobby-list-items"></div>
        </div>
        <div class="lobby-btns">
          <button id="createBtn">Создать партию</button>
          <button id="vsAiBtn" class="lobby-vsai-btn">Против ИИ</button>
        </div>
        <div id="codeDisplay" class="lobby-code hidden">
          <span class="lobby-code-hint">Ожидание второго игрока — партия видна в списке</span>
          <button id="cancelWaitBtn" class="lobby-cancel-btn">Отменить ожидание</button>
        </div>
        <div class="lobby-bottom-row">
          <button id="settingsBtn" class="lobby-link-btn">⚙ Настройки</button>
          <button id="reconnectBtn" class="lobby-link-btn hidden">⟳ Переподключиться</button>
        </div>
      </div>


    </div>
  `;
  document.body.appendChild(lobbyEl);

  nameInput     = lobbyEl.querySelector('#playerName');
  createBtn     = lobbyEl.querySelector('#createBtn');
  vsAiBtn       = lobbyEl.querySelector('#vsAiBtn');
  lobbyStatusEl = lobbyEl.querySelector('#lobbyStatus');
  authStatusEl  = lobbyEl.querySelector('#authStatus');

  // Восстановить сохранённое имя
  nameInput.value = localStorage.getItem(NAME_KEY) || '';
  nameInput.addEventListener('input', () => localStorage.setItem(NAME_KEY, nameInput.value.trim()));
  lobbyEl.querySelector('#authModeLogin').addEventListener('click', () => setAuthMode('login'));
  lobbyEl.querySelector('#authModeRegister').addEventListener('click', () => setAuthMode('register'));
  lobbyEl.querySelector('#authSubmitBtn').addEventListener('click', () => submitAuth(authMode));
  lobbyEl.querySelector('#authLogoutBtn').addEventListener('click', logoutAuth);
  lobbyEl.querySelector('#authPassword').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitAuth(authMode); }
  });
  lobbyEl.querySelector('#authEmail').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitAuth('register'); }
  });
  setAuthMode('login');
  syncAuthUi();

  createBtn.addEventListener('click', () => {
    if (!ws) { connect(); setLobbyStatus('Подключение… попробуйте ещё раз через секунду.'); return; }
    wsSend('room:create', { playerName: name(), public: true });
  });
  vsAiBtn.addEventListener('click', () => {
    if (!ws) { connect(); setLobbyStatus('Подключение… попробуйте ещё раз через секунду.'); return; }
    wsSend('room:create', { playerName: name(), vsBot: true });
  });
  lobbyEl.querySelector('#cancelWaitBtn').addEventListener('click', cancelWaitingRoom);

  // Настройки — открывают отдельный оверлей
  lobbyEl.querySelector('#settingsBtn').addEventListener('click', () => openSettings('lobby'));

  const reconnectBtn = lobbyEl.querySelector('#reconnectBtn');
  reconnectBtn.addEventListener('click', forceReconnect);

  // Значок соединения, счётчик RTT и кнопка меню — в правой части шапки
  const tbRight = document.querySelector('.topbar .tb-right');
  connRttEl = document.createElement('span');
  connRttEl.id = 'connRtt';
  connRttEl.className = 'conn-rtt';
  connRttEl.title = 'Задержка до сервера (round-trip)';
  tbRight.appendChild(connRttEl);
  connBadgeEl = document.createElement('span');
  connBadgeEl.id = 'connBadge';
  tbRight.appendChild(connBadgeEl);

  // Кнопка меню (видна только во время игры)
  menuBtn = document.createElement('button');
  menuBtn.id = 'menuBtn';
  menuBtn.textContent = '☰';
  menuBtn.classList.add('hidden', 'topbar-menu-btn');
  menuBtn.setAttribute('aria-label', 'Меню');
  tbRight.appendChild(menuBtn);
  menuBtn.addEventListener('click', showGameMenu);

  // Сворачиваемая шторка «Журнал · Инвентарь»
  const sheetHandle = document.querySelector('#sheetHandle');
  sheetHandle?.addEventListener('click', () => {
    const sheet = document.querySelector('#sheet');
    const open = sheet.classList.toggle('open');
    sheetHandle.setAttribute('aria-expanded', String(open));
  });

  buildGameMenu();
  buildSettingsOverlay();
  buildEncyclopediaOverlay();
  buildMatchResultOverlay();
}

function showLobbyView(view) {
  lobbyEl.querySelectorAll('.lobby-view').forEach(el => el.classList.add('hidden'));
  lobbyEl.querySelector(`#view${view.charAt(0).toUpperCase() + view.slice(1)}`).classList.remove('hidden');
  if (view === 'settings') {
    lobbyEl.querySelector('#settingsName').value = localStorage.getItem(NAME_KEY) || '';
    lobbyEl.querySelector('#settingsServer').value = localStorage.getItem('rram_server') || '';
  }
}

function resetLobby() {
  showLobbyView('home');
  setLobbyStatus('');
  lobbyEl.querySelector('#viewHome').classList.remove('is-waiting');
  lobbyEl.querySelector('#codeDisplay').classList.add('hidden');
  lobbyEl.querySelector('#lobbyList').classList.remove('hidden');
  createBtn.disabled = false;
  vsAiBtn.disabled   = false;
}

// ── Игровое меню (пауза) ──────────────────────────────────────────

function buildGameMenu() {
  menuEl = document.createElement('div');
  menuEl.id = 'gameMenu';
  menuEl.classList.add('hidden');
  menuEl.innerHTML = `
    <div class="menu-card">
      <div class="menu-title">Меню</div>
      <button id="menuResumeBtn">▶ Продолжить игру</button>
      <button id="menuReconnectBtn" class="ghost">⟳ Переподключиться</button>
      <button id="menuEncyclopediaBtn" class="ghost">▣ Энциклопедия</button>
      <button id="menuNewBtn" class="ghost">🚪 Выйти в лобби</button>
      <button id="menuSettingsBtn" class="ghost">⚙ Настройки</button>
    </div>
  `;
  document.body.appendChild(menuEl);

  menuEl.querySelector('#menuResumeBtn').addEventListener('click', hideGameMenu);

  // Ручное восстановление, если у игрока всё «подвисло» (мёртвый сокет/стейт)
  menuEl.querySelector('#menuReconnectBtn').addEventListener('click', () => {
    hideGameMenu();
    forceReconnect();
  });

  menuEl.querySelector('#menuEncyclopediaBtn').addEventListener('click', () => {
    hideGameMenu();
    openEncyclopedia();
  });

  menuEl.querySelector('#menuNewBtn').addEventListener('click', () => {
    const active = serverRoom?.game && !serverRoom.game.over;
    if (active && !confirm('Выйти из игры?\nСопернику будет засчитана победа.')) return;
    if (myRoomId) wsSend('room:leave'); // уведомить сервер и соперника
    resetToLobby();
  });

  menuEl.querySelector('#menuSettingsBtn').addEventListener('click', () => {
    hideGameMenu();
    openSettings('game');
  });
}

function showGameMenu() { menuEl.classList.remove('hidden'); }
function hideGameMenu() { menuEl.classList.add('hidden'); }

function resetToLobby() {
  hideGameMenu();
  hideMatchResult();
  clearCharacterNavHitEffects();
  clearSession();
  pendingResume = false;
  serverRoom = null;
  myPlayerId = null;
  myRoomId = null;
  mySessionToken = null;
  currentRoomId = null;
  positions.clear();
  selectedCharId = null;
  localUsedDice = [false, false];
  pendingTeleport = null;
  eventLog.length = 0;
  resetLobby();
  showLobby();
  render();
}

function buildMatchResultOverlay() {
  matchResultEl = document.createElement('div');
  matchResultEl.id = 'matchResult';
  matchResultEl.classList.add('hidden');
  matchResultEl.innerHTML = `
    <div class="match-result-card">
      <div id="matchResultTitle" class="match-result-title"></div>
      <p id="matchResultText" class="match-result-text"></p>
      <button id="matchResultNewBtn">Новая партия</button>
      <button id="matchResultCloseBtn" class="ghost">Посмотреть поле</button>
    </div>
  `;
  document.body.appendChild(matchResultEl);
  matchResultEl.querySelector('#matchResultNewBtn').addEventListener('click', resetToLobby);
  matchResultEl.querySelector('#matchResultCloseBtn').addEventListener('click', hideMatchResult);
}

function showMatchResult() {
  const game = getGame();
  if (!matchResultEl || !game?.over) return;
  const won = game.winnerId === myPlayerId;
  const winner = serverRoom?.players.find(player => player.id === game.winnerId)?.name;
  matchResultEl.querySelector('#matchResultTitle').textContent = won ? 'Победа' : 'Поражение';
  matchResultEl.querySelector('#matchResultText').textContent = winner
    ? `Партия завершена. Победитель: ${winner}.`
    : 'Партия завершена.';
  matchResultEl.classList.toggle('is-win', won);
  matchResultEl.classList.toggle('is-loss', !won);
  matchResultEl.classList.remove('hidden');
}

function hideMatchResult() {
  matchResultEl?.classList.add('hidden');
}

function buildEncyclopediaOverlay() {
  encyclopediaEl = document.createElement('div');
  encyclopediaEl.id = 'encyclopediaOverlay';
  encyclopediaEl.classList.add('hidden');
  encyclopediaEl.innerHTML = `
    <div class="encyclopedia-panel">
      <div class="encyclopedia-head">
        <div>
          <div class="encyclopedia-title">Энциклопедия</div>
          <div class="encyclopedia-count" id="encyclopediaCount"></div>
        </div>
        <button id="encyclopediaClose" class="cardbox-close" aria-label="Закрыть">✕</button>
      </div>
      <div class="encyclopedia-grid" id="encyclopediaGrid"></div>
    </div>
  `;
  document.body.appendChild(encyclopediaEl);
  encyclopediaEl.querySelector('#encyclopediaClose').addEventListener('click', closeEncyclopedia);
  encyclopediaEl.addEventListener('click', (e) => {
    if (e.target === encyclopediaEl) {
      closeEncyclopedia();
      return;
    }
    const grantBtn = e.target.closest('.encyclopedia-grant-card');
    if (grantBtn && encyclopediaEl.contains(grantBtn)) {
      e.stopPropagation();
      debugGrantCardFromEncyclopedia(grantBtn.dataset.cardId);
      return;
    }
    const card = e.target.closest('.encyclopedia-card-toggle');
    if (!card || !encyclopediaEl.contains(card)) return;
    card.closest('.encyclopedia-card')?.classList.toggle('is-flipped');
  });
}

function openEncyclopedia() {
  if (!encyclopediaEl) buildEncyclopediaOverlay();
  const cardEntries = Array.isArray(serverCardCatalog) && serverCardCatalog.length
    ? serverCardCatalog
    : Object.entries(CARD_CATALOG_META).map(([id, meta]) => ({ id, ...meta }));
  encyclopediaEl.querySelector('#encyclopediaCount').textContent = `${CHARACTER_ENCYCLOPEDIA.length} персонажей · ${cardEntries.length} карт`;
  encyclopediaEl.querySelector('#encyclopediaGrid').innerHTML = renderEncyclopediaSections(cardEntries);
  encyclopediaEl.classList.remove('hidden');
}

function closeEncyclopedia() {
  encyclopediaEl?.classList.add('hidden');
}

function renderEncyclopediaSections(cardEntries) {
  return `<section class="encyclopedia-section encyclopedia-section-rules">`
    + `<div class="encyclopedia-section-title">Правила</div>`
    + `<div class="encyclopedia-rules-grid">${ENCYCLOPEDIA_RULES.map(renderEncyclopediaRule).join('')}</div>`
    + `</section>`
    + `<section class="encyclopedia-section encyclopedia-section-characters">`
    + `<div class="encyclopedia-section-title">Персонажи</div>`
    + `<div class="encyclopedia-section-grid encyclopedia-character-grid">${CHARACTER_ENCYCLOPEDIA.map(renderEncyclopediaCharacter).join('')}</div>`
    + `</section>`
    + `<section class="encyclopedia-section encyclopedia-section-cards">`
    + `<div class="encyclopedia-section-title">Карты</div>`
    + `<div class="encyclopedia-section-grid">${cardEntries.map(renderEncyclopediaCard).join('')}</div>`
    + `</section>`
    + `<section class="encyclopedia-section encyclopedia-section-cookbook">`
    + `<div class="encyclopedia-section-title">Поваренная книга</div>`
    + `<div class="encyclopedia-cookbook-grid">${Object.entries(CRAFT_RECIPES).map(renderCookbookRecipe).join('')}</div>`
    + `</section>`;
}

function renderEncyclopediaRule(rule) {
  return `<article class="encyclopedia-rule">`
    + `<div class="encyclopedia-rule-title">${escapeHtml(rule.title)}</div>`
    + `<p>${escapeHtml(rule.text)}</p>`
    + `</article>`;
}

function renderEncyclopediaCharacter(character) {
  return `<article class="encyclopedia-card encyclopedia-character role-${cardClassToken(character.role)}">`
    + `<button class="encyclopedia-card-toggle" type="button" aria-label="Перевернуть ${escapeHtml(character.name)}">`
    +   `<span class="encyclopedia-face encyclopedia-face-front encyclopedia-character-face"><img src="${charCardArt(character.role)}" alt="${escapeHtml(character.name)}" draggable="false" /></span>`
    +   `<span class="encyclopedia-face encyclopedia-face-back"><img src="${cardBackArt('teleport_beads')}" alt="" draggable="false" /></span>`
    + `</button>`
    + `<div class="encyclopedia-card-body">`
    +   `<div class="encyclopedia-card-name">${escapeHtml(character.name)}</div>`
    +   `<div class="encyclopedia-card-meta">Персонаж · ${escapeHtml(character.role)} · 100 HP</div>`
    +   `<p>${escapeHtml(character.desc)}</p>`
    +   `<code>${escapeHtml(character.id)}</code>`
    + `</div>`
    + `</article>`;
}

function renderEncyclopediaCard(card) {
  const meta = cardVisualMeta(card);
  const typeLabel = CARD_TYPE_LABELS[meta.type] ?? meta.type;
  const deckLabel = CARD_DECK_LABELS[meta.deck] ?? meta.deck;
  const desc = cardDescription(card, deckLabel, typeLabel);
  const copies = Number.isFinite(card.copies) ? card.copies : null;
  const role = card.role && card.role !== '*' ? ` · ${escapeHtml(card.role)}` : '';
  const copiesLabel = copies === 0 ? 'трофей/событие' : copies === null ? '' : `${copies} шт.`;
  const grantButton = canDebugGrantCards()
    ? `<button class="encyclopedia-grant-card" type="button" data-card-id="${escapeHtml(card.id)}">Взять</button>`
    : '';
  return `<article class="encyclopedia-card card-${cardClassToken(meta.type)} deck-${cardClassToken(meta.deck)}">`
    + `<button class="encyclopedia-card-toggle" type="button" aria-label="Перевернуть ${escapeHtml(meta.name)}">`
    +   `<span class="encyclopedia-face encyclopedia-face-front">${renderCardFace(meta, 'gallery')}</span>`
    +   `<span class="encyclopedia-face encyclopedia-face-back"><img src="${cardBackArt(card.id)}" alt="" draggable="false" /></span>`
    + `</button>`
    + `<div class="encyclopedia-card-body">`
    +   `<div class="encyclopedia-card-name">${escapeHtml(meta.name)}</div>`
    +   `<div class="encyclopedia-card-meta">${escapeHtml(deckLabel)} · ${escapeHtml(typeLabel)}${role}${copiesLabel ? ` · ${escapeHtml(copiesLabel)}` : ''}</div>`
    +   `<p>${escapeHtml(desc)}</p>`
    +   grantButton
    +   `<code>${escapeHtml(card.id)}</code>`
    + `</div>`
    + `</article>`;
}

function renderCookbookRecipe([item, recipe]) {
  const role = ROLE_NAMES[recipe.role] ?? recipe.role;
  const via = getCardName(recipe.via);
  const result = getCardName(recipe.result);
  const materialText = recipe.materials.length
    ? recipe.materials
        .map((slot) => slot.map(getCardName).join(' или '))
        .join(' + ')
    : 'без материалов';
  const dice = recipe.diceCount
    ? recipe.diceCount === 2
      ? `2 кубика, каждый ${recipe.diceMin}+`
      : `1 кубик ${recipe.diceMin}+`
    : 'без броска';
  return `<article class="cookbook-recipe">`
    + `<div class="cookbook-recipe-name">${escapeHtml(recipe.label)}</div>`
    + `<div class="cookbook-recipe-meta">${escapeHtml(role)} · ${escapeHtml(dice)}</div>`
    + `<div class="cookbook-flow">`
    + `<span>${escapeHtml(via)}</span>`
    + `<b>+</b>`
    + `<span>${escapeHtml(materialText)}</span>`
    + `<b>→</b>`
    + `<span>${escapeHtml(result)}</span>`
    + `</div>`
    + `<code>${escapeHtml(item)}</code>`
    + `</article>`;
}

function debugGrantCardFromEncyclopedia(cardId) {
  if (!canDebugGrantCards()) {
    showActionWarning('Отладочная выдача карт отключена.');
    return;
  }
  const character = getSelChar();
  if (!getGame() || !myPlayerId) {
    showActionWarning('Сначала начните партию.');
    return;
  }
  if (!character || character.owner !== myPlayerId) {
    showActionWarning('Сначала выберите своего персонажа.');
    return;
  }
  wsSend('debug:grantCard', { characterId: character.id, cardId });
}

function canDebugGrantCards() {
  return serverDebugCommandsEnabled && isLocalDebugClient();
}

function canUseLocalActionJournal() {
  return serverLocalActionJournalEnabled && isLocalDebugClient();
}

function canConfigureFog() {
  return serverDebugCommandsEnabled && isLocalDebugClient();
}

function enforceFogAvailability() {
  if (!canConfigureFog()) {
    fogEnabled = true;
    localStorage.setItem(FOG_ENABLED_KEY, 'true');
  }
}

function syncLocalDebugUi() {
  const debugJournalEnabled = canUseLocalActionJournal();
  document.body.classList.toggle('local-debug', debugJournalEnabled);
  if (localJournalEl) localJournalEl.hidden = !debugJournalEnabled;
  const fogToggle = settingsEl?.querySelector('#setFogToggle');
  if (fogToggle) fogToggle.hidden = !canConfigureFog();
  if (guidePanelEl) {
    guidePanelEl.hidden = false;
    guidePanelEl.classList.toggle('tutorial-disabled', !tutorialEnabled);
  }
  if (debugJournalEnabled) {
    renderLog();
  }
  renderGuidePanel();
}

function currentGuideHint() {
  const game = getGame();
  if (!game) {
    return {
      title: 'Начните партию',
      text: 'Создайте игру или подключитесь к комнате. Подсказки будут появляться здесь по ходу партии.',
    };
  }
  if (game.over) {
    return {
      title: 'Партия завершена',
      text: 'Можно начать новую игру через меню.',
    };
  }
  if (!isMyTurn()) {
    return {
      title: 'Ход соперника',
      text: 'Дождитесь своего хода. Важные события будут появляться игровыми сообщениями.',
    };
  }
  if (!hasAnyDice()) {
    return {
      title: 'Бросьте кубики',
      text: 'Нажмите кнопку кубиков справа. После броска каждый персонаж получит свои очки хода.',
    };
  }

  const selected = getSelChar();
  if (!selected) {
    return {
      title: 'Выберите персонажа',
      text: 'Нажмите портрет снизу, затем выберите клетку или действие.',
    };
  }
  const selectedName = ROLE_NAMES[selected.role] ?? 'Персонаж';
  if (selected.beastFight) {
    return {
      title: `${selectedName}: бой со зверем`,
      text: 'Выберите свободный кубик и ударьте зверя. Если есть подходящая карта, можно применить ее из инвентаря.',
    };
  }
  if (localMode === 'transfer') {
    return {
      title: 'Передача карт',
      text: 'Откройте ящик карт и перетащите карту к нужному персонажу. Через своих можно передавать ресурсы для крафта.',
    };
  }
  if (localMode === 'teleport') {
    return {
      title: 'Телепорт',
      text: carriesGoldFeather(selected)
        ? 'Персонаж с Золотым пером не может телепортироваться.'
        : 'Выберите стартовую или фиолетовую точку. Для телепорта нужен свободный кубик 2+.',
    };
  }

  const area = areaFor(selected.id);
  if (area && !area.locked) {
    return {
      title: `${selectedName}: движение выбрано`,
      text: 'Кликните выбранную клетку еще раз, чтобы подтвердить, или выберите другой свободный кубик.',
    };
  }

  const craftHint = currentCraftGuideHint(selected);
  if (craftHint) return craftHint;

  const drawn = hasCharacterDrawnThisTurn(selected.id);
  const drawReady = canDrawWithCharacter(getDrawCharacter(selected));
  const drawDie = drawDieIndex(selected.id);
  if (!drawn && drawReady && drawDie != null) {
    return {
      title: 'Можно взять карту',
      text: 'Нажмите кнопку карты справа. Добор потратит один свободный кубик и завершит выбор клетки.',
    };
  }
  if (!drawn && plannedResourceDraw(selected)) {
    return {
      title: 'Можно дойти до ресурса',
      text: 'Поставьте фишку на ресурсную клетку одним кубиком, затем нажмите кнопку карты вторым кубиком.',
    };
  }

  const dice = getDice(selected.id);
  const used = getUsedDice(selected.id);
  if (dice && used.some(v => !v)) {
    return {
      title: `${selectedName}: выберите действие`,
      text: 'Кликните доступную клетку, атакуйте цель рядом или выберите действие справа. Очки кубика нельзя передать другому персонажу.',
    };
  }
  return {
    title: 'Завершите ход',
    text: 'У выбранного персонажа кубики потрачены. Выберите другого персонажа или нажмите кнопку конца хода.',
  };
}

function cardLabel(id) {
  return CARD_CATALOG_META[id]?.name ?? getCardName(id);
}

function inventoryIds(char) {
  return (char?.inventory ?? []).map(card => card.id ?? card);
}

function hasInventoryCard(char, cardId) {
  return inventoryIds(char).includes(cardId);
}

function slotLabel(slot) {
  return slot.map(cardLabel).join(' или ');
}

function recipeMaterialsText(recipe) {
  return recipe.materials.length
    ? recipe.materials.map(slotLabel).join(' + ')
    : 'без материалов';
}

function recipeDiceText(recipe) {
  if (!recipe.diceCount) return 'без проверки кубиком';
  if (recipe.diceCount === 2) return `два свободных кубика, каждый ${recipe.diceMin}+`;
  return `один свободный кубик ${recipe.diceMin}+`;
}

function craftDiceReady(char, recipe) {
  if (!recipe.diceCount) return true;
  const dice = getDice(char.id);
  const used = getUsedDice(char.id);
  if (!dice) return false;
  if (recipe.diceCount === 2) return !used[0] && !used[1];
  return !used[0] || !used[1];
}

function craftStatusForCharacter(char, item, recipe) {
  const ids = inventoryIds(char);
  const hasVia = ids.includes(recipe.via);
  const missingMaterials = recipe.materials
    .filter(slot => !slot.some(id => ids.includes(id)))
    .map(slotLabel);
  const hasSomeMaterial = recipe.materials.some(slot => slot.some(id => ids.includes(id)));
  const ready = hasVia && missingMaterials.length === 0;
  return {
    item,
    recipe,
    hasVia,
    hasSomeMaterial,
    ready,
    diceReady: ready && craftDiceReady(char, recipe),
    missingMaterials,
  };
}

function craftStatusesForCharacter(char) {
  if (!char) return [];
  return Object.entries(CRAFT_RECIPES)
    .filter(([, recipe]) => recipe.role === char.role)
    .map(([item, recipe]) => craftStatusForCharacter(char, item, recipe));
}

function currentCraftGuideHint(char) {
  const statuses = craftStatusesForCharacter(char);
  const characterName = ROLE_NAMES[char?.role] ?? 'Персонаж';
  const readyNow = statuses.find(status => status.ready && status.diceReady);
  if (readyNow) {
    return {
      title: `Можно крафтить: ${readyNow.recipe.label}`,
      text: `${characterName} собрал ${cardLabel(readyNow.recipe.via)} и материалы. Нажмите кнопку крафта в инвентаре. Проверка: ${recipeDiceText(readyNow.recipe)}.`,
    };
  }
  const readyNeedsDice = statuses.find(status => status.ready);
  if (readyNeedsDice) {
    return {
      title: `Крафт подготовлен: ${readyNeedsDice.recipe.label}`,
      text: `Материалы уже у ${characterName}. Нужен бросок: ${recipeDiceText(readyNeedsDice.recipe)}.`,
    };
  }
  const hasRecipe = statuses.find(status => status.hasVia && status.missingMaterials.length > 0);
  if (hasRecipe) {
    return {
      title: `Рецепт: ${hasRecipe.recipe.label}`,
      text: `Для крафта не хватает: ${hasRecipe.missingMaterials.join(', ')}. Материалы можно передать через ящик карт.`,
    };
  }
  const hasMaterials = statuses.find(status => !status.hasVia && status.hasSomeMaterial);
  if (hasMaterials) {
    return {
      title: `Нужен рецепт: ${hasMaterials.recipe.label}`,
      text: `Материалы уже начинают собираться. Нужна карта «${cardLabel(hasMaterials.recipe.via)}». Рецепты и чертежи смотрите в Энциклопедии: Поваренная книга.`,
    };
  }
  if (char?.role === 'S') {
    const rawHide = (char.inventory ?? []).find(card => RAW_HIDE_IDS.includes(card.id));
    if (rawHide && isMyTurn() && firstFreeDieIndexFor(char.id) != null) {
      return {
        title: 'Шаман может обработать шкуру',
        text: `В инвентаре есть «${rawHide.name ?? cardLabel(rawHide.id)}». Кубик 2+ превращает сырую шкуру в материал для рецептов.`,
      };
    }
  }
  return null;
}

function recipesUsingCard(cardId) {
  return Object.entries(CRAFT_RECIPES)
    .filter(([, recipe]) =>
      recipe.via === cardId
      || recipe.materials.some(slot => slot.includes(cardId)));
}

function tutorialTextForCard(card) {
  const id = card?.id ?? card?.card;
  if (!id) return null;
  const recipeEntries = recipesUsingCard(id);
  if (recipeEntries.length) {
    const asVia = recipeEntries.find(([, recipe]) => recipe.via === id);
    const [, recipe] = asVia ?? recipeEntries[0];
    if (asVia) {
      return `«${cardLabel(id)}» открывает «${recipe.label}». Нужны материалы: ${recipeMaterialsText(recipe)}; проверка: ${recipeDiceText(recipe)}.`;
    }
    return `«${cardLabel(id)}» используется для «${recipe.label}». Нужен ${cardLabel(recipe.via)}; остальные материалы: ${recipeMaterialsText(recipe)}.`;
  }
  const meta = cardVisualMeta(card);
  if (meta.type === 'recipe' || meta.type === 'blueprint') {
    return `«${meta.name}» — карта крафта. Откройте Энциклопедию → Поваренная книга, там видно цепочку материалов.`;
  }
  if (meta.type === 'armor') {
    return `«${meta.name}» лучше выложить лицом вверх на персонажа: активная защита снижает входящий урон.`;
  }
  if (meta.type === 'provocation') {
    return `«${meta.name}» чаще всего работает как ловушка: выложите рубашкой вверх, чтобы враг не видел карту до атаки.`;
  }
  if (meta.type === 'weapon' || meta.type === 'companion') {
    return `«${meta.name}» усиливает атаку. Проверьте описание карты и держите её у подходящего персонажа.`;
  }
  if (GOLD_FEATHER_SET.has(id)) {
    return `Носитель Золотого пера виден всем и не телепортируется. Доставьте его на нужный камень кузнеца или используйте для Ирикона.`;
  }
  return null;
}

function pushCardTutorial(card) {
  const text = tutorialTextForCard(card);
  if (text) pushTutorialMessage(text);
}

function renderGuidePanel() {
  if (!guidePanelEl || !guideHintTitleEl || !guideHintTextEl) return;
  guidePanelEl.classList.toggle('tutorial-disabled', !tutorialEnabled);
  if (guideTurnStatusEl) guideTurnStatusEl.textContent = currentGuideTurnStatus();
  if (!tutorialEnabled) return;
  const hint = currentGuideHint();
  guideHintTitleEl.textContent = hint.title;
  guideHintTextEl.textContent = hint.text;
}

function currentGuideTurnStatus() {
  const game = getGame();
  if (!game) return 'Ожидание партии';
  if (game.over) return 'Партия завершена';
  const activePlayer = serverRoom?.players?.find(player => player.id === game.turn.activePlayerId);
  if (game.turn.activePlayerId === myPlayerId) return 'Ходит: вы';
  return `Ходит: ${activePlayer?.name ?? 'соперник'}`;
}

function normalizeGuideMessageType(type) {
  if (type === 'success' || type === 'danger' || type === 'error' || type === 'info' || type === 'hint') return type;
  return 'info';
}

function pushGameMessage(text, type = 'info') {
  if (!gameMessagesEl) return false;
  const message = String(text ?? '').trim();
  if (!message) return true;
  if (guidePanelEl) guidePanelEl.hidden = false;
  const el = document.createElement('div');
  const safeType = normalizeGuideMessageType(type);
  el.className = `guide-message guide-message-${safeType}`;
  el.textContent = message;
  gameMessagesEl.prepend(el);
  while (gameMessagesEl.children.length > 5) {
    gameMessagesEl.lastElementChild?.remove();
  }
  setTimeout(() => el.remove(), 6500);
  return true;
}

function pushTutorialMessage(text, type = 'hint') {
  if (!tutorialEnabled) return false;
  return pushGameMessage(`Подсказка: ${text}`, type);
}

function textFromHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html ?? '');
  return tmp.textContent?.trim() ?? '';
}

function cardDescription(card, deckLabel, typeLabel) {
  if (card.desc) return card.desc;
  if (CARD_USAGE_DESCRIPTIONS[card.id]) return CARD_USAGE_DESCRIPTIONS[card.id];
  if (card.locked) return `Закрытая карта типа «${typeLabel}». Открывается через крафт или специальное правило.`;
  if (card.copies === 0) return `Особая карта типа «${typeLabel}»: не входит в случайный добор и появляется как трофей или событие.`;
  if (card.role) {
    const role = card.role === '*' ? 'любого персонажа' : `ролей ${card.role}`;
    return `Базовая карта для ${role}. Тип: ${typeLabel}.`;
  }
  return `Карта колоды «${deckLabel}». Тип: ${typeLabel}. Количество в каталоге: ${card.copies}.`;
}

function renderCardFace(card, size = 'inventory') {
  const art = CARD_FACE_ART[card.id];
  return art
    ? `<img class="inventory-card-art generated-card-${cardClassToken(size)}" src="${cardFaceArtUrl(art)}" alt="${escapeHtml(card.name)}" draggable="false" />`
    : renderGeneratedCardArt(card, size);
}

// Пауза «фишка постояла» и затем итог (если партия всё ещё завершена).
function scheduleMatchResult() {
  setTimeout(() => { if (serverRoom?.game?.over) revealMatchResult(); }, WIN_PAUSE_MS);
}

// Показать итог партии (с записью в журнал один раз). Вызывается после паузы:
// сразу (если хода-анимации не было) либо по завершении анимации шага.
function revealMatchResult() {
  pendingOver = false;
  if (!serverRoom?.game?.over) return;
  showMatchResult();
  if (!matchResultLogged) {
    matchResultLogged = true;
    const won = serverRoom.game.winnerId === myPlayerId;
    addLog(won ? 'Партия завершена: вы победили.' : 'Партия завершена: победил соперник.', {
      type: won ? 'my' : 'opp',
    });
    renderLog();
  }
}

// ── Настройки (отдельный оверлей, не зависит от лобби) ───────────


function buildSettingsOverlay() {
  settingsEl = document.createElement('div');
  settingsEl.id = 'settingsOverlay';
  settingsEl.classList.add('hidden');
  settingsEl.innerHTML = `
    <div class="settings-card">
      <div class="settings-title">Настройки</div>
      <label class="lobby-label">Имя игрока
        <input id="setName" type="text" maxlength="32" autocomplete="off" />
      </label>
      <label class="lobby-label">Адрес сервера
        <input id="setServer" type="text" autocomplete="off" />
      </label>
      <p class="lobby-label-hint">Оставьте пустым — основной сервер rram.com.ru. Можно указать другой адрес (например, запасной).</p>
      <label id="setFogToggle" class="settings-toggle">
        <input id="setFogEnabled" type="checkbox" />
        <span>
          <strong>Туман войны</strong>
          <small>Скрывает карту и противников вне зоны видимости.</small>
        </span>
      </label>
      <label class="settings-toggle">
        <input id="setTutorialEnabled" type="checkbox" />
        <span>
          <strong>Обучение</strong>
          <small>Показывает постоянные подсказки слева сверху. Игровые сообщения остаются включены.</small>
        </span>
      </label>
      <div class="lobby-btns">
        <button id="setSaveBtn">Сохранить</button>
        <button id="setBackBtn" class="ghost">← Назад</button>
      </div>
    </div>
  `;
  document.body.appendChild(settingsEl);

  settingsEl.querySelector('#setSaveBtn').addEventListener('click', () => {
    const n = settingsEl.querySelector('#setName').value.trim();
    const s = settingsEl.querySelector('#setServer').value.trim();
    fogEnabled = canConfigureFog() ? settingsEl.querySelector('#setFogEnabled').checked : true;
    tutorialEnabled = settingsEl.querySelector('#setTutorialEnabled').checked;
    if (n) { localStorage.setItem(NAME_KEY, n); if (nameInput) nameInput.value = n; }
    if (s) localStorage.setItem('rram_server', s);
    else   localStorage.removeItem('rram_server');
    localStorage.setItem(FOG_ENABLED_KEY, String(fogEnabled));
    localStorage.setItem(TUTORIAL_ENABLED_KEY, String(tutorialEnabled));
    wsSend('client:setFog', { enabled: canConfigureFog() ? fogEnabled : true });
    syncLocalDebugUi();
    renderBoard();
    closeSettings('Настройки сохранены.');
  });

  settingsEl.querySelector('#setBackBtn').addEventListener('click', () => closeSettings());
}

function openSettings(from) {
  settingsReturnTo = from;
  enforceFogAvailability();
  settingsEl.querySelector('#setName').value   = localStorage.getItem(NAME_KEY) || '';
  settingsEl.querySelector('#setServer').value = localStorage.getItem('rram_server') || '';
  settingsEl.querySelector('#setFogEnabled').checked = fogEnabled;
  settingsEl.querySelector('#setTutorialEnabled').checked = tutorialEnabled;
  syncLocalDebugUi();
  settingsEl.classList.remove('hidden');
}

function closeSettings(statusMsg) {
  settingsEl.classList.add('hidden');
  if (settingsReturnTo === 'lobby') {
    if (statusMsg) setLobbyStatus(statusMsg);
  } else {
    // Вернуться в игру — ничего не показываем
  }
}

const name = () => authUser?.displayName || nameInput?.value.trim() || localStorage.getItem(NAME_KEY) || 'Игрок';

function showLobby()  {
  lobbyEl.classList.remove('hidden');
  menuBtn?.classList.add('hidden');
  wsSend('lobby:subscribe'); // получать список открытых игр (no-op если сокет не открыт)
}
function hideLobby()  {
  lobbyEl.classList.add('hidden');
  menuBtn?.classList.remove('hidden');
  wsSend('lobby:unsubscribe');
}

// ── Проверка версии клиент/сервер ─────────────────────────────────
// Частая беда: у игрока закэширована старая сборка и «ничего не работает».
// Сервер сообщает свою версию при подключении; при расхождении блокируем
// лобби баннером и просим обновиться (один авто-релоад с обходом кэша).
let versionMismatch = false;

function checkClientVersion(serverVersion) {
  if (!serverVersion || serverVersion === APP_VERSION) {
    versionMismatch = false;
    document.getElementById('versionBanner')?.remove();
    return;
  }
  versionMismatch = true;
  // Авто-релоад один раз на каждую серверную версию (без бесконечного цикла)
  const key = 'rram_reloaded_for';
  if (sessionStorage.getItem(key) !== serverVersion) {
    sessionStorage.setItem(key, serverVersion);
    hardReload();
    return;
  }
  showVersionBanner(serverVersion);
}

// Перезагрузка с обходом кэша: меняем query документа → браузер тянет свежий
// index.html (а с ним новые ?v= для game.js/styles.css). Параметр ?server= храним.
function hardReload() {
  const url = new URL(location.href);
  url.searchParams.set('_v', String(Date.now()));
  location.replace(url.toString());
}

function showVersionBanner(serverVersion) {
  let el = document.getElementById('versionBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'versionBanner';
    el.className = 'version-banner';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <span>⚠ Версия игры устарела — обновите страницу.
      <b>У вас v${APP_VERSION}, на сервере v${escapeHtml(serverVersion)}</b></span>
    <button id="versionReloadBtn">⟳ Обновить</button>`;
  el.querySelector('#versionReloadBtn').addEventListener('click', hardReload);
  // На старом клиенте партия всё равно сломается — блокируем старт
  if (createBtn) createBtn.disabled = true;
  if (vsAiBtn) vsAiBtn.disabled = true;
}

// Режим ожидания второго игрока (вход — только из списка открытых игр)
function showRoomCode() {
  lobbyEl.querySelector('#viewHome').classList.add('is-waiting');
  lobbyEl.querySelector('#codeDisplay').classList.remove('hidden');
  lobbyEl.querySelector('#lobbyList').classList.add('hidden');
  createBtn.disabled = true;
  vsAiBtn.disabled   = true;
  setLobbyStatus('Ожидание второго игрока…');
}

function cancelWaitingRoom() {
  clearSession();
  myPlayerId = null;
  myRoomId = null;
  serverRoom = null;
  currentRoomId = null;
  positions.clear();
  selectedCharId = null;
  resetLobby();

  stopHeartbeat();
  const socket = ws;
  ws = null;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }
  connect();
}

function setLobbyStatus(text) {
  if (lobbyStatusEl) lobbyStatusEl.textContent = text;
}

function syncAuthUi() {
  if (!lobbyEl) return;
  const signedOut = lobbyEl.querySelector('#authSignedOut');
  const signedIn = lobbyEl.querySelector('#authSignedIn');
  const userName = lobbyEl.querySelector('#authUserName');
  const isAuthed = Boolean(authUser);
  signedOut?.classList.toggle('hidden', isAuthed);
  signedIn?.classList.toggle('hidden', !isAuthed);
  if (userName) {
    userName.textContent = authUser ? `${authUser.displayName} (@${authUser.login})` : '';
  }
  if (nameInput) {
    nameInput.disabled = isAuthed;
    nameInput.classList.toggle('is-auth-name', isAuthed);
    if (authUser?.displayName) nameInput.value = authUser.displayName;
  }
}

function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const isRegister = authMode === 'register';
  lobbyEl?.querySelector('#authEmail')?.classList.toggle('hidden', !isRegister);
  lobbyEl?.querySelector('#authModeLogin')?.classList.toggle('active', !isRegister);
  lobbyEl?.querySelector('#authModeRegister')?.classList.toggle('active', isRegister);
  const submitBtn = lobbyEl?.querySelector('#authSubmitBtn');
  if (submitBtn) submitBtn.textContent = isRegister ? 'Зарегистрироваться' : 'Войти';
  const passwordInput = lobbyEl?.querySelector('#authPassword');
  if (passwordInput) passwordInput.autocomplete = isRegister ? 'new-password' : 'current-password';
  setAuthStatus('');
}

async function submitAuth(mode) {
  const loginInput = lobbyEl?.querySelector('#authLogin');
  const emailInput = lobbyEl?.querySelector('#authEmail');
  const passwordInput = lobbyEl?.querySelector('#authPassword');
  const login = loginInput?.value.trim() ?? '';
  const email = emailInput?.value.trim() ?? '';
  const password = passwordInput?.value ?? '';
  const displayName = nameInput?.value.trim() || login;
  if (!login || !password) {
    setAuthStatus('Введите логин и пароль.', 'error');
    return;
  }
  if (mode === 'register' && !email) {
    setAuthStatus('Введите почту для регистрации.', 'error');
    return;
  }

  setAuthBusy(true);
  setAuthStatus(mode === 'register' ? 'Регистрируем...' : 'Входим...');
  try {
    const requestBody = {
      login,
      password,
      displayName,
    };
    if (mode === 'register') requestBody.email = email;
    const result = await authFetch(mode === 'register' ? '/auth/register' : '/auth/login', requestBody);
    authUser = result.user ?? null;
    if (authUser?.displayName) localStorage.setItem(NAME_KEY, authUser.displayName);
    if (passwordInput) passwordInput.value = '';
    syncAuthUi();
    setAuthStatus(authUser ? 'Готово.' : '');
    forceReconnect();
  } catch (error) {
    setAuthStatus(error.message || 'Ошибка входа.', 'error');
  } finally {
    setAuthBusy(false);
  }
}

async function logoutAuth() {
  setAuthBusy(true);
  setAuthStatus('Выходим...');
  try {
    await authFetch('/auth/logout', {});
    authUser = null;
    syncAuthUi();
    setAuthStatus('');
    forceReconnect();
  } catch (error) {
    setAuthStatus(error.message || 'Не удалось выйти.', 'error');
  } finally {
    setAuthBusy(false);
  }
}

function setAuthBusy(busy) {
  lobbyEl?.querySelectorAll('#authPanel button, #authPanel input').forEach((el) => {
    el.disabled = busy;
  });
  if (!busy) syncAuthUi();
}

function setAuthStatus(text, tone = '') {
  if (!authStatusEl) return;
  authStatusEl.textContent = text;
  authStatusEl.classList.toggle('is-error', tone === 'error');
}

async function authFetch(path, body = null) {
  const options = {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(`${authHttpBase()}${path}`, options);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data ?? {};
}

function authHttpBase() {
  const url = new URL(SERVER_URL);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

// Список открытых игр в лобби (приходит пушем по 'lobby:list').
function renderLobbyList(rooms) {
  const box = lobbyEl?.querySelector('#lobbyListItems');
  if (!box) return;
  if (rooms.length === 0) {
    box.innerHTML = '<div class="lobby-list-empty">Нет открытых игр — создайте первую.</div>';
    return;
  }
  box.innerHTML = rooms.map(r => `
    <div class="lobby-list-row">
      <span class="lobby-list-name">${escapeHtml(r.hostName)}</span>
      <span class="lobby-list-count">${r.playerCount}/${r.playerLimit}</span>
      <button class="lobby-list-join" data-room="${r.roomId}">Войти</button>
    </div>
  `).join('');
  box.querySelectorAll('.lobby-list-join').forEach(btn => {
    btn.addEventListener('click', () => {
      wsSend('lobby:join', { roomId: btn.dataset.room, playerName: name() });
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function setConnStatus(s) {
  if (!connBadgeEl) return;
  connBadgeEl.className = `conn-badge conn-${s}`;
  // Компактно в тонкой шапке: только значок, полный текст — в подсказке.
  connBadgeEl.textContent = { connecting: '⟳', connected: '●',
    disconnected: '○', error: '✕' }[s] ?? s;
  connBadgeEl.title = { connecting: 'Подключение…', connected: 'Онлайн',
    disconnected: 'Разрыв связи', error: 'Ошибка связи' }[s] ?? s;
  const reconnectBtn = lobbyEl?.querySelector('#reconnectBtn');
  if (reconnectBtn) {
    reconnectBtn.classList.toggle('hidden', s === 'connected' || s === 'connecting');
  }
  if (s !== 'connected') lastRtt = null; // не показываем устаревший RTT при разрыве
  renderRtt();
}

// Счётчик задержки до сервера (round-trip) в шапке
function renderRtt() {
  if (!connRttEl) return;
  if (lastRtt == null || ws?.readyState !== WebSocket.OPEN) {
    connRttEl.textContent = '';
    connRttEl.className = 'conn-rtt';
    return;
  }
  connRttEl.textContent = `${lastRtt} мс`;
  const q = lastRtt < 150 ? 'good' : lastRtt < 600 ? 'mid' : 'bad';
  connRttEl.className = `conn-rtt rtt-${q}`;
}


// ═════════════════════════════════════════════════════════════════
// Сессия (localStorage)
// ═════════════════════════════════════════════════════════════════

function saveSession(data)  { try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {} }
function loadSession()      { try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; } }
function clearSession()     { try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY + '_log'); } catch {} }

function saveLog() {
  try { localStorage.setItem(SESSION_KEY + '_log', JSON.stringify(eventLog)); } catch {}
}

function restoreFromLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY + '_log') ?? 'null');
    if (!Array.isArray(saved)) return false;
    eventLog.length = 0;
    saved.forEach(e => eventLog.push(e));
    // Журнал хранится от новых записей к старым. Применяем его от старых к новым,
    // чтобы последняя позиция каждого персонажа осталась итоговой.
    for (const e of [...eventLog].reverse()) {
      if (e.charId && e.to) positions.set(e.charId, e.to);
    }
    return true;
  } catch { return false; }
}

// ═════════════════════════════════════════════════════════════════
// Обработчики игровых контролов
// ═════════════════════════════════════════════════════════════════

dieButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => {
    if (!getDice()) { wsSend('turn:roll'); return; }
    if (!isMyTurn()) return;
    const g = getGame();
    const area = areaFor(selectedCharId);
    const used = getUsedDice(selectedCharId);

    // Есть незавершённое движение выбранного персонажа → клик по кубику работает как откат / смена ноги.
    if (area && !area.locked) {
      const activeDie = area.mode === 'split' ? area.dieIndex : null;
      if (area.mode === 'moveSum' || i === activeDie || used[i]) {
        // Активный кубик (или любой в режиме суммы, или уже потраченная нога) →
        // откат текущей ноги к её началу (сервер вернёт фишку и освободит кубик).
        wsSend('turn:resetMove', { characterId: area.characterId });
      } else {
        // Другой свободный кубик → выбрать его для второй ноги; поле покажет render.
        selectedDieIdx = i;
        localMode = 'moveDie';
        render();
      }
      return;
    }

    // Движения ещё нет — обычный выбор кубика/режима.
    if (!used[i]) {
      const canChangeMode = !used[0] && !used[1];
      if (localMode === 'moveDie' && selectedDieIdx === i && canChangeMode) {
        setLocalMode('moveSum');
        wsSend('turn:setMode', { mode: 'moveSum', characterId: selectedCharId });
      } else {
        selectedDieIdx = i;
        setLocalMode('moveDie');
        wsSend('turn:setMode', { mode: 'split', characterId: selectedCharId });
      }
      render();
    }
  });
});

characterDiceEl?.addEventListener('click', (event) => {
  const dieEl = event.target.closest('.character-die');
  if (!dieEl || !characterDiceEl.contains(dieEl)) return;
  event.stopPropagation();
  const setEl = dieEl.closest('.character-dice-set');
  const characterId = setEl?.dataset.characterId;
  const dieIndex = Number(dieEl.dataset.dieIndex);
  if (!characterId || !Number.isInteger(dieIndex)) return;
  selectCharacterDie(characterId, dieIndex);
});

document.querySelectorAll('.mode').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    // «Передать» открывает «ящик» (drag-and-drop) — всегда доступно для просмотра
    if (mode === 'transfer') {
      openCardBox();
      return;
    }
    // «Взять карту» — прямое действие, а не переключение режима
    if (mode === 'draw') { directCardAction(mode); return; }

    setLocalMode(mode);
    if (mode === 'moveSum' || mode === 'split') {
      wsSend('turn:setMode', { mode, characterId: selectedCharId });
    }
    render();
  });
});

endTurnBtn.addEventListener('click', () => {
  const g = getGame();
  if (canRollTurnDice(g)) {
    wsSend('turn:roll');
    return;
  }
  if (g && isMyTurn()) wsSend('turn:end');
});

function canRollTurnDice(g = getGame()) {
  return Boolean(
    g
    && isMyTurn()
    && !hasAnyDice()
    && !g.turn.hasRolled
    && (g.turn.rollsLeft[myPlayerId] ?? 0) > 0,
  );
}

function setLocalMode(mode) {
  if (areaFor(selectedCharId)) return; // у выбранного персонажа уже идёт движение
  localMode = mode;
  document.querySelectorAll('.mode').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  const char = getSelChar();
  const used = getUsedDice(char?.id);
  if (!char || !getDice(char.id) || !isMyTurn()) return;
  if (used[0] && used[1]) return;
  if (mode !== 'attack' && (used[0] || used[1])) return;

  const serverMode = TO_SERVER_MODE[mode];
  if (serverMode && getServMode(char.id) !== serverMode) {
    autoModeSent = true;
    wsSend('turn:setMode', { mode: serverMode, characterId: char.id });
  }
}

// Прямое карточное действие (без отдельной кнопки «Выполнить»):
// берём выбранную фишку и свободный кубик, при необходимости переключаем сервер в split.
function directCardAction(mode) {
  // Кнопка «Взять» всегда активна — всю проверку и объяснение причины делаем
  // здесь, при клике, чтобы не было «мёртвой» серой кнопки без обратной связи.
  if (!isMyTurn()) { showActionWarning('Сейчас ход соперника.'); return; }
  let char = getSelChar();
  if (!char) { showActionWarning('Сначала выберите персонажа.'); render(); return; }
  if (!getDice(char.id)) { showActionWarning('Сначала бросьте кубики.'); render(); return; }
  if (mode === 'draw') {
    const drawChar = getDrawCharacter(char);
    if (drawChar?.id !== char.id) {
      char = drawChar;
      selectedCharId = char.id;
    }
    if (hasCharacterDrawnThisTurn(char.id)) {
      showActionWarning('Этот персонаж уже брал карту в этом броске — выберите другого персонажа или другое действие.');
      render();
      return;
    }
    if (!canDrawWithCharacter(char)) {
      const plan = plannedResourceDraw(char);
      if (plan?.character?.id === char.id) {
        selectedCharId = char.id;
        selectedDieIdx = plan.moveDieIndex;
        localMode = 'moveDie';
        if (getServMode(char.id) !== 'split') {
          wsSend('turn:setMode', { mode: 'split', characterId: char.id });
        }
        wsSend('action:move', {
          characterId: char.id,
          toCell: plan.cellId,
          dieIndex: plan.moveDieIndex,
        });
        return;
      }
      showActionWarning('Взять карту можно только на ресурсной клетке.');
      render();
      return;
    }
  }

  const dieIndex = drawDieIndex();
  if (dieIndex == null) {
    showActionWarning('Кубики потрачены — на добор не осталось кубика. На ресурс надо приходить одним кубиком (раздельные кубики), а не суммой.');
    render();
    return;
  }

  if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });

  if (mode === 'draw') {
    wsSend('action:draw', { characterId: char.id, dieIndex });
  } else {
    const allies = getMyChars().filter(c => c.id !== char.id);
    if (!allies.length) { addLog('Нет союзников для передачи.', { type: 'err' }); render(); return; }
    const pos = characterPosition(char);
    const target = allies.find(c => characterPosition(c) === pos) ?? allies[0];
    wsSend('action:transfer', { fromId: char.id, toId: target.id, dieIndex });
  }
}

// Бой со зверем (красная клетка): тратим свободный кубик на удар.
// Серверу нужен split-режим — переключаем перед отправкой, как в directCardAction.
function fightBeast() {
  if (!isMyTurn()) return;
  const char = getSelChar();
  if (!getDice(char?.id)) return;
  const hasRam = char?.inventory?.some(card => card.id === 'sheep_ram');
  if (!char || (!char.beastFight && !hasRam)) return;

  const used = getUsedDice(char.id);
  const dieIndex = isDieIndex(selectedDieIdx) && !used[selectedDieIdx]
    ? selectedDieIdx
    : firstFreeDieIndexFor(char.id);
  if (dieIndex == null) { addLog('Оба кубика потрачены.', { type: 'err' }); render(); return; }

  // Собираем id карт на террейне для отправки (ключ — уникальный uid, значение — cardId)
  const terrainCardIds = [...terrainCards.values()].map(tc => tc.cardId);

  if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });
  wsSend('action:fightBeast', { characterId: char.id, dieIndex, terrainCards: terrainCardIds });
}

// ═════════════════════════════════════════════════════════════════
// Клики по бордам (движение — локально, сервер ждёт карту)
// ═════════════════════════════════════════════════════════════════

function handleCellClick(targetId) {
  if (!getGame()) return;
  if (!isMyTurn()) {
    showActionWarning('Сейчас ход противника.');
    return;
  }
  const char = getSelChar();
  if (!char) {
    showActionWarning('Сначала выберите своего персонажа.');
    return;
  }
  if (!getDice(char.id)) {
    showActionWarning('Сначала бросьте кубики.');
    return;
  }

  if (localMode === 'teleport') {
    handleTeleportCellClick(char, targetId);
    return;
  }

  const moveMode = effectiveMoveMode(char.id);
  if (moveMode !== 'moveSum' && moveMode !== 'moveDie') {
    showActionWarning('Сначала выберите действие для этой клетки.');
    return;
  }

  if (usesServerPositions()) {
    handleServerMoveCellClick(char, targetId, moveMode);
    return;
  }

  handleLocalMoveCellClick(char, targetId, moveMode);
}

function handleTeleportCellClick(char, targetId) {
  const inv = char.inventory ?? [];
  if (carriesGoldFeather(char)) {
    showActionWarning('Персонаж с Золотым пером не может телепортироваться.');
    return;
  }
  if (!inv.some(c => c.id === TELEPORT_ID && !c.exhausted)) {
    showActionWarning('У выбранного персонажа нет готовых Бус телепортации.');
    return;
  }
  if (!validTargets(char).has(targetId)) {
    showActionWarning('На эту клетку нельзя телепортироваться.');
    return;
  }
  if (usesServerPositions()) {
    teleportedChars.add(char.id); // не анимировать шагами — это прыжок
    const dieIndex = firstFreeDieIndexFor(char.id);
    if (dieIndex == null) return;
    if (getServMode(char.id) !== 'split') {
      pendingTeleport = { characterId: char.id, toCell: targetId, dieIndex };
      wsSend('turn:setMode', { mode: 'split', characterId: char.id });
      return;
    }
    wsSend('action:teleport', { characterId: char.id, toCell: targetId, dieIndex });
    return;
  }
  if (localUsedDice[0] && localUsedDice[1]) return;
  positions.set(char.id, targetId);
  localUsedDice = [true, true];
  addLog(`${ROLE_NAMES[char.role]} телепортируется на ${targetId}.`, { charId: char.id, to: targetId, type: 'my' });
  render();
}

function handleServerMoveCellClick(char, targetId, moveMode) {
  if (!validTargets(char).has(targetId)) {
    showActionWarning('Эта клетка недоступна выбранным движением.');
    return;
  }
  const payload = buildServerMovePayload(char, targetId, moveMode);
  if (!payload) return;
  wsSend('action:move', payload);
}

function buildServerMovePayload(char, targetId, moveMode) {
  const payload = { characterId: char.id, toCell: targetId };
  // В ход суммой dieIndex не шлём: сервер сам решит — автосплит (если ресурс
  // достижим одним кубиком, тратит один, второй оставляет на добор) или ход
  // суммой (оба кубика, авто-добор на прибытии). Раньше ресурс в moveSum
  // форсил одиночный кубик и блокировал клетки, до которых только сумма.
  const splitMoveRequested = moveMode === 'moveDie'
    || getServMode(char.id) === 'split';
  if (!splitMoveRequested) return payload;

  const dieIndex = moveDieIndexForTarget(char, targetId);
  if (dieIndex == null) {
    showActionWarning('До этой клетки нельзя дойти одним свободным кубиком.');
    return null;
  }
  selectedDieIdx = dieIndex;
  payload.dieIndex = dieIndex;
  if (getServMode(char.id) !== 'split') {
    wsSend('turn:setMode', { mode: 'split', characterId: char.id });
  }
  return payload;
}

function handleLocalMoveCellClick(char, targetId, moveMode) {
  const maxDist = getMoveDistance(char.id);
  const dist = cellDistance(positions.get(char.id), targetId);
  if (!maxDist || dist <= 0 || dist > maxDist) return;

  positions.set(char.id, targetId);

  if (moveMode === 'moveSum') {
    localUsedDice = [true, true];
  } else {
    localUsedDice[selectedDieIdx] = true;
  }

  addLog(`${ROLE_NAMES[char.role]} → ${targetId}.`, { charId: char.id, to: targetId, type: 'my' });
  render();
}

function getMoveDistance(characterId = selectedCharId) {
  const dice = getDice(characterId); if (!dice) return 0;
  const srv  = getUsedDice(characterId);
  const used = [srv[0] || localUsedDice[0], srv[1] || localUsedDice[1]];
  const moveMode = effectiveMoveMode();
  if (moveMode === 'moveSum') return (used[0] || used[1]) ? 0 : dice[0] + dice[1];
  const dieIndex = firstFreeDieIndexFor(characterId);
  if (dieIndex == null || used[dieIndex]) return 0;
  return dice[dieIndex] ?? 0;
}

// ═════════════════════════════════════════════════════════════════
// Рендер
// ═════════════════════════════════════════════════════════════════

// Если выбранный кубик уже потрачен — автоматически перейти на свободный
// и показать клетки хода сразу, без лишнего клика по кубику.
function syncDieSelection() {
  const g = getGame();
  if (!getDice(selectedCharId)) return;
  const selArea = areaFor(selectedCharId);
  if (selArea) {
    const area = selArea;
    localMode = area.mode === 'moveSum' ? 'moveSum' : 'moveDie';
    if (area.mode === 'split' && area.dieIndex != null) {
      // Если игрок выбрал ДРУГОЙ свободный кубик (превью второй ноги) — уважаем
      // выбор; иначе держим выделение на активной ноге.
      const other = 1 - area.dieIndex;
      const used = getUsedDice(area.characterId);
      if (!(selectedDieIdx === other && !used[other] && !area.locked)) {
        selectedDieIdx = area.dieIndex;
      }
    }
    return;
  }
  const used = getUsedDice(selectedCharId);
  if (!isDieIndex(selectedDieIdx)) {
    const dieIndex = firstFreeDieIndexFor();
    if (dieIndex != null) selectedDieIdx = dieIndex;
  } else if (used[selectedDieIdx] && !used[1 - selectedDieIdx]) {
    selectedDieIdx = 1 - selectedDieIdx;
    if (localMode === 'moveSum') localMode = 'moveDie';
  }
}

function render() {
  syncDieSelection();
  renderTopbar();
  renderDice();
  renderBoard();
  renderCharacters();
  renderInventory();
  renderLog();
  renderGuidePanel();
  if (cardBoxEl && !cardBoxEl.classList.contains('hidden')) renderCardBox();
}

function renderTopbar() {
  const g = getGame();
  if (!g) {
    turnInfoEl.textContent = 'Ожидание второго игрока…';
    endTurnBtn.disabled = true;
    return;
  }
  if (g.over) {
    const winner = serverRoom.players.find(p => p.id === g.winnerId)?.name ?? '?';
    turnInfoEl.textContent = `Партия завершена. Победитель: ${winner}`;
    endTurnBtn.disabled = true;
    return;
  }
  const myTurn = isMyTurn();
  const rolls  = g.turn.rollsLeft[myPlayerId] ?? 0;
  const who    = serverRoom.players.find(p => p.id === g.turn.activePlayerId)?.name ?? '…';
  turnInfoEl.textContent = myTurn
    ? `Ваш ход · Ходов: ${rolls}`
    : `Ход соперника`;
  endTurnBtn.disabled = !myTurn;
}

const transferModeBtn = document.querySelector('.mode[data-mode="transfer"]');
const teleportModeBtn = document.querySelector('.mode[data-mode="teleport"]');
const drawModeBtn     = document.querySelector('.mode[data-mode="draw"]');

function renderDice() {
  const g = getGame();
  if (!g) {
    renderCharacterDice(false);
    dieButtons.forEach(b => { b.textContent = '–'; b.disabled = true; b.className = 'die'; });
    if (transferModeBtn) transferModeBtn.disabled = true;
    if (drawModeBtn) drawModeBtn.disabled = true;
    if (teleportModeBtn) teleportModeBtn.disabled = true;
    return;
  }
  const myTurn  = isMyTurn();
  const sel     = getSelChar();
  const dice    = getDice(sel?.id);
  const used    = getUsedDice(sel?.id);
  const movementArea = areaFor(sel?.id);
  const effectiveUsed = movementArea && movementArea.mode === 'moveSum' && !movementArea.locked
    ? [false, false]
    : used;
  const canRoll = myTurn
    && !hasAnyDice()
    && !g.turn.hasRolled
    && (g.turn.rollsLeft[myPlayerId] ?? 0) > 0;
  renderCharacterDice(canRoll);

  // Пока движение не зафиксировано — потраченные кубики остаются кликабельны
  // (клик по ним = откат ноги к старту). После жёсткого коммита — недоступны.
  const resettable = Boolean(movementArea && !movementArea.locked && myTurn);
  dieButtons.forEach((btn, i) => {
    // «🎲» только когда реально можно бросить; потрачено всё — «–»
    btn.textContent = dice ? dice[i] : (canRoll ? '🎲' : '–');
    btn.disabled    = dice ? (!myTurn || (effectiveUsed[i] && !resettable)) : !canRoll;
    btn.className   = 'die';
    if (canRoll)                                               btn.classList.add('rollable');
    const movementDie = movementArea?.mode === 'split'
      && movementArea.dieIndex === i;
    if (dice && ((!effectiveUsed[i] && selectedDieIdx === i && localMode !== 'moveSum') || movementDie)) {
      btn.classList.add('selected');
    }
    if (dice && effectiveUsed[i])                              btn.classList.add('used');
    // Свободный, но «зависший» кубик (движение зафиксировано + уже добрал) — гасим.
    else if (dice && dieStranded(sel?.id))                     btn.classList.add('stranded');
  });

  // Кубики потрачены, бросать больше нельзя — подсветить «Конец хода»
  const activeChars = getMyChars().filter(c => c.hp > 0 && characterPosition(c));
  const allSpent = hasAnyDice() && activeChars.every(c => {
    const charDice = getDice(c.id);
    const charUsed = getUsedDice(c.id);
    return !charDice || charUsed.every(Boolean);
  });
  endTurnBtn.classList.toggle('attention', myTurn && allSpent && g.turn.hasRolled);
  endTurnBtn.classList.toggle('roll-ready', canRoll);
  setEndTurnButtonMode(canRoll ? 'roll' : 'end');

  // «Передать» открывает «ящик» — теперь всегда доступно для просмотра карт команды
  if (transferModeBtn) {
    transferModeBtn.disabled = false;
    const canTrans = myTurn && (hasAnyDice() || transferRemaining() > 0);
    transferModeBtn.title = canTrans ? 'Передача карт между персонажами' : 'Просмотр карт команды (передача недоступна)';
  }
  // «Карта» — кнопка всегда активна; проверку и причину отказа показываем по
  // клику (directCardAction). В подсказке (hover) — текущее состояние.
  if (drawModeBtn) {
    const free = drawDieIndex(sel?.id) != null;
    const opportunity = hasDrawOpportunity(sel);
    const selectedDrawn = sel ? hasCharacterDrawnThisTurn(sel.id) : false;
    drawModeBtn.disabled = false;
    drawModeBtn.title = !myTurn
      ? 'Сейчас ход соперника'
      : !dice
        ? 'Сначала бросьте кубики'
      : selectedDrawn
        ? 'Этот персонаж уже брал карту в этом броске — выберите другого персонажа или другое действие'
      : !opportunity
        ? 'Взять карту можно только на ресурсной клетке'
      : !free
        ? 'Кубики потрачены — на ресурс приходите одним кубиком (раздельные кубики), а не суммой'
      : !canDrawWithCharacter(getDrawCharacter(sel))
        ? 'Можно дойти до ресурса одним кубиком и взять карту вторым: сначала поставьте фишку'
      : 'Взять карту из колоды (тратит кубик)';
  }
  // Режим телепорта всегда доступен; конкретную причину невозможности показываем
  // после выбора цели, а не скрываем действие затемнённой кнопкой.
  if (teleportModeBtn) {
    const hasBeads = sel?.inventory?.some(c => c.id === TELEPORT_ID && !c.exhausted);
    const hasFreeDie = dice && (!used[0] || !used[1]);
    const hasFeather = carriesGoldFeather(sel);
    teleportModeBtn.disabled = false;
    teleportModeBtn.title = hasFeather
      ? 'Персонаж с Золотым пером не может телепортироваться'
      : hasBeads && hasFreeDie
      ? 'Кубик 2+: телепорт на свой старт или фиолетовую точку'
      : 'Телепорт: выберите персонажа, бросьте кубики и укажите точку';
  }

}

function renderCharacterDice(canRoll) {
  if (!characterDiceEl) return;
  if (!getGame()) {
    characterDiceEl.innerHTML = '';
    characterDiceEl.classList.remove('visible');
    return;
  }
  if (!hasAnyDice()) {
    characterDiceEl.innerHTML = '';
    characterDiceEl.classList.remove('visible');
    return;
  }
  characterDiceEl.innerHTML = getMyChars().map((char) => {
    const dice = getDice(char.id);
    const used = getUsedDice(char.id);
    if (!dice) return '<span class="character-dice-set empty"></span>';
    const selected = char.id === selectedCharId;
    const stranded = dieStranded(char.id);
    return `<span class="character-dice-set${selected ? ' active' : ''}" data-character-id="${char.id}">`
      + dice.map((value, index) => (
        `<span class="character-die${used?.[index] ? ' used' : (stranded ? ' stranded' : '')}${selected && selectedDieIdx === index ? ' selected' : ''}" data-die-index="${index}" title="Кубик ${index + 1}: ${value}" aria-label="Кубик ${index + 1}: ${value}" role="button">`
          + `<img class="character-die-art" src="${cubeFaceArt(value)}" alt="" draggable="false" />`
        + `</span>`
      )).join('')
      + '</span>';
  }).join('');
  characterDiceEl.classList.add('visible');
}

function renderBoard() {
  if (!boardSvg) return;
  boardSvg.querySelectorAll('.token').forEach(n => n.remove());
  const sel    = getSelChar();
  const valid  = sel ? validTargets(sel) : new Set();
  const game   = getGame();

  // Туман войны: чистые круглые окна вокруг своих живых фигур.
  // Сетка и маркеры вне кругов полностью скрыты, дальние цели туман не пробивают.
  const fogCircles = fogEnabled ? fogRevealCircles() : null;
  renderFog(fogCircles);
  for (const el of boardSvg.querySelectorAll('.cell')) {
    const id = el.getAttribute('data-id');
    el.setAttribute('class', cellClassName(cellById.get(id)));
    // Допустимые цели движения видны поверх тумана, но не открывают карту
    // и не показывают привязанные к клеткам маркеры.
    el.classList.toggle('fog-hidden', !fogContainsCell(fogCircles, id) && !valid.has(id));
    el.classList.toggle(
      'teleport-target',
      localMode === 'teleport' && valid.has(id) && cellById.get(id)?.pointClass === 'teleport',
    );
    el.classList.toggle(
      'teleport-destination',
      localMode === 'teleport' && valid.has(id),
    );
    if (isStartCell(id)) el.classList.add('start');
    if (game?.characters.some(c => characterPosition(c) === id)) el.classList.add('occupied');
    if (sel && characterPosition(sel) === id) el.classList.add('selected');
    if (valid.has(id)) el.classList.add('valid');
  }
  for (const marker of boardSvg.querySelectorAll('.deck-marker[data-cell-id]')) {
    marker.classList.toggle(
      'fog-hidden',
      !fogContainsCell(fogCircles, marker.getAttribute('data-cell-id')),
    );
  }

  if (!game) return;
  const selectedAttacker = getSelChar();
  const selectedAttackTargets = new Set(
    game.legalTargets?.attacks?.[selectedAttacker?.id] ?? [],
  );
  const renderItems = [
    ...game.characters.map((char) => {
      const pos = tokenDisplayPos.get(char.id) ?? characterPosition(char);
      const ctr = cellCenter(pos);
      return ctr ? { type: 'character', id: char.id, char, cx: ctr.cx, cy: ctr.cy } : null;
    }),
    ...dwarfRenderItems(game.dwarves),
  ]
    .filter(Boolean)
    .sort((a, b) =>
      a.cy - b.cy
      || (a.type === 'dwarf' ? 1 : 0) - (b.type === 'dwarf' ? 1 : 0)
      || String(a.id ?? '').localeCompare(String(b.id ?? '')));

  for (const item of renderItems) {
    if (item.type === 'dwarf') {
      appendDwarfToken(item.unit, item.cx, item.cy, selectedAttackTargets, selectedAttacker);
      continue;
    }
    const { char, cx, cy } = item;
    const g = document.createElementNS(svgNS, 'g');
    const isOwn = char.owner === myPlayerId;
    const tokenClasses = ['token', `side-${charSide(char)}`, `role-${char.role}`];
    if (isOwn) tokenClasses.push('own');
    if (char.combatOpponentId) tokenClasses.push('in-combat');
    if (char.beastFight) tokenClasses.push('beast-fight');
    if (char.beacon) tokenClasses.push('carries-beacon');
    if (char.dots?.length) tokenClasses.push('has-dot');
    if (char.frogSpell) tokenClasses.push('has-frog-spell');
    if (selectedAttackTargets.has(char.id)) tokenClasses.push('attackable');
    if (char.id === attackFxTargetId) tokenClasses.push('attack-triggered');
    if (char.id === selectedCharId) tokenClasses.push('active');
    g.setAttribute('class', tokenClasses.join(' '));
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    const myInCombat = selectedAttacker?.combatOpponentId === char.id ? selectedAttacker : null;
    const isAttackable = selectedAttackTargets.has(char.id);
    if (isOwn) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `Выбрать: ${ROLE_NAMES[char.role]}`);
      g.addEventListener('click', (event) => {
        event.stopPropagation();
        if (gestureMoved) return;
        selectCharacter(char.id);
      });
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectCharacter(char.id);
      });
    } else {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', isAttackable ? `Атаковать: ${ROLE_NAMES[char.role]}` : `Враг: ${ROLE_NAMES[char.role]}`);

      const onEnemyClick = (event) => {
        event.stopPropagation();
        if (gestureMoved) return;
        const attacker = selectedAttacker;
        if (!isMyTurn()) {
          showActionWarning('Сейчас ход противника.');
          return;
        }
        if (!attacker) {
          showActionWarning('Сначала выберите своего персонажа.');
          return;
        }
        if (!getDice(attacker.id)) {
          showActionWarning('Сначала бросьте кубики.');
          return;
        }
        if (attacker.beastFight) {
          showActionWarning('Этот персонаж сражается со зверем.');
          return;
        }
        if (attacker.combatOpponentId && attacker.combatOpponentId !== char.id) {
          showActionWarning('Выбранный персонаж уже сражается с другим противником.');
          return;
        }
        const selectedPos = characterPosition(attacker);
        const enemyPos = characterPosition(char);
        const targetAdjacent = areCellsAdjacent(selectedPos, enemyPos);
        const fightingThisTarget = attacker.combatOpponentId === char.id;
        if ((isAttackable || fightingThisTarget || targetAdjacent) && firstFreeDieIndexFor(attacker.id) != null) {
          selectedCharId = attacker.id;
          g.classList.add('attack-triggered');
          triggerAttackEffect(char.id);
          wsSend('action:attack', { attackerId: attacker.id, targetId: char.id });
          return;
        }
        if (myInCombat) {
          selectCharacter(myInCombat.id);
          showActionWarning(firstFreeDieIndexFor(attacker.id) != null ? 'Кликните по противнику ещё раз, чтобы ударить.' : 'Для удара нужен свободный кубик.');
          return;
        }
        if (
          selectedAttacker
          && isMyTurn()
          && targetAdjacent
        ) {
          wsSend('action:engage', { attackerId: selectedAttacker.id, targetId: char.id });
          return;
        }
        // Враг дальше: если он в досягаемости броска (кубики + 1 клетка рядом) —
        // подходим вплотную, окно боя откроется по прибытии
        const sel = getSelChar();
        if (sel && isMyTurn() && getDice(sel.id)) {
          const plan = planApproach(sel, char);
          if (plan) {
            approachTarget = { mineId: sel.id, enemyId: char.id, until: Date.now() + 4000 };
            if (getServMode(sel.id) !== plan.mode) wsSend('turn:setMode', { mode: plan.mode, characterId: sel.id });
            wsSend('action:move', plan.payload);
            addLog(`${ROLE_NAMES[sel.role]} идёт к врагу: ${ROLE_NAMES[char.role]}…`, { type: 'my' });
            return;
          }
          showActionWarning(`До ${ROLE_NAMES[char.role]} не дотянуться этим броском.`);
          return;
        }
        showActionWarning('Не удалось выполнить действие с выбранным противником.');
      };
      g.addEventListener('click', onEnemyClick);
      g.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onEnemyClick(event);
      });
    }
    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('class', 'token-halo');
    halo.setAttribute('r', (HEX_R * 0.74).toFixed(1));

    const figure = document.createElementNS(svgNS, 'image');
    const figureWidth = HEX_R * 3.38;
    const figureHeight = HEX_R * 4.6475;
    const figureHref = tokenArtHref(char);
    figure.setAttribute('class', 'token-figure');
    figure.setAttributeNS('http://www.w3.org/1999/xlink', 'href', figureHref);
    figure.setAttribute('href', figureHref);
    figure.setAttribute('x', (-figureWidth / 2).toFixed(2));
    figure.setAttribute('y', (-figureHeight * 0.7).toFixed(2));
    figure.setAttribute('width', figureWidth.toFixed(2));
    figure.setAttribute('height', figureHeight.toFixed(2));
    figure.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const glow = figure.cloneNode();
    glow.setAttribute('class', 'token-glow');

    const hitArea = !isOwn && isAttackable
      ? document.createElementNS(svgNS, 'rect')
      : null;
    if (hitArea) {
      hitArea.setAttribute('class', 'token-hit-area');
      hitArea.setAttribute('x', (-figureWidth / 2).toFixed(2));
      hitArea.setAttribute('y', (-figureHeight * 0.7).toFixed(2));
      hitArea.setAttribute('width', figureWidth.toFixed(2));
      hitArea.setAttribute('height', figureHeight.toFixed(2));
    }

    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${ROLE_NAMES[char.role]} — ${char.hp} HP`;
    const hp = document.createElementNS(svgNS, 'text');
    hp.setAttribute('class', 'token-hp');
    hp.setAttribute('y', (HEX_R * 0.62).toFixed(1));
    hp.style.fontSize = '6.5px';
    hp.textContent = `${char.hp}`;
    g.appendChild(title);
    if (hitArea) g.appendChild(hitArea);
    g.appendChild(halo);
    g.appendChild(glow);
    g.appendChild(figure);
    if (char.beacon) {
      const featherWidth = HEX_R * 1.68;
      const featherHeight = featherWidth;
      const featherY = (-figureHeight * 0.74 - featherHeight * 0.58);
      const beaconGlow = document.createElementNS(svgNS, 'ellipse');
      beaconGlow.setAttribute('class', 'token-feather-glow');
      beaconGlow.setAttribute('cx', '0');
      beaconGlow.setAttribute('cy', (featherY + featherHeight * 0.5).toFixed(2));
      beaconGlow.setAttribute('rx', (featherWidth * 0.46).toFixed(2));
      beaconGlow.setAttribute('ry', (featherHeight * 0.44).toFixed(2));
      g.appendChild(beaconGlow);

      const beacon = document.createElementNS(svgNS, 'image');
      const featherHref = featherMarkerUrl();
      beacon.setAttribute('class', 'token-feather');
      beacon.setAttributeNS('http://www.w3.org/1999/xlink', 'href', featherHref);
      beacon.setAttribute('href', featherHref);
      beacon.setAttribute('x', (-featherWidth / 2).toFixed(2));
      beacon.setAttribute('y', featherY.toFixed(2));
      beacon.setAttribute('width', featherWidth.toFixed(2));
      beacon.setAttribute('height', featherHeight.toFixed(2));
      beacon.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const beaconTitle = document.createElementNS(svgNS, 'title');
      beaconTitle.textContent = 'Несёт Золотое перо';
      beacon.appendChild(beaconTitle);
      g.appendChild(beacon);
    }
    if (char.dots?.length) {
      const dotBadge = document.createElementNS(svgNS, 'text');
      dotBadge.setAttribute('class', 'token-dot');
      dotBadge.setAttribute('text-anchor', 'middle');
      dotBadge.setAttribute('x', (HEX_R * 0.72).toFixed(1));
      dotBadge.setAttribute('y', (-HEX_R * 0.72).toFixed(1));
      dotBadge.style.fontSize = `${(HEX_R * 0.6).toFixed(1)}px`;
      dotBadge.textContent = '☠️';
      const dotTitle = document.createElementNS(svgNS, 'title');
      const dmg = char.dots.reduce((s, d) => s + d.damagePerTurn, 0);
      dotTitle.textContent = `Ловушка-дебафф: −${dmg} HP в начале хода`;
      dotBadge.appendChild(dotTitle);
      g.appendChild(dotBadge);
    }
    g.appendChild(hp);
    boardVp.appendChild(g);
  }
  renderCombatBoardElements(fogCircles);
  bringDamageLayerToFront();
}

function dwarfRenderItems(dwarfState) {
  const units = (dwarfState?.units ?? []).filter(unit => unit.alive && unit.position);
  if (!units.length) return [];

  const positionCounts = units.reduce((counts, unit) => {
    counts.set(unit.position, (counts.get(unit.position) || 0) + 1);
    return counts;
  }, new Map());
  const positionSeen = new Map();
  const items = [];

  for (const unit of units) {
    const ctr = cellCenter(unit.position);
    if (!ctr) continue;
    const count = positionCounts.get(unit.position) || 1;
    const seen = positionSeen.get(unit.position) || 0;
    positionSeen.set(unit.position, seen + 1);
    const angle = count > 1 ? (-Math.PI * 0.86) + (seen / Math.max(1, count - 1)) * Math.PI * 0.72 : 0;
    const offset = count > 1 ? HEX_R * 0.76 : 0;
    const cx = ctr.cx + Math.cos(angle) * offset;
    const cy = ctr.cy + Math.sin(angle) * offset;
    items.push({ type: 'dwarf', id: unit.id, unit, cx, cy });
  }
  return items;
}

function appendDwarfToken(unit, cx, cy, selectedAttackTargets = new Set(), selectedAttacker = null) {
  const g = document.createElementNS(svgNS, 'g');
  const isAttackable = selectedAttackTargets.has(unit.id);
  const tokenClasses = ['token', 'dwarf-token', `dwarf-${unit.kind ?? 'ordinary'}`];
  if (isAttackable) tokenClasses.push('attackable');
  if (unit.id === attackFxTargetId) tokenClasses.push('attack-triggered');
  g.setAttribute('class', tokenClasses.join(' '));
  g.setAttribute('transform', `translate(${cx} ${cy})`);
  g.setAttribute('role', 'button');
  g.setAttribute('tabindex', '0');
  g.setAttribute('aria-label', isAttackable ? `Атаковать: ${dwarfLabel(unit)}` : dwarfLabel(unit));

  const onDwarfClick = (event) => {
    event.stopPropagation();
    if (gestureMoved) return;
    const attacker = selectedAttacker ?? getSelChar();
    if (!isMyTurn()) {
      showActionWarning('Сейчас ход противника.');
      return;
    }
    if (!attacker) {
      showActionWarning('Сначала выберите своего персонажа.');
      return;
    }
    if (!getDice(attacker.id)) {
      showActionWarning('Сначала бросьте кубики.');
      return;
    }
    if (attacker.beastFight) {
      showActionWarning('Этот персонаж сражается со зверем.');
      return;
    }
    if (isAttackable) {
      selectedCharId = attacker.id;
      g.classList.add('attack-triggered');
      triggerAttackEffect(unit.id);
      wsSend('action:attack', { attackerId: attacker.id, targetId: unit.id });
      return;
    }
    const attackerPos = characterPosition(attacker);
    const dwarfPos = characterPosition(unit);
    if (attackerPos && dwarfPos && hexNeighbors(attackerPos).includes(dwarfPos)) {
      showActionWarning(firstFreeDieIndexFor(attacker.id) != null
        ? 'Дварф рядом, но сервер не дал цель атаки. Обновите ход или перезагрузите партию.'
        : 'Для удара нужен свободный кубик.');
      return;
    }
    const sel = getSelChar();
    if (sel && isMyTurn() && getDice(sel.id)) {
      const plan = planApproach(sel, unit);
      if (plan) {
        selectedCharId = sel.id;
        if (getServMode(sel.id) !== plan.mode) wsSend('turn:setMode', { mode: plan.mode, characterId: sel.id });
        wsSend('action:move', plan.payload);
        addLog(`${ROLE_NAMES[sel.role]} идёт к дварфу: ${dwarfLabel(unit)}…`, { type: 'my' });
        return;
      }
      showActionWarning('До дварфа не дотянуться этим броском.');
      return;
    }
    showActionWarning('Не удалось выполнить действие с дварфом.');
  };
  g.addEventListener('click', onDwarfClick);
  g.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onDwarfClick(event);
  });

  const halo = document.createElementNS(svgNS, 'circle');
  halo.setAttribute('class', 'token-halo dwarf-halo');
  halo.setAttribute('r', (HEX_R * 0.58).toFixed(1));

  const hit = document.createElementNS(svgNS, 'circle');
  hit.setAttribute('class', 'token-hit-area');
  hit.setAttribute('r', (HEX_R * 1.18).toFixed(1));

  const figure = document.createElementNS(svgNS, 'image');
  const figureWidth = HEX_R * 3.38;
  const figureHeight = HEX_R * 4.6475;
  figure.setAttribute('class', 'token-figure dwarf-figure');
  figure.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dwarfArtHref(unit));
  figure.setAttribute('href', dwarfArtHref(unit));
  figure.setAttribute('x', (-figureWidth / 2).toFixed(2));
  figure.setAttribute('y', (-figureHeight * 0.7).toFixed(2));
  figure.setAttribute('width', figureWidth.toFixed(2));
  figure.setAttribute('height', figureHeight.toFixed(2));
  figure.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const title = document.createElementNS(svgNS, 'title');
  title.textContent = `${unit.name ?? DWARF_NAMES[unit.kind] ?? 'Dwarf'} - ${unit.hp ?? 100} HP`;
  g.appendChild(title);
  g.appendChild(hit);
  g.appendChild(halo);
  g.appendChild(figure);
  const hp = document.createElementNS(svgNS, 'text');
  hp.setAttribute('class', 'token-hp dwarf-hp');
  hp.setAttribute('y', (HEX_R * 0.62).toFixed(1));
  hp.style.fontSize = '6.5px';
  hp.textContent = String(unit.hp ?? 100);
  g.appendChild(hp);
  boardVp.appendChild(g);
}

function setEndTurnButtonMode(mode) {
  if (!endTurnBtn) return;
  const isRoll = mode === 'roll';
  const title = isRoll ? 'Бросить кубики' : 'Конец хода';
  const icon = endTurnBtn.querySelector('img');
  if (icon) {
    const nextSrc = isRoll ? ROLL_TURN_ICON : END_TURN_ICON;
    if (icon.getAttribute('src') !== nextSrc) {
      icon.src = nextSrc;
    }
  }
  endTurnBtn.title = title;
  endTurnBtn.setAttribute('aria-label', title);
}

function renderDwarves(dwarfState) {
  const units = (dwarfState?.units ?? []).filter(unit => unit.alive && unit.position);
  if (!units.length) return;

  const positionCounts = units.reduce((counts, unit) => {
    counts.set(unit.position, (counts.get(unit.position) || 0) + 1);
    return counts;
  }, new Map());
  const positionSeen = new Map();

  for (const unit of units) {
    const ctr = cellCenter(unit.position);
    if (!ctr) continue;
    const count = positionCounts.get(unit.position) || 1;
    const seen = positionSeen.get(unit.position) || 0;
    positionSeen.set(unit.position, seen + 1);
    const angle = count > 1 ? (-Math.PI * 0.86) + (seen / Math.max(1, count - 1)) * Math.PI * 0.72 : 0;
    const offset = count > 1 ? HEX_R * 0.76 : 0;
    const cx = ctr.cx + Math.cos(angle) * offset;
    const cy = ctr.cy + Math.sin(angle) * offset;

    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', `token dwarf-token dwarf-${unit.kind ?? 'ordinary'}`);
    g.setAttribute('transform', `translate(${cx} ${cy})`);

    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('class', 'token-halo dwarf-halo');
    halo.setAttribute('r', (HEX_R * 0.58).toFixed(1));

    const figure = document.createElementNS(svgNS, 'image');
    const figureWidth = HEX_R * 3.38;
    const figureHeight = HEX_R * 4.6475;
    figure.setAttribute('class', 'token-figure dwarf-figure');
    figure.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dwarfArtHref(unit));
    figure.setAttribute('href', dwarfArtHref(unit));
    figure.setAttribute('x', (-figureWidth / 2).toFixed(2));
    figure.setAttribute('y', (-figureHeight * 0.7).toFixed(2));
    figure.setAttribute('width', figureWidth.toFixed(2));
    figure.setAttribute('height', figureHeight.toFixed(2));
    figure.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${unit.name ?? DWARF_NAMES[unit.kind] ?? 'Дварф'} — ${unit.hp ?? 100} HP`;
    g.appendChild(title);
    g.appendChild(halo);
    g.appendChild(figure);
    boardVp.appendChild(g);
  }
}

function renderCharacters() {
  if (!charactersEl) return;
  charactersEl.innerHTML = '';
  const game = getGame();
  if (!game) return;

  for (const char of getMyChars()) {
    const hp     = char.hp ?? 100;
    const btn    = document.createElement('button');
    btn.className = 'character-nav-btn';
    if (char.id === selectedCharId) btn.classList.add('active');
    if (char.combatOpponentId || char.beastFight) btn.classList.add('in-combat');
    if (characterNavHitIds.has(char.id)) btn.classList.add('hit');
    const portrait = document.createElement('img');
    portrait.className = 'character-nav-portrait';
    portrait.src = characterNavArtHref(char);
    portrait.alt = '';
    portrait.draggable = false;
    btn.appendChild(portrait);
    const hpLabel = document.createElement('span');
    hpLabel.className = 'character-nav-hp';
    hpLabel.textContent = `${hp} HP`;
    btn.appendChild(hpLabel);
    btn.title = `${ROLE_NAMES[char.role]} · HP ${hp}`;
    btn.setAttribute(
      'aria-label',
      `${ROLE_NAMES[char.role]}, HP ${hp}${char.id === selectedCharId ? ', выбран' : ''}`,
    );
    btn.setAttribute('aria-pressed', char.id === selectedCharId ? 'true' : 'false');
    btn.disabled = char.hp <= 0 || !characterPosition(char);
    btn.addEventListener('click', () => {
      selectCharacter(char.id);
      focusCharacter(char.id);
    });
    charactersEl.appendChild(btn);
  }
}

const expandedCards = new Set(); // индексы раскрытых карт текущего инвентаря
const faceDownCards = new Set(); // `${characterId}:${index}` — подготовлена рубашкой вверх
let invExpandedFor = null;       // для какого персонажа набор актуален

function renderInventory() {
  const char = getSelChar();
  if (inventoryTitleEl) inventoryTitleEl.textContent = char ? ROLE_NAMES[char.role] : 'Персонаж';
  if (!char) {
    inventoryEl.className = 'inventory empty';
    inventoryEl.textContent = 'Выберите персонажа.';
    return;
  }
  const inv = char.inventory;
  if (!inv) {
    inventoryEl.className = 'inventory empty';
    inventoryEl.textContent = 'Инвентарь скрыт.';
    return;
  }
  if (char.id !== invExpandedFor) { expandedCards.clear(); invExpandedFor = char.id; }

  // Сводка по бою со зверем (красная клетка) — первым блоком, до карт
  const bf = char.beastFight;
  const beastInfo = bf
    ? `<div class="beast-info">🐗 ${escapeHtml(bf.name)} — урон ${bf.damage}/ход. `
      + `Убить: кубик ≥${bf.killOn} сразу, или ${bf.needed} успеха (≥${bf.successOn}). `
      + `Успехи: ${bf.successes}/${bf.needed}</div>`
    : '';
  // Обработка шкуры: шаман с «Шкурой убитого зверя» делает из неё очищенную
  // (бросок кубика ≥2). Нужен свободный кубик в свой ход.
  const dice = getDice(char.id);
  const used = getUsedDice(char.id);
  const hasFreeDie = Boolean(dice) && (!used[0] || !used[1]);
  const hasRam = !bf && inv.some(card => card.id === 'sheep_ram');
  const actionRows = [];
  const activeTerrainCards = [...terrainCards.entries()]
    .filter(([, card]) =>
      card.ownerId === myPlayerId
      && card.characterId === char.id
      && !card.faceDown
      && card.cardId)
    .map(([terrainCardId, card]) => ({
      terrainCardId,
      id: card.cardId,
      name: card.cardData?.name ?? getCardName(card.cardId),
    }));
  if (char.frogSpell) {
    actionRows.push(
      `<div class="inventory-action-row"><span>Озёрная лягушка: оружие отключено. Снять заклятие: сумма ${char.frogSpell.dischargeTotal ?? 8}+ на броске.</span></div>`,
    );
  }
  inv.forEach((card, cardIndex) => {
    if (card.id !== 'gold_nugget') return;
    const canHeal = isMyTurn() && Number(char.hp ?? 0) < 100;
    actionRows.push(
      `<div class="inventory-action-row"><span>Малый золотой самородок: восстановить до 20 HP.</span>`
      + `<button class="use-gold-nugget-btn" data-card-index="${cardIndex}" ${canHeal ? '' : 'disabled'}>Лечиться</button></div>`,
    );
  });
  activeTerrainCards.forEach((card) => {
    if (card.id !== 'gold_nugget') return;
    const canHeal = isMyTurn() && Number(char.hp ?? 0) < 100;
    actionRows.push(
      `<div class="inventory-action-row"><span>Малый золотой самородок на террейне: восстановить до 20 HP.</span>`
      + `<button class="use-gold-nugget-btn" data-terrain-card-id="${escapeHtml(card.terrainCardId)}" ${canHeal ? '' : 'disabled'}>Лечиться</button></div>`,
    );
  });
  inv.forEach((card, cardIndex) => {
    if (card.id !== 'dead_ore') return;
    const decks = ['mixed', 'forest', 'dark_forest', 'sheep', 'lake'];
    const buttons = decks.map(deck =>
      `<button class="use-dead-ore-btn" data-card-index="${cardIndex}" data-deck="${deck}" ${isMyTurn() && !bf ? '' : 'disabled'}>${escapeHtml(CARD_DECK_LABELS[deck] ?? deck)}</button>`,
    ).join('');
    actionRows.push(
      `<div class="inventory-action-row"><span>Неживая руда: взять 1 карту из колоды.</span>${buttons}</div>`,
    );
  });
  activeTerrainCards.forEach((card) => {
    if (card.id !== 'dead_ore') return;
    const decks = ['mixed', 'forest', 'dark_forest', 'sheep', 'lake'];
    const buttons = decks.map(deck =>
      `<button class="use-dead-ore-btn" data-terrain-card-id="${escapeHtml(card.terrainCardId)}" data-deck="${deck}" ${isMyTurn() && !bf ? '' : 'disabled'}>${escapeHtml(CARD_DECK_LABELS[deck] ?? deck)}</button>`,
    ).join('');
    actionRows.push(
      `<div class="inventory-action-row"><span>Неживая руда на террейне: взять 1 карту из колоды.</span>${buttons}</div>`,
    );
  });
  if (char.role === 'S') {
    const combatTarget = char.combatOpponentId
      ? getGame().characters.find((candidate) => candidate.id === char.combatOpponentId)
      : null;
    inv.forEach((card, cardIndex) => {
      if (card.id !== 'lake_frog') return;
      const beastButton = bf
        ? `<button class="use-lake-frog-btn" data-card-index="${cardIndex}" data-mode="beast" ${(isMyTurn() ? '' : 'disabled')}>На зверя</button>`
        : '';
      const targetButton = combatTarget
        ? `<button class="use-lake-frog-btn" data-card-index="${cardIndex}" data-target-id="${escapeHtml(combatTarget.id)}" data-mode="player" ${(isMyTurn() && !combatTarget.frogSpell ? '' : 'disabled')}>На врага</button>`
        : '';
      if (!beastButton && !targetButton) return;
      actionRows.push(
        `<div class="inventory-action-row"><span>Озёрная лягушка: заклятие Шамана.</span>${beastButton}${targetButton}</div>`,
      );
    });
    activeTerrainCards.forEach((card) => {
      if (card.id !== 'lake_frog') return;
      const beastButton = bf
        ? `<button class="use-lake-frog-btn" data-terrain-card-id="${escapeHtml(card.terrainCardId)}" data-mode="beast" ${(isMyTurn() ? '' : 'disabled')}>На зверя</button>`
        : '';
      const targetButton = combatTarget
        ? `<button class="use-lake-frog-btn" data-terrain-card-id="${escapeHtml(card.terrainCardId)}" data-target-id="${escapeHtml(combatTarget.id)}" data-mode="player" ${(isMyTurn() && !combatTarget.frogSpell ? '' : 'disabled')}>На врага</button>`
        : '';
      if (!beastButton && !targetButton) return;
      actionRows.push(
        `<div class="inventory-action-row"><span>Озёрная лягушка на террейне: заклятие Шамана.</span>${beastButton}${targetButton}</div>`,
      );
    });
    inv.forEach((card, cardIndex) => {
      if (card.id !== 'marvo') return;
      actionRows.push(
        `<div class="inventory-action-row"><span>Марво трос: Обряд трёх, урон кубик ×10 по врагам рядом.</span>`
        + `<button class="use-marvo-btn" data-card-index="${cardIndex}" ${(isMyTurn() && hasFreeDie ? '' : 'disabled')}>Обряд</button></div>`,
      );
    });
    activeTerrainCards.forEach((card) => {
      if (card.id !== 'marvo') return;
      actionRows.push(
        `<div class="inventory-action-row"><span>Марво трос на террейне: Обряд трёх, урон кубик ×10 по врагам рядом.</span>`
        + `<button class="use-marvo-btn" data-terrain-card-id="${escapeHtml(card.terrainCardId)}" ${(isMyTurn() && hasFreeDie ? '' : 'disabled')}>Обряд</button></div>`,
      );
    });
    activeTerrainCards.forEach((card) => {
      if (card.id !== 'ritual_hide') return;
      const rechargeTargets = getMyChars().filter(target =>
        target.inventory?.some(item => item.id === TELEPORT_ID && item.exhausted),
      );
      if (rechargeTargets.length === 0) return;
      const buttons = rechargeTargets.map(target => {
        const label = ROLE_NAMES[target.role] ?? target.role ?? 'Цель';
        return `<button class="recharge-teleport-btn" data-terrain-card-id="${escapeHtml(card.terrainCardId)}" data-target-id="${escapeHtml(target.id)}" ${(isMyTurn() && hasFreeDie ? '' : 'disabled')}>${escapeHtml(label)}</button>`;
      }).join('');
      actionRows.push(
        `<div class="inventory-action-row"><span>Шкура ритуалов: перезарядить использованные Бусы телепортации, кубик 4+.</span>${buttons}</div>`,
      );
    });
  }
  if (hasRam) {
    actionRows.push(
      `<div class="inventory-action-row"><span>🐏 Баран: кубик 3+ или два успешных удара.</span>`
      + `<button id="fightRamBtn" ${(isMyTurn() && hasFreeDie) ? '' : 'disabled'}>Сразиться с Бараном</button></div>`,
    );
  }
  // DoT-ловушки (Полянка/Дикие ягоды), повешенные на этого персонажа: показываем
  // дебафф и даём кнопку «Стряхнуть» (режим split, кубик ≥ порога).
  for (const [dotIdx, dot] of (char.dots ?? []).entries()) {
    actionRows.push(
      `<div class="inventory-action-row"><span>☠️ ${escapeHtml(dot.name)}: −${dot.damagePerTurn} HP/ход. Сброс кубиком ${dot.dischargeMin}+.</span>`
      + `<button class="discharge-dot-btn" data-dot-index="${dotIdx}" ${(isMyTurn() && hasFreeDie) ? '' : 'disabled'}>Стряхнуть</button></div>`,
    );
  }
  if (char.role === 'S') {
    inv.forEach((card, cardIndex) => {
      if (!RAW_HIDE_IDS.includes(card.id)) return;
      const hideName = card.name ?? getCardName(card.id);
      const actionLabel = RAW_HIDE_ACTION_LABELS[card.id] ?? hideName.toLowerCase();
      const note = card.id === 'sheep_hide_r' ? ' → кожа и шерсть' : ' → очищенная шкура';
      actionRows.push(
        `<div class="inventory-action-row"><span>🧵 ${escapeHtml(hideName)}${note}</span>`
        + `<button class="process-hide-btn" data-card-index="${cardIndex}" ${(isMyTurn() && hasFreeDie) ? '' : 'disabled'}>`
        + `Обработать ${escapeHtml(actionLabel)}</button></div>`,
      );
    });
  }

  // Крафт базового изделия по классу: чертёж/рецепт + запертое изделие + материалы.
  Object.entries(CRAFT_RECIPES)
    .filter(([, r]) => r.role === char.role)
    .forEach(([item, r]) => {
    const has = id => inv.some(c => c.id === id);
    const matsReady = r.materials.every(slot => slot.some(id => has(id)));
    if (has(r.via) && matsReady) {
      const diceReady = !r.diceCount
        || (r.diceCount === 2
          ? Boolean(dice && !used[0] && !used[1])
          : Boolean(dice && (!used[0] || !used[1])));
      const action = char.crafted?.includes(r.result) ? 'Сделать ещё' : 'Открыть';
      const requirement = r.diceCount === 2 && !diceReady
        ? ` Нужны оба свободных кубика, каждый ${r.diceMin}+.`
        : r.diceCount === 1 && !diceReady
          ? ` Нужен свободный кубик ${r.diceMin}+.`
          : '';
      actionRows.push(
        `<div class="inventory-action-row"><span>🔨 ${action} «${r.label}».${requirement}</span>`
        + `<button class="craft-btn" data-item="${item}" ${(isMyTurn() && diceReady) ? '' : 'disabled'}>`
        + `${action} «${r.label}»</button></div>`,
      );
    }
  });
  const actionsInfo = actionRows.length
    ? `<div class="inventory-actions"><div class="inventory-actions-title">Доступные действия</div>${actionRows.join('')}</div>`
    : '';

  const visibleCards = inv
    .map((card, index) => ({ card, index }));
  inventoryEl.className = (visibleCards.length || bf) ? 'inventory' : 'inventory empty';
  inventoryEl.innerHTML = visibleCards.length
    ? beastInfo + actionsInfo
      + `<div class="inventory-cards-strip">${visibleCards.map(({ card, index }) => renderCard(card, index)).join('')}</div>`
    : (beastInfo || 'Инвентарь пуст.');
  inventoryEl.querySelectorAll('.craft-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation(); // не раскрывать карту под кнопкой
    const dieIndex = firstFreeDieIndexFor(char.id);
    const payload = {
      characterId: char.id,
      item: e.currentTarget.dataset.item,
    };
    if (dieIndex != null) payload.dieIndex = dieIndex;
    wsSend('action:craft', payload);
  }));
  inventoryEl.querySelectorAll('.process-hide-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    const dieIndex = firstFreeDieIndexFor(char.id);
    if (dieIndex == null) { addLog('Нет свободного кубика для обработки.', { type: 'err' }); return; }
    if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });
    wsSend('action:processHide', {
      characterId: char.id,
      dieIndex,
      cardIndex: Number(e.currentTarget.dataset.cardIndex),
    });
  }));
  inventoryEl.querySelector('#fightRamBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fightBeast();
  });
  const cardActionPayload = (button) => {
    const payload = { characterId: char.id };
    if (button.dataset.terrainCardId) payload.terrainCardId = button.dataset.terrainCardId;
    else payload.cardIndex = Number(button.dataset.cardIndex);
    return payload;
  };
  inventoryEl.querySelectorAll('.use-gold-nugget-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    wsSend('action:useGoldNugget', cardActionPayload(e.currentTarget));
  }));
  inventoryEl.querySelectorAll('.use-dead-ore-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    wsSend('action:useDeadOre', {
      ...cardActionPayload(e.currentTarget),
      deck: e.currentTarget.dataset.deck,
    });
  }));
  inventoryEl.querySelectorAll('.use-lake-frog-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    const payload = cardActionPayload(e.currentTarget);
    if (e.currentTarget.dataset.targetId) payload.targetId = e.currentTarget.dataset.targetId;
    wsSend('action:useLakeFrog', payload);
  }));
  inventoryEl.querySelectorAll('.use-marvo-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    const dieIndex = firstFreeDieIndexFor(char.id);
    if (dieIndex == null) { addLog('Нет свободного кубика для Обряда трёх.', { type: 'err' }); return; }
    if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });
    wsSend('action:useMarvo', {
      ...cardActionPayload(e.currentTarget),
      dieIndex,
    });
  }));
  inventoryEl.querySelectorAll('.recharge-teleport-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    const dieIndex = firstFreeDieIndexFor(char.id);
    if (dieIndex == null) { addLog('Нет свободного кубика для перезарядки Бус телепортации.', { type: 'err' }); return; }
    if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });
    wsSend('action:rechargeTeleport', {
      ...cardActionPayload(e.currentTarget),
      targetId: e.currentTarget.dataset.targetId,
      dieIndex,
    });
  }));
  inventoryEl.querySelectorAll('.discharge-dot-btn').forEach((button) => button.addEventListener('click', (e) => {
    e.stopPropagation();
    const dieIndex = firstFreeDieIndexFor(char.id);
    if (dieIndex == null) { addLog('Нет свободного кубика, чтобы стряхнуть ловушку.', { type: 'err' }); return; }
    if (getServMode(char.id) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: char.id });
    wsSend('action:dischargeDot', {
      characterId: char.id,
      dotIndex: Number(e.currentTarget.dataset.dotIndex),
      dieIndex,
    });
  }));
}

// Сырые шкуры — вход обработки шамана (синхронно с сервером).
const RAW_HIDE_IDS = ['raw_hide', 'raw_hide_red', 'boar_hide', 'wolf_hide', 'bear_hide', 'sheep_hide_r'];
const RAW_HIDE_ACTION_LABELS = {
  raw_hide: 'шкуру убитого зверя',
  raw_hide_red: 'шкуру убитого зверя',
  boar_hide: 'шкуру кабана',
  wolf_hide: 'шкуру волка',
  bear_hide: 'шкуру медведя',
  sheep_hide_r: 'шкуру барана',
};
const SHAMAN_CARPET_MATERIALS = [
  'raw_hide',
  'raw_hide_red',
  'boar_hide',
  'wolf_hide',
  'bear_hide',
  'beast_hide',
  'hide_red',
  'sheep_hide_r',
  'sheep_hide_c',
];

// Рецепты базовых изделий — зеркало server CRAFT_RECIPES (для кнопок крафта).
const CRAFT_RECIPES = {
  club:   { role: 'V', via: 'bp_club_base',   result: 'club',   label: 'Дубина',  materials: [['beast_hide', 'hide_red']] },
  hammer: { role: 'K', via: 'bp_hammer_base', result: 'hammer', label: 'Молоток', materials: [['ore_medium']], diceCount: 2, diceMin: 3 },
  sack:   { role: 'P', via: 'recipe_sack',    result: 'sack',   label: 'Мешок',   materials: [['yarn'], ['sheep_hide_c']], diceCount: 2, diceMin: 3 },
  shaman_carpet: { role: 'S', via: 'recipe_shaman_carpet', result: 'shaman_carpet', label: 'Ковёр шамана', materials: [['yarn'], SHAMAN_CARPET_MATERIALS], diceCount: 1, diceMin: 3 },
  armor_zhest: { role: 'S', via: 'recipe_armor', result: 'armor_zhest', label: 'Жест', materials: [['ore_medium', 'ore_coarse'], ['raw_hide', 'raw_hide_red', 'wolf_hide', 'boar_hide', 'bear_hide']], diceCount: 2, diceMin: 3 },
  marvo: { role: 'S', via: 'recipe_obrud', result: 'marvo', label: 'Марво трос', materials: [['amanita_glade'], ['lake_frog']], diceCount: 2, diceMin: 2 },
  yarn: { role: 'S', via: 'sheep_wool', result: 'yarn', label: 'Клубок сплетённой шерсти', materials: [], diceCount: 1, diceMin: 2 },
  irikon: { role: 'K', via: 'blueprint_irikon', result: 'irikon', label: 'Молот Иерихон', materials: [['task_irikon'], GOLD_FEATHER_IDS], diceCount: 2, diceMin: 3 },
};

const CARD_TYPE_LABELS = {
  weapon: 'оружие', armor: 'броня', tool: 'инструмент', ingredient: 'ингредиент',
  blueprint: 'чертёж', recipe: 'рецепт', companion: 'спутник', beast: 'зверь',
  special: 'особая', provocation: 'провокация',
};

const CARD_DECK_LABELS = {
  mixed: 'смешанный грунт',
  forest: 'лес',
  dark_forest: 'тёмный лес',
  sheep: 'баран',
  red: 'красная',
  lake: 'озеро',
  recipes: 'рецепты',
  blueprints: 'чертежи',
  fairy_glade: 'сказочная опушка',
  trophy: 'трофей',
  base: 'базовая',
  unknown: 'карта',
};

function cardVisualMeta(card) {
  const id = card?.id ?? '';
  const catalog = CARD_CATALOG_META[id] ?? {};
  return {
    id,
    name: (card?.name ?? catalog.name ?? id) || 'Карта',
    type: card?.type ?? catalog.type ?? 'unknown',
    deck: card?.deck ?? catalog.deck ?? cardDeck(id),
  };
}

function cardInitials(name) {
  return String(name)
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function cardClassToken(value) {
  return String(value ?? 'unknown').replace(/[^a-z0-9_-]/gi, '_');
}

function renderGeneratedCardArt(card, size = 'inventory') {
  const meta = cardVisualMeta(card);
  const typeLabel = CARD_TYPE_LABELS[meta.type] ?? meta.type;
  const deckLabel = CARD_DECK_LABELS[meta.deck] ?? meta.deck;
  return `<div class="generated-card-art generated-card-${cardClassToken(size)} card-${cardClassToken(meta.type)} deck-${cardClassToken(meta.deck)}">`
    + `<div class="generated-card-frame">`
    +   `<div class="generated-card-deck">${escapeHtml(deckLabel)}</div>`
    +   `<div class="generated-card-symbol">${escapeHtml(cardInitials(meta.name))}</div>`
    +   `<div class="generated-card-title">${escapeHtml(meta.name)}</div>`
    +   `<div class="generated-card-type">${escapeHtml(typeLabel)}</div>`
    + `</div>`
    + `</div>`;
}

function appendGeneratedCardArt(parent, card, size = 'terrain') {
  const holder = document.createElement('div');
  holder.innerHTML = renderGeneratedCardArt(card, size);
  parent.appendChild(holder.firstElementChild);
}

function renderCard(c, i = 0, forceOpen = false) {
  // c = { id, name, type, locked, desc }; легаси-строку (если придёт) тоже покажем
  if (typeof c === 'string') return `<div class="card">${escapeHtml(c)}</div>`;
  const art = CARD_FACE_ART[c.id];
  const visualMeta = cardVisualMeta(c);
  const typeLabel = CARD_TYPE_LABELS[visualMeta.type] ?? visualMeta.type;
  const deckLabel = CARD_DECK_LABELS[visualMeta.deck] ?? visualMeta.deck;
  const cardDesc = cardDescription({ ...visualMeta, ...c }, deckLabel, typeLabel);
  const locked = c.locked ? '<span class="card-lock" title="Откроется после крафта">🔒</span>' : '';
  const hasDesc = Boolean(cardDesc);
  const open = forceOpen || expandedCards.has(i);
  const selected = getSelChar();
  const manuallyFaceDown = selected && faceDownCards.has(`${selected.id}:${i}`);
  const showBack = c.exhausted || c.hidden || manuallyFaceDown;
  const faceArt = showBack ? cardBackArt(c.id) : cardFaceArtUrl(art);
  const flipControl = !c.exhausted && !c.hidden && !c.locked
    ? `<button class="card-flip-btn" type="button" aria-label="${manuallyFaceDown ? 'Перевернуть лицом вверх' : 'Перевернуть рубашкой вверх'}" title="${manuallyFaceDown ? 'Перевернуть лицом вверх' : 'Перевернуть рубашкой вверх'}">↻</button>`
    : '';
  const discardControl = !c.hidden
    ? `<button class="card-discard-btn" type="button" aria-label="Удалить карту" title="Удалить карту">×</button>`
    : '';
  const desc = hasDesc && open ? `<div class="card-desc">${escapeHtml(cardDesc)}</div>` : '';
  const face = faceArt
    ? `<img class="inventory-card-art" src="${faceArt}" alt="${escapeHtml(visualMeta.name)}" draggable="false" />`
    : renderGeneratedCardArt(c, 'inventory');

  return `<div class="card card-face card-${c.type ?? visualMeta.type ?? 'unknown'}${c.locked ? ' card-locked' : ''}${c.exhausted ? ' card-exhausted' : ''}${manuallyFaceDown ? ' card-face-down' : ''}${open ? ' expanded' : ''}" data-i="${i}" title="${escapeHtml(visualMeta.name)}${c.exhausted ? ' — использована' : manuallyFaceDown ? ' — рубашкой вверх' : ''}"${!c.exhausted && !c.hidden ? ' role="button" tabindex="0"' : ''}>`
    + face
    + locked
    + flipControl
    + discardControl
    + (c.exhausted ? '<span class="card-used-mark">использована</span>'
      : manuallyFaceDown ? '<span class="card-used-mark">скрыта</span>' : '')
    + (showBack ? '' : desc)
    + `</div>`;
}

// Тап по карте открывает увеличенную карту; размер инвентаря не меняем.
function onInventoryClick(e) {
  if (Date.now() < invSuppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (invDrag?.started) return; // был драг, не раскрываем
  const card = e.target.closest('.card[data-i]');
  if (!card || !inventoryEl.contains(card)) return;
  const i = Number(card.dataset.i);
  const char = getSelChar();
  const item = char?.inventory?.[i];
  if (e.target.closest('.card-discard-btn') && char && item) {
    e.stopPropagation();
    discardInventoryCard(char, i, item);
    return;
  }
  if (e.target.closest('.card-flip-btn') && char && item && !item.exhausted && !item.locked) {
    e.stopPropagation();
    const key = `${char.id}:${i}`;
    if (faceDownCards.has(key)) faceDownCards.delete(key); else faceDownCards.add(key);
    renderInventory();
    return;
  }
  if (item) {
    showInventoryCard(item, i);
    pushCardTutorial(item);
  }
}

function discardInventoryCard(char, cardIndex, card) {
  if (!char || cardIndex == null || !card) return;
  const cardName = card.name ?? getCardName(card.id ?? card);
  if (!window.confirm(`Точно удалить карту «${cardName}»?`)) return;
  wsSend('action:discardCard', {
    characterId: char.id,
    cardIndex,
  });
  hideEventOverlay();
}

// ── Перетаскивание карт из инвентаря на террейн ──
// Используем pointer-события на inventoryEl, совместимые с click-to-expand.
const INV_DRAG_THRESHOLD = 8;

inventoryEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.card-flip-btn, .card-discard-btn')) return;
  const cardEl = e.target.closest('.card.card-face[data-i]');
  if (!cardEl) return;
  const char = getSelChar();
  if (!char || !isMyTurn()) return;
  const i = Number(cardEl.dataset.i);
  const card = char.inventory[i];
  if (!card || card.locked || card.exhausted) return;
  invDrag = {
    cardIndex: i,
    ghost: null,
    srcEl: cardEl,
    captureEl: cardEl,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    pointerType: e.pointerType,
    started: false,
  };
});

document.addEventListener('pointermove', (e) => {
  if (!invDrag || e.pointerId !== invDrag.pointerId) return;
  if (invDrag.started) {
    e.preventDefault();
    if (invDrag.ghost) moveInvGhost(e);
    return;
  }
  const dx = e.clientX - invDrag.startX;
  const dy = e.clientY - invDrag.startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (invDrag.pointerType === 'touch' && absDx > INV_DRAG_THRESHOLD && absDx > absDy * 1.2) {
    invSuppressClickUntil = Date.now() + 350;
    invDrag = null;
    return;
  }
  if (Math.hypot(dx, dy) > INV_DRAG_THRESHOLD) {
    e.preventDefault();
    invDrag.started = true;
    invDrag.srcEl.setPointerCapture?.(e.pointerId);
    const ghost = invDrag.srcEl.cloneNode(true);
    ghost.classList.add('inv-drag-ghost');
    document.body.appendChild(ghost);
    invDrag.ghost = ghost;
    invDrag.srcEl.classList.add('dragging');
    moveInvGhost(e);
  }
});

document.addEventListener('pointercancel', (e) => {
  if (!invDrag || e.pointerId !== invDrag.pointerId) return;
  releaseInvPointerCapture(invDrag);
  if (invDrag.ghost) invDrag.ghost.remove();
  if (invDrag.srcEl) invDrag.srcEl.classList.remove('dragging');
  invDrag = null;
});

document.addEventListener('pointerup', (e) => {
  if (!invDrag || e.pointerId !== invDrag.pointerId) return;
  const { started, cardIndex } = invDrag;
  releaseInvPointerCapture(invDrag);
  if (invDrag.ghost) invDrag.ghost.remove();
  if (invDrag.srcEl) invDrag.srcEl.classList.remove('dragging');
  const drag = invDrag;
  invDrag = null;

  if (!started || !drag.started) return; // без драга — click сработает как обычно

  // Сброс на террейн: конвертируем клиентские координаты в viewBox
  if (!boardSvg) return;
  const rect = boardSvg.getBoundingClientRect();
  if (!rect || rect.width === 0) return;
  const { k } = svgK();
  const releasedOnBoard = e.clientX >= rect.left
    && e.clientX <= rect.right
    && e.clientY >= rect.top
    && e.clientY <= rect.bottom;
  const clientX = releasedOnBoard ? e.clientX : rect.left + rect.width / 2;
  const clientY = releasedOnBoard ? e.clientY : rect.top + rect.height / 2;
  const vbX = (clientX - rect.left) / k;
  const vbY = (clientY - rect.top) / k;
  const rawWorldX = (vbX - view.tx) / view.s;
  const rawWorldY = (vbY - view.ty) / view.s;
  const terrainCardW = HEX_R * 3.5;
  const terrainCardH = terrainCardW * (512 / 341);
  const worldX = Math.max(terrainCardW / 2, Math.min(VBW - terrainCardW / 2, rawWorldX));
  const worldY = Math.max(terrainCardH / 2, Math.min(VBH - terrainCardH / 2, rawWorldY));

  const char = getSelChar();
  if (!char) return;
  const card = char.inventory[cardIndex];
  if (!card) return;

  // Уникальный ключ для каждой карты на террейне
  const uid = `terrain_${card.id}_${Date.now()}`;
  const faceDownKey = `${char.id}:${cardIndex}`;
  const faceDown = faceDownCards.has(faceDownKey);
  wsSend('action:terrainPlace', {
    id: uid,
    characterId: char.id,
    cardIndex,
    x: worldX,
    y: worldY,
    faceDown,
  });
  faceDownCards.delete(faceDownKey);
});

function releaseInvPointerCapture(drag) {
  if (!drag?.captureEl?.hasPointerCapture?.(drag.pointerId)) return;
  drag.captureEl.releasePointerCapture(drag.pointerId);
}

function moveInvGhost(e) {
  if (!invDrag?.ghost) return;
  invDrag.ghost.style.left = `${e.clientX}px`;
  invDrag.ghost.style.top = `${e.clientY}px`;
}

function triggerAttackEffect(targetId) {
  attackFxTargetId = targetId;
  clearTimeout(attackFxTimer);
  attackFxTimer = setTimeout(() => {
    attackFxTargetId = null;
    renderBoard();
  }, 480);
}

function triggerCharacterNavHitEffect(characterId) {
  if (!characterId) return;
  characterNavHitIds.add(characterId);
  clearTimeout(characterNavHitTimers.get(characterId));
  renderCharacters();
  characterNavHitTimers.set(characterId, setTimeout(() => {
    characterNavHitIds.delete(characterId);
    characterNavHitTimers.delete(characterId);
    renderCharacters();
  }, 650));
}

function clearCharacterNavHitEffects() {
  for (const timer of characterNavHitTimers.values()) clearTimeout(timer);
  characterNavHitTimers.clear();
  characterNavHitIds.clear();
}

function showDamageNumber({ charId = null, cellId = null, amount, overBeast = false }) {
  if (!boardVp || !amount) return;
  const char = charId ? getGame()?.characters.find(item => item.id === charId) : null;
  const pos = cellId ?? (char ? (tokenDisplayPos.get(char.id) ?? characterPosition(char)) : null);
  const ctr = cellCenter(pos);
  const beastRect = overBeast && charId ? beastCardRects.get(charId) : null;
  if (!ctr && !beastRect) return;

  const text = document.createElementNS(svgNS, 'text');
  const x = beastRect ? beastRect.x + beastRect.w / 2 : ctr.cx;
  const y = beastRect ? beastRect.y + beastRect.h * 0.48 : ctr.cy - HEX_R * 1.55;
  text.setAttribute('class', 'damage-float');
  text.setAttribute('x', x.toFixed(2));
  text.setAttribute('y', y.toFixed(2));
  text.style.fontSize = `${HEX_R * 1.45}px`;
  text.textContent = `−${amount}`;
  getDamageLayer().appendChild(text);
  setTimeout(() => text.remove(), 1550);
}

function getDamageLayer() {
  let layer = boardVp.querySelector('#damageLayer');
  if (!layer) {
    layer = document.createElementNS(svgNS, 'g');
    layer.setAttribute('id', 'damageLayer');
    layer.setAttribute('pointer-events', 'none');
  }
  boardVp.appendChild(layer);
  return layer;
}

function bringDamageLayerToFront() {
  const layer = boardVp?.querySelector('#damageLayer');
  if (layer) boardVp.appendChild(layer);
}

// ═════════════════════════════════════════════════════════════════
// «Ящик» — карты всей команды, передача перетаскиванием (drag-and-drop)
// ═════════════════════════════════════════════════════════════════

function buildCardBox() {
  cardBoxEl = document.createElement('div');
  cardBoxEl.id = 'cardBox';
  cardBoxEl.className = 'cardbox-overlay hidden';
  cardBoxEl.innerHTML = `
    <div class="cardbox">
      <div class="cardbox-head">
        <span class="cardbox-title">🧰 Карты команды</span>
        <button class="cardbox-close" id="cardBoxClose" aria-label="Закрыть">✕</button>
      </div>
      <div class="cardbox-transfer-targets" id="cardBoxTransferTargets"></div>
      <div class="cardbox-rows" id="cardBoxRows"></div>
      <div class="cardbox-hint" id="cardBoxHint"></div>
    </div>`;
  document.body.appendChild(cardBoxEl);
  cardBoxEl.querySelector('#cardBoxClose').addEventListener('click', closeCardBox);
  cardBoxEl.addEventListener('click', onCardBoxClick);
  const rows = cardBoxEl.querySelector('#cardBoxRows');
  rows.addEventListener('pointerdown', onCbxPointerDown);
  rows.addEventListener('pointermove', onCbxPointerMove);
  rows.addEventListener('pointerup', onCbxPointerUp);
  rows.addEventListener('pointercancel', onCbxPointerUp);
}

function openCardBox() {
  if (!cardBoxEl) buildCardBox();
  cardBoxEl.classList.remove('hidden');
  renderCardBox();
}

function closeCardBox() {
  cancelCbxDrag();
  clearCbxTransferPick();
  cardBoxEl?.classList.add('hidden');
}

function transferRemaining() {
  return getGame()?.turn.transferRemaining ?? 0;
}

function hasFreeDie() {
  return getMyChars().some((char) => {
    const dice = getDice(char.id);
    const used = getUsedDice(char.id);
    return Boolean(dice && !(used[0] && used[1]));
  });
}

function canTransferNow() {
  if (!isMyTurn()) return false;
  return transferRemaining() > 0 || hasFreeDie();
}

function renderCardBox() {
  if (!cardBoxEl) return;
  if (!isValidCbxTransferPick()) cbxTransferPick = null;
  const rowsEl = cardBoxEl.querySelector('#cardBoxRows');
  const targetsEl = cardBoxEl.querySelector('#cardBoxTransferTargets');
  rowsEl.innerHTML = getMyChars().map(renderCbxRow).join('');
  targetsEl.innerHTML = cbxTransferPick
    ? getMyChars()
      .filter((char) => char.id !== cbxTransferPick.fromId)
      .map((char) =>
        `<button class="cbx-target-btn" data-target-id="${escapeHtml(char.id)}">${escapeHtml(ROLE_NAMES[char.role] ?? char.role)}</button>`)
      .join('')
    : '';
  const can = canTransferNow();
  const left = transferRemaining();
  cardBoxEl.classList.toggle('can-transfer', can);
  cardBoxEl.classList.toggle('has-transfer-pick', Boolean(cbxTransferPick));
  let hint;
  if (!can) {
    hint = 'Передача — в ваш ход при свободном кубике. Сейчас доступен просмотр.';
  } else if (cbxTransferPick) {
    hint = `Выбрана карта «${cbxTransferPick.cardName}». Нажмите строку персонажа-получателя.`;
  } else if (left > 0) {
    hint = `Передача открыта: можно переместить ещё ${left} карт${cardWordTail(left)}. Нажмите карту, затем персонажа-получателя.`;
  } else {
    hint = 'Нажмите карту, затем персонажа-получателя. Можно также перетащить карту мышью.';
  }
  cardBoxEl.querySelector('#cardBoxHint').textContent = hint;
}

function onCardBoxClick(e) {
  if (e.target === cardBoxEl) {
    closeCardBox();
    return;
  }
  if (cbxSuppressClick) {
    cbxSuppressClick = false;
    return;
  }
  const targetButton = e.target.closest('.cbx-target-btn');
  if (targetButton && cbxTransferPick) {
    const { fromId, cardIndex } = cbxTransferPick;
    attemptCardTransfer(fromId, targetButton.dataset.targetId, cardIndex);
    return;
  }
  const row = e.target.closest('.cbx-row');
  const card = e.target.closest('.cbx-card');
  if (!row || !cardBoxEl.contains(row)) return;
  const toId = row.dataset.charId;
  if (cbxTransferPick && toId && toId !== cbxTransferPick.fromId) {
    const { fromId, cardIndex } = cbxTransferPick;
    clearCbxTransferPick();
    attemptCardTransfer(fromId, toId, cardIndex);
    return;
  }
  if (card && canTransferNow()) {
    selectCbxTransferCard(card);
  } else if (cbxTransferPick) {
    clearCbxTransferPick();
    renderCardBox();
  }
}

function clearCbxTransferPick() {
  cbxTransferPick = null;
}

function isValidCbxTransferPick() {
  if (!cbxTransferPick) return true;
  const from = getMyChars().find((char) => char.id === cbxTransferPick.fromId);
  return Boolean(from?.inventory?.[cbxTransferPick.cardIndex]);
}

function selectCbxTransferCard(cardEl) {
  cbxTransferPick = {
    fromId: cardEl.dataset.charId,
    cardIndex: Number(cardEl.dataset.i),
    cardName: cardEl.dataset.cardName || cardEl.title || 'карта',
  };
  renderCardBox();
}

// «карт» / «карту» / «карты» по числу
function cardWordTail(n) {
  const d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return 'у';
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'ы';
  return '';
}

function renderCbxRow(char) {
  const side = charSide(char);
  const inv = char.inventory ?? [];
  const isTarget = cbxTransferPick && cbxTransferPick.fromId !== char.id;
  const isSource = cbxTransferPick && cbxTransferPick.fromId === char.id;
  // Бусы телепортации — отдельный фиксированный слот справа в ряду персонажа
  // (как в физическом ящике). Берём ПОСЛЕДНИЕ Бусы в инвентаре, чтобы при
  // нескольких копиях остальные показались среди обычных карт.
  let teleI = -1;
  for (let i = inv.length - 1; i >= 0; i -= 1) {
    if ((inv[i].id ?? inv[i]) === TELEPORT_ID) { teleI = i; break; }
  }
  const otherSlots = inv
    .map((c, i) => (i === teleI ? '' : renderCbxCard(c, char.id, i)))
    .join('') || '<span class="cbx-empty">пусто</span>';
  const teleSlot = teleI >= 0
    ? renderCbxCard(inv[teleI], char.id, teleI)
    : '<div class="cbx-tele-empty" title="Слот Бус телепортации">∅</div>';
  return `<div class="cbx-row${isTarget ? ' transfer-target' : ''}${isSource ? ' transfer-source' : ''}" data-char-id="${char.id}">`
    + `<div class="cbx-portrait side-${side}">`
    +   `<img src="${charCardArt(char.role)}" alt="${ROLE_NAMES[char.role]}" />`
    +   `<span class="cbx-hp">${char.hp ?? 100}</span>`
    + `</div>`
    + `<div class="cbx-slots">${otherSlots}</div>`
    + `<div class="cbx-tele-slot">${teleSlot}</div>`
    + `</div>`;
}

function renderCbxCard(c, charId, i) {
  if (typeof c === 'string') c = { name: c, type: 'unknown', locked: false };
  const visualMeta = cardVisualMeta(c);
  const art = CARD_FACE_ART[c.id];
  const imageSrc = c.exhausted ? cardBackArt(c.id) : cardFaceArtUrl(art);
  const face = imageSrc
    ? `<img class="cbx-card-art" src="${imageSrc}" alt="" draggable="false" />`
    : renderGeneratedCardArt(c, 'cbx');
  const lock = c.locked ? '<span class="cbx-lock" aria-label="Карта закрыта">🔒</span>' : '';
  const selected = cbxTransferPick?.fromId === charId && cbxTransferPick.cardIndex === i;
  return `<div class="cbx-card card-${c.type ?? 'unknown'}${c.locked ? ' card-locked' : ''}${c.exhausted ? ' card-exhausted' : ''}${selected ? ' selected-transfer' : ''}"`
    + ` data-char-id="${charId}" data-i="${i}" data-card-name="${escapeHtml(visualMeta.name)}" title="${escapeHtml(visualMeta.name)}">`
    + face
    + lock
    + `</div>`;
}

// ── Перетаскивание (pointer-based, работает на тач и мыши) ──
function onCbxPointerDown(e) {
  const cardEl = e.target.closest('.cbx-card');
  if (!cardEl || !canTransferNow()) return; // не свой ход / нет кубика → просто просмотр
  if (cbxTransferPick && cardEl.dataset.charId !== cbxTransferPick.fromId) return;
  clearCbxTransferPick();
  e.preventDefault();
  const ghost = cardEl.cloneNode(true);
  ghost.classList.add('cbx-ghost');
  document.body.appendChild(ghost);
  cardEl.classList.add('dragging');
  cbxDrag = {
    fromId: cardEl.dataset.charId,
    cardIndex: Number(cardEl.dataset.i),
    cardName: cardEl.dataset.cardName || cardEl.title || 'карта',
    ghost,
    srcEl: cardEl,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
  moveGhost(e);
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function onCbxPointerMove(e) {
  if (!cbxDrag) return;
  e.preventDefault();
  const dx = e.clientX - cbxDrag.startX;
  const dy = e.clientY - cbxDrag.startY;
  if ((dx * dx + dy * dy) > 36) cbxDrag.moved = true;
  moveGhost(e);
  const row = rowUnder(e);
  cardBoxEl.querySelectorAll('.cbx-row').forEach(r =>
    r.classList.toggle('drop-target', r === row && r.dataset.charId !== cbxDrag.fromId));
}

function onCbxPointerUp(e) {
  if (!cbxDrag) return;
  const toId = rowUnder(e)?.dataset.charId;
  const { fromId, cardIndex, cardName, moved } = cbxDrag;
  cancelCbxDrag();
  if (!moved && (!toId || toId === fromId)) {
    cbxTransferPick = { fromId, cardIndex, cardName };
    cbxSuppressClick = true;
    renderCardBox();
    return;
  }
  // Передача без ограничения расстояния — любому своему персонажу
  if (toId && toId !== fromId) attemptCardTransfer(fromId, toId, cardIndex);
}

function moveGhost(e) {
  if (!cbxDrag) return;
  cbxDrag.ghost.style.left = `${e.clientX}px`;
  cbxDrag.ghost.style.top = `${e.clientY}px`;
}

function rowUnder(e) {
  return document.elementFromPoint(e.clientX, e.clientY)?.closest('.cbx-row') ?? null;
}

function cancelCbxDrag() {
  if (!cbxDrag) return;
  cbxDrag.ghost?.remove();
  cbxDrag.srcEl?.classList.remove('dragging');
  cardBoxEl?.querySelectorAll('.cbx-row.drop-target').forEach(r => r.classList.remove('drop-target'));
  cbxDrag = null;
}

function attemptCardTransfer(fromId, toId, cardIndex) {
  clearCbxTransferPick();
  if (!canTransferNow()) { renderCardBox(); return; }
  // Передача уже открыта (кубик потрачен) — двигаем в счёт бюджета, без кубика
  if (transferRemaining() > 0) {
    wsSend('action:transfer', { fromId, toId, cardIndex });
    return;
  }
  // Первый перенос за ход — тратим свободный кубик, его значение задаёт бюджет
  const dieIndex = firstFreeDieIndexFor(fromId);
  if (dieIndex == null) { addLog('Нет свободного кубика для передачи.', { type: 'err' }); renderCardBox(); return; }
  if (getServMode(fromId) !== 'split') wsSend('turn:setMode', { mode: 'split', characterId: fromId });
  wsSend('action:transfer', { fromId, toId, cardIndex, dieIndex });
  // снапшот придёт и перерисует ящик
}

// ═════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════
// Combat on field — beast card on hex, terrain card system
// ═════════════════════════════════════════════════════════════════

const BEAST_CARD_ART = {
  wolf: 'beasts/red/gray-wolf-v1', beast_bear: 'beasts/red/mystical-bear-v1',
  boar_red: 'beasts/red/wild-boar-v1', boar_forest: 'beasts/red/wild-boar-v1',
};
const charCardArt  = (role) => cardFaceArtUrl(CHAR_CARD_ART[role] ?? 'base/warrior/warrior-v3');
const beastCardArt = (id) => {
  const art = BEAST_CARD_ART[id] ?? CARD_FACE_ART[id];
  return cardFaceArtUrl(art);
};

function rectsOverlap(a, b) {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
}

function placeBeastCard(ctr, w, h, occupiedCenters, placedRects) {
  const margin = HEX_R * 0.7;
  const labelSpace = HEX_R * 0.8;
  const gap = HEX_R * 1.1;
  const maxX = Math.max(margin, VBW - margin - w);
  const maxY = Math.max(margin, VBH - margin - h - labelSpace);
  const candidates = [
    { x: ctr.cx - w - gap, y: ctr.cy - h / 2 },
    { x: ctr.cx + gap, y: ctr.cy - h / 2 },
    { x: ctr.cx - w / 2, y: ctr.cy - h - gap },
    { x: ctr.cx - w / 2, y: ctr.cy + gap },
  ];

  return candidates
    .map((candidate, index) => {
      const rect = {
        x: Math.max(margin, Math.min(maxX, candidate.x)),
        y: Math.max(margin, Math.min(maxY, candidate.y)),
        w,
        h,
      };
      let score = Math.hypot(rect.x - candidate.x, rect.y - candidate.y) + index * 0.01;
      const tokenPadding = HEX_R * 1.45;
      for (const center of occupiedCenters) {
        if (
          center.cx >= rect.x - tokenPadding
          && center.cx <= rect.x + rect.w + tokenPadding
          && center.cy >= rect.y - tokenPadding
          && center.cy <= rect.y + rect.h + tokenPadding
        ) {
          score += 10000;
        }
      }
      for (const placed of placedRects) {
        if (rectsOverlap(rect, placed)) score += 20000;
      }
      return { rect, score };
    })
    .sort((a, b) => a.score - b.score)[0].rect;
}

function centerInsideRect(center, rect, padding = 0) {
  return center.cx >= rect.x - padding
    && center.cx <= rect.x + rect.w + padding
    && center.cy >= rect.y - padding
    && center.cy <= rect.y + rect.h + padding;
}

function terrainCardAvoidCenters(game) {
  const centers = [];
  for (const char of game.characters ?? []) {
    const center = cellCenter(tokenDisplayPos.get(char.id) ?? characterPosition(char));
    if (center) centers.push(center);
  }
  for (const unit of game.dwarves?.units ?? []) {
    if (!unit.alive || !unit.position) continue;
    const center = cellCenter(unit.position);
    if (center) centers.push(center);
  }
  const selected = getSelChar();
  if (selected) {
    for (const cellId of validTargets(selected)) {
      const center = cellCenter(cellId);
      if (center) centers.push(center);
    }
  }
  return centers;
}

function placeTerrainCard(anchor, w, h, avoidCenters, placedRects) {
  const margin = HEX_R * 0.45;
  const gap = HEX_R * 0.75;
  const maxX = Math.max(margin, VBW - margin - w);
  const maxY = Math.max(margin, VBH - margin - h);
  const base = { x: anchor.x - w / 2, y: anchor.y - h / 2 };
  const candidates = [
    base,
    { x: anchor.x - w - gap, y: anchor.y - h / 2 },
    { x: anchor.x + gap, y: anchor.y - h / 2 },
    { x: anchor.x - w / 2, y: anchor.y - h - gap },
    { x: anchor.x - w / 2, y: anchor.y + gap },
    { x: anchor.x - w - gap, y: anchor.y - h - gap },
    { x: anchor.x + gap, y: anchor.y - h - gap },
    { x: anchor.x - w - gap, y: anchor.y + gap },
    { x: anchor.x + gap, y: anchor.y + gap },
  ];
  return candidates
    .map((candidate, index) => {
      const rect = {
        x: Math.max(margin, Math.min(maxX, candidate.x)),
        y: Math.max(margin, Math.min(maxY, candidate.y)),
        w,
        h,
      };
      let score = Math.hypot(rect.x - base.x, rect.y - base.y) + index * 0.01;
      for (const center of avoidCenters) {
        if (centerInsideRect(center, rect, HEX_R * 0.95)) score += 100000;
      }
      for (const placed of placedRects) {
        if (rectsOverlap(rect, placed)) score += 20000;
      }
      return { rect, score };
    })
    .sort((a, b) => a.score - b.score)[0].rect;
}

// Рендер карты зверя рядом с гексом и карт на террейне (вызывается из renderBoard)
function renderCombatBoardElements(fogCircles) {
  if (!boardVp) return;
  boardVp.querySelectorAll('.combat-element').forEach(n => n.remove());
  beastCardRects.clear();

  const g = getGame();
  if (!g) return;

  const occupiedCenters = g.characters
    .map(char => cellCenter(tokenDisplayPos.get(char.id) ?? characterPosition(char)))
    .filter(Boolean);
  const placedBeastRects = [];

  // Карта зверя: для каждого своего персонажа в beastFight — карта над хексом
  for (const char of getMyChars()) {
    if (!char.beastFight) continue;
    const bf = char.beastFight;
    const pos = bf.cellId ?? characterPosition(char);
    const ctr = cellCenter(pos);
    if (!ctr) continue;
    const w = HEX_R * 5.5;
    const h = w * (512 / 341);
    const rect = placeBeastCard(ctr, w, h, occupiedCenters, placedBeastRects);
    const { x, y } = rect;
    placedBeastRects.push(rect);
    beastCardRects.set(char.id, rect);

    const gEl = document.createElementNS(svgNS, 'g');
    gEl.setAttribute('class', 'combat-element beast-card-on-hex');
    gEl.setAttribute('data-cell-id', pos);
    gEl.style.cursor = 'pointer';

    const cardImgHref = beastCardArt(bf.cardId);
    if (cardImgHref) {
      const cardImg = document.createElementNS(svgNS, 'image');
      cardImg.setAttribute('href', cardImgHref);
      cardImg.setAttribute('x', x.toFixed(2));
      cardImg.setAttribute('y', y.toFixed(2));
      cardImg.setAttribute('width', w.toFixed(2));
      cardImg.setAttribute('height', h.toFixed(2));
      cardImg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      gEl.appendChild(cardImg);
    } else {
      const fallback = document.createElementNS(svgNS, 'foreignObject');
      fallback.setAttribute('x', x.toFixed(2));
      fallback.setAttribute('y', y.toFixed(2));
      fallback.setAttribute('width', w.toFixed(2));
      fallback.setAttribute('height', h.toFixed(2));
      fallback.setAttribute('requiredExtensions', 'http://www.w3.org/1999/xhtml');
      appendGeneratedCardArt(fallback, { id: bf.cardId, type: 'beast', name: bf.name }, 'terrain');
      gEl.appendChild(fallback);
    }

    // Здоровье зверя показываем поверх нижней части карты.
    const txt = document.createElementNS(svgNS, 'text');
    txt.setAttribute('class', 'beast-card-hp');
    txt.setAttribute('x', (x + w / 2).toFixed(2));
    txt.setAttribute('y', (y + h - HEX_R * 0.55).toFixed(2));
    txt.style.textAnchor = 'middle';
    txt.style.fontSize = `${HEX_R * 0.68}px`;
    txt.style.pointerEvents = 'none';
    txt.textContent = `HP ${bf.hp}/${bf.maxHp}`;
    gEl.appendChild(txt);

    gEl.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedCharId = char.id;
      fightBeast();
    });

    boardVp.appendChild(gEl);
  }

  // Карты на террейне (свои)
  const terrainAvoidCenters = terrainCardAvoidCenters(g);
  const placedTerrainRects = [...placedBeastRects];
  for (const [uid, tc] of terrainCards) {
    if (tc.ownerId !== myPlayerId && !fogContainsPoint(fogCircles, tc.x, tc.y)) {
      continue;
    }
    const cardId = tc.cardId;
    const w = HEX_R * 3.5;
    const h = w * (512 / 341);
    const rect = placeTerrainCard({ x: tc.x, y: tc.y }, w, h, terrainAvoidCenters, placedTerrainRects);
    const { x, y } = rect;
    placedTerrainRects.push(rect);
    const art = CARD_FACE_ART[cardId];
    const imageHref = tc.faceDown
      ? cardBackArt(cardId)
      : cardFaceArtUrl(art);

    const gEl = document.createElementNS(svgNS, 'g');
    gEl.setAttribute('class', `combat-element terrain-card ${tc.faceDown ? 'is-face-down' : 'is-face-up'}`);
    gEl.setAttribute('data-uid', uid);
    gEl.style.cursor = 'pointer';
    gEl.setAttribute('role', 'button');
    gEl.setAttribute('tabindex', '0');
    gEl.setAttribute('aria-label', `Открыть карту: ${tc.cardData.name ?? cardId}`);

    if (imageHref) {
      const img = document.createElementNS(svgNS, 'image');
      img.setAttribute('href', imageHref);
      img.setAttribute('x', x.toFixed(2));
      img.setAttribute('y', y.toFixed(2));
      img.setAttribute('width', w.toFixed(2));
      img.setAttribute('height', h.toFixed(2));
      img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      gEl.appendChild(img);
    } else {
      const fallback = document.createElementNS(svgNS, 'foreignObject');
      fallback.setAttribute('x', x.toFixed(2));
      fallback.setAttribute('y', y.toFixed(2));
      fallback.setAttribute('width', w.toFixed(2));
      fallback.setAttribute('height', h.toFixed(2));
      fallback.setAttribute('requiredExtensions', 'http://www.w3.org/1999/xhtml');
      appendGeneratedCardArt(fallback, tc.cardData ?? { id: cardId }, 'terrain');
      gEl.appendChild(fallback);
    }

    if (tc.ownerId === myPlayerId) {
      const flip = document.createElementNS(svgNS, 'g');
      flip.setAttribute('class', 'terrain-card-flip');
      flip.setAttribute('role', 'button');
      flip.setAttribute('tabindex', '0');
      flip.setAttribute(
        'aria-label',
        tc.faceDown ? 'Перевернуть карту лицом вверх' : 'Перевернуть карту рубашкой вверх',
      );
      flip.style.cursor = 'pointer';

      const flipBg = document.createElementNS(svgNS, 'circle');
      flipBg.setAttribute('cx', (x + w - HEX_R * 0.42).toFixed(2));
      flipBg.setAttribute('cy', (y + HEX_R * 0.42).toFixed(2));
      flipBg.setAttribute('r', (HEX_R * 0.36).toFixed(2));
      flipBg.setAttribute('class', 'terrain-card-flip-bg');
      flip.appendChild(flipBg);

      const flipIcon = document.createElementNS(svgNS, 'text');
      flipIcon.setAttribute('x', (x + w - HEX_R * 0.42).toFixed(2));
      flipIcon.setAttribute('y', (y + HEX_R * 0.43).toFixed(2));
      flipIcon.setAttribute('class', 'terrain-card-flip-icon');
      flipIcon.style.fontSize = `${HEX_R * 0.52}px`;
      flipIcon.textContent = '↻';
      flip.appendChild(flipIcon);

      const flipTerrainCard = (event) => {
        event.stopPropagation();
        wsSend('action:terrainFlip', { id: uid, faceDown: !tc.faceDown });
      };
      flip.addEventListener('click', flipTerrainCard);
      flip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        flipTerrainCard(event);
      });
      gEl.appendChild(flip);
    }

    const openTerrainCard = (e) => {
      e.stopPropagation();
      if (tryRouteOverlayClickToCell(e)) return;
      showTerrainCard(uid, tc);
    };
    gEl.addEventListener('click', openTerrainCard);
    gEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openTerrainCard(e);
    });

    boardVp.appendChild(gEl);
  }
}

// Туман войны: одно круглое окно вокруг каждой своей живой фигуры.
// Радиус окна строго равен пяти радиусам гекса.
const FOG_RADIUS_HEXES = 5;
function fogCellStep() {
  const distances = [];
  for (const cell of cells) {
    for (const neighborId of cell.neighbors) {
      const neighbor = cellById.get(neighborId);
      if (!neighbor) continue;
      distances.push(Math.hypot(neighbor.cx - cell.cx, neighbor.cy - cell.cy));
    }
  }
  if (!distances.length) return HEX_R * Math.sqrt(3);
  distances.sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)];
}

function fogRevealCircles() {
  if (!getGame()) return null;
  const circles = [];
  const radius = fogCellStep() * FOG_RADIUS_HEXES;
  for (const c of getMyChars()) {
    const p = tokenDisplayPos.get(c.id) ?? characterPosition(c);
    if (!p || c.hp <= 0) continue;
    const center = cellCenter(p);
    if (center) circles.push({ cx: center.cx, cy: center.cy, r: radius });
  }
  return circles;
}

function fogContainsCell(circles, cellId) {
  if (!circles) return true;
  const center = cellCenter(cellId);
  if (!center) return false;
  return fogContainsPoint(circles, center.cx, center.cy);
}

function fogContainsPoint(circles, x, y) {
  if (!circles) return true;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return circles.some(({ cx, cy, r }) => Math.hypot(x - cx, y - cy) <= r);
}

// Слой тумана: тёмный прямоугольник поверх арта и сетки с чистыми круглыми
// отверстиями. Пересекающиеся круги автоматически образуют единую область.
function renderFog(circles) {
  if (!boardVp) return;
  let layer = boardVp.querySelector('#fogLayer');
  if (!circles) { layer?.remove(); return; }
  const artScaleX = boardMap?.art?.scaleX ?? 1;
  const artScaleY = boardMap?.art?.scaleY ?? 1;
  if (!layer) {
    layer = document.createElementNS(svgNS, 'g');
    layer.setAttribute('id', 'fogLayer');
    layer.setAttribute('pointer-events', 'none');
    layer.innerHTML = `<defs>`
      + `<filter id="fogEdgeBlur" x="-25%" y="-25%" width="150%" height="150%">`
      + `<feGaussianBlur id="fogEdgeBlurNode" stdDeviation="0"/>`
      + `</filter>`
      + `<mask id="fogMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${VBW}" height="${VBH}">`
      + `<rect x="0" y="0" width="${VBW}" height="${VBH}" fill="white"/>`
      + `<g id="fogHoles" filter="url(#fogEdgeBlur)"></g></mask></defs>`
      + `<image id="fogTexture" href="./assets/fog-of-war-clouds.jpg" x="0" y="0" `
      + `width="${VBW * artScaleX}" height="${VBH * artScaleY}" `
      + `preserveAspectRatio="none" opacity="0.9" mask="url(#fogMask)"/>`;
    // Арт остаётся под туманом, клетки/маркеры — над ним. Невидимые клетки
    // скрываются классом, а допустимые цели могут подсвечиваться поверх маски.
    boardVp.insertBefore(layer, boardVp.querySelector('.cell'));
  }
  const texture = layer.querySelector('#fogTexture');
  texture?.setAttribute('width', (VBW * artScaleX).toFixed(2));
  texture?.setAttribute('height', (VBH * artScaleY).toFixed(2));
  // Мягкая кромка шириной примерно в два клеточных шага. Размываются только отверстия
  // маски; сама карта, сетка и фишки остаются резкими.
  layer.querySelector('#fogEdgeBlurNode')
    ?.setAttribute('stdDeviation', (fogCellStep() * 0.5).toFixed(2));
  const holes = layer.querySelector('#fogHoles');
  holes.innerHTML = circles.map(({ cx, cy, r }) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="black"/>`,
  ).join('');
}

// Кратчайшая дистанция по графу с учётом занятых клеток (зеркало серверного BFS)
function pathDistance(from, to, blocked) {
  if (from === to) return 0;
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of hexNeighbors(cur)) {
      if (dist.has(nb) || (blocked.has(nb) && nb !== to)) continue;
      dist.set(nb, dist.get(cur) + 1);
      if (nb === to) return dist.get(nb);
      queue.push(nb);
    }
  }
  return Infinity;
}

// План подхода к врагу: свободная клетка рядом с ним, достижимая этим броском.
// Предпочитаем один кубик (второй останется на действия), иначе сумму обоих.
function planApproach(sel, enemy) {
  const g = getGame();
  const dice = getDice(sel?.id);
  if (!dice) return null;
  const from = characterPosition(sel);
  const enemyPos = characterPosition(enemy);
  if (!from || !enemyPos) return null;
  const enemyIsDwarf = String(enemy?.id ?? '').startsWith('dwarf:');
  const occupied = new Set(
    g.characters
      .filter(c => c.id !== sel.id && characterPosition(c))
      .map(c => characterPosition(c)),
  );
  for (const unit of g.dwarves?.units ?? []) {
    if (unit.alive && unit.position) occupied.add(unit.position);
  }
  let best = null; // ближайшая свободная клетка вплотную к врагу
  for (const cell of hexNeighbors(enemyPos)) {
    if (occupied.has(cell) || cell === from) continue;
    const d = pathDistance(from, cell, occupied);
    if (Number.isFinite(d) && (!best || d < best.steps)) best = { cell, steps: d };
  }
  if (!best) return null;
  const usedDice = getUsedDice(sel.id);
  for (const i of [selectedDieIdx, 1 - selectedDieIdx]) {
    if (usedDice[i]) continue;
    if (best.steps <= dice[i]) {
      return {
        mode: 'split',
        payload: {
          characterId: sel.id,
          toCell: best.cell,
          dieIndex: i,
          ...(enemyIsDwarf ? {} : { engageTargetId: enemy.id }),
        },
      };
    }
  }
  if (!usedDice[0] && !usedDice[1] && best.steps <= dice[0] + dice[1]) {
    return {
      mode: 'moveSum',
      payload: {
        characterId: sel.id,
        toCell: best.cell,
        ...(enemyIsDwarf ? {} : { engageTargetId: enemy.id }),
      },
    };
  }
  return null;
}



function renderLog() {
  if (!logEl) return;
  logEl.innerHTML = eventLog.map(e => {
    const cls = e.type ? ` log-${e.type}` : '';
    return `<div class="log-entry${cls}">${e.msg ?? e}</div>`;
  }).join('');
}

// ═════════════════════════════════════════════════════════════════
// Допустимые цели движения / телепорта
// ═════════════════════════════════════════════════════════════════

function validTargets(char) {
  const result = new Set();
  if (!char || !isMyTurn() || !getDice(char.id)) return result;

  if (localMode === 'teleport') {
    const inv = char.inventory ?? [];
    if (carriesGoldFeather(char)) return result;
    if (!inv.some(c => c.id === TELEPORT_ID && !c.exhausted)) return result;
    const ownStarts = Object.values(boardMap?.starts?.[charSide(char)] ?? {});
    const teleportPoints = cells
      .filter(cell => cell.pointClass === 'teleport')
      .map(cell => cell.id);
    for (const id of [...ownStarts, ...teleportPoints]) {
      if (id === characterPosition(char)) continue;
      const occupied = getGame()?.characters.some(
        c => c.id !== char.id && characterPosition(c) === id,
      );
      if (!occupied) result.add(id);
    }
    return result;
  }

  const moveMode = effectiveMoveMode();
  if (moveMode !== 'moveSum' && moveMode !== 'moveDie') return result;
  if (usesServerPositions()) {
    const legal = getGame()?.legalTargets;
    const dieIndex = moveMode === 'moveDie' ? firstFreeDieIndexFor(char.id) : selectedDieIdx;
    const targets = moveMode === 'moveSum'
      ? legal?.moveSum?.[char.id]
      : legal?.dice?.[dieIndex]?.[char.id];
    return new Set(targets ?? []);
  }
  const maxDist = getMoveDistance(char.id);
  const from    = positions.get(char.id);
  for (const cell of cells) {
    const d = cellDistance(from, cell.id);
    if (d > 0 && d <= maxDist) result.add(cell.id);
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════
// Борд — геометрия
// ═════════════════════════════════════════════════════════════════

function cellCenter(id) {
  const c = cellById.get(id);
  return c ? { cx: c.cx, cy: c.cy } : null;
}

function worldPointFromBoardEvent(event) {
  if (!boardSvg) return null;
  const rect = boardSvg.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  const { k } = svgK();
  const vbX = (event.clientX - rect.left) / k;
  const vbY = (event.clientY - rect.top) / k;
  return {
    x: (vbX - view.tx) / view.s,
    y: (vbY - view.ty) / view.s,
  };
}

function pointInsideHex(x, y, cell) {
  let inside = false;
  const vertices = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i);
    vertices.push({
      x: cell.cx + HEX_R * Math.cos(angle),
      y: cell.cy + HEX_R * Math.sin(angle),
    });
  }
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    if (((a.y > y) !== (b.y > y))
      && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-6) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function cellIdFromBoardEvent(event) {
  const point = worldPointFromBoardEvent(event);
  if (!point) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const cell of cells) {
    if (pointInsideHex(point.x, point.y, cell)) return cell.id;
    const distance = Math.hypot(point.x - cell.cx, point.y - cell.cy);
    if (distance < nearestDistance) {
      nearest = cell;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= HEX_R * 1.05 ? nearest.id : null;
}

function tryRouteOverlayClickToCell(event) {
  if (gestureMoved) return false;
  const targetId = cellIdFromBoardEvent(event);
  if (!targetId) return false;
  const char = getSelChar();
  if (!char || !validTargets(char).has(targetId)) return false;
  handleCellClick(targetId);
  return true;
}

// flat-top гекс вокруг центра радиусом r (в координатах viewBox)
function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function isStartCell(id) { return startCellIds.has(id); }

// Соседи клетки — из графа карты (тот же источник, что и на сервере).
function hexNeighbors(id) {
  return cellById.get(id)?.neighbors ?? [];
}

function areCellsAdjacent(a, b) {
  return Boolean(a && b && (hexNeighbors(a).includes(b) || hexNeighbors(b).includes(a)));
}

// Кратчайший путь по гексам (BFS), огибая занятые клетки. Конечную клетку
// блокировкой не считаем. Нет пути — возвращаем [from, to] (будет «прыжок»).
function hexPath(from, to, blocked = new Set()) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of hexNeighbors(cur)) {
      if (prev.has(nb) || (blocked.has(nb) && nb !== to)) continue;
      prev.set(nb, cur);
      if (nb === to) {
        const path = [];
        for (let c = nb; c !== null; c = prev.get(c)) path.unshift(c);
        return path;
      }
      queue.push(nb);
    }
  }
  return [from, to];
}

// Прошагать фишку по клеткам from→to. Телепорт — прыжок (без шагов):
// определяется по флагу teleportedChars (наш телепорт) либо по слишком
// длинному пути (телепорт соперника). Обычный ход — всегда анимируем.
function animateMove(charId, from, to) {
  if (teleportedChars.has(charId)) { teleportedChars.delete(charId); return; }
  const occupied = new Set(
    (getGame()?.characters ?? [])
      .filter(c => c.id !== charId)
      .map(c => characterPosition(c)),
  );
  const path = hexPath(from, to, occupied);
  if (path.length <= 1) return;
  if (path.length > 14) return; // подозрительно длинно — вероятно телепорт соперника

  const token = Symbol('anim');
  animTokens.set(charId, token);
  tokenDisplayPos.set(charId, path[0]);

  let i = 1;
  const step = () => {
    if (animTokens.get(charId) !== token) return; // отменена более новой анимацией
    tokenDisplayPos.set(charId, path[i]);
    renderBoard();
    if (++i < path.length) {
      setTimeout(step, STEP_MS);
    } else {
      animTokens.delete(charId);
      tokenDisplayPos.delete(charId);
      renderBoard();
      // фишка дошла — пусть постоит, затем покажем итог (если ждали)
      if (pendingOver && animTokens.size === 0) { pendingOver = false; scheduleMatchResult(); }
    }
  };
  setTimeout(step, STEP_MS);
}

// Сравнить позиции до/после снапшота и запустить шаги для сдвинувшихся фишек.
function animateMovesFromDiff(prevRoom, nextRoom) {
  const prevChars = prevRoom?.game?.characters;
  const nextChars = nextRoom?.game?.characters;
  if (!prevChars || !nextChars) return;
  for (const next of nextChars) {
    const prev = prevChars.find(c => c.id === next.id);
    if (prev && next.position && prev.position && prev.position !== next.position) {
      animateMove(next.id, prev.position, next.position);
    }
  }
}

function cellDistance(fromId, toId) {
  if (!fromId || !toId) return Infinity;
  const [fq, fr] = fromId.split(':').map(Number);
  const [tq, tr] = toId.split(':').map(Number);
  return Math.abs(fq - tq) + Math.abs(fr - tr);
}

function artHref(src) {
  return typeof src === 'string' ? src.replace(/^\//, './') : '';
}

function buildBoard() {
  if (!boardMap) return;
  boardEl.innerHTML = '';
  cells.length = 0;
  cellById.clear();
  startCellIds = new Set();

  const art = boardMap.art || {};
  const src = boardMap.editorSource?.art || {};
  // viewBox — в пропорции ИСХОДНОЙ карты (центры нормированы к ней). Арт (target)
  // растягивается в это пространство и масштабируется scaleX/scaleY от (0,0) —
  // как backdrop в редакторе; так калибровка scaleX/scaleY сходится один-в-один.
  const srcAspect = (src.width && src.height) ? src.height / src.width
    : (art.width && art.height ? art.height / art.width : 0.75);
  VBW = 1000;
  VBH = Math.round(VBW * srcAspect);

  // Радиус гекса из карты (нормирован к max целевой карты) → в долю исходной ширины
  const tgtMax = Math.max(art.width || 1, art.height || 1);
  const srcW = src.width || art.width || 1;
  HEX_R = (boardMap.hex?.radius ?? 0.012) * (tgtMax / srcW) * VBW;

  const centers = boardMap.editorSource?.centers ?? {};
  for (const c of boardMap.cells) {
    const ctr = c.center ?? centers[c.id];
    if (!ctr) continue;
    const cx = ctr.u * VBW, cy = ctr.v * VBH;
    const cell = {
      id: c.id,
      cx,
      cy,
      neighbors: c.neighbors || [],
      terrain: c.terrain || null,
      pointClass: c.pointClass || null,
      deck: c.deck || null,
      side: c.side || null,
      role: c.role || null,
    };
    cells.push(cell);
    cellById.set(c.id, cell);
  }

  for (const side of Object.keys(boardMap.starts || {})) {
    for (const id of Object.values(boardMap.starts[side] || {})) {
      if (id) startCellIds.add(id);
    }
  }

  boardSvg = document.createElementNS(svgNS, 'svg');
  boardSvg.setAttribute('class', 'board-svg');
  boardSvg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`);
  boardSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Вьюпорт: пан/зум применяются трансформом к этой группе (арт+клетки+фишки)
  boardVp = document.createElementNS(svgNS, 'g');
  boardVp.setAttribute('class', 'board-vp');
  boardSvg.appendChild(boardVp);

  if (art.src) {
    // Арт растягивается в source-пространство и масштабируется scaleX/scaleY
    // от левого-верхнего угла (повторяет backdrop редактора).
    const img = document.createElementNS(svgNS, 'image');
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', artHref(art.src));
    img.setAttribute('href', artHref(art.src));
    img.setAttribute('x', 0);
    img.setAttribute('y', 0);
    img.setAttribute('width', VBW * (art.scaleX ?? 1));
    img.setAttribute('height', VBH * (art.scaleY ?? 1));
    img.setAttribute('preserveAspectRatio', 'none');
    boardVp.appendChild(img);
  }

  for (const c of cells) {
    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('class', cellClassName(c));
    poly.setAttribute('points', hexPoints(c.cx, c.cy, HEX_R));
    poly.setAttribute('data-id', c.id);
    applyCellDisplay(poly, c);
    poly.addEventListener('click', () => { if (!gestureMoved) handleCellClick(c.id); });
    boardVp.appendChild(poly);
  }

  // Иконки колод (deckMarkers): картинка на клетке; размер = радиус·2·size,
  // оффсет — в долях радиуса. Поверх клеток, под фишками.
  const dm = boardMap.deckMarkers || {};
  const markerSize = HEX_R * 2 * (dm.size ?? 1.6);
  const markerOffsets = boardMap.editorSource?.markerOffsets ?? {};
  const assetRoot = artHref(dm.assetRoot || '/assets/cards/backs/markers');
  for (const c of boardMap.cells) {
    if (!c.marker?.class) continue;
    const ctr = cellById.get(c.id);
    if (!ctr) continue;
    const off = markerOffsets[c.id] ?? c.marker.offset ?? { x: 0, y: 0 };
    const href = `${assetRoot}/${c.marker.class}.png`;
    const mk = document.createElementNS(svgNS, 'image');
    mk.setAttribute('class', `deck-marker deck-marker--${c.marker.class}`);
    mk.setAttribute('data-cell-id', c.id);
    mk.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    mk.setAttribute('href', href);
    mk.setAttribute('x', (ctr.cx + (off.x || 0) * HEX_R - markerSize / 2).toFixed(2));
    mk.setAttribute('y', (ctr.cy + (off.y || 0) * HEX_R - markerSize / 2).toFixed(2));
    mk.setAttribute('width', markerSize.toFixed(2));
    mk.setAttribute('height', markerSize.toFixed(2));
    mk.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    mk.setAttribute('pointer-events', 'none');
    boardVp.appendChild(mk);
  }

  boardEl.appendChild(boardSvg);
  attachBoardGestures();
  applyView();
}

// ── Пан / зум / автофокус ─────────────────────────────────────────
function cellClassName(cell) {
  const classes = ['cell'];
  if (cell?.terrain) classes.push(`terrain-${cell.terrain}`);
  if (cell?.pointClass) classes.push(`point-${cell.pointClass.replaceAll('_', '-')}`);
  if (cell?.terrain === 'resource' && cell?.deck === 'blueprints') classes.push('blacksmith-stone');
  // «Цветная» клетка — имеет собственный смысловой цвет (event/resource/start/колода/опушка).
  // Подсветка валидной цели для таких НЕ перекрашивает заливку, только усиливает обводку.
  if (cell?.pointClass || cell?.deck || cell?.side || (cell?.terrain && cell.terrain !== 'path')) {
    classes.push('colored');
  }
  return classes.join(' ');
}

function applyCellDisplay(poly, cell) {
  const display = boardMap.display || {};
  const colors = display.colors || {};
  const fill = colors.points?.[cell.pointClass]
    || colors.decks?.[cell.deck]
    || colors.sides?.[cell.side]
    || colors.terrain?.[cell.terrain]
    || '#dbe8f7';
  const colored = Boolean(
    cell.pointClass || cell.deck || cell.side || (cell.terrain && cell.terrain !== 'path'),
  );

  poly.style.setProperty('--cell-fill', fill);
  poly.style.setProperty(
    '--cell-fill-opacity',
    String(colored ? (display.coloredCellOpacity ?? 0.45) : (display.cellOpacity ?? 0.22)),
  );
  poly.style.setProperty('--cell-stroke', display.cellStrokeColor || '#e8f0ff');
  poly.style.setProperty('--cell-stroke-opacity', String(display.cellStrokeOpacity ?? 1));
}

function applyView() {
  if (boardVp) {
    boardVp.setAttribute('transform',
      `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.s.toFixed(4)})`);
  }
}

function cancelViewAnimation() {
  if (viewAnimFrame != null) {
    cancelAnimationFrame(viewAnimFrame);
    viewAnimFrame = null;
  }
}

function clampedView(nextView) {
  const s = Math.max(MIN_S, Math.min(MAX_S, nextView.s));
  return {
    s,
    tx: Math.max(VBW - VBW * s, Math.min(0, nextView.tx)),
    ty: Math.max(VBH - VBH * s, Math.min(0, nextView.ty)),
  };
}

function easeOutCubic(t) {
  return 1 - ((1 - t) ** 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function setView(nextView, options = {}) {
  const target = clampedView(nextView);
  if (!options.animate || !boardVp) {
    cancelViewAnimation();
    view = target;
    applyView();
    return;
  }

  cancelViewAnimation();
  const from = { ...view };
  const start = performance.now();
  const duration = options.duration ?? VIEW_FOCUS_ANIM_MS;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const k = easeOutCubic(t);
    view = {
      s: lerp(from.s, target.s, k),
      tx: lerp(from.tx, target.tx, k),
      ty: lerp(from.ty, target.ty, k),
    };
    applyView();
    if (t < 1) {
      viewAnimFrame = requestAnimationFrame(step);
    } else {
      viewAnimFrame = null;
      view = target;
      applyView();
    }
  };
  viewAnimFrame = requestAnimationFrame(step);
}

function clampView() {
  view = clampedView(view);
}

// px на единицу viewBox (учитывает текущий масштаб подгонки)
function svgK() {
  const rect = boardSvg.getBoundingClientRect();
  return { rect, k: (rect.width / VBW) || 1 };
}

function attachBoardGestures() {
  boardEl.addEventListener('pointerdown', onPtrDown);
  boardEl.addEventListener('pointermove', onPtrMove);
  boardEl.addEventListener('pointerup', onPtrUp);
  boardEl.addEventListener('pointercancel', onPtrUp);
  boardEl.addEventListener('wheel', onWheel, { passive: false });
}

// Зум колесом мыши вокруг курсора (десктоп)
function onWheel(e) {
  e.preventDefault();
  cancelViewAnimation();
  const { rect, k } = svgK();
  const vbX = (e.clientX - rect.left) / k;
  const vbY = (e.clientY - rect.top) / k;
  // мировая точка под курсором (до зума)
  const cpX = (vbX - view.tx) / view.s;
  const cpY = (vbY - view.ty) / view.s;
  const factor = Math.exp(-e.deltaY * 0.0015);
  view.s = Math.max(MIN_S, Math.min(MAX_S, view.s * factor));
  // держим ту же точку под курсором
  view.tx = vbX - cpX * view.s;
  view.ty = vbY - cpY * view.s;
  clampView();
  applyView();
}

function onPtrDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  cancelViewAnimation();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gestureMoved = false;
  if (ptrs.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    pinchStart = null;
  } else if (ptrs.size === 2) {
    startPinch();
  }
}

function startPinch() {
  const [a, b] = [...ptrs.values()];
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const { rect, k } = svgK();
  const vbMidX = ((a.x + b.x) / 2 - rect.left) / k;
  const vbMidY = ((a.y + b.y) / 2 - rect.top) / k;
  pinchStart = {
    dist,
    s: view.s,
    cpX: (vbMidX - view.tx) / view.s,
    cpY: (vbMidY - view.ty) / view.s,
  };
  panStart = null;
}

function onPtrMove(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (ptrs.size >= 2 && pinchStart) {
    boardEl.setPointerCapture?.(e.pointerId);
    const [a, b] = [...ptrs.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const { rect, k } = svgK();
    view.s = Math.max(MIN_S, Math.min(MAX_S, pinchStart.s * (dist / pinchStart.dist)));
    const vbMidX = ((a.x + b.x) / 2 - rect.left) / k;
    const vbMidY = ((a.y + b.y) / 2 - rect.top) / k;
    view.tx = vbMidX - pinchStart.cpX * view.s;
    view.ty = vbMidY - pinchStart.cpY * view.s;
    clampView();
    applyView();
    gestureMoved = true;
  } else if (ptrs.size === 1 && panStart) {
    const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
    if (!gestureMoved && Math.hypot(dx, dy) <= 8) return;
    gestureMoved = true;
    boardEl.setPointerCapture?.(e.pointerId);
    const { k } = svgK();
    view.tx = panStart.tx + dx / k;
    view.ty = panStart.ty + dy / k;
    clampView();
    applyView();
  }
}

function onPtrUp(e) {
  if (boardEl.hasPointerCapture?.(e.pointerId)) {
    boardEl.releasePointerCapture(e.pointerId);
  }
  ptrs.delete(e.pointerId);
  if (ptrs.size === 1) {
    const [p] = [...ptrs.values()];
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty };
    pinchStart = null;
  } else if (ptrs.size === 0) {
    panStart = null; pinchStart = null;
  }
}

// Кадрировать набор клеток (по id) с отступом
function focusCells(ids, padFactor = 2.5, maxScale = MAX_S, options = {}) {
  if (!boardVp) return;
  const pts = ids.map(id => cellById.get(id)).filter(Boolean);
  if (!pts.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.cx); maxX = Math.max(maxX, p.cx);
    minY = Math.min(minY, p.cy); maxY = Math.max(maxY, p.cy);
  }
  const pad = HEX_R * padFactor;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const s = Math.max(MIN_S, Math.min(maxScale, Math.min(VBW / bw, VBH / bh)));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  setView({
    s,
    tx: VBW / 2 - cx * s,
    ty: VBH / 2 - cy * s,
  }, options);
}

function focusCharacter(characterId) {
  const char = getGame()?.characters?.find(c => c.id === characterId);
  const pos = char ? (tokenDisplayPos.get(char.id) ?? characterPosition(char)) : null;
  if (pos) focusCells([pos], 2.2, 4.6, { animate: true });
}

function focusMine() {
  const ids = (getGame()?.characters ?? [])
    .filter(c => c.owner === myPlayerId)
    .map(c => characterPosition(c))
    .filter(Boolean);
  if (ids.length) focusCells(ids, 4, 2.5);
}

function fitAll() {
  setView({ s: MIN_S, tx: 0, ty: 0 });
}

function layoutBoard() {
  const w = VBW * scale, h = VBH * scale;
  boardEl.style.width = `${w}px`;
  boardEl.style.height = `${h}px`;
  boardSvg.setAttribute('width', w);
  boardSvg.setAttribute('height', h);
}

function fitBoard() {
  if (!boardSvg) return;
  const wrap = boardEl.parentElement; if (!wrap) return;
  const cs = getComputedStyle(wrap);
  const avW = wrap.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const avH = wrap.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
  scale = Math.max(0.05, Math.min(avW / VBW, avH / VBH));
  layoutBoard();
  if (serverRoom?.game) renderBoard();
}

window.addEventListener('resize', fitBoard);

// ═════════════════════════════════════════════════════════════════
// Лог
// ═════════════════════════════════════════════════════════════════

function addLog(text, extra = {}) {
  // extra: { charId, to } для ходов — нужны для восстановления позиций
  const last = eventLog[0];
  if (last && last.msg === text && (last.type ?? '') === (extra.type ?? '')) return;
  eventLog.unshift({ msg: text, ...extra });
  if (eventLog.length > 60) eventLog.length = 60;
  saveLog();
  renderLog();
}

function rememberDamageLogSkip(charId, damage) {
  if (!charId || damage <= 0) return;
  const now = Date.now();
  recentDamageLogSkips = recentDamageLogSkips
    .filter((item) => now - item.at < 6000)
    .concat({ charId, damage, at: now });
}

function consumeDamageLogSkip(charId, damage) {
  const now = Date.now();
  recentDamageLogSkips = recentDamageLogSkips.filter((item) => now - item.at < 6000);
  const index = recentDamageLogSkips.findIndex((item) =>
    item.charId === charId && item.damage === damage);
  if (index === -1) return false;
  recentDamageLogSkips.splice(index, 1);
  return true;
}

function initToasts() {
  if (toastContainer) return;
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
}

function showToast(text, type = 'info') {
  if (pushGameMessage(text, type)) return;
  initToasts();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = text;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ═════════════════════════════════════════════════════════════════
// Оверлей просмотра карты после добора или на террейне
// ═════════════════════════════════════════════════════════════════

function buildEventOverlay() {
  if (eventOverlayEl) return;
  eventOverlayEl = document.createElement('div');
  eventOverlayEl.id = 'eventOverlay';
  eventOverlayEl.className = 'event-overlay hidden';
  eventOverlayEl.innerHTML = `
    <div class="event-card-reveal">
      <div class="event-title" id="eventTitle">Взята карта</div>
      <div class="event-card-display" id="eventCardDisplay"></div>
      <button class="event-return-btn hidden" id="eventReturnBtn">Вернуть в инвентарь</button>
      <button class="event-delete-btn hidden" id="eventDeleteBtn">Удалить карту</button>
      <button class="event-ok-btn" id="eventOkBtn">Принять</button>
    </div>`;
  document.body.appendChild(eventOverlayEl);
  eventOverlayEl.querySelector('#eventOkBtn').addEventListener('click', hideEventOverlay);
  eventOverlayEl.addEventListener('click', (e) => { if (e.target === eventOverlayEl) hideEventOverlay(); });
}

function showFoundCard(card, isDiscarded = false, overrideTitle = null) {
  if (!eventOverlayEl) buildEventOverlay();
  const title = eventOverlayEl.querySelector('#eventTitle');
  const display = eventOverlayEl.querySelector('#eventCardDisplay');
  const returnBtn = eventOverlayEl.querySelector('#eventReturnBtn');
  const deleteBtn = eventOverlayEl.querySelector('#eventDeleteBtn');
  
  title.textContent = overrideTitle || (isDiscarded ? 'Инвентарь полон!' : 'Взята карта');
  title.classList.remove('hidden');
  title.style.color = overrideTitle ? 'var(--danger)' : (isDiscarded ? 'var(--danger)' : 'var(--gold)');
  
  display.innerHTML = renderCard(card, 999, true); // true = forceOpen
  returnBtn.classList.add('hidden');
  returnBtn.onclick = null;
  deleteBtn.classList.add('hidden');
  deleteBtn.onclick = null;
  eventOverlayEl.querySelector('#eventOkBtn').textContent = 'Принять';
  const cardEl = display.querySelector('.card');
  if (cardEl) {
    if (isDiscarded) cardEl.style.opacity = '0.7';
  }

  eventOverlayEl.classList.remove('hidden');
}

function showInventoryCard(card, cardIndex = null) {
  if (!eventOverlayEl) buildEventOverlay();
  const title = eventOverlayEl.querySelector('#eventTitle');
  const display = eventOverlayEl.querySelector('#eventCardDisplay');
  const returnBtn = eventOverlayEl.querySelector('#eventReturnBtn');
  const deleteBtn = eventOverlayEl.querySelector('#eventDeleteBtn');
  const char = getSelChar();

  title.textContent = card?.name ?? getCardName(card?.id) ?? 'Карта';
  title.classList.remove('hidden');
  title.style.color = 'var(--gold)';
  display.innerHTML = renderCard(card, 999, true);
  returnBtn.classList.add('hidden');
  returnBtn.onclick = null;
  if (char && Number.isInteger(cardIndex) && !card?.hidden) {
    deleteBtn.classList.remove('hidden');
    deleteBtn.onclick = () => discardInventoryCard(char, cardIndex, card);
  } else {
    deleteBtn.classList.add('hidden');
    deleteBtn.onclick = null;
  }
  eventOverlayEl.querySelector('#eventOkBtn').textContent = 'Закрыть';
  eventOverlayEl.classList.remove('hidden');
}

function showTerrainCard(uid, terrainCard) {
  if (!eventOverlayEl) buildEventOverlay();
  const card = terrainCard.cardData;
  const own = terrainCard.ownerId === myPlayerId;
  const title = eventOverlayEl.querySelector('#eventTitle');
  title.textContent = '';
  title.classList.add('hidden');
  eventOverlayEl.querySelector('#eventCardDisplay').innerHTML = renderCard(card, 999, true);
  const returnBtn = eventOverlayEl.querySelector('#eventReturnBtn');
  const deleteBtn = eventOverlayEl.querySelector('#eventDeleteBtn');
  returnBtn.classList.toggle('hidden', !own);
  returnBtn.onclick = own ? () => {
    wsSend('action:terrainRemove', { id: uid });
    hideEventOverlay();
  } : null;
  deleteBtn.classList.add('hidden');
  deleteBtn.onclick = null;
  eventOverlayEl.querySelector('#eventOkBtn').textContent = 'Закрыть';
  eventOverlayEl.classList.remove('hidden');
}

function hideEventOverlay() {
  eventOverlayEl?.classList.add('hidden');
}

function attackBreakdownText(a) {
  const parts = [`кубики ${a.damage}`];
  if (a.griffinDamage > 0) parts.push(`Гриффон ${a.griffinDamage}`);
  if (a.clubDamage > 0) {
    const count = a.clubCount > 1 ? ` ×${a.clubCount}` : '';
    parts.push(`Дубина${count} ${a.clubDamage}`);
  }
  if (a.weaponDamage > 0) {
    const pierce = a.weaponPiercing ? ' без защиты' : '';
    parts.push(`${a.weaponName} ${a.weaponDamage}${pierce}`);
  } else if (a.weaponSuppressedReason) {
    parts.push(`${a.weaponSuppressedName ?? 'Оружие'} 0 (${weaponSuppressedText(a)})`);
  }
  const beforeDefense = parts.join(' + ');
  const defenses = [];
  if (a.armorAbsorbed > 0) defenses.push(`броня -${a.armorAbsorbed}`);
  const trapNegated = (a.traps ?? []).some((trap) => trap.negated);
  if (trapNegated) defenses.push('ловушка: урон 0');
  const afterDefense = defenses.length ? `; ${defenses.join(', ')}` : '';
  return `${beforeDefense} = ${a.totalDamage}${afterDefense}; нанесено ${a.dealtDamage}`;
}

function dwarfAttackBreakdownText(attack) {
  const defenses = [];
  if (attack.armorAbsorbed > 0) defenses.push(`броня -${attack.armorAbsorbed}`);
  if ((attack.traps ?? []).some((trap) => trap.negated)) defenses.push('ловушка: урон 0');
  const afterDefense = defenses.length ? `; ${defenses.join(', ')}` : '';
  return `урон ${attack.damage}${afterDefense}; нанесено ${attack.dealtDamage ?? attack.damage}`;
}

function weaponSuppressedText(a) {
  if (a.weaponSuppressedReason === 'lake_frog') return 'отключено Озёрной лягушкой';
  if (a.weaponSuppressedReason === 'face_down') return 'лежит рубашкой вверх';
  if (a.weaponSuppressedReason === 'wrong_role') {
    const role = a.weaponSuppressedRole ? ROLE_NAMES[a.weaponSuppressedRole] : null;
    return role ? `только ${role}` : 'не подходит классу';
  }
  return 'не сработало';
}

function isRemoteActionResult(result) {
  return Boolean(result?.actorId && myPlayerId && result.actorId !== myPlayerId);
}

function playerLabelById(playerId) {
  const player = serverRoom?.players?.find(p => p.id === playerId);
  if (!player) return 'Противник';
  if (player.isBot) return player.name ?? 'ИИ';
  return player.name ?? 'Противник';
}

function characterLabelById(characterId) {
  const character = getGame()?.characters?.find(c => c.id === characterId);
  if (character) return ROLE_NAMES[character.role] ?? characterId ?? 'персонаж';
  const dwarf = dwarfById(characterId);
  if (dwarf) return dwarfLabel(dwarf);
  return characterId ?? 'персонаж';
}

function dwarfById(unitId) {
  return getGame()?.dwarves?.units?.find(unit => unit.id === unitId) ?? null;
}

function dwarfLabel(unit) {
  return unit?.name ?? DWARF_NAMES[unit?.kind] ?? 'Дварф';
}

function modeLabel(mode) {
  if (mode === 'split') return 'раздельные кубики';
  if (mode === 'moveSum') return 'ход суммой';
  return mode ?? 'режим';
}

function logRemoteActionResult(result) {
  const actor = playerLabelById(result.actorId);
  const lines = [];

  if (result.roll) {
    lines.push('бросил кубики персонажей.');
  }
  if (result.mode) {
    lines.push(`выбрал режим: ${modeLabel(result.mode)}.`);
  }
  if (result.reset) {
    lines.push(`отменил движение: ${characterLabelById(result.reset.characterId)}.`);
  }
  if (result.moved) {
    const m = result.moved;
    lines.push(`${characterLabelById(m.characterId)} → ${m.toCell}.`);
    if (m.engagedTargetId) {
      lines.push(`${characterLabelById(m.characterId)} вступил в бой с ${characterLabelById(m.engagedTargetId)}.`);
    }
  }
  if (result.engaged) {
    lines.push(`${characterLabelById(result.engaged.attackerId)} вступил в бой с ${characterLabelById(result.engaged.targetId)}.`);
  }
  if (result.redEvent) {
    const ev = result.redEvent;
    if (ev.beast) lines.push(`красная клетка: зверь ${ev.name}.`);
    else if (ev.acquired) lines.push(`красная клетка: найдена карта «${ev.name}».`);
    else if (ev.discarded) lines.push(`красная клетка: «${ev.name}» ушла в сброс.`);
  }
  if (result.drawn) {
    const d = result.drawn;
    const deck = d.deck ? (CARD_DECK_LABELS[d.deck] ?? d.deck) : 'колода';
    const count = d.count > 1 ? `${d.count} карты` : 'карту';
    const names = Array.isArray(d.cards) && d.cards.length > 0
      ? d.cards.map(item => item.name ?? getCardName(item.card)).join(', ')
      : (d.name ?? getCardName(d.card));
    lines.push(`${characterLabelById(d.characterId)} взял ${count} из колоды «${deck}»: ${names}.`);
  }
  if (result.transferred) {
    const t = result.transferred;
    const cardName = t.name || getCardName(t.cardId);
    lines.push(cardName
      ? `передал карту «${cardName}».`
      : `передал карты: ${t.count ?? 1}.`);
  }
  if (result.discardedCard) {
    const d = result.discardedCard;
    lines.push(`удалил карту «${d.name || getCardName(d.cardId)}».`);
  }
  if (result.terrainPlaced) {
    const placed = result.terrainPlaced;
    lines.push(`${placed.faceDown ? 'карта рубашкой вверх' : placed.name ?? 'карта'} выложена на террейн.`);
  }
  if (result.terrainRemoved) {
    lines.push('вернул карту с террейна.');
  }
  if (result.terrainFlipped) {
    const flipped = result.terrainFlipped;
    lines.push(`${flipped.name}: ${flipped.faceDown ? 'рубашкой вверх' : 'лицом вверх'}.`);
  }
  if (result.debugGranted) {
    const granted = result.debugGranted;
    lines.push(`отладка: ${characterLabelById(granted.characterId)} получил карту «${granted.name}».`);
  }
  if (result.featherVictory) {
    lines.push('доставил Золотое перо на камень кузнеца.');
  }
  if (result.teleported) {
    const t = result.teleported;
    lines.push(t.success
      ? `${characterLabelById(t.characterId)} телепортировался.`
      : `${characterLabelById(t.characterId)} не смог телепортироваться: кубик ${t.value}.`);
  }
  if (result.attacked) {
    const a = result.attacked;
    lines.push(`${characterLabelById(a.attackerId)} атаковал ${characterLabelById(a.targetId)}: ${a.dealtDamage ?? a.damage ?? 0} урона.`);
    if (a.defeated) lines.push(`${characterLabelById(a.targetId)} повержен.`);
  }
  if (result.beastFought) {
    const b = result.beastFought;
    lines.push(b.killed
      ? `${characterLabelById(b.characterId)} победил зверя${b.hide ? ` и получил «${getCardName(b.hide)}»` : ''}.`
      : `${characterLabelById(b.characterId)} ударил зверя: ${b.successes}/${b.needed}.`);
  }
  if (result.dotDischarged) {
    const d = result.dotDischarged;
    lines.push(d.success ? `стряхнул «${d.name}».` : `не стряхнул «${d.name}»: кубик ${d.value}.`);
  }
  if (result.hideProcessed) {
    const h = result.hideProcessed;
    lines.push(h.success ? 'обработал шкуру.' : `не обработал шкуру: кубик ${h.value}.`);
  }
  if (result.goldNuggetUsed) {
    lines.push(`использовал самородок: +${result.goldNuggetUsed.healed} HP.`);
  }
  if (result.deadOreUsed) {
    const d = result.deadOreUsed;
    lines.push(`Неживая руда взяла карту «${d.name ?? d.card}».`);
  }
  if (result.lakeFrogUsed) {
    const f = result.lakeFrogUsed;
    lines.push(f.mode === 'beast'
      ? 'Озёрная лягушка сработала против зверя.'
      : 'Озёрная лягушка отключила оружие цели.');
  }
  if (result.marvoUsed) {
    const m = result.marvoUsed;
    lines.push(`Марво трос: ${m.damage} урона по целям (${m.targets?.length ?? 0}).`);
  }
  if (result.teleportRecharged) {
    const r = result.teleportRecharged;
    lines.push(r.success ? 'перезарядил Бусы телепортации.' : `не перезарядил Бусы: кубик ${r.value}.`);
  }
  if (result.crafted) {
    const label = CRAFT_RECIPES[result.crafted.item]?.label ?? result.crafted.item;
    lines.push(`открыл изделие «${label}».`);
  }
  if (result.craftAttempt && !result.craftAttempt.success) {
    const label = CRAFT_RECIPES[result.craftAttempt.item]?.label ?? result.craftAttempt.item;
    lines.push(`не прошел испытание «${label}»: [${result.craftAttempt.values.join(', ')}].`);
  }
  if (result.commandType === 'turn:end') {
    lines.push('завершил ход.');
  }

  if (lines.length === 0 && result.commandType && result.commandType !== 'turn:setMode') {
    lines.push(`выполнил действие ${result.commandType}.`);
  }
  for (const line of lines) {
    addLog(`${actor}: ${line}`, { type: 'opp' });
  }
}

// Обработка прямого результата действия (нужна для мгновенной обратной связи)
function handleActionResult(result) {
  if (result.roll?.lakeFrogReleased?.length) {
    for (const released of result.roll.lakeFrogReleased) {
      showToast('Озёрная лягушка снята', 'success');
      addLog(`Озёрная лягушка снята с цели: сумма кубиков ${result.roll.total}. Карта возвращена Шаману.`, { type: 'sys' });
    }
  }

  if (result.dwarves) {
    if (Array.isArray(result.dwarves.entries) || Array.isArray(result.dwarves.moves)) {
      for (const entry of result.dwarves.entries ?? []) {
        addLog(`Дварф вышел из ворот: ${entry.toCell}.`, { type: 'sys' });
      }
      for (const move of result.dwarves.moves ?? []) {
        if (move.exit) {
          addLog(`Дварф прошёл маршрут и ушёл с поля (через ${move.toCell}).`, { type: 'sys' });
        } else if (move.fromCell !== move.toCell) {
          const suffix = move.aggroTargetId ? ' к цели' : ' по маршруту';
          addLog(`Дварф идёт${suffix}: ${move.fromCell} → ${move.toCell}.`, { type: 'sys' });
        }
      }
      for (const attack of result.dwarves.attacks ?? []) {
        triggerCharacterNavHitEffect(attack.targetId);
        const dead = attack.defeated ? ' Персонаж выбыл.' : '';
        const breakdown = dwarfAttackBreakdownText(attack);
        addLog(`Дварф атакует ${characterLabelById(attack.targetId)}: ${breakdown}.${dead}`, { type: attack.defeated ? 'bad' : 'sys' });
        for (const trap of attack.traps ?? []) {
          const parts = [];
          if (trap.negated) parts.push('урон отменён');
          if (trap.attackerSelfDamage > 0) parts.push(`дварф теряет ${trap.attackerSelfDamage} HP`);
          if (trap.retreat > 0) parts.push(`дварф отброшен на ${trap.retreat}`);
          if (trap.dot > 0) parts.push(`дварф получает дебафф −${trap.dot} HP/ход`);
          const detail = parts.length ? `: ${parts.join(', ')}` : '';
          addLog(`Секрет «${trap.name}» сработал против дварфа${detail}.`, { type: 'sys' });
        }
        if (attack.attackerDefeated) {
          addLog('Дварф повержен сработавшим секретом.', { type: 'sys' });
        }
      }
    } else if (result.dwarves.type === 'entry') {
      addLog(`Дварфы вышли из ворот: ${result.dwarves.toCell}.`, { type: 'sys' });
    } else if (result.dwarves.type === 'move') {
      addLog(`Дварфы идут по маршруту: ${result.dwarves.fromCell} → ${result.dwarves.toCell}.`, { type: 'sys' });
    }
  }

  if (isRemoteActionResult(result)) {
    logRemoteActionResult(result);
    return;
  }

  if (result.moved) {
    const m = result.moved;
    if (m.characterId && m.fromCell && m.toCell && m.fromCell !== m.toCell) {
      animateMove(m.characterId, m.fromCell, m.toCell);
    }
    if (m.engagedTargetId) {
      const game = getGame();
      const attacker = game?.characters.find(char => char.id === m.characterId);
      const target = game?.characters.find(char => char.id === m.engagedTargetId);
      const attackerName = ROLE_NAMES[attacker?.role] ?? 'Персонаж';
      const targetName = ROLE_NAMES[target?.role] ?? 'противник';
      showBattleNotice(attackerName, targetName);
      addLog(`${attackerName} вступает в бой с ${targetName}.`, { type: 'my' });
      pushTutorialMessage('Бой зафиксирован. Следующий свободный кубик можно потратить на удар. Защиту держите лицом вверх, ловушки — рубашкой вверх.');
    }
  }

  if (result.engaged) {
    const engaged = result.engaged;
    const game = getGame();
    const attacker = game?.characters.find(char => char.id === engaged.attackerId);
    const target = game?.characters.find(char => char.id === engaged.targetId);
    const attackerName = ROLE_NAMES[attacker?.role] ?? 'Персонаж';
    const targetName = ROLE_NAMES[target?.role] ?? 'противник';
    showBattleNotice(attackerName, targetName);
    addLog(`${attackerName} вступает в бой с ${targetName}.`, { type: 'my' });
    pushTutorialMessage('Бой зафиксирован. Атака тратит свободный кубик; оружие и активные карты на террейне могут добавить урон.');
  }

  if (result.redEvent) {
    const ev = result.redEvent;
    if (ev.beast) {
      showToast(`🐗 Нападение зверя: ${ev.name}!`, 'danger');
      addLog(`На красной клетке: нападение зверя ${ev.name}!`, { type: 'err' });
      pushTutorialMessage(`Напал зверь «${ev.name}». Его можно бить свободными кубиками; Дубина Воина и Озёрная лягушка Шамана дают быстрые варианты победы.`, 'danger');
    } else if (ev.acquired) {
      showToast(`Красная находка: ${ev.name}`, ev.cardId === 'irikon' ? 'success' : 'info');
      addLog(`На красной клетке найдена карта «${ev.name}».`, { type: 'my' });
      showFoundCard({ id: ev.cardId, name: ev.name, type: ev.type, desc: ev.desc }, false);
      pushCardTutorial({ id: ev.cardId, name: ev.name, type: ev.type, desc: ev.desc });
    } else if (ev.discarded) {
      showToast(`Инвентарь полон: ${ev.name} ушла в сброс`, 'danger');
      addLog(`На красной клетке найдена карта «${ev.name}», но инвентарь полон — карта ушла в сброс.`, { type: 'err' });
      pushTutorialMessage('Инвентарь ограничен 10 картами. Лишнее можно удалить или передать через ящик карт до добора.', 'danger');
    }
  }

  if (result.drawn) {
    const d = result.drawn;
    const card = { id: d.card, name: d.name, type: d.type, desc: d.desc };
    showFoundCard(card, false);
    const toolName = d.bonusTool === 'hammer' ? 'Молоток'
      : d.bonusTool === 'sack' ? 'Мешок'
      : null;
    showToast(toolName ? `${toolName}: взято 2 карты` : `Взято из колоды: ${d.name}`, 'success');
    const character = getGame()?.characters.find(c => c.id === d.characterId);
    const characterName = ROLE_NAMES[character?.role] ?? 'Персонаж';
    const drawnCards = Array.isArray(d.cards) && d.cards.length > 0
      ? d.cards.map(item => item.name ?? getCardName(item.card)).join(', ')
      : (d.name ?? getCardName(d.card));
    const source = toolName ? ` (${toolName})` : '';
    const deckLabel = d.deck ? (CARD_DECK_LABELS[d.deck] ?? d.deck) : 'колоды';
    addLog(`${characterName} взял${d.count > 1 ? ` ${d.count} карты` : ' карту'} из колоды «${deckLabel}»${source}: ${drawnCards}.`, { type: 'my' });
    if (Array.isArray(d.cards) && d.cards.length > 0) {
      d.cards.forEach(item => pushCardTutorial({ id: item.card, name: item.name, type: item.type, desc: item.desc }));
    } else {
      pushCardTutorial(card);
    }
  }

  if (result.transferred) {
    const t = result.transferred;
    const name = t.name || getCardName(t.cardId);
    showToast(`Передано: ${name}`, 'info');
  }

  if (result.discardedCard) {
    const d = result.discardedCard;
    const name = d.name || getCardName(d.cardId);
    showToast(`Удалено: ${name}`, 'info');
    addLog(`Карта «${name}» удалена в сброс.`, { type: 'my' });
  }

  if (result.terrainPlaced) {
    const placed = result.terrainPlaced;
    const label = placed.faceDown ? 'Карта рубашкой вверх' : (placed.name ?? 'Карта');
    showToast(`${label} выложена на террейн`, 'info');
    addLog(`${label} выложена на террейн.`, { type: 'my' });
  }

  if (result.terrainRemoved) {
    showToast('Карта возвращена в инвентарь', 'info');
    addLog('Карта возвращена с террейна в инвентарь.', { type: 'my' });
  }

  if (result.terrainFlipped) {
    const flipped = result.terrainFlipped;
    const state = flipped.faceDown ? 'неактивна, рубашкой вверх' : 'активна, лицом вверх';
    showToast(`${flipped.name}: ${state}`, 'info');
    addLog(`${flipped.name}: ${state}.`, { type: 'my' });
  }

  if (result.debugGranted) {
    const granted = result.debugGranted;
    const character = getGame()?.characters.find(c => c.id === granted.characterId);
    const characterName = ROLE_NAMES[character?.role] ?? 'Персонаж';
    showToast(`Выдана карта: ${granted.name}`, 'success');
    addLog(`Отладка: ${characterName} получил карту «${granted.name}».`, { type: 'my' });
  }

  if (result.featherVictory) {
    showToast('Золотое перо доставлено на камень кузнеца', 'success');
    addLog('Золотое перо доставлено на камень кузнеца. Партия завершена.', { type: 'sys' });
  }

  if (result.teleported) {
    const t = result.teleported;
    if (t.success) {
      showToast(`Телепортация удалась: кубик ${t.value}`, 'success');
      addLog(`Бусы телепортации: кубик ${t.value}, персонаж перемещён. Карта перевёрнута рубашкой вверх.`, { type: 'my' });
      // Выходим из режима телепорта на движение оставшимся кубиком — иначе
      // клетки хода не подсвечиваются, пока игрок вручную не кликнет по кубику.
      // Свободный кубик выберет syncDieSelection при ближайшем рендере.
      if (localMode === 'teleport') localMode = 'moveDie';
    } else {
      teleportedChars.delete(t.characterId);
      showToast(`Телепортация не удалась: кубик ${t.value}`, 'info');
      addLog(`Бусы телепортации: кубик ${t.value}, нужно 2 или больше.`, { type: 'sys' });
    }
  }

  if (result.attacked) {
    const a = result.attacked;
    triggerAttackEffect(a.targetId);
    if (a.targetType !== 'dwarf') triggerCharacterNavHitEffect(a.targetId);
    const attacker = getGame()?.characters.find(c => c.id === a.attackerId);
    const target = getGame()?.characters.find(c => c.id === a.targetId);
    const targetDwarf = a.targetType === 'dwarf' ? dwarfById(a.targetId) : null;
    const attackerName = ROLE_NAMES[attacker?.role] ?? 'Персонаж';
    const targetName = target
      ? (ROLE_NAMES[target.role] ?? 'Персонаж')
      : (a.targetName ?? dwarfLabel(targetDwarf));
    
    const breakdown = attackBreakdownText(a);
    if (a.griffinDamage > 0) {
      showToast(`Гриффон: ${a.griffinDamage} урона, карта стала неактивной`, 'danger');
      pushTutorialMessage('Гриффон усиливает атаку Охотника по сумме кубиков и после удара переворачивается рубашкой вверх.');
    } else if (a.clubDamage > 0) {
      const count = a.clubCount > 1 ? ` ×${a.clubCount}` : '';
      showToast(`Дубина${count}: +${a.clubDamage} урона`, 'danger');
      pushTutorialMessage('Дубина Воина на террейне добавляет урон в бою с игроком и не переворачивается после атаки.');
    } else if (a.weaponDamage > 0) {
      const pierce = a.weaponPiercing ? ' (без учёта защиты)' : '';
      const icon = a.weaponName === 'Молот Иерихон' ? '🔨' : '🗡️';
      showToast(`${icon} ${a.weaponName}: +${a.weaponDamage} урона${pierce}!`, 'danger');
      pushTutorialMessage(`${a.weaponName} сработало как оружие. Карты оружия держите у подходящего персонажа или активными на террейне.`);
    } else if (a.weaponSuppressedReason) {
      showToast(`${a.weaponSuppressedName ?? 'Оружие'} не сработало: ${weaponSuppressedText(a)}`, 'info');
      pushTutorialMessage('Если оружие не сработало, проверьте класс персонажа, положение карты и эффекты вроде Озёрной лягушки.');
    } else if (a.weaponDisabledByLakeFrog) {
      showToast('Озёрная лягушка отключила оружие', 'info');
      pushTutorialMessage('Озёрная лягушка отключает оружие цели до броска суммы 8+.');
    } else {
      showToast(`⚔️ Атака: ${a.damage} урона!`, 'danger');
    }
    addLog(`${attackerName} атаковал ${targetName}: ${breakdown}.`, { type: 'err' });
    if (a.targetType === 'dwarf' && (a.dealtDamage ?? 0) > 0) {
      showDamageNumber({
        cellId: a.targetCell ?? characterPosition(targetDwarf),
        amount: a.dealtDamage,
      });
    }
    rememberDamageLogSkip(a.targetId, a.dealtDamage ?? a.damage ?? 0);
    const attackerSelfDamage = (a.traps ?? [])
      .reduce((total, trap) => total + (trap.attackerSelfDamage ?? 0), 0);
    rememberDamageLogSkip(a.attackerId, attackerSelfDamage);

    if (a.defeated) {
      showToast(`💀 ${targetName} повержен!`, 'danger');
      if (a.targetType === 'dwarf') {
        addLog(`${targetName} повержен. Добычи с дварфа нет.`, { type: 'err' });
      } else {
        addLog(`${targetName} повержен! Добыча: ${a.lootCount} карт${a.discardedCount > 0 ? ` (${a.discardedCount} в сброс)` : ''}`, { type: 'err' });
      }
    }

    // Ловушки защищающегося (Блеф): вскрылись при атаке.
    for (const trap of (a.traps ?? [])) {
      const parts = [];
      if (trap.negated) parts.push('атака не нанесла урона');
      if (trap.attackerSelfDamage > 0) {
        parts.push(`${attackerName} теряет ${trap.attackerSelfDamage} HP`);
        const pos = attacker ? characterPosition(attacker) : null;
        if (pos) showDamageNumber({ charId: a.attackerId, cellId: pos, amount: trap.attackerSelfDamage });
      }
      if (trap.retreat > 0) parts.push(`${attackerName} отброшен к старту на ${trap.retreat} бордов`);
      if (trap.dot > 0) parts.push(`${attackerName} получает дебафф −${trap.dot} HP/ход`);
      if (trap.stolen) parts.push(`забрана карта «${trap.stolen}»`);
      if (trap.purged > 0) parts.push(`у нападающего возвращено ингредиентов: ${trap.purged}`);
      const detail = parts.length ? `: ${parts.join(', ')}` : '';
      showToast(`🍄 Ловушка «${trap.name}»${detail}`, 'danger');
      addLog(`Ловушка «${trap.name}» сработала${detail}${trap.consumed ? ' (карта в сброс)' : ''}.`, { type: 'err' });
      pushTutorialMessage('Ловушки надо выкладывать рубашкой вверх. Они раскрываются, когда противник атакует первым.');
    }
    if (a.attackerDefeated) {
      showToast(`💀 ${attackerName} повержен ловушкой!`, 'danger');
      addLog(`${attackerName} повержен сработавшей ловушкой.`, { type: 'err' });
    }
  }

  if (result.beastFought) {
    const b = result.beastFought;
    if (b.damage > 0) {
      showDamageNumber({
        charId: b.characterId,
        cellId: b.cellId,
        amount: b.damage,
        overBeast: true,
      });
    }
    if (b.killed) {
      const hideName = b.hide ? getCardName(b.hide) : null;
      const weapon = b.clubUsed ? ' Дубина сработала.' : '';
      showToast(hideName ? `🐗 Зверь убит!${weapon} Добыта: ${hideName}` : `🐗 Зверь убит!${weapon}`, 'success');
      addLog(hideName
        ? `Зверь убит (кубик ${b.value}). Добыта «${hideName}».`
        : `Зверь убит (кубик ${b.value}).`, { type: 'my' });
      if (hideName) pushTutorialMessage(`Добытая шкура «${hideName}» часто нужна для рецептов. Передайте её Шаману для обработки или крафта.`);
    } else {
      addLog(`Удар по зверю: кубик ${b.value}, успехи ${b.successes}/${b.needed}.`, { type: 'sys' });
      pushTutorialMessage('Если зверь не убит сразу, успехи копятся. Продолжайте бить свободными кубиками или примените подходящую карту.');
    }
  }

  if (result.dotDischarged) {
    const d = result.dotDischarged;
    if (d.success) {
      showToast(`✨ Стряхнул «${d.name}»`, 'success');
      addLog(`Стряхнул ловушку «${d.name}» (кубик ${d.value} ≥ ${d.min}).`, { type: 'my' });
    } else {
      showToast('Стряхнуть не удалось', 'info');
      addLog(`Стряхнуть «${d.name}» не удалось (кубик ${d.value}, нужно ≥${d.min}). Ловушка осталась.`, { type: 'sys' });
    }
  }

  if (result.hideProcessed) {
    const h = result.hideProcessed;
    if (h.success) {
      showToast('🧵 Шкура очищена', 'success');
      addLog(`Шаман обработал шкуру (кубик ${h.value}) → «${getCardName(h.cleaned)}».`, { type: 'my' });
      pushTutorialMessage(`Очищенная шкура «${getCardName(h.cleaned)}» теперь подходит для крафта. Передайте её нужному персонажу через ящик карт.`);
    } else {
      showToast('Обработка не удалась', 'info');
      addLog(`Обработка шкуры не удалась (кубик ${h.value}, нужно ≥2). Шкура осталась.`, { type: 'sys' });
      pushTutorialMessage('Неудачная обработка не расходует шкуру. Попробуйте снова другим свободным кубиком или в следующий ход.');
    }
  }

  if (result.goldNuggetUsed) {
    const n = result.goldNuggetUsed;
    showToast(`Самородок: +${n.healed} HP`, 'success');
    addLog(`Малый золотой самородок восстановил ${n.healed} HP. Текущее здоровье: ${n.hp}.`, { type: 'my' });
  }

  if (result.deadOreUsed) {
    const d = result.deadOreUsed;
    const deckLabel = CARD_DECK_LABELS[d.deck] ?? d.deck;
    showToast(`Неживая руда: ${d.name ?? d.card}`, 'success');
    addLog(`Неживая руда взяла из колоды «${deckLabel}» карту «${d.name ?? d.card}».`, { type: 'my' });
  }

  if (result.lakeFrogUsed) {
    const f = result.lakeFrogUsed;
    if (f.mode === 'beast') {
      const reward = f.trophy ? getCardName(f.trophy) : (f.hide ? getCardName(f.hide) : null);
      showToast('Озёрная лягушка победила зверя', 'success');
      addLog(reward
        ? `Озёрная лягушка превратила «${f.beastName}» в добычу. Получено: «${reward}».`
        : `Озёрная лягушка завершила схватку со зверем «${f.beastName}».`, { type: 'my' });
      pushTutorialMessage('Озёрная лягушка против зверя сразу завершает схватку. Это сильный способ добыть шкуру без риска.');
    } else {
      showToast('Озёрная лягушка отключила оружие цели', 'success');
      addLog(`Озёрная лягушка наложена на противника. Оружие отключено до броска суммы ${f.dischargeTotal}+.`, { type: 'my' });
      pushTutorialMessage(`Оружие цели отключено, пока она не выбросит сумму ${f.dischargeTotal}+.`);
    }
  }

  if (result.marvoUsed) {
    const m = result.marvoUsed;
    showToast(`Марво трос: ${m.damage} урона по ${m.targets.length} целям`, 'danger');
    addLog(`Марво трос: кубик ${m.value}, оружие «${m.weaponName}», ${m.damage} урона по целям: ${m.targets.length}.`, { type: 'err' });
    for (const target of m.targets) {
      const pos = getGame()?.characters.find(c => c.id === target.targetId)?.position;
      if (pos) showDamageNumber({ charId: target.targetId, cellId: pos, amount: target.damage });
    }
  }

  if (result.teleportRecharged) {
    const r = result.teleportRecharged;
    const target = getGame()?.characters.find(c => c.id === r.targetId);
    const targetName = ROLE_NAMES[target?.role] ?? 'персонажа';
    if (r.success) {
      showToast(`Бусы телепортации перезаряжены: кубик ${r.value}`, 'success');
      addLog(`Шкура ритуалов: кубик ${r.value} ≥ 4, Бусы телепортации у ${targetName} снова активны. Шкура ритуалов перевёрнута рубашкой вверх.`, { type: 'my' });
    } else {
      showToast(`Перезарядка не удалась: кубик ${r.value}`, 'info');
      addLog(`Шкура ритуалов: кубик ${r.value}, нужно 4+. Бусы телепортации у ${targetName} остаются использованными, Шкура ритуалов перевёрнута рубашкой вверх.`, { type: 'sys' });
    }
  }

  if (result.crafted) {
    const label = CRAFT_RECIPES[result.crafted.item]?.label ?? 'изделие';
    showToast(`🔨 Открыто: ${label}!`, 'success');
    addLog(`Открыто изделие «${label}» по чертежу/рецепту (материалы израсходованы).`, { type: 'my' });
    pushTutorialMessage(`«${label}» создано. Если это оружие/защита/инструмент, проверьте описание карты и решите, держать её в руке или выложить на террейн.`, 'success');
  }

  if (result.craftAttempt && !result.craftAttempt.success) {
    const a = result.craftAttempt;
    const label = CRAFT_RECIPES[a.item]?.label ?? 'изделия';
    const requirement = a.values.length > 1
      ? `${a.min}+ на каждом кубике`
      : `${a.min}+ на кубике`;
    showToast(`Испытание «${label}» не пройдено: [${a.values.join(', ')}]`, 'info');
    addLog(`Испытание «${label}»: [${a.values.join(', ')}], нужно ${requirement}. Материалы сохранены.`, { type: 'sys' });
    pushTutorialMessage(`Крафт «${label}» провалился, но материалы сохранены. Нужна проверка: ${requirement}.`);
  }
}

// Поиск имени карты по ID (для лога и тостов)
function getCardName(id) {
  const char = getSelChar();
  const card = char?.inventory?.find(c => c.id === id);
  if (card) return card.name;
  // Если в инвентаре ещё нет (или не выбран), пытаемся найти в других инвентарях
  for (const c of getMyChars()) {
    const found = c.inventory?.find(i => i.id === id);
    if (found) return found.name;
  }
  return id;
}

// Сравниваем два снапшота и логируем действия противника
function diffAndLog(prevRoom, nextRoom) {
  const prevG = prevRoom?.game;
  const nextG = nextRoom?.game;
  if (!prevG || !nextG || !myPlayerId) return;

  const oppPlayer = nextRoom.players.find(p => p.id !== myPlayerId);
  if (!oppPlayer) return;
  const oppId   = oppPlayer.id;
  const oppName = oppPlayer.name ?? 'Противник';
  const detailedRemoteActions = canUseLocalActionJournal();

  const prevActive = prevG.turn.activePlayerId;
  const nextActive = nextG.turn.activePlayerId;

  for (const char of nextG.characters) {
    const prevChar = prevG.characters.find(c => c.id === char.id);
    if (prevChar && char.hp < prevChar.hp) {
      const damage = prevChar.hp - char.hp;
      triggerCharacterNavHitEffect(char.id);
      if (consumeDamageLogSkip(char.id, damage)) continue;
      showDamageNumber({
        charId: char.id,
        cellId: characterPosition(char) ?? characterPosition(prevChar),
        amount: damage,
      });
      const owner = nextRoom.players.find(p => p.id === char.owner);
      const prefix = char.owner === myPlayerId ? '' : `${owner?.name ?? 'Противник'}: `;
      // Урон в момент броска — это пассивы начала хода вроде укуса зверя.
      // Помечаем источник, иначе выглядит как «HP убыло само».
      const rolledNow = !turnHasAnyDice(prevG.turn) && turnHasAnyDice(nextG.turn);
      if (rolledNow && char.owner === myPlayerId && char.beastFight) {
        addLog(`🐗 ${escapeHtml(char.beastFight.name)} кусает: ${ROLE_NAMES[char.role]} теряет ${damage} HP. HP: ${char.hp}.`, { type: 'my' });
      } else {
        addLog(
          `${prefix}${ROLE_NAMES[char.role]} получает ${damage} урона. HP: ${char.hp}.`,
          { type: char.owner === myPlayerId ? 'my' : 'opp' },
        );
      }
      if (char.hp === 0) {
        addLog(`${prefix}${ROLE_NAMES[char.role]} выбыл из игры.`, { type: 'sys' });
      }
    } else if (prevChar && char.hp > prevChar.hp) {
      const heal = char.hp - prevChar.hp;
      const owner = nextRoom.players.find(p => p.id === char.owner);
      const prefix = char.owner === myPlayerId ? '' : `${owner?.name ?? 'Противник'}: `;
      addLog(
        `${prefix}${ROLE_NAMES[char.role]} восстанавливает +${heal} HP (Клубок). HP: ${char.hp}.`,
        { type: char.owner === myPlayerId ? 'my' : 'opp' },
      );
    }
    // Бой со зверем (красные клетки): нападение, победа, побег, успехи
    if (prevChar) {
      const prevBF = prevChar.beastFight;
      const nextBF = char.beastFight;
      const mine   = char.owner === myPlayerId;
      const bfType = mine ? 'my' : 'opp';
      const bfPrefix = mine
        ? ''
        : `${nextRoom.players.find(p => p.id === char.owner)?.name ?? 'Противник'}: `;
      if (!prevBF && nextBF) {
        addLog(`${bfPrefix}🐗 ${nextBF.name} напал на ${ROLE_NAMES[char.role]}!`, { type: bfType });
      } else if (prevBF && !nextBF) {
        if (prevChar.position !== char.position) {
          addLog(`${bfPrefix}${ROLE_NAMES[char.role]} сбежал от зверя.`, { type: bfType });
        } else if (char.hp > 0) {
          addLog(`${bfPrefix}${ROLE_NAMES[char.role]} победил зверя: ${prevBF.name}.`, { type: bfType });
        }
      } else if (prevBF && nextBF && nextBF.successes > prevBF.successes) {
        addLog(`${bfPrefix}Удар по зверю: успех ${nextBF.successes}/${nextBF.needed}.`, { type: bfType });
      }
      // Крафт: карта была заперта — стала открытой (видно только владельцу)
      if (prevChar.inventory && char.inventory) {
        for (const card of char.inventory) {
          if (!card.locked && prevChar.inventory.some(p => p.id === card.id && p.locked)) {
            addLog(`${bfPrefix}🔨 ${ROLE_NAMES[char.role]} открывает: ${card.name}!`, { type: bfType });
          }
        }
      }
    }
    if (!prevChar || prevChar.position === char.position) continue;
    if (!char.position) continue;
    if (detailedRemoteActions && char.owner !== myPlayerId) continue;
    const type = char.owner === myPlayerId ? 'my' : 'opp';
    const ownerName = char.owner === myPlayerId ? '' : `${oppName}: `;
    addLog(`${ownerName}${ROLE_NAMES[char.role]} → ${char.position}.`, { type });
  }

  // Смена хода
  if (prevActive !== nextActive) {
    addLog(nextActive === myPlayerId ? 'Ваш ход.' : `Ход ${oppName}.`, { type: 'sys' });
    return;
  }

  // Действия противника в его ход
  if (nextActive !== myPlayerId) {
    if (detailedRemoteActions) return;
    // Бросок кубиков
    if (!turnHasAnyDice(prevG.turn) && turnHasAnyDice(nextG.turn)) {
      const firstDice = Object.values(nextG.turn.diceByCharacter ?? {})[0] ?? nextG.turn.dice;
      addLog(firstDice
        ? `${oppName} бросил кубики персонажей. Первый бросок: [${firstDice[0]}, ${firstDice[1]}].`
        : `${oppName} бросил кубики персонажей.`,
        { type: 'opp' });
    }
    // Изменения инвентаря (добор / передача)
    for (const char of nextG.characters.filter(c => c.owner === oppId)) {
      const prevChar = prevG.characters.find(c => c.id === char.id);
      if (!prevChar?.inventory || !char.inventory) continue;
      const delta = char.inventory.length - prevChar.inventory.length;
      if (delta > 0) addLog(`${oppName}: ${ROLE_NAMES[char.role]} добрал карту.`, { type: 'opp' });
      if (delta < 0) addLog(`${oppName}: ${ROLE_NAMES[char.role]} передал карту.`, { type: 'opp' });
    }
  }
}

let eventToastTimer = null;
function showBattleNotice(attackerName, targetName) {
  showEventToast(
    `<b>⚔ БОЙ</b><br>${escapeHtml(attackerName)} вступает в бой с ${escapeHtml(targetName)}`,
  );
}

function showEventToast(html) {
  if (pushGameMessage(textFromHtml(html), 'danger')) return;
  let el = document.getElementById('eventToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'eventToast';
    el.className = 'event-toast hidden';
    el.addEventListener('click', () => el.classList.add('hidden'));
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  // перезапуск css-анимации появления
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = '';
  clearTimeout(eventToastTimer);
  eventToastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}
