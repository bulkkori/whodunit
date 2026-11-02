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

/**
 * 브라우저 자동재생 정책 때문에 사용자 입력 안에서 불러야 소리가 난다.
 * iOS 사파리는 '손을 뗄 때(touchend·click)'만 인정하고, 무음 스위치가 켜져 있으면 웹 오디오도 꺼진다.
 * → audioSession을 playback으로(게임 소리는 🔇 버튼으로 끔), 깨운 직후 무음 소리를 한 번 재생해 확실히 연다.
 */
export function unlock() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession && nav.audioSession.type !== 'playback') { try { nav.audioSession.type = 'playback'; } catch { /* 미지원 */ } }
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') {
    void ctx.resume();
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); // iOS 잠금 해제용 무음
  }
  playMusic();
}
export const isRunning = () => ctx?.state === 'running';

// ---------- 배경음악 ----------
// Web Audio로 반복: mp3 + 반복 지점(bgm.json의 loopStart·loopEnd, 마디 단위)으로 도입부는 한 번, 그 뒤는 끊김 없이 반복.
// (<audio loop>는 mp3 끝에 짧은 틈이 생겨서 쓰지 않음.) json이 없으면 곡 전체를 틈 없이 반복.
export type MusicMode = 'on' | 'off';
let musicMode: MusicMode = (() => { try { return localStorage.getItem('wd_music') === 'off' ? 'off' : 'on'; } catch { return 'on'; } })();
let musicBuf: AudioBuffer | null = null, musicMeta: { loopStart: number; loopEnd: number } | null = null;
let musicSrc: AudioBufferSourceNode | null = null, musicGain: GainNode | null = null, musicLoading = false;
export const getMusic = () => musicMode;
export function setMusic(m: MusicMode) {
  musicMode = m;
  try { localStorage.setItem('wd_music', m); } catch { /* 저장 불가 무시 */ }
  playMusic();
}
/** 사용자 입력 안에서(unlock 뒤) 불러야 소리가 난다 — unlock()에서 함께 호출 */
export function playMusic() {
  if (!ctx) return;
  if (musicMode === 'off') { musicSrc?.stop(); musicSrc = null; return; }
  if (musicSrc) return;
  if (!musicBuf) {
    if (musicLoading) return;
    musicLoading = true;
    const c = ctx;
    Promise.all([
      fetch('/audio/bgm.mp3').then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b)),
      fetch('/audio/bgm.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([buf, meta]) => { musicBuf = buf; musicMeta = meta; musicLoading = false; playMusic(); })
      .catch(() => { musicLoading = false; });
    return;
  }
  musicGain ??= (() => { const g = ctx.createGain(); g.gain.value = 0.32; g.connect(ctx.destination); return g; })();
  const src = ctx.createBufferSource();
  src.buffer = musicBuf; src.loop = true;
  if (musicMeta && musicMeta.loopEnd > musicMeta.loopStart) { src.loopStart = musicMeta.loopStart; src.loopEnd = Math.min(musicMeta.loopEnd, musicBuf.duration); }
  src.connect(musicGain); src.start();
  musicSrc = src;
  (window as unknown as { __music?: AudioBufferSourceNode }).__music = src; // 확인용
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
  if (ctx && ctx.state !== 'running') void ctx.resume();
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

/** 알림 종소리. turn = 내 차례(도-솔 올라감), refute = 반박 차례(같은 음 두 번, 조금 더 급하게) */
export function chime(kind: 'turn' | 'refute') {
  if (ctx && ctx.state !== 'running') void ctx.resume();
  if (!ctx || !master || ctx.state !== 'running') return;
  const notes = kind === 'turn' ? [[0, 659.3], [0.14, 987.8]] : [[0, 880], [0.16, 880]];
  for (const [at, f] of notes) {
    const t = ctx.currentTime + at, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2.01; // 배음 하나 → 종소리 느낌
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g); g.connect(master);
    o.start(t); o2.start(t); o.stop(t + 0.95); o2.stop(t + 0.95);
  }
}

/** 말 걸음: 나무 말이 판에 톡 닿는 소리. last = 도착(조금 더 묵직) */
export function step(last = false) {
  if (ctx && ctx.state !== 'running') void ctx.resume();
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  click(t, last ? 0.32 : 0.2, (last ? 900 : 1300) + Math.random() * 350);
  thud(t, last ? 0.32 : 0.14);
}

/** 카드 섞기(리플): 종이가 촤라락 — 짧은 잡음 딸깍을 빽빽하게 깔고 가운데가 가장 촘촘·크게, 끝에 모아서 '탁' */
export function riffle(dur = 0.42) {
  if (ctx && ctx.state !== 'running') void ctx.resume();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime, n = Math.round(dur * 75);
  for (let i = 0; i < n; i++) {
    const x = i / n, env = Math.sin(Math.PI * x);
    click(now + x * dur + Math.random() * 0.006, 0.04 + 0.14 * env, 3000 + Math.random() * 3000);
  }
  click(now + dur + 0.02, 0.22, 1100 + Math.random() * 300);
}

/** 카드 한 장 휙(나눠 주기·뒤집기) */
export function flick() {
  if (ctx && ctx.state !== 'running') void ctx.resume();
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  click(t, 0.1, 4200 + Math.random() * 1500);
  click(t + 0.014, 0.06, 2400 + Math.random() * 800);
}
