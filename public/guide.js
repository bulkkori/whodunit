// 설명서 책 넘기기. PC(넓은 가로 화면) = 두 쪽 펼침 + 책장이 실제로 넘어감, 폰 = 한 쪽씩 옆으로 밀기.
// 쪽 순서: 표지 · 1 · 2 … · 뒷표지(짝수 개). 펼침 모드에서 한 장(leaf)의 앞 = 오른쪽 쪽, 뒤 = 다음 펼침의 왼쪽 쪽.
(() => {
  const book = document.getElementById('book'), pages = [...book.querySelectorAll('.page')];
  const $ = id => document.getElementById(id), out = $('pno');
  const wide = matchMedia('(min-width: 900px) and (min-aspect-ratio: 11/10)');
  wide.addEventListener('change', () => location.reload());
  const total = pages.length - 2; // 표지·뒷표지를 뺀 쪽 수(차례 = 1쪽)
  let go; // go(펼침 번호 또는 쪽 번호)

  if (wide.matches) {
    document.body.classList.add('spread');
    const N = pages.length / 2, leaves = [];
    for (let j = 0; j < N; j++) {
      const leaf = document.createElement('div'); leaf.className = 'leaf';
      const front = pages[2 * j], back = pages[2 * j + 1];
      back.classList.add('back');
      const er = document.createElement('div'); er.className = 'edge r'; er.title = '다음 쪽'; er.onclick = () => show(s + 1); front.append(er);
      const el = document.createElement('div'); el.className = 'edge l'; el.title = '이전 쪽'; el.onclick = () => show(s - 1); back.append(el);
      leaf.append(front, back); book.append(leaf); leaves.push(leaf);
    }
    pages[0].addEventListener('click', () => show(1)); // 표지 아무 데나 누르면 열림
    let s = 0;
    const show = (ns, instant = false) => {
      ns = Math.max(0, Math.min(N, ns)); if (ns === s && !instant) return;
      const forward = ns > s, from = s; s = ns;
      leaves.forEach((leaf, j) => {
        const flip = j < s, moving = forward ? j >= from && j < s : j >= s && j < from;
        if (moving) { leaf.style.zIndex = String(3 * N + (forward ? j : N - j)); leaf.style.transitionDelay = `${Math.abs(j - (forward ? from : from - 1)) * 70}ms`; }
        leaf.classList.toggle('flipped', flip);
        const settle = () => { leaf.style.zIndex = String(flip ? j + 1 : 2 * N - j); leaf.style.transitionDelay = ''; };
        if (moving && !instant) setTimeout(settle, 850 + Math.abs(j - from) * 70); else settle();
      });
      book.classList.toggle('closed-front', s === 0); book.classList.toggle('closed-back', s === N); book.classList.toggle('open', s > 0 && s < N);
      out.textContent = s === 0 ? '표지' : s === N ? '뒷표지' : `${2 * s - 1}–${Math.min(2 * s, total)} / ${total}`;
      $('prev').disabled = $('first').disabled = s === 0; $('next').disabled = s === N;
      history.replaceState(null, '', s ? `#${pages[Math.min(2 * s, pages.length - 1)].id}` : location.pathname);
    };
    go = i => show(Math.ceil(i / 2)); // 쪽 번호 i(표지 = 0)가 보이는 펼침
    $('prev').onclick = () => show(s - 1); $('next').onclick = () => show(s + 1); $('first').onclick = () => show(0);
    addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'PageDown') show(s + 1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(s - 1); else if (e.key === 'Home') show(0); else if (e.key === 'End') show(N); });
    let x0 = null; // 태블릿 가로: 밀어서 넘기기
    book.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
    book.addEventListener('pointerup', e => { if (x0 != null && Math.abs(e.clientX - x0) > 50) show(s + (e.clientX < x0 ? 1 : -1)); x0 = null; });
    show(0, true);
  } else {
    document.body.classList.add('flat');
    const idx = () => Math.round(book.scrollLeft / book.clientWidth);
    const paint = () => { const i = idx(); out.textContent = i === 0 ? '표지' : i === pages.length - 1 ? '뒷표지' : `${i} / ${total}`; $('prev').disabled = $('first').disabled = i === 0; $('next').disabled = i === pages.length - 1; };
    go = i => book.scrollTo({ left: i * book.clientWidth, behavior: 'smooth' });
    book.addEventListener('scroll', () => requestAnimationFrame(paint), { passive: true });
    $('prev').onclick = () => go(idx() - 1); $('next').onclick = () => go(idx() + 1); $('first').onclick = () => go(0);
    addEventListener('keydown', e => { if (e.key === 'ArrowRight') go(idx() + 1); else if (e.key === 'ArrowLeft') go(idx() - 1); });
    paint();
  }

  // 차례·주소의 #쪽 링크
  const jump = id => { const i = pages.findIndex(p => p.id === id); if (i >= 0) go(i); };
  for (const a of document.querySelectorAll('a[href^="#"]')) a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); jump(a.getAttribute('href').slice(1)); });
  if (location.hash) setTimeout(() => jump(location.hash.slice(1)), 50);
})();
