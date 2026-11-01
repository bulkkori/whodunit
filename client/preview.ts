// 방 만들기·대기실의 맵 미리보기: 실제 보드 평면도를 작은 캔버스에 그린다(같은 인원이면 게임 보드와 똑같음).
import * as G from '../shared/game.ts';
import { ROOM_TINTS, floorTex, TEX_CELLS } from './art.ts';

// 바닥 텍스처 이미지: 한 번만 불러오고, 다 받아지면 onTexReady로 등록한 함수(미리보기 다시 그리기)를 부른다
const imgs = new Map<string, HTMLImageElement>(), ready: (() => void)[] = [];
export const onTexReady = (f: () => void) => { ready.push(f); };
function img(url: string | null) {
  if (!url) return null;
  let im = imgs.get(url);
  if (!im) { im = new Image(); im.src = url; im.onload = () => ready.forEach(f => f()); imgs.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}

export function drawMapPreview(cv: HTMLCanvasElement, theme: G.ThemeKey, count: number) {
  const m = G.genMap(Math.min(G.MAX_PLAYERS, Math.max(3, count))), T = G.THEMES[theme];
  const css = getComputedStyle(document.body), col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
  const size = Math.min(cv.clientWidth || 320, cv.clientHeight || 9999) || 320, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = cv.height = Math.round(size * dpr);
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = size / m.n;
  g.fillStyle = col('--bg', '#17131a'); g.fillRect(0, 0, size, size);
  // 텍스처가 있으면 패턴(한 장 = 3×3칸, 캔버스 원점 기준이라 칸끼리 이어짐), 없으면 단색
  const pat = (url: string | null) => {
    const im = img(url); if (!im) return null;
    const p = g.createPattern(im, 'repeat')!; p.setTransform(new DOMMatrix().scale((c * TEX_CELLS) / im.naturalWidth)); return p;
  };
  const hallPat = pat(floorTex(theme, 'hall'));
  for (let i = 0; i < m.n * m.n; i++) if (m.cells[i] === -1) {
    const x = (i % m.n) * c + 0.5, y = Math.floor(i / m.n) * c + 0.5;
    g.fillStyle = m.bonus.includes(i) ? '#6b5326' : hallPat ?? col('--hall', '#2b2430');
    g.fillRect(x, y, c - 1, c - 1);
    if (hallPat && !m.bonus.includes(i)) { g.strokeStyle = 'rgba(255,236,205,.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, c - 2, c - 2); } // 게임처럼 칸 테두리
  }
  const room = col('--room', '#3d2b35');
  const rect = (q: G.Rect, fill: string | CanvasPattern, label: string, accent = false) => {
    const x = q.x0 * c + 1, y = q.y0 * c + 1, w = (q.x1 - q.x0 + 1) * c - 2, h = (q.y1 - q.y0 + 1) * c - 2;
    g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, 4); g.fill();
    if (typeof fill !== 'string') { g.fillStyle = '#0004'; g.fill(); } // 텍스처 위 글자가 읽히게 살짝 어둡게
    if (accent) { g.strokeStyle = col('--accent', '#d98a6a'); g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); }
    g.fillStyle = accent ? col('--accent', '#d98a6a') : '#e8dfe9cc';
    g.font = `600 ${Math.max(9, Math.min(13, c * 0.62))}px system-ui, "Malgun Gothic", sans-serif`;
    g.textBaseline = 'top'; g.shadowColor = '#000'; g.shadowBlur = 3; g.fillText(label, x + 4, y + 3, w - 8); g.shadowBlur = 0;
  };
  m.rects.forEach((q, i) => rect(q, pat(floorTex(theme, i)) ?? mix(room, ROOM_TINTS[i % ROOM_TINTS.length], 0.28), T.r[i]));
  rect(m.center, pat(floorTex(theme, 'center')) ?? mix(room, col('--accent', '#d98a6a'), 0.14), '🗂️ 사건 파일', true);
  g.fillStyle = col('--door', '#5a4a40');
  for (const d of m.doors) { g.beginPath(); g.arc((d.cell % m.n + 0.5) * c, (Math.floor(d.cell / m.n) + 0.5) * c, c * 0.22, 0, Math.PI * 2); g.fill(); }
}

/** 미리보기 아래 요약: 방 수 · 보드 크기 · 1인당 카드 · 공개 카드 · 보너스칸 */
export function mapSummary(theme: G.ThemeKey, count: number, note = ''): HTMLElement[] {
  const n = Math.min(G.MAX_PLAYERS, Math.max(3, count)), m = G.genMap(n), T = G.THEMES[theme];
  const total = 2 * m.people + m.roomCount - 3, per = Math.floor(total / n), open = total - per * n;
  const items = [`${T.icon} ${T.name}`, `${n}명 기준${note ? ' · ' + note : ''}`, `방 ${m.roomCount}개 + 사건 파일실`, `보드 ${m.n}×${m.n}`,
    `1인당 카드 ${per}장` + (open ? ` · 공개 ${open}장` : ''), `보너스칸 ${m.bonus.length}개`];
  return items.map(t => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = t; return s; });
}

function mix(a: string, b: string, t: number) {
  const p = (h: string) => { const v = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)); };
  if (!a.startsWith('#') || !b.startsWith('#')) return a;
  const A = p(a), B = p(b);
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`;
}
