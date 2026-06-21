export const AUTH_COOKIE_NAME = 'rram_auth';

const DEFAULT_ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'https://rram.com.ru',
]);

export function registerAuth(app, { authStore }) {
  const allowedOrigins = allowedOriginsFromEnv();

  app.addHook('onRequest', async (req, reply) => {
    if (!isAuthPath(req.url)) return;
    applyCors(req, reply, allowedOrigins);
  });

  for (const path of ['/auth/me', '/auth/register', '/auth/login', '/auth/logout']) {
    app.options(path, async (req, reply) => {
      applyCors(req, reply, allowedOrigins);
      return reply.code(204).send();
    });
  }

  app.get('/auth/me', async (req) => ({
    user: getAuthUserFromRequest(req, authStore),
  }));

  app.post('/auth/register', async (req, reply) => {
    try {
      const { user, token } = authStore.register(req.body ?? {}, requestMeta(req));
      setAuthCookie(req, reply, token);
      return { user };
    } catch (error) {
      return authError(reply, error, 400);
    }
  });

  app.post('/auth/login', async (req, reply) => {
    try {
      const { user, token } = authStore.login(req.body ?? {}, requestMeta(req));
      setAuthCookie(req, reply, token);
      return { user };
    } catch (error) {
      return authError(reply, error, 401);
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = parseCookies(req)[AUTH_COOKIE_NAME];
    authStore.deleteSession(token);
    clearAuthCookie(req, reply);
    return { ok: true };
  });
}

export function getAuthUserFromRequest(req, authStore) {
  return authStore.getUserBySessionToken(parseCookies(req)[AUTH_COOKIE_NAME]);
}

export function parseCookies(req) {
  const out = {};
  const header = req?.headers?.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setAuthCookie(req, reply, token) {
  reply.header(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${30 * 24 * 60 * 60}${cookieAttrs(req)}`,
  );
}

function clearAuthCookie(req, reply) {
  reply.header('Set-Cookie', `${AUTH_COOKIE_NAME}=; Max-Age=0${cookieAttrs(req)}`);
}

function cookieAttrs(req) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  return `; HttpOnly; Path=/; SameSite=Lax${secure}`;
}

function requestMeta(req) {
  return {
    userAgent: req?.headers?.['user-agent'] ?? '',
  };
}

function authError(reply, error, statusCode) {
  const message = error instanceof Error && error.message
    ? error.message
    : 'Ошибка авторизации.';
  return reply.code(statusCode).send({ error: message, message });
}

function applyCors(req, reply, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (!allowedOrigins.has(origin)) return;
  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'content-type');
  reply.header('Vary', 'Origin');
}

function allowedOriginsFromEnv() {
  const out = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const origin of String(process.env.AUTH_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = origin.trim();
    if (trimmed) out.add(trimmed);
  }
  return out;
}

function isAuthPath(url) {
  return String(url ?? '').split('?')[0].startsWith('/auth/');
}
