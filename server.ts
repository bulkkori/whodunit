import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import * as G from './shared/game.ts';
import type { ClientMsg, ServerMsg } from './shared/protocol.ts';

const PORT = Number(process.env.PORT) || 3000, BOT_MS = Number(process.env.BOT_MS) || 700, INTRO_MS = Number(process.env.INTRO_MS ?? 9000);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  let u = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (u === '/') u = '/index.html';
  const file = path.join(PUBLIC, u);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});

interface Seat { token: string | null; name: string; bot: boolean; suspect: number | null; ws?: WebSocket | null; drop?: NodeJS.Timeout }
interface Room {
  code: string; theme: G.ThemeKey; host: string; seats: Seat[]; game: G.Game | null; last: number; opts: G.GameOpts;
  key?: string | null; deadline?: number | null; timer?: NodeJS.Timeout; botTimer?: NodeJS.Timeout; introUntil?: number;
}
interface Conn { room?: Room; seat?: Seat; alive: boolean }

// ponytail: 방 상태는 메모리만. 서버 재시작 시 진행 중인 판은 사라짐 — 필요하면 Redis 등에 저장.
const rooms = new Map<string, Room>();
const conns = new WeakMap<WebSocket, Conn>();
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c: string; do c = Array.from({ length: 5 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join(''); while (rooms.has(c)); return c; };
const clean = (s: unknown) => String(s ?? '').trim().slice(0, 12) || '탐정';
const validToken = (t: unknown): t is string => typeof t === 'string' && t.length >= 8 && t.length <= 64;

function send(ws: WebSocket | null | undefined, msg: ServerMsg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(room: Room) {
  const g = room.game, left = room.deadline ? Math.max(0, room.deadline - Date.now()) : null;
  room.seats.forEach((s, i) => send(s.ws, {
    t: 'state', code: room.code, theme: room.theme, you: i, host: room.host === s.token,
    seats: room.seats.map(x => ({ name: x.name, bot: x.bot, online: x.bot || !!x.ws, suspect: x.suspect })),
    game: g && G.view(g, i), left, opts: room.opts, intro: Math.max(0, (room.introUntil ?? 0) - Date.now()),
  }));
}

function update(room: Room) {
  clearTimeout(room.timer); clearTimeout(room.botTimer);
  const g = room.game;
  if (!g || g.phase === 'over') { room.deadline = null; broadcast(room); return; }
  const wait = (room.introUntil ?? 0) - Date.now();
  if (wait > 0) { room.deadline = null; room.timer = setTimeout(() => update(room), wait); broadcast(room); return; } // 시작 연출 중
  const a = G.actor(g), key = `${g.turnNo}:${g.phase}:${a}`;
  if (key !== room.key) { room.key = key; room.deadline = Date.now() + (g.phase === 'refute' ? G.REFUTE_MS : G.TURN_MS); }
  room.timer = setTimeout(() => { G.timeout(g); update(room); }, room.deadline! - Date.now());
  const p = g.players[a];
  if (p.bot || p.afk) room.botTimer = setTimeout(() => {
    const err = G.act(g, a, G.botAction(g));
    if (err) { console.error('bot error', err); G.act(g, a, { t: 'end' }); }
    update(room);
  }, g.phase === 'move' ? BOT_MS * 2.3 : BOT_MS); // 굴린 직후엔 주사위 연출(약 1.5초)이 끝날 때까지 기다림
  broadcast(room);
}

// m은 신뢰할 수 없는 네트워크 입력 — 형식은 ClientMsg로 가정하되 값은 하나하나 검증한다
function handle(ws: WebSocket, conn: Conn, m: ClientMsg) {
  if (m.t === 'create') {
    if (!validToken(m.token) || !G.isTheme(m.theme)) return;
    if (rooms.size >= 100) return send(ws, { t: 'error', msg: '데모 서버가 붐빕니다. 잠시 후 다시 시도해 주세요' });
    const room: Room = { code: newCode(), theme: m.theme, host: m.token, seats: [], game: null, last: Date.now(),
      opts: { roles: m.opts?.roles !== false, bluff: m.opts?.bluff !== false } }; // 방 설정(만들 때 선택, 대기실에서 방장이 변경 가능)
    rooms.set(room.code, room);
    m = { t: 'join', code: room.code, name: m.name, token: m.token };
  }
  if (m.t === 'join') {
    if (!validToken(m.token)) return;
    const room = rooms.get(String(m.code ?? '').toUpperCase().trim());
    if (!room) return send(ws, { t: 'error', msg: '없는 방 코드입니다' });
    let i = room.seats.findIndex(s => s.token === m.token && !s.bot);
    if (i < 0) {
      if (room.game) return send(ws, { t: 'error', msg: '이미 시작된 방입니다' });
      if (room.seats.length >= 6) return send(ws, { t: 'error', msg: '방이 꽉 찼습니다 (최대 6명)' });
      room.seats.push({ token: m.token, name: clean(m.name), bot: false, suspect: null });
      i = room.seats.length - 1;
    }
    const seat = room.seats[i];
    if (seat.ws && seat.ws !== ws) seat.ws.close();
    clearTimeout(seat.drop);
    seat.ws = ws; conn.room = room; conn.seat = seat;
    if (room.game) { const p = room.game.players[i]; p.afk = false; p.timeouts = 0; }
    return update(room);
  }
  const { room, seat } = conn;
  if (!room || !seat) return;
  room.last = Date.now();
  const i = room.seats.indexOf(seat), isHost = room.host === seat.token;
  if (m.t === 'act' && room.game) {
    const err = G.act(room.game, i, m.action);
    if (err) return send(ws, { t: 'error', msg: err });
    const p = room.game.players[i]; p.timeouts = 0; p.afk = false;
    return update(room);
  }
  if (m.t === 'pick' && !room.game) {
    const v = m.suspect;
    if (!Number.isInteger(v) || v < 0 || v > 5) return;
    if (room.seats.some(s => s !== seat && s.suspect === v)) return send(ws, { t: 'error', msg: '이미 다른 사람이 고른 인물입니다' });
    seat.suspect = seat.suspect === v ? null : v; // 같은 걸 다시 누르면 취소
    return update(room);
  }
  if (!isHost) return;
  if (m.t === 'again' && room.game?.phase === 'over') { room.game = null; return update(room); }
  if (room.game) return;
  if (m.t === 'theme' && G.isTheme(m.theme)) room.theme = m.theme;
  if (m.t === 'opt') room.opts = { roles: typeof m.roles === 'boolean' ? m.roles : room.opts.roles, bluff: typeof m.bluff === 'boolean' ? m.bluff : room.opts.bluff };
  if (m.t === 'addBot' && room.seats.length < 6) room.seats.push({ token: null, name: '봇 ' + (room.seats.filter(s => s.bot).length + 1), bot: true, suspect: null });
  if (m.t === 'removeBot') { const k = room.seats.findLastIndex(s => s.bot); if (k >= 0) room.seats.splice(k, 1); }
  if (m.t === 'start') {
    if (room.seats.length < 3) return send(ws, { t: 'error', msg: '3명 이상 필요합니다 (봇 추가 가능)' });
    room.game = G.newGame(room.theme, room.seats, Math.floor(Math.random() * 2 ** 31), room.opts);
    room.introUntil = Date.now() + INTRO_MS; // 카드 섞기·봉투·분배 연출 동안 대기
    room.key = null;
  }
  update(room);
}

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  const conn: Conn = { alive: true };
  conns.set(ws, conn);
  ws.on('pong', () => (conn.alive = true));
  ws.on('message', raw => {
    let m: unknown;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string') handle(ws, conn, m as ClientMsg);
  });
  ws.on('close', () => {
    const { room, seat } = conn;
    if (!room || !seat || seat.ws !== ws) return;
    seat.ws = null;
    seat.drop = setTimeout(() => { // 60초 안에 돌아오지 않으면: 대기실이면 퇴장, 게임 중이면 봇 전환
      const i = room.seats.indexOf(seat);
      if (i < 0) return;
      if (!room.game) {
        room.seats.splice(i, 1);
        const next = room.seats.find(s => !s.bot);
        if (room.host === seat.token && next?.token) room.host = next.token;
      } else room.game.players[i].afk = true;
      update(room);
    }, 60000);
    broadcast(room);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    const c = conns.get(ws);
    if (!c?.alive) ws.terminate(); else { c.alive = false; ws.ping(); }
  }
  for (const [code, room] of rooms) if (!room.seats.some(s => s.ws) && Date.now() - room.last > 10 * 60000) {
    clearTimeout(room.timer); clearTimeout(room.botTimer); rooms.delete(code);
  }
}, 30000);

server.listen(PORT, () => console.log(`whodunit http://localhost:${PORT}`));
