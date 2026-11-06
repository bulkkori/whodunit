import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../shared/game.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, bot: true }));

test('인원별 그리드·방 개수', () => {
  for (const [c, n, rooms] of [[3, 22, 9], [4, 22, 9], [5, 22, 9], [6, 22, 9], [7, 23, 10], [8, 24, 11]]) {
    const m = G.genMap(c, 1);
    assert.equal(m.n, n); assert.equal(m.roomCount, rooms); assert.equal(m.rects.length, rooms);
  }
});

test('시드 1000개: 중앙 출발점에서 모든 방에 도달 가능, 모두 중앙에서 출발', () => {
  for (let seed = 0; seed < 1000; seed++) for (const c of [3, 4, 5, 6, 7, 8]) {
    const m = G.genMap(c, seed), r = G.reachable(m, G.centerPos(m), Infinity);
    for (let i = 0; i < m.roomCount; i++) assert.ok(r.has(G.roomPos(i)), `seed ${seed} c ${c} room ${i}`);
  }
  const g = G.newGame('mansion', seats(5), 1);
  assert.ok(g.players.every(p => p.pos === G.centerPos(g.map)));
  const placed = g.weapons.filter(x => x != null);
  assert.equal(placed.length, 6); assert.equal(new Set(placed).size, 6); // 도구 6개가 서로 다른 방에
  assert.deepEqual(G.allCards(g.map).w, g.weapons.flatMap((x, k) => (x == null ? [] : ['w' + k])));
  const toolSets = new Set([1, 2, 3, 4, 5, 6].map(seed => G.newGame('mansion', seats(4), seed).map.tools!.join()));
  assert.ok(toolSets.size >= 4, '도구 카드 구성이 판마다 달라야 함');
  assert.ok(G.act(g, 0, { t: 'accuse', ...g.env }));   // 출발 직후엔 고발 불가
});

test('카드 분배: 봉투 종류별 1장, 패 장수 차이 ≤ 1, 중복 없음', () => {
  for (const c of [3, 4, 5, 6, 7, 8]) {
    const g = G.newGame('mansion', seats(c), 42), sizes = g.players.map(p => p.hand.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    const all = g.players.flatMap(p => p.hand).concat(Object.values(g.env), g.open);
    assert.equal(new Set(all).size, 2 * g.map.people + g.map.roomCount);
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
  g.players[1].hand = [];
  g.players[2].hand.push('s' + target.suspect); // 2번이 지목될 인물 카드를 확실히 갖게
  assert.equal(G.act(g, 0, { t: 'suggest', s: 's' + target.suspect, w: g.env.w }), null);
  assert.equal(target.pos, G.roomPos(0));
  assert.equal(g.weapons[+g.env.w.slice(1)], 0); // 지목한 도구 말이 이 방으로
  assert.equal(g.phase, 'refute');
  assert.equal(g.sug?.refuter, 2);
  assert.ok(g.log.some(e => e.t === 'pass' && e.p === 1));        // 카드 없는 1번은 '반박할 카드 없음'으로 공개 기록
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
  const wrong = G.allCards(g.map).s.find(c => c !== g.env.s)!;
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
  for (const c of [3, 4, 5, 6, 7, 8]) {
    let solved = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const g = G.newGame((['mansion', 'atlantis', 'station'] as const)[seed % 3], seats(c), seed), r = G.rng(seed * 31);
      let steps = 0;
      while (g.phase !== 'over') {
        const err = G.act(g, G.actor(g), G.botAction(g, r), r);
        assert.equal(err, null, `seed ${seed}: ${err}`);
        assert.ok(++steps < 5000);
      }
      assert.ok(g.turnNo <= 40 * c, `c ${c} seed ${seed} turns ${g.turnNo}`); // 한 사람당 40차례 이내
      if (g.winner !== null) solved++;
    }
    assert.ok(solved >= 95, `c ${c} solved ${solved}`);
  }
});

test('후던잇 오리지널 봇끼리 3~8인 각 100판: 오류 없이 끝나고 대부분 정답, 담당 탐정이 실제로 끌려오는 판이 있음', () => {
  const opts = { roles: true, bluff: true, mode: 'original' as const };
  for (const c of [3, 4, 5, 6, 7, 8]) {
    let solved = 0, dragged = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const g = G.newGame((['mansion', 'atlantis', 'station'] as const)[seed % 3], seats(c), seed, opts), r = G.rng(seed * 31);
      let steps = 0;
      while (g.phase !== 'over') {
        const before = g.players.map(p => p.pos), err = G.act(g, G.actor(g), G.botAction(g, r), r);
        assert.equal(err, null, `seed ${seed}: ${err}`);
        if (g.log.at(-1)?.t === 'suggest' && g.players.some((p, j) => j !== g.turn && p.pos !== before[j])) dragged++;
        assert.ok(++steps < 5000);
      }
      assert.ok(g.turnNo <= 40 * c, `c ${c} seed ${seed} turns ${g.turnNo}`);
      if (g.winner !== null) solved++;
    }
    assert.ok(solved >= 95, `c ${c} solved ${solved}`); assert.ok(dragged > 0, `c ${c} dragged ${dragged}`);
  }
});

// ---------- 준비·보너스칸·능력 카드 ----------
const roleGame = (n: number, seed: number) => G.newGame('mansion', seats(n), seed, { roles: true, bluff: true });
/** 4인 판에서 i에게 능력 카드를 쥐여 주고, 복도(보너스칸 아님)에 멈춘 내 차례 상태로 */
function withCard(role: G.RoleId, n = 4, i = 1) {
  const g = roleGame(n, 3), p = g.players[i];
  g.turn = i; g.phase = 'act'; p.items = [role]; p.fresh = false;
  p.pos = g.map.cells.findIndex((c, k) => c === -1 && !g.map.bonus.includes(k) && !g.map.doors.some(d => d.cell === k));
  return { g, i, p };
}

test('준비: 고른 인물 반영, 같은 장수 분배, 남는 카드는 공개, 인물 카드는 8명 중 무작위(맡은 인물 포함)', () => {
  const casts = new Set<string>();
  for (const n of [3, 4, 5, 6, 7, 8]) for (const seed of [9, 10, 11]) {
    const g = G.newGame('mansion', seats(n).map((s, i) => ({ ...s, suspect: (i * 3) % 8 })), seed);
    const sizes = new Set(g.players.map(p => p.hand.length));
    assert.equal(sizes.size, 1);
    const total = 2 * g.map.people + g.map.roomCount - 3;
    assert.equal(g.open.length, total % n);
    assert.ok(g.players.every(p => g.open.every(c => p.known.includes(c))));
    const picked = new Set(g.players.map(p => p.suspect));
    assert.equal(picked.size, n);
    const cast = g.map.cast!;
    assert.equal(cast.length, Math.max(6, n)); assert.equal(new Set(cast).size, cast.length);
    assert.ok([...picked].every(v => cast.includes(v)), '맡은 인물은 반드시 인물 카드에 있음');
    assert.deepEqual(G.allCards(g.map).s, cast.map(v => 's' + v));
    assert.ok([g.env.s, ...g.players.flatMap(p => p.hand), ...g.open].filter(c => c[0] === 's').every(c => cast.includes(+c.slice(1))));
    g.npc.forEach((pos, v) => assert.equal(pos === null, picked.has(v) || !cast.includes(v)));
    assert.equal(g.npc.length, 8);
    assert.equal(g.map.bonus.length, G.bonusCount(n)); assert.ok(g.map.bonus.every(b => g.map.cells[b] === -1));
    assert.ok(g.players.every(p => p.items.length === 0));
    if (n <= 6) casts.add(cast.join());
  }
  assert.ok(casts.size >= 4, '판마다 인물 카드 구성이 달라야 함');
});

test('말 고르기: 클래식·오리지널 모두 8명 중에서', () => {
  assert.equal(G.PICKS, 8);
  const g = G.newGame('mansion', [{ name: 'A', suspect: 7 }, { name: 'B', suspect: 6 }, { name: 'C' }], 4, { roles: true, bluff: true, mode: 'classic' });
  assert.equal(g.players[0].suspect, 7); assert.equal(g.players[1].suspect, 6);
  assert.ok(g.map.cast!.includes(7) && g.map.cast!.includes(6) && g.map.cast!.includes(g.players[2].suspect));
});

test('보너스칸: 판(seed)마다 다른 위치, 인원별 개수, 네 구역에 고르게, 서로 떨어져 있음', () => {
  for (const c of [3, 4, 5, 6, 7, 8]) {
    const sets = new Set([1, 2, 3, 4, 5].map(seed => G.genMap(c, seed).bonus.slice().sort().join()));
    assert.ok(sets.size >= 4, c + '인: 판마다 배치가 달라야 함');
    for (const seed of [7, 8, 9]) {
      const m = G.genMap(c, seed), n = m.n, h = (n - 1) / 2;
      assert.equal(m.bonus.length, G.bonusCount(c));
      assert.equal(new Set(m.bonus).size, m.bonus.length);
      const q = [0, 0, 0, 0]; for (const b of m.bonus) q[(b % n > h ? 1 : 0) + (Math.floor(b / n) > h ? 2 : 0)]++;
      assert.ok(Math.max(...q) - Math.min(...q) <= 1, `${c}인 seed ${seed}: 구역별 ${q}`);
      for (const a of m.bonus) for (const b of m.bonus) if (a !== b) assert.ok(Math.abs(a % n - b % n) + Math.abs(Math.floor(a / n) - Math.floor(b / n)) >= 3);
    }
  }
  assert.ok(G.bonusCount(4) > 4 && G.bonusCount(6) > 6 && G.bonusCount(8) > 8, '예전(4·6·8개)보다 많게');
});

test('보너스칸: 멈추면 능력 카드 1장(무엇인지는 본인만), 최대 3장, 낼 카드 없으면 턴 자동 종료', () => {
  const g = roleGame(4, 5), i = 0, p = g.players[i];
  const setMove = () => { g.turn = i; g.phase = 'move'; g.roll = 12; p.pos = G.centerPos(g.map); p.fresh = false; p.usedItem = false; };
  setMove();
  const hall = [...G.moves(g, i)].find(x => x >= 0 && !g.map.bonus.includes(x))!;
  assert.equal(G.act(g, i, { t: 'move', to: hall }), null);
  assert.notEqual(g.turn, i); // 카드 없음 → 자동 종료
  setMove();
  const b = [...G.moves(g, i)].find(x => g.map.bonus.includes(x))!;
  assert.ok(b !== undefined);
  assert.equal(G.act(g, i, { t: 'move', to: b }, () => 0), null); // r=0 → 첫 카드(지정 심문)
  assert.deepEqual(p.items, ['chief']);
  assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'draw' && e.role === 'chief'));
  assert.ok(G.view(g, 1).log.every(e => !(e.t === 'intel' && e.kind === 'draw')), '남은 무슨 카드인지 모름');
  assert.equal(G.view(g, 1).players[i].itemCount, 1); assert.equal(G.view(g, 1).players[i].items, undefined);
  assert.equal(g.turn, i); assert.equal(g.phase, 'act'); // 지정 심문을 낼 수 있으니 기다림
  p.items = ['chief', 'tap', 'field'];
  setMove(); assert.equal(G.act(g, i, { t: 'move', to: b }), null);
  assert.equal(p.items.length, G.MAX_ITEMS); assert.ok(g.log.some(e => e.t === 'bonusfull' && e.p === i));
});

test('능력 카드 뽑기: 비중대로 8종 모두 나옴', () => {
  const r = G.rng(42), seen: Record<string, number> = {};
  for (let k = 0; k < 9000; k++) { const x = G.drawRole(r); seen[x] = (seen[x] ?? 0) + 1; }
  const total = G.ROLE_IDS.reduce((a, k) => a + G.ROLES[k].weight, 0);
  for (const k of G.ROLE_IDS) assert.ok(Math.abs(seen[k] / 9000 - G.ROLES[k].weight / total) < 0.02, k);
});

test('블러핑 금지 방: 내 손의 카드는 지목 불가', () => {
  const g = G.newGame('mansion', seats(3), 4, { roles: false, bluff: false });
  const p = g.players[0], all = G.allCards(g.map), mine = p.hand.find(c => c[0] === 's') ?? p.hand.find(c => c[0] === 'w')!;
  p.pos = G.roomPos(0); p.canSuggest = true;
  const s = mine[0] === 's' ? mine : all.s.find(c => !p.hand.includes(c))!;
  const w = mine[0] === 'w' ? mine : all.w.find(c => !p.hand.includes(c))!;
  assert.ok(G.act(g, 0, { t: 'suggest', s, w }));
});

test('같은 방 연속 추론 불가: 끌려왔을 때만 다음 차례 바로 추론, 원래 그 방에 있었으면 불가', () => {
  const g = G.newGame('mansion', seats(4), 5);
  const sus = (j: number) => 's' + g.players[j].suspect;
  g.players[0].pos = G.roomPos(1); g.players[0].canSuggest = true;
  g.players[1].pos = G.roomPos(1); g.players[1].canSuggest = false; // 1번은 이미 이 방에 머무는 중
  g.players[2].pos = G.roomPos(3); g.players[2].canSuggest = false;
  assert.equal(G.act(g, 0, { t: 'suggest', s: sus(1), w: g.env.w }), null);
  assert.equal(g.players[1].canSuggest, false);                    // 안 움직였으니 연속 추론 불가
  const g2 = G.newGame('mansion', seats(4), 5);
  g2.players[0].pos = G.roomPos(1); g2.players[0].canSuggest = true; g2.players[2].pos = G.roomPos(3); g2.players[2].canSuggest = false;
  assert.equal(G.act(g2, 0, { t: 'suggest', s: 's' + g2.players[2].suspect, w: g2.env.w }), null);
  assert.equal(g2.players[2].pos, G.roomPos(1)); assert.equal(g2.players[2].canSuggest, true); // 끌려옴 → 바로 추론 가능
  // 추론한 사람은 다음 차례에 같은 방에서 다시 추론할 수 없다(방에 막 들어왔을 때만)
  g.players[0].canSuggest = false; g.phase = 'roll'; g.turn = 0; g.sug = null;
  assert.match(G.act(g, 0, { t: 'suggest', s: sus(2), w: g.env.w }) ?? '', /방에 막 들어왔을 때만/);
});

test('지정 심문: 고른 종류 카드 중 1장만 본다, 카드는 사라짐', () => {
  const { g, i, p } = withCard('chief');
  const t = (i + 1) % 4; g.players[t].hand = ['s0', 's1', 's2', 'w0'];
  assert.equal(G.act(g, i, { t: 'ability', card: 'chief', target: t, cat: 's' }), null);
  assert.equal(G.view(g, i).log.filter(e => e.t === 'intel' && e.kind === 'interrogate' && e.card).length, 1);
  assert.ok(G.view(g, t).log.every(e => e.t !== 'intel'));
  assert.deepEqual(p.items, []); assert.notEqual(g.turn, i); // 복도에서 냈으니 턴 끝
});

test('능력 카드: 언제 낼 수 있나 — 내 차례만, 한 차례 1장, 가진 카드만', () => {
  { const { g, i, p } = withCard('chief'); p.items = ['chief', 'scout'];
    assert.ok(G.act(g, (i + 1) % 4, { t: 'ability', card: 'chief', target: i, cat: 's' }), '남의 차례');
    assert.ok(G.act(g, i, { t: 'ability', card: 'tap' }), '없는 카드');
    g.phase = 'roll'; p.pos = G.roomPos(0);
    assert.equal(G.act(g, i, { t: 'ability', card: 'scout', room: 1 }), null); // 굴리기 전 방에서도 OK
    assert.equal(g.turn, i); assert.equal(g.phase, 'roll');
    assert.match(G.act(g, i, { t: 'ability', card: 'chief', target: (i + 1) % 4, cat: 's' }) ?? '', /낼 수 없/); } // 한 차례 1장
  { const { g, i } = withCard('field'); g.phase = 'roll';
    assert.ok(G.act(g, i, { t: 'ability', card: 'field' }), '추격은 굴리기 전에 못 냄'); }
  { const { g, i, p } = withCard('field'); p.pos = G.roomPos(0); p.canSuggest = true;
    assert.ok(G.act(g, i, { t: 'ability', card: 'field' }), '추격은 방에서 못 냄'); }
  { const { g, i, p } = withCard('guide'); p.pos = G.roomPos(0); p.canSuggest = false;
    assert.ok(G.act(g, i, { t: 'ability', card: 'guide', room: 2 }), '지름길은 방에서 이동 뒤에 못 냄'); }
  { const { g, i } = withCard('lawyer'); assert.ok(G.act(g, i, { t: 'ability', card: 'lawyer' }), '묵비권은 반박 때만'); }
  { const { g, i } = withCard('insure'); assert.ok(G.act(g, i, { t: 'ability', card: 'insure' }), '보험은 자동'); }
  { const g = G.newGame('mansion', seats(4), 3, { roles: false, bluff: true }); g.players[0].items = ['chief']; g.phase = 'roll';
    assert.ok(G.act(g, 0, { t: 'ability', card: 'chief', target: 1, cat: 's' }), '능력 끔'); }
});

test('능력 카드: 수색·지름길·추격·도청·묵비권·보험·기록 열람', () => {
  { const { g, i } = withCard('scout');
    const owner = (i + 1) % 4, card = g.players[owner].hand.find(c => c[0] === 'r') ?? (g.players[owner].hand.push('r0'), 'r0');
    assert.equal(G.act(g, i, { t: 'ability', card: 'scout', room: +card.slice(1) }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'search' && e.card === card && e.from === owner));
    assert.ok(G.view(g, i).log.filter(e => e.t === 'intel' && e.kind === 'search').length === 1, '장소 카드만'); }
  { const { g, i, p } = withCard('guide');
    assert.equal(G.act(g, i, { t: 'ability', card: 'guide', room: 2 }), null);
    assert.equal(p.pos, G.roomPos(2)); assert.equal(g.turn, i); assert.ok(p.canSuggest); }
  { const { g, i, p } = withCard('guide'); g.phase = 'roll'; // 굴리기 전 → 사건 파일실로(고발 가능)
    assert.equal(G.act(g, i, { t: 'ability', card: 'guide', room: g.map.roomCount }), null);
    assert.equal(p.pos, G.centerPos(g.map)); assert.equal(p.canSuggest, false); assert.equal(g.phase, 'act');
    assert.equal(G.act(g, i, { t: 'accuse', ...g.env }), null); assert.equal(g.winner, i); }
  { const { g, i } = withCard('field');
    assert.equal(G.act(g, i, { t: 'ability', card: 'field' }), null); assert.equal(g.phase, 'move'); assert.equal(g.turn, i); }
  { const { g, i, p } = withCard('tap');
    assert.equal(G.act(g, i, { t: 'ability', card: 'tap' }), null); assert.equal(p.tap, G.TAP_PEEKS);
    const a = (i + 1) % 4, b = (i + 2) % 4, card = g.players[b].hand[0];
    g.turn = a; g.sug = { p: a, s: card, w: 'w9', r: 'r9', refuter: b, matches: [card] }; g.phase = 'refute';
    assert.equal(G.act(g, b, { t: 'show', card }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'tap' && e.card === card));
    assert.equal(p.tap, G.TAP_PEEKS - 1); }
  { const { g, i, p } = withCard('lawyer'); p.items = [];
    const sugg = (i + 3) % 4, card = g.players[i].hand[0];
    g.turn = sugg; g.sug = { p: sugg, s: card, w: 'w9', r: 'r9', refuter: i, matches: [card] }; g.phase = 'refute';
    assert.ok(G.act(g, i, { t: 'show', silent: true })); // 카드 없음
    p.items = ['lawyer'];
    assert.equal(G.act(g, i, { t: 'show', silent: true }), null);
    assert.ok(g.log.some(e => e.t === 'silent' && e.p === i)); assert.deepEqual(p.items, []); }
  { const { g, i, p } = withCard('insure');
    p.pos = G.centerPos(g.map);
    const wrong = G.allCards(g.map).s.find(c => c !== g.env.s)!;
    assert.equal(G.act(g, i, { t: 'accuse', s: wrong, w: g.env.w, r: g.env.r }), null);
    assert.equal(p.out, false); assert.ok(g.log.some(e => e.t === 'accuse' && e.saved)); assert.deepEqual(p.items, []); assert.ok(p.skip); }
  { const { g, i } = withCard('analyst');
    assert.ok(G.act(g, i, { t: 'ability', card: 'analyst', entry: 999 })); // 아직 남들끼리의 반박 기록 없음
    const a = (i + 1) % 4, b = (i + 2) % 4, card = g.players[b].hand[0];
    g.log.push({ t: 'shown', p: b, to: a, card, id: 999 });
    assert.equal(G.act(g, i, { t: 'ability', card: 'analyst', entry: 999 }), null);
    assert.ok(G.view(g, i).log.some(e => e.t === 'intel' && e.kind === 'archive' && e.card === card)); }
});

test('능력 카드: 봇끼리 3~8인 각 100판(두 모드) — 오류 없이 끝남, 카드를 실제로 뽑고 씀', () => {
  for (const mode of ['classic', 'original'] as const) for (const c of [3, 4, 5, 6, 7, 8]) {
    let used = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const g = G.newGame('mansion', seats(c), seed, { roles: true, bluff: true, mode }), r = G.rng(seed * 17);
      let steps = 0;
      while (g.phase !== 'over') {
        const err = G.act(g, G.actor(g), G.botAction(g, r), r);
        assert.equal(err, null, `${mode} c ${c} seed ${seed}: ${err}`);
        assert.ok(++steps < 8000);
        assert.ok(g.players.every(p => p.items.length <= G.MAX_ITEMS));
      }
      used += g.log.filter(e => e.t === 'ability').length;
      assert.ok(g.turnNo <= 50 * c, `c ${c} seed ${seed} turns ${g.turnNo}`); // 한 사람당 50차례 이내
    }
    assert.ok(used > 100, `${mode} ${c}인: 능력 카드 사용 ${used}`);
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

test('복도 폭 3칸 이상: 모든 방·사건 파일실 사이 간격 ≥ 3, 중앙 문 4개', () => {
  for (let seed = 0; seed < 200; seed++) for (const c of [3, 4, 5, 6, 7, 8]) {
    const m = G.genMap(c, seed), rects = [...m.rects, m.center];
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const A = rects[a], B = rects[b];
      const gx = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1) - 1, gy = Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1) - 1;
      assert.ok(Math.max(gx, gy) >= G.CORRIDOR, `seed ${seed} c ${c} rooms ${a},${b} gap ${Math.max(gx, gy)}`);
    }
    assert.equal(m.doors.filter(d => d.room === m.roomCount).length, 4);
  }
});

test('게임 중 나감 → 탈락: 카드는 공개, 차례 넘김, 반박 차례에서도 빠짐', () => {
  const g = G.newGame('mansion', seats(4), 7);
  const c1 = [...g.players[1].hand], open0 = g.open.length;
  G.leave(g, 1);
  assert.ok(g.players[1].out && g.players[1].left);
  assert.deepEqual(g.open.slice(open0), c1); assert.equal(g.players[1].hand.length, 0);
  assert.equal(g.turn, 0);
  G.leave(g, 0); // 자기 차례에 나가면 다음 사람으로
  assert.equal(g.turn, 2); assert.equal(g.phase, 'roll');
  assert.ok(!G.view(g, 2).log.some(e => e.t === 'pass' && e.p === 1)); // 나간 사람은 반박 확인에서 빠짐(아직 추리 없음)
  G.leave(g, 2); G.leave(g, 3);
  assert.equal(g.phase, 'over');
});

test('남끼리 보여 준 카드 내용은 숨김(보낸 사람·받은 사람만)', () => {
  const g = G.newGame('mansion', seats(3), 3);
  g.log.push({ t: 'suggest', p: 0, s: 's0', w: 'w0', r: 'r0' }, { t: 'shown', p: 1, to: 0, card: 's0', id: 99 });
  const e = G.view(g, 2).log.find(x => x.t === 'shown');
  assert.ok(e && e.t === 'shown' && e.card === undefined);
  const mine = G.view(g, 0).log.find(x => x.t === 'shown');
  assert.ok(mine && mine.t === 'shown' && mine.card === 's0');
});

test('턴 종료: 굴리기 전·이동 전에는 거부, 이동해서 방에 들어간 뒤에는 허용', () => {
  const g = G.newGame('mansion', seats(3), 5);
  assert.ok(G.act(g, 0, { t: 'end' }));                        // 굴리기 전
  G.act(g, 0, { t: 'roll' }, () => 0.99);
  assert.equal(g.phase, 'move');
  assert.ok(G.act(g, 0, { t: 'end' }));                        // 굴렸는데 이동 전
  g.phase = 'act';
  assert.equal(G.act(g, 0, { t: 'end' }), null);
  assert.equal(g.turn, 1);
});

test('턴 종료: 굴렸는데 갈 칸이 없으면 허용', () => {
  const g = G.newGame('mansion', seats(3), 5);
  G.act(g, 0, { t: 'roll' }, () => 0);
  g.roll = 0;                                                  // 갈 수 있는 칸 없음
  assert.equal(G.moves(g, 0).size, 0);
  assert.equal(G.act(g, 0, { t: 'end' }), null);
});

test('브라우저로 가는 view에는 패 배분 시드가 없다(공개 id만) — 시드로 봉투를 역산하는 치트 차단', () => {
  const g = G.newGame('mansion', seats(3), 12345); g.pub = 999;
  const v = G.view(g, 0);
  assert.equal(v.seed, 999);
  assert.notEqual(G.newGame('mansion', seats(3), v.seed).env.s + G.newGame('mansion', seats(3), v.seed).env.w, g.env.s + g.env.w);
});

test('봇 템포 옵션: 값 검증과 기본값', () => {
  assert.ok(G.isTempo('slow') && G.isTempo('fast') && G.isTempo('normal'));
  assert.ok(!G.isTempo('turbo') && !G.isTempo(1) && !G.isTempo(undefined));
  assert.ok(G.TEMPOS.slow.mul > G.TEMPOS.normal.mul && G.TEMPOS.normal.mul > G.TEMPOS.fast.mul);
});

test('직접 고른 길: 규칙에 맞으면 저장해 모두에게 보내고, 어긋나면 무시(이동 자체는 됨)', () => {
  const g = G.newGame('mansion', seats(3), 5); g.turn = 0; g.phase = 'move'; g.roll = 6;
  const from = g.players[0].pos!, m = g.map;
  // 출발(중앙 방) → 문 칸 → 한 칸 더 → 되돌아가지 않는 세 번째 칸
  const a = G.neighbors(m, from)[0], b = G.neighbors(m, a).find(x => x >= 0 && x !== from)!, c = G.neighbors(m, b).find(x => x >= 0 && x !== a)!;
  assert.deepEqual(G.chosenRoute(g, 0, c, [a, b, c]), [from, a, b, c]);
  assert.equal(G.chosenRoute(g, 0, c, [a, c]), null, '이웃이 아닌 칸으로 건너뜀');
  assert.equal(G.chosenRoute(g, 0, b, [a, b, a, b]), null, '같은 칸 두 번');
  assert.equal(G.chosenRoute(g, 0, c, [a, b, c, 'x' as never]), null, '도착이 끝이 아님·이상한 값');
  assert.equal(G.chosenRoute(g, 0, c, Array(7).fill(c)), null, '주사위 눈 초과');
  g.players[1].pos = b; g.players[1].out = false;
  assert.equal(G.chosenRoute(g, 0, c, [a, b, c]), null, '다른 말 칸 통과');
  g.players[1].pos = from;
  assert.equal(G.act(g, 0, { t: 'move', to: c, via: [a, b, c] }), null);
  assert.deepEqual(G.view(g, 1).walk, { p: 0, route: [from, a, b, c] });
});

test('후던잇 오리지널: 인원과 상관없이 용의자 8·도구 8, 용의자는 모두 NPC, 담당 용의자가 지목되면 담당 탐정 동석(클래식 끌려옴과 같음)', () => {
  const opts = { roles: true, bluff: true, mode: 'original' as const };
  for (const n of [3, 5, 8]) {
    const g = G.newGame('mansion', Array.from({ length: n }, (_, i) => ({ name: 'P' + i, bot: true, suspect: i })), 7, opts);
    assert.equal(G.allCards(g.map).s.length, 8); assert.equal(G.allCards(g.map).w.length, 8); assert.equal(g.weapons.length, 8);
    assert.ok(g.npc.length === 8 && g.npc.every(x => x === G.centerPos(g.map)), n + '인: 용의자 8명 모두 NPC 말');
  }
  const g = G.newGame('mansion', [{ name: 'A', suspect: 0 }, { name: 'B', suspect: 1 }, { name: 'C', suspect: 2 }], 3, opts);
  const room = G.roomPos(0), p0 = g.players[0];
  p0.pos = room; p0.canSuggest = true; p0.fresh = false; g.turn = 0; g.phase = 'act';
  const bPos = g.players[1].pos;
  assert.notEqual(bPos, room);
  assert.equal(G.act(g, 0, { t: 'suggest', s: 's1', w: 'w0' }), null);   // 용의자 1번 지목 = 탐정 B의 담당
  assert.equal(g.players[1].pos, room, '담당 탐정 동석'); assert.equal(g.players[1].canSuggest, true, '실제로 옮겨 왔으니 다음 차례 바로 추리');
  assert.equal(g.npc[1], room, '용의자 NPC 말도 방으로 옴');
  assert.equal(g.players[2].pos, bPos, '담당이 아닌 탐정은 그대로');
  // 이미 그 방에 있던 담당 탐정은 연속 추리 불가(클래식과 같음)
  g.players[1].canSuggest = false; g.turn = 2; g.phase = 'act'; g.sug = null; g.players[2].pos = room; g.players[2].canSuggest = true; g.players[2].fresh = false;
  assert.equal(G.act(g, 2, { t: 'suggest', s: 's1', w: 'w1' }), null);
  assert.equal(g.players[1].canSuggest, false, '안 움직였으니 연속 추리 불가');
  // 클래식은 그대로: 맡은 용의자가 지목되면 플레이어가 끌려옴
  const c = G.newGame('mansion', [{ name: 'A', suspect: 0 }, { name: 'B', suspect: 1 }, { name: 'C', suspect: 2 }], 3, { roles: true, bluff: true });
  c.players[0].pos = room; c.players[0].canSuggest = true; c.players[0].fresh = false; c.turn = 0; c.phase = 'act';
  G.act(c, 0, { t: 'suggest', s: 's1', w: 'w0' });
  assert.equal(c.players[1].pos, room); assert.equal(G.allCards(c.map).s.length, 6);
});

test('후던잇 오리지널 비밀 통로: 판마다 서로 먼 방 2쌍, 모서리 대각선 고정 배치 아님, 양방향', () => {
  const kinds = new Set<string>();
  for (let seed = 0; seed < 200; seed++) for (const n of [3, 6, 8]) {
    const g = G.newGame('mansion', Array.from({ length: n }, (_, i) => ({ name: 'P' + i, bot: true })), seed, { roles: true, bluff: true, mode: 'original' });
    const ps = g.map.passages, keys = Object.keys(ps).map(Number);
    assert.equal(keys.length, 4);
    for (const a of keys) { assert.equal(ps[ps[a]], a); assert.ok(a < g.map.roomCount); assert.ok((G.distances(g.map, G.roomPos(a)).get(G.roomPos(ps[a])) ?? 0) >= 10); }
    assert.ok(!(ps[0] === 3 && ps[1] === 2), 'seed ' + seed);
    kinds.add(JSON.stringify(ps));
  }
  assert.ok(kinds.size > 50, '판마다 달라야 함');
  const c = G.newGame('mansion', [{ name: 'A' }, { name: 'B' }, { name: 'C' }], 1);
  assert.deepEqual(c.map.passages, { 0: 3, 3: 0, 1: 2, 2: 1 }, '클래식은 그대로');
});

test('방 문 앞 칸에 다른 말이 있으면 지나갈 수는 있고(한 칸으로 셈) 멈출 수는 없음, 그 밖의 칸은 그대로 막힘', () => {
  const g = G.newGame('mansion', seats(3), 5), m = g.map;
  const d = m.doors.find(x => x.room === 0)!.cell, e = G.neighbors(m, d).find(x => x >= 0)!, room = -(0 + 1);
  g.turn = 0; g.phase = 'move'; g.players[0].pos = e; g.players[1].pos = d;
  g.roll = 1; assert.ok(!G.moves(g, 0).has(room), '문 앞 칸도 한 칸으로 셈: 1로는 못 들어감');
  g.roll = 2; const mv = G.moves(g, 0);
  assert.ok(mv.has(room), '문 앞 칸을 지나 방에 들어감');
  assert.ok(!mv.has(d), '문 앞 칸에서 멈출 수는 없음');
  assert.deepEqual(G.chosenRoute(g, 0, room, [d, room]), [e, d, room]);
  assert.equal(G.chosenRoute(g, 0, d, [d]), null);
  const f = G.neighbors(m, e).find(x => x >= 0 && x !== d && !m.doors.some(o => o.cell === x))!;
  g.players[1].pos = f; g.roll = 6;
  assert.ok(!G.reachable(m, e, 6, G.occupied(g, 0).wall).has(f), '문 앞이 아닌 칸은 그대로 통과 불가');
  assert.equal(G.act(g, 0, { t: 'move', to: room, via: [d, room] }), null);
});

test('후던잇 오리지널 능력 설명: 말만 바뀌고(결론 보고·반증·가설) 클래식은 그대로', () => {
  const o = { mode: 'original' as const }, c = { mode: 'classic' as const };
  assert.match(G.roleDesc('insure', o), /결론 보고/); assert.doesNotMatch(G.roleDesc('insure', o), /최종 고발|탈락/);
  for (const r of Object.keys(G.ROLES) as (keyof typeof G.ROLES)[]) {
    assert.equal(G.roleDesc(r, c), G.ROLES[r].desc); assert.equal(G.roleDesc(r, undefined), G.ROLES[r].desc);
    assert.doesNotMatch(G.roleDesc(r, o), /반박|추리|최종 고발/, r);
  }
});
