// 게임 시작 연출: ① 인물·도구·장소 더미를 뒷면으로 섞기 ② 한 장씩 뽑아 사건 봉투에 봉인
// ③ 남은 카드를 모아 섞어 모두에게 같은 장수로 나눠 주기 ④ 남는 카드는 앞면으로 공개 ⑤ 내 특수 능력 공개.
// (내 카드는 연출에서 따로 보여 주지 않음 — 게임 화면에서 바로 보임) 약 12.5초(서버 INTRO_MS와 맞춤), 건너뛰기 가능. 섞기·나눠 주기·뒤집기·봉인에 효과음.
import * as G from '../shared/game.ts';
import { COLORS, cardEl, backEl } from './art.ts';
import { riffle, flick, step as tap } from './sound.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));


export function playIntro(g: G.View, onDone: () => void) {
  const T = G.THEMES[g.theme], ov = document.createElement('div');
  ov.id = 'intro';
  ov.innerHTML = `<div class="ititle"><small>CASE FILE · ${T.name}</small><b>사건 발생</b><span id="istep">카드를 섞는 중…</span></div>
    <button class="ghost iskip">건너뛰기 ⏭</button><div class="ienv"><span class="flap"></span><i>CONFIDENTIAL</i></div><div class="iopen"></div><div class="iseats"></div>`;
  document.body.append(ov);
  let alive = true;
  const finish = () => { if (!alive) return; alive = false; ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350 }).finished.finally(() => { ov.remove(); onDone(); }); };
  (ov.querySelector('.iskip') as HTMLElement).onclick = finish;
  const step = (t: string) => { (ov.querySelector('#istep') as HTMLElement).textContent = t; };

  const W = () => ov.clientWidth, H = () => ov.clientHeight;
  const put = (el: HTMLElement, x: number, y: number) => { el.style.left = x + 'px'; el.style.top = y + 'px'; ov.append(el); return el; };
  const fly = (el: HTMLElement, x: number, y: number, ms: number, extra: Keyframe = {}) => {
    const r0 = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    const a = el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${x - r0.x}px, ${y - r0.y}px)`, ...extra }], { duration: ms, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    return a.finished.then(() => { el.style.left = x + 'px'; el.style.top = y + 'px'; a.cancel(); });
  };

  // 자리 표시
  const seatsBox = ov.querySelector('.iseats') as HTMLElement, counts: HTMLElement[] = [];
  g.players.forEach((p, j) => {
    const s = document.createElement('div'); s.className = 'iseat' + (j === g.me ? ' me' : '');
    s.innerHTML = `<i style="background:${COLORS[p.suspect]}"></i><span></span><b>0</b>`;
    (s.querySelector('span') as HTMLElement).textContent = j === g.me ? '나' : p.name;
    seatsBox.append(s); counts.push(s.querySelector('b') as HTMLElement);
  });

  (async () => {
    await sleep(50);
    const all = G.allCards(g.map), piles: HTMLElement[][] = [];
    // 카드 크기 = 화면에 맞춰(세 더미가 겹치지 않는 폭, 높이의 13%, 60~120px)
    const CW = Math.round(Math.max(60, Math.min(120, W() * 0.2, H() * 0.13))), CH = CW * 1.4;
    ov.style.setProperty('--icw', CW + 'px');
    const px = [W() * 0.25, W() * 0.5, W() * 0.75], py = H() * 0.42;
    (['s', 'w', 'r'] as const).forEach((k, n) => {
      const lab = document.createElement('div'); lab.className = 'ilab'; lab.textContent = ({ s: '인물', w: '도구', r: '장소' })[k];
      put(lab, px[n] - CW / 2, py + CH / 2 + 14);
      piles.push(all[k].slice(0, 6).map((_, m) => put(backEl(g.theme), px[n] - CW / 2 + m, py - CH / 2 - m)));
    });
    // ① 섞기
    for (let round = 0; round < 3 && alive; round++) {
      riffle(0.4);
      await Promise.all(piles.flat().map((c, m) => c.animate([
        { transform: 'translate(0,0) rotate(0)' },
        { transform: `translate(${(m % 2 ? 1 : -1) * (14 + Math.random() * 10)}px, ${-6 + Math.random() * 12}px) rotate(${(m % 2 ? 1 : -1) * 8}deg)` },
        { transform: 'translate(0,0) rotate(0)' }], { duration: 420, easing: 'ease-in-out' }).finished));
    }
    if (!alive) return;
    // ② 봉투로
    step('인물 · 도구 · 장소 한 장씩 사건 봉투에 봉인');
    const env = ov.querySelector('.ienv') as HTMLElement, er = env.getBoundingClientRect(), orr = ov.getBoundingClientRect();
    const ex = er.left - orr.left + er.width / 2 - CW / 2, ey = er.top - orr.top + er.height / 2 - CH / 2; // 작아지며(.4배) 봉투 가운데로
    for (const pile of piles) { const c = pile.pop()!; await fly(c, ex, ey, 420, { transform: `translate(${ex - parseFloat(c.style.left)}px, ${ey - parseFloat(c.style.top)}px) scale(.4)` }); c.remove(); if (!alive) return; }
    env.classList.add('sealed'); tap(true); // 봉인 '쿵'
    await sleep(500); if (!alive) return;
    // ③ 모아서 섞고 나눠 주기
    step('남은 카드를 모아 섞어서 나눠 줍니다');
    ov.querySelectorAll('.ilab').forEach(l => l.remove());
    const rest = piles.flat(), cx = W() / 2 - CW / 2, cy = py - CH / 2;
    await Promise.all(rest.map((c, m) => fly(c, cx + (m % 4), cy - (m % 6), 450)));
    riffle(0.48);
    await Promise.all(rest.map((c, m) => c.animate([{ transform: 'rotate(0)' }, { transform: `rotate(${m % 2 ? 10 : -10}deg)` }, { transform: 'rotate(0)' }], { duration: 500 }).finished));
    if (!alive) return;
    const per = g.players[0].handCount, n = g.players.length, total = per * n, gap = Math.min(120, 2600 / Math.max(total, 1));
    const seatEls = [...seatsBox.children] as HTMLElement[];
    for (let k = 0; k < total && alive; k++) {
      const j = k % n, sr = seatEls[j].getBoundingClientRect(), c = put(backEl(g.theme, 'mini'), cx + CW / 4, cy + CH / 4);
      flick();
      void fly(c, sr.left - orr.left + sr.width / 2 - CW / 4, sr.top - orr.top - CH / 2, 380).then(() => { c.remove(); counts[j].textContent = String(+counts[j].textContent! + 1); });
      await sleep(gap);
    }
    rest.forEach(c => c.remove());
    await sleep(400); if (!alive) return;
    // ④ 남는 카드는 앞면으로 공개
    if (g.open.length) {
      step('나누고 남은 카드는 모두에게 공개 — 봉투에 없는 카드입니다');
      const box = ov.querySelector('.iopen') as HTMLElement; box.classList.add('on');
      for (const c of g.open) { flick(); const e = cardEl(g.theme, c); e.animate([{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { duration: 400 }); box.append(e); await sleep(300); }
      await sleep(700);
    }
    // ⑤ 내 특수 능력: 수사 임명장이 뒤집히며 도장 '쿵'
    const me = g.players[g.me];
    if (g.opts.roles && me.role) {
      const R = G.ROLES[me.role];
      step('이번 사건에서 내가 맡은 특수 능력');
      const open = ov.querySelector('.iopen') as HTMLElement; // 공개 카드는 접고 임명장만
      if (open.childElementCount) await open.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished;
      const card = document.createElement('div'); card.className = 'irole';
      card.innerHTML = '<small></small><i></i><b></b><p></p><span></span><em>임명</em>';
      const [sm, ic, nm, ds, us] = ['small', 'i', 'b', 'p', 'span'].map(t => card.querySelector(t) as HTMLElement);
      sm.textContent = `${R.group} · 특수 능력`; ic.textContent = R.icon; nm.textContent = R.name; ds.textContent = R.desc;
      us.textContent = `❗ 보너스칸에 멈추면 사용 · ${me.uses ?? 0}회`;
      ov.append(card); flick();
      await card.animate([{ transform: 'translate(-50%,-50%) rotateY(90deg) scale(.8)', opacity: 0 }, { transform: 'translate(-50%,-50%)', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.3,1.3,.5,1)' }).finished;
      await sleep(350); if (!alive) return;
      card.classList.add('stamped'); tap(true);
      await sleep(4200); // 임명장은 약 5초 보여 줌
    }
    finish();
  })();
}
