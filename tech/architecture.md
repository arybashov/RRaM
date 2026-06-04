# RRaM - техническая архитектура онлайн-версии

## 1. Цель архитектуры

Онлайн-версия RRaM должна поддерживать матч между игроками на островной карте с бордами, персонажами, кубиками, карточной системой, передачей карт, добором, использованием карт и телепортацией на подписанные стартовые точки.

Ключевой принцип: сервер является единственным источником истины. Клиент показывает состояние, отправляет намерения игрока и получает подтвержденные изменения от сервера.

## 2. Варианты технологического стека

### Вариант A: TypeScript fullstack

- Клиент: React, Vite, TypeScript.
- Рендер карты: PixiJS или Phaser.
- Сервер: Node.js, NestJS или Fastify.
- Realtime: WebSocket через Socket.IO или `ws`.
- База данных: PostgreSQL.
- Кэш и pub/sub: Redis.
- ORM: Prisma.

Плюсы:

- единый язык на клиенте и сервере;
- быстрое прототипирование;
- удобно описывать общие типы событий и DTO;
- хорошо подходит для браузерной онлайн-игры.

Минусы:

- для сложной симуляции и высокой нагрузки потребуется аккуратная оптимизация;
- Socket.IO удобен, но добавляет свой протокол поверх WebSocket.

Рекомендация для первого прототипа: этот вариант.

### Вариант B: Unity client + backend

- Клиент: Unity.
- Сервер: Node.js, Go или C#/.NET.
- Realtime: WebSocket, Nakama или Photon.
- База данных: PostgreSQL.

Плюсы:

- удобно делать визуальную RPG/RTS-часть;
- проще развивать анимации, эффекты, сцену и редактор карты;
- есть готовые сетевые решения.

Минусы:

- выше стоимость разработки;
- сложнее поддерживать web-first подход;
- больше инфраструктурных решений надо принимать сразу.

### Вариант C: Go backend + web client

- Клиент: React, TypeScript, PixiJS.
- Сервер: Go.
- Realtime: native WebSocket.
- База данных: PostgreSQL.
- Кэш: Redis.

Плюсы:

- высокая производительность;
- строгая серверная модель;
- хорошо подходит для authoritative server.

Минусы:

- больше ручной работы;
- типы клиента и сервера придется синхронизировать отдельным контрактом.

## 3. Рекомендуемая архитектура MVP

Для MVP лучше использовать TypeScript fullstack:

- Web client: React + TypeScript + PixiJS.
- API server: Node.js + Fastify.
- Game server module: отдельный модуль внутри backend, отвечающий за правила матча.
- Database: PostgreSQL.
- Realtime: WebSocket.
- Validation: Zod для входящих команд и серверных событий.
- Shared package: общие типы `GameState`, `Command`, `ServerEvent`.

Высокоуровневая схема:

```text
Client
  -> отправляет команды игрока через WebSocket
  -> получает снимки состояния и игровые события

API/Game Server
  -> проверяет авторизацию
  -> валидирует команды
  -> применяет игровые правила
  -> хранит состояние матча
  -> рассылает подтвержденные события

PostgreSQL
  -> хранит пользователей, матчи, карты, историю ходов, результат партии

Redis
  -> хранит активные сессии, presence, pub/sub между инстансами сервера
```

## 4. Серверная модель

### 4.1 Authoritative server

Сервер должен сам рассчитывать и подтверждать:

- стартовую расстановку персонажей;
- количество доступных бросков;
- результат броска кубиков;
- доступные действия после броска;
- перемещение по бордам;
- передачу карт между персонажами;
- добор карт из колоды;
- применение эффектов карт;
- телепортацию на разрешенные подписанные точки;
- окончание хода;
- победу, поражение или ничью.

Клиенту нельзя доверять:

- координаты перемещения;
- результат броска;
- количество карт;
- состав руки или инвентаря;
- доступность телепорта;
- порядок карт в колоде;
- право совершить действие.

Клиент отправляет только намерение:

```json
{
  "type": "move_character",
  "matchId": "match_1",
  "characterId": "char_warrior_p1",
  "path": ["b_10_3", "b_10_4", "b_11_4"],
  "dieId": "die_1"
}
```

Сервер проверяет путь и отвечает событием:

```json
{
  "type": "character_moved",
  "matchId": "match_1",
  "characterId": "char_warrior_p1",
  "from": "b_10_3",
  "to": "b_11_4",
  "spent": 3
}
```

### 4.2 Game loop

RRaM лучше моделировать как пошаговую игру с realtime-синхронизацией:

1. Сервер создает матч.
2. Игроки подключаются к комнате матча.
3. Сервер создает карту, колоды, персонажей и стартовые позиции.
4. Сервер назначает активного игрока.
5. Активный игрок делает бросок двух кубиков.
6. Сервер фиксирует результат броска.
7. Игрок распределяет значения кубиков на действия:
   - движение;
   - передача карт;
   - добор карты;
   - использование действия, разрешенного правилом или картой.
8. Сервер применяет каждое действие и рассылает события.
9. Игрок завершает ход.
10. Сервер передает ход следующему игроку.

Realtime нужен не для свободной симуляции, а для быстрых подтверждений, отображения действий соперника и восстановления состояния после реконнекта.

## 5. WebSocket и turn system

### 5.1 Подключение

Клиент подключается к WebSocket endpoint:

```text
wss://api.rram.example/ws
```

После подключения клиент отправляет:

```json
{
  "type": "join_match",
  "matchId": "match_1",
  "authToken": "jwt"
}
```

Сервер отвечает:

```json
{
  "type": "match_snapshot",
  "matchId": "match_1",
  "revision": 42,
  "state": {}
}
```

### 5.2 Revision model

У каждого матча есть `revision`. Любое подтвержденное сервером изменение увеличивает ревизию.

Клиент отправляет команды с последней известной ревизией:

```json
{
  "type": "roll_dice",
  "matchId": "match_1",
  "clientRevision": 42
}
```

Если клиент отстал, сервер может:

- отклонить команду событием `state_outdated`;
- отправить недостающие события;
- отправить полный `match_snapshot`.

### 5.3 Turn state

Состояние хода:

```ts
type TurnState = {
  activePlayerId: string;
  phase: "waiting" | "roll" | "action" | "reaction" | "end";
  remainingRolls: number;
  currentRoll?: {
    rollId: string;
    die1: number;
    die2: number;
    die1Status: "unused" | "spent";
    die2Status: "unused" | "spent";
  };
  startedAt: string;
  turnNumber: number;
};
```

Фазы:

- `waiting` - ожидание игроков или реконнекта;
- `roll` - активный игрок должен бросить кубики;
- `action` - игрок тратит значения кубиков на действия;
- `reaction` - опциональная фаза для карт реакции, если такие появятся;
- `end` - сервер завершает ход и передает его дальше.

## 6. Схема данных

### 6.1 User

```ts
type User = {
  id: string;
  displayName: string;
  createdAt: string;
};
```

### 6.2 Match

```ts
type Match = {
  id: string;
  status: "lobby" | "active" | "finished" | "cancelled";
  mapId: string;
  currentRevision: number;
  activePlayerId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

### 6.3 MatchPlayer

```ts
type MatchPlayer = {
  id: string;
  matchId: string;
  userId: string;
  seat: 1 | 2;
  team: "island_a" | "island_b";
  remainingRolls: number;
  isConnected: boolean;
};
```

### 6.4 BoardCell

```ts
type BoardCell = {
  id: string;
  mapId: string;
  q: number;
  r: number;
  terrainType: "normal" | "water" | "blocked" | "start" | "special";
  islandId?: string;
  isStartPoint: boolean;
  startPointType?: "blacksmith" | "blacksmith_assistant" | "warrior" | "hunter" | "shaman";
  neighbors: string[];
};
```

### 6.5 Character

```ts
type Character = {
  id: string;
  matchId: string;
  ownerPlayerId: string;
  type: "blacksmith" | "blacksmith_assistant" | "warrior" | "hunter" | "shaman";
  boardCellId: string;
  isAlive: boolean;
  stats: {
    hp: number;
    maxHp: number;
  };
};
```

### 6.6 Card

```ts
type Card = {
  id: string;
  matchId: string;
  templateId: string;
  name: string;
  type: "item" | "spell" | "action" | "reaction" | "teleport" | "resource";
  zone: "deck" | "hand" | "character_inventory" | "discard" | "removed";
  ownerPlayerId?: string;
  holderCharacterId?: string;
  orderIndex?: number;
  isConsumable: boolean;
};
```

### 6.7 Deck

```ts
type Deck = {
  id: string;
  matchId: string;
  type: "base" | "event" | "resource" | "special";
  cardIds: string[];
  discardCardIds: string[];
};
```

### 6.8 Roll

```ts
type Roll = {
  id: string;
  matchId: string;
  playerId: string;
  turnNumber: number;
  die1: number;
  die2: number;
  die1Status: "unused" | "spent";
  die2Status: "unused" | "spent";
  createdAt: string;
};
```

### 6.9 GameEvent

```ts
type GameEvent = {
  id: string;
  matchId: string;
  revision: number;
  type: string;
  payload: unknown;
  createdAt: string;
};
```

Историю событий стоит хранить в базе. Это поможет восстанавливать матч, разбирать спорные ситуации, тестировать правила и делать replay.

## 7. API-события

### 7.1 Client commands

Команды от клиента к серверу:

```ts
type ClientCommand =
  | JoinMatchCommand
  | LeaveMatchCommand
  | ReadyCommand
  | RollDiceCommand
  | MoveCharacterCommand
  | TransferCardsCommand
  | DrawCardCommand
  | UseCardCommand
  | TeleportCharacterCommand
  | EndTurnCommand
  | RequestSnapshotCommand;
```

Основные команды:

```json
{
  "type": "roll_dice",
  "matchId": "match_1",
  "clientRevision": 42
}
```

```json
{
  "type": "transfer_cards",
  "matchId": "match_1",
  "fromCharacterId": "char_shaman_p1",
  "toCharacterId": "char_warrior_p1",
  "cardIds": ["card_10", "card_11"],
  "dieId": "die_1",
  "clientRevision": 43
}
```

```json
{
  "type": "draw_card",
  "matchId": "match_1",
  "deckId": "deck_base",
  "targetCharacterId": "char_hunter_p1",
  "dieId": "die_2",
  "clientRevision": 44
}
```

```json
{
  "type": "teleport_character",
  "matchId": "match_1",
  "characterId": "char_warrior_p1",
  "cardId": "card_teleport_beads",
  "targetStartPointType": "warrior",
  "targetIslandId": "island_a",
  "clientRevision": 45
}
```

### 7.2 Server events

События от сервера к клиенту:

```ts
type ServerEvent =
  | MatchSnapshotEvent
  | PlayerJoinedEvent
  | PlayerLeftEvent
  | MatchStartedEvent
  | TurnStartedEvent
  | DiceRolledEvent
  | CharacterMovedEvent
  | CardsTransferredEvent
  | CardDrawnEvent
  | CardUsedEvent
  | CharacterTeleportedEvent
  | TurnEndedEvent
  | MatchFinishedEvent
  | CommandRejectedEvent
  | StateOutdatedEvent;
```

Примеры:

```json
{
  "type": "dice_rolled",
  "matchId": "match_1",
  "revision": 43,
  "roll": {
    "rollId": "roll_5",
    "die1": 2,
    "die2": 5
  }
}
```

```json
{
  "type": "cards_transferred",
  "matchId": "match_1",
  "revision": 44,
  "fromCharacterId": "char_shaman_p1",
  "toCharacterId": "char_warrior_p1",
  "cardIds": ["card_10", "card_11"],
  "spentDie": "die_1"
}
```

```json
{
  "type": "command_rejected",
  "matchId": "match_1",
  "reason": "TRANSFER_LIMIT_EXCEEDED",
  "message": "Значение кубика не позволяет передать столько карт."
}
```

## 8. Правила обработки действий

### 8.1 Бросок кубиков

- Бросок выполняется только сервером.
- Активный игрок может бросить кубики только в фазе `roll`.
- Сервер уменьшает `remainingRolls`, создает `Roll` и переводит ход в фазу `action`.
- Каждый кубик можно потратить один раз.

### 8.2 Движение

- Игрок выбирает персонажа и путь по бордам.
- Сервер проверяет, что персонаж принадлежит активному игроку.
- Сервер проверяет, что путь состоит из соседних клеток.
- Сервер проверяет, что длина пути не превышает значение выбранного кубика или сумму двух кубиков, если оба кубика тратятся на движение.
- Сервер обновляет позицию персонажа и помечает кубик или кубики как потраченные.

### 8.3 Передача карт

- Передача карт возможна только между персонажами одного игрока, если правила не разрешают другое.
- Количество передаваемых карт не может превышать значение выбранного кубика.
- Сервер проверяет, что карты находятся у передающего персонажа.
- После передачи выбранный кубик помечается как потраченный.

### 8.4 Добор карты

- Добор тратит один выбранный кубик.
- Значение кубика не влияет на количество добранных карт.
- По базовому правилу добирается одна карта.
- Сервер снимает верхнюю карту выбранной колоды и помещает ее в руку игрока или инвентарь персонажа, в зависимости от текущего правила.

### 8.5 Телепортация

- Телепортация выполняется только при наличии разрешающей карты или эффекта.
- Для карты "бусы телепортации" целями являются подписанные стартовые точки.
- Сервер проверяет, что целевая точка существует на карте и соответствует разрешенному типу.
- Сервер проверяет занятость клетки, если правила запрещают несколько персонажей на одной борде.
- После применения карта переходит в discard или removed, в зависимости от эффекта.

## 9. Хранение состояния матча

Для MVP можно хранить активное состояние матча в памяти игрового сервера и писать каждое подтвержденное событие в PostgreSQL.

Для production лучше:

- хранить снимок состояния матча в PostgreSQL;
- хранить историю событий в `game_events`;
- использовать Redis для быстрых активных матчей и reconnect;
- делать periodic snapshot каждые N событий;
- восстанавливать матч из последнего snapshot и последующих событий.

Минимальные таблицы:

- `users`;
- `matches`;
- `match_players`;
- `maps`;
- `board_cells`;
- `characters`;
- `cards`;
- `decks`;
- `rolls`;
- `game_events`;
- `match_snapshots`.

## 10. Безопасность и честность

Обязательные меры:

- JWT или session token для подключения;
- проверка прав игрока на матч;
- server-side dice random;
- запрет клиентских изменений состояния без команды;
- idempotency key для команд, чтобы не дублировать действия при повторной отправке;
- rate limit на команды;
- аудит важных событий;
- скрытие закрытой информации соперника, если карты в руке должны быть невидимыми.

События для разных клиентов могут отличаться. Например, владелец карты получает полный `cardId` и `name`, соперник получает только факт добора карты без раскрытия названия.

## 11. Reconnect и восстановление состояния

При разрыве соединения:

- сервер помечает игрока как disconnected;
- матч остается активным в течение таймера ожидания;
- после reconnect клиент отправляет `join_match`;
- сервер отправляет `match_snapshot` с актуальной ревизией;
- если клиент знает старую ревизию, сервер может отправить события с нужного номера.

Для MVP достаточно всегда отправлять полный snapshot после reconnect.

## 12. Тестирование правил

Правила игры должны быть вынесены в чистый модуль без зависимости от WebSocket и базы данных.

Покрыть тестами:

- стартовую расстановку;
- бросок кубиков;
- трату одного и двух кубиков;
- движение по соседним бордам;
- запрет движения через недоступные клетки;
- передачу карт с лимитом по кубику;
- добор одной карты независимо от значения кубика;
- телепортацию только на подписанные точки;
- отклонение команд неактивного игрока;
- восстановление состояния из событий.

## 13. План реализации MVP

1. Описать JSON-формат карты и стартовых точек.
2. Реализовать чистый game rules module.
3. Сделать создание матча и стартовую расстановку.
4. Подключить WebSocket-комнату матча.
5. Реализовать `join_match`, `match_snapshot`, `roll_dice`.
6. Реализовать движение по бордам.
7. Реализовать передачу карт и добор.
8. Реализовать карту телепортации.
9. Добавить историю событий и revision model.
10. Добавить reconnect.
11. Сделать базовый клиент с картой, персонажами, рукой и журналом событий.
