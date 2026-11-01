// 화면 글자 속 이모지를 직접 그린 선 아이콘(SVG)으로 바꾼다.
// 글자색(currentColor)을 따라가서 종이 위에선 잉크색, 어두운 곳에선 밝은색. 기기마다 다른 이모지 모양 대신 게임 고유의 한 가지 그림체.
// 새 글자가 화면에 붙을 때마다(MutationObserver) 그 안의 이모지만 찾아 바꾼다. 선택 목록(option)·입력칸·추리 노트 표시(✓✗)·말은 건드리지 않음.

const P: Record<string, string> = {
  // 행동
  '🎲': '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
  '🔎': '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  '⏭': '<path d="M5 6l7 6-7 6z" fill="currentColor" fill-opacity=".2"/><path d="M12 6l7 6-7 6z" fill="currentColor" fill-opacity=".2"/><path d="M20 5.5v13"/>',
  '⚖': '<path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-2.5 6a3 3 0 0 0 5 0z"/><path d="M19 7l-2.5 6a3 3 0 0 0 5 0z"/>',
  '🕳': '<ellipse cx="12" cy="15" rx="8" ry="3.5" fill="currentColor" fill-opacity=".25"/><path d="M8 15V9M12 15V6.5M16 15V9"/><path d="M6.5 9h3M10.5 6.5h3M14.5 9h3"/>',
  '🚪': '<path d="M5 20.5V4.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16"/><path d="M3 20.5h18"/><circle cx="15" cy="12.5" r="1" fill="currentColor"/>',
  '🗂': '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5h-8L9.5 5h-5A1.5 1.5 0 0 0 3 6.5z"/><path d="M3 11h18"/>',
  '🃏': '<rect x="3.5" y="5" width="11" height="15" rx="1.8" transform="rotate(-8 9 12.5)"/><rect x="9.5" y="4" width="11" height="15" rx="1.8" fill="currentColor" fill-opacity=".15"/><path d="M15 9.5v5M12.5 12h5"/>',
  '🙅': '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  '❗': '<path d="M12 4.5v10"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  '❌': '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  '✅': '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  '✔': '<path d="M5 12.5l4.5 4.5L19 7"/>',
  '⏰': '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2"/><path d="M4 5.5l3-2.5M20 5.5l-3-2.5"/>',
  '⏳': '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M7.5 3.5c0 5 9 5 9 8.5s-9 3.5-9 8.5M16.5 3.5c0 5-9 5-9 8.5s9 3.5 9 8.5"/>',
  '✋': '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11.5V5a1.5 1.5 0 0 1 3 0v6.5M14 11.5V6.5a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.5a5.5 5.5 0 0 1-4.6-2.5L3.6 14a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>',
  '💡': '<path d="M9 17.5h6M10 20.5h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z"/>',
  '📍': '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" fill="currentColor" fill-opacity=".15"/><circle cx="12" cy="10" r="2.3"/>',
  // 사람·상태
  '🤖': '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="3.8" r="1"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/><path d="M2.5 12.5v3M21.5 12.5v3"/>',
  '👑': '<path d="M4 17.5L3 7.5l5 4 4-6 4 6 5-4-1 10z" fill="currentColor" fill-opacity=".18"/><path d="M4 20.5h16"/>',
  '👤': '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  '🕶': '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  '🕵': '<path d="M3.5 13h17"/><path d="M6 13l1.5-7a1.5 1.5 0 0 1 1.8-1.1L12 5.5l2.7-.6a1.5 1.5 0 0 1 1.8 1.1L18 13" fill="currentColor" fill-opacity=".18"/><circle cx="8.5" cy="17.5" r="2.3"/><circle cx="15.5" cy="17.5" r="2.3"/><path d="M10.8 17.5h2.4"/>',
  '🎭': '<path d="M3.5 5.5c3 1.2 6 1.2 9 0v6a4.5 4.5 0 0 1-9 0z"/><path d="M6 10h.01M10 10h.01"/><path d="M6.5 13.5c1.2-.8 2.8-.8 4 0"/><path d="M14.5 9c2 .6 4 .6 6-.5v5.5a4.5 4.5 0 0 1-7.4 3.4"/><path d="M16.5 12.5h.01M19 12h.01"/>',
  '🎙': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5M8.5 21h7"/>',
  '🎧': '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
  '🛡': '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" fill="currentColor" fill-opacity=".15"/>',
  '🚫': '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  // 능력
  '🔦': '<path d="M3.5 9.5l7-7 4 4-7 7z" fill="currentColor" fill-opacity=".15"/><path d="M11.5 11.5l3 3M14.5 14.5l2 6 4-4z"/>',
  '🗝': '<circle cx="7.5" cy="12" r="4"/><path d="M11.5 12h9.5M17.5 12v3.5M20.5 12v2.5"/>',
  '🚓': '<path d="M4.5 9.5c1.5 0 2.5 1 2.5 2.5S6 14.5 4.5 14.5"/><path d="M9 6.5c2 .3 3 1.8 3 3.5s-1.2 3-3 3.3"/><path d="M14.5 10.5c1.5 0 2.5 1 2.5 2.5s-1 2.5-2.5 2.5M18.5 15.5c1.3.2 2 1.2 2 2.5"/>',
  // 물건·화면
  '✉': '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  '📒': '<path d="M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6z"/><path d="M6 3.5v17M3.5 7.5h4M3.5 12h4M3.5 16.5h4M10 8h6M10 11.5h6"/>',
  '📜': '<path d="M7 4.5h11.5v12.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-1.5h12.5V17a3 3 0 0 0 3 3"/><path d="M7 4.5a2.5 2.5 0 0 0-2.5 2.5v8.5"/><path d="M10 8.5h5.5M10 12h5.5"/>',
  '⚙': '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  '🗺': '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  '☕': '<path d="M4 9h12v6a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 4 15z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>',
  '🔗': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  '🗡': '<path d="M20.5 3.5l-9 9M20.5 3.5L19 8l-6.5 6.5M20.5 3.5L16 5l-6.5 6.5"/><path d="M8 13l3 3M6.5 17.5l2-2M4 20l2.5-2.5"/>',
  '🏚': '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/><path d="M16 6V3.5h2V8"/>',
  '🌊': '<path d="M2.5 9c2.4 0 2.4-2 4.75-2s2.35 2 4.75 2 2.4-2 4.75-2 2.35 2 4.75 2"/><path d="M2.5 14c2.4 0 2.4-2 4.75-2s2.35 2 4.75 2 2.4-2 4.75-2 2.35 2 4.75 2"/><path d="M2.5 19c2.4 0 2.4-2 4.75-2s2.35 2 4.75 2 2.4-2 4.75-2 2.35 2 4.75 2"/>',
  '🚀': '<path d="M12 2.5c3.5 2.5 5 6 5 10l-2.5 3.5h-5L7 12.5c0-4 1.5-7.5 5-10z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M7 12.5l-3 3v3l4-1.5M17 12.5l3 3v3l-4-1.5M10.5 19l1.5 2.5 1.5-2.5"/>',
};
// 변형 이모지(같은 그림): ✗·✓는 추리 노트 표시라 제외
const ALIAS: Record<string, string> = { '🔍': '🔎' };

const KEYS = [...Object.keys(P), ...Object.keys(ALIAS)].sort((a, b) => b.length - a.length);
const RE = new RegExp(`(${KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\uFE0F?`, 'gu');
const SKIP = 'svg,select,option,textarea,input,script,style,#memo,.tok,.gc-ph,#board .wtok,[data-noicon]';

export function iconSvg(e: string, cls = '') {
  const k = ALIAS[e] ?? e;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
}

const tpl = document.createElement('template');
function fixText(t: Text) {
  const s = t.data; RE.lastIndex = 0;
  if (!RE.test(s)) return;
  const p = t.parentElement; if (!p || p.closest(SKIP)) return;
  RE.lastIndex = 0;
  tpl.innerHTML = s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)).replace(RE, (_, e: string) => iconSvg(e));
  t.replaceWith(tpl.content);
}
function walk(n: Node) {
  if (n.nodeType === 3) return fixText(n as Text);
  if (n.nodeType !== 1 || (n as Element).matches(SKIP)) return;
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT), list: Text[] = [];
  for (let x = w.nextNode(); x; x = w.nextNode()) list.push(x as Text);
  list.forEach(fixText);
}

/** 문서 전체를 한 번 바꾸고, 이후 붙는 글자도 계속 바꾼다 */
export function startIcons() {
  walk(document.body);
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'characterData') fixText(m.target as Text);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
