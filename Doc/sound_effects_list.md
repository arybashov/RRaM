# RRaM — список звуковых эффектов (SFX)

Привязка к реальным игровым событиям (действия сервера `action:*` / `turn:*` и
поля результата). Формат строки: **`id-файла`** — триггер — характер звука.

Стиль: тёмное фэнтези, грубое «варварское» ремесло (металл, дерево, кости, огонь).
Длительность коротких SFX — 0.2–0.8 с, фоновых лупов — 20–40 с.

---

## 1. Кубики и ход
- **dice-roll** — `turn:roll` (бросок 2 кубиков) — стук костяных кубиков по дереву.
- **dice-settle** — кубики легли (можно слить с dice-roll) — короткий «тук» остановки.
- **turn-start** — начало своего хода — мягкий гонг/сигнал «твой ход».
- **turn-end** — `turn:end` — глухой удар/затухание.
- **move-reset** — `turn:resetMove` (откат ноги к старту) — обратная «перемотка».

## 2. Движение
- **step-move** — `action:move` / `result.moved` (шаг фишки по клеткам) — шаги по земле/гравию (можно по кол-ву бордов).
- **teleport-cast** — `action:teleport` / `result.teleported` (Бусы телепортации) — магический «вжух» исчезновения/появления.
- **teleport-recharge** — `action:rechargeTeleport` / `result.teleportRecharged` — звон перезарядки (кубик 4+).

## 3. Карты
- **card-draw** — `action:draw` / `result.drawn` (добор с клетки/колоды) — взмах вытягивания карты.
- **card-draw-profession** — `action:drawProfession` (Чертежи/Рецепты) — то же, но «значимее» (редкая карта).
- **card-flip-reveal** — переворот карты лицом в окне-ревиле (клик по висящей карте) — щелчок/переворот картона.
- **card-to-inventory** — карта уходит в инвентарь (финальный клик ревила) — мягкий «шорк» в стопку.
- **card-place-terrain** — `action:terrainPlace` / `result.terrainPlaced` — шлепок карты на стол/землю.
- **card-flip-terrain** — `action:terrainFlip` / `result.terrainFlipped` (переворот на террейне, вскрытие ловушки) — резкий переворот.
- **card-remove-terrain** — `action:terrainRemove` / `result.terrainRemoved` — карта снимается обратно.
- **card-transfer** — `action:transfer` / `result.transferred` (передача) — шелест передачи карты.
- **card-discard** — `action:discardCard` / `result.discardedCard` — сброс карты.

## 4. Бой с игроком
- **combat-engage** — `action:engage` / `result.engaged` (вступление в бой) — лязг/вызов на бой.
- **attack-hit** — `action:attack` / `result.attacked` (обычный удар) — удар по плоти/броне.
- **attack-weapon** — удар с оружием (меч/секира/Топормол) — свист и рассечение.
- **attack-blocked** — урон поглощён бронёй/щитом (`armorAbsorbed`) — звон по металлу.
- **attack-crit-hammer** — Молот Иерихон / пробивающий урон — тяжёлый сокрушительный удар.
- **trap-trigger** — сработала ловушка (`result.attacked.traps`) — резкий магический «снап» + по типу ловушки.
- **character-defeat** — гибель персонажа (`defeated`) — предсмертный хрип + падение.
- **loot-grab** — победитель забрал инвентарь (`lootCount`) — звон добычи.

## 5. Схватка со зверем
- **beast-appear** — `result.redEvent.beast` (зверь на красной клетке) — рык появления зверя.
- **beast-bite** — зверь кусает в начале хода — рык + укус.
- **beast-fight-hit** — `action:fightBeast` / `result.beastFought` (удар по зверю) — глухой удар по туше.
- **beast-defeat** — зверь убит — финальный рёв и падение.

## 6. Крафт и ремёсла
- **craft-success** — `action:craft` / `result.crafted` (изделие открыто) — кузнечный звон/«готово».
- **craft-fail** — `result.craftAttempt` неудача (кубики не прошли) — глухой «не вышло».
- **hide-process** — `action:processHide` / `result.hideProcessed` (обработка шкуры) — скобление/выделка кожи.

## 7. Лечение и эффекты
- **heal-nugget** — `action:useGoldNugget` / `result.goldNuggetUsed` — тёплый «целебный» звон.
- **heal-carpet** — Ковёр шамана (лечение союзников в начале хода) — мягкое исцеляющее свечение.
- **dead-ore-use** — `action:useDeadOre` / `result.deadOreUsed` (взять карту с неживой руды) — глухой каменный «дроп».
- **frog-spell** — `action:useLakeFrog` / `result.lakeFrogUsed` (заклятие лягушки) — булькающая магия.
- **marvo-cast** — `action:useMarvo` / `result.marvoUsed` (Обряд трёх) — мощный ритуальный аккорд урона.
- **dot-tick** — урон по времени (яд/ожог) в начале хода — шипение/тление.
- **dot-discharge** — `action:dischargeDot` / `result.dotDischarged` (стряхнул эффект) — «сброс» наваждения.

## 8. Дварфы и костры
- **dwarf-enter** — выход дварфов на маршрут — маршевый барабан/топот.
- **dwarf-move** — шаг группы дварфов — тяжёлые шаги.
- **bonfire-light** — дварфы зажгли костёр — вспышка пламени.
- **bonfire-extinguish** — костёр потушен — шипение гаснущего огня.
- **dwarf-defeat** — убийство дварфа / дварфом (карта черепа) — кость/череп.

## 9. Финал партии
- **victory** — `result.featherVictory` или гибель всех/кузнеца врага — триумфальный фанфар.
- **defeat** — поражение игрока — мрачное затухание.

## 10. Квест «Перо феникса»
- **phoenix-appear** — феникс на Сказочной опушке — огненный крик птицы.
- **feather-pickup** — поднято Золотое перо — звонкое магическое «дзынь».
- **feather-victory** — перо донесено до кузнеца (`featherVictory`) — большой победный аккорд (ярче обычного victory).

## 11. Интерфейс (UI)
- **ui-click** — нажатие кнопок действий/режимов — короткий клик.
- **ui-select-character** — выбор персонажа — мягкий «блик».
- **ui-error** — недопустимое действие (`showActionWarning`) — короткий «нельзя».
- **ui-notify** — тост/уведомление — лёгкий «дзинь».
- **lobby-join** — подключение к комнате / старт партии — приветственный аккорд.
- **chat-message** — входящее сообщение чата — тихий «поп».

## 12. Фон / эмбиент (опционально, луп)
- **amb-forest** — лесные острова — птицы, ветер, листва.
- **amb-battle** — во время боя — приглушённый напряжённый гул/барабаны.
- **amb-menu** — лобби/меню — спокойная фэнтези-тема.

---

### Приоритет для прототипа (минимум)
dice-roll, step-move, card-draw, card-flip-reveal, card-place-terrain,
card-flip-terrain, attack-hit, character-defeat, beast-fight-hit, craft-success,
heal-nugget, teleport-cast, ui-click, ui-error, victory, defeat.
