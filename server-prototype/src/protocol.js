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
  TURN_RESET_MOVE: 'turn:resetMove',
  TURN_END: 'turn:end',
  // действия с картами и фишками
  ACTION_DRAW: 'action:draw',
  ACTION_TRANSFER: 'action:transfer',
  ACTION_MOVE: 'action:move',
  ACTION_TELEPORT: 'action:teleport',
  ACTION_ENGAGE: 'action:engage',
  ACTION_ATTACK: 'action:attack',
  ACTION_FIGHT_BEAST: 'action:fightBeast',
  ACTION_PROCESS_HIDE: 'action:processHide',
  ACTION_CRAFT: 'action:craft',
  ACTION_TERRAIN_PLACE: 'action:terrainPlace',
  ACTION_TERRAIN_REMOVE: 'action:terrainRemove',
  ACTION_TERRAIN_FLIP: 'action:terrainFlip',
  DEBUG_GRANT_CARD: 'debug:grantCard',
});

// Команды, которые обрабатывает движок правил, а не транспорт.
export const GAME_COMMANDS = Object.freeze(
  new Set([
    ClientCommand.TURN_ROLL,
    ClientCommand.TURN_SET_MODE,
    ClientCommand.TURN_RESET_MOVE,
    ClientCommand.TURN_END,
    ClientCommand.ACTION_DRAW,
    ClientCommand.ACTION_TRANSFER,
    ClientCommand.ACTION_MOVE,
    ClientCommand.ACTION_TELEPORT,
    ClientCommand.ACTION_ENGAGE,
    ClientCommand.ACTION_ATTACK,
    ClientCommand.ACTION_FIGHT_BEAST,
    ClientCommand.ACTION_PROCESS_HIDE,
    ClientCommand.ACTION_CRAFT,
    ClientCommand.ACTION_TERRAIN_PLACE,
    ClientCommand.ACTION_TERRAIN_REMOVE,
    ClientCommand.ACTION_TERRAIN_FLIP,
    ClientCommand.DEBUG_GRANT_CARD,
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
