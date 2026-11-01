// PC(마우스) 선택 목록: 운영체제 기본 드롭다운 대신 게임 그림체(종이·잉크) 목록.
// 원래 <select>는 숨겨 둔 채 값·change 이벤트를 그대로 쓰므로 기존 코드는 바뀌지 않는다. 폰·태블릿은 기기 기본 선택기(아이폰 휠)가 더 편해서 그대로.
const fine = matchMedia('(hover: hover) and (pointer: fine)');
let openPop: { close: () => void } | null = null;

function enhance(sel: HTMLSelectElement) {
  if (sel.dataset.fancy || sel.multiple) return;
  sel.dataset.fancy = '1';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'fsel'; btn.setAttribute('aria-haspopup', 'listbox');
  const label = document.createElement('span'); btn.append(label);
  sel.after(btn); sel.classList.add('fsel-native');
  const sync = () => {
    const o = sel.selectedOptions[0]; label.textContent = o?.text ?? '';
    btn.disabled = sel.disabled; btn.title = sel.title; btn.setAttribute('aria-label', sel.getAttribute('aria-label') ?? sel.name ?? '');
  };
  // 코드가 sel.value·selectedIndex·disabled를 바꿔도 보이는 글자가 따라오게
  for (const k of ['value', 'selectedIndex', 'disabled'] as const) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, k)!;
    Object.defineProperty(sel, k, { configurable: true, get() { return d.get!.call(this); }, set(v) { d.set!.call(this, v); sync(); } });
  }
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true });
  sel.addEventListener('change', sync);
  sync();

  btn.onclick = () => {
    if (openPop) { openPop.close(); return; }
    const host = sel.closest('dialog') ?? document.body, ul = document.createElement('ul');
    ul.className = 'fsel-pop'; ul.setAttribute('role', 'listbox');
    let cur = sel.selectedIndex;
    [...sel.options].forEach((o, i) => {
      const li = document.createElement('li'); li.textContent = o.text; li.setAttribute('role', 'option');
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      if (i === sel.selectedIndex) li.setAttribute('aria-selected', 'true');
      li.onmousedown = e => e.preventDefault();
      li.onclick = () => { if (!o.disabled) pick(i); };
      li.onmousemove = () => mark(i);
      ul.append(li);
    });
    const items = [...ul.children] as HTMLElement[];
    const mark = (i: number) => { cur = i; items.forEach((x, k) => x.classList.toggle('hl', k === i)); items[i]?.scrollIntoView({ block: 'nearest' }); };
    const pick = (i: number) => { if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); } close(); btn.focus(); };
    host.append(ul);
    // 버튼 바로 아래(공간이 없으면 위)에, 버튼 폭 이상
    const r = btn.getBoundingClientRect(), below = innerHeight - r.bottom - 8, above = r.top - 8, up = below < 200 && above > below;
    ul.style.minWidth = r.width + 'px'; ul.style.left = Math.min(r.left, innerWidth - Math.max(r.width, ul.offsetWidth) - 8) + 'px';
    ul.style.maxHeight = Math.min(320, up ? above : below) + 'px';
    if (up) ul.style.bottom = innerHeight - r.top + 4 + 'px'; else ul.style.top = r.bottom + 4 + 'px';
    mark(Math.max(0, cur));
    btn.setAttribute('aria-expanded', 'true');
    const key = (e: KeyboardEvent) => {
      const step = (d: number) => { let i = cur; do { i += d; } while (i >= 0 && i < items.length && sel.options[i].disabled); if (i >= 0 && i < items.length) mark(i); };
      if (e.key === 'ArrowDown') step(1); else if (e.key === 'ArrowUp') step(-1);
      else if (e.key === 'Enter' || e.key === ' ') { if (!sel.options[cur]?.disabled) pick(cur); } else if (e.key === 'Escape' || e.key === 'Tab') close(); else return;
      e.preventDefault(); e.stopPropagation();
    };
    const away = (e: Event) => { if (!ul.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) close(); };
    const close = () => {
      ul.remove(); btn.setAttribute('aria-expanded', 'false'); openPop = null;
      removeEventListener('keydown', key, true); removeEventListener('pointerdown', away, true); removeEventListener('resize', close); removeEventListener('scroll', onScroll, true);
    };
    const onScroll = (e: Event) => { if (!ul.contains(e.target as Node)) close(); };
    addEventListener('keydown', key, true); addEventListener('pointerdown', away, true); addEventListener('resize', close); addEventListener('scroll', onScroll, true);
    openPop = { close };
  };
}

/** 지금 있는 선택 목록과 앞으로 화면에 붙는 선택 목록을 모두 바꾼다(PC만) */
export function startFancySelects() {
  if (!fine.matches) return;
  const scan = (n: ParentNode) => n.querySelectorAll?.('select').forEach(s => enhance(s as HTMLSelectElement));
  scan(document);
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(n => { if (n instanceof HTMLSelectElement) enhance(n); else if (n instanceof Element) scan(n); }); })
    .observe(document.body, { childList: true, subtree: true });
}
