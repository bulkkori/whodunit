import * as G from '../shared/game.ts';
import type { ClientMsg, ServerMsg, StateMsg } from '../shared/protocol.ts';
import type { Board3D } from './board3d.ts';
import { throwDice2D } from './dice.ts';
import { playIntro } from './intro.ts';
import * as Sound from './sound.ts';
import { startIcons } from './icons.ts';

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
import { COLORS, WEAPON_ICON, ROOM_TINTS, cardEl, floorTex, TEX_CELLS, loadTexManifest, asset } from './art.ts';
import { drawMapPreview, mapSummary, onTexReady } from './preview.ts';

let token = store.get<string | null>('wd_token', null);
if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); store.set('wd_token', token); }
const TOKEN = token;

let S: StateMsg | null = null, ws: WebSocket | null = null, deadline = 0, total = G.TURN_MS, everConnected = false;
let code = new URLSearchParams(location.search).get('room');
// 초대 링크(?room=)로 열었고 닉네임이 저장돼 있으면 바로 입장 → 응답 전까지 대기실 스켈레톤
let linkJoining = !!code && !!store.get('wd_name', '').trim(), codeJoining = false;

// ---------- 연결 ----------
function connect() {
  const sock = (ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host));
  sock.onopen = () => {
    everConnected = true; for (const id of ['#create', '#join', '#practice']) { $btn(id).disabled = false; $(id).classList.remove('sk'); } $('#wake').hidden = true;
    if (code && $in('#name').value) join(code);
  };
  sock.onmessage = e => {
    const m = JSON.parse(e.data) as ServerMsg;
    stopLoading(); linkJoining = false; const wasCode = codeJoining; codeJoining = false;
    if (m.t === 'kicked') { S = null; code = null; history.replaceState(null, '', location.pathname); render(); return toast('방장이 이 방에서 내보냈어요'); }
    if (m.t === 'error') { if (!S) { code = null; history.replaceState(null, '', location.pathname); render(); } return wasCode ? codeErr(m.msg) : toast(m.msg); }
    S = m; code = m.code; creating = false;
    if (location.search !== '?room=' + m.code) history.replaceState(null, '', '?room=' + m.code);
    deadline = m.left == null ? 0 : Date.now() + m.left;
    total = m.game?.phase === 'refute' ? G.REFUTE_MS : G.TURN_MS;
    render();
  };
  sock.onclose = () => {
    if (ws !== sock) return; // 이미 새 연결로 바꿈
    if (!everConnected) $('#wake').hidden = false;
    netBar(!!S);
    clearTimeout(retryT); retryT = setTimeout(connect, fastRetry ? 0 : 1500); fastRetry = false;
  };
  sock.addEventListener('open', () => netBar(false));
  sock.addEventListener('message', () => { clearTimeout(probeT); netBar(false); });
}
let retryT: ReturnType<typeof setTimeout> | undefined, probeT: ReturnType<typeof setTimeout> | undefined, fastRetry = false;
const netBar = (on: boolean) => { $('#netbar').hidden = !on; };
/** 아이폰은 사파리를 내렸다 오면 연결이 조용히 끊겨 있곤 함 → 돌아오는 순간 확인. 방에 있으면 재입장 요청을 보내 2.5초 안에 답이 없으면 새로 연결 */
function checkConn() {
  if (document.hidden) return;
  if (!ws || ws.readyState >= 2) { clearTimeout(retryT); netBar(!!S); connect(); return; }
  if (ws.readyState !== 1 || !S || !code) return;
  join(code);
  clearTimeout(probeT);
  probeT = setTimeout(() => { netBar(true); fastRetry = true; const old = ws; ws = null; old?.close(); connect(); }, 2500);
}
document.addEventListener('visibilitychange', checkConn);
addEventListener('pageshow', e => { if ((e as PageTransitionEvent).persisted) checkConn(); });
addEventListener('online', checkConn);
const send = (m: ClientMsg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
const act = (a: G.Action) => send({ t: 'act', action: a });
const myName = () => { const n = $in('#name').value.trim(); store.set('wd_name', n); return n; };
// 닉네임 없이 방 만들기·입장을 누르면 칸 아래 인라인 오류 + 흔들림, 입력하면 사라짐
const nameErr = (on: boolean) => {
  const i = $in('#name'); $('#name_err').hidden = !on; i.setAttribute('aria-invalid', String(on));
  i.classList.remove('invalid'); if (on) { void i.offsetWidth; i.classList.add('invalid'); i.focus(); }
};
$in('#name').addEventListener('input', () => { if ($in('#name').value.trim()) nameErr(false); });
// 참여 코드: 5자리가 아니거나 서버가 거절(없는 방·시작된 방 등)하면 칸 아래 인라인 오류
const codeErr = (msg: string) => {
  const i = $in('#code'), e = $('#code_err'); e.textContent = msg; e.hidden = !msg; i.setAttribute('aria-invalid', String(!!msg));
  i.classList.remove('invalid'); if (msg) { void i.offsetWidth; i.classList.add('invalid'); i.focus(); }
};
$in('#code').addEventListener('input', () => codeErr(''));
const theme = () => $<HTMLSelectElement>('#theme').value as G.ThemeKey;
function join(c: string) { send({ t: 'join', code: c, name: myName(), token: TOKEN }); }

let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- 로비 ----------
for (const sel of [$<HTMLSelectElement>('#theme'), $<HTMLSelectElement>('#theme2')])
  for (const k of G.OPEN_THEMES) sel.append(new Option(G.THEMES[k].name, k));
$in('#name').value = store.get('wd_name', '');
if (code) $in('#code').value = code;
// ---------- 로딩 버튼: 누르면 돌아가는 표시 + 다시 못 누름, 서버 응답(방 정보·오류)이 오면 풀림 ----------
let loadingBtn: HTMLButtonElement | null = null, loadingT: ReturnType<typeof setTimeout> | undefined;
function startLoading(b: HTMLButtonElement) {
  loadingBtn = b; b.classList.add('loading'); b.disabled = true;
  clearTimeout(loadingT); loadingT = setTimeout(() => { stopLoading(); toast('응답이 늦어요 — 다시 시도해 주세요'); }, 15000);
}
function stopLoading() { clearTimeout(loadingT); if (loadingBtn) { loadingBtn.classList.remove('loading'); loadingBtn.disabled = false; loadingBtn = null; } }

// ---------- 방 만들기 화면 ----------
let creating = false;
// 최대 인원: 한 칸에 셀렉트·텍스트 필드·스테퍼를 합침
//  한 번 누르면 목록(셀렉트처럼) · 빠르게 두 번 또는 꾹 누르면 직접 입력 · ▲▼ 또는 화살표 키로 한 명씩
const maxTxt = $in('#c_max_txt'), maxList = $('#c_max_list');
let maxPlayers = 6;
function setMax(n: number) {
  maxPlayers = Math.min(G.MAX_PLAYERS, Math.max(3, Math.round(n) || maxPlayers));
  queueMicrotask(refreshCreatePreview);
  maxTxt.value = String(maxPlayers);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#c_max .spin button')) b.setAttribute('aria-disabled', String(maxPlayers + +b.dataset.d! < 3 || maxPlayers + +b.dataset.d! > G.MAX_PLAYERS));
  for (const li of maxList.children) li.setAttribute('aria-selected', String((li as HTMLElement).dataset.v === String(maxPlayers)));
}
for (let n = 3; n <= G.MAX_PLAYERS; n++) {
  const li = el('li', '', `${n}명`); li.dataset.v = String(n); li.setAttribute('role', 'option');
  li.onclick = () => { showMaxError(''); setMax(n); listOpen(false); };
  maxList.append(li);
}
const listOpen = (on: boolean) => { maxList.hidden = !on; maxTxt.setAttribute('aria-expanded', String(on)); };
// 직접 입력 검사: 숫자가 아니거나 3~8명을 벗어나면 칸 아래 인라인 오류
const maxError = (v: string) => !v ? '' : !/^\d+$/.test(v) ? '숫자만 입력해주세요.'
  : +v < 3 || +v > G.MAX_PLAYERS ? `3~${G.MAX_PLAYERS}명 사이로 입력해주세요.` : '';
// 오류가 새로 뜨거나 바뀔 때마다 흔들림(입력 중 같은 오류가 이어지면 다시 흔들지 않음, force면 무조건)
const showMaxError = (msg: string, force = false) => {
  const e = $('#c_max_err'), c = $('#c_max'), changed = e.hidden || e.textContent !== msg;
  e.textContent = msg; e.hidden = !msg;
  c.classList.toggle('invalid', !!msg); maxTxt.setAttribute('aria-invalid', String(!!msg));
  c.classList.remove('shake'); if (msg && (changed || force)) { void c.offsetWidth; c.classList.add('shake'); }
};
maxTxt.addEventListener('input', () => showMaxError(maxError(maxTxt.value.trim())));
// ▲▼·화살표 키: 범위 끝에서 더 누르면 인라인 오류(2.5초 뒤 사라짐)
let stepErrT: ReturnType<typeof setTimeout> | undefined;
const stepMax = (d: number) => {
  const n = maxPlayers + d;
  clearTimeout(stepErrT);
  if (n < 3 || n > G.MAX_PLAYERS) {
    showMaxError(n < 3 ? '최소 3명부터 가능해요.' : `최대 ${G.MAX_PLAYERS}명까지 가능해요.`, true);
    stepErrT = setTimeout(() => { if (maxTxt.readOnly) showMaxError(''); }, 2500);
    return;
  }
  showMaxError(''); setMax(n);
};
const editMode = (on: boolean) => {
  if (!on && maxError(maxTxt.value.trim())) maxTxt.value = String(maxPlayers); // 잘못된 값으로 나가면 이전 값으로
  maxTxt.readOnly = !on; $('#c_max').classList.toggle('editing', on);
  if (on) { listOpen(false); maxTxt.focus(); maxTxt.select(); } else { showMaxError(''); setMax(parseInt(maxTxt.value, 10)); }
};
setMax(6);
let tapT: ReturnType<typeof setTimeout> | undefined, lastTap = 0;
// 꾹 누르기(0.5초) → 직접 입력. 누르는 동안 손가락이 움직이면 취소
let holdT: ReturnType<typeof setTimeout> | undefined, held = false, holdAt: [number, number] = [0, 0];
maxTxt.addEventListener('pointerdown', e => {
  if (!maxTxt.readOnly) return;
  held = false; holdAt = [e.clientX, e.clientY]; clearTimeout(holdT);
  holdT = setTimeout(() => { held = true; clearTimeout(tapT); lastTap = 0; editMode(true); }, 500);
});
maxTxt.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - holdAt[0], e.clientY - holdAt[1]) > 8) clearTimeout(holdT); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) maxTxt.addEventListener(ev, () => clearTimeout(holdT));
maxTxt.addEventListener('contextmenu', e => { if (maxTxt.readOnly || held) e.preventDefault(); }); // 길게 누를 때 메뉴 막기
maxTxt.addEventListener('click', () => {
  if (held) { held = false; return; }  // 꾹 누르기 뒤에 따라오는 click은 무시
  if (!maxTxt.readOnly) return; // 입력 중엔 커서 이동만
  const now = Date.now();
  if (now - lastTap < 320) { clearTimeout(tapT); lastTap = 0; editMode(true); return; } // 두 번 → 직접 입력
  lastTap = now;
  tapT = setTimeout(() => listOpen(maxList.hidden === true), 320);                                  // 한 번 → 목록 열고 닫기
});
maxTxt.addEventListener('blur', () => { if (!maxTxt.readOnly) editMode(false); });
maxTxt.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); if (!maxTxt.readOnly) { const er = maxError(maxTxt.value.trim()); if (!er) editMode(false); else showMaxError(er, true); } else listOpen(maxList.hidden === true); }
  else if (e.key === 'Escape') { listOpen(false); if (!maxTxt.readOnly) { maxTxt.value = String(maxPlayers); editMode(false); } }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepMax(e.key === 'ArrowUp' ? 1 : -1); }
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#c_max .spin button')) b.onclick = () => { stepMax(+b.dataset.d!); listOpen(false); };
addEventListener('pointerdown', e => { if (!(e.target as HTMLElement).closest('#c_max')) listOpen(false); });

function refreshCreatePreview() {
  const t = theme();
  document.body.dataset.gtheme = t;
  drawMapPreview($<HTMLCanvasElement>('#c_prev'), t, maxPlayers);
  setThumb($('#c_stage'), t);
  for (const b of document.querySelectorAll<HTMLElement>('#c_themes .tcard')) { const on = b.dataset.k === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  $('#c_info').replaceChildren(...mapSummary(t, maxPlayers));
}
$('#theme').addEventListener('change', refreshCreatePreview);
/** 맵 썸네일: thumb 그림(없으면 첫 방 그림). 둘 다 없으면 바로 구조 */
function setThumb(st: HTMLElement, t: G.ThemeKey) {
  const u = asset(t, 'thumb') ?? asset(t, 'r0'), img = st.querySelector('img')!;
  st.classList.toggle('nothumb', !u); if (u && !img.src.endsWith(u)) img.src = u;
  st.querySelector('figcaption b')!.textContent = `${G.THEMES[t].icon} ${G.THEMES[t].name}`;
}
// 맵 미리보기(방 만들기·대기실): 길게 누르면 썸네일 ↔ 구조(2D 판)로 확대 전환. 키보드는 Enter·Space
for (const st of [$('#c_stage'), $('#w_stage')]) {
  let t: ReturnType<typeof setTimeout> | undefined, x0 = 0, y0 = 0;
  const flip = () => { const on = st.classList.toggle('struct'); st.setAttribute('aria-pressed', String(on)); st.setAttribute('aria-label', on ? '맵 구조 — 길게 누르면 썸네일' : '맵 썸네일 — 길게 누르면 맵 구조'); };
  const cancel = () => { clearTimeout(t); st.classList.remove('pressing'); };
  st.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; st.classList.add('pressing'); t = setTimeout(() => { cancel(); navigator.vibrate?.(20); flip(); }, 450); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) st.addEventListener(ev, cancel);
  st.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
  st.addEventListener('contextmenu', e => e.preventDefault());
  st.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
}
// 맵 카드(넓은 화면): 셀렉트와 같은 값을 쓴다
const THEME_DESC: Record<G.ThemeKey, string> = { mansion: '촛불 아래 고딕 미스터리', atlantis: '가라앉은 신전의 비밀', station: '고립된 궤도 연구 기지' };
for (const [k, t] of Object.entries(G.THEMES) as [G.ThemeKey, G.Theme][]) {
  const b = el('button', 'tcard'); b.type = 'button'; b.dataset.k = k; b.setAttribute('role', 'radio');
  b.append(el('i', '', t.icon), el('b', '', t.name), el('small', '', THEME_DESC[k]));
  if (!G.OPEN_THEMES.includes(k)) { b.disabled = true; b.querySelector('small')!.textContent = '준비 중'; }
  b.onclick = () => { $<HTMLSelectElement>('#theme').value = k; refreshCreatePreview(); };
  $('#c_themes').append(b);
}
// 창 크기가 바뀌면 미리보기 다시 그림
new ResizeObserver(() => { if (!$('#createbox').hidden) refreshCreatePreview(); }).observe($('#c_prev'));
new ResizeObserver(() => { const c = $('#w_prev'); if (!$('#wait').hidden) { c.dataset.k = ''; if (S) renderWait(S); } }).observe($('#w_prev'));
const roomOpts = () => ({ roles: true, bluff: $in('#c_bluff').checked });
// 방 제목: 방 만들기 창을 열 때마다 다음 추리물 제목이 기본값으로 보이고, 비워 두면 그 제목으로 방을 만든다. 누르면 빈 칸에서 바로 입력.
const TITLES = ['자정의 마지막 손님', '사라진 유언장', '잠긴 서재의 비밀', '폭풍우 치는 밤', '누가 불을 껐는가', '거짓말쟁이의 만찬',
  '열세 번째 초대장', '멈춰 버린 괘종시계', '깨진 찻잔의 증언', '안개 속 발자국', '독이 든 와인 한 잔', '마지막 기차의 승객'];
let titleIdx = Math.floor(Math.random() * TITLES.length);
const titleIn = $in('#c_title');
const autoTitle = () => TITLES[titleIdx % TITLES.length];
$('#c_reroll').onclick = () => { titleIdx++; titleIn.value = ''; titleIn.placeholder = autoTitle(); };
titleIn.addEventListener('focus', () => { titleIn.placeholder = ''; });
titleIn.addEventListener('blur', () => { if (!titleIn.value) titleIn.placeholder = autoTitle(); });
$('#create').onclick = () => {
  if (!myName()) return nameErr(true);
  titleIdx++; titleIn.value = ''; titleIn.placeholder = autoTitle();
  creating = true; $('#c_stage').classList.remove('struct'); render(); refreshCreatePreview();
};
$('#c_cancel').onclick = () => { creating = false; render(); };
$('#c_make').onclick = () => {
  if (maxError(maxTxt.value.trim())) return maxTxt.focus();
  startLoading($btn('#c_make'));
  const msg = { t: 'create', theme: theme(), name: myName(), token: TOKEN, opts: roomOpts(), title: titleIn.value.trim() || autoTitle(), maxPlayers } as const;
  setTimeout(() => send(msg), 600); // 로딩 표시가 보이도록 최소 0.6초(응답이 빠르면 깜빡이고 끝나 버림)
};
$('#practice').onclick = () => {
  if (!myName()) $in('#name').value = '탐정';
  startLoading($btn('#practice'));
  send({ t: 'create', theme: theme(), name: myName(), token: TOKEN, opts: roomOpts(), title: '연습 사건', maxPlayers: 3 });
  send({ t: 'start' }); // 남는 2자리는 봇이 자동으로
};
$('#join').onclick = () => {
  const c = $in('#code').value.trim().toUpperCase();
  if (!myName()) return nameErr(true);
  if (c.length !== 5) return codeErr(c ? '참여 코드는 5자리예요.' : '참여 코드를 입력해주세요.');
  codeJoining = true; startLoading($btn('#join'));
  join(c);
};
$('#code').onkeydown = e => { if (e.key === 'Enter') $('#join').click(); };
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('초대 링크를 복사했어요'); } catch { toast(location.href); } };
$('#theme2').onchange = e => send({ t: 'theme', theme: (e.target as HTMLSelectElement).value as G.ThemeKey });
$('#optbluff').onchange = e => send({ t: 'opt', bluff: (e.target as HTMLInputElement).checked });
$('#start').onclick = () => send({ t: 'start' });
for (const b of document.querySelectorAll<HTMLButtonElement>('#wmax button')) b.onclick = () => { if (S) send({ t: 'maxp', n: S.maxPlayers + +b.dataset.d! }); };
$('#readybtn').onclick = () => { const me = S?.seats[S.you]; send({ t: 'ready', on: !me?.ready }); };
$('#leave').onclick = () => {
  if (S?.game && S.game.phase !== 'over' && !S.game.players[S.game.me]?.out && !confirm('지금 나가면 탈락하고, 가진 카드는 모두에게 공개됩니다. 나갈까요?')) return;
  send({ t: 'leave' });
  S = null; code = null; history.replaceState(null, '', location.pathname); ws?.close(); render();
};

// ---------- 대기실: 방 설정·맵 드로어(폰·세로 화면) ----------
const drawer = (open: boolean) => { $('#wdrawer').classList.toggle('open', open); $('#wdrawer_bg').hidden = !open; };
$('#wdrawer_open').onclick = () => drawer(true);
$('#wdrawer_close').onclick = $('#wdrawer_bg').onclick = () => drawer(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#wdrawer').classList.contains('open')) drawer(false); });
{ // 손잡이를 아래로 끌면 닫힘
  let y0 = -1; const h = $('#wdrawer .dhead');
  h.onpointerdown = e => { y0 = e.clientY; };
  h.onpointerup = e => { if (y0 >= 0 && e.clientY - y0 > 50) drawer(false); y0 = -1; };
}
// ---------- 대기실: 방장이 참가자를 길게 누르면(PC는 오른쪽 클릭도) 내보내기·방장 넘기기 ----------
{
  const menu = $<HTMLDialogElement>('#seatmenu'); let target: { i: number; name: string; bot: boolean } | null = null;
  const open = (li: HTMLElement) => {
    const i = +li.dataset.i!, x = S?.seats[i]; if (!x || !S?.host) return;
    target = { i, name: x.name, bot: x.bot };
    $('#seatmenu_name').textContent = x.name;
    menu.querySelector<HTMLButtonElement>('[data-a=host]')!.hidden = x.bot;
    menu.showModal();
  };
  let t: ReturnType<typeof setTimeout> | undefined, x0 = 0, y0 = 0;
  const ul = $('#seats');
  ul.addEventListener('pointerdown', e => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li.manage'); if (!li) return;
    x0 = e.clientX; y0 = e.clientY; li.classList.add('pressing');
    t = setTimeout(() => { li.classList.remove('pressing'); navigator.vibrate?.(30); open(li); }, 550);
  });
  const cancel = () => { clearTimeout(t); ul.querySelector('.pressing')?.classList.remove('pressing'); };
  ul.addEventListener('pointerup', cancel); ul.addEventListener('pointerleave', cancel); ul.addEventListener('pointercancel', cancel);
  ul.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); }); // 스크롤이면 취소
  ul.addEventListener('contextmenu', e => { const li = (e.target as HTMLElement).closest<HTMLElement>('li.manage'); if (li) { e.preventDefault(); cancel(); open(li); } });
  menu.onclick = e => {
    const a = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.a;
    if (e.target === menu) return menu.close(); // 바깥 누르면 닫기
    if (a === undefined) return;
    menu.close(); if (!a || !target) return;
    if (a === 'kick' && !target.bot && !confirm(`${target.name} 님을 내보낼까요? 이 방에는 다시 들어올 수 없어요.`)) return;
    if (a === 'host' && !confirm(`${target.name} 님에게 방장을 넘길까요?`)) return;
    send({ t: a as 'kick' | 'host', i: target.i, name: target.name });
  };
}

// ---------- 렌더 ----------
type Screen = 'lobby' | 'skel' | 'createbox' | 'wait' | 'pickstage' | 'game';
let curScreen: Screen | null = null;
function show(id: Screen) {
  for (const s of ['lobby', 'skel', 'createbox', 'wait', 'pickstage', 'game']) $('#' + s).hidden = s !== id;
  if (curScreen !== id) { const n = $('#' + id); n.classList.remove('enter'); void n.offsetWidth; n.classList.add('enter'); curScreen = id; }
  $('#drawer').hidden = $('#turnbox').hidden = id !== 'game';
  $('#leave').hidden = id === 'lobby' || id === 'createbox' || id === 'skel';
  if (id !== 'wait') { $('#wdrawer').classList.remove('open'); $('#wdrawer_bg').hidden = true; $<HTMLDialogElement>('#seatmenu').close(); }
}

function render() {
  const g = S?.game;
  document.body.dataset.gtheme = g?.theme ?? S?.theme ?? theme();
  $('#hcode').textContent = S ? `${S.title} · ${S.code}` : '';
  if (!S) return show(creating ? 'createbox' : linkJoining ? 'skel' : 'lobby');
  if (S.stage === 'pick') { show('pickstage'); return renderPick(S); }
  if (!g) { show('wait'); return renderWait(S); }
  show('game');
  maybeIntro(g);
  watchRoll(g);
  renderView(g); renderPanel(g); renderMemo(g); renderDialogs(g); autoSuggest(g); revealCards(g);
  notifyMe(g); autoFocus(g);
}

// 내가 할 차례가 새로 오면 알림. 첫 화면(입장 직후)에는 울리지 않고, 다른 화면을 보다 돌아왔을 때 이미 내 차례면 울림
let alertKey: string | null = null;
function notifyMe(g: G.View) {
  const me = g.players[g.me];
  const kind = g.phase === 'over' || me.out && g.phase !== 'refute' ? null
    : g.phase === 'refute' && g.sug?.refuter === g.me ? 'refute'
    : g.turn === g.me && g.phase === 'roll' ? 'turn' : null;
  const key = kind ? `${kind}:${g.seed}:${g.turnNo}:${g.sug?.p ?? ''}` : '';
  document.title = kind === 'refute' ? '🃏 반박할 차례 · 후더닛' : kind === 'turn' || (g.turn === g.me && g.phase !== 'over' && g.phase !== 'refute') ? '▶ 내 차례 · 후더닛' : '후더닛';
  if (introOn) return; // 시작 연출이 끝나고 다시 그릴 때 울림
  const first = alertKey === null; if (key === alertKey) return; alertKey = key;
  if (!kind || first) return;
  Sound.chime(kind);
  navigator.vibrate?.(kind === 'refute' ? [60, 80, 60] : 80);
  const h = $('header'); h.classList.remove('ping', 'ping-ref'); void h.offsetWidth; h.classList.add(kind === 'refute' ? 'ping-ref' : 'ping');
  toast(kind === 'refute' ? '🃏 반박할 차례예요 — 보여 줄 카드를 고르세요' : '▶ 내 차례예요');
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
let introOn = false;
function maybeIntro(g: G.View) {
  if (introDone.has(g.seed) || !S || S.intro < 1500) { introDone.add(g.seed); return; }
  introDone.add(g.seed); introOn = true;
  playIntro(g, () => { introOn = false; if (S?.game) render(); });
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
  run.finally(() => { diceBusy = false; if (S?.game) { renderView(S.game); renderPanel(S.game); autoFocus(S.game); } });
}
const myMoves = (g: G.View) => (diceBusy ? new Set<G.Pos>() : G.moves(g, g.me));

// ---------- 2D / 3D 보기 ----------
let view = store.get<'2d' | '3d'>('wd_view', '2d'), b3: Board3D | null = null, b3loading: Promise<Board3D | null> | null = null;
function renderView(g: G.View) {
  const is3 = view === '3d';
  $('#b2vp').hidden = is3; $('#board3d').hidden = !is3;
  const mm = $('#maxmove'), moving = g.turn === g.me && g.phase === 'move' && g.roll != null && !diceBusy;
  mm.hidden = !moving; if (moving) mm.textContent = `🎲 최대 ${g.roll}칸 이동`;
  for (const b of document.querySelectorAll<HTMLElement>('#viewtog [data-v]')) b.classList.toggle('on', b.dataset.v === view);
  const orow = $('#openrow'); orow.hidden = !g.open.length;
  if (g.open.length && orow.dataset.seed !== `${g.seed}:${g.open.length}`) { // 나간 사람 카드가 더해지면 다시 그림
    orow.dataset.seed = `${g.seed}:${g.open.length}`; const cards = orow.querySelector('.cards')!; cards.innerHTML = '';
    for (const c of g.open) cards.append(cardEl(g.theme, c, 'small'));
  }
  if (!is3) { b3?.stop(); return renderBoard(g); }
  $('#board').querySelector('.dice2d')?.remove();
  if (!b3) $('#board3d').classList.add('sk3d');
  b3loading ??= import('./board3d.ts')
    .then(m => (b3 = m.createBoard3D($('#board3d'), COLORS, p => act({ t: 'move', to: p }), showTip, tapCell)))
    .catch(e => { console.error(e); toast('3D를 불러오지 못했어요 — 2D로 표시합니다'); view = '2d'; b3loading = null; render(); return null; });
  b3loading.then(b => { $('#board3d').classList.remove('sk3d'); const cur = S?.game; if (!b || view !== '3d' || !cur) return; b.update(cur, myMoves(cur)); b.start(); });
}
for (const b of document.querySelectorAll<HTMLElement>('#viewtog [data-v]'))
  b.onclick = () => { view = b.dataset.v === '3d' ? '3d' : '2d'; store.set('wd_view', view); if (S?.game) renderView(S.game); };
$('#reset3d').onclick = () => (view === '3d' ? b3?.resetView() : pz.reset());

// ---------- 2D 보드 자유 시점: 두 손가락 벌리기/휠로 확대, 확대한 채로 끌어서 이동(끌기 직후의 탭은 칸 선택으로 치지 않음) ----------
let tokDragOn = false; // 내 말을 끄는 중이면 한 손가락 끌기는 보드 이동이 아님
const pz = (() => {
  const vp = $('#b2vp'), bd = $('#board'), pts = new Map<number, [number, number]>();
  let s = 1, tx = 0, ty = 0, dragged = false, start: { s: number; tx: number; ty: number; d: number; mx: number; my: number; x: number; y: number } | null = null;
  let rect = vp.getBoundingClientRect(), raf = 0;
  const apply = () => {
    const w = rect.width, h = rect.height;
    s = Math.min(3, Math.max(1, s)); tx = Math.min(0, Math.max(w - w * s, tx)); ty = Math.min(0, Math.max(h - h * s, ty));
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0; bd.style.transform = s === 1 ? '' : `translate3d(${tx}px,${ty}px,0) scale(${s})`; vp.classList.toggle('zoomed', s > 1);
    });
  };
  const zoomAt = (ns: number, cx: number, cy: number) => { // 화면 점(cx,cy) 아래의 보드 위치를 그대로 두고 확대
    const r = rect, x = cx - r.left, y = cy - r.top;
    ns = Math.min(3, Math.max(1, ns)); tx = x - (x - tx) * ns / s; ty = y - (y - ty) * ns / s; s = ns; apply();
  };
  const snap = () => { const a = [...pts.values()], m = a.length === 2 ? [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2] : a[0];
    start = { s, tx, ty, d: a.length === 2 ? Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) : 0, mx: m[0], my: m[1], x: a[0][0], y: a[0][1] }; };
  vp.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button) return;
    if (!pts.size) rect = vp.getBoundingClientRect();
    pts.set(e.pointerId, [e.clientX, e.clientY]); dragged = false; snap();
  });
  vp.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    const a = [...pts.values()];
    if (a.length === 2 && start.d) {
      const mx = (a[0][0] + a[1][0]) / 2, my = (a[0][1] + a[1][1]) / 2, ns = start.s * Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) / start.d;
      bd.style.willChange = 'transform'; // 실제로 확대·이동할 때만 GPU 레이어(그냥 누르면 다시 그려져 칸이 미세하게 흔들림)
      s = start.s; tx = start.tx + mx - start.mx; ty = start.ty + my - start.my; zoomAt(ns, mx, my); dragged = true;
    } else if (a.length === 1 && s > 1 && !tokDragOn) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (dragged || Math.hypot(dx, dy) > 8) { dragged = true; bd.style.willChange = 'transform'; tx = start.tx + dx; ty = start.ty + dy; apply(); }
    }
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size) snap(); else { start = null; bd.style.willChange = ''; } };
  for (const ev of ['pointerup', 'pointercancel'] as const) vp.addEventListener(ev, up);
  vp.addEventListener('click', e => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
  vp.addEventListener('wheel', e => { e.preventDefault(); rect = vp.getBoundingClientRect(); zoomAt(s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  new ResizeObserver(() => { rect = vp.getBoundingClientRect(); apply(); }).observe(vp);
  const animTo = (ns: number, ntx: number, nty: number) => {
    bd.classList.add('pzanim'); s = ns; tx = ntx; ty = nty; apply();
    clearTimeout(animT); animT = setTimeout(() => bd.classList.remove('pzanim'), 480);
  };
  let animT: ReturnType<typeof setTimeout> | undefined;
  vp.addEventListener('pointerdown', () => bd.classList.remove('pzanim'));
  return {
    reset() { s = 1; tx = ty = 0; apply(); },
    /** 판 기준 좌표(확대 전 px) 상자가 화면에 꽉 차게 부드럽게 확대. 이미 충분히 크게 보이면(1.15배 미만) 그대로 */
    focusBox(x0: number, y0: number, x1: number, y1: number, maxS = 2.6) {
      rect = vp.getBoundingClientRect();
      const w = rect.width, h = rect.height, pad = w * 0.06;
      const ns = Math.min(maxS, w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2));
      if (ns < 1.15) return animTo(1, 0, 0);
      animTo(ns, w / 2 - (x0 + x1) / 2 * ns, h / 2 - (y0 + y1) / 2 * ns);
    },
    home() { animTo(1, 0, 0); },
  };
})();

// ---------- 이동 때 자동 확대: 주사위가 멈추면 내 말과 갈 수 있는 칸이 화면에 꽉 차게, 이동이 끝나면 원래대로 ----------
let focusKey = '';
function autoFocus(g: G.View) {
  const me = g.players[g.me];
  const moving = g.turn === g.me && g.phase === 'move' && !diceBusy && me.pos != null;
  const lastRoll = g.log.findLast(e => e.t === 'roll'), key = moving ? `${g.seed}:${g.turnNo}:${lastRoll?.t === 'roll' ? lastRoll.k : 0}` : '';
  if (key === focusKey) return; const was = focusKey; focusKey = key;
  if (!moving) { if (was) { pz.home(); b3?.focus(null); } return; }
  const cells = [...myMoves(g), me.pos!];
  if (view === '3d') return b3?.focus(cells);
  boxOf(cells, b => pz.focusBox(b[0], b[1], b[2], b[3]));
}
/** 칸들(방 포함)의 판 기준 상자(확대와 무관한 offset 좌표) */
function boxOf(cells: G.Pos[], go: (b: [number, number, number, number]) => void) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of cells) {
    const e = $('#board').querySelector<HTMLElement>(`[data-p="${p}"]`); if (!e) continue;
    x0 = Math.min(x0, e.offsetLeft); y0 = Math.min(y0, e.offsetTop); x1 = Math.max(x1, e.offsetLeft + e.offsetWidth); y1 = Math.max(y1, e.offsetTop + e.offsetHeight);
  }
  if (x0 < x1) go([x0, y0, x1, y1]);
}
// 내 말 찾기: 참가자 줄의 내 이름을 누르면 내 말 쪽으로 다가가고 말이 반짝
function findMe() {
  const g = S?.game; if (!g) return; const me = g.players[g.me]; if (me.pos == null) return toast('탈락해서 판 위에 말이 없어요');
  const tok = $('#board').querySelector<HTMLElement>(`.tok[data-k="p${g.me}"]`);
  tok?.classList.remove('found'); void tok?.offsetWidth; tok?.classList.add('found');
  if (view === '3d') { b3?.focus([me.pos]); return; }
  const e = $('#board').querySelector<HTMLElement>(`[data-p="${me.pos}"]`); if (!e) return;
  const c = $('#board').querySelector<HTMLElement>('.cell')?.offsetWidth ?? 16, x = e.offsetLeft + e.offsetWidth / 2, y = e.offsetTop + e.offsetHeight / 2;
  const r = Math.max(c * 4, Math.max(e.offsetWidth, e.offsetHeight) / 2 + c); // 칸 하나 기준 4칸 반경, 방이면 방이 다 보이게
  pz.focusBox(x - r, y - r, x + r, y + r, 2.4);
}

function renderWait(s: StateMsg) {
  $('#wtitle').textContent = s.title;
  $('#bigcode').textContent = s.code;
  const chips = $('#wopts'); chips.innerHTML = '';
  for (const t of [`${G.THEMES[s.theme].icon} ${G.THEMES[s.theme].name}`, `최대 ${s.maxPlayers}명`, s.opts.bluff ? '🎭 블러핑 허용' : '🚫 블러핑 금지'])
    chips.append(el('span', 'chip', t));
  const ul = $('#seats'); ul.innerHTML = '';
  s.seats.forEach((x, i) => {
    const li = el('li'); li.classList.toggle('me', i === s.you); li.classList.toggle('off', !x.online);
    const av = el('i', 'av', x.bot ? '🤖' : [...x.name][0] ?? '?'); av.style.setProperty('--c', COLORS[i % COLORS.length]);
    const who = el('span', 'who'); who.append(el('b', '', x.name + (i === s.you ? ' (나)' : '')),
      el('small', '', x.bot ? '봇 · 준비됨' : !x.online ? '연결 끊김 · 1분 안에 돌아오면 유지' : x.host ? '방장' : x.ready ? '준비 완료' : '준비 중…'));
    li.append(el('span', 'no', String(i + 1).padStart(2, '0')), av, who);
    li.append(el('span', 'st ' + (x.host ? 'host' : x.ready ? 'ok' : 'wait'), x.host ? '👑' : x.ready ? '✔' : '…'));
    if (s.host && i !== s.you) { li.classList.add('manage'); li.dataset.i = String(i); li.title = '길게 누르거나 오른쪽 클릭: 내보내기 · 방장 넘기기'; }
    ul.append(li);
  });
  for (let k = s.seats.length; k < s.maxPlayers; k++) { const li = el('li', 'empty'); li.append(el('span', 'no', String(k + 1).padStart(2, '0')), el('i', 'av', '+'), el('span', 'who', '빈 자리 · 시작하면 봇')); ul.append(li); }
  $('#seathint').hidden = !s.host || s.seats.length < 2;
  $('#wdrawer_open').textContent = s.host ? '⚙️ 방 설정 · 맵' : '🗺 방 정보 · 맵';
  $('#wcount').textContent = `참가 ${s.seats.length} / ${s.maxPlayers}명`;
  const pc = s.maxPlayers, pkey = `${s.theme}:${pc}`, wp = $<HTMLCanvasElement>('#w_prev');
  setThumb($('#w_stage'), s.theme);
  if (wp.dataset.k !== pkey) { wp.dataset.k = pkey; drawMapPreview(wp, s.theme, pc); $('#w_info').replaceChildren(...mapSummary(s.theme, pc)); }
  $('#hostctl').hidden = !s.host;
  $('#start').hidden = !s.host;
  $<HTMLSelectElement>('#theme2').value = s.theme;
  const ob = $in('#optbluff'); ob.checked = s.opts.bluff; ob.disabled = !s.host;
  const me = s.seats[s.you], waiting = s.seats.filter(x => !x.ready);
  const rb = $btn('#readybtn'); rb.hidden = s.host;
  rb.textContent = me?.ready ? '✅ 준비 완료 (누르면 취소)' : '✋ 준비 완료';
  rb.classList.toggle('ghost', !!me?.ready);
  $btn('#start').disabled = waiting.length > 0;
  $('#wmax output').textContent = String(s.maxPlayers);
  const [minus, plus] = document.querySelectorAll<HTMLButtonElement>('#wmax button');
  minus.disabled = s.maxPlayers <= Math.max(3, s.seats.length); plus.disabled = s.maxPlayers >= G.MAX_PLAYERS;
  const bots = s.maxPlayers - s.seats.length;
  $('#waitmsg').textContent = waiting.length ? `준비를 기다리는 중: ${waiting.map(x => x.name).join(', ')}`
    : (s.host ? '모두 준비됐어요 — 게임을 시작하세요' : '모두 준비됐어요 — 방장이 시작하기를 기다리는 중…') + (bots > 0 ? ` (빈 ${bots}자리는 봇)` : '');
}

// ---------- 말 고르기(게임 시작 후 2분) ----------
let pickDeadline = 0;
function renderPick(s: StateMsg) {
  pickDeadline = Date.now() + s.pickLeft;
  const picks = $('#picks'); picks.innerHTML = '';
  G.THEMES[s.theme].s.slice(0, Math.max(6, s.seats.length)).forEach((name, v) => {
    const owner = s.seats.findIndex(x => x.suspect === v), b = el('button', 'pick' + (owner === s.you ? ' mine' : owner >= 0 ? ' taken' : ''));
    b.style.setProperty('--c', COLORS[v]);
    const art = el('span', 'pk-art'), u = asset(s.theme, 's' + v);
    if (u) { const im = new Image(); im.src = u; im.alt = ''; art.append(im); } else art.append(el('i', '', name.split(' ').pop()![0]));
    b.append(art, el('span', 'pk-name', name), el('small', 'pk-own', owner < 0 ? '' : owner === s.you ? '내 말' : s.seats[owner].name));
    b.disabled = owner >= 0 && owner !== s.you;
    b.onclick = () => send({ t: 'pick', suspect: v });
    picks.append(b);
  });
  const ul = $('#pickseats'); ul.innerHTML = '';
  s.seats.forEach((x, i) => {
    const li = el('li'); if (i === s.you) li.classList.add('me');
    const av = el('i', 'av', x.bot ? '🤖' : [...x.name][0] ?? '?'); av.style.setProperty('--c', x.suspect == null ? '#d6c39c' : COLORS[x.suspect]);
    li.append(av, el('b', '', x.name + (i === s.you ? ' (나)' : '')));
    li.append(el('span', 'tag' + (x.suspect != null ? ' ok' : ''), x.bot ? '시간이 지나면 무작위' : x.suspect == null ? '고르는 중…' : `✔ ${G.THEMES[s.theme].s[x.suspect]}`));
    ul.append(li);
  });
}

let boardKey: string | null = null, lastPos2D: (G.Pos | null)[] = [], gen2D = 0;
function renderBoard(g: G.View) {
  const b = $('#board'), m = g.map, T = G.THEMES[g.theme];
  if (boardKey !== g.seed + g.theme) {
    boardKey = g.seed + g.theme; b.innerHTML = ''; b.style.setProperty('--n', String(m.n));
    const hallTex = floorTex(g.theme, 'hall');
    b.classList.toggle('tex', !!hallTex); b.style.setProperty('--hallTex', hallTex ? `url(${hallTex})` : 'none');
    lastPos2D = g.players.map(p => p.pos);
    m.cells.forEach((c, i) => {
      if (c !== -1) return;
      const d = el('div', 'cell'); d.dataset.p = String(i); d.style.gridArea = `${Math.floor(i / m.n) + 1}/${(i % m.n) + 1}`;
      if (hallTex) d.style.setProperty('--tp', `${(i % m.n) % TEX_CELLS * 50}% ${Math.floor(i / m.n) % TEX_CELLS * 50}%`);
      if (m.doors.some(x => x.cell === i)) { d.classList.add('door'); d.title = '문'; }
      if (m.bonus.includes(i)) { d.classList.add('bonus'); d.title = '❗ 보너스칸 — 여기서 멈추면 특수 능력'; }
      b.append(d);
    });
    // 벽 두께: 방 둘레에 벽을 그리고, 문 자리만 틈(문지방)을 낸다. 문 칸이 방의 어느 변 바깥에 붙었는지로 위치 계산
    const doorGaps = (room: number, q: G.Rect, d: HTMLElement) => {
      const w = q.x1 - q.x0 + 1, h = q.y1 - q.y0 + 1;
      for (const dr of m.doors) {
        if (dr.room !== room) continue;
        const x = dr.cell % m.n, y = Math.floor(dr.cell / m.n), s = el('i', 'dgap');
        if (y < q.y0 || y > q.y1) Object.assign(s.style, { left: `${(x - q.x0) * 100 / w}%`, width: `${100 / w}%`, [y < q.y0 ? 'top' : 'bottom']: '0', height: 'var(--wallw)' });
        else Object.assign(s.style, { top: `${(y - q.y0) * 100 / h}%`, height: `${100 / h}%`, [x < q.x0 ? 'left' : 'right']: '0', width: 'var(--wallw)' });
        d.append(s);
      }
    };
    m.rects.forEach((q, i) => {
      const d = el('div', 'room'); d.dataset.p = String(G.roomPos(i)); d.style.gridArea = `${q.y0 + 1}/${q.x0 + 1}/${q.y1 + 2}/${q.x1 + 2}`;
      const ft = floorTex(g.theme, i), w = q.x1 - q.x0 + 1, h = q.y1 - q.y0 + 1;
      d.style.background = ft ? `linear-gradient(#0003,#0003), url(${ft}) 0 0 / ${100 * TEX_CELLS / w}% ${100 * TEX_CELLS / h}% repeat`
        : `color-mix(in srgb, var(--room) 72%, ${ROOM_TINTS[i % ROOM_TINTS.length]})`;
      d.append(el('span', 'rname', T.r[i]));
      if (m.passages[i] !== undefined) { const p = el('span', 'pass', '🕳️'); p.title = '비밀 통로 → ' + T.r[m.passages[i]]; d.append(p); }
      d.append(el('span', 'toks')); doorGaps(i, q, d); b.append(d);
    });
    const q = m.center, d = el('div', 'room center'); d.dataset.p = String(G.centerPos(m));
    d.style.gridArea = `${q.y0 + 1}/${q.x0 + 1}/${q.y1 + 2}/${q.x1 + 2}`;
    d.title = '사건 파일실 — 출발점, 최종 고발은 여기서만';
    const ct = floorTex(g.theme, 'center');
    if (ct) d.style.background = `linear-gradient(#0003,#0003), url(${ct}) 0 0 / ${100 * TEX_CELLS / (q.x1 - q.x0 + 1)}% ${100 * TEX_CELLS / (q.y1 - q.y0 + 1)}% repeat`;
    d.append(el('span', 'rname', '🗂️ 사건 파일'), el('span', 'env', '✉️'), el('span', 'toks')); doorGaps(m.roomCount, q, d); b.append(d);
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
  const c = (e.target as HTMLElement).closest<HTMLElement>('[data-p]'), g = S?.game;
  let p = c ? +c.dataset.p! : null;
  // 터치: 손가락이 칸을 살짝 빗나가도 가장 가까운 갈 수 있는 칸(방 포함)으로 맞춤
  if (g && touchLike() && (p == null || !myMoves(g).has(p))) p = nearestMove(g, e.clientX, e.clientY) ?? p;
  if (p != null) tapCell(p, e.clientX, e.clientY, touchLike());
};
function nearestMove(g: G.View, x: number, y: number): G.Pos | null {
  const b = $('#board'), cw = b.querySelector('.cell')?.getBoundingClientRect().width ?? 16, lim = Math.max(24, cw * 1.6);
  let best: G.Pos | null = null, bd = Infinity;
  for (const p of myMoves(g)) {
    const r = b.querySelector(`[data-p="${p}"]`)?.getBoundingClientRect(); if (!r) continue;
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= lim ? best : null;
}
function tapCell(p: G.Pos, x: number, y: number, touch: boolean) {
  const g = S?.game; if (!g) return;
  const ok = myMoves(g).has(p);
  touch ||= touchLike();
  if (ok && (!touch || armed === p)) { armed = null; previewPath(null); $('#hovertip').hidden = true; act({ t: 'move', to: p }); return; }
  armed = ok ? p : null;
  showTip(p, x, y, !ok); // 갈 수 있는 칸이면 '한 번 더 누르면 이동' 안내를 계속 띄워 둠
}
// 내 말 끌어서 놓기(터치·마우스): 말을 누른 채 끌면 손가락 위에 말이 떠서 따라오고 길이 보임 → 놓으면 이동
{
  const bd = $('#board'); let tdrag: { ghost: HTMLElement; p: G.Pos | null; id: number } | null = null, swallow = false;
  const LIFT = 46; // 손가락에 가리지 않게 말을 손가락보다 위에 띄움
  bd.addEventListener('pointerdown', e => {
    const g = S?.game; if (!g || g.turn !== g.me || g.phase !== 'move' || diceBusy) return;
    const tok = bd.querySelector<HTMLElement>(`.tok[data-k="p${g.me}"]`); if (!tok) return;
    const r = tok.getBoundingClientRect();
    if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) > Math.max(26, r.width)) return;
    if (tdrag) { end(false); return; } // 두 번째 손가락 = 핀치로 전환
    bd.setPointerCapture(e.pointerId); lastPointer = e.pointerType;
    // 판 밖(body)에 붙이면 판 기준 크기(cqw·--n)를 잃어 찌그러짐 → 지금 보이는 크기를 그대로 고정. 확대 중이면 그 배율만큼
    const ghost = tok.cloneNode(true) as HTMLElement, cs = getComputedStyle(tok), sz = Math.max(r.width, r.height);
    ghost.classList.add('tokghost'); ghost.classList.remove('cur', 'found');
    Object.assign(ghost.style, { width: sz + 'px', height: sz + 'px', fontSize: parseFloat(cs.fontSize) * (sz / (tok.offsetWidth || sz)) + 'px', aspectRatio: 'auto' });
    document.body.append(ghost);
    tdrag = { ghost, p: null, id: e.pointerId }; armed = null; tokDragOn = true;
  });
  $('#b2vp').addEventListener('pointerdown', e => { if (tdrag && e.pointerId !== tdrag.id) end(false); }, true);
  bd.addEventListener('pointermove', e => {
    if (!tdrag || e.pointerId !== tdrag.id) return; const g = S?.game; if (!g) return;
    const y = e.clientY - (e.pointerType === 'mouse' ? 0 : LIFT);
    tdrag.ghost.style.transform = `translate(${e.clientX}px,${y}px) translate(-50%,-50%) scale(1.6)`;
    const c = document.elementFromPoint(e.clientX, y)?.closest<HTMLElement>('#board [data-p]');
    let p = c ? +c.dataset.p! : null;
    if (p == null || !myMoves(g).has(p)) p = nearestMove(g, e.clientX, y) ?? p;
    if (p !== tdrag.p) { tdrag.p = p; showTip(p, e.clientX, y - 80); }
  });
  const end = (ok: boolean) => {
    if (!tdrag) return; const { ghost, p } = tdrag; tdrag = null; tokDragOn = false; ghost.remove(); swallow = true; setTimeout(() => (swallow = false), 60);
    const g = S?.game; $('#hovertip').hidden = true; previewPath(null);
    if (ok && g && p != null && myMoves(g).has(p)) act({ t: 'move', to: p });
  };
  bd.addEventListener('pointerup', e => { if (tdrag && e.pointerId === tdrag.id) end(true); }); bd.addEventListener('pointercancel', () => end(false));
  bd.addEventListener('click', e => { if (swallow) { e.stopImmediatePropagation(); swallow = false; } }, true);
}
$('#board').onmousemove = e => {
  if (touchLike() || tokDragOn) return; // 터치 뒤 브라우저가 흉내 내는 mousemove는 무시, 말을 끄는 중엔 끌기 쪽이 길을 그림
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
    else if (moving) line2 = d <= g.roll! ? `✅ 이동 가능 · ${d}칸 (최대 ${g.roll}칸)` + (touchLike() && armed === p ? ' — 버튼이나 같은 칸을 한 번 더' : '') : `❌ 이동 불가 · ${d}칸 필요 (최대 ${g.roll}칸)`;
    else line2 = `여기까지 ${d}칸`;
  }
  tip.innerHTML = '';
  tip.append(el('b', '', name), el('span', '', line2));
  // 터치: 갈 수 있는 칸을 골랐으면 큰 '여기로 이동' 버튼(작은 칸을 다시 정확히 누를 필요 없음)
  const go = touchLike() && armed === p && g.turn === g.me && g.phase === 'move' && !diceBusy;
  tip.classList.toggle('act', go);
  if (go) { const b = el('button', 'tipgo', '📍 여기로 이동'); b.onclick = ev => { ev.stopPropagation(); tapCell(p, x, y, true); }; tip.append(b); }
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
    case 'pass': return `🙅 ${nm(g, e.p)}: 반박할 카드 없음`;
    case 'norefute': return '❗ 아무도 반박하지 못했습니다';
    case 'accuse': return `⚖️ ${nm(g, e.p)} 고발: ${cn(g, e.s)} · ${cn(g, e.w)} · ${cn(g, e.r)} → ${e.ok ? '정답!' : e.saved ? '오답, 🛡️ 보험으로 생존' : '오답, 탈락'}`;
    case 'ability': return `${G.ROLES[e.role].icon} ${nm(g, e.p)} ‘${G.ROLES[e.role].name}’ 사용` + (e.target != null ? ` → ${nm(g, e.target)}` : '') + (e.room != null ? ` → ${T.r[e.room]}` : '');
    case 'bonus': return `❗ ${nm(g, e.p)} 보너스칸 도착`;
    case 'role': return `${G.ROLES[e.role].icon} ${nm(g, e.p)}의 능력 공개: ${G.ROLES[e.role].name}`;
    case 'silent': return `⚖️ ${nm(g, e.p)} 묵비권 — ${nm(g, e.to)}의 추론 반박을 넘김`;
    case 'silentnone': return '⚖️ 묵비권 뒤로 반박한 사람 없음 (묵비권을 쓴 사람은 카드를 갖고 있음)';
    case 'rest': return `🛡️ ${nm(g, e.p)} 한 턴 쉼`;
    case 'intel':
      if (e.kind === 'tap') return `🎧 도청: ${nm(g, e.a!)} → ${nm(g, e.b!)}: ${cn(g, e.card!)}`;
      if (e.kind === 'archive') return `🗂️ 기록 열람: ${nm(g, e.a!)} → ${nm(g, e.b!)}: ${cn(g, e.card!)}`;
      if (e.kind === 'interrogate') return e.card ? `🕵️ 심문: ${nm(g, e.from ?? -1)}의 ${KIND_KO[e.cat!]} 카드 — ${cn(g, e.card)}` : `🕵️ 심문: ${nm(g, e.from ?? -1)}에게 ${KIND_KO[e.cat!]} 카드 없음`;
      return e.from == null ? `🔦 수색: ${cn(g, e.card!)} 카드는 아무도 없음 → 진실!` : `🔦 수색: ${cn(g, e.card!)} 카드는 ${nm(g, e.from)}에게`;
    case 'timeout': return `⏰ ${nm(g, e.p)} 시간 초과`;
    case 'afk': return `🤖 ${nm(g, e.p)} 자리비움 → 봇이 대신 진행`;
    case 'left': return `🚪 ${nm(g, e.p)} 퇴장 — 탈락, 가진 카드는 모두에게 공개`;
  }
}

// ---------- 추리 기록: 추리 한 건 = 한 장(누가 · 세 장 · 반박 결과). 지금 진행 중인 추리는 패널 위에 크게 ----------
const SUBLOG = new Set(['pass', 'shown', 'norefute', 'silent', 'silentnone']);
function sugCard(g: G.View, e: G.LogEntry & G.Triple & { p: number }, label: string) {
  const box = el('div', 'sg'), h = el('div', 'sg-h'), dot = el('i', 'dot');
  dot.style.background = COLORS[g.players[e.p].suspect];
  h.append(dot, el('b', '', nm(g, e.p)), el('span', '', label));
  const c = el('div', 'sg-c'); for (const k of ['s', 'w', 'r'] as const) c.append(el('span', 'k-' + k, cn(g, e[k])));
  box.append(h, c, el('ol', 'sg-r')); return box;
}
function subLine(g: G.View, e: G.LogEntry) {
  if (e.t === 'pass') return `🙅 ${nm(g, e.p)} — 없음`;
  if (e.t === 'shown') return e.card ? `🃏 ${nm(g, e.p)} → ${nm(g, e.to)}: ${cn(g, e.card)}` : `🃏 ${nm(g, e.p)}가 ${nm(g, e.to)}에게 카드 1장을 보여 줌`;
  if (e.t === 'norefute') return '❗ 아무도 반박하지 못했습니다';
  return line(g, e);
}
function renderLog(g: G.View) {
  const items: HTMLElement[] = []; let cur: HTMLElement | null = null, lastSug: HTMLElement | null = null, lastP = -1;
  for (const e of g.log) {
    if (e.t === 'roll' || e.t === 'start') continue;
    if (e.t === 'suggest' || e.t === 'accuse') {
      cur = sugCard(g, e, e.t === 'suggest' ? '추리' : '최종 고발'); items.push(cur);
      if (e.t === 'accuse') { cur.classList.add('acc'); cur.querySelector('ol')!.append(el('li', '', e.ok ? '✅ 정답!' : e.saved ? '❌ 오답 — 🛡️ 보험으로 생존' : '❌ 오답 — 탈락')); cur = null; }
      else { lastSug = cur; lastP = e.p; }
      continue;
    }
    if (SUBLOG.has(e.t) && cur) { cur.querySelector('ol')!.append(el('li', 'r-' + e.t, subLine(g, e))); continue; }
    cur = null; items.push(el('div', 'ev', line(g, e)));
  }
  const now = g.sug != null || (lastP === g.turn && g.phase !== 'roll'); // 이번 차례의 추리
  const cs = $('#cursug'); cs.hidden = !(lastSug && now);
  if (lastSug && now) { const k = lastSug.cloneNode(true) as HTMLElement; if (g.sug) k.querySelector('ol')!.append(el('li', 'wait', `⏳ ${nm(g, g.sug.refuter ?? g.turn)} 반박 차례…`)); cs.replaceChildren(k); }
  items.reverse();
  $('#log').replaceChildren(...(items.length ? items : [el('p', 'sub', '아직 추리가 없습니다')]));
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
    ph === 'move' ? (diceBusy ? '🎲 굴러가는 중…' : (touchLike() ? `🎲 ${g.roll} — 내 말을 끌어다 놓거나, 칸을 눌러 고른 뒤 '여기로 이동'` : `🎲 ${g.roll} — 가고 싶은 칸에 마우스를 올려 길을 확인하고 누르세요`)) :
    inRoom && me.canSuggest ? '추론하거나 턴을 끝내세요' : '턴을 끝내세요';
  const en: Record<ButtonAction, boolean> = {
    roll: my && ph === 'roll',
    passage: my && ph === 'roll' && inRoom && g.map.passages[G.roomOf(me.pos!)] !== undefined,
    suggest: my && (ph === 'roll' || ph === 'act') && inRoom && !!me.canSuggest,
    end: my && G.canEnd(g, g.me), // 굴리기 전·굴리고 이동 전에는 못 끝냄
    accuse: my && ph !== 'refute' && ph !== 'move' && inCenter && !me.fresh,
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#actions button')) b.disabled = !en[b.dataset.a as ButtonAction];
  const hand = $('#hand'); hand.innerHTML = '';
  for (const c of me.hand ?? []) hand.append(cardEl(g.theme, c));
  renderLog(g);
  $('#last').textContent = g.log.filter(e => e.t !== 'roll').slice(-2).map(e => line(g, e)).join(' / ');
  // 폰: 보드 위 참가자 줄(누구 차례 · 누가 반박 중 · 탈락) + 마지막 행동 한 줄
  $('#plist').replaceChildren(...g.players.map((p, j) => {
    const li = el('li', '', p.name), d = el('i'); d.style.background = COLORS[p.suspect]; li.prepend(d);
    li.classList.toggle('cur', j === g.turn && ph !== 'over'); li.classList.toggle('ref', ph === 'refute' && sug?.refuter === j);
    li.classList.toggle('out', !!p.out); li.classList.toggle('me', j === g.me);
    if (j === g.me) { li.title = '내 말 찾기'; li.onclick = findMe; li.append(el('span', 'findme', '📍')); }
    return li;
  }));
  const lastE = g.log.filter(e => e.t !== 'roll').at(-1);
  $('#plast').textContent = lastE ? line(g, lastE) : '';
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
  const archive = g.archive ?? [];
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
  box.classList.toggle('usable', usable);
  const known = g.players.map((p, j) => (j !== g.me && p.role ? `${G.ROLES[p.role].icon} ${p.name}(${G.ROLES[p.role].name})` : '')).filter(Boolean);
  if (known.length) box.append(el('p', 'sub known', '공개된 능력: ' + known.join(' · ')));
}

// 폰: 보드 위 내 카드 부채꼴을 누르면 크게 펼쳐 보기(다시 누르면 접기)
const phoneLayout = matchMedia('(max-aspect-ratio:23/20) and (max-width:639px)');
$('#cardsbox').onclick = () => { if (phoneLayout.matches) $('#cardsbox').classList.toggle('open'); };
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
        // 사건 종결 보고서: 결과 도장 + 봉투 속 세 장을 차례로 뒤집어 공개
        const T = G.THEMES[g.theme];
        f.append(el('small', 'ocase', `CASE CLOSED · ${T.name}`), el('span', 'ostamp' + (g.winner === null ? ' cold' : ''), g.winner === null ? '미제' : '해결'));
        f.append(el('h2', '', '사건 종결 보고서'));
        f.append(el('p', 'owin', g.winner === null ? '아무도 진실에 닿지 못했습니다.' : g.winner === g.me ? '당신이 사건을 해결했습니다!' : `${nm(g, g.winner)} 님이 사건을 해결했습니다.`));
        const box = el('div', 'cards');
        box.classList.add('row-cards', 'ocards');
        (['s', 'w', 'r'] as const).forEach((k, n) => { const c = cardEl(g.theme, env[k]); c.style.animationDelay = `${0.35 + n * 0.45}s`; box.append(c); });
        f.append(box);
        f.append(el('p', 'ofact', `범인은 ${G.cardName(g.theme, env.s)}, 흉기는 ${G.cardName(g.theme, env.w)}, 장소는 ${G.cardName(g.theme, env.r)}.`));
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
/** 자동 메모: hint = 확실한 것 + 흐린 ? 단서, sure = 확실한 것만, off = 전부 직접(실제 클루처럼) */
type AutoMode = 'hint' | 'sure' | 'off';
interface Memo { cells: Record<string, Mark>; strike: Record<string, boolean>; note: string; auto: boolean | AutoMode; applied: Record<string, 1>; hint?: Record<string, 1> }
const MARKS: Mark[] = ['', '✗', '✓', '?'], FREE = ['x0', 'x1'];
let memo: Memo | null = null, memoKey = '';
const saveMemo = () => store.set(memoKey, memo);
function renderMemo(g: G.View) {
  const k = `wd_memo_${S?.code}_${g.seed}`;
  if (memoKey !== k) {
    memoKey = k; memo = store.get<Memo>(k, { cells: {}, strike: {}, note: '', auto: store.get<AutoMode>('wd_automode', 'hint'), applied: {} });
    if (typeof memo.auto === 'boolean') memo.auto = memo.auto ? 'sure' : 'off'; // 예전 저장 형식
    $<HTMLSelectElement>('#automode').value = memo.auto;
    buildMemo(g);
  }
  const M = memo!;
  if (M.auto === 'off') return;
  let ch = false;
  const mark = (card: G.Card, owner: number) => { g.players.forEach((_, j) => (M.cells[`${card}|${j}`] = j === owner ? '✓' : '✗')); ch = true; };
  for (const c of g.players[g.me].hand ?? []) if (!M.applied['h' + c]) { mark(c, g.me); M.strike[c] = true; M.applied['h' + c] = 1; }
  for (const c of g.open) if (!M.applied['o' + c]) { g.players.forEach((_, j) => (M.cells[`${c}|${j}`] = '✗')); M.strike[c] = true; M.applied['o' + c] = 1; ch = true; }
  for (const e of g.log) if (e.t === 'shown' && e.card && !M.applied['s' + e.card]) { mark(e.card, e.p); M.applied['s' + e.card] = 1; }
  // 반박 못 하고 넘긴 사람: 지목된 세 장 모두 그 사람에게 없음 → ✗ (이미 ✓인 칸은 그대로)
  g.log.forEach(e => {
    if (e.t !== 'pass') return;
    const key = `p${e.p}|${e.s}${e.w}${e.r}`; if (M.applied[key]) return; // 기록은 최근 40개만 오므로 위치 대신 내용으로 표시
    for (const c of [e.s, e.w, e.r]) if (M.cells[`${c}|${e.p}`] !== '✓') M.cells[`${c}|${e.p}`] = '✗';
    M.applied[key] = 1; ch = true;
  });
  // 단서: 남끼리 보여 줬을 때(카드는 모름) → 보여 준 사람 칸, 지목된 세 장에 흐린 ? (확실한 표시가 있으면 안 보임)
  let sug: G.Triple | null = null;
  for (const e of g.log) {
    if (e.t === 'suggest') sug = { s: e.s, w: e.w, r: e.r };
    if (e.t !== 'shown' || e.card || !sug) continue;
    const key = `q${e.id}`; if (M.applied[key]) continue;
    M.hint ??= {}; for (const c of [sug.s, sug.w, sug.r]) M.hint[`${c}|${e.p}`] = 1;
    M.applied[key] = 1; ch = true;
  }
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
  const hints = memo.auto === 'hint' ? memo.hint ?? {} : {};
  for (const td of document.querySelectorAll<HTMLElement>('#memo td')) {
    const v = memo.cells[td.dataset.k!] || '', h = !v && !!hints[td.dataset.k!];
    td.textContent = v || (h ? '?' : ''); td.dataset.m = v; td.classList.toggle('hintq', h);
  }
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
$('#automode').onchange = e => {
  const v = (e.target as HTMLSelectElement).value as AutoMode; store.set('wd_automode', v); // 다음 판에도 같은 방식
  if (memo) { memo.auto = v; saveMemo(); if (S?.game) renderMemo(S.game); paintMemo(); }
};

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
const syncTabs = () => {
  const t = dr.dataset.tab ?? 'memo', open = dr.classList.contains('open');
  for (const b of document.querySelectorAll<HTMLElement>('.dtabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  for (const b of document.querySelectorAll<HTMLElement>('#dockside [data-tab]')) b.classList.toggle('on', open && b.dataset.tab === t);
};
new MutationObserver(syncTabs).observe(dr, { attributes: true, attributeFilter: ['class', 'data-tab'] });
for (const b of document.querySelectorAll<HTMLElement>('.dtabs [data-tab]')) b.onclick = () => { dr.dataset.tab = b.dataset.tab; };
// 폰 스와이프: 머리줄(손잡이)을 위로 = 크게, 아래로 = 작게 → 닫기 / 내용을 좌우로 = 추리 노트 ↔ 수사 일지
{
  const sheet = dr.querySelector<HTMLElement>('.sheet')!, TABS = ['memo', 'log'];
  const phone = () => matchMedia('(max-aspect-ratio:23/20) and (max-width:639px)').matches;
  let sw: { x: number; y: number; head: boolean; top: number; t: number; vy: number; ly: number; lt: number } | null = null;
  const minTop = () => $('header').getBoundingClientRect().bottom + 6;
  sheet.addEventListener('pointerdown', e => {
    if (!phone() || (e.target as HTMLElement).closest('button,select,input,textarea')) return;
    const head = !!(e.target as HTMLElement).closest('.grab,.sheethead');
    sw = { x: e.clientX, y: e.clientY, head, top: dr.getBoundingClientRect().top, t: performance.now(), vy: 0, ly: e.clientY, lt: performance.now() };
    if (head) { sheet.setPointerCapture(e.pointerId); dr.classList.add('sdrag'); }
  });
  sheet.addEventListener('pointermove', e => {
    if (!sw?.head) return;
    const now = performance.now(), dy = e.clientY - sw.y;
    sw.vy = (e.clientY - sw.ly) / Math.max(1, now - sw.lt); sw.ly = e.clientY; sw.lt = now; // 손을 떼기 직전 속도(px/ms)
    if (dy < 0) { dr.style.top = Math.max(minTop(), sw.top + dy) + 'px'; dr.style.transform = 'none'; } // 위로: 시트가 커짐
    else { dr.style.top = sw.top + 'px'; dr.style.transform = `translateY(${dy}px)`; }              // 아래로: 시트가 내려감
  });
  sheet.addEventListener('pointerup', e => {
    if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y, head = sw.head, vy = sw.vy; sw = null;
    if (head) {
      dr.classList.remove('sdrag');
      const flick = Math.abs(vy) > 0.5;
      if (dy < -40 || (flick && vy < 0)) dr.classList.add('tall');
      else if (dy > 40 || (flick && vy > 0)) { if (dr.classList.contains('tall') && dy < 260) dr.classList.remove('tall'); else { dr.classList.remove('open', 'tall'); } }
      store.set('wd_tallmemo', dr.classList.contains('tall'));
      dr.style.top = ''; dr.style.transform = ''; // 손가락 위치에서 정해진 자리로 CSS 전환이 부드럽게 이어짐
      return;
    }
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
      const i = TABS.indexOf(dr.dataset.tab ?? 'memo'), j = Math.min(TABS.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)));
      dr.dataset.tab = TABS[j];
    }
  });
  sheet.addEventListener('pointercancel', () => { sw = null; dr.classList.remove('sdrag'); dr.style.top = ''; dr.style.transform = ''; });
}
// 폰: 아래 독의 메모·기록 버튼 — 같은 탭을 다시 누르면 닫힘
for (const b of document.querySelectorAll<HTMLElement>('#dockside [data-tab]')) b.onclick = () => {
  const same = dr.classList.contains('open') && (dr.dataset.tab ?? 'memo') === b.dataset.tab;
  dr.dataset.tab = b.dataset.tab; dr.classList.toggle('open', !same);
};
$('#tallmemo').onclick = () => { const on = dr.classList.toggle('tall'); store.set('wd_tallmemo', on); };
dr.classList.toggle('tall', store.get('wd_tallmemo', false));
// 폰 세로: 메모 서랍은 보드 아래(패널 자리)만 덮는다 → 보드를 보면서 메모·이동 가능
new ResizeObserver(() => document.documentElement.style.setProperty('--paneltop', $('#panel').getBoundingClientRect().top + 'px')).observe($('#boardwrap'));

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
  if (S?.stage === 'pick') {
    const left = Math.max(0, pickDeadline - Date.now());
    $('#ptime').textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    $<HTMLElement>('#pbar i').style.width = (100 * left / 120000) + '%';
  }
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
// 헤더 아이콘: 이모지 대신 직접 그린 선 아이콘(색은 글자색을 따라감 → 켜짐 금색, 꺼짐 흐린 회갈색)
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SPEAKER = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fill-opacity=".18"/>';
const ICON = {
  soundOn: svg(SPEAKER + '<path d="M15.6 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
  soundOff: svg(SPEAKER + '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  musicOn: svg('<path d="M9 17.5V6.2l10-2.2v11.3"/><path d="M9 9.2l10-2.2"/><circle cx="6.8" cy="17.5" r="2.3" fill="currentColor" fill-opacity=".18"/><circle cx="16.8" cy="15.3" r="2.3" fill="currentColor" fill-opacity=".18"/>'),
  musicOff: svg('<path d="M9 17.5V6.2l10-2.2v11.3"/><path d="M9 9.2l10-2.2"/><circle cx="6.8" cy="17.5" r="2.3"/><circle cx="16.8" cy="15.3" r="2.3"/><path d="M3.5 3.5l17 17"/>'),
};
const paintMute = () => { const m = Sound.isMuted(); muteBtn.innerHTML = m ? ICON.soundOff : ICON.soundOn; muteBtn.title = m ? '효과음 켜기' : '효과음 끄기'; muteBtn.setAttribute('aria-label', muteBtn.title); muteBtn.classList.toggle('off', m); };
muteBtn.onclick = () => { Sound.setMuted(!Sound.isMuted()); Sound.unlock(); paintMute(); };
paintMute();
// 배경음악 켜기/끄기
const musicBtn = $btn('#music');
const paintMusic = () => { const on = Sound.getMusic() === 'on'; musicBtn.innerHTML = on ? ICON.musicOn : ICON.musicOff; musicBtn.title = on ? '배경음악 끄기' : '배경음악 켜기'; musicBtn.setAttribute('aria-label', musicBtn.title); musicBtn.classList.toggle('off', !on); };
musicBtn.onclick = () => { Sound.setMusic(Sound.getMusic() === 'on' ? 'off' : 'on'); Sound.unlock(); paintMusic(); };
paintMusic();

$btn('#create').disabled = $btn('#join').disabled = $btn('#practice').disabled = true;
render();
startIcons(); // 화면 글자 속 이모지 → 직접 그린 선 아이콘
connect();
// 텍스처 목록이 오면 보드를 다시 그림(목록 전에 그려졌으면 단색이었으므로)
// 맵 선택·대기실 미리보기와 맵 카드도 텍스처가 준비되면 다시 그림
const redrawPreviews = () => {
  if (!$('#createbox').hidden) refreshCreatePreview();
  if (!$('#wait').hidden && S) { $('#w_prev').dataset.k = ''; renderWait(S); }
};
onTexReady(redrawPreviews);
loadTexManifest().then(() => {
  // 첫 화면 뒤에 용의자 8명이 실루엣으로 줄지어 선다(그림이 있을 때만)
  const lu = $('#lineup');
  G.THEMES.mansion.s.forEach((_, i) => { const u = asset('mansion', 's' + i); if (u) { const im = new Image(); im.src = u; im.alt = ''; lu.append(im); } });
  boardKey = ''; b3?.rebuild(); if (S?.game) render();
  for (const b of document.querySelectorAll<HTMLElement>('#c_themes .tcard')) { // 맵 카드 배경 = 그 맵의 복도 바닥
    const u = floorTex(b.dataset.k!, 'hall'); if (u) Object.assign(b.style, { backgroundImage: `linear-gradient(90deg,#000c,#0006), url(${u})`, backgroundSize: 'auto, 96px' });
  }
  redrawPreviews();
});
