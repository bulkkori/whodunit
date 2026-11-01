// 카드·말 그림 — 지금은 이모지와 색. Gemini 그림이 들어오면 cardEl 안의 아이콘 자리만 <img>로 바꾸면 된다.
import * as G from '../shared/game.ts';

export const COLORS = ['#ef6b6b', '#f4b942', '#6cc570', '#5ec8e5', '#b78af0', '#e9e4da'];
export const WEAPON_ICON: Record<G.ThemeKey, string[]> = {
  mansion:  ['🍵', '🏹', '🪞', '💊', '🗿', '🔥'],
  atlantis: ['🔱', '🪼', '🦪', '🗡️', '🔮', '🐙'],
  station:  ['⚡', '💳', '🧫', '🔧', '☣️', '🔓'],
};
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
