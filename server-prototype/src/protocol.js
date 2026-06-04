export const ClientCommand = Object.freeze({
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  TURN_ROLL: 'turn:roll',
});

export const ServerEvent = Object.freeze({
  CONNECTED: 'server:connected',
  ERROR: 'server:error',
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_SNAPSHOT: 'room:snapshot',
  TURN_ROLLED: 'turn:rolled',
});
