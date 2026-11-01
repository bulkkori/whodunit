// 주사위 소리 — 음원 파일 없이 Web Audio로 합성.
// 딸깍 = 짧은 잡음을 대역 필터로 걸러 빠르게 줄인 것, 쿵 = 낮은 사인파가 뚝 떨어지는 것.

let ctx: AudioContext | null = null, master: GainNode | null = null, noise: AudioBuffer | null = null;
let muted = (() => { try { return localStorage.getItem('wd_mute') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('wd_mute', m ? '1' : '0'); } catch { /* 저장 불가 무시 */ }
  if (master) master.gain.value = m ? 0 : 0.8;
}

/** 브라우저 자동재생 정책 때문에 사용자 입력(탭·클릭) 안에서 한 번 불러야 소리가 난다 */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function click(at: number, vol: number, pitch: number) {
  if (!ctx || !master || !noise) return;
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = pitch; bp.Q.value = 2.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0008, at + 0.05);
  src.connect(bp).connect(g).connect(master);
  src.start(at); src.stop(at + 0.08);
}

function thud(at: number, vol: number) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(170, at); o.frequency.exponentialRampToValueAtTime(55, at + 0.09);
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0008, at + 0.12);
  o.connect(g).connect(master);
  o.start(at); o.stop(at + 0.13);
}

/** 버튼을 누르고 있는 동안 손안에서 달그락. 반환값을 호출하면 멈춘다 */
export function rattle(): () => void {
  unlock();
  let alive = true;
  const tick = () => {
    if (!alive || !ctx) return;
    const t = ctx.currentTime;
    click(t, 0.18 + Math.random() * 0.12, 2200 + Math.random() * 1800);
    if (Math.random() < 0.5) click(t + 0.02, 0.12, 2600 + Math.random() * 1500);
    setTimeout(tick, 55 + Math.random() * 70);
  };
  tick();
  return () => { alive = false; };
}

/**
 * 판에 떨어짐. impacts = 지금부터 몇 초 뒤에 부딪히는지(첫 낙하가 가장 큼).
 * 주사위 두 개라 살짝 어긋나게 두 번씩 치고, 마지막엔 굴러가는 잔 딸깍임을 붙인다.
 */
export function land(impacts: number[]) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  impacts.forEach((s, k) => {
    const v = Math.max(0.12, 1 - k * 0.32);
    for (const off of [0, 0.018 + Math.random() * 0.03]) {
      thud(now + s + off, 0.55 * v);
      click(now + s + off, 0.9 * v, 1500 + Math.random() * 900);
    }
  });
  const end = impacts[impacts.length - 1];
  for (let i = 0; i < 5; i++) click(now + end - 0.25 + i * 0.05 + Math.random() * 0.02, 0.12, 2800 + Math.random() * 1500);
}
