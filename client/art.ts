// 카드·말 그림 — 지금은 이모지와 색. Gemini 그림이 들어오면 cardEl 안의 아이콘 자리만 <img>로 바꾸면 된다.
import * as G from '../shared/game.ts';

export const COLORS = ['#ef6b6b', '#f4b942', '#6cc570', '#5ec8e5', '#b78af0', '#e9e4da', '#f08acb', '#a7b0bb'];
export const WEAPON_ICON: Record<G.ThemeKey, string[]> = {
  mansion:  ['🍵', '🏹', '🪞', '💊', '🗿', '🔥', '🍾', '📌'],
  atlantis: ['🔱', '🪼', '🦪', '🗡️', '🔮', '🐙', '🪸', '🎣'],
  station:  ['⚡', '💳', '🧫', '🔧', '☣️', '🔓', '☢️', '🦾'],
};
/** 방 바닥 색조(방마다 조금씩 다르게 — 평면도처럼 구분되게) */
/** 준비된 텍스처 목록(tools/textures.ts가 만드는 public/assets/manifest.json). 없는 것은 지금처럼 단색 */
let TEX: Record<string, string[]> = {};
export const loadTexManifest = () =>
  fetch('/assets/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).then(m => { TEX = m; }).catch(() => {});
/** 방 번호(0~), 'center', 'hall' → 바닥 텍스처 주소 또는 null. 텍스처 한 장 = 3×3칸 */
export const floorTex = (theme: string, k: number | 'center' | 'hall') => {
  const name = `floor-${typeof k === 'number' ? 'r' + k : k}`;
  return TEX[theme]?.includes(name) ? `/assets/${theme}/${name}.webp` : null;
};
export const TEX_CELLS = 3;
export const ROOM_TINTS = ['#8a5a44', '#4f6b8a', '#6b7a4a', '#7a4f6b', '#8a7a44', '#4a7a73', '#80604a', '#5a5a8a', '#8a4f4f', '#4f7a55', '#76648a'];
const KIND: Record<G.Kind, string> = { s: '인물', w: '흉기', r: '장소' };

/** 인물 카드 아이콘은 그 인물 말과 같은 색·글자 */
export const suspectLetter = (theme: G.ThemeKey, i: number) => G.THEMES[theme].s[i].split(' ').pop()![0];

export function cardEl(theme: G.ThemeKey, id: G.Card, cls = ''): HTMLElement {
  const k = id[0] as G.Kind, n = +id.slice(1);
  const c = document.createElement('div'); c.className = `gcard k-${k} ${cls}`;
  const kind = document.createElement('span'); kind.className = 'gk'; kind.textContent = KIND[k];
  const icon = document.createElement('span'); icon.className = 'gi';
  if (k === 's') { icon.textContent = suspectLetter(theme, n); icon.style.background = COLORS[n]; icon.classList.add('face'); }
  else icon.textContent = k === 'w' ? WEAPON_ICON[theme][n] : '🚪';
  const name = document.createElement('span'); name.className = 'gn'; name.textContent = G.cardName(theme, id);
  c.append(kind, icon, name);
  return c;
}
