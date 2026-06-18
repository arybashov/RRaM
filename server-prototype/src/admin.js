// Админ-панель: страница /admin + JSON /admin/data под HTTP Basic Auth.
// Показывает подключённых клиентов (где они, idle, версия, IP) и комнаты/партии.
// Пароль — из ADMIN_PASSWORD; если не задан, админка отключена (503).
import { timingSafeEqual } from 'node:crypto';

const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Возвращает true, если запрос авторизован. Иначе сам отвечает 401/503 и возвращает false.
function checkAuth(req, reply) {
  if (!ADMIN_PASSWORD) {
    reply.code(503).type('text/plain; charset=utf-8')
      .send('Админка отключена: задайте переменную окружения ADMIN_PASSWORD.');
    return false;
  }
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (m) {
    const idx = Buffer.from(m[1], 'base64').toString('utf8').indexOf(':');
    const user = idx >= 0 ? Buffer.from(m[1], 'base64').toString('utf8').slice(0, idx) : '';
    const pass = idx >= 0 ? Buffer.from(m[1], 'base64').toString('utf8').slice(idx + 1) : '';
    if (safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASSWORD)) return true;
  }
  reply.code(401)
    .header('WWW-Authenticate', 'Basic realm="RRaM admin", charset="UTF-8"')
    .type('text/plain; charset=utf-8')
    .send('Требуется авторизация.');
  return false;
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
  return {
    now,
    serverVersion: version,
    uptimeSec: Math.round(process.uptime()),
    counts: {
      clients: clients.size,
      rooms: store.adminRooms().length,
      lobbyWatchers: lobbySubscribers.size,
    },
    clients: clientList,
    rooms: store.adminRooms(),
  };
}

export function registerAdmin(app, deps) {
  app.get('/admin', async (req, reply) => {
    if (!checkAuth(req, reply)) return reply;
    return reply.type('text/html; charset=utf-8').send(ADMIN_HTML);
  });

  app.get('/admin/data', async (req, reply) => {
    if (!checkAuth(req, reply)) return reply;
    return buildData(deps);
  });
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
</header>
<main>
  <section><h2>Клиенты</h2><table id="clients"><thead><tr>
    <th>id</th><th>IP</th><th>пинг</th><th>версия</th><th>где</th><th>комната</th><th>игрок</th><th>онлайн</th><th>idle</th>
  </tr></thead><tbody></tbody></table></section>
  <section><h2>Комнаты / партии</h2><table id="rooms"><thead><tr>
    <th>код</th><th>тип</th><th>статус</th><th>игроки</th><th>партия</th>
  </tr></thead><tbody></tbody></table></section>
</main>
<script>
const fmtDur = s => s>=3600 ? Math.floor(s/3600)+'ч '+Math.floor(s%3600/60)+'м' : s>=60 ? Math.floor(s/60)+'м '+(s%60)+'с' : s+'с';
function idleCls(s){ return s>30 ? 'bad' : s>10 ? 'warn' : 'ok'; }
function pingCls(ms){ return ms==null ? 'muted' : ms<150 ? 'ok' : ms<600 ? 'warn' : 'bad'; }
async function tick(){
  const t0 = performance.now();
  let d; try { d = await (await fetch('/admin/data',{cache:'no-store'})).json(); }
  catch(e){ document.getElementById('updated').textContent = 'ошибка загрузки'; return; }
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
      '<td class='+pingCls(c.rtt)+'>'+(c.rtt==null?'—':c.rtt+' мс')+'</td>'+
      '<td'+(stale?' class=bad title="версия не совпадает с сервером"':'')+'>'+c.version+'</td>'+
      '<td>'+c.state+'</td><td>'+(c.roomCode||'—')+'</td><td>'+(c.name?escapeHtml(c.name):'<span class=muted>—</span>')+(c.side?' <span class=pill>'+c.side+'</span>':'')+'</td>'+
      '<td>'+fmtDur(c.connectedSec)+'</td><td class='+idleCls(c.idleSec)+'>'+fmtDur(c.idleSec)+'</td></tr>';
  }).join('') || '<tr><td colspan=9 class=muted>нет подключений</td></tr>';
  document.querySelector('#rooms tbody').innerHTML = d.rooms.map(r=>{
    const players = r.players.map(p=>escapeHtml(p.name||'?')+(p.isBot?' 🤖':'')+(p.connected?'':' <span class=bad>(off)</span>')).join(', ');
    let game = '<span class=muted>—</span>';
    if (r.game){
      const alive = r.game.characters.filter(c=>!c.dead).length;
      game = r.game.over ? '<span class=ok>завершена</span>' : 'ход активен · живых фишек '+alive;
    }
    return '<tr><td><b>'+r.code+'</b></td><td><span class=pill>'+r.type+'</span></td><td>'+r.status+'</td><td>'+players+'</td><td>'+game+'</td></tr>';
  }).join('') || '<tr><td colspan=5 class=muted>нет комнат</td></tr>';
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
tick(); setInterval(tick, 3000);
</script>
</body></html>`;
