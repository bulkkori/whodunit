// 카드·말 그림. 카드 그림(s0·w0·r0·back 등)이 manifest에 있으면 그림을, 없으면 색·이모지로 그린 기본 그림을 쓴다.
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
export const floorTex = (theme: string, k: number | 'center' | 'hall') => texUrl(theme, 'floor', k);
/** 벽 텍스처(가로로 이어지는 2:1 띠). 방 벽 안쪽 면 = 방 번호/'center', 바깥쪽 면 = 'hall' */
export const wallTex = (theme: string, k: number | 'center' | 'hall') => texUrl(theme, 'wall', k);
function texUrl(theme: string, kind: 'floor' | 'wall', k: number | 'center' | 'hall') {
  return asset(theme, `${kind}-${typeof k === 'number' ? 'r' + k : k}`);
}
export const asset = (theme: string, name: string) => (TEX[theme]?.includes(name) ? `/assets/${theme}/${name}.webp` : null);
export const TEX_CELLS = 3;
export const ROOM_TINTS = ['#8a5a44', '#4f6b8a', '#6b7a4a', '#7a4f6b', '#8a7a44', '#4a7a73', '#80604a', '#5a5a8a', '#8a4f4f', '#4f7a55', '#76648a'];
const KIND: Record<G.Kind, string> = { s: '인물', w: '도구', r: '장소' };

/** 인물 카드 아이콘은 그 인물 말과 같은 색·글자 */
export const suspectLetter = (theme: G.ThemeKey, i: number) => G.THEMES[theme].s[i].split(' ').pop()![0];

const KIND_ICON: Record<G.Kind, string> = { s: '👤', w: '🗡️', r: '🚪' };
const el = (tag: string, cls: string, text = '') => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };

/**
 * 카드 앞면: 양피지 바탕 + 종류 색 이중 테두리 + 위 종류 띠 + 그림 창 + 이름 리본.
 * 크기는 CSS 너비만 정하면 안쪽은 카드 너비 비율(cqw)로 맞춰진다.
 */
export function cardEl(theme: G.ThemeKey, id: G.Card, cls = ''): HTMLElement {
  const k = id[0] as G.Kind, n = +id.slice(1);
  const c = el('div', `gcard k-${k} ${cls}`);
  const band = el('div', 'gc-band'); band.append(el('i', '', KIND_ICON[k]), el('span', '', KIND[k]));
  const art = el('div', 'gc-art'), url = asset(theme, id);
  if (k === 's') art.style.setProperty('--tone', COLORS[n]);
  if (k === 'r') {
    art.style.setProperty('--tone', ROOM_TINTS[n % ROOM_TINTS.length]);
    const f = floorTex(theme, n); if (f && !url) art.style.setProperty('--floor', `url(${f})`); // 그림이 없으면 그 방 바닥
  }
  if (url) { const im = document.createElement('img'); im.src = url; im.alt = ''; im.loading = 'lazy'; art.append(im); art.classList.add('has-img'); }
  else art.append(el('span', 'gc-ph', k === 's' ? suspectLetter(theme, n) : k === 'w' ? WEAPON_ICON[theme][n] : floorTex(theme, n) ? '' : '🚪'));
  c.append(band, art, el('div', 'gc-name', G.cardName(theme, id)));
  return c;
}

/** 카드 뒷면: 그림(back.webp)이 있으면 그것, 없으면 금색 마름모 격자 + 가운데 문장 */
export function backEl(theme: G.ThemeKey, cls = ''): HTMLElement {
  const c = el('div', 'cback ' + cls), url = asset(theme, 'back');
  if (url) { c.style.backgroundImage = `url(${url})`; c.classList.add('has-img'); }
  else c.append(el('span', 'cb-emblem', '?'));
  return c;
}
