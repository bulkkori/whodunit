import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../shared/game.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, bot: true }));

test('인원별 그리드·방 개수', () => {
  for (const [c, n, rooms] of [[3, 12, 6], [4, 14, 7], [5, 16, 8], [6, 18, 9]]) {
    const m = G.genMap(c, 1);
    assert.equal(m.n, n); assert.equal(m.roomCount, rooms); assert.equal(m.rects.length, rooms);
  }
});

test('시드 1000개: 중앙 출발점에서 모든 방에 도달 가능, 모두 중앙에서 출발', () => {
  for (let seed = 0; seed < 1000; seed++) for (const c of [3, 4, 5, 6]) {
    const m = G.genMap(c, seed), r = G.reachable(m, G.centerPos(m), Infinity);
    for (let i = 0; i < m.roomCount; i++) assert.ok(r.has(G.roomPos(i)), `seed ${seed} c ${c} room ${i}`);
  }
  const g = G.newGame('mansion', seats(5), 1);
  assert.ok(g.players.every(p => p.pos === G.centerPos(g.map)));
  assert.equal(new Set(g.weapons).size, 6); // 흉기 6개가 서로 다른 방에
  assert.ok(G.act(g, 0, { t: 'accuse', ...g.env }));   // 출발 직후엔 고발 불가
});

test('카드 분배: 봉투 종류별 1장, 패 장수 차이 ≤ 1, 중복 없음', () => {
  for (const c of [3, 4, 5, 6]) {
    const g = G.newGame('mansion', seats(c), 42), sizes = g.players.map(p => p.hand.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    const all = g.players.flatMap(p => p.hand).concat(Object.values(g.env), g.open);
    assert.equal(new Set(all).size, 12 + g.map.roomCount);
    assert.deepEqual(Object.values(g.env).map(x => x[0]), ['s', 'w', 'r']);
  }
});

test('view에는 다른 사람 패와 봉투가 없다', () => {
  const g = G.newGame('station', seats(4), 7), v = JSON.stringify(G.view(g, 0));
  const theirs = g.players.slice(1).flatMap(p => p.hand);
  const obj = G.view(g, 0);
  assert.equal(obj.env, undefined);
  obj.players.slice(1).forEach(p => assert.equal(p.hand, undefined));
  assert.ok(!v.includes('"env"'));
  assert.ok(theirs.length > 0);
});

test('서버 검증: 먼 칸 이동·방 밖 추론·남의 턴 거부', () => {
  const g = G.newGame('mansion', seats(3), 3);
  assert.ok(G.act(g, 1, { t: 'roll' }));                       // 남의 턴
  assert.ok(G.act(g, 0, { t: 'suggest', s: 's0', w: 'w0' }));  // 방 밖
  G.act(g, 0, { t: 'roll' }, () => 0);                          // 2
  const far = [...G.reachable(g.map, g.players[0].pos!, 20)].find(p => p >= 0 && !G.moves(g, 0).has(p));
  assert.ok(far !== undefined);
  assert.ok(G.act(g, 0, { t: 'move', to: far }));
});

test('추론: 지목된 용의자 소환, 시계방향 첫 보유자가 반박', () => {
  const g = G.newGame('atlantis', seats(4), 11);
  const target = g.players[2];
  g.players[0].pos = G.roomPos(0); g.players[0].canSuggest = true;
  // 1번은 패가 없고 2,3번이 지목 카드를 가지게 만든다
  const s = g.players[3].hand.find(c => c[0] === 's') ?? g.env.s;
  g.players[1].hand = [];
  g.players[2].hand.push(s);
  assert.equal(G.act(g, 0, { t: 'suggest', s: 's' + target.suspect, w: g.env.w }), null);
  assert.equal(target.pos, G.roomPos(0));
  assert.equal(g.weapons[+g.env.w.slice(1)], 0); // 지목한 흉기 말이 이 방으로
  assert.equal(g.phase, 'refute');
  assert.equal(g.sug?.refuter, 2);
  const card = g.sug!.matches[0];
  assert.equal(G.act(g, 2, { t: 'show', card }), null);
  assert.ok(g.players[0].known.includes(card));
  const v1 = G.view(g, 1).log.at(-1), v0 = G.view(g, 0).log.at(-1);
  assert.ok(v1?.t === 'shown' && v0?.t === 'shown');
  assert.equal(v1.card, undefined); assert.equal(v0.card, card);
});

test('반박 시간 초과 → 자동 공개, 턴 2연속 초과 → 자리비움', () => {
  const g = G.newGame('mansion', seats(3), 5);
  g.players.forEach(p => (p.bot = false));
  G.timeout(g); assert.equal(g.turn, 1);
  G.timeout(g); G.timeout(g);   // 1, 2번 각 1회
  G.timeout(g);                 // 0번 2회째
  assert.equal(g.players[0].afk, true);
});

test('비밀 통로: 모서리 방 대각선 이동', () => {
  const g = G.newGame('mansion', seats(3), 9);
  g.players[0].pos = G.roomPos(0);
  assert.equal(G.act(g, 0, { t: 'passage' }), null);
  assert.equal(g.players[0].pos, G.roomPos(3));
  assert.equal(g.players[0].canSuggest, true);
});

test('중앙: 추론 불가, 고발은 중앙에서만', () => {
  const g = G.newGame('mansion', seats(3), 4), C = G.centerPos(g.map);
  g.players[0].pos = G.roomPos(0);
  assert.ok(G.act(g, 0, { t: 'accuse', ...g.env }));        // 일반 방에서 고발 거부
  g.players[0].pos = C; g.players[0].canSuggest = true; g.players[0].fresh = false;
  assert.ok(G.act(g, 0, { t: 'suggest', s: 's0', w: 'w0' })); // 중앙에서 추론 거부
  assert.equal(G.act(g, 0, { t: 'accuse', ...g.env }), null);
  assert.equal(g.winner, 0);
});

test('틀린 고발 → 탈락·봉투 확인, 이후에도 반박함 / 맞는 고발 → 종료', () => {
  const g = G.newGame('mansion', seats(3), 21);
  const wrong = g.env.s === 's0' ? 's1' : 's0';
  g.players[0].pos = G.centerPos(g.map); g.players[0].fresh = false;
  G.act(g, 0, { t: 'accuse', s: wrong, w: g.env.w, r: g.env.r });
  assert.deepEqual(G.view(g, 0).env, g.env);
  assert.equal(G.view(g, 1).env, undefined);
  assert.equal(g.players[0].out, true); assert.equal(g.turn, 1);
  g.players[1].pos = G.roomPos(1); g.players[1].canSuggest = true;
  const w = g.env.w === 'w0' ? 'w1' : 'w0';
  g.players[2].hand = []; g.players[0].hand = [w]; g.players[1].hand = [];
  G.act(g, 1, { t: 'suggest', s: g.env.s, w });
  assert.equal(g.sug?.refuter, 0);
  assert.equal(G.act(g, 0, { t: 'show', card: w }), null);
  g.players[1].pos = G.centerPos(g.map); g.players[1].fresh = false;
  G.act(g, 1, { t: 'accuse', ...g.env });
  assert.equal(g.phase, 'over'); assert.equal(g.winner, 1);
});

test('봇끼리 3~6인 각 100판: 200턴 안에 끝나고 대부분 정답', () => {
  for (const c of [3, 4, 5, 6]) {
    let solved = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const g = G.newGame((['mansion', 'atlantis', 'station'] as const)[seed % 3], seats(c), seed), r = G.rng(seed * 31);
      let steps = 0;
      while (g.phase !== 'over') {
        const err = G.act(g, G.actor(g), G.botAction(g, r), r);
        assert.equal(err, null, `seed ${seed}: ${err}`);
        assert.ok(++steps < 5000);
      }
      assert.ok(g.turnNo <= 200, `c ${c} seed ${seed} turns ${g.turnNo}`);
      if (g.winner !== null) solved++;
    }
    assert.ok(solved >= 95, `c ${c} solved ${solved}`);
  }
});

// ---------- 준비·보너스칸·탐정 직업 ----------
const roleGame = (n: number, seed: number) => G.newGame('mansion', seats(n), seed, { roles: true, bluff: true });
/** 그 직업이 배정되는 첫 시드의 게임과 그 플레이어 번호 */
function withRole(n: number, role: G.RoleId) {
  for (let seed = 1; ; seed++) { const g = roleGame(n, seed), i = g.players.findIndex(p => p.role === role); if (i >= 0) return { g, i }; }
}
/** i를 보너스칸에 세우고 능력을 쓸 수 있는 상태로 */
function onBonus(g: G.Game, i: number) {
  g.turn = i; g.phase = 'act'; const p = g.players[i];
  p.pos = g.map.bonus[0]; p.onBonus = true; p.usedBonus = false; p.fresh = false;
}

test('준비: 고른 인물 반영, 같은 장수 분배, 남는 카드는 공개, 고르지 않은 인물 말은 중앙', () => {
  for (const n of [3, 4, 5, 6]) {
    const g = G.newGame('mansion', seats(n).map((s, i) => ({ ...s, suspect: (i * 2) % 6 })), 9);
    const sizes = new Set(g.players.map(p => p.hand.length));
    assert.equal(sizes.size, 1);
    const total = 12 + g.map.roomCount - 3;
    assert.equal(g.open.length, total % n);
    assert.ok(g.players.every(p => g.open.every(c => p.known.includes(c))));
    const picked = new Set(g.players.map(p => p.suspect));
    assert.equal(picked.size, n);
    g.npc.forEach((pos, v) => assert.equal(pos === null, picked.has(v)));
    assert.ok(g.map.bonus.length >= 4 && g.map.bonus.every(b => g.map.cells[b] === -1));
  }
});

test('복도에서 멈추면 턴 자동 종료, 보너스칸이면 능력 기회', () => {
  const { g, i } = withRole(4, 'scout');
  g.turn = i; g.phase = 'move'; g.roll = 12; const p = g.players[i]; p.fresh = false;
  const hall = [...G.moves(g, i)].find(x => x >= 0 && !g.map.bonus.includes(x))!;
  assert.equal(G.act(g, i, { t: 'move', to: hall }), null);
  assert.notEqual(g.turn, i); // 자동 종료
  g.turn = i; g.phase = 'move'; g.roll = 12; p.pos = G.centerPos(g.map);
  const b = [...G.moves(g, i)].find(x => g.map.bonus.includes(x));
  if (b !== undefined) { assert.equal(G.act(g, i, { t: 'move', to: b }), null); assert.equal(g.turn, i); assert.ok(G.canAbility(g, i)); }
});

test('블러핑 금지 방: 내 손의 카드는 지목 불가', () => {
  const g = G.newGame('mansion', seats(3), 4, { roles: false, bluff: false });
  const p = g.players[0], mine = p.hand.find(c => c[0] === 's') ?? p.hand.find(c => c[0] === 'w')!;
  p.pos = G.roomPos(0); p.canSuggest = true;
  const s = mine[0] === 's' ? mine : 's' + [0, 1, 2, 3, 4, 5].find(v => !p.hand.includes('s' + v));
  const w = mine[0] === 'w' ? mine : 'w' + [0, 1, 2, 3, 4, 5].find(v => !p.hand.includes('w' + v));
  assert.ok(G.act(g, 0, { t: 'suggest', s, w }));
});

test('직업: 보너스칸 능력 — 심문·수색·지름길·추격·도청·묵비권·보험', () => {
  { const { g, i } = withRole(4, 'chief'); onBonus(g, i);
    const t = (i + 1) % 4; assert.equal(G.act(g, i, { t: 'ability', target: t, cat: 's' }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'interrogate' && e.from === t));
    assert.ok(G.view(g, t).log.every(e => e.t !== 'intel'));
    assert.notEqual(g.turn, i); assert.equal(g.players[i].uses, G.ROLES.chief.uses - 1); }
  { const { g, i } = withRole(4, 'scout'); onBonus(g, i);
    const owner = (i + 1) % 4, card = g.players[owner].hand.find(c => c[0] === 'r') ?? (g.players[owner].hand.push('r0'), 'r0');
    assert.equal(G.act(g, i, { t: 'ability', room: +card.slice(1) }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'search')); }
  { const { g, i } = withRole(4, 'guide'); onBonus(g, i);
    assert.equal(G.act(g, i, { t: 'ability', room: 2 }), null);
    assert.equal(g.players[i].pos, G.roomPos(2)); assert.equal(g.turn, i); assert.ok(g.players[i].canSuggest); }
  { const { g, i } = withRole(4, 'field'); onBonus(g, i);
    assert.equal(G.act(g, i, { t: 'ability' }), null); assert.equal(g.phase, 'move'); assert.equal(g.turn, i); }
  { const { g, i } = withRole(4, 'tap'); onBonus(g, i);
    assert.equal(G.act(g, i, { t: 'ability' }), null); assert.ok(g.players[i].charged);
    const a = (i + 1) % 4, b = (i + 2) % 4, card = g.players[b].hand[0];
    g.turn = a; g.sug = { p: a, s: card, w: 'w9', r: 'r9', refuter: b, matches: [card] }; g.phase = 'refute';
    assert.equal(G.act(g, b, { t: 'show', card }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'tap' && e.card === card));
    assert.ok(g.log.some(e => e.t === 'role' && e.p === i)); }
  { const { g, i } = withRole(4, 'lawyer');
    assert.ok(G.act(g, i, { t: 'show', silent: true })); // 준비 안 됨
    onBonus(g, i); assert.equal(G.act(g, i, { t: 'ability' }), null); assert.ok(g.players[i].charged);
    const sugg = (i + 3) % 4, card = g.players[i].hand[0];
    g.turn = sugg; g.sug = { p: sugg, s: card, w: 'w9', r: 'r9', refuter: i, matches: [card] }; g.phase = 'refute';
    assert.equal(G.act(g, i, { t: 'show', silent: true }), null);
    assert.ok(g.log.some(e => e.t === 'silent' && e.p === i)); }
  { const { g, i } = withRole(3, 'insure'); onBonus(g, i);
    assert.equal(G.act(g, i, { t: 'ability' }), null);
    g.turn = i; g.phase = 'act'; g.players[i].pos = G.centerPos(g.map);
    const wrong = g.env.s === 's0' ? 's1' : 's0';
    assert.equal(G.act(g, i, { t: 'accuse', s: wrong, w: g.env.w, r: g.env.r }), null);
    assert.equal(g.players[i].out, false); assert.ok(g.log.some(e => e.t === 'accuse' && e.saved)); }
  { const { g, i } = withRole(4, 'analyst'); onBonus(g, i);
    assert.equal(G.canAbility(g, i), false); // 아직 남들끼리의 반박 기록 없음
    const a = (i + 1) % 4, b = (i + 2) % 4, card = g.players[b].hand[0];
    g.log.push({ t: 'shown', p: b, to: a, card, id: 999 });
    assert.ok(G.canAbility(g, i));
    assert.equal(G.act(g, i, { t: 'ability', entry: 999 }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'archive' && e.card === card)); }
  { const { g, i } = withRole(4, 'chief'); // 보너스칸이 아니면 불가
    g.turn = i; g.phase = 'act'; assert.ok(G.act(g, i, { t: 'ability', target: (i + 1) % 4, cat: 's' })); }
});

test('직업: 봇끼리 직업 켜고 3~6인 각 100판 — 오류 없이 끝남', () => {
  for (const c of [3, 4, 5, 6]) for (let seed = 1; seed <= 100; seed++) {
    const g = roleGame(c, seed), r = G.rng(seed * 17);
    let steps = 0;
    while (g.phase !== 'over') {
      const err = G.act(g, G.actor(g), G.botAction(g, r), r);
      assert.equal(err, null, `c ${c} seed ${seed}: ${err}`);
      assert.ok(++steps < 8000);
    }
    assert.ok(g.turnNo <= 250, `c ${c} seed ${seed} turns ${g.turnNo}`);
  }
});

test('이동은 상하좌우만: 대각선 칸은 이웃이 아니고, 경로도 한 칸씩 직교', () => {
  for (let seed = 0; seed < 50; seed++) {
    const m = G.genMap(4, seed);
    for (let p = 0; p < m.n * m.n; p++) {
      if (m.cells[p] !== -1) continue;
      for (const q of G.neighbors(m, p)) if (q >= 0) assert.equal(Math.abs(q % m.n - p % m.n) + Math.abs(Math.floor(q / m.n) - Math.floor(p / m.n)), 1);
    }
    const route = G.path(m, G.centerPos(m), G.roomPos(0));
    assert.ok(route.length > 2);
    for (let k = 1; k < route.length - 2; k++) { // 복도 구간
      const a = route[k], b = route[k + 1];
      assert.equal(Math.abs(a % m.n - b % m.n) + Math.abs(Math.floor(a / m.n) - Math.floor(b / m.n)), 1);
    }
  }
});
