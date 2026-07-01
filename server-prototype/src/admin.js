// Админ-панель: страница /admin + JSON /admin/data.
// Показывает подключённых клиентов (где они, девайс, idle, версия, IP) и комнаты.
//
// Авторизация ВРЕМЕННО ОТКЛЮЧЕНА (пользователей мало, пароль неудобно вводить).
// Чтобы вернуть вход по паролю — задайте ADMIN_AUTH=1 и ADMIN_PASSWORD. Тогда
// заработает HTML-форма логина (/admin/login) с сессионной кукой (Chrome/менеджеры
// паролей автозаполняют) и совместимый HTTP Basic Auth (curl/скрипты).
import { randomBytes, timingSafeEqual } from 'node:crypto';

const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
// По умолчанию админка открыта без пароля. Вход включается только явным ADMIN_AUTH=1.
const AUTH_ENABLED = process.env.ADMIN_AUTH === '1' && Boolean(ADMIN_PASSWORD);

const COOKIE_NAME = 'rram_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов
// Сессии в памяти процесса: token → срок истечения. Сервер одиночный, при
// перезапуске сессии сбрасываются (для админки приемлемо).
const sessions = new Map();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function createSession() {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function sessionValid(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function passwordOk(user, pass) {
  return safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASSWORD);
}

// Авторизован ли запрос: либо валидная сессионная кука, либо корректный Basic Auth.
function isAuthed(req) {
  if (sessionValid(parseCookies(req)[COOKIE_NAME])) return true;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (m) {
    const dec = Buffer.from(m[1], 'base64').toString('utf8');
    const idx = dec.indexOf(':');
    if (idx >= 0 && passwordOk(dec.slice(0, idx), dec.slice(idx + 1))) return true;
  }
  return false;
}

// Secure-флаг только за HTTPS (req.protocol учитывает X-Forwarded-Proto при trustProxy);
// локально по http браузер Secure-куку не примет.
function cookieAttrs(req) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  return `; HttpOnly; Path=/admin; SameSite=Lax${secure}`;
}

function setSessionCookie(req, reply, token) {
  reply.header('Set-Cookie',
    `${COOKIE_NAME}=${token}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${cookieAttrs(req)}`);
}

function clearSessionCookie(req, reply) {
  reply.header('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0${cookieAttrs(req)}`);
}

// Короткая расшифровка девайса из user-agent: тип (📱/🖥/📋) + ОС + браузер.
// Не претендует на точность — для админки достаточно «с чего зашёл клиент».
function deviceFromUA(ua) {
  if (!ua) return '—';
  const s = ua;
  const has = (re) => re.test(s);

  let os = 'неизв. ОС';
  if (has(/iPhone/)) os = 'iPhone';
  else if (has(/iPad/)) os = 'iPad';
  else if (has(/Android/)) os = 'Android';
  else if (has(/Windows/)) os = 'Windows';
  else if (has(/Mac OS X|Macintosh/)) os = 'macOS';
  else if (has(/CrOS/)) os = 'ChromeOS';
  else if (has(/Linux/)) os = 'Linux';

  let browser = '';
  if (has(/Edg\//)) browser = 'Edge';
  else if (has(/OPR\/|Opera/)) browser = 'Opera';
  else if (has(/YaBrowser/)) browser = 'Yandex';
  else if (has(/SamsungBrowser/)) browser = 'Samsung';
  else if (has(/Firefox\//)) browser = 'Firefox';
  else if (has(/Chrome\//)) browser = 'Chrome';
  else if (has(/Safari\//) && has(/Version\//)) browser = 'Safari';

  const mobile = has(/iPhone|Android.*Mobile|Mobile.*Safari|Windows Phone/);
  const tablet = has(/iPad|Android(?!.*Mobile)|Tablet/);
  const icon = mobile ? '📱' : tablet ? '📋' : '🖥';

  return `${icon} ${os}${browser ? ' · ' + browser : ''}`;
}

function buildData({ store, clients, lobbySubscribers, version }) {
  const now = Date.now();
  const clientList = [];
  for (const [id, c] of clients) {
    let name = null;
    let side = null;
    let roomCode = null;
    if (c.roomId) {
      const room = store.getRoom(c.roomId);
      roomCode = room?.code ?? null;
      const p = room?.players.find((pl) => pl.id === c.playerId);
      name = p?.name ?? null;
      side = p?.side ?? null;
    }
    clientList.push({
      id: id.slice(0, 8),
      ip: c.ip ?? '?',
      version: c.version ?? '?',
      ua: c.ua ?? '',
      device: deviceFromUA(c.ua ?? ''),
      connectedSec: Math.round((now - (c.connectedAt ?? now)) / 1000),
      idleSec: Math.round((now - (c.lastSeen ?? now)) / 1000),
      // RTT от сервера до клиента (srv:ping/srv:pong). Только свежий замер (<30с).
      rtt: (typeof c.rtt === 'number' && (now - (c.rttAt ?? 0)) < 30000) ? c.rtt : null,
      state: c.roomId ? 'в игре' : (lobbySubscribers.has(id) ? 'лобби' : 'подключён'),
      roomCode,
      name,
      side,
    });
  }
  clientList.sort((a, b) => b.connectedSec - a.connectedSec);
  const rooms = store.adminRooms();
  return {
    now,
    serverVersion: version,
    uptimeSec: Math.round(process.uptime()),
    counts: {
      clients: clients.size,
      rooms: rooms.length,
      lobbyWatchers: lobbySubscribers.size,
    },
    clients: clientList,
    rooms,
  };
}

export function registerAdmin(app, deps) {
  // Парсер форм (application/x-www-form-urlencoded) для POST /admin/login —
  // нужен, т.к. Fastify по умолчанию разбирает только JSON. Глобально безопасно:
  // другие маршруты сервера форм-тело не принимают.
  try {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(body))); }
      catch (err) { done(err); }
    });
  } catch { /* парсер уже зарегистрирован */ }

  app.get('/admin', async (req, reply) => {
    if (AUTH_ENABLED && !isAuthed(req)) return reply.redirect('/admin/login');
    return reply.type('text/html; charset=utf-8').send(ADMIN_HTML);
  });

  app.get('/admin/login', async (req, reply) => {
    if (!AUTH_ENABLED) return reply.redirect('/admin'); // пароль отключён — входить незачем
    if (isAuthed(req)) return reply.redirect('/admin');
    return reply.type('text/html; charset=utf-8').send(LOGIN_HTML(Boolean(req.query?.e)));
  });

  app.post('/admin/login', async (req, reply) => {
    if (!AUTH_ENABLED) return reply.redirect('/admin');
    const user = String(req.body?.username ?? '');
    const pass = String(req.body?.password ?? '');
    if (passwordOk(user, pass)) {
      setSessionCookie(req, reply, createSession());
      return reply.redirect('/admin');
    }
    return reply.redirect('/admin/login?e=1');
  });

  app.get('/admin/logout', async (req, reply) => {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) sessions.delete(token);
    clearSessionCookie(req, reply);
    return reply.redirect(AUTH_ENABLED ? '/admin/login' : '/admin');
  });

  app.get('/admin/data', async (req, reply) => {
    if (AUTH_ENABLED && !isAuthed(req)) return reply.code(401).send({ error: 'unauthorized' });
    return buildData(deps);
  });
}

// Страница входа: настоящая HTML-форма с username+password и autocomplete —
// так Chrome и менеджеры паролей сохраняют/автозаполняют учётку (в отличие от
// нативного попапа Basic Auth).
function LOGIN_HTML(error) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RRaM · вход в админку</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif; background:#0e1726; color:#dbe4f0; }
  form { background:#13203a; border:1px solid #243a63; border-radius:12px; padding:24px;
    width:280px; display:grid; gap:12px; box-shadow:0 8px 30px rgba(0,0,0,.35); }
  h1 { margin:0 0 4px; font-size:16px; color:#5fe3b0; }
  label { font-size:12px; color:#9fb4d4; display:grid; gap:4px; }
  input { background:#1b2a47; color:#dbe4f0; border:1px solid #2c416b; border-radius:8px;
    padding:9px 10px; font-size:14px; }
  input:focus { outline:none; border-color:#5fe3b0; }
  button { margin-top:4px; background:#1f7a55; color:#eafff5; border:0; border-radius:8px;
    padding:10px; font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#258a61; }
  .err { margin:0; color:#ff6b6b; font-size:13px; }
</style></head>
<body>
  <form method="post" action="/admin/login" autocomplete="on">
    <h1>RRaM · админка</h1>
    ${error ? '<p class="err">Неверный логин или пароль.</p>' : ''}
    <label>Логин
      <input type="text" name="username" value="admin" autocomplete="username" autocapitalize="off" autocorrect="off" />
    </label>
    <label>Пароль
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    <button type="submit">Войти</button>
  </form>
</body></html>`;
}

const ADMIN_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RRaM · админка</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif; background:#0e1726; color:#dbe4f0; }
  header { padding:12px 16px; background:#13203a; border-bottom:1px solid #243a63; display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  header b { color:#5fe3b0; }
  .stat { background:#1b2a47; padding:4px 10px; border-radius:8px; }
  main { padding:16px; display:grid; gap:20px; }
  h2 { margin:0 0 8px; font-size:15px; color:#9fb4d4; }
  table { width:100%; border-collapse:collapse; background:#13203a; border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:7px 10px; border-bottom:1px solid #1f2f4d; white-space:nowrap; }
  th { background:#1b2a47; color:#9fb4d4; font-weight:600; }
  tr:last-child td { border-bottom:0; }
  .warn { color:#ffb454; } .bad { color:#ff6b6b; } .ok { color:#5fe3b0; } .muted { color:#6b7c99; }
  .pill { padding:1px 7px; border-radius:6px; background:#243a63; font-size:12px; }
  .watch-link { display:inline-block; padding:2px 8px; border-radius:6px; background:#1f7a55; color:#eafff5; text-decoration:none; font-size:12px; font-weight:700; }
  .watch-link:hover { background:#258a61; }
</style></head>
<body>
<header>
  <span>RRaM админка</span>
  <span class="stat">сервер <b id="ver">…</b></span>
  <span class="stat">uptime <b id="up">…</b></span>
  <span class="stat">клиентов <b id="cc">…</b></span>
  <span class="stat">комнат <b id="rc">…</b></span>
  <span class="stat">ваша задержка <b id="ours">…</b></span>
  <span class="stat muted" id="updated"></span>
  <a href="/admin/logout" style="margin-left:auto;color:#9fb4d4;text-decoration:none">выйти →</a>
</header>
<main>
  <section>
    <h2>График задержки / соединения
      <span style="float:right;font-weight:400;color:#9fb4d4">
        интервал <input id="interval" type="number" min="1" max="60" value="3" style="width:48px;background:#1b2a47;color:#dbe4f0;border:1px solid #2c416b;border-radius:6px;padding:2px 6px"> с
        · <label><input id="pause" type="checkbox"> пауза</label>
      </span>
    </h2>
    <canvas id="chart" width="1100" height="200" style="width:100%;height:200px;background:#13203a;border-radius:10px"></canvas>
    <div style="margin-top:6px;font-size:12px;color:#9fb4d4">
      <span style="color:#5fe3b0">▬ ваша задержка</span> &nbsp;
      <span style="color:#ffb454">▬ макс. пинг клиентов</span> &nbsp;
      <span style="color:#6aa6ff">▬ клиентов (шт)</span>
    </div>
  </section>
  <section><h2>Клиенты</h2><table id="clients"><thead><tr>
    <th>id</th><th>IP</th><th>девайс</th><th>пинг</th><th>версия</th><th>где</th><th>комната</th><th>игрок</th><th>онлайн</th><th>idle</th>
  </tr></thead><tbody></tbody></table></section>
  <section><h2>Комнаты / партии</h2><table id="rooms"><thead><tr>
    <th>код</th><th>старт</th><th>тип</th><th>статус</th><th>игроки</th><th>партия</th><th>действие</th>
  </tr></thead><tbody></tbody></table></section>
</main>
<script>
const fmtDur = s => s>=3600 ? Math.floor(s/3600)+'ч '+Math.floor(s%3600/60)+'м' : s>=60 ? Math.floor(s/60)+'м '+(s%60)+'с' : s+'с';
const fmtDateTime = ms => ms ? new Date(ms).toLocaleString() : '—';
function idleCls(s){ return s>30 ? 'bad' : s>10 ? 'warn' : 'ok'; }
function pingCls(ms){ return ms==null ? 'muted' : ms<150 ? 'ok' : ms<600 ? 'warn' : 'bad'; }

// История сэмплов для графика (кольцевой буфер). Каждый тик добавляет точку.
const MAX_POINTS = 240;
const history = [];
function drawChart(){
  const cv = document.getElementById('chart'); if(!cv) return;
  const ctx = cv.getContext('2d'); const W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  const padL=40,padR=10,padT=10,padB=8, plotW=W-padL-padR, plotH=H-padT-padB;
  let maxV=50, maxCl=2;
  for(const s of history){ if(s.ours>maxV)maxV=s.ours; if(s.maxRtt!=null&&s.maxRtt>maxV)maxV=s.maxRtt; if((s.clients||0)>maxCl)maxCl=s.clients; }
  maxV=Math.ceil(maxV/50)*50;
  ctx.strokeStyle='#1f2f4d'; ctx.fillStyle='#6b7c99'; ctx.font='10px system-ui'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){ const y=padT+plotH*i/4; ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke(); ctx.fillText(Math.round(maxV*(1-i/4))+'мс',2,y+3); }
  const n=history.length; if(n<2) return;
  const x=i=> padL+plotW*(i/(n-1));
  const yMs=v=> padT+plotH*(1-Math.min(v,maxV)/maxV);
  const yCl=v=> padT+plotH*(1-Math.min(v,maxCl)/maxCl);
  const line=(get,color,scale)=>{ ctx.strokeStyle=color; ctx.lineWidth=1.6; ctx.beginPath(); let on=false;
    for(let i=0;i<n;i++){ const v=get(history[i]); if(v==null){on=false;continue;} const px=x(i),py=scale(v); on?ctx.lineTo(px,py):ctx.moveTo(px,py); on=true; } ctx.stroke(); };
  line(s=>s.ours,'#5fe3b0',yMs);
  line(s=>s.maxRtt,'#ffb454',yMs);
  line(s=>s.clients,'#6aa6ff',yCl);
}

async function tick(){
  const t0 = performance.now();
  let d;
  try {
    const res = await fetch('/admin/data',{cache:'no-store'});
    if (res.status === 401) { location.href = '/admin/login'; return; } // сессия истекла
    d = await res.json();
  } catch(e){ document.getElementById('updated').textContent = 'ошибка загрузки'; return; }
  // Наша задержка: round-trip запроса /admin/data (админ-браузер → сервер → назад).
  const ours = Math.round(performance.now() - t0);
  const oe = document.getElementById('ours');
  oe.textContent = ours + ' мс';
  oe.className = pingCls(ours);
  document.getElementById('ver').textContent = d.serverVersion;
  document.getElementById('up').textContent = fmtDur(d.uptimeSec);
  document.getElementById('cc').textContent = d.counts.clients;
  document.getElementById('rc').textContent = d.counts.rooms;
  document.getElementById('updated').textContent = 'обновлено '+new Date(d.now).toLocaleTimeString();
  const verNow = d.serverVersion;
  document.querySelector('#clients tbody').innerHTML = d.clients.map(c=>{
    const stale = c.version!=='?' && c.version!==verNow;
    return '<tr><td class=muted>'+c.id+'</td><td>'+c.ip+'</td>'+
      '<td title="'+escapeHtml(c.ua||'')+'">'+escapeHtml(c.device||'—')+'</td>'+
      '<td class='+pingCls(c.rtt)+'>'+(c.rtt==null?'—':c.rtt+' мс')+'</td>'+
      '<td'+(stale?' class=bad title="версия не совпадает с сервером"':'')+'>'+c.version+'</td>'+
      '<td>'+c.state+'</td><td>'+(c.roomCode||'—')+'</td><td>'+(c.name?escapeHtml(c.name):'<span class=muted>—</span>')+(c.side?' <span class=pill>'+c.side+'</span>':'')+'</td>'+
      '<td>'+fmtDur(c.connectedSec)+'</td><td class='+idleCls(c.idleSec)+'>'+fmtDur(c.idleSec)+'</td></tr>';
  }).join('') || '<tr><td colspan=10 class=muted>нет подключений</td></tr>';
  document.querySelector('#rooms tbody').innerHTML = d.rooms.map(r=>{
    const players = r.players.map(p=>escapeHtml(p.name||'?')+(p.isBot?' 🤖':'')+(p.connected?'':' <span class=bad>(off)</span>')).join(', ');
    let game = '<span class=muted>—</span>';
    if (r.game){
      const alive = r.game.characters.filter(c=>!c.dead).length;
      game = r.game.over ? '<span class=ok>завершена</span>' : 'ход активен · живых фишек '+alive;
    }
    const watch = r.status === 'active' && r.type === 'public' && r.game && !r.game.over
      ? '<a class=watch-link target="_blank" rel="noopener" href="/?watch='+encodeURIComponent(r.code)+'">Смотреть</a>'
      : '<span class=muted>—</span>';
    return '<tr><td><b>'+r.code+'</b></td><td>'+fmtDateTime(r.startedAt || r.createdAt)+'</td><td><span class=pill>'+r.type+'</span></td><td>'+r.status+'</td><td>'+players+'</td><td>'+game+'</td><td>'+watch+'</td></tr>';
  }).join('') || '<tr><td colspan=7 class=muted>нет комнат</td></tr>';

  // Точка в историю графика: ваша задержка, макс. пинг клиентов, число клиентов.
  const rtts = d.clients.map(c=>c.rtt).filter(v=>typeof v==='number');
  history.push({ ours, maxRtt: rtts.length?Math.max(...rtts):null, clients: d.counts.clients });
  if (history.length > MAX_POINTS) history.shift();
  drawChart();
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Регулируемый интервал опроса/сэмплирования (1–60 с) + пауза.
let timer = null;
function schedule(){
  if (timer) clearInterval(timer);
  const s = Math.max(1, Math.min(60, parseInt(document.getElementById('interval').value,10) || 3));
  timer = setInterval(() => { if (!document.getElementById('pause').checked) tick(); }, s * 1000);
}
document.getElementById('interval').addEventListener('change', schedule);
tick(); schedule();
</script>
</body></html>`;
