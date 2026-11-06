// 게임 시작 연출: ① 인물·도구·장소 더미를 뒷면으로 섞기 ② 한 장씩 뽑아 사건 봉투에 봉인
// ③ 남은 카드를 모아 섞어 모두에게 같은 장수로 나눠 주기 ④ 남는 카드는 앞면으로 공개 ⑤ 내 특수 능력 공개.
// (내 카드는 연출에서 따로 보여 주지 않음 — 게임 화면에서 바로 보임) 약 12.5초(서버 INTRO_MS와 맞춤), 건너뛰기 가능. 섞기·나눠 주기·뒤집기·봉인에 효과음.
import * as G from '../shared/game.ts';
import { COLORS, cardEl, backEl, asset, factCard } from './art.ts';
import { riffle, flick, step as tap } from './sound.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));


/** 시작 연출. host = 방장이면 건너뛰기 버튼이 '모두 건너뛰기'(onSkipAll로 서버에 알림). 돌려주는 함수 = 연출을 바로 닫기(방장이 건너뛰었을 때) */
export function playIntro(g: G.View, onDone: () => void, host = false, onSkipAll: () => void = () => {}): () => void {
  const T = G.THEMES[g.theme], ov = document.createElement('div');
  ov.id = 'intro';
  const orig = G.isOriginal(g.opts);
  ov.innerHTML = `<div class="ititle"><small>CASE FILE · ${T.name}</small><b>사건 발생</b><span id="istep">${orig ? '사건 개요' : '카드를 섞는 중…'}</span></div>
    <button class="ghost iskip">${host ? '모두 건너뛰기 ⏭' : '건너뛰기 ⏭'}</button><div class="ienv"><span class="flap"></span><i>CONFIDENTIAL</i></div><div class="iopen"></div><div class="iseats"></div>`;
  document.body.append(ov);
  let alive = true;
  const finish = () => { if (!alive) return; alive = false; ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350 }).finished.finally(() => { ov.remove(); onDone(); }); };
  const skip = ov.querySelector('.iskip') as HTMLElement;
  skip.onclick = () => { if (host) onSkipAll(); finish(); };
  if (host) skip.title = '방장이 건너뛰면 모두의 화면에서 함께 넘어가요';
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
    // ①(오리지널) 사건 개요: 카드가 나오기 전, 가운데에 사건 한 줄(판 번호로 골라 모두에게 같은 문장) + 소집. 약 2.7초(서버 대기 시간에 포함)
    if (orig) {
      const p = document.createElement('p'); p.className = 'icasecard';
      p.append(G.caseLine(g.theme, g.seed), document.createElement('br'), document.createElement('br'), '수사가 막히자 본부는 외부 탐정들을 소집했다.');
      ov.append(p);
      await p.animate([{ opacity: 0, transform: 'translate(-50%,-40%)' }, { opacity: 1, transform: 'translate(-50%,-50%)' }], { duration: 500, easing: 'ease-out' }).finished;
      await sleep(1900); if (!alive) return;
      await p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished; p.remove();
      step('카드를 섞는 중…');
    }
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
    // ②-1 오리지널: 수사본부 게시판 — 담당 용의자 배정 + 본부장의 세 조건
    if (G.isOriginal(g.opts)) {
      step('수사본부 게시판 — 담당 용의자 배정');
      const D = G.DETECTIVES[g.theme], me = g.players[g.me], art = asset(g.theme, 's' + me.suspect), dArt = asset(g.theme, 'd' + me.suspect); // dArt = 내 탐정 그림(있으면 작은 얼굴)
      const card = document.createElement('div'); card.className = 'irole assign';
      card.innerHTML = `<small>수사본부 게시판 · 담당 배정</small>
        <div class="aface" style="--c:${COLORS[me.suspect]}">${art ? `<img src="${art}" alt="">` : `<span>${T.s[me.suspect].split(' ').pop()![0]}</span>`}</div>
        <b>${T.s[me.suspect]}</b><p>${dArt ? `<img class="adimg" src="${dArt}" alt="" style="--c:${COLORS[me.suspect]}">` : ''}탐정 <strong>${D[me.suspect].name}</strong>(나)의 담당 용의자<br><span class="asub">담당은 조사를 맡긴다는 뜻일 뿐, 결백의 보증이 아니다</span></p>
        <ul class="aothers"></ul>
        <ol class="aterms"><li><b>입회</b>검증에 담당 용의자가 불려 가면 담당 탐정도 입회</li><li><b>반증</b>가설과 어긋나는 사실 하나를 그 탐정에게만</li><li><b>보고</b>결론 보고는 단 한 번 · 틀려도 반증은 계속</li></ol><em>배정</em>`;
      const ul = card.querySelector('.aothers') as HTMLElement;
      g.players.forEach((p, j) => { if (j === g.me) return; const li = document.createElement('li'); li.innerHTML = `<i style="background:${COLORS[p.suspect]}"></i><span></span>`; (li.querySelector('span') as HTMLElement).textContent = `${D[p.suspect].name} → ${T.s[p.suspect]}`; ul.append(li); });
      ov.append(card); flick();
      await card.animate([{ transform: 'translate(-50%,-50%) rotateY(90deg) scale(.8)', opacity: 0 }, { transform: 'translate(-50%,-50%)', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.3,1.3,.5,1)' }).finished;
      await sleep(350); if (!alive) return;
      card.classList.add('stamped'); tap(true);
      await sleep(4600); if (!alive) return;
      await card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished; card.remove();
    }
    // ③ 모아서 섞고 나눠 주기
    step(orig ? '첫날 밤, 탐정들이 각자 확인한 것들' : '남은 카드를 모아 섞어서 나눠 줍니다');
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
      step(orig ? '본부 회의에서 공유된 사실 — 봉투에 없는 카드입니다' : '나누고 남은 카드는 모두에게 공개 — 봉투에 없는 카드입니다');
      const box = ov.querySelector('.iopen') as HTMLElement; box.classList.add('on');
      for (const c of g.open) { flick(); const e = factCard(g.theme, g.opts, c, '', true); e.animate([{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { duration: 400 }); box.append(e); await sleep(300); }
      await sleep(700);
    }
    // ⑤ 능력 카드 안내: 안내장이 뒤집히며 도장 '쿵' (시작할 때 가진 카드는 없음 — 보너스칸에서 뽑음)
    if (g.opts.roles) {
      step('능력 카드');
      const open = ov.querySelector('.iopen') as HTMLElement; // 공개 카드는 접고 안내장만
      if (open.childElementCount) await open.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished;
      const card = document.createElement('div'); card.className = 'irole';
      card.innerHTML = '<small></small><i></i><b></b><p></p><span></span><em>안내</em>';
      const [sm, ic, nm, ds, us] = ['small', 'i', 'b', 'p', 'span'].map(t => card.querySelector(t) as HTMLElement);
      sm.textContent = '특수 능력'; ic.textContent = '🎴'; nm.textContent = '능력 카드';
      ds.textContent = `보너스칸(❗)에 멈추면 능력 카드 ${G.ROLE_IDS.length}종 중 1장을 무작위로 뽑아요. 최대 ${G.MAX_ITEMS}장까지 들고 있다가, 내 차례에 1장씩 낼 수 있어요.`;
      us.textContent = G.ROLE_IDS.map(k => G.ROLES[k].icon).join(' ');
      ov.append(card); flick();
      await card.animate([{ transform: 'translate(-50%,-50%) rotateY(90deg) scale(.8)', opacity: 0 }, { transform: 'translate(-50%,-50%)', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.3,1.3,.5,1)' }).finished;
      await sleep(350); if (!alive) return;
      card.classList.add('stamped'); tap(true);
      await sleep(4200); // 안내장은 약 5초 보여 줌
    }
    finish();
  })();
  return finish;
}
