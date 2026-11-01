// 3D 보드 뷰. 3D를 처음 켤 때만 동적 import되므로(esbuild가 별도 청크로 분리) 2D 사용자는 three.js를 받지 않는다.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as G from '../shared/game.ts';
import { faceValues } from './dice.ts';
import { WEAPON_ICON, ROOM_TINTS, floorTex, wallTex, TEX_CELLS } from './art.ts';
import { land } from './sound.ts';

interface Palette { bg: number; base: number; hall: number; door: number; room: number; wall: number; center: number; label: string }
const PAL: Record<G.ThemeKey, Palette> = {
  mansion:  { bg: 0x17131a, base: 0x231a1f, hall: 0x3a2f2a, door: 0x8a6a48, room: 0x5a3440, wall: 0xc9b38a, center: 0x7a4a2e, label: '#f3e3c4' },
  atlantis: { bg: 0x0d1a20, base: 0x0f2229, hall: 0x1d3c45, door: 0x3f8f8a, room: 0x1f5562, wall: 0x9fe0d6, center: 0x2f6f80, label: '#d9fbf6' },
  station:  { bg: 0x12141b, base: 0x161b25, hall: 0x2a3140, door: 0x5a7bb0, room: 0x2f3d5c, wall: 0xb8c6e0, center: 0x4a5a80, label: '#e6eeff' },
};
const CAN = 0xd9b24a, BONUS = 0x9a7428;
const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
const noPick = (o: THREE.Object3D) => { o.raycast = () => {}; };
// 바닥 텍스처: 주소별로 한 번만 불러옴. 반복(타일) 설정
const texLoader = new THREE.TextureLoader(), texCache = new Map<string, THREE.Texture>();
function loadTex(url: string) {
  let t = texCache.get(url);
  if (!t) { t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; texCache.set(url, t); }
  return t;
}
/** 벽 면용: 월드 좌표로 가로 = 벽을 따라 이어지게, 세로 = 바닥에서부터(벽이 낮아지면 걸레받이만 보임). 높이 0.9 = 그림 세로 전체 */
function wallUV(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vec4 wpw = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vMapUv = vec2((wpw.x + wpw.z) / 1.8, (wpw.y - 0.05) / 0.9);
#endif`);
  };
  return m;
}
/** 복도 칸(InstancedMesh)용: 칸마다 UV 대신 월드 좌표로 텍스처를 깔아 3×3칸에 한 장이 끊김 없이 이어지게 */
function worldUV(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz / ${TEX_CELLS.toFixed(1)};
#endif
vCellXZ = position.xz;`).replace('void main() {', 'varying vec2 vCellXZ;\nvoid main() {');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec2 vCellXZ;\nvoid main() {');
    // 칸 색이 4배로 들어오면(강조 칸) 어두운 텍스처에 곱하지 않고 그 색을 주로 칠한다 — 경로·보너스·문이 잘 보이게
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  if (max(vColor.r, max(vColor.g, vColor.b)) > 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb / 4.0, 0.72);
  else diffuseColor.rgb *= vColor.rgb;
#endif
  // 칸 테두리: 가장자리 쪽을 밝은 선으로(한 칸 = -0.47~0.47)
  float edge = smoothstep(0.37, 0.43, max(abs(vCellXZ.x), abs(vCellXZ.y)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.45), edge * 0.55);`);
  };
  return m;
}

/** 새긴 "!" 텍스처: 테두리 홈 + 글자 홈(조명 방향에 맞춘 빛·그림자) + 금 상감 */
let engraved: THREE.CanvasTexture | null = null;
function engraveTex() {
  if (engraved) return engraved;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const carve = (draw: (dx: number, dy: number) => void) => {
    // 해는 보드 오른쪽 아래(+x,+z)에서 비춤 → 홈의 오른쪽 아래는 턱에 가려 그림자, 왼쪽 위 안벽은 빛을 받음
    x.fillStyle = x.strokeStyle = 'rgba(255,236,205,.35)'; draw(-2, -2);
    x.fillStyle = x.strokeStyle = 'rgba(0,0,0,.8)'; draw(2, 2);
  };
  x.lineWidth = 5;
  carve((dx, dy) => { x.beginPath(); x.roundRect(10 + dx, 10 + dy, 108, 108, 12); x.stroke(); });
  x.font = 'bold 92px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  carve((dx, dy) => x.fillText('!', 64 + dx, 68 + dy));
  const gold = x.createLinearGradient(0, 20, 0, 110); gold.addColorStop(0, '#8a6a2a'); gold.addColorStop(1, '#d9b25a');
  x.lineWidth = 3; x.strokeStyle = gold; x.beginPath(); x.roundRect(10, 10, 108, 108, 12); x.stroke();
  x.fillStyle = gold; x.fillText('!', 64, 68);
  engraved = new THREE.CanvasTexture(c); engraved.colorSpace = THREE.SRGBColorSpace; engraved.anisotropy = 8;
  return engraved;
}

interface RoomData { p: G.Pos; cx: number; cz: number; w: number; h: number }
type RoomMesh = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> & { userData: RoomData };

function label(text: string, color: string, w: number) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  let fs = 100; const F = () => `bold ${fs}px system-ui, "Malgun Gothic", sans-serif`;
  g.font = F(); while (g.measureText(text).width > 470 && fs > 30) { fs -= 4; g.font = F(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = '#000a'; g.strokeText(text, 256, 64);
  g.fillStyle = color; g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.order = 'YXZ'; m.rotation.x = -Math.PI / 2; noPick(m); // 라벨은 클릭 대상 아님. y 회전은 카메라 방향에 맞춰 매 프레임
  m.userData.label = true;
  return m;
}

export interface Board3D {
  update(g: G.View, moves: Set<G.Pos>): void; start(): void; stop(): void; resetView(): void;
  /** 다음 update 때 보드를 새로 만든다(텍스처 목록이 바뀌었을 때) */
  rebuild(): void;
  /** 이동 경로 미리보기: cells를 칠한다(ok면 노랑, 아니면 빨강). 빈 배열이면 지움 */
  preview(cells: G.Pos[], ok: boolean): void;
  /** 카메라가 이 칸들이 다 보이게 부드럽게 다가감. null이면 처음 시점으로 */
  focus(cells: G.Pos[] | null): void;
  /** 주사위 두 개를 판 위로 떨어뜨린다. 멈추는 순간 resolve. power 0~1 */
  throwDice(d: [number, number], power: number): Promise<void>;
}

// 주사위 면 텍스처(눈 1~6), 한 번만 만든다
const PIP_XY: Record<number, [number, number][]> = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
let pipMats: THREE.MeshStandardMaterial[] | null = null;
function dieMaterials() {
  return (pipMats ??= [1, 2, 3, 4, 5, 6].map(v => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = v === 1 ? '#b3262b' : '#1c1a1f';
    for (const [x, y] of PIP_XY[v]) { g.beginPath(); g.arc(32 + x * 32, 32 + y * 32, v === 1 ? 15 : 11, 0, Math.PI * 2); g.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  }));
}
const easeOutBounce = (x: number) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
interface Throw {
  mesh: THREE.Mesh; t0: number; T: number; h: number; from: THREE.Vector3; to: THREE.Vector3;
  qEnd: THREE.Quaternion; axis: THREE.Vector3; spin: number; settled: boolean; done: () => void;
}

export function createBoard3D(container: HTMLElement, colors: string[], onPick: (p: G.Pos) => void,
  onHover: (p: G.Pos | null, x: number, y: number) => void = () => {},
  onTap: (p: G.Pos, x: number, y: number, touch: boolean) => void = () => {}): Board3D {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  // 자동 시점 이동 목표(손으로 돌리기 시작하면 취소)
  let camGoal: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;
  controls.addEventListener('start', () => { camGoal = null; });
  Object.assign(controls, { enableDamping: true, maxPolarAngle: 1.25, minDistance: 5, maxDistance: 45 });
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x202030, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  scene.add(sun);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: CAN }));
  ring.rotation.x = -Math.PI / 2; noPick(ring); scene.add(ring);

  let board: THREE.Group | null = null, key: string | null = null, n = 0;
  let map: G.GameMap | null = null, P: Palette = PAL.mansion;
  let hallTint = 0xffffff, hallMesh: THREE.InstancedMesh | null = null, hallIdx: number[] = [], roomMeshes: RoomMesh[] = [];
  let pawns: THREE.Group[] = [], npcPawns: (THREE.Group | null)[] = [], env: THREE.Group | null = null, weaponSprites: THREE.Sprite[] = [];
  const wx = (x: number) => x - n / 2 + 0.5; // 칸 좌표 → 월드 좌표
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  // 벽(심즈식 컷어웨이): 카메라 쪽을 향한 벽은 걸레받이 높이로 내려가 방 안이 보인다
  const WALL_H = 0.9, WALL_LOW = 0.08;
  // 벽 한 조각 = 길이 1.04 · 두께 0.08 상자. 로컬 +z 면이 방 바깥(복도 벽), -z 면이 방 안쪽(그 방 벽)을 보도록 돌려 놓는다
  let wallMeshes: THREE.InstancedMesh[] = [], walls: { x: number; z: number; nx: number; nz: number; h: number; mesh: THREE.InstancedMesh; idx: number }[] = [];

  function build(g: G.View) {
    if (board) {
      scene.remove(board);
      board.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat()) { const mp = (m as THREE.MeshBasicMaterial).map; if (mp && ![...texCache.values()].includes(mp)) mp.dispose(); m.dispose(); } // 바닥 텍스처는 캐시에 두고 재사용
      });
    }
    const B = (board = new THREE.Group()); scene.add(B);
    const M = (map = g.map); n = M.n; P = PAL[g.theme];
    const T = G.THEMES[g.theme];
    scene.background = new THREE.Color(P.bg);
    const base = new THREE.Mesh(new THREE.BoxGeometry(n + 1, 0.4, n + 1), mat(P.base));
    base.position.y = -0.25; base.receiveShadow = true; noPick(base); B.add(base);

    hallIdx = M.cells.flatMap((c, i) => (c === -1 ? [i] : []));
    const hallUrl = floorTex(g.theme, 'hall');
    hallTint = hallUrl ? 0xc8c8c8 : P.hall;
    const hmat = mat(0xffffff); if (hallUrl) { hmat.map = loadTex(hallUrl); worldUV(hmat); }
    const hm = (hallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.94, 0.08, 0.94), hmat, hallIdx.length));
    hallIdx.forEach((i, k) => { m4.makeTranslation(wx(i % n), 0, wx(Math.floor(i / n))); hm.setMatrixAt(k, m4); hm.setColorAt(k, col.set(hallTint)); });
    hm.receiveShadow = true; B.add(hm);

    roomMeshes = [];
    [...M.rects, M.center].forEach((q, i) => {
      const w = q.x1 - q.x0 + 1, h = q.y1 - q.y0 + 1, cx = (wx(q.x0) + wx(q.x1)) / 2, cz = (wx(q.y0) + wx(q.y1)) / 2;
      const isC = i === M.roomCount;
      const tone = isC ? new THREE.Color(P.center) : new THREE.Color(P.room).lerp(new THREE.Color(ROOM_TINTS[i % ROOM_TINTS.length]), 0.3);
      const fu = floorTex(g.theme, isC ? 'center' : i), fm = mat(fu ? 0xbdbdbd : tone.getHex());
      const fg = new THREE.BoxGeometry(w - 0.06, 0.12, h - 0.06);
      if (fu) { fm.map = loadTex(fu); const uv = fg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / TEX_CELLS, uv.getY(k) * h / TEX_CELLS); } // 텍스처 한 장 = 3×3칸
      const f = new THREE.Mesh(fg, fm) as RoomMesh;
      f.position.set(cx, 0.02, cz); f.receiveShadow = true; f.userData = { p: G.roomPos(i), cx, cz, w, h };
      B.add(f); roomMeshes.push(f);
      const lb = label(isC ? '사건 파일' : T.r[i], P.label, Math.min(w - 0.15, 3.2));
      lb.position.set(cx, 0.1, isC ? cz + h / 2 - 0.7 : cz); B.add(lb);
      if (M.passages[i] !== undefined) {
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        hole.rotation.x = -Math.PI / 2; noPick(hole);
        hole.position.set(i % 2 ? wx(q.x0) + 0.1 : wx(q.x1) - 0.1, 0.09, i < 2 ? wx(q.y1) - 0.1 : wx(q.y0) + 0.1);
        B.add(hole);
      }
    });

    // 벽: 방 칸 둘레를 따라, 문 자리는 비움. 방마다 InstancedMesh 1개(안쪽 면 텍스처가 방마다 다름)
    walls = []; wallMeshes = [];
    const segsByRoom = new Map<number, { x: number; z: number; nx: number; nz: number }[]>();
    for (let i = 0; i < n * n; i++) {
      const r = M.cells[i]; if (r === -1) continue;
      const x = i % n, y = Math.floor(i / n);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy, inside = X >= 0 && Y >= 0 && X < n && Y < n, nb = inside ? Y * n + X : -1;
        if (inside && M.cells[nb] === r) continue;
        if (M.doors.some(d => d.room === r && d.cell === nb)) continue;
        if (!segsByRoom.has(r)) segsByRoom.set(r, []);
        segsByRoom.get(r)!.push({ x: wx(x) + dx / 2, z: wx(y) + dy / 2, nx: dx, nz: dy }); // n = 방 밖을 향한 방향
      }
    }
    const cap = mat(P.wall, { roughness: 0.6 }), wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const face = (url: string | null) => url ? wallUV(Object.assign(mat(0xd8d8d8, { roughness: 0.8 }), { map: loadTex(url) })) : cap;
    const outer = face(wallTex(g.theme, 'hall'));
    for (const [r, segs] of segsByRoom) {
      const inner = face(wallTex(g.theme, r === M.roomCount ? 'center' : r));
      // BoxGeometry 면 순서: +x, -x, +y, -y, +z(바깥), -z(안쪽)
      const wm = new THREE.InstancedMesh(wallGeo, [cap, cap, cap, cap, outer, inner], segs.length);
      segs.forEach((s, idx) => { const w = { ...s, h: WALL_H, mesh: wm, idx }; walls.push(w); setWall(w); });
      wm.castShadow = wm.receiveShadow = true; noPick(wm); B.add(wm); wallMeshes.push(wm);
    }

    const c = roomMeshes[roomMeshes.length - 1].userData;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.35, 24), mat(0x2a2024));
    ped.position.set(c.cx, 0.25, c.cz - 0.3); ped.castShadow = true; noPick(ped); B.add(ped);
    const E = (env = new THREE.Group());
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.42), mat(0xf2ead8, { roughness: 0.9 }));
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), mat(0xb3262b, { roughness: 0.4 }));
    seal.position.y = 0.025; E.add(paper, seal); E.position.set(c.cx, 0.55, c.cz - 0.3);
    E.traverse(noPick); B.add(E);

    const geo = { body: new THREE.CylinderGeometry(0.12, 0.2, 0.42, 20), head: new THREE.SphereGeometry(0.12, 20, 14) };
    const makePawn = (suspect: number, ghost = false) => {
      const grp = new THREE.Group(), m = mat(new THREE.Color(colors[suspect]).getHex(), { roughness: 0.35, metalness: 0.1, transparent: ghost, opacity: ghost ? 0.45 : 1 });
      const body = new THREE.Mesh(geo.body, m), head = new THREE.Mesh(geo.head, m);
      body.position.y = 0.21; head.position.y = 0.5; body.castShadow = head.castShadow = true;
      grp.add(body, head); grp.traverse(noPick); B.add(grp);
      grp.userData.target = null;
      return grp;
    };
    pawns = g.players.map(p => makePawn(p.suspect));
    npcPawns = g.npc.map((pos, v) => (pos == null ? null : makePawn(v, true)));
    // 보너스칸 "!": 바닥에 새긴 모양(음각 + 금 상감) — 칸 위에 붙인 얇은 판. 새긴 것이므로 카메라를 따라 돌지 않음
    const engr = engraveTex();
    for (const b of M.bonus) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: engr, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0.3 }));
      d.rotation.x = -Math.PI / 2;
      d.position.set(wx(b % n), 0.045, wx(Math.floor(b / n))); noPick(d); B.add(d);
    }
    // 흉기 말: 이모지 스프라이트(항상 카메라를 향함)
    weaponSprites = WEAPON_ICON[g.theme].map(icon => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d')!;
      x.fillStyle = '#000a'; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill();
      x.font = '84px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(icon, 64, 70);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
      sp.scale.set(0.75, 0.75, 0.75); sp.userData.target = null; noPick(sp); B.add(sp);
      return sp;
    });
    sun.position.set(n * 0.4, n * 1.1, n * 0.6);
    fit();
  }

  const q0 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  function setWall(w: (typeof walls)[number]) {
    q0.setFromAxisAngle(yAxis, Math.atan2(w.nx, w.nz)); // 로컬 +z → 바깥 방향
    m4.compose(v3.set(w.x, 0.05 + w.h / 2, w.z), q0, s3.set(1.04, w.h, 0.08)); w.mesh.setMatrixAt(w.idx, m4);
  }
  /** 카메라가 바라보는 방향(수평)으로 바깥을 향한 벽 = 시야를 가리는 벽 → 낮춤. 높이는 부드럽게 바뀜 */
  function updateWalls(dt: number) {
    if (!walls.length) return;
    const cx = camera.position.x - controls.target.x, cz = camera.position.z - controls.target.z, l = Math.hypot(cx, cz) || 1;
    const changed = new Set<THREE.InstancedMesh>();
    walls.forEach(w => {
      const goal = (w.nx * cx + w.nz * cz) / l > 0.3 ? WALL_LOW : WALL_H;
      if (Math.abs(w.h - goal) < 0.002) return;
      w.h += (goal - w.h) * Math.min(1, dt * 10); if (Math.abs(w.h - goal) < 0.002) w.h = goal;
      setWall(w); changed.add(w.mesh);
    });
    for (const m of changed) m.instanceMatrix.needsUpdate = true;
    // 방 이름이 카메라를 돌려도 거꾸로 보이지 않게, 바닥에 누운 채 카메라 쪽으로 돌림
    const az = Math.atan2(cx, cz);
    board?.children.forEach(o => { if (o.userData.label) o.rotation.y = az; });
  }

  function fit() {
    const v = THREE.MathUtils.degToRad(camera.fov) / 2, h = Math.atan(Math.tan(v) * camera.aspect);
    const d = (n * (camera.aspect > 1.2 ? 0.52 : 0.66)) / Math.sin(Math.min(v, h)); // 가로로 긴 칸(폰 4:3)은 더 가까이, 정사각형은 앞쪽 모서리가 넓게 보여서 조금 멀리
    camera.position.set(0, d * 0.78, d * 0.62); controls.target.set(0, 0, 0); controls.update();
  }

  function posOf(pos: G.Pos, slot: number, total: number) {
    if (pos >= 0) return new THREE.Vector3(wx(pos % n), 0.08, wx(Math.floor(pos / n)));
    const u = roomMeshes[G.roomOf(pos)].userData, a = (slot / Math.max(total, 1)) * Math.PI * 2;
    const rx = Math.min(0.8, u.w / 2 - 0.35), rz = Math.min(0.5, u.h / 2 - 0.35);
    return new THREE.Vector3(u.cx + (total > 1 ? Math.cos(a) * rx : 0), 0.08, u.cz + 0.2 + (total > 1 ? Math.sin(a) * rz : 0));
  }

  let can = new Set<G.Pos>(), turn = -1, pathSet = new Set<G.Pos>(), pathOk = true;
  function paintHalls() {
    const M = map!, hm = hallMesh!;
    const boost = hallTint === P.hall ? 1 : 4; // 텍스처 복도: 4배 = 강조 표시(셰이더가 텍스처 대신 이 색을 칠함)
    hallIdx.forEach((i, k) => {
      const c = pathSet.has(i) ? (pathOk ? CAN : 0xb5483f) : M.bonus.includes(i) && boost === 1 ? BONUS : M.doors.some(d => d.cell === i) ? P.door : null;
      hm.setColorAt(k, c == null ? col.set(hallTint) : col.set(c).multiplyScalar(boost));
    });
    if (hm.instanceColor) hm.instanceColor.needsUpdate = true;
  }
  function preview(cells: G.Pos[], ok: boolean) {
    if (!hallMesh) return;
    pathSet = new Set(cells); pathOk = ok; paintHalls();
    for (const r of roomMeshes) r.material.emissive.set(pathSet.has(r.userData.p) ? (ok ? 0x6a5410 : 0x5a1410) : 0x000000);
  }
  function placeWeapons(g: G.View) {
    const byRoom = new Map<number, number[]>();
    g.weapons.forEach((room, k) => byRoom.set(room, [...(byRoom.get(room) ?? []), k]));
    g.weapons.forEach((room, k) => {
      const u = roomMeshes[room].userData, list = byRoom.get(room)!, slot = list.indexOf(k);
      const t = new THREE.Vector3(u.cx + (slot - (list.length - 1) / 2) * 0.7, 0.55, u.cz - Math.min(0.6, u.h / 2 - 0.4));
      const sp = weaponSprites[k]; if (!sp.userData.target) sp.position.copy(t);
      sp.userData.target = t;
    });
  }
  function update(g: G.View, moves: Set<G.Pos>) {
    if (key !== g.seed + g.theme) { key = g.seed + g.theme; build(g); }
    const M = map!, hm = hallMesh!;
    can = moves; turn = g.phase === 'over' ? -1 : g.turn;
    paintHalls();
    if (hm.instanceColor) hm.instanceColor.needsUpdate = true;
    placeWeapons(g);
    for (const r of roomMeshes) r.material.emissive.set(pathSet.has(r.userData.p) ? (pathOk ? 0x6a5410 : 0x5a1410) : 0x000000);
    const groups = new Map<G.Pos, number[]>();
    g.players.forEach((p, j) => { if (p.pos != null) groups.set(p.pos, [...(groups.get(p.pos) ?? []), j]); });
    g.npc.forEach((pos, v) => { if (pos != null) groups.set(pos, [...(groups.get(pos) ?? []), 100 + v]); }); // 같은 방 자리 나누기
    g.npc.forEach((pos, v) => {
      const pw = npcPawns[v]; if (!pw || pos == null) return;
      const list = groups.get(pos)!, t = posOf(pos, list.indexOf(100 + v), list.length);
      if (!pw.userData.target) pw.position.copy(t);
      pw.userData.target = t;
    });
    g.players.forEach((p, j) => {
      const pw = pawns[j]; pw.visible = p.pos != null;
      if (p.pos == null) return;
      const list = groups.get(p.pos)!, t = posOf(p.pos, list.indexOf(j), list.length);
      const prev = pw.userData.pos as G.Pos | undefined;
      if (!pw.userData.target) pw.position.copy(t);
      else if (prev != null && prev !== p.pos && j === g.turn) { // 자기 이동: 실제 경로(상하좌우)를 한 칸씩
        const blocked = new Set(g.players.filter((q, k) => k !== j && q.pos != null && q.pos >= 0).map(q => q.pos as G.Pos));
        const route = G.path(map!, prev, p.pos, blocked).slice(1, -1).filter(x => x >= 0);
        pw.userData.queue = [...route.map(x => posOf(x, 0, 1)), t];
      }
      pw.userData.pos = p.pos;
      pw.userData.target = t;
    });
  }

  // 탭(거의 안 움직인 클릭)만 이동 명령으로. 드래그는 카메라 회전.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down: [number, number] | null = null;
  renderer.domElement.addEventListener('pointerdown', e => (down = [e.clientX, e.clientY]));
  function pickAt(x: number, y: number): G.Pos | null {
    if (!hallMesh) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects<THREE.Object3D>([hallMesh, ...roomMeshes], false)[0];
    if (!hit) return null;
    return hit.object === hallMesh ? hallIdx[hit.instanceId!] : (hit.object as RoomMesh).userData.p;
  }
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p == null) return;
    onTap(p, e.clientX, e.clientY, e.pointerType !== 'mouse' || matchMedia('(hover: none)').matches); // 이동·미리보기 판단은 화면 쪽에서
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons) return; // 드래그(회전) 중엔 안내 안 함
    onHover(pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
  });
  renderer.domElement.addEventListener('pointerleave', () => onHover(null, 0, 0));

  const clock = new THREE.Clock();
  let running = false, throws: Throw[] = [];
  const dieGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);

  function throwDice(d: [number, number], power: number): Promise<void> {
    for (const t of throws) { scene.remove(t.mesh); t.done(); }
    throws = [];
    const all = dieMaterials(), T = 1.0 + power * 0.5;
    land([1 / 2.75, 2 / 2.75, 2.5 / 2.75, 1].map(f => f * T)); // easeOutBounce가 바닥에 닿는 지점
    return Promise.all(d.filter(v => v > 0).map((v, k) => new Promise<void>(done => {
      const f = faceValues(v); // 위(+y)에 나온 눈이 오도록 면 배치 → 최종 자세는 y축 회전만
      const mesh = new THREE.Mesh(dieGeo, [f.right, f.left, f.front, f.back, f.top, f.bottom].map(x => all[x - 1]));
      mesh.castShadow = true; noPick(mesh); scene.add(mesh);
      const side = d[1] === 0 ? 0 : k === 0 ? -1 : 1, to = new THREE.Vector3(side * 0.55, 0.39, 1.0 + (Math.random() - 0.5) * 0.3); // 중앙 말들 바로 앞
      const from = to.clone().add(new THREE.Vector3((side || 1) * (1 + Math.random()), 0, 2.5 + power * 1.5));
      throws.push({
        mesh, t0: clock.elapsedTime, T, h: 3 + power * 4, from, to,
        qEnd: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2),
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spin: 8 + power * 10, settled: false, done,
      });
    }))).then(() => {});
  }
  const qs = new THREE.Quaternion();
  function stepDice(now: number) {
    throws = throws.filter(t => {
      const u = Math.min(1, (now - t.t0) / t.T), e = 1 - (1 - u) ** 3;
      t.mesh.position.set(t.from.x + (t.to.x - t.from.x) * e, t.to.y + t.h * (1 - easeOutBounce(u)), t.from.z + (t.to.z - t.from.z) * e);
      t.mesh.quaternion.copy(t.qEnd).multiply(qs.setFromAxisAngle(t.axis, t.spin * (1 - u) ** 2));
      if (u >= 1 && !t.settled) { t.settled = true; t.done(); }
      if (now - t.t0 > t.T + 1.8) { scene.remove(t.mesh); return false; } // 결과를 잠시 보여 준 뒤 치움
      return true;
    });
  }
  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (env) { env.rotation.y = t * 0.8; env.position.y = 0.55 + Math.sin(t * 2) * 0.05; }
    stepDice(t);
    for (const pw of [...pawns, ...npcPawns.filter((x): x is THREE.Group => !!x)]) {
      const queue = pw.userData.queue as THREE.Vector3[] | undefined;
      if (queue?.length) { // 칸 단위로 콩콩: 한 칸에 약 0.12초
        const nx = queue[0], dx = nx.x - pw.position.x, dz = nx.z - pw.position.z, d = Math.hypot(dx, dz), step = dt * 8.5;
        if (d <= step) { pw.position.set(nx.x, nx.y, nx.z); queue.shift(); }
        else { pw.position.x += (dx / d) * step; pw.position.z += (dz / d) * step; pw.position.y = 0.08 + Math.sin(Math.min(1, 1 - d) * Math.PI) * 0.18; }
        continue;
      }
      const tg = pw.userData.target as THREE.Vector3 | null; if (!tg) continue;
      const dist = Math.hypot(tg.x - pw.position.x, tg.z - pw.position.z);
      pw.position.x += (tg.x - pw.position.x) * Math.min(1, dt * 6);
      pw.position.z += (tg.z - pw.position.z) * Math.min(1, dt * 6);
      pw.position.y = 0.08 + Math.min(0.4, dist * 0.15);
    }
    for (const sp of weaponSprites) {
      const tg = sp.userData.target as THREE.Vector3 | null; if (!tg) continue;
      sp.position.lerp(tg, Math.min(1, dt * 4));
    }
    const cur = pawns[turn];
    ring.visible = !!cur?.visible;
    if (cur && ring.visible) ring.position.set(cur.position.x, 0.12, cur.position.z);
    if (camGoal) {
      const k = Math.min(1, dt * 4.5);
      camera.position.lerp(camGoal.pos, k); controls.target.lerp(camGoal.tgt, k);
      if (camera.position.distanceTo(camGoal.pos) < 0.02) camGoal = null;
    }
    controls.update();
    updateWalls(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (map) fit();
  }).observe(container);

  return {
    update,
    start() { if (!running) { running = true; clock.getDelta(); frame(); } },
    stop() { running = false; for (const t of throws) { scene.remove(t.mesh); t.done(); } throws = []; },
    resetView() { camGoal = null; fit(); },
    focus(cells) {
      if (!map) return;
      // 처음 시점(fit) 위치를 계산해 두고, 칸 묶음이면 같은 방향에서 묶음 크기만큼만 떨어진 곳으로
      const p0 = camera.position.clone(), t0 = controls.target.clone(); fit();
      const home = { pos: camera.position.clone(), tgt: controls.target.clone() };
      camera.position.copy(p0); controls.target.copy(t0); controls.update();
      if (!cells?.length) { camGoal = home; return; }
      const pts = cells.map(c => posOf(c, 0, 1));
      const xs = pts.map(v => v.x), zs = pts.map(v => v.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 3;
      const ratio = Math.min(1, Math.max(0.35, size / n)); // 판 전체 대비 크기만큼 거리 줄이기(너무 가까이는 안 감)
      const off = home.pos.clone().sub(home.tgt).multiplyScalar(ratio);
      const tgt = new THREE.Vector3(cx, 0, cz);
      camGoal = { pos: tgt.clone().add(off), tgt };
    },
    rebuild() { key = null; },
    throwDice,
    preview,
  };
}
