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
    g.fillStyle = hallPat ?? col('--hall', '#2b2430'); // 보너스칸은 매판 무작위라 미리보기에 그리지 않음
    g.fillRect(x, y, c - 1, c - 1);
    if (hallPat) { g.strokeStyle = 'rgba(255,236,205,.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, c - 2, c - 2); } // 게임처럼 칸 테두리
  }
  const room = col('--room', '#3d2b35');
  const labels: (() => void)[] = [];
  const rect = (q: G.Rect, fill: string | CanvasPattern, label: string, accent = false) => {
    const x = q.x0 * c + 1, y = q.y0 * c + 1, w = (q.x1 - q.x0 + 1) * c - 2, h = (q.y1 - q.y0 + 1) * c - 2;
    g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, 4); g.fill();
    if (typeof fill !== 'string') { g.fillStyle = '#0004'; g.fill(); } // 텍스처 위 글자가 읽히게 살짝 어둡게
    if (accent) { g.strokeStyle = col('--accent', '#d98a6a'); g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); }
    labels.push(() => { // 벽을 그린 뒤 벽 안쪽에 이름을 쓴다
      const ww = Math.max(2, c * 0.22);
      g.fillStyle = accent ? col('--accent', '#d98a6a') : '#e8dfe9cc';
      g.font = `600 ${Math.max(9, Math.min(13, c * 0.62))}px system-ui, "Malgun Gothic", sans-serif`;
      g.textBaseline = 'top'; g.shadowColor = '#000'; g.shadowBlur = 3; g.fillText(label, x + ww + 3, y + ww + 2, w - ww * 2 - 6); g.shadowBlur = 0;
    });
  };
  m.rects.forEach((q, i) => rect(q, pat(floorTex(theme, i)) ?? mix(room, ROOM_TINTS[i % ROOM_TINTS.length], 0.28), T.r[i]));
  rect(m.center, pat(floorTex(theme, 'center')) ?? mix(room, col('--accent', '#d98a6a'), 0.14), '🗂️ 사건 파일', true);
  // 벽 두께: 방 둘레를 두꺼운 선으로, 문 자리는 틈
  const ww = Math.max(2, c * 0.22), wallC = col('--wall', '#8f7a58'), doorC = col('--door', '#5a4a40');
  [...m.rects, m.center].forEach((q, room) => {
    const x = q.x0 * c, y = q.y0 * c, w = (q.x1 - q.x0 + 1) * c, h = (q.y1 - q.y0 + 1) * c;
    g.strokeStyle = '#000b'; g.lineWidth = ww + 2; g.strokeRect(x + ww / 2, y + ww / 2, w - ww, h - ww);
    g.strokeStyle = wallC; g.lineWidth = ww; g.strokeRect(x + ww / 2, y + ww / 2, w - ww, h - ww);
    g.fillStyle = doorC;
    for (const d of m.doors) {
      if (d.room !== room) continue;
      const dx = d.cell % m.n, dy = Math.floor(d.cell / m.n);
      if (dy < q.y0) g.fillRect(dx * c, y, c, ww); else if (dy > q.y1) g.fillRect(dx * c, y + h - ww, c, ww);
      else if (dx < q.x0) g.fillRect(x, dy * c, ww, c); else g.fillRect(x + w - ww, dy * c, ww, c);
    }
  });
  labels.forEach(f => f());
}

/** 미리보기 아래 요약: 방 수 · 보드 크기 · 1인당 카드 · 공개 카드 · 보너스칸 */
export function mapSummary(theme: G.ThemeKey, count: number, note = ''): HTMLElement[] {
  const n = Math.min(G.MAX_PLAYERS, Math.max(3, count)), m = G.genMap(n), T = G.THEMES[theme];
  const total = 2 * m.people + m.roomCount - 3, per = Math.floor(total / n), open = total - per * n;
  const items = [`${T.icon} ${T.name}`, `${n}명 기준${note ? ' · ' + note : ''}`, `방 ${m.roomCount}개 + 사건 파일실`, `보드 ${m.n}×${m.n}`,
    `1인당 카드 ${per}장` + (open ? ` · 공개 ${open}장` : ''), `보너스칸 ${m.bonus.length}개 (매판 무작위)`];
  return items.map(t => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = t; return s; });
}

function mix(a: string, b: string, t: number) {
  const p = (h: string) => { const v = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)); };
  if (!a.startsWith('#') || !b.startsWith('#')) return a;
  const A = p(a), B = p(b);
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`;
}
