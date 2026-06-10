// Названия команд клиента и событий сервера.
// Игровые команды (turn:* / action:*) уходят в движок правил без изменений.

export const ClientCommand = Object.freeze({
  // комната и сессия
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  SESSION_RESUME: 'session:resume',
  // публичное лобби
  LOBBY_SUBSCRIBE: 'lobby:subscribe',
  LOBBY_UNSUBSCRIBE: 'lobby:unsubscribe',
  LOBBY_JOIN: 'lobby:join',
  // ход и кубики
  TURN_ROLL: 'turn:roll',
  TURN_SET_MODE: 'turn:setMode',
  TURN_END: 'turn:end',
  // действия с картами и фишками
  ACTION_DRAW: 'action:draw',
  ACTION_TRANSFER: 'action:transfer',
  ACTION_MOVE: 'action:move',
  ACTION_TELEPORT: 'action:teleport',
  ACTION_ATTACK: 'action:attack',
});

// Команды, которые обрабатывает движок правил, а не транспорт.
export const GAME_COMMANDS = Object.freeze(
  new Set([
    ClientCommand.TURN_ROLL,
    ClientCommand.TURN_SET_MODE,
    ClientCommand.TURN_END,
    ClientCommand.ACTION_DRAW,
    ClientCommand.ACTION_TRANSFER,
    ClientCommand.ACTION_MOVE,
    ClientCommand.ACTION_TELEPORT,
    ClientCommand.ACTION_ATTACK,
  ]),
);

export const ServerEvent = Object.freeze({
  CONNECTED: 'server:connected',
  ERROR: 'server:error',
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  SESSION_RESUMED: 'session:resumed',
  // список открытых публичных игр
  LOBBY_LIST: 'lobby:list',
  // персональный снимок состояния (своя рука видна, чужая скрыта)
  STATE_SNAPSHOT: 'state:snapshot',
});
