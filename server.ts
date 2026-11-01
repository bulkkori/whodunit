import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import * as G from './shared/game.ts';
import type { ClientMsg, ServerMsg } from './shared/protocol.ts';

const PORT = Number(process.env.PORT) || 3000, BOT_MS = Number(process.env.BOT_MS) || 1800, INTRO_MS = Number(process.env.INTRO_MS ?? 9000);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const SECURITY: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000', // https로 배포될 때만 브라우저가 적용
};
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  let u: string;
  try { u = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; } // 잘못된 주소(/% 등)는 400 — 예외로 서버가 죽지 않게
  if (u === '/') u = '/index.html';
  if (u.includes('\0') || /\/\./.test(u)) { res.writeHead(404); res.end(); return; } // NUL·숨김 파일(.으로 시작) 금지
  const file = path.join(PUBLIC, u);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(file);
    // 글꼴·그림은 바뀌지 않으므로 오래 저장(다음 접속이 빠르고 요청도 줄어듦), 나머지는 매번 확인
    const long = u.startsWith('/fonts/') || u.startsWith('/assets/') && u.endsWith('.webp');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': long ? 'public, max-age=604800' : 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});

interface Seat { token: string | null; name: string; bot: boolean; suspect: number | null; ready: boolean; ws?: WebSocket | null; drop?: NodeJS.Timeout }
interface Room {
  code: string; title: string; maxPlayers: number; theme: G.ThemeKey; host: string; seats: Seat[];
  /** lobby = 대기실(준비), pick = 말 고르기(2분), game = 게임 중 */
  stage: 'lobby' | 'pick' | 'game'; pickUntil?: number;
  game: G.Game | null; last: number; opts: G.GameOpts;
  /** 방장이 내보낸 사람(토큰) — 같은 방에 다시 못 들어옴 */
  banned?: Set<string>;
  key?: string | null; deadline?: number | null; timer?: NodeJS.Timeout; botTimer?: NodeJS.Timeout; introUntil?: number;
}
interface Conn { room?: Room; seat?: Seat; alive: boolean; made?: number; tokens?: number; at?: number }
const PICK_MS = Number(process.env.PICK_MS ?? 120000), ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS) || 2 * 3600000;

// ponytail: 방 상태는 메모리만. 서버 재시작 시 진행 중인 판은 사라짐 — 필요하면 Redis 등에 저장.
const rooms = new Map<string, Room>();
const conns = new WeakMap<WebSocket, Conn>();
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c: string; do c = Array.from({ length: 5 }, () => ABC[randomInt(ABC.length)]).join(''); while (rooms.has(c)); return c; };
// 이름: 제어 문자·보이지 않는 문자·글자 방향 뒤집기 문자를 빼고(다른 사람 흉내·화면 깨짐 방지) 12자까지
const clean = (s: unknown, max = 12, fallback = '탐정') => String(s ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim().slice(0, max) || fallback;
const validToken = (t: unknown): t is string => typeof t === 'string' && t.length >= 8 && t.length <= 64;
const clampPlayers = (n: unknown) => Math.min(G.MAX_PLAYERS, Math.max(3, Math.round(Number(n)) || 6));
const picksOpen = (room: Room) => Math.max(6, room.seats.length); // 고를 수 있는 인물 수

function send(ws: WebSocket | null | undefined, msg: ServerMsg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(room: Room) {
  const g = room.game, left = room.deadline ? Math.max(0, room.deadline - Date.now()) : null;
  room.seats.forEach((s, i) => send(s.ws, {
    t: 'state', code: room.code, title: room.title, maxPlayers: room.maxPlayers, stage: room.stage,
    pickLeft: room.stage === 'pick' ? Math.max(0, (room.pickUntil ?? 0) - Date.now()) : 0,
    theme: room.theme, you: i, host: room.host === s.token,
    seats: room.seats.map(x => ({ name: x.name, bot: x.bot, online: x.bot || !!x.ws, suspect: x.suspect, ready: x.bot || x.ready || x.token === room.host, host: x.token === room.host })),
    game: g && G.view(g, i), left, opts: room.opts, intro: Math.max(0, (room.introUntil ?? 0) - Date.now()),
  }));
}

/** 말 고르기 끝: 안 고른 사람(봇 포함)은 남은 인물 중 무작위 → 게임 시작 */
function finishPick(room: Room) {
  if (room.stage !== 'pick') return;
  room.stage = 'game';
  room.game = G.newGame(room.theme, room.seats, randomInt(2 ** 31), room.opts);
  room.game.pub = randomInt(2 ** 31); // 브라우저에 보내는 판 번호 — 패 배분 시드와 무관
  room.introUntil = Date.now() + INTRO_MS; // 카드 섞기·봉투·분배 연출 동안 대기
  room.key = null;
  update(room);
}

/** 봇이 다음 행동까지 기다리는 시간. 사람이 수사 일지를 읽고 노트를 적을 수 있게 단계마다 다르고, 추리·반박 결과가 막 나왔으면 한 박자 더 쉰다 */
const READ_AFTER = new Set(['shown', 'pass', 'norefute', 'silentnone', 'accuse', 'intel', 'silent']);
function botDelay(g: G.Game): number {
  const mul = G.TEMPOS[g.opts.tempo ?? 'normal'].mul;
  const base = g.phase === 'move' ? Math.max(1700, BOT_MS * 1.4 * mul) // 주사위 연출(약 1.5초)은 템포와 상관없이 끝나야 함
    : g.phase === 'refute' ? BOT_MS * 1.3 * mul
    : g.phase === 'roll' ? BOT_MS * 0.8 * mul
    : BOT_MS * mul;
  const last = g.log[g.log.length - 1];
  const read = g.phase === 'roll' && last && READ_AFTER.has(last.t) ? BOT_MS * 2.2 * mul : 0; // 방금 추리·반박이 끝났으면 읽을 시간
  return Math.round(base + read);
}

function update(room: Room) {
  clearTimeout(room.timer); clearTimeout(room.botTimer);
  if (room.stage === 'pick') { room.deadline = null; room.timer = setTimeout(() => finishPick(room), Math.max(0, (room.pickUntil ?? 0) - Date.now())); broadcast(room); return; }
  const g = room.game;
  if (!g || g.phase === 'over') { room.deadline = null; broadcast(room); return; }
  const wait = (room.introUntil ?? 0) - Date.now();
  if (wait > 0) { room.deadline = null; room.timer = setTimeout(() => update(room), wait); broadcast(room); return; } // 시작 연출 중
  const a = G.actor(g), key = `${g.turnNo}:${g.phase}:${a}`, p = g.players[a];
  // 단계가 바뀔 때마다 새 2분: 주사위 눈이 나온 뒤(이동) → 방에 들어간 뒤(추리) → 반박. 사람이 굴리기 전에는 제한 없음
  if (key !== room.key) { room.key = key; room.deadline = g.phase === 'roll' && !p.bot && !p.afk ? null : Date.now() + (g.phase === 'refute' ? G.REFUTE_MS : G.TURN_MS); }
  if (room.deadline) room.timer = setTimeout(() => { G.timeout(g); update(room); }, room.deadline - Date.now());
  if (p.bot || p.afk) room.botTimer = setTimeout(() => {
    const err = G.act(g, a, G.botAction(g));
    if (err) { console.error('bot error', err); G.timeout(g); } // 턴 종료가 막힌 단계에서도 넘어가도록 시간 초과 처리
    update(room);
  }, botDelay(g));
  broadcast(room);
}

/** 사람이 나감(스스로 또는 60초 넘게 끊김): 대기실이면 자리 빼고 방장 넘김, 게임 중이면 탈락(봇이 대신하지 않음) */
function dropSeat(room: Room, seat: Seat) {
  const i = room.seats.indexOf(seat);
  if (i < 0) return;
  if (room.game) { G.leave(room.game, i); return; }
  if (room.stage !== 'lobby') return;
  room.seats.splice(i, 1);
  const next = room.seats.find(s => !s.bot);
  if (room.host === seat.token && next?.token) room.host = next.token;
}

// m은 신뢰할 수 없는 네트워크 입력 — 형식은 ClientMsg로 가정하되 값은 하나하나 검증한다
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 100, MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 12;
function handle(ws: WebSocket, conn: Conn, m: ClientMsg) {
  if (m.t === 'create' && rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', msg: '지금 열린 방이 너무 많아요. 잠시 뒤 다시 시도해 주세요' });
  if (m.t === 'create' && (conn.made = (conn.made ?? 0) + 1) > 5) return send(ws, { t: 'error', msg: '방을 너무 자주 만들었어요. 새로 고침 후 다시 시도해 주세요' });
  if (m.t === 'create') {
    if (!validToken(m.token) || !G.isTheme(m.theme)) return;
    const room: Room = {
      code: newCode(), title: clean(m.title, 20, `${clean(m.name)}의 사건`), maxPlayers: clampPlayers(m.maxPlayers),
      theme: m.theme, host: m.token, seats: [], stage: 'lobby', game: null, last: Date.now(),
      opts: { roles: true, bluff: m.opts?.bluff !== false, tempo: G.isTempo(m.opts?.tempo) ? m.opts.tempo : 'normal' }, // 특수 능력은 기본 규칙 — 끌 수 없음
    };
    rooms.set(room.code, room);
    m = { t: 'join', code: room.code, name: m.name, token: m.token };
  }
  if (m.t === 'join') {
    if (!validToken(m.token)) return;
    const room = rooms.get(String(m.code ?? '').toUpperCase().trim());
    if (!room) return send(ws, { t: 'error', msg: '없는 방 코드예요', gone: true });
    if (room.banned?.has(m.token)) return send(ws, { t: 'error', msg: '방장이 내보낸 방에는 다시 들어갈 수 없어요' });
    let i = room.seats.findIndex(s => s.token === m.token && !s.bot);
    if (i < 0) {
      if (room.stage !== 'lobby') return send(ws, { t: 'error', msg: '이미 시작된 방이에요' });
      if (room.seats.length >= room.maxPlayers) return send(ws, { t: 'error', msg: `방이 꽉 찼어요 (최대 ${room.maxPlayers}명)` });
      room.seats.push({ token: m.token, name: clean(m.name), bot: false, suspect: null, ready: false });
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
  if (!room || !seat) return send(ws, { t: 'error', msg: '방이 닫혔어요 — 처음 화면으로 돌아갑니다', gone: true });
  room.last = Date.now();
  const i = room.seats.indexOf(seat), isHost = room.host === seat.token;
  if (m.t === 'act' && room.game) {
    const err = G.act(room.game, i, m.action);
    if (err) return send(ws, { t: 'error', msg: err });
    const p = room.game.players[i]; p.timeouts = 0; p.afk = false;
    return update(room);
  }
  if (m.t === 'leave') { dropSeat(room, seat); conn.room = conn.seat = undefined; seat.ws = null; clearTimeout(seat.drop); return update(room); }
  if (m.t === 'ready' && room.stage === 'lobby') { seat.ready = m.on === true; return update(room); }
  if (m.t === 'pick' && room.stage === 'pick') {
    const v = m.suspect;
    if (!Number.isInteger(v) || v < 0 || v >= picksOpen(room)) return;
    if (room.seats.some(s => s !== seat && s.suspect === v)) return send(ws, { t: 'error', msg: '이미 다른 사람이 고른 인물이에요' });
    seat.suspect = seat.suspect === v ? null : v; // 같은 걸 다시 누르면 취소
    if (room.seats.every(s => s.bot || s.suspect !== null)) return finishPick(room); // 사람이 모두 골랐으면 바로 시작
    return update(room);
  }
  if (!isHost) return;
  if (m.t === 'again' && room.game?.phase === 'over') {
    room.game = null; room.stage = 'lobby';
    room.seats = room.seats.filter(s => !s.bot); // 봇은 다음 시작 때 다시 채움
    for (const s of room.seats) { s.ready = false; s.suspect = null; }
    return update(room);
  }
  if (room.stage !== 'lobby') return;
  if (m.t === 'theme' && G.isTheme(m.theme)) room.theme = m.theme;
  if (m.t === 'opt') room.opts = { roles: true, bluff: typeof m.bluff === 'boolean' ? m.bluff : room.opts.bluff, tempo: G.isTempo(m.tempo) ? m.tempo : room.opts.tempo };
  if (m.t === 'maxp') room.maxPlayers = Math.max(room.seats.length, clampPlayers(m.n)); // 이미 들어온 사람보다 적게는 못 줄임
  if (m.t === 'addBot' && room.seats.length < room.maxPlayers) room.seats.push({ token: null, name: '봇 ' + (room.seats.filter(s => s.bot).length + 1), bot: true, suspect: null, ready: true });
  if ((m.t === 'kick' || m.t === 'host') && Number.isInteger(m.i)) {
    const t = room.seats[m.i];
    if (!t || t === seat || t.name !== m.name) return;
    if (m.t === 'host') { if (t.bot || !t.token) return; room.host = t.token; seat.ready = false; }
    else {
      room.seats.splice(m.i, 1);
      if (t.token) { (room.banned ??= new Set()).add(t.token); clearTimeout(t.drop); }
      if (t.ws) { send(t.ws, { t: 'kicked' }); const c = conns.get(t.ws); if (c) c.room = c.seat = undefined; }
    }
  }
  if (m.t === 'removeBot') { const k = room.seats.findLastIndex(s => s.bot); if (k >= 0) room.seats.splice(k, 1); }
  if (m.t === 'start') {
    const waiting = room.seats.filter(s => !s.bot && s.token !== room.host && !s.ready);
    if (waiting.length) return send(ws, { t: 'error', msg: `아직 준비하지 않은 사람: ${waiting.map(s => s.name).join(', ')}` });
    // 최대 인원까지 남는 자리는 봇이 채움
    for (let k = 1; room.seats.length < room.maxPlayers; k++) room.seats.push({ token: null, name: '봇 ' + k, bot: true, suspect: null, ready: true });
    room.stage = 'pick'; room.pickUntil = Date.now() + PICK_MS;
    for (const s of room.seats) s.suspect = null;
  }
  update(room);
}

const wss = new WebSocketServer({ server, maxPayload: 4096 });
// 한 주소에서 연결을 너무 많이 열면 거절. IP는 이 숫자를 세는 데만 쓰고 저장·기록하지 않으며, 연결이 끊기면 지운다
const perIp = new Map<string, number>();
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // Render 등 프록시 뒤에서만 켬 — 아니면 누구나 헤더로 주소를 속일 수 있음
wss.on('connection', (ws, req) => {
  // 다른 사이트의 스크립트가 플레이어 브라우저로 우리 서버에 붙는 것(CSWSH) 차단: Origin이 있으면 우리 호스트여야 함
  const origin = req.headers.origin, host = req.headers.host;
  if (origin && host && origin.replace(/^https?:\/\//, '') !== host) { ws.close(1008, 'bad origin'); return; }
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)!.trim() : '';
  const ip = fwd || req.socket.remoteAddress || '';
  const nIp = (perIp.get(ip) ?? 0) + 1;
  if (nIp > MAX_CONN_PER_IP) { ws.close(1008, 'too many connections'); return; }
  perIp.set(ip, nIp);
  ws.on('close', () => { const k = (perIp.get(ip) ?? 1) - 1; if (k > 0) perIp.set(ip, k); else perIp.delete(ip); });
  const conn: Conn = { alive: true };
  conns.set(ws, conn);
  ws.on('pong', () => (conn.alive = true));
  ws.on('message', raw => {
    // 메시지 폭주 제한: 초당 약 20개(잠깐 몰리면 40개까지) 넘으면 그 메시지는 버림
    const now = Date.now(); conn.tokens = Math.min(40, (conn.tokens ?? 40) + ((now - (conn.at ?? now)) / 1000) * 20); conn.at = now;
    if (conn.tokens < 1) return; conn.tokens--;
    let m: unknown;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!(m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string')) return;
    try { handle(ws, conn, m as ClientMsg); } catch (e) { console.error('handle error', (e as Error)?.name); } // 내용은 기록하지 않음(개인정보)
  });
  ws.on('close', () => {
    const { room, seat } = conn;
    if (!room || !seat || seat.ws !== ws) return;
    seat.ws = null;
    seat.drop = setTimeout(() => { // 60초 안에 돌아오지 않으면: 대기실이면 퇴장, 게임 중이면 봇 전환
      const i = room.seats.indexOf(seat);
      if (i < 0) return;
      if (room.stage === 'pick') return; // 말 고르기 중 끊기면 시간이 지나 무작위로
      dropSeat(room, seat); update(room);
    }, 60000);
    broadcast(room);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    const c = conns.get(ws);
    if (!c?.alive) ws.terminate(); else { c.alive = false; ws.ping(); }
  }
  for (const [code, room] of rooms) {
    const idle = Date.now() - room.last, empty = !room.seats.some(s => s.ws);
    if ((empty && idle > 10 * 60000) || idle > ROOM_IDLE_MS) { // 비면 10분, 누가 있어도 2시간 아무 행동 없으면 정리
      clearTimeout(room.timer); clearTimeout(room.botTimer); rooms.delete(code);
      for (const s of room.seats) { if (s.ws) { send(s.ws, { t: 'error', msg: '오래 멈춘 방이라 닫혔어요', gone: true }); const c = conns.get(s.ws); if (c) c.room = c.seat = undefined; } }
    }
  }
}, 30000);

process.on('SIGTERM', () => { // Render가 새 버전으로 바꿀 때 보내는 종료 신호
  for (const room of rooms.values()) for (const s of room.seats) send(s.ws, { t: 'error', msg: '서버가 업데이트되어 진행 중이던 판이 끝났어요. 새 방을 만들어 주세요', gone: true });
  setTimeout(() => process.exit(0), 300);
});
process.on('uncaughtException', e => console.error('uncaught', e?.name ?? e)); // 마지막 방어선: 한 요청의 오류로 모두의 판이 끊기지 않게
process.on('unhandledRejection', e => console.error('unhandled', (e as Error)?.name ?? e));
server.listen(PORT, () => console.log(`whodunit http://localhost:${PORT}`));
