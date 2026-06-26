# Сверка арта с картами из `cards.pdf`

Источник карт: `Doc/cards.pdf`.

Источник арта: `prototype-web/assets/cards`.

Важно: текущий код игры не использовался как источник истины. Эта сверка отвечает только на вопрос: для карт, восстановленных из PDF, есть ли сейчас подходящий файл арта.

## Обозначения

- `есть` - найден отдельный PNG, который можно использовать как лицевую сторону карты.
- `нет` - отдельного арта в текущих ассетах не найдено.
- `рубашка есть` - есть только рубашка соответствующей колоды, не лицевая карта.

## Рубашки колод

| Рубашка из PDF | Статус | Файл |
|---|---:|---|
| Базовые карты | есть | `backs/base-cards.png` |
| Смешанный грунт | есть | `backs/mixed-ground.png` |
| Лесная тропа | есть | `backs/forest-trail.png` |
| Лес | есть | `backs/forest.png` |
| Озеро | есть | `backs/lake.png` |
| Темный лес | есть | `backs/dark-forest.png` |
| Рецепты | есть | `backs/recipes.png` |
| Таинственная опушка | есть | `backs/fairy-glade.png` |
| Чертежи | есть | `backs/blueprints.png` |
| Красные звери | есть | `backs/red-beasts.png` |
| Баран | есть | `backs/sheep.png` |

## Базовые карты

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Воин | есть | `base/warrior/warrior-v3.png`, также `warrior-v2.png` |
| Базовый чертеж на дубину | есть | `base/warrior/club-blueprint-v1.png` |
| Дубина | есть | `base/warrior/club-v1.png` |
| Бусы телепортации | есть | `base/common/teleport-beads-v1.png` |
| Шаман | есть | `base/shaman/shaman-v3.png`, также `shaman-v2.png` |
| Клубок сплетенной нити из шерсти барана | есть | `base/common/yarn-v1.png` |
| Ковер шамана | есть | `base/shaman/shaman-carpet-v1.png` |
| Базовый рецепт на ковер шамана | есть | `base/shaman/shaman-carpet-recipe-v1.png` |
| Очищенная шкура барана | есть | `base/common/clean-ram-hide-v1.png` |
| Шерсть барана | есть | `base/common/ram-wool-v1.png` |
| Шкура барана | есть | `base/common/ram-hide-v1.png` |
| Баран | есть | `base/common/ram-v1.png` |
| Помощник кузнеца | есть | `base/assistant/assistant-v1.png` |
| Рецепт на мешок | есть | `base/assistant/sack-recipe-v1.png` |
| Мешок | есть | `base/assistant/sack-v1.png` |
| Охотник | есть | `base/hunter/hunter-v1.png` |
| Кузнец | есть | `base/blacksmith/blacksmith-v1.png` |
| Базовый чертеж на молоток | есть | `base/blacksmith/hammer-blueprint-v1.png` |
| Молоток | есть | `base/blacksmith/hammer-v1.png` |
| Грязная смешанная железная руда | есть | `base/blacksmith/mixed-iron-ore-v1.png` |

## Смешанный грунт

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Железная руда среднего качества | есть | `mixed/medium-quality-iron-ore-v1.png` |
| Грязная смешанная железная руда | есть | `mixed/dirty-mixed-iron-ore-v1.png` |
| Сухой череп | есть | `mixed/dry-skull-v1.png` |
| Очищенная шкура зверя | есть | `materials/beast-hides/clean-beast-hide-v1.png` |
| Шкура убитого зверя | есть | `materials/beast-hides/raw-beast-hide-v1.png` |
| Дикий кабан | есть | `beasts/red/wild-boar-v*.png` |
| Малый золотой самородок | есть | `forest/gold-nugget-v1.png` |

## Лесная тропа / лесные карты

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Гриб мухомор | есть | `forest/amanita-v1.png` |
| Кора дерева | есть | `forest/bark-v1.png` |
| Дубовые желуди | есть | `forest/oak-acorns-v1.png` |
| Полянка мухоморов | есть | `forest/amanita-glade-v1.png` |
| Полена дерева | есть | `forest/firewood-logs-v1.png` |
| Дикие красные ягоды | есть | `dark-forest/red-berries-v1.png` |
| Гнущаяся палка | есть | `forest/bending-stick-v1.png` |
| Ночной филин | есть | `forest/night-owl-v1.png` |
| Обычная сова | есть | `forest/common-owl-v1.png` |
| Черные ягоды | есть | `dark-forest/black-berries-v1.png` |
| Железная руда высшего качества | есть | `forest/high-quality-iron-ore-v1.png` |
| Толстая ветка | есть | `forest/thick-branch-v1.png` |

## Озеро

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Мраморный самоцвет | есть | `lake/marble-gem-v1.png` |
| Мутный изумруд | есть | `lake/cloudy-emerald-v1.png` |
| Драгоценный камень | есть | `lake/precious-gem-v1.png` |
| Крапленый аметист | есть | `lake/speckled-amethyst-v1.png` |
| Необработанный рубин | есть | `lake/raw-ruby-v1.png` |
| Озерная лягушка | есть | `lake/lake-frog-v1.png` |
| Проросший корень | есть | `lake/sprouted-root-v1.png` |

## Звери и шкуры

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Бурый медведь | есть | `beasts/red/brown-bear-v1.png` |
| Агрессивный бурый медведь | есть | `beasts/red/aggressive-brown-bear-v1.png` |
| Серый волк | есть | `beasts/red/gray-wolf-v1.png` |
| Дикий кабан | есть | `beasts/red/wild-boar-v*.png` |
| Шкура медведя | есть | `materials/beast-hides/bear-hide-v1.png` |
| Шкура кабана | есть | `materials/beast-hides/boar-hide-v1.png` |
| Шкура волка | есть | `materials/beast-hides/wolf-hide-v1.png` |
| Шкура убитого зверя | есть | `materials/beast-hides/raw-beast-hide-v1.png` |
| Очищенная шкура зверя | есть | `materials/beast-hides/clean-beast-hide-v1.png` |

## Темный лес / чертежи / изделия

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Средний золотой самородок | есть | `dark-forest/medium-gold-nugget-v1.png` |
| Большой золотой самородок | есть | `dark-forest/large-gold-nugget-v1.png` |
| Чертеж на небрежную кольчугу | есть | `dark-forest/blueprint-rough-chainmail-v1.png` |
| Небрежная кольчуга | есть | `dark-forest/rough-chainmail-v1.png` |
| Чертеж на легкую кольчугу | есть | `dark-forest/blueprint-light-chainmail-v1.png` |
| Легкая кольчуга | есть | `dark-forest/light-chainmail-v1.png` |
| Чертеж на щит защита духа | есть | `dark-forest/blueprint-spirit-shield-v1.png` |
| Щит защита духа | есть | `dark-forest/spirit-shield-v1.png` |
| Чертеж на щит др. | есть | `dark-forest/blueprint-shield-dr-v1.png` |
| Щит др. | есть | `dark-forest/shield-dr-v1.png` |
| Чертеж на ломщит | есть | `dark-forest/blueprint-shield-lom-v1.png` |
| Ломщит | есть | `dark-forest/shield-lom-v1.png` |
| Чертеж на топормол | есть | `dark-forest/blueprint-topormol-v1.png` |
| Топормол | есть | `dark-forest/topormol-v1.png` |
| Чертеж на щит калан | есть | `dark-forest/blueprint-shield-kalan-v1.png` |
| Щит калан | есть | `dark-forest/shield-kalan-v1.png` |
| Чертеж на меч сеч | есть | `dark-forest/blueprint-sword-sech-v1.png` |
| Меч сеч | есть | `dark-forest/sword-sech-v1.png` |
| Чертеж на деревянный молоток | есть | `dark-forest/blueprint-wooden-hammer-v1.png` |
| Деревянный молоток | есть | `dark-forest/wooden-hammer-v1.png` |
| Чертеж на красное солнце | есть | `dark-forest/blueprint-axe-sun-v1.png` |
| Секира красное солнце | есть | `red/axe-sun-v1.png` |
| Задание на молот Иерихон | есть | `red/task-irikon-v1.png` |
| Иерихон | есть | `red/irikon-v1.png` |
| Чертеж Иерихон | есть | `blueprints/blueprint-irikon-v1.png` |
| Чертеж на меч лорп | есть | `dark-forest/blueprint-sword-lorp-v1.png` |
| Меч Лорп | есть | `dark-forest/sword-lorp-v1.png` |
| Кольцо возврата | есть | `dark-forest/return-ring-v1.png` |
| Чертеж на ошейник | есть | `dark-forest/blueprint-taming-collar-v1.png` |
| Ошейник приручения | есть | `dark-forest/taming-collar-v1.png` |
| Чертеж на щит отмщение | есть | `dark-forest/blueprint-shield-revenge-v1.png` |
| Щит отмщение | есть | `dark-forest/shield-revenge-v1.png` |
| Чертеж на щит луна | есть | `dark-forest/blueprint-moon-shield-v1.png` |
| Щит луна | есть | `dark-forest/moon-shield-v1.png` |
| Чертеж шема | есть | `dark-forest/blueprint-helm-shem-v1.png` |
| Шлем шем | есть | `dark-forest/helm-shem-v1.png` |
| Чертеж на рецепт близнецы | есть | `dark-forest/blueprint-twin-axes-v1.png` |
| Топоры близнецы | есть | `dark-forest/twin-axes-v1.png` |
| Чертеж на панцирь | есть | `dark-forest/blueprint-carapace-v1.png` |
| Панцирь | есть | `dark-forest/carapace-v1.png` |
| Чертеж на шлем ТТМ | есть | `dark-forest/blueprint-helm-ttm-v1.png` |
| Шлем ТТМ | есть | `dark-forest/helm-ttm-v1.png` |
| Чертеж на защиту Ил | есть | `dark-forest/blueprint-armor-il-v1.png` |
| Защита Ил | есть | `dark-forest/armor-il-v1.png` |

## Рецепты

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Рецепт на жест | есть | `recipes/recipe-armor-v1.png` |
| Жест | есть | `recipes/armor-zhest-v1.png` |
| Рецепт на каска-маска | есть | `recipes/recipe-helmet-mask-v1.png` |
| Каска-маска | есть | `recipes/helmet-mask-v1.png` |
| Рецепт на рубашку из кожи | есть | `recipes/recipe-leather-shirt-v1.png` |
| Кожаная рубашка | есть | `dark-forest/leather-shirt-v1.png` |
| Рецепт на одежду разведчика | есть | `recipes/recipe-scout-clothes-v1.png` |
| Разведка | есть | `recipes/scout-clothes-v1.png` |
| Рецепт на маску трехликого | есть | `recipes/recipe-three-faced-mask-v1.png` |
| Маска трехликого | есть | `recipes/three-faced-mask-v1.png` |
| Рецепт на бубун | есть | `recipes/recipe-bubun-mask-v1.png` |
| Маска бубун | есть | `recipes/bubun-mask-v1.png` |
| Рецепт на маску оху | есть | `recipes/recipe-okhu-mask-v1.png` |
| Маска оху | есть | `recipes/okhu-mask-v1.png` |
| Рецепт на бутыль дип | есть | `recipes/recipe-dip-bottle-v1.png` |
| Бутыль дип | есть | `recipes/dip-bottle-v1.png` |
| Рецепт на маску злая | есть | `recipes/recipe-evil-mask-v1.png` |
| Маска злая | есть | `recipes/evil-mask-v1.png` |
| Рецепт на обычный посох | есть | `recipes/recipe-common-staff-v1.png` |
| Обычный посох | есть | `recipes/common-staff-v1.png` |
| Посох тэрниа | есть | `recipes/ternia-staff-v1.png` |
| Порча | есть | `recipes/porcha-v1.png` |
| Рецепт на обряд | есть | `recipes/recipe-rite-v1.png` |
| Обряд трех | есть | `recipes/rite-of-three-v1.png` |
| Рецепт на заклятие хозяин | есть | `recipes/recipe-master-curse-v1.png` |
| Заклятие хозяин | есть | `recipes/master-curse-v1.png` |
| Шкура ритуалов | есть | `recipes/ritual-hide-v1.png` |

## Таинственная опушка

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Редкий самоцвет | есть | `fairy-glade/rare-gem-v1.png` |
| Феникс | есть | `fairy-glade/phoenix-own-v1.png`, `fairy-glade/phoenix-enemy-v1.png` |
| Золотое перо к кузнецу противника | есть | `fairy-glade/gold-feather-enemy-smith-v1.png` |
| Золотое перо к своему кузнецу | есть | `fairy-glade/gold-feather-own-smith-v1.png` |
| Жаба вирид | есть | `fairy-glade/virid-toad-v1.png` |

## Мусор / заглушки исходника

| Карта из PDF | Статус | Файл / заметка |
|---|---:|---|
| Ветка куста. Не применима не к чему | нет | можно не переносить как игровую карту |
| Зеленая прямоугольная заглушка | нет | можно не переносить как игровую карту |

## Главные дыры по арту

Текущий статус после генерации: все карты, которые были отмечены как `нет` или `частично` и признаны игровыми, получили отдельные PNG-ассеты.

Остались только исходные мусорные/служебные элементы из PDF, которые пока не переносим как игровые карты:

1. Ветка куста. Не применима не к чему.
2. Зеленая прямоугольная заглушка.
