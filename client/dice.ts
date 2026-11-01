// 2D 보드용 주사위 연출: CSS 3D 정육면체 두 개가 화면 앞쪽(크게)에서 판 위로 떨어져 튀고 굴러 멈춘다.
// 최종 자세는 항상 "앞면이 보는 사람 쪽"이고, 앞면에 나온 눈을 그려 넣는다 — 회전 계산 없이 결과를 맞추는 방법.
import { land } from './sound.ts';

/** 3×3 칸 중 점이 찍히는 자리(1~9) */
const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

/** 앞=v, 뒤=7-v, 나머지 두 쌍은 옆·위아래 — 실제 주사위처럼 마주보는 면 합이 7 */
export function faceValues(v: number): Record<'front' | 'back' | 'right' | 'left' | 'top' | 'bottom', number> {
  const [a, b] = [1, 2, 3].filter(x => x !== v && x !== 7 - v);
  return { front: v, back: 7 - v, right: a, left: 7 - a, top: b, bottom: 7 - b };
}

function face(cls: string, v: number) {
  const f = document.createElement('div'); f.className = 'face ' + cls;
  for (let k = 1; k <= 9; k++) { const i = document.createElement('i'); if (!PIPS[v].includes(k)) i.style.visibility = 'hidden'; f.append(i); }
  return f;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** power 0~1: 길게 누를수록 높이·회전이 커진다. 멈추는 순간 resolve, 주사위는 잠시 남았다가 사라진다. */
export async function throwDice2D(board: HTMLElement, dice: [number, number], power: number): Promise<void> {
  board.querySelector('.dice2d')?.remove();
  const layer = document.createElement('div'); layer.className = 'dice2d';
  board.append(layer);
  const T = 900 + power * 500;
  land([0.42, 0.7, 1.0].map(f => (f * T) / 1000)); // 아래 키프레임에서 판에 닿는 순간들
  const anims: Animation[] = [];
  dice.forEach((v, k) => {
    if (!v) return; // 첫 출발은 주사위 1개
    const wrap = document.createElement('div'); wrap.className = 'dwrap';
    const shadow = document.createElement('div'); shadow.className = 'dshadow';
    const die = document.createElement('div'); die.className = 'die';
    for (const [cls, val] of Object.entries(faceValues(v))) die.append(face(cls, val));
    wrap.append(shadow, die); layer.append(wrap);
    const side = dice[1] === 0 ? (Math.random() < 0.5 ? -1 : 1) : k === 0 ? -1 : 1, x0 = side * (40 + Math.random() * 60), y0 = -140 - power * 80;
    const s0 = 2.2 + power * 0.8;
    anims.push(wrap.animate([
      { transform: `translate(${x0}%, ${y0}%) scale(${s0})`, offset: 0, easing: 'cubic-bezier(.5,0,1,.6)' },
      { transform: `translate(${x0 * 0.3}%, 0) scale(1)`, offset: 0.42, easing: 'ease-out' },
      { transform: `translate(${x0 * 0.15}%, -10%) scale(1.16)`, offset: 0.56, easing: 'ease-in' },
      { transform: `translate(${x0 * 0.05}%, 0) scale(1)`, offset: 0.7, easing: 'ease-out' },
      { transform: 'translate(0, -3%) scale(1.05)', offset: 0.8, easing: 'ease-in' },
      { transform: 'translate(0, 0) scale(1)', offset: 1 },
    ], { duration: T, fill: 'forwards' }));
    anims.push(shadow.animate([
      { opacity: 0, transform: 'scale(.4)' }, { opacity: 0.55, transform: 'scale(1)', offset: 0.42 }, { opacity: 0.55, transform: 'scale(1)' },
    ], { duration: T, fill: 'forwards' }));
    const spins = 1 + Math.round(power * 2), rx = 360 * spins + 90 * Math.floor(Math.random() * 4), ry = 360 * spins * side + 90 * Math.floor(Math.random() * 4);
    anims.push(die.animate([
      { transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${Math.random() * 180}deg)` },
      { transform: 'rotateX(0) rotateY(0) rotateZ(0)' },
    ], { duration: T, easing: 'cubic-bezier(.15,.6,.25,1)', fill: 'forwards' }));
  });
  await Promise.all(anims.map(a => a.finished.catch(() => {})));
  // 결과를 보여 준 뒤 사라짐 (다음 굴림이 오면 위에서 즉시 교체)
  void sleep(1600).then(() => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => layer.remove(), () => layer.remove()));
}
