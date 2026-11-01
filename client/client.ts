import * as G from '../shared/game.ts';
import type { ClientMsg, ServerMsg, StateMsg } from '../shared/protocol.ts';
import type { Board3D } from './board3d.ts';
import { throwDice2D } from './dice.ts';
import { playIntro } from './intro.ts';
import * as Sound from './sound.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $in = (s: string) => $<HTMLInputElement>(s);
const $btn = (s: string) => $<HTMLButtonElement>(s);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
};
const store = {
  get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경(시크릿 등)은 무시 */ } },
};
import { COLORS, WEAPON_ICON, ROOM_TINTS, cardEl } from './art.ts';

let token = store.get<string | null>('wd_token', null);
if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); store.set('wd_token', token); }
const TOKEN = token;

let S: StateMsg | null = null, ws: WebSocket | null = null, deadline = 0, total = G.TURN_MS, everConnected = false;
let code = new URLSearchParams(location.search).get('room');

// ---------- 연결 ----------
function connect() {
  const sock = (ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host));
  sock.onopen = () => {
    everConnected = true; $btn('#create').disabled = $btn('#join').disabled = $btn('#practice').disabled = false; $('#wake').hidden = true;
    if (code && $in('#name').value) join(code);
  };
  sock.onmessage = e => {
    const m = JSON.parse(e.data) as ServerMsg;
    if (m.t === 'error') { if (!S) { code = null; history.replaceState(null, '', location.pathname); } return toast(m.msg); }
    S = m; code = m.code;
    if (location.search !== '?room=' + m.code) history.replaceState(null, '', '?room=' + m.code);
    deadline = m.left == null ? 0 : Date.now() + m.left;
    total = m.game?.phase === 'refute' ? G.REFUTE_MS : G.TURN_MS;
    render();
  };
  sock.onclose = () => { if (!everConnected) $('#wake').hidden = false; setTimeout(connect, 1500); };
}
const send = (m: ClientMsg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
const act = (a: G.Action) => send({ t: 'act', action: a });
const myName = () => { const n = $in('#name').value.trim(); store.set('wd_name', n); return n; };
const theme = () => $<HTMLSelectElement>('#theme').value as G.ThemeKey;
function join(c: string) { send({ t: 'join', code: c, name: myName(), token: TOKEN }); }

let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- 로비 ----------
for (const sel of [$<HTMLSelectElement>('#theme'), $<HTMLSelectElement>('#theme2')])
  for (const [k, t] of Object.entries(G.THEMES)) sel.append(new Option(`${t.icon} ${t.name}`, k));
$in('#name').value = store.get('wd_name', '');
if (code) $in('#code').value = code;
const roomOpts = () => ({ roles: $in('#c_roles').checked, bluff: $in('#c_bluff').checked });
$('#create').onclick = () => { if (!myName()) return toast('닉네임을 입력하세요'); send({ t: 'create', theme: theme(), name: myName(), token: TOKEN, opts: roomOpts() }); };
$('#practice').onclick = () => {
  if (!myName()) $in('#name').value = '탐정';
  send({ t: 'create', theme: theme(), name: myName(), token: TOKEN, opts: roomOpts() });
  send({ t: 'addBot' }); send({ t: 'addBot' }); send({ t: 'start' });
};
$('#join').onclick = () => {
  const c = $in('#code').value.trim().toUpperCase();
  if (!myName()) return toast('닉네임을 입력하세요');
  if (c.length !== 5) return toast('참여 코드 5자리를 입력하세요');
  join(c);
};
$('#code').onkeydown = e => { if (e.key === 'Enter') $('#join').click(); };
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('초대 링크를 복사했어요'); } catch { toast(location.href); } };
$('#theme2').onchange = e => send({ t: 'theme', theme: (e.target as HTMLSelectElement).value as G.ThemeKey });
$('#addbot').onclick = () => send({ t: 'addBot' });
$('#optroles').onchange = e => send({ t: 'opt', roles: (e.target as HTMLInputElement).checked });
$('#optbluff').onchange = e => send({ t: 'opt', bluff: (e.target as HTMLInputElement).checked });
$('#rmbot').onclick = () => send({ t: 'removeBot' });
$('#start').onclick = () => send({ t: 'start' });
$('#leave').onclick = () => {
  if (S?.game && S.game.phase !== 'over' && !confirm('나가면 봇이 대신 플레이합니다. 나갈까요?')) return;
  S = null; code = null; history.replaceState(null, '', location.pathname); ws?.close(); render();
};

// ---------- 렌더 ----------
function show(id: 'lobby' | 'wait' | 'game') {
  for (const s of ['lobby', 'wait', 'game']) $('#' + s).hidden = s !== id;
  $('#drawer').hidden = $('#turnbox').hidden = id !== 'game';
  $('#leave').hidden = id === 'lobby';
}

function render() {
  const g = S?.game;
  document.body.dataset.gtheme = g?.theme ?? S?.theme ?? theme();
  $('#hcode').textContent = S ? '방 ' + S.code : '';
  if (!S) return show('lobby');
  if (!g) { show('wait'); return renderWait(S); }
  show('game');
  maybeIntro(g);
  watchRoll(g);
  renderView(g); renderPanel(g); renderMemo(g); renderDialogs(g); autoSuggest(g); revealCards(g);
}

// 나에게 새로 보인 카드(반박·능력)를 화면 가운데에 잠깐 크게 보여 준다. 입장·재접속 때 이미 지난 것은 생략.
let revealSeen = new Set<string>(), revealSeed: number | null = null, revealT: ReturnType<typeof setTimeout> | undefined;
function revealCards(g: G.View) {
  const fresh: { title: string; card: G.Card }[] = [];
  for (const e of g.log) {
    let title = '', card: G.Card | undefined;
    if (e.t === 'shown' && e.to === g.me) { card = e.card; title = `🃏 ${nm(g, e.p)}이(가) 보여준 카드`; }
    else if (e.t === 'intel' && e.to === g.me) {
      card = e.card;
      title = e.kind === 'tap' ? `🎧 도청: ${nm(g, e.a!)} → ${nm(g, e.b!)}`
        : e.kind === 'archive' ? `🗂️ 기록 열람: ${nm(g, e.a!)} → ${nm(g, e.b!)}`
        : e.kind === 'interrogate' ? `🕵️ 심문: ${nm(g, e.from ?? -1)}의 카드`
        : e.from == null ? '🔦 수색: 아무도 없음 → 진실!' : `🔦 수색: ${nm(g, e.from)}이(가) 가진 카드`;
    }
    if (!card) continue;
    const key = `${e.t}:${card}:${title}`;
    if (!revealSeen.has(key)) { revealSeen.add(key); fresh.push({ title, card }); }
  }
  if (revealSeed !== g.seed) { revealSeed = g.seed; return; } // 첫 화면: 지난 것은 기록만 (Set은 카드+제목 키라 판이 바뀌어도 안전)
  const last = fresh.at(-1); if (!last) return;
  const box = $('#reveal'); box.innerHTML = '';
  box.append(el('p', 'rt', last.title), cardEl(g.theme, last.card, 'big'));
  box.hidden = false; box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
  clearTimeout(revealT); revealT = setTimeout(() => (box.hidden = true), 3000);
}

// 게임 시작 연출: 서버가 연출 시간(intro)을 주는 동안 한 번만. 재접속·새로고침 땐 생략.
let introDone = new Set<number>();
function maybeIntro(g: G.View) {
  if (introDone.has(g.seed) || !S || S.intro < 1500) { introDone.add(g.seed); return; }
  introDone.add(g.seed);
  playIntro(g, () => { if (S?.game) render(); });
}

// 내 차례에 방에 막 들어가면 추론 창을 한 번 자동으로 열어 준다(취소 가능)
let suggestedKey = '';
function autoSuggest(g: G.View) {
  const me = g.players[g.me], key = `${g.seed}:${g.turnNo}`;
  if (g.turn !== g.me || g.phase !== 'act' || !me.canSuggest || !G.inRoom(me.pos) || me.pos === G.centerPos(g.map)) return;
  if (suggestedKey === key || dlg.open) return;
  suggestedKey = key; openPick('suggest');
}

// ---------- 주사위 ----------
// 새 굴림(로그의 roll 항목)이 오면 판 위로 떨어뜨리고, 멈출 때까지 이동 칸 표시를 미룬다.
// 입장·재접속 직후 이미 지난 굴림은 다시 연출하지 않는다.
let seenRoll: string | null = null, seenSeed: number | null = null, diceBusy = false, myPower: number | null = null;
function watchRoll(g: G.View) {
  let last: Extract<G.LogEntry, { t: 'roll' }> | undefined;
  for (const e of g.log) if (e.t === 'roll') last = e;
  const key = last ? `${g.seed}:${last.k}` : null;
  if (seenSeed !== g.seed) { seenSeed = g.seed; seenRoll = key; return; }
  if (!last || key === seenRoll) return;
  seenRoll = key;
  const power = last.p === g.me && myPower != null ? myPower : 0.5;
  myPower = null; diceBusy = true;
  const run = view === '3d' ? (b3 ? b3.throwDice(last.d, power) : Promise.resolve()) : throwDice2D($('#board'), last.d, power);
  run.finally(() => { diceBusy = false; if (S?.game) { renderView(S.game); renderPanel(S.game); } });
}
const myMoves = (g: G.View) => (diceBusy ? new Set<G.Pos>() : G.moves(g, g.me));

// ---------- 2D / 3D 보기 ----------
let view = store.get<'2d' | '3d'>('wd_view', '2d'), b3: Board3D | null = null, b3loading: Promise<Board3D | null> | null = null;
function renderView(g: G.View) {
  const is3 = view === '3d';
  $('#board').hidden = is3; $('#board3d').hidden = !is3; $('#reset3d').hidden = !is3;
  const mm = $('#maxmove'), moving = g.turn === g.me && g.phase === 'move' && g.roll != null && !diceBusy;
  mm.hidden = !moving; if (moving) mm.textContent = `🎲 최대 ${g.roll}칸 이동`;
  for (const b of document.querySelectorAll<HTMLElement>('#viewtog [data-v]')) b.classList.toggle('on', b.dataset.v === view);
  const orow = $('#openrow'); orow.hidden = !g.open.length;
  if (g.open.length && orow.dataset.seed !== String(g.seed)) {
    orow.dataset.seed = String(g.seed); const cards = orow.querySelector('.cards')!; cards.innerHTML = '';
    for (const c of g.open) cards.append(cardEl(g.theme, c, 'small'));
  }
  if (!is3) { b3?.stop(); return renderBoard(g); }
  $('#board').querySelector('.dice2d')?.remove();
  b3loading ??= import('./board3d.ts')
    .then(m => (b3 = m.createBoard3D($('#board3d'), COLORS, p => act({ t: 'move', to: p }), showTip, tapCell)))
    .catch(e => { console.error(e); toast('3D를 불러오지 못했어요 — 2D로 표시합니다'); view = '2d'; b3loading = null; render(); return null; });
  b3loading.then(b => { const cur = S?.game; if (!b || view !== '3d' || !cur) return; b.update(cur, myMoves(cur)); b.start(); });
}
for (const b of document.querySelectorAll<HTMLElement>('#viewtog [data-v]'))
  b.onclick = () => { view = b.dataset.v === '3d' ? '3d' : '2d'; store.set('wd_view', view); if (S?.game) renderView(S.game); };
$('#reset3d').onclick = () => b3?.resetView();

function renderWait(s: StateMsg) {
  $('#bigcode').textContent = s.code;
  const ul = $('#seats'); ul.innerHTML = '';
  s.seats.forEach((x, i) => {
    const li = el('li'); li.append(el('span', '', x.name + (i === s.you ? ' (나)' : '')));
    li.append(el('span', 'tag', x.bot ? '🤖 봇' : !x.online ? '오프라인' : i === 0 ? '👑' : ''));
    ul.append(li);
  });
  $('#hostctl').hidden = !s.host;
  $<HTMLSelectElement>('#theme2').value = s.theme;
  const opt = $in('#optroles'); opt.checked = s.opts.roles; opt.disabled = !s.host;
  const ob = $in('#optbluff'); ob.checked = s.opts.bluff; ob.disabled = !s.host;
  const picks = $('#picks'); picks.innerHTML = '';
  G.THEMES[s.theme].s.slice(0, Math.max(6, s.seats.length)).forEach((name, v) => {
    const owner = s.seats.findIndex(x => x.suspect === v), b = el('button', 'pick' + (owner === s.you ? ' mine' : ''));
    const face = el('i', '', name.split(' ').pop()![0]); face.style.background = COLORS[v];
    b.append(face, el('span', '', name), el('small', '', owner < 0 ? '' : owner === s.you ? '내 말' : s.seats[owner].name));
    b.disabled = owner >= 0 && owner !== s.you;
    b.onclick = () => send({ t: 'pick', suspect: v });
    picks.append(b);
  });
  $btn('#start').disabled = s.seats.length < 3;
  $('#waitmsg').textContent = s.host ? `${s.seats.length}/${G.MAX_PLAYERS}명 · 3명부터 시작 가능 (봇으로 채울 수 있어요)` : '방장이 시작하기를 기다리는 중…';
}

let boardKey: string | null = null, lastPos2D: (G.Pos | null)[] = [], gen2D = 0;
function renderBoard(g: G.View) {
  const b = $('#board'), m = g.map, T = G.THEMES[g.theme];
  if (boardKey !== g.seed + g.theme) {
    boardKey = g.seed + g.theme; b.innerHTML = ''; b.style.setProperty('--n', String(m.n));
    lastPos2D = g.players.map(p => p.pos);
    m.cells.forEach((c, i) => {
      if (c !== -1) return;
      const d = el('div', 'cell'); d.dataset.p = String(i); d.style.gridArea = `${Math.floor(i / m.n) + 1}/${(i % m.n) + 1}`;
      if (m.doors.some(x => x.cell === i)) { d.classList.add('door'); d.title = '문'; }
      if (m.bonus.includes(i)) { d.classList.add('bonus'); d.title = '❗ 보너스칸 — 여기서 멈추면 특수 능력'; }
      b.append(d);
    });
    m.rects.forEach((q, i) => {
      const d = el('div', 'room'); d.dataset.p = String(G.roomPos(i)); d.style.gridArea = `${q.y0 + 1}/${q.x0 + 1}/${q.y1 + 2}/${q.x1 + 2}`;
      d.style.background = `color-mix(in srgb, var(--room) 72%, ${ROOM_TINTS[i % ROOM_TINTS.length]})`;
      d.append(el('span', 'rname', T.r[i]));
      if (m.passages[i] !== undefined) { const p = el('span', 'pass', '🕳️'); p.title = '비밀 통로 → ' + T.r[m.passages[i]]; d.append(p); }
      d.append(el('span', 'toks')); b.append(d);
    });
    const q = m.center, d = el('div', 'room center'); d.dataset.p = String(G.centerPos(m));
    d.style.gridArea = `${q.y0 + 1}/${q.x0 + 1}/${q.y1 + 2}/${q.x1 + 2}`;
    d.title = '사건 파일실 — 출발점, 최종 고발은 여기서만';
    d.append(el('span', 'rname', '🗂️ 사건 파일'), el('span', 'env', '✉️'), el('span', 'toks')); b.append(d);
  }
  const gen = ++gen2D; // 다시 그려지면 이전 이동 애니메이션 타이머는 무시
  const before = new Map<string, DOMRect>(); // 추리로 끌려오는 말·흉기 연출용 이전 위치
  b.querySelectorAll<HTMLElement>('.tok[data-k]').forEach(t => before.set(t.dataset.k!, t.getBoundingClientRect()));
  b.querySelectorAll('.tok').forEach(t => t.remove());
  b.querySelectorAll('.can').forEach(t => t.classList.remove('can'));
  g.players.forEach((p, j) => {
    if (p.pos == null) return;
    const t = el('span', 'tok', T.s[p.suspect].split(' ').pop()![0]); t.dataset.k = 'p' + j;
    t.style.background = COLORS[p.suspect]; t.title = `${p.name} — ${T.s[p.suspect]}`;
    if (j === g.turn) t.classList.add('cur');
    if (j === g.me) t.classList.add('me');
    const place = (pos: G.Pos) => { const h = b.querySelector<HTMLElement>(`[data-p="${pos}"]`); if (h) (pos < 0 ? h.querySelector('.toks')! : h).append(t); };
    place(p.pos);
    const prev = lastPos2D[j];
    if (prev != null && prev !== p.pos && j === g.turn) { // 자기 이동: 실제 경로를 따라 한 칸씩(대각선 없음)
      const blocked = new Set(g.players.filter((q, k) => k !== j && q.pos != null && q.pos >= 0).map(q => q.pos as G.Pos));
      const route = G.path(m, prev, p.pos, blocked);
      route.forEach((pos, k) => setTimeout(() => { if (gen === gen2D) place(pos); }, k * 110));
      for (const pos of route) if (pos >= 0) { const c = b.querySelector(`[data-p="${pos}"]`); c?.classList.add('trail'); setTimeout(() => c?.classList.remove('trail'), route.length * 110 + 700); }
    }
  });
  const ownMove = new Set(g.players.flatMap((p, j) => (lastPos2D[j] != null && lastPos2D[j] !== p.pos && j === g.turn ? ['p' + j] : [])));
  lastPos2D = g.players.map(p => p.pos);
  g.npc.forEach((pos, v) => { // 아무도 맡지 않은 인물 말
    if (pos == null) return;
    const t = el('span', 'tok npc', T.s[v].split(' ').pop()![0]); t.dataset.k = 'n' + v;
    t.style.background = COLORS[v]; t.title = `${T.s[v]} (플레이어 없음)`;
    b.querySelector(`[data-p="${pos}"] .toks`)?.append(t);
  });
  g.weapons.forEach((room, k) => { // 흉기 말
    const w = el('span', 'tok wtok', WEAPON_ICON[g.theme][k]); w.title = '흉기: ' + T.w[k]; w.dataset.k = 'w' + k;
    b.querySelector(`[data-p="${G.roomPos(room)}"] .toks`)?.append(w);
  });
  // 위치가 바뀐 말·흉기는 이전 자리에서 날아오게(자기 이동은 위에서 한 칸씩 걷기로 처리)
  b.querySelectorAll<HTMLElement>('.tok[data-k]').forEach(t => {
    const old = before.get(t.dataset.k!); if (!old || ownMove.has(t.dataset.k!)) return;
    const now = t.getBoundingClientRect(), dx = old.left - now.left, dy = old.top - now.top;
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    t.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1.3)`, zIndex: 9 }, { transform: 'none', zIndex: 9 }], { duration: 900, easing: 'cubic-bezier(.3,.8,.3,1)' });
  });
  for (const p of myMoves(g)) b.querySelector(`[data-p="${p}"]`)?.classList.add('can');
}
// 클릭: 마우스는 바로 이동, 터치는 첫 탭 = 경로 미리보기, 같은 칸 두 번째 탭 = 이동
let lastPointer = 'mouse', armed: G.Pos | null = null;
/** 터치 기기(마우스 올리기가 없는 화면)인지 — 마지막 입력이 터치이거나, 기기 자체가 hover를 못 하면 */
const touchLike = () => lastPointer !== 'mouse' || matchMedia('(hover: none)').matches;
$('#board').onpointerdown = e => { lastPointer = e.pointerType; };
$('#board').onclick = e => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
  if (c) tapCell(+c.dataset.p!, e.clientX, e.clientY, touchLike());
};
function tapCell(p: G.Pos, x: number, y: number, touch: boolean) {
  const g = S?.game; if (!g) return;
  const ok = myMoves(g).has(p);
  touch ||= touchLike();
  if (ok && (!touch || armed === p)) { armed = null; previewPath(null); $('#hovertip').hidden = true; act({ t: 'move', to: p }); return; }
  armed = ok ? p : null;
  showTip(p, x, y, !ok); // 갈 수 있는 칸이면 '한 번 더 누르면 이동' 안내를 계속 띄워 둠
}
$('#board').onmousemove = e => {
  if (touchLike()) return; // 터치 뒤 브라우저가 흉내 내는 mousemove는 무시
  const c = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
  showTip(c ? +c.dataset.p! : null, e.clientX, e.clientY);
};
$('#board').onmouseleave = () => { if (!touchLike()) showTip(null, 0, 0); };

// ---------- 이동 경로 미리보기: 내 이동 차례에 마우스를 올린(또는 탭한) 칸까지의 길만 칠한다 ----------
function previewPath(p: G.Pos | null) {
  const b = $('#board');
  b.querySelectorAll('.path').forEach(c => { c.classList.remove('path', 'bad'); (c as HTMLElement).removeAttribute('data-step'); });
  const g = S?.game, me = g?.players[g.me];
  const moving = !!g && !!me && g.turn === g.me && g.phase === 'move' && !diceBusy && g.roll != null && me.pos != null;
  if (p == null || !moving || p === me!.pos) { b3?.preview([], true); return; }
  const blocked = new Set(g!.players.filter((q, k) => k !== g!.me && q.pos != null && q.pos >= 0).map(q => q.pos as G.Pos));
  const route = G.path(g!.map, me!.pos!, p, blocked).slice(1);
  if (!route.length) { b3?.preview([], true); return; }
  const ok = route.length <= g!.roll!;
  route.forEach((pos, k) => {
    const c = b.querySelector<HTMLElement>(`[data-p="${pos}"]`); if (!c) return;
    c.classList.add('path'); if (!ok) c.classList.add('bad');
    if (k === route.length - 1) c.dataset.step = `${route.length}/${g!.roll}`;
  });
  b3?.preview(route, ok);
}

// ---------- 칸 안내(마우스를 올리거나, 못 가는 칸을 탭하면) ----------
let tipT: ReturnType<typeof setTimeout> | undefined;
function showTip(p: G.Pos | null, x: number, y: number, brief = false) {
  const tip = $('#hovertip'), g = S?.game;
  clearTimeout(tipT);
  previewPath(p);
  if (p == null || !g) { tip.hidden = true; return; }
  const me = g.players[g.me], T = G.THEMES[g.theme], C = G.centerPos(g.map);
  const name = p === C ? '🗂️ 사건 파일실' : p < 0 ? '🚪 ' + T.r[G.roomOf(p)] : g.map.bonus.includes(p) ? '❗ 보너스칸 (멈추면 특수 능력)' : '복도';
  let line2: string;
  if (me.pos == null) line2 = '탈락해서 이동할 수 없어요';
  else if (p === me.pos) line2 = '📍 현재 위치';
  else {
    const blocked = new Set(g.players.filter((q, k) => k !== g.me && q.pos != null && q.pos >= 0).map(q => q.pos as G.Pos));
    const d = G.distances(g.map, me.pos, blocked).get(p);
    const moving = g.turn === g.me && g.phase === 'move' && !diceBusy && g.roll != null;
    if (d == null) line2 = blocked.has(p) ? '❌ 다른 말이 있는 칸' : '❌ 갈 수 없음 (다른 말이 길을 막음)';
    else if (moving) line2 = d <= g.roll! ? `✅ 이동 가능 · ${d}칸 (최대 ${g.roll}칸)` + (touchLike() && armed === p ? ' — 한 번 더 누르면 이동' : '') : `❌ 이동 불가 · ${d}칸 필요 (최대 ${g.roll}칸)`;
    else line2 = `여기까지 ${d}칸`;
  }
  tip.innerHTML = '';
  tip.append(el('b', '', name), el('span', '', line2));
  tip.style.left = Math.min(x + 14, innerWidth - 220) + 'px';
  tip.style.top = Math.min(y + 14, innerHeight - 70) + 'px';
  tip.hidden = false;
  if (brief) tipT = setTimeout(() => (tip.hidden = true), 1800);
}

const nm = (g: G.View, j: number) => g.players[j]?.name ?? '?';
const KIND_KO: Record<G.Kind, string> = { s: '인물', w: '흉기', r: '장소' };
const cn = (g: G.View, id: G.Card) => G.cardName(g.theme, id);
function line(g: G.View, e: G.LogEntry): string {
  const T = G.THEMES[g.theme];
  switch (e.t) {
    case 'start': return `${T.icon} 사건 발생. 수사를 시작합니다.`;
    case 'roll': return `${nm(g, e.p)} 🎲 ${e.d[0]} + ${e.d[1]} = ${e.v}`;
    case 'enter': return e.room === g.map.roomCount ? `🗂️ ${nm(g, e.p)} 사건 파일실 입장` : `${nm(g, e.p)} → ${T.r[e.room]}`;
    case 'passage': return `${nm(g, e.p)} 🕳️ 비밀 통로 → ${T.r[e.room]}`;
    case 'suggest': return `🔎 ${nm(g, e.p)}: ${cn(g, e.s)} · ${cn(g, e.w)} · ${cn(g, e.r)}`;
    case 'shown': return e.card ? `🃏 ${nm(g, e.p)} → ${nm(g, e.to)}: ${cn(g, e.card)}` : `🃏 ${nm(g, e.p)} → ${nm(g, e.to)}: 카드 1장 공개`;
    case 'norefute': return '❗ 아무도 반박하지 못했습니다';
    case 'accuse': return `⚖️ ${nm(g, e.p)} 고발: ${cn(g, e.s)} · ${cn(g, e.w)} · ${cn(g, e.r)} → ${e.ok ? '정답!' : e.saved ? '오답, 🛡️ 보험으로 생존' : '오답, 탈락'}`;
    case 'ability': return `${G.ROLES[e.role].icon} ${nm(g, e.p)} ${G.ROLES[e.role].name} 능력 사용` + (e.target != null ? ` → ${nm(g, e.target)}` : '') + (e.room != null ? ` → ${T.r[e.room]}` : '');
    case 'bonus': return `❗ ${nm(g, e.p)} 보너스칸 도착`;
    case 'role': return `${G.ROLES[e.role].icon} ${nm(g, e.p)}의 정체: ${G.ROLES[e.role].name}`;
    case 'silent': return `⚖️ ${nm(g, e.p)} 묵비권 — ${nm(g, e.to)}의 추론 반박을 넘김`;
    case 'silentnone': return '⚖️ 묵비권 뒤로 반박한 사람 없음 (변호사는 카드를 갖고 있음)';
    case 'rest': return `🛡️ ${nm(g, e.p)} 한 턴 쉼`;
    case 'intel':
      if (e.kind === 'tap') return `🎧 도청: ${nm(g, e.a!)} → ${nm(g, e.b!)}: ${cn(g, e.card!)}`;
      if (e.kind === 'archive') return `🗂️ 기록 열람: ${nm(g, e.a!)} → ${nm(g, e.b!)}: ${cn(g, e.card!)}`;
      if (e.kind === 'interrogate') return e.card ? `🕵️ 심문: ${nm(g, e.from ?? -1)}의 ${KIND_KO[e.cat!]} 카드 — ${cn(g, e.card)}` : `🕵️ 심문: ${nm(g, e.from ?? -1)}에게 ${KIND_KO[e.cat!]} 카드 없음`;
      return e.from == null ? `🔦 수색: ${cn(g, e.card!)} 카드는 아무도 없음 → 진실!` : `🔦 수색: ${cn(g, e.card!)} 카드는 ${nm(g, e.from)}에게`;
    case 'timeout': return `⏰ ${nm(g, e.p)} 시간 초과`;
    case 'afk': return `🤖 ${nm(g, e.p)} 자리비움 → 봇이 대신 진행`;
  }
}

type ButtonAction = 'roll' | 'passage' | 'suggest' | 'end' | 'accuse';
function renderPanel(g: G.View) {
  const me = g.players[g.me], my = g.turn === g.me && g.phase !== 'over', ph = g.phase;
  const inCenter = me.pos === G.centerPos(g.map), inRoom = G.inRoom(me.pos) && !inCenter;
  const a = G.actor(g), sug = g.sug, env = g.env;
  $('#turnname').textContent = ph === 'over' ? '게임 종료' : ph === 'refute' ? `🃏 ${nm(g, a)} 반박 중` : `${a === g.me ? '▶ 내' : nm(g, a) + '의'} 차례`;
  $('#status').textContent =
    ph === 'over' ? '게임 종료' :
    ph === 'refute' && sug ? (sug.refuter === g.me ? '보여줄 카드를 고르세요' : `${nm(g, sug.refuter)}의 반박을 기다리는 중…`) :
    me.out && env ? `🕶️ 관전 중 · 봉투: ${cn(g, env.s)} · ${cn(g, env.w)} · ${cn(g, env.r)} — 반박 차례엔 계속 카드를 냅니다` :
    my && inCenter && me.fresh && ph === 'roll' ? '🗂️ 사건 파일실에서 출발 — 주사위를 굴려 나가세요 (고발은 다시 들어왔을 때)' :
    my && inCenter && ph !== 'move' ? '🗂️ 사건 파일실 — 최종 고발하거나 다시 나가세요' :
    !my ? `${nm(g, g.turn)}의 차례입니다` :
    me.onBonus && ph === 'act' ? '❗ 보너스칸 — 특수 능력을 쓰거나 턴을 끝내세요' :
    ph === 'roll' ? (inRoom && me.canSuggest ? '이 방에서 바로 추론하거나 주사위를 굴리세요' : '주사위를 굴리세요') :
    ph === 'move' ? (diceBusy ? '🎲 굴러가는 중…' : (touchLike() ? `🎲 ${g.roll} — 칸을 한 번 누르면 길이 보이고, 한 번 더 누르면 이동해요` : `🎲 ${g.roll} — 가고 싶은 칸에 마우스를 올려 길을 확인하고 누르세요`)) :
    inRoom && me.canSuggest ? '추론하거나 턴을 끝내세요' : '턴을 끝내세요';
  const en: Record<ButtonAction, boolean> = {
    roll: my && ph === 'roll',
    passage: my && ph === 'roll' && inRoom && g.map.passages[G.roomOf(me.pos!)] !== undefined,
    suggest: my && (ph === 'roll' || ph === 'act') && inRoom && !!me.canSuggest,
    end: my && ph !== 'refute',
    accuse: my && ph !== 'refute' && ph !== 'move' && inCenter && !me.fresh,
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#actions button')) b.disabled = !en[b.dataset.a as ButtonAction];
  const hand = $('#hand'); hand.innerHTML = '';
  for (const c of me.hand ?? []) hand.append(cardEl(g.theme, c));
  const log = $('#log'); log.innerHTML = '';
  for (const e of g.log) if (e.t !== 'roll' && e.t !== 'start') log.prepend(el('li', '', line(g, e)));
  $('#last').textContent = g.log.filter(e => e.t !== 'roll').slice(-2).map(e => line(g, e)).join(' / ');
  renderRole(g, my);
}

// ---------- 탐정 직업 (보너스칸 전용) ----------
function renderRole(g: G.View, my: boolean) {
  const box = $('#rolebox'), me = g.players[g.me];
  box.hidden = !g.opts.roles || !me.role;
  if (box.hidden || !me.role) return;
  const role = me.role, R = G.ROLES[role], left = me.uses ?? 0, charged = me.charged ?? 0;
  box.innerHTML = '';
  const head = el('div', 'rolehead');
  head.append(el('b', '', `${R.icon} ${R.name}`), el('span', 'tag', `남은 ${left}회` + (charged ? ' · ✅ 준비됨' : '')));
  box.append(head, el('p', 'sub', R.desc));
  const others = g.players.map((p, j) => ({ p, j })).filter(x => x.j !== g.me && !x.p.out);
  const archive = g.log.flatMap(e => (e.t === 'shown' && e.p !== g.me && e.to !== g.me ? [e] : []));
  const usable = my && me.onBonus && !me.usedBonus && g.phase === 'act' && left > 0 && !(R.kind === 'charge' && charged) && (role !== 'analyst' || archive.length > 0);
  if (!usable) {
    box.append(el('p', 'sub', left <= 0 ? '모두 사용했습니다' : R.kind === 'charge' && charged ? '준비된 능력은 조건이 오면 쓸 수 있어요' : '❗ 보너스칸에 멈추면 사용할 수 있어요'));
  } else {
    const row = el('div', 'abil'), go = (a: G.Action) => act(a);
    const sel = (opts: [string, string][]) => { const s = el('select'); for (const [v, t] of opts) s.append(new Option(t, v)); row.append(s); return s; };
    const btn = (label: string, fn: () => void) => { const b = el('button', '', label); b.onclick = fn; row.append(b); };
    if (role === 'chief') {
      const t = sel(others.map(x => [String(x.j), x.p.name])), c = sel([['s', '인물'], ['w', '흉기'], ['r', '장소']]);
      btn('🕵️ 심문', () => go({ t: 'ability', target: +t.value, cat: c.value as G.Kind }));
    } else if (role === 'analyst') {
      const e = sel(archive.map(x => [String(x.id), `${nm(g, x.to)}의 추리에 ${nm(g, x.p)}가 보여준 카드`]));
      btn('🗂️ 열람', () => go({ t: 'ability', entry: +e.value }));
    } else if (role === 'scout' || role === 'guide') {
      const rooms = G.THEMES[g.theme].r.slice(0, g.map.roomCount).map((n, k) => [String(k), n] as [string, string]);
      const r = sel(rooms);
      btn(role === 'scout' ? '🔦 수색' : '🗝️ 이동', () => go({ t: 'ability', room: +r.value }));
    } else if (role === 'field') btn('🚓 추격 — 다시 굴려 이어서 이동', () => go({ t: 'ability' }));
    else btn(`${R.icon} 준비하기`, () => go({ t: 'ability' }));
    box.append(row, el('p', 'sub', '쓰지 않으려면 ⏭ 턴 종료'));
  }
  const known = g.players.map((p, j) => (j !== g.me && p.role ? `${G.ROLES[p.role].icon} ${p.name}` : '')).filter(Boolean);
  if (known.length) box.append(el('p', 'sub', '정체 공개: ' + known.join(' · ')));
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#actions button')) b.onclick = () => {
  const a = b.dataset.a as ButtonAction;
  if (a === 'suggest' || a === 'accuse') return openPick(a);
  act({ t: a });
};

// 주사위 버튼: 꾹 누르면 흔들리며 힘이 차고(최대 1.2초), 떼는 순간 던진다. 키보드(Enter/R)는 보통 세기로 바로.
const rollBtn = $btn('#actions [data-a=roll]');
let charging: number | null = null, stopRattle = () => {};
function chargeTick() {
  if (charging == null) return;
  rollBtn.style.setProperty('--p', String(Math.min(1, (performance.now() - charging) / 1200)));
  requestAnimationFrame(chargeTick);
}
rollBtn.onpointerdown = e => {
  if (rollBtn.disabled || e.button > 0) return;
  rollBtn.setPointerCapture(e.pointerId);
  charging = performance.now(); rollBtn.classList.add('charging'); chargeTick();
  stopRattle = Sound.rattle();
};
rollBtn.onpointerup = () => {
  if (charging == null) return;
  myPower = 0.25 + 0.75 * Math.min(1, (performance.now() - charging) / 1200);
  charging = null; rollBtn.classList.remove('charging'); rollBtn.style.removeProperty('--p'); stopRattle();
  act({ t: 'roll' });
};
rollBtn.onpointercancel = () => { stopRattle(); charging = null; rollBtn.classList.remove('charging'); rollBtn.style.removeProperty('--p'); };
rollBtn.oncontextmenu = e => e.preventDefault(); // 모바일 길게 누르기 메뉴 방지
rollBtn.onclick = e => { if (e.detail === 0) { myPower = 0.5; act({ t: 'roll' }); } };

// ---------- 대화상자 ----------
const dlg = $<HTMLDialogElement>('#dlg');
dlg.oncancel = e => { if (dlg.dataset.kind === 'refute') e.preventDefault(); };
function openDlg(kind: string, build: (f: HTMLFormElement) => void) {
  dlg.dataset.kind = kind; dlg.innerHTML = '';
  const f = el('form'); f.method = 'dialog'; build(f); dlg.append(f);
  if (!dlg.open) dlg.showModal();
}
function selectOf(g: G.View, kind: G.Kind) {
  const s = el('select'); s.name = kind;
  for (const id of G.allCards(g.map)[kind]) {
    const owner = g.players.findIndex((_, j) => memo?.cells[`${id}|${j}`] === '✓');
    s.append(new Option(cn(g, id) + (owner < 0 ? '' : `  — ✓ ${owner === g.me ? '내 카드' : nm(g, owner)}`), id));
  }
  return s;
}
function openPick(kind: 'suggest' | 'accuse') {
  const g = S?.game; if (!g) return;
  const me = g.players[g.me];
  openDlg(kind, f => {
    f.append(el('h2', '', kind === 'suggest' ? '🔎 추론' : '⚖️ 최종 고발'));
    f.append(el('p', 'sub', kind === 'suggest' ? `장소: ${G.THEMES[g.theme].r[G.roomOf(me.pos!)]}` : '틀리면 탈락합니다. 정답이면 즉시 승리.'));
    const s = selectOf(g, 's'), w = selectOf(g, 'w'), r = selectOf(g, 'r');
    f.append(s, w); if (kind === 'accuse') f.append(r);
    if (kind === 'suggest') f.append(el('p', 'sub', '💡 이미 누가 가진 걸 아는 카드(✓)를 섞으면, 나머지 카드에 대한 정보를 얻기 쉬워요.'));
    if (kind === 'suggest' && !g.opts.bluff) {
      for (const sel of [s, w]) for (const o of sel.options) if (me.hand?.includes(o.value)) { o.disabled = true; o.text += ' (내 카드 · 블러핑 금지)'; }
      for (const sel of [s, w]) { const ok = [...sel.options].find(o => !o.disabled); if (ok) sel.value = ok.value; }
      f.append(el('p', 'sub', '🚫 블러핑 금지 방: 내 손의 카드는 지목할 수 없어요'));
    } else if (kind === 'suggest') f.append(el('p', 'sub', '🎭 내 카드를 일부러 섞어 블러핑할 수도 있어요'));
    const row = el('div', 'row'), ok = el('button', kind === 'accuse' ? 'danger' : '', kind === 'suggest' ? '추론하기' : '고발하기'), no = el('button', 'ghost', '취소');
    no.value = 'cancel'; row.append(no, ok); f.append(row);
    ok.onclick = e => {
      e.preventDefault();
      act(kind === 'suggest' ? { t: 'suggest', s: s.value, w: w.value } : { t: 'accuse', s: s.value, w: w.value, r: r.value });
      dlg.close();
    };
  });
}
let dlgKey = '';
function renderDialogs(g: G.View) {
  const sug = g.sug;
  if (g.phase === 'refute' && sug && sug.refuter === g.me) {
    const key = 'refute' + g.turnNo + sug.s + sug.w;
    if (dlgKey !== key || !dlg.open) {
      dlgKey = key;
      openDlg('refute', f => {
        f.append(el('h2', '', '🃏 반박'));
        f.append(el('p', 'sub', `${nm(g, sug.p)}의 추론: ${cn(g, sug.s)} · ${cn(g, sug.w)} · ${cn(g, sug.r)}`));
        f.append(el('p', 'sub', '추론자에게만 보여줄 카드 1장을 고르세요. 시간이 끝나면 자동으로 공개됩니다.'));
        const box = el('div', 'cards row-cards');
        for (const c of sug.matches ?? []) { const b = el('button', 'cardbtn'); b.append(cardEl(g.theme, c)); b.onclick = e => { e.preventDefault(); act({ t: 'show', card: c }); dlg.close(); }; box.append(b); }
        const me = g.players[g.me];
        if (me.role === 'lawyer' && (me.charged ?? 0) > 0) {
          const b = el('button', 'ghost', '⚖️ 묵비권 — 넘기기 (사용 사실은 공개)');
          b.onclick = e => { e.preventDefault(); act({ t: 'show', silent: true }); dlg.close(); }; box.append(b);
        }
        f.append(box);
      });
    }
    return;
  }
  const env = g.env;
  if (g.phase === 'over' && env) {
    if (dlgKey !== 'over' + g.seed) {
      dlgKey = 'over' + g.seed;
      openDlg('over', f => {
        f.append(el('h2', '', g.winner === null ? '🕯️ 미제 사건' : g.winner === g.me ? '🏆 사건 해결! 당신이 이겼습니다' : `🏆 ${nm(g, g.winner)} 승리`));
        f.append(el('p', 'sub', '사건 봉투'));
        const box = el('div', 'cards');
        box.classList.add('row-cards');
        for (const k of ['s', 'w', 'r'] as const) box.append(cardEl(g.theme, env[k]));
        f.append(box);
        const row = el('div', 'row');
        if (S?.host) { const again = el('button', '', '대기실로'); again.onclick = e => { e.preventDefault(); send({ t: 'again' }); dlg.close(); }; row.append(again); }
        row.append(el('button', 'ghost', '보드 보기')); f.append(row);
      });
    }
    return;
  }
  if (dlg.open && (dlg.dataset.kind === 'refute' || dlg.dataset.kind === 'over')) dlg.close();
  if (dlg.open && g.turn !== g.me) dlg.close();
}

// ---------- 메모지 ----------
type Mark = '' | '✗' | '✓' | '?';
interface Memo { cells: Record<string, Mark>; strike: Record<string, boolean>; note: string; auto: boolean; applied: Record<string, 1> }
const MARKS: Mark[] = ['', '✗', '✓', '?'], FREE = ['x0', 'x1'];
let memo: Memo | null = null, memoKey = '';
const saveMemo = () => store.set(memoKey, memo);
function renderMemo(g: G.View) {
  const k = `wd_memo_${S?.code}_${g.seed}`;
  if (memoKey !== k) {
    memoKey = k; memo = store.get<Memo>(k, { cells: {}, strike: {}, note: '', auto: true, applied: {} });
    $in('#note').value = memo.note; $in('#auto').checked = memo.auto;
    buildMemo(g);
  }
  const M = memo!;
  if (!M.auto) return;
  let ch = false;
  const mark = (card: G.Card, owner: number) => { g.players.forEach((_, j) => (M.cells[`${card}|${j}`] = j === owner ? '✓' : '✗')); ch = true; };
  for (const c of g.players[g.me].hand ?? []) if (!M.applied['h' + c]) { mark(c, g.me); M.strike[c] = true; M.applied['h' + c] = 1; }
  for (const c of g.open) if (!M.applied['o' + c]) { g.players.forEach((_, j) => (M.cells[`${c}|${j}`] = '✗')); M.strike[c] = true; M.applied['o' + c] = 1; ch = true; }
  for (const e of g.log) if (e.t === 'shown' && e.card && !M.applied['s' + e.card]) { mark(e.card, e.p); M.applied['s' + e.card] = 1; }
  for (const e of g.log) {
    if (e.t !== 'intel' || !e.card || M.applied['s' + e.card]) continue;
    const owner = e.kind === 'tap' ? e.a : e.from;
    if (owner == null) { g.players.forEach((_, j) => (M.cells[`${e.card}|${j}`] = '✗')); ch = true; } // 아무도 없음 → 봉투 후보
    else mark(e.card, owner);
    M.applied['s' + e.card] = 1;
  }
  if (ch) { saveMemo(); paintMemo(); }
}
function buildMemo(g: G.View) {
  const t = $('#memo'); t.innerHTML = '';
  const head = el('thead'), hr = el('tr'); hr.append(el('th'));
  g.players.forEach((p, j) => { const th = el('th', '', j === g.me ? '나' : p.name); th.title = p.name; hr.append(th); });
  for (const _ of FREE) { const th = el('th', 'free', '·'); th.title = '자유 칸'; hr.append(th); }
  head.append(hr); t.append(head);
  const body = el('tbody'), all = G.allCards(g.map);
  for (const [k, label] of [['s', '범인은?'], ['w', '흉기는?'], ['r', '장소는?']] as const) {
    const sec = el('tr', 'sec'), th = el('th', '', label); th.colSpan = g.players.length + 1 + FREE.length; sec.append(th); body.append(sec);
    for (const c of all[k]) {
      const tr = el('tr'); tr.dataset.card = c; tr.append(el('th', 'rowname', cn(g, c)));
      [...g.players.keys(), ...FREE].forEach(j => { const td = el('td'); td.dataset.k = `${c}|${j}`; tr.append(td); });
      body.append(tr);
    }
  }
  t.append(body); paintMemo();
}
function paintMemo() {
  if (!memo) return;
  for (const td of document.querySelectorAll<HTMLElement>('#memo td')) { const v = memo.cells[td.dataset.k!] || ''; td.textContent = v; td.dataset.m = v; }
  for (const tr of document.querySelectorAll<HTMLElement>('#memo tr[data-card]')) tr.classList.toggle('strike', !!memo.strike[tr.dataset.card!]);
}
$('#memo').onclick = e => {
  if (!memo) return;
  const tg = e.target as HTMLElement, td = tg.closest<HTMLElement>('td'), rn = tg.closest<HTMLElement>('.rowname');
  if (td) { const k = td.dataset.k!; memo.cells[k] = MARKS[(MARKS.indexOf(memo.cells[k] || '') + 1) % MARKS.length]; }
  else if (rn) { const c = rn.parentElement!.dataset.card!; memo.strike[c] = !memo.strike[c]; }
  else return;
  saveMemo(); paintMemo();
};
$('#note').oninput = e => { if (memo) { memo.note = (e.target as HTMLInputElement).value; saveMemo(); } };
$('#auto').onchange = e => { if (memo) { memo.auto = (e.target as HTMLInputElement).checked; saveMemo(); if (S?.game) renderMemo(S.game); } };

// ---------- 메모 드로어: 슬라이드 + 드래그 ----------
const dr = $('#drawer'), hd = $('#handle');
const vertical = () => matchMedia('(max-width:760px)').matches;
let drag: { v: boolean; size: number; start: number; base: number; moved: number; off: number } | null = null;
hd.onpointerdown = e => {
  hd.setPointerCapture(e.pointerId);
  const v = vertical(), size = v ? dr.offsetHeight : dr.offsetWidth, base = dr.classList.contains('open') ? 0 : size;
  drag = { v, size, start: v ? e.clientY : e.clientX, base, moved: 0, off: base };
  dr.classList.add('dragging');
};
hd.onpointermove = e => {
  if (!drag) return;
  const d = (drag.v ? e.clientY : e.clientX) - drag.start;
  drag.moved = Math.max(drag.moved, Math.abs(d));
  drag.off = Math.min(drag.size, Math.max(0, drag.base + d));
  dr.style.transform = `translate${drag.v ? 'Y' : 'X'}(${drag.off}px)`;
};
hd.onpointerup = hd.onpointercancel = () => {
  if (!drag) return;
  dr.classList.remove('dragging'); dr.style.transform = '';
  dr.classList.toggle('open', drag.moved < 6 ? !dr.classList.contains('open') : drag.off < drag.size / 2);
  drag = null;
};
hd.onclick = e => { if (e.detail === 0) dr.classList.toggle('open'); }; // 키보드 Enter/Space
$('#closememo').onclick = () => dr.classList.remove('open');

// ---------- 단축키 ----------
addEventListener('keydown', e => {
  if (!S?.game || dlg.open || (e.target as HTMLElement).matches('input,select,textarea')) return;
  const k = e.key.toLowerCase(), click = (a: ButtonAction) => { const b = $btn(`#actions [data-a=${a}]`); if (!b.disabled) b.click(); };
  if (k === 'n') dr.classList.toggle('open');
  else if (k === 'r') click('roll');
  else if (k === 's') click('suggest');
  else if (e.key === 'Escape') dr.classList.remove('open');
});

// ---------- 타이머 ----------
setInterval(() => {
  const bar = $('#bar'), fill = $('#bar i');
  if (!deadline) { $('#secs').textContent = ''; fill.style.width = '0'; return; }
  const left = Math.max(0, deadline - Date.now());
  fill.style.width = (100 * left / total) + '%';
  bar.classList.toggle('low', left < 5000);
  $('#secs').textContent = Math.ceil(left / 1000) + 's';
}, 200);

// 소리: 첫 탭/클릭에서 오디오를 깨워 둬야 남이 던진 주사위 소리도 들린다
// iOS는 touchend/click에서만 오디오를 열 수 있어서 여러 이벤트로, 열릴 때까지 계속 시도
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  const h = () => { Sound.unlock(); if (Sound.isRunning()) removeEventListener(ev, h, true); };
  addEventListener(ev, h, { capture: true, passive: true });
}
const muteBtn = $btn('#mute');
const paintMute = () => { muteBtn.textContent = Sound.isMuted() ? '🔇' : '🔊'; muteBtn.title = Sound.isMuted() ? '소리 켜기' : '소리 끄기'; };
muteBtn.onclick = () => { Sound.setMuted(!Sound.isMuted()); Sound.unlock(); paintMute(); };
paintMute();

$btn('#create').disabled = $btn('#join').disabled = $btn('#practice').disabled = true;
render();
connect();
