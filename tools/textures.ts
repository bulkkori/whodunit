// 그림 자동 반영: 폴더에 이미지(floor-r0.png, wall-hall.png, s0.png, d0.png(오리지널 탐정), w0.png, r0.png, back.png …)를 넣으면 게임용으로 변환해 public/assets/<테마>/에 넣고
// public/assets/manifest.json(테마별로 준비된 텍스처 목록)을 다시 쓴다. 게임은 이 목록에 있는 것만 쓴다(없으면 단색).
// 사용: node tools/textures.ts <원본 폴더> <테마: mansion|atlantis|station> [--watch]
//   --watch: 폴더를 지켜보다가 파일이 바뀌면 자동으로 다시 변환. 하위 폴더(바닥/, 벽/, 카드/)도 포함.
import { execFileSync } from 'node:child_process';
import { readdirSync, watch, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [src, theme] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const THEMES = ['mansion', 'atlantis', 'station'];
if (!src || !THEMES.includes(theme)) { console.error('사용: node tools/textures.ts <원본 폴더> <mansion|atlantis|station> [--watch]'); process.exit(1); }
const out = join(root, 'public/assets', theme);

/** 원본 폴더(하위 폴더 포함)의 모든 텍스처를 변환하고 목록 갱신 */
function run() {
  const dirs = [src, ...readdirSync(src, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(src, d.name))];
  for (const d of dirs) execFileSync('python', ['-I', join(root, 'tools/texprep.py'), d, out], { stdio: 'inherit' });
  writeManifest();
}
export function writeManifest() {
  const m: Record<string, string[]> = {};
  for (const t of THEMES) {
    const dir = join(root, 'public/assets', t);
    if (existsSync(dir)) m[t] = readdirSync(dir).filter(f => /^((floor|wall)-.+|[swrd]\d+|back|thumb)\.webp$/.test(f)).map(f => f.replace('.webp', '')).sort();
  }
  writeFileSync(join(root, 'public/assets/manifest.json'), JSON.stringify(m));
  console.log('목록 갱신:', Object.entries(m).map(([t, l]) => `${t} ${l.length}장`).join(' · '));
}

run();
if (process.argv.includes('--watch')) {
  let t: ReturnType<typeof setTimeout> | undefined;
  watch(src, { recursive: true }, (_, f) => {
    if (!f || !/\.(png|jpe?g|webp)$/i.test(f)) return;
    clearTimeout(t); t = setTimeout(() => { try { run(); } catch (e) { console.error(e); } }, 1500); // 여러 장을 한꺼번에 넣어도 한 번만
  });
  console.log(`👀 ${src} 지켜보는 중 — 이미지를 넣으면 자동 반영 (끝내려면 Ctrl+C)`);
}
