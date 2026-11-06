// 순수 게임 로직 — 서버·브라우저·테스트 공용. 부수효과 없음(rng는 주입).

export type ThemeKey = 'mansion' | 'atlantis' | 'station';
export type Kind = 's' | 'w' | 'r';
/** 카드 id: 's0'~(인물), 'w0'~(도구), 'r0'~(장소). 인물·도구는 6~8장(인원에 따라), 장소는 방 개수만큼 */
export type Card = string;
/** 0 이상 = 복도 칸 인덱스(y*n+x), 음수 = 방 -(방번호+1). null = 탈락해 보드에 없음 */
export type Pos = number;
export type Rng = () => number;

export interface Theme { name: string; icon: string; s: string[]; w: string[]; r: string[] }
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Door { room: number; cell: number }
export interface GameMap {
  n: number; cells: number[]; rects: Rect[]; center: Rect; doors: Door[];
  passages: Record<number, number>; roomCount: number;
  /** 이 판의 도구 카드 수(클래식 = max(6, 인원), 오리지널 = 8). 인물 카드는 cast */
  people: number;
  /** 이 판에 인물 카드로 들어간 용의자 번호(0~7). 클래식 = 8명 중 무작위 max(6, 인원)명(플레이어가 맡은 인물은 반드시 포함), 오리지널 = 8명 전원 */
  cast?: number[];
  /** 이 판에 도구 카드로 들어간 도구 번호(0~7). 클래식 = 8개 중 무작위 people개, 오리지널 = 8개 전원 */
  tools?: number[];
  /** 보너스칸(!) — 이동을 이 칸에서 멈추면 능력 카드 1장을 뽑는다 */
  bonus: Pos[];
}
export interface Triple { s: Card; w: Card; r: Card }

// ---------- 능력 카드 (보너스칸에서 뽑아 들고 있다가 쓴다) ----------
export type RoleId = 'chief' | 'tap' | 'analyst' | 'field' | 'scout' | 'guide' | 'lawyer' | 'insure';
/** 언제 쓰는가: turn = 내 차례(굴리기 전, 또는 이동한 뒤), hall = 굴리기 전이나 복도에 멈춘 뒤, refute = 내가 반박할 차례, auto = 들고 있으면 저절로 */
export type RoleWhen = 'turn' | 'hall' | 'refute' | 'auto';
export interface RoleDef {
  name: string; icon: string; group: '정보' | '행동' | '방어'; desc: string; when: RoleWhen;
  /** 뽑힐 비중(합 18) — 봇 시뮬레이션으로 조정: 한 장을 쥐여 준 자리의 승리 몫이 공정 몫 대비 +2~5%p(4인 3,000판). 센 카드(도청·수색·열람)는 덜 나오게 */
  weight: number;
}
/** 한 사람이 들고 있을 수 있는 능력 카드 수 */
export const MAX_ITEMS = 3;
/** 도청 장치 한 장으로 엿보는 반박 수 */
export const TAP_PEEKS = 1;
export const ROLES: Record<RoleId, RoleDef> = {
  chief:   { name: '지정 심문', icon: '🕵️', group: '정보', when: 'turn', weight: 3, desc: '한 명과 종류(인물·도구·장소)를 고르면 그 사람이 가진 그 종류 카드 중 1장을 무작위로 봅니다 (없으면 없다는 사실만 알게 됩니다)' },
  tap:     { name: '도청 장치', icon: '🎧', group: '정보', when: 'turn', weight: 2, desc: '설치하면 이후 남들끼리 주고받는 반박 카드를 한 번 몰래 봅니다' },
  analyst: { name: '기록 열람', icon: '🗂️', group: '정보', when: 'turn', weight: 2, desc: '남들끼리 했던 지난 반박 하나를 골라 그때 보여 준 카드를 확인합니다' },
  field:   { name: '추격', icon: '🚓', group: '행동', when: 'hall', weight: 3, desc: '복도에 멈춘 뒤 주사위를 다시 굴려 이어서 이동합니다 (방에 닿으면 추리 가능)' },
  scout:   { name: '원격 수색', icon: '🔦', group: '정보', when: 'turn', weight: 2, desc: '방 하나를 골라 그 장소 카드를 누가 가졌는지 확인합니다 (아무도 없으면 그 방이 범행 장소)' },
  guide:   { name: '지름길', icon: '🗝️', group: '행동', when: 'hall', weight: 3, desc: '굴리기 전이나 복도에 멈춘 뒤, 아무 방으로 바로 이동해 추리할 수 있습니다 (사건 파일실로 가면 최종 고발 가능)' },
  lawyer:  { name: '묵비권', icon: '⚖️', group: '방어', when: 'refute', weight: 2, desc: '내가 반박할 차례에 이 카드를 내면 카드를 보여 주지 않고 다음 사람에게 넘깁니다 (사용 사실은 공개)' },
  insure:  { name: '보험', icon: '🛡️', group: '방어', when: 'auto', weight: 1, desc: '들고 있는 동안 최종 고발이 틀리면 이 카드가 대신 사라지고, 탈락하지 않고 한 턴 쉽니다' },
};
/** 후던잇 오리지널의 능력 설명: 효과는 같고 말만 맞춤(추리 → 가설, 반박 → 반증, 최종 고발 → 결론 보고, 탈락 → 수사에서 빠짐) */
const ORIGINAL_ROLE_DESC: Partial<Record<RoleId, string>> = {
  tap: '설치하면 이후 남들끼리 주고받는 반증 카드를 한 번 몰래 봅니다',
  analyst: '남들끼리 했던 지난 반증 하나를 골라 그때 보여 준 카드를 확인합니다',
  field: '복도에 멈춘 뒤 주사위를 다시 굴려 이어서 이동합니다 (방에 닿으면 가설 가능)',
  guide: '굴리기 전이나 복도에 멈춘 뒤, 아무 방으로 바로 이동해 가설을 세울 수 있습니다 (수사본부로 가면 결론 보고 가능)',
  lawyer: '내가 반증할 차례에 이 카드를 내면 사실을 보여 주지 않고 다음 사람에게 넘깁니다 (사용 사실은 공개)',
  insure: '들고 있는 동안 결론 보고가 틀리면 이 카드가 대신 사라지고, 수사에서 빠지지 않고 한 턴 쉽니다',
};
export const roleDesc = (role: RoleId, opts: { mode?: Mode } | undefined) => (isOriginal(opts) && ORIGINAL_ROLE_DESC[role]) || ROLES[role].desc;
export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
export const isRole = (x: unknown): x is RoleId => typeof x === 'string' && Object.hasOwn(ROLES, x);
/** 능력 카드 1장 뽑기(비중대로 무작위, 덱은 무한 — 같은 카드가 여러 번 나올 수 있음) */
export function drawRole(r: Rng): RoleId {
  let x = r() * ROLE_IDS.reduce((a, k) => a + ROLES[k].weight, 0);
  for (const k of ROLE_IDS) { x -= ROLES[k].weight; if (x < 0) return k; }
  return ROLE_IDS[ROLE_IDS.length - 1];
}

export interface Player {
  name: string; bot: boolean; afk: boolean; suspect: number; pos: Pos | null; fresh: boolean;
  hand: Card[]; known: Card[]; shown: Card[]; out: boolean; canSuggest: boolean; timeouts: number;
  /** 들고 있는 능력 카드(최대 MAX_ITEMS장, 내용 비공개 — 장수만 공개). tap = 설치된 도청 남은 횟수, skip = 보험으로 한 턴 쉼 */
  items: RoleId[]; tap: number; skip: boolean;
  /** 이번 턴에 보너스칸에 멈췄는지 / 이번 턴에 능력 카드를 이미 냈는지(내 차례에 1장) */
  onBonus: boolean; usedItem: boolean;
  /** 게임 중 나가서 탈락(반박 차례에서도 빠짐) */
  left?: boolean;
}
export type Phase = 'roll' | 'move' | 'act' | 'refute' | 'over';
export interface Suggestion extends Triple { p: number; refuter: number; matches: Card[] }
export type LogEntry =
  | { t: 'start' }
  /** d: 주사위 두 개의 눈, n: 턴 번호, k: 게임 전체 굴림 번호(화면이 새 굴림을 알아보는 용도 — 재굴림도 구분) */
  | { t: 'roll'; p: number; v: number; d: [number, number]; n: number; k: number }
  | { t: 'enter' | 'passage'; p: number; room: number }
  | ({ t: 'suggest' | 'norefute'; p: number } & Triple)
  /** 차례대로 확인하다 카드가 없어 넘긴 사람(공개 정보: 이 사람은 세 장 모두 없음) */
  | ({ t: 'pass'; p: number; to: number } & Triple)
  /** id: 반박 기록 고유 번호(기록 분석가가 고를 때 사용) */
  | { t: 'shown'; p: number; to: number; card?: Card; id: number }
  | ({ t: 'accuse'; p: number; ok: boolean; saved?: boolean } & Triple)
  | { t: 'timeout' | 'afk'; p: number }
  /** 게임 중 나감 → 탈락, 가진 카드는 모두에게 공개 */
  | { t: 'left'; p: number }
  /** 공개되는 능력 카드 사용 기록(대상만, 결과는 비공개) */
  | { t: 'ability'; p: number; role: RoleId; target?: number; room?: number }
  /** 비공개 정보 — to 본인에게만 보임. from: 카드 주인(null = 없음), a→b: 엿본 반박, draw: 보너스칸에서 뽑은 능력 카드(role) */
  | { t: 'intel'; to: number; kind: 'interrogate' | 'tap' | 'archive' | 'search' | 'draw'; card?: Card; from?: number | null; a?: number; b?: number; cat?: Kind; role?: RoleId }
  | { t: 'silent'; p: number; to: number }
  /** bonus = 보너스칸에서 능력 카드 1장(무엇인지는 비공개), bonusfull = 이미 MAX_ITEMS장이라 못 뽑음 */
  | { t: 'silentnone' | 'rest' | 'bonus' | 'bonusfull'; p: number };
/** tempo = 봇 템포: 사람이 추리 노트를 적을 시간을 두고 봇이 움직이는 속도 */
export type Tempo = 'fast' | 'normal' | 'slow';
export const TEMPOS: Record<Tempo, { name: string; mul: number }> = { fast: { name: '빠르게', mul: 0.45 }, normal: { name: '보통', mul: 1 }, slow: { name: '천천히', mul: 1.8 } };
export const isTempo = (t: unknown): t is Tempo => typeof t === 'string' && Object.hasOwn(TEMPOS, t);
/** 게임 모드: classic = 지금 규칙(플레이어가 용의자 말을 맡음), original = 후던잇 오리지널(플레이어는 탐정, 용의자 8명·도구 8개는 모두 NPC·고정) */
export type Mode = 'classic' | 'original';
export const MODES: Record<Mode, { name: string; desc: string }> = {
  classic: { name: '클래식', desc: '용의자 중 하나를 맡아 움직여요' },
  original: { name: '후던잇 오리지널', desc: '사건을 풀러 모인 탐정이 되어요 · 용의자 8명·도구 8개 (시험 중)' },
};
export const isMode = (m: unknown): m is Mode => typeof m === 'string' && Object.hasOwn(MODES, m);
export const isOriginal = (o: { mode?: Mode } | undefined) => o?.mode === 'original';
/** 후던잇 오리지널의 탐정 8명 — 테마(세계)마다 그 세계의 탐정들. 이름에 직업명은 붙이지 않고, 한국·외국 이름을 섞음. 이름·분야는 가안.
 *  그림이 있는 테마(고딕 저택)만 정해 두고, 아직 없는 테마는 고딕 저택 탐정을 임시로 씀 */
const MANSION_DETECTIVES: Detective[] = [
  { name: '에드먼드 그레이', spec: '은퇴한 경감 · 심문' },
  { name: '한서진', spec: '강력계 출신 · 현장 추적' },
  { name: '미라 볼코바', spec: '탐사 기자 · 정보원' },
  { name: '윤태오', spec: '법의학자 · 감식' },
  { name: '셀린 마르샹', spec: '변호사 · 변론' },
  { name: '오민혁', spec: '보험 조사원' },
  { name: '아서 펨브룩', spec: '기록 보관인 · 문서 분석' },
  { name: '차은호', spec: '사설 탐정 · 지리와 인맥' },
];
export interface Detective { name: string; spec: string }
export const DETECTIVES: Record<ThemeKey, Detective[]> = { mansion: MANSION_DETECTIVES, atlantis: MANSION_DETECTIVES, station: MANSION_DETECTIVES };
/** 후던잇 오리지널 시작 연출 ①의 사건 개요 — 테마마다 5개, 판 번호로 하나(모두에게 같은 문장). 방·도구·용의자 이름은 넣지 않음(봉투와 어긋나지 않게) */
export const CASE_LINES: Record<ThemeKey, string[]> = {
  mansion: [
    '폭풍우가 몰아치던 밤, 언덕 위 저택의 주인이 숨진 채 발견됐다.',
    '유언장 공개를 하루 앞둔 밤, 저택의 주인이 다시는 깨어나지 않았다.',
    '괘종시계가 자정을 알린 직후, 저택에 비명이 울려 퍼졌다.',
    '다리가 끊겨 아무도 떠날 수 없던 밤, 저택의 주인이 쓰러진 채 발견됐다.',
    '촛불이 모두 꺼진 십 분 사이, 저택의 주인이 숨을 거뒀다.',
  ],
  atlantis: [
    '조류가 멎은 밤, 신전의 수호자가 제단 아래에서 숨진 채 발견됐다.',
    '진주 의식이 열리기 직전, 신전의 수호자가 깊은 물속에서 떠올랐다.',
    '신전의 문이 봉인된 사이, 수호자의 숨이 끊겼다.',
    '빛 해파리가 모두 꺼진 밤, 신전 깊은 곳에서 수호자가 쓰러졌다.',
    '해류가 신전을 고립시킨 밤, 수호자가 다시는 눈을 뜨지 않았다.',
  ],
  station: [
    '정기 보급선이 떠난 직후, 정거장 소장이 숨진 채 발견됐다.',
    '태양 폭풍으로 통신이 끊긴 밤, 정거장 소장이 쓰러졌다.',
    '야간 조명이 켜진 사이, 정거장 소장의 생체 신호가 멈췄다.',
    '도킹 해제를 한 시간 앞두고, 정거장 소장이 다시는 깨어나지 않았다.',
    '정전이 이어진 십 분 사이, 정거장 소장이 숨을 거뒀다.',
  ],
};
export const caseLine = (theme: ThemeKey, pub: number) => CASE_LINES[theme][Math.abs(pub) % CASE_LINES[theme].length];
/** 고를 수 있는 말 수: 두 모드 모두 8(클래식 = 용의자 8명, 오리지널 = 탐정 8명) */
export const PICKS = 8;
/** 이 판의 인물·도구 카드 수: 오리지널은 8 고정, 클래식은 max(6, 인원) — 클래식 인물 카드는 8명 중 이만큼 무작위 */
export const pieceCount = (opts: { mode?: Mode } | undefined, players: number) => (isOriginal(opts) ? 8 : Math.max(6, players));
export interface GameOpts { roles: boolean; bluff: boolean; tempo?: Tempo; mode?: Mode }
export interface Game {
  theme: ThemeKey; seed: number; map: GameMap; players: Player[]; env: Triple;
  /** 브라우저에 보내는 판 번호(서버가 따로 뽑음). 패 배분 시드(seed)는 절대 밖으로 내보내지 않는다 */
  pub?: number;
  turn: number; phase: Phase; roll: number | null; sug: Suggestion | null;
  log: LogEntry[]; winner: number | null; turnNo: number; rolls: number; opts: GameOpts;
  /** 마지막 이동에서 플레이어가 직접 고른 길([출발, …, 도착]). 화면이 이 길로 걷게 함. 없으면 최단 경로로 걸음 */
  walk?: Walk | null;
  /** 도구 말 위치: weapons[k] = 도구 k(0~7)가 놓인 방 번호, 이 판에 없는 도구는 null. 추리하면 그 방으로 옮겨진다 */
  weapons: (number | null)[];
  /** 아무도 고르지 않은 인물 말 위치(npc[인물 번호]). 플레이어가 맡은 인물은 null */
  npc: (Pos | null)[];
  /** 똑같이 나누고 남아 모두에게 공개된 카드(진실이 아님) */
  open: Card[];
}
export interface Walk { p: number; route: Pos[] }
export type Action =
  | { t: 'roll' } | { t: 'passage' } | { t: 'end' }
  /** via: 직접 고른 길(출발 다음 칸 ~ 도착). 규칙에 안 맞으면 무시하고 최단 경로로 걷는 것처럼 보여 줌(도착 칸만 규칙에 영향) */
  | { t: 'move'; to: Pos; via?: Pos[] }
  | { t: 'suggest'; s: Card; w: Card }
  | ({ t: 'accuse' } & Triple)
  | { t: 'show'; card?: Card; silent?: boolean }
  /** 능력 카드 내기. 카드에 따라 target(플레이어)·cat(종류)·room(방)·entry(로그 번호)를 쓴다 */
  | { t: 'ability'; card: RoleId; target?: number; cat?: Kind; room?: number; entry?: number };

export interface PlayerView {
  name: string; suspect: number; pos: Pos | null; out: boolean; bot: boolean; afk: boolean; handCount: number;
  canSuggest?: boolean; fresh: boolean; hand?: Card[]; left?: boolean;
  /** 능력 카드: 장수는 모두에게, 내용은 본인(또는 게임 종료 후)만 */
  itemCount: number; items?: RoleId[]; tap?: number; onBonus?: boolean; usedItem?: boolean;
}
export interface View {
  theme: ThemeKey; seed: number; map: GameMap; turn: number; phase: Phase; roll: number | null;
  turnNo: number; winner: number | null; me: number; players: PlayerView[];
  sug: (Omit<Suggestion, 'matches'> & { matches?: Card[] }) | null;
  log: LogEntry[]; env?: Triple; opts: GameOpts; weapons: (number | null)[]; npc: (Pos | null)[]; open: Card[];
  /** 기록 열람 능력용: 남들끼리 카드를 보여 준 반박 목록(카드는 빼고). 기록이 잘려도 남아 있게 따로 보냄 */
  archive: { id: number; p: number; to: number }[];
  walk?: Walk | null;
}
/** moves()가 필요로 하는 최소 상태 — 서버의 Game과 브라우저의 View 둘 다 만족 */
type BoardState = Pick<Game, 'phase' | 'turn' | 'map' | 'roll'> & { players: { pos: Pos | null; out: boolean }[] };

export const THEMES: Record<ThemeKey, Theme> = {
  mansion: {
    name: '고딕 저택', icon: '🏚️',
    s: ['정원사 오스윈', '상속녀 아이린', '화가 루시앙', '주치의 마르타', '사서 에드거', '가정교사 클레어', '요리사 마틸드', '마부 바솔로'],
    w: ['독을 탄 홍차', '사냥용 석궁', '깨진 거울', '수면제', '청동 흉상', '부지깽이', '깨진 샴페인병', '독침 브로치'],
    r: ['시계탑', '화랑', '예배당', '와인 저장고', '음악실', '다락방', '마구간', '별관 침실', '지하 실험실', '하인 숙소', '탑 전망대'],
  },
  atlantis: {
    name: '해저 신전', icon: '🌊',
    s: ['대사제 네레아', '잠수부 코랄', '학자 테티스', '상인 마로', '수호병 브론', '견습 무녀 이오', '해적 선장 바르보', '인어 가수 셀레네'],
    w: ['삼지창', '독해파리', '저주받은 진주', '산호 단검', '봉인의 구슬', '크라켄의 비늘', '독산호 가시', '심해 작살'],
    r: ['신탁의 방', '진주 회랑', '해류 정원', '침몰 서고', '크라켄 우리', '조수 제단', '수정 보물고', '숨결 공방', '심연 계단', '해마 마구간', '등대 탑'],
  },
  station: {
    name: '우주 정거장', icon: '🚀',
    s: ['함장 오렌', '기관사 피오', '생물학자 유나', '보안관 렉스', '안드로이드 SIL-4', '화물 조종사 다닐', '의무관 하나', '견습 엔지니어 토비'],
    w: ['플라스마 커터', '산소 차단기', '오염된 배양체', '공구 드론', '독이 든 영양팩', '에어록 개방기', '방사성 시료', '고장 난 로봇 팔'],
    r: ['함교', '수경 재배실', '원자로실', '의무실', '동면실', '화물칸', '관측 돔', '통신실', '에어록', '체육관', '승무원 식당'],
  },
};
/** 지금 고를 수 있는 테마(나머지는 그림 준비 전이라 보류) */
export const OPEN_THEMES: readonly ThemeKey[] = ['mansion'];
export const isTheme = (t: unknown): t is ThemeKey => OPEN_THEMES.includes(t as ThemeKey);

/** 복도 최소 폭(칸) */
export const CORRIDOR = 3;
/**
 * 저택 평면도(인원별 고정 설계). 보드 가장자리 네 띠에 크기가 다른 방을 늘어놓고 사이사이·안쪽에 폭 3칸 복도,
 * 가운데에 사건 파일실. top/bottom = 위·아래 띠의 방 폭(왼→오), left/right = 양옆 띠의 방 높이(위→아래).
 * 띠 두께 d. 조건: 위·아래 폭 합 + 3×(개수−1) = n, 양옆 높이 합 + 3×(개수−1) = n − 2d − 6.
 * 방 번호: 0 왼위, 1 오위, 2 왼아래, 3 오아래(모서리 — 비밀 통로 0↔3, 1↔2), 그다음 위·아래 가운데 방, 왼쪽, 오른쪽.
 */
interface Plan { n: number; d: number; top: number[]; bottom: number[]; left: number[]; right: number[]; center: number }
const PLANS: Record<number, Plan> = {
  // 3~6인은 방 9개 고정 — 같은 평면도
  3: { n: 22, d: 4, top: [6, 4, 6], bottom: [3, 4, 3, 3], left: [8], right: [8], center: 5 },
  4: { n: 22, d: 4, top: [6, 4, 6], bottom: [3, 4, 3, 3], left: [8], right: [8], center: 5 },
  5: { n: 22, d: 4, top: [6, 4, 6], bottom: [3, 4, 3, 3], left: [8], right: [8], center: 5 },
  6: { n: 22, d: 4, top: [6, 4, 6], bottom: [3, 4, 3, 3], left: [8], right: [8], center: 5 },
  7: { n: 23, d: 4, top: [7, 4, 6], bottom: [5, 6, 6], left: [3, 3], right: [3, 3], center: 5 },
  8: { n: 24, d: 4, top: [5, 3, 4, 3], bottom: [6, 5, 7], left: [4, 3], right: [3, 4], center: 6 },
};
export const SIZES: Record<number, { n: number; rooms: number }> = Object.fromEntries(Object.entries(PLANS).map(([c, pl]) =>
  [c, { n: pl.n, rooms: pl.top.length + pl.bottom.length + pl.left.length + pl.right.length }]));
export const MAX_PLAYERS = 8;
/** 단계별 2분: 주사위 눈이 나온 뒤 이동, 방에 들어가 추리, 반박. 굴리기 전에는 제한 없음(서버 update 참고) */
export const TURN_MS = 120000, REFUTE_MS = 120000;
const KINDS: Kind[] = ['s', 'w', 'r'];

export function rng(seed: number): Rng { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: Rng, a: T[]): T => a[Math.floor(r() * a.length)];
function shuffle<T>(r: Rng, src: T[]): T[] { const a = [...src]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const roomPos = (i: number): Pos => -i - 1;
export const roomOf = (p: Pos): number => -p - 1;
export const inRoom = (p: Pos | null | undefined): p is Pos => p != null && p < 0;
export const cardName = (theme: ThemeKey, id: Card): string => THEMES[theme][id[0] as Kind][+id.slice(1)];
export function allCards(m: { roomCount: number; people: number; cast?: number[]; tools?: number[] }): Record<Kind, Card[]> {
  const seq = (k: Kind, len: number) => Array.from({ length: len }, (_, i) => k + i);
  const ids = (k: Kind, xs: number[] | undefined, len: number) => (xs ? [...xs].sort((a, b) => a - b).map(v => k + v) : seq(k, len));
  return { s: ids('s', m.cast, m.people), w: ids('w', m.tools, m.people), r: seq('r', m.roomCount) };
}

// 인원별 평면도로 방을 배치. 문·보너스칸 위치도 인원별로 고정(같은 인원이면 늘 같은 보드). seed는 호환용으로만 받음.
/** 평면도는 인원수별로 고정, 보너스칸 위치만 seed(판)마다 무작위 */
export function genMap(count: number, seed = 0): GameMap {
  const pl = PLANS[count], { n, d } = pl, r = rng(7700 + count), C = CORRIDOR;
  const cells: number[] = new Array(n * n).fill(-1);
  const band = (sizes: number[], start: number, mk: (from: number, size: number) => Rect) => {
    let cur = start; return sizes.map(sz => { const q = mk(cur, sz); cur += sz + C; return q; });
  };
  const top = band(pl.top, 0, (x, w) => ({ x0: x, y0: 0, x1: x + w - 1, y1: d - 1 }));
  const bottom = band(pl.bottom, 0, (x, w) => ({ x0: x, y0: n - d, x1: x + w - 1, y1: n - 1 }));
  const left = band(pl.left, d + C, (y, h) => ({ x0: 0, y0: y, x1: d - 1, y1: y + h - 1 }));
  const right = band(pl.right, d + C, (y, h) => ({ x0: n - d, y0: y, x1: n - 1, y1: y + h - 1 }));
  const rects = [top[0], top[top.length - 1], bottom[0], bottom[bottom.length - 1],
    ...top.slice(1, -1), ...bottom.slice(1, -1), ...left, ...right];
  const R = rects.length;
  rects.forEach((q, i) => { for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) cells[y * n + x] = i; });
  const c0 = Math.floor((n - pl.center) / 2), c1 = c0 + pl.center - 1;
  const center = { x0: c0, y0: c0, x1: c1, y1: c1 };
  for (let y = c0; y <= c1; y++) for (let x = c0; x <= c1; x++) cells[y * n + x] = R;
  const doors: Door[] = [];
  const mid = Math.floor((c0 + c1) / 2); // 중앙은 네 변 가운데에 문 하나씩(전원 출발 → 공평하게, 덜 막히게)
  for (const [x, y] of [[mid, c0 - 1], [mid, c1 + 1], [c0 - 1, mid], [c1 + 1, mid]]) doors.push({ room: R, cell: y * n + x });
  rects.forEach((q, i) => {
    const sides: [number, number][][] = [[], [], [], []]; // 위 아래 왼 오
    for (let x = q.x0; x <= q.x1; x++) { sides[0].push([x, q.y0 - 1]); sides[1].push([x, q.y1 + 1]); }
    for (let y = q.y0; y <= q.y1; y++) { sides[2].push([q.x0 - 1, y]); sides[3].push([q.x1 + 1, y]); }
    const ok = shuffle(r, sides.map(s => s.filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && cells[y * n + x] === -1)).filter(s => s.length));
    ok.slice(0, r() < 0.5 ? 2 : 1).forEach(s => { const [x, y] = s[Math.floor(s.length / 2)]; doors.push({ room: i, cell: y * n + x }); }); // 변 가운데에 문
  });
  const map: GameMap = { n, cells, rects, center, doors, passages: { 0: 3, 3: 0, 1: 2, 2: 1 }, roomCount: R, people: Math.max(6, count), bonus: [] };
  map.bonus = placeBonus(map, bonusCount(count), seed ? rng((seed * 7919 + count * 104729) >>> 0) : r);
  return map;
}
/** 보너스칸 수: 3~4인 8개, 5~6인 10개, 7~8인 12개 — 봇 시뮬레이션으로 조정 */
export const bonusCount = (players: number) => (players <= 4 ? 8 : players <= 6 ? 10 : 12);

// 보너스칸: 문·문 옆이 아닌 복도 중 중앙에서 3걸음 이상. 보드를 네 구역(왼위·오위·왼아래·오아래)으로 나눠 구역마다 같은 수(나머지는 무작위 구역)를
// 돌아가며 놓고, 구역 안에서는 이미 놓인 칸에서 가장 먼 거리의 85% 이상 떨어진 후보 중 무작위 → 판마다 다르지만 고르게
function placeBonus(map: GameMap, count: number, r: Rng): Pos[] {
  const { n } = map, dc = distances(map, roomPos(map.roomCount)), h = (n - 1) / 2;
  const doorish = new Set(map.doors.flatMap(d => [d.cell, ...neighbors(map, d.cell).filter(x => x >= 0)]));
  const cand = map.cells.flatMap((c, i) => (c === -1 && !doorish.has(i) && (dc.get(i) ?? 0) >= 3 ? [i] : []));
  const quad = (c: Pos) => (c % n > h ? 1 : 0) + (Math.floor(c / n) > h ? 2 : 0);
  const md = (a: Pos, b: Pos) => Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
  const order = shuffle(r, [0, 1, 2, 3]), want = [0, 0, 0, 0];
  for (let k = 0; k < count; k++) want[order[k % 4]]++;
  const out: Pos[] = [];
  for (let round = 0; out.length < count; round++) {
    let placed = false;
    for (const q of order) {
      if (out.filter(c => quad(c) === q).length >= want[q]) continue;
      const pool = cand.filter(c => quad(c) === q && !out.includes(c));
      if (!pool.length) { want[q]--; want[order.find(x => x !== q && cand.some(c => quad(c) === x && !out.includes(c))) ?? q]++; continue; }
      const dist = pool.map(c => (out.length ? Math.min(...out.map(o => md(o, c))) : n));
      const far = Math.max(...dist);
      out.push(pick(r, pool.filter((_, k) => dist[k] >= Math.max(1, far * 0.85))));
      placed = true;
      if (out.length >= count) break;
    }
    if (!placed || round > count) break;
  }
  return out;
}

export function neighbors(map: GameMap, p: Pos): Pos[] {
  if (p < 0) return map.doors.filter(d => d.room === roomOf(p)).map(d => d.cell);
  const { n, cells } = map, x = p % n, y = (p - x) / n, out: Pos[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const X = x + dx, Y = y + dy;
    if (X >= 0 && Y >= 0 && X < n && Y < n && cells[Y * n + X] === -1) out.push(Y * n + X);
  }
  for (const d of map.doors) if (d.cell === p) out.push(roomPos(d.room));
  return out;
}

// steps 이하로 갈 수 있는 목적지. 상하좌우만, 한 이동에서 같은 칸 재방문 불가(최단 경로 탐색이라 자동으로 지켜짐),
// 방에 들어가면 이동 끝, 다른 말이 있는 칸은 통과 불가.
export function reachable(map: GameMap, from: Pos, steps: number, blocked: Set<Pos> = new Set()): Set<Pos> {
  const dist = new Map<Pos, number>([[from, 0]]), q = [from], out = new Set<Pos>();
  while (q.length) {
    const p = q.shift()!, d = dist.get(p)!;
    if ((p < 0 && p !== from) || d === steps) continue;
    for (const nx of neighbors(map, p)) {
      if (dist.has(nx) || blocked.has(nx)) continue;
      dist.set(nx, d + 1); q.push(nx); out.add(nx);
    }
  }
  return out;
}

/** from에서 각 칸·방까지 걸음 수(상하좌우, 방에 들어가면 멈춤, blocked 칸 통과 불가). 화면의 거리 안내용 */
export function distances(map: GameMap, from: Pos, blocked: Set<Pos> = new Set()): Map<Pos, number> {
  const dist = new Map<Pos, number>([[from, 0]]), q = [from];
  while (q.length) {
    const p = q.shift()!;
    if (p < 0 && p !== from) continue;
    for (const nx of neighbors(map, p)) if (!dist.has(nx) && !blocked.has(nx)) { dist.set(nx, dist.get(p)! + 1); q.push(nx); }
  }
  return dist;
}

/** from → to 최단 경로(양 끝 포함, 상하좌우만). 화면이 말을 한 칸씩 움직이는 데 쓴다. 없으면 [] */
export function path(map: GameMap, from: Pos, to: Pos, blocked: Set<Pos> = new Set()): Pos[] {
  const prev = new Map<Pos, Pos | null>([[from, null]]), q = [from];
  while (q.length) {
    const p = q.shift()!;
    if (p === to) break;
    if (p < 0 && p !== from) continue;
    for (const nx of neighbors(map, p)) if (!prev.has(nx) && !blocked.has(nx)) { prev.set(nx, p); q.push(nx); }
  }
  if (!prev.has(to)) return [];
  const out: Pos[] = [];
  for (let p: Pos | null = to; p !== null; p = prev.get(p) ?? null) out.unshift(p);
  return out;
}

/** 턴 종료 가능: 행동(굴려서 이동·추론·능력)을 한 뒤에만. 굴렸는데 갈 칸이 하나도 없으면(길이 막힘) 예외로 허용 */
export function canEnd(g: BoardState, i: number): boolean {
  return g.turn === i && (g.phase === 'act' || (g.phase === 'move' && moves(g, i).size === 0));
}

/**
 * i가 아닌 말이 선 복도 칸. occ = 거기서 멈출 수 없음, wall = 지나갈 수도 없음.
 * 방 문 앞 칸은 막히면 방에 못 들어가니 지나갈 수는 있게(한 칸으로 셈) — 멈추는 것만 안 됨
 */
export function occupied(g: Pick<BoardState, 'players' | 'map'>, i: number): { occ: Set<Pos>; wall: Set<Pos> } {
  const occ = new Set(g.players.filter((p, j) => j !== i && !p.out && p.pos != null && p.pos >= 0).map(p => p.pos as Pos));
  const doors = new Set(g.map.doors.map(d => d.cell));
  return { occ, wall: new Set([...occ].filter(p => !doors.has(p))) };
}

export function moves(g: BoardState, i: number): Set<Pos> {
  const pos = g.players[i]?.pos;
  if (g.phase !== 'move' || g.turn !== i || pos == null || g.roll == null) return new Set();
  const { occ, wall } = occupied(g, i), out = reachable(g.map, pos, g.roll, wall);
  for (const p of occ) out.delete(p);
  return out;
}

/**
 * 플레이어가 고른 길(via = 출발 다음 칸 ~ to)이 이번 이동 규칙에 맞으면 [출발, ...via], 아니면 null.
 * 규칙: 주사위 눈 이하, 상하좌우 이웃으로만, 같은 칸 두 번 안 됨, 다른 말 칸 통과 불가(방 문 앞 칸은 통과만 가능), 방은 도착으로만(출발 방은 예외)
 */
export function chosenRoute(g: BoardState, i: number, to: Pos, via: unknown): Pos[] | null {
  const from = g.players[i]?.pos;
  if (from == null || g.roll == null || !Array.isArray(via) || !via.length || via.length > g.roll || via.at(-1) !== to) return null;
  const { occ, wall: blocked } = occupied(g, i);
  if (occ.has(to)) return null;
  const route: Pos[] = [from];
  for (const x of via) {
    const cur = route.at(-1)!;
    if (!Number.isInteger(x) || route.includes(x) || blocked.has(x) || (cur < 0 && cur !== from) || !neighbors(g.map, cur).includes(x)) return null;
    route.push(x);
  }
  return route;
}

/** 화면이 말을 걷게 할 길: 이 이동에서 고른 길(walk)이 있으면 그것, 없으면 최단 경로. 2D·3D 같이 씀 */
export function walkRoute(map: GameMap, walk: Walk | null | undefined, j: number, from: Pos, to: Pos, blocked: Set<Pos>): Pos[] {
  return walk && walk.p === j && walk.route[0] === from && walk.route.at(-1) === to ? walk.route : path(map, from, to, blocked);
}

export interface SeatIn { name: string; bot?: boolean; suspect?: number | null }

/**
 * 준비: ① 인물은 자리마다 고른 것(겹치거나 없으면 남은 것 중 무작위) ② 인물·도구·장소에서 1장씩 봉투로
 * ③ 나머지를 섞어 모두에게 같은 장수로 ④ 남는 카드는 공개(진실이 아님)
 */
/** 후던잇 오리지널의 비밀 통로: 판마다 서로 먼 방 2쌍(모서리 대각선 고정 배치를 쓰지 않음). 사건 파일실 제외 */
export function randomPassages(map: GameMap, r: Rng): Record<number, number> {
  const R = map.roomCount, far = (a: number, b: number) => (distances(map, roomPos(a)).get(roomPos(b)) ?? 0) >= 10;
  const corner = (a: number, b: number) => (a === 0 && b === 3) || (a === 3 && b === 0) || (a === 1 && b === 2) || (a === 2 && b === 1);
  for (let tries = 0; tries < 200; tries++) {
    const [a, b, c, d] = shuffle(r, Array.from({ length: R }, (_, k) => k));
    if (far(a, b) && far(c, d) && !corner(a, b) && !corner(c, d)) return { [a]: b, [b]: a, [c]: d, [d]: c };
  }
  return { 0: 3, 3: 0, 1: 2, 2: 1 }; // (거의 없음) 못 찾으면 기본 배치
}

export function newGame(theme: ThemeKey, seats: SeatIn[], seed: number, opts: GameOpts = { roles: false, bluff: true }): Game {
  const count = seats.length, map = genMap(count, seed);
  map.people = pieceCount(opts, count); // 오리지널: 인원과 상관없이 용의자 8·도구 8
  if (isOriginal(opts)) map.passages = randomPassages(map, rng(seed ^ 0x5eed)); // 오리지널: 모서리 대각선 대신 판마다 다른 방끼리
  const R = map.roomCount, S = map.people, r = rng(seed ^ 0x9e3779b9);
  // 말: 자리마다 고른 것(겹치거나 없으면 남은 8명 중 무작위)
  const taken = new Set<number>(), suspects: number[] = [];
  const ids = Array.from({ length: PICKS }, (_, v) => v);
  for (const s of seats) { const v = s.suspect; if (v != null && Number.isInteger(v) && v >= 0 && v < PICKS && !taken.has(v)) { taken.add(v); suspects.push(v); } else suspects.push(-1); }
  const free = shuffle(r, ids.filter(v => !taken.has(v)));
  for (let i = 0; i < count; i++) if (suspects[i] < 0) suspects[i] = free.shift()!;
  // 인물 카드: 오리지널 = 8명 전원, 클래식 = 플레이어가 맡은 인물 + 나머지 중 무작위로 채워 S명
  map.cast = isOriginal(opts) ? [...ids] : [...suspects, ...shuffle(r, ids.filter(v => !suspects.includes(v)))].slice(0, S).sort((a, b) => a - b);
  // 도구 카드: 말 고르기와 상관없이 8개 중 무작위 S개(오리지널은 8개 전원)
  map.tools = isOriginal(opts) ? [...ids] : shuffle(r, ids).slice(0, S).sort((a, b) => a - b);
  const all = allCards(map);
  const env = { s: pick(r, all.s), w: pick(r, all.w), r: pick(r, all.r) };
  const rest = shuffle(r, [...all.s, ...all.w, ...all.r].filter(c => c !== env.s && c !== env.w && c !== env.r));
  const per = Math.floor(rest.length / count), open = rest.slice(per * count);
  const C = roomPos(R);
  const players: Player[] = seats.map((s, i) => ({
    name: s.name, bot: !!s.bot, afk: false, suspect: suspects[i], pos: C, fresh: true, // 모두 중앙 사건 파일실에서 출발
    hand: rest.slice(i * per, (i + 1) * per), known: [...open], shown: [], out: false, canSuggest: false, timeouts: 0,
    items: [], tap: 0, skip: false, onBonus: false, usedItem: false,
  }));
  // 인물 NPC 말: 오리지널 = 용의자 8명 전원(suspects[i]는 탐정 번호), 클래식 = 이 판 인물 카드 중 아무도 안 맡은 인물. 카드에 없는 인물은 판에 없음(null)
  const npc = ids.map(v => (isOriginal(opts) || (map.cast!.includes(v) && !suspects.includes(v)) ? C : null));
  const rooms = shuffle(r, Array.from({ length: R }, (_, k) => k)); // 도구 말을 서로 다른 방에 하나씩
  const weapons = ids.map(k => { const t = map.tools!.indexOf(k); return t < 0 ? null : rooms[t]; });
  return { theme, seed, map, players, env, turn: 0, phase: 'roll', roll: null, sug: null, log: [{ t: 'start' }], winner: null, turnNo: 1, rolls: 0, opts, weapons, npc, open };
}

export const centerPos = (map: GameMap): Pos => roomPos(map.roomCount);
export const actor = (g: Pick<Game, 'phase' | 'turn'> & { sug: { refuter: number } | null }): number =>
  (g.phase === 'refute' && g.sug ? g.sug.refuter : g.turn);

function endTurn(g: Game) {
  Object.assign(g.players[g.turn], { canSuggest: false, onBonus: false, usedItem: false });
  let j = g.turn;
  for (let guard = 0; guard < g.players.length * 2; guard++) {
    j = (j + 1) % g.players.length;
    const q = g.players[j];
    if (q.out) continue;
    if (q.skip) { q.skip = false; g.log.push({ t: 'rest', p: j }); continue; } // 보험 수사관: 한 턴 쉼
    break;
  }
  Object.assign(g, { turn: j, phase: 'roll', roll: null, turnNo: g.turnNo + 1 });
}

/** 추리자 sug.p 기준 시계 방향으로, from 다음 사람부터 지목 카드를 가진 첫 사람(추리자 직전까지) */
function nextRefuter(g: Game, sug: Triple & { p: number }, from: number) {
  for (let k = 1; k < g.players.length; k++) {
    const j = (from + k) % g.players.length;
    if (j === sug.p) return null;
    if (g.players[j].left) continue; // 나간 사람은 카드를 공개했으므로 반박 차례 없음
    const matches = g.players[j].hand.filter(c => c === sug.s || c === sug.w || c === sug.r);
    if (matches.length) return { j, matches };
    g.log.push({ t: 'pass', p: j, to: sug.p, s: sug.s, w: sug.w, r: sug.r }); // 클루처럼 "없습니다"를 모두가 앎
  }
  return null;
}
function rollDice(g: Game, i: number, r: Rng) {
  const d: [number, number] = [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)];
  g.roll = d[0] + d[1]; g.rolls++;
  g.log.push({ t: 'roll', p: i, v: g.roll, d, n: g.turnNo, k: g.rolls });
}

/** 지난 남들끼리의 반박(기록 분석가 대상) — 반박 기록 id 목록. known을 주면 이미 아는 카드는 뺀다(서버·봇용) */
export function archiveEntries(g: Pick<Game, 'log'>, i: number, known: Card[] = []): number[] {
  return g.log.flatMap(e => (e.t === 'shown' && e.p !== i && e.to !== i && (!e.card || !known.includes(e.card)) ? [e.id] : []));
}

type ItemState = Pick<Game, 'phase' | 'turn' | 'opts'> & { players: { pos: Pos | null; out: boolean; items?: RoleId[]; usedItem?: boolean }[] };
/** 능력 카드를 내 차례에 지금 낼 수 있는가(조건만, 대상 선택 전). archive = 기록 열람으로 고를 수 있는 반박 수.
 *  turn 카드 = 굴리기 전이나 이동을 마친 뒤, hall 카드 = 지름길은 굴리기 전·복도에 멈춘 뒤, 추격은 복도에 멈춘 뒤만. 묵비권·보험은 여기서 내지 않음. 내 차례에 1장 */
export function canUse(g: ItemState, i: number, role: RoleId, archive: number): boolean {
  const p = g.players[i];
  if (!g.opts.roles || !p || p.out || g.turn !== i || p.usedItem || !p.items?.includes(role)) return false;
  const hall = g.phase === 'act' && p.pos != null && p.pos >= 0;
  switch (ROLES[role].when) {
    case 'turn': return (g.phase === 'roll' || g.phase === 'act') && (role !== 'analyst' || archive > 0);
    case 'hall': return role === 'field' ? hall : g.phase === 'roll' || hall;
    default: return false;
  }
}
const usableNow = (g: Game, i: number) => g.players[i].items.some(k => canUse(g, i, k, archiveEntries(g, i).length));

/** 행동 적용. 성공하면 null, 실패하면 에러 문자열(상태 변경 없음). a는 네트워크에서 온 값일 수 있어 내부에서 전부 검증한다. */
export function act(g: Game, i: number, a: Action, r: Rng = Math.random): string | null {
  if (g.phase === 'over') return '게임이 끝났어요';
  const p = g.players[i], all = allCards(g.map);
  if (!p || !a) return '잘못된 요청';
  if (a.t === 'show') {
    const sug = g.sug;
    if (g.phase !== 'refute' || !sug || sug.refuter !== i) return '반박 차례가 아니에요';
    if (a.silent) { // 묵비권 카드: 다음 사람에게 넘김
      const k = p.items.indexOf('lawyer');
      if (!g.opts.roles || k < 0) return '묵비권 카드가 없어요';
      p.items.splice(k, 1); g.log.push({ t: 'silent', p: i, to: sug.p });
      const nx = nextRefuter(g, sug, i);
      if (nx) { sug.refuter = nx.j; sug.matches = nx.matches; return null; }
      g.log.push({ t: 'silentnone', p: sug.p }); g.sug = null; g.phase = 'act';
      return null;
    }
    const card = a.card;
    if (!card || !sug.matches.includes(card)) return '그 카드는 보여 줄 수 없어요';
    const to = sug.p;
    g.log.push({ t: 'shown', p: i, to, card, id: g.log.length });
    g.players[to].known.push(card);
    if (!p.shown.includes(card)) p.shown.push(card);
    g.players.forEach((q, k) => { // 설치된 도청 장치
      if (q.tap > 0 && k !== i && k !== to) {
        q.tap--; q.known.push(card);
        g.log.push({ t: 'intel', to: k, kind: 'tap', card, a: i, b: to });
      }
    });
    g.sug = null; g.phase = 'act';
    return null;
  }
  if (g.turn !== i) return '내 차례가 아니에요';
  if (g.phase === 'refute') return '반박을 기다리는 중이에요';
  switch (a.t) {
    case 'roll':
      if (g.phase !== 'roll') return '이미 주사위를 굴렸어요';
      rollDice(g, i, r); g.phase = 'move';
      return null;
    case 'move':
      if (!moves(g, i).has(a.to)) return '갈 수 없는 칸이에요';
      { const route = chosenRoute(g, i, a.to, a.via); g.walk = route && { p: i, route }; }
      p.pos = a.to; p.fresh = false; g.phase = 'act';
      if (a.to < 0) { p.canSuggest = a.to !== centerPos(g.map); g.log.push({ t: 'enter', p: i, room: roomOf(a.to) }); return null; }
      // 복도에서 멈춤: 보너스칸이면 능력 카드 1장(최대 MAX_ITEMS장). 지금 낼 수 있는 카드가 있으면 기다리고, 없으면 추리할 수 없으니 턴 종료
      if (g.opts.roles && g.map.bonus.includes(a.to)) {
        p.onBonus = true;
        if (p.items.length >= MAX_ITEMS) g.log.push({ t: 'bonusfull', p: i });
        else { const role = drawRole(r); p.items.push(role); g.log.push({ t: 'bonus', p: i }, { t: 'intel', to: i, kind: 'draw', role }); }
      }
      if (!usableNow(g, i)) endTurn(g);
      return null;
    case 'passage': {
      const o = inRoom(p.pos) ? g.map.passages[roomOf(p.pos)] : undefined;
      if (g.phase !== 'roll' || o === undefined) return '비밀 통로가 없어요';
      p.pos = roomPos(o); p.canSuggest = true; g.phase = 'act';
      g.log.push({ t: 'passage', p: i, room: o });
      return null;
    }
    case 'suggest': {
      if (g.phase === 'move' || !inRoom(p.pos) || !p.canSuggest || p.pos === centerPos(g.map)) return '방에 막 들어왔을 때만 추리할 수 있어요';
      if (!all.s.includes(a.s) || !all.w.includes(a.w)) return '잘못된 카드';
      if (!g.opts.bluff && (p.hand.includes(a.s) || p.hand.includes(a.w))) return '블러핑 금지 방입니다 — 내 손의 카드는 지목할 수 없어요';
      const s: Triple = { s: a.s, w: a.w, r: 'r' + roomOf(p.pos) };
      p.canSuggest = false; g.phase = 'act';
      const sv = +s.s.slice(1), q = g.players.find((x, j) => j !== i && !x.out && x.suspect === sv); // 클래식: 맡은 인물 / 오리지널: 담당 용의자(suspect)의 담당 탐정이 동석
      if (q) { if (q.pos !== p.pos) q.canSuggest = true; q.pos = p.pos; } // 지목된 인물 말을 이 방으로 — 실제로 끌려왔을 때만 다음 차례에 바로 추리 가능(원래 이 방에 있었으면 연속 추리 불가)
      if (g.npc[sv] !== null) g.npc[sv] = p.pos;                  // 인물 NPC 말도(클래식: 아무도 안 맡은 인물, 오리지널: 용의자 전원)
      g.weapons[+s.w.slice(1)] = roomOf(p.pos);                    // 지목한 도구 말도
      g.log.push({ t: 'suggest', p: i, ...s });
      const nx = nextRefuter(g, { ...s, p: i }, i);
      if (nx) { g.sug = { p: i, ...s, refuter: nx.j, matches: nx.matches }; g.phase = 'refute'; return null; }
      g.log.push({ t: 'norefute', p: i, ...s });
      return null;
    }
    case 'accuse': {
      if (p.pos !== centerPos(g.map) || g.phase === 'move') return '최종 고발은 사건 파일실에서만 할 수 있어요';
      if (p.fresh) return '출발한 뒤 다시 들어와야 최종 고발을 할 수 있어요';
      if (!all.s.includes(a.s) || !all.w.includes(a.w) || !all.r.includes(a.r)) return '잘못된 카드';
      const ok = a.s === g.env.s && a.w === g.env.w && a.r === g.env.r;
      const entry: LogEntry = { t: 'accuse', p: i, s: a.s, w: a.w, r: a.r, ok };
      g.log.push(entry);
      if (ok) { g.phase = 'over'; g.winner = i; return null; }
      const ins = g.opts.roles ? p.items.indexOf('insure') : -1;
      if (ins >= 0) { // 보험 카드: 탈락 대신 한 턴 쉼(카드는 사라짐)
        entry.saved = true; p.items.splice(ins, 1);
        p.skip = true; endTurn(g); return null;
      }
      p.out = true; p.pos = null;
      if (g.players.every(x => x.out)) { g.phase = 'over'; g.winner = null; } else endTurn(g);
      return null;
    }
    case 'ability': {
      const role = a.card;
      if (!isRole(role) || !canUse(g, i, role, archiveEntries(g, i).length)) return '지금은 그 능력 카드를 낼 수 없어요';
      const other = (t: unknown) => typeof t === 'number' && t !== i && g.players[t] && !g.players[t].out;
      const spend = () => { p.items.splice(p.items.indexOf(role), 1); p.usedItem = true; };
      switch (role) {
        case 'chief': {
          if (!other(a.target) || !a.cat || !KINDS.includes(a.cat)) return '심문할 사람과 종류를 고르세요';
          const t = a.target!, cards = g.players[t].hand.filter(c => c[0] === a.cat);
          const fresh = cards.filter(c => !p.known.includes(c)), card = cards.length ? pick(r, fresh.length ? fresh : cards) : undefined; // 1장만(모르는 카드 우선)
          spend(); g.log.push({ t: 'ability', p: i, role, target: t });
          if (card) p.known.push(card);
          g.log.push({ t: 'intel', to: i, kind: 'interrogate', card, from: t, cat: a.cat });
          break;
        }
        case 'analyst': {
          const e = g.log.find(x => x.t === 'shown' && x.id === a.entry);
          if (!e || e.t !== 'shown' || e.p === i || e.to === i) return '열람할 반박 기록을 고르세요';
          spend(); p.known.push(e.card!);
          g.log.push({ t: 'ability', p: i, role }, { t: 'intel', to: i, kind: 'archive', card: e.card, a: e.p, b: e.to });
          break;
        }
        case 'scout': {
          const room = a.room;
          if (typeof room !== 'number' || !Number.isInteger(room) || room < 0 || room >= g.map.roomCount) return '수색할 방을 고르세요';
          spend(); g.log.push({ t: 'ability', p: i, role, room });
          const found = ['r' + room]; // 그 방의 장소 카드
          for (const card of found) {
            if (p.hand.includes(card) || g.open.includes(card)) continue; // 이미 아는 카드
            const owner = g.players.findIndex(q => q.hand.includes(card));
            if (owner >= 0) p.known.push(card);
            else { const k = card[0] as Kind; for (const c of all[k]) if (c !== card && !p.known.includes(c)) p.known.push(c); } // 아무도 없음 = 진실
            g.log.push({ t: 'intel', to: i, kind: 'search', card, from: owner >= 0 ? owner : null });
          }
          break;
        }
        case 'tap':
          spend(); p.tap += TAP_PEEKS; // 설치했다는 사실만 공개
          g.log.push({ t: 'ability', p: i, role });
          break;
        case 'guide': {
          const room = a.room;
          if (typeof room !== 'number' || !Number.isInteger(room) || room < 0 || room > g.map.roomCount || roomPos(room) === p.pos) return '이동할 방을 고르세요';
          spend(); g.walk = null; // room === roomCount = 사건 파일실(추리는 못 하고 최종 고발 가능)
          p.pos = roomPos(room); p.canSuggest = room < g.map.roomCount; p.fresh = false; g.phase = 'act'; g.roll = null;
          g.log.push({ t: 'ability', p: i, role, room }, { t: 'enter', p: i, room });
          return null; // 이어서 추리 가능
        }
        case 'field':
          spend(); g.log.push({ t: 'ability', p: i, role });
          rollDice(g, i, r); g.phase = 'move';
          return null; // 이어서 이동
        default: return '이 카드는 지금 낼 수 없어요';
      }
      // 복도에 멈춘 뒤 정보 카드를 냈으면 추리할 수 없으니 턴 끝
      if (g.phase === 'act' && p.pos != null && p.pos >= 0) endTurn(g);
      return null;
    }
    case 'end':
      if (!canEnd(g, i)) return g.phase === 'roll' ? '먼저 주사위를 굴리세요' : g.phase === 'move' ? '먼저 말을 이동하세요' : '지금은 턴을 끝낼 수 없어요';
      endTurn(g); return null;
  }
  return '알 수 없는 행동';
}

/** 게임 중 나감: 봇이 대신하지 않고 탈락. 가진 카드는 모두에게 공개(반박할 사람이 사라지므로), 그 사람 차례·반박 중이었으면 넘김 */
export function leave(g: Game, i: number): void {
  const p = g.players[i];
  if (!p || p.left || g.phase === 'over') return;
  Object.assign(p, { left: true, out: true, pos: null, afk: false });
  g.open.push(...p.hand); p.hand = [];
  g.log.push({ t: 'left', p: i });
  const sug = g.sug;
  if (g.phase === 'refute' && sug && sug.refuter === i && sug.p !== i) {
    const nx = nextRefuter(g, sug, i);
    if (nx) { sug.refuter = nx.j; sug.matches = nx.matches; }
    else { g.log.push({ t: 'norefute', p: sug.p, s: sug.s, w: sug.w, r: sug.r }); g.sug = null; g.phase = 'act'; }
  }
  if (g.players.every(x => x.out)) { g.phase = 'over'; g.winner = null; return; }
  if (g.turn === i) { g.sug = null; endTurn(g); }
}

// 제한 시간 초과 처리. 반박은 맞는 카드 중 하나 자동 공개, 턴은 넘김. 2연속이면 자리비움(봇).
export function timeout(g: Game, r: Rng = Math.random): void {
  if (g.phase === 'over') return;
  const i = actor(g), p = g.players[i];
  p.timeouts++;
  if (p.timeouts >= 2 && !p.afk && !p.bot) { p.afk = true; g.log.push({ t: 'afk', p: i }); }
  if (g.phase === 'refute' && g.sug) { act(g, i, { t: 'show', card: pick(r, g.sug.matches) }); return; }
  g.log.push({ t: 'timeout', p: i });
  endTurn(g);
}

export function candidates(g: Game, i: number): Record<Kind, Card[]> {
  const p = g.players[i], known = new Set([...p.hand, ...p.known]), all = allCards(g.map);
  const c = { s: all.s.filter(x => !known.has(x)), w: all.w.filter(x => !known.has(x)), r: all.r.filter(x => !known.has(x)) };
  for (const e of g.log) if (e.t === 'norefute' && e.p === i) for (const k of KINDS) if (!p.hand.includes(e[k])) c[k] = [e[k]];
  return c;
}

function distFrom(map: GameMap, src: Pos): Map<Pos, number> { return distances(map, src); }

/** 봇이 지금 낼 능력 카드(없으면 null). 정보 카드는 아직 모르는 게 남았을 때만, 지름길은 갈 후보 방이 있고 지금 방에서 추리할 수 없을 때, 추격은 복도에 멈췄을 때 */
function botItem(g: Game, i: number, c: Record<Kind, Card[]>, solved: boolean, r: Rng): Action | null {
  const p = g.players[i], arch = archiveEntries(g, i, p.known);
  const can = (k: RoleId) => canUse(g, i, k, archiveEntries(g, i).length);
  if (solved) return can('guide') && p.pos !== centerPos(g.map) ? { t: 'ability', card: 'guide', room: g.map.roomCount } : null;
  const here = inRoom(p.pos) && p.canSuggest && p.pos !== centerPos(g.map);
  if (can('guide') && !here) {
    const rooms = c.r.map(x => +x.slice(1)).filter(x => roomPos(x) !== p.pos);
    if (rooms.length) return { t: 'ability', card: 'guide', room: pick(r, rooms) };
  }
  if (can('field')) return { t: 'ability', card: 'field' };
  if (can('analyst') && arch.length) return { t: 'ability', card: 'analyst', entry: pick(r, arch) };
  if (can('scout')) {
    const rooms = c.r.map(x => +x.slice(1)).filter(x => !p.hand.includes('r' + x));
    const score = (x: number) => g.weapons.filter((wr, k) => wr === x && c.w.includes('w' + k)).length;
    rooms.sort((x, y) => score(y) - score(x));
    if (rooms.length && c.r.length > 1) return { t: 'ability', card: 'scout', room: rooms[0] };
  }
  if (can('chief')) {
    const t = pick(r, g.players.map((_, j) => j).filter(j => j !== i && !g.players[j].out));
    const cat = [...KINDS].sort((x, y) => c[y].length - c[x].length)[0];
    if (t !== undefined && c[cat].length > 1) return { t: 'ability', card: 'chief', target: t, cat };
  }
  if (can('tap') && g.players.filter(q => !q.out).length > 2) return { t: 'ability', card: 'tap' };
  return null;
}

// 봇: 모르는 카드만 후보로 두고 후보 방으로 이동해 추리, 후보가 하나씩 남으면 중앙으로 가서 최종 고발.
// 능력 카드: 후보 방에 못 닿는 턴에 보너스칸이 닿으면(카드가 3장 미만일 때) 거기 멈춰 1장 뽑고, 낼 수 있는 카드는 바로 낸다.
export function botAction(g: Game, r: Rng = Math.random): Action {
  const i = actor(g), p = g.players[i];
  if (g.phase === 'refute' && g.sug) {
    if (g.opts.roles && p.items.includes('lawyer') && r() < 0.5) return { t: 'show', silent: true };
    return { t: 'show', card: g.sug.matches.find(c => p.shown.includes(c)) ?? pick(r, g.sug.matches) };
  }
  const c = candidates(g, i);
  const solved0 = c.s.length === 1 && c.w.length === 1 && c.r.length === 1;
  if (g.phase === 'roll' || g.phase === 'act') { const it = botItem(g, i, c, solved0, r); if (it) return it; }
  const solved = c.s.length === 1 && c.w.length === 1 && c.r.length === 1, C = centerPos(g.map);
  if (solved && p.pos === C && !p.fresh && g.phase !== 'move') return { t: 'accuse', s: c.s[0], w: c.w[0], r: c.r[0] };
  if (!solved && inRoom(p.pos) && p.canSuggest && g.phase !== 'move') {
    const ok = (x: Card) => g.opts.bluff || !p.hand.includes(x);
    return { t: 'suggest', s: pick(r, c.s.filter(ok).length ? c.s.filter(ok) : c.s), w: pick(r, c.w.filter(ok).length ? c.w.filter(ok) : c.w) };
  }
  let goals = solved ? [C] : c.r.map(x => roomPos(+x.slice(1))).filter(x => x !== p.pos);
  // 남은 후보 방이 지금 있는 방뿐이면 다른 방으로 나갔다가 다시 와야 한다
  if (!goals.length) goals = Array.from({ length: g.map.roomCount }, (_, k) => roomPos(k)).filter(x => x !== p.pos);
  if (g.phase === 'roll') {
    const o = inRoom(p.pos) ? g.map.passages[roomOf(p.pos)] : undefined;
    return o !== undefined && goals.includes(roomPos(o)) ? { t: 'passage' } : { t: 'roll' };
  }
  if (g.phase === 'move') {
    const opts = [...moves(g, i)];
    const hit = opts.find(o => goals.includes(o));
    if (hit !== undefined) return { t: 'move', to: hit };
    if (!solved && g.opts.roles && p.items.length < MAX_ITEMS) {
      const b = opts.find(o => g.map.bonus.includes(o));
      if (b !== undefined) return { t: 'move', to: b };
    }
    const dists = goals.map(gl => distFrom(g.map, gl));
    let best: Pos | null = null, bd = Infinity;
    for (const o of opts) {
      if (o < 0) continue;
      const d = Math.min(...dists.map(m => m.get(o) ?? Infinity));
      if (d < bd) { bd = d; best = o; }
    }
    return best !== null ? { t: 'move', to: best } : opts.length ? { t: 'move', to: opts[0] } : { t: 'end' }; // 복도 칸이 없으면 아무 방이라도
  }
  return { t: 'end' };
}

// 플레이어 i에게 보낼 정보만 추린다. 다른 사람 패는 비공개, 봉투는 게임 종료 또는 본인이 최종 고발에 실패해 탈락했을 때만(봉투를 열어 봤으므로).
export function view(g: Game, i: number): View {
  const me = g.players[i], over = g.phase === 'over', spect = !!me?.out;
  return {
    // seed 자리에는 공개 id만(진짜 시드로 패를 역산하지 못하게)
    theme: g.theme, seed: g.pub ?? g.seed, map: g.map, turn: g.turn, phase: g.phase, roll: g.roll, turnNo: g.turnNo, winner: g.winner, me: i,
    players: g.players.map((p, j) => ({
      name: p.name, suspect: p.suspect, pos: p.pos, out: p.out, bot: p.bot, afk: p.afk, handCount: p.hand.length, left: p.left,
      canSuggest: j === i ? p.canSuggest : undefined, fresh: p.fresh, hand: j === i || over ? p.hand : undefined,
      itemCount: p.items.length,
      ...(j === i ? { items: p.items, tap: p.tap, onBonus: p.onBonus, usedItem: p.usedItem } : over ? { items: p.items } : {}),
    })),
    sug: g.sug && { p: g.sug.p, s: g.sug.s, w: g.sug.w, r: g.sug.r, refuter: g.sug.refuter, matches: g.sug.refuter === i ? g.sug.matches : undefined },
    // 비공개 정보(intel)는 받는 사람(또는 게임 종료 후)만 보고, 오래돼도 잘리지 않게 40개 제한과 별개로 유지.
    log: g.log.filter((e, k) => (e.t === 'intel' ? (e.to === i || over) && (e.kind !== 'draw' || k >= g.log.length - 40) : k >= g.log.length - 40))
      .map(e => (e.t === 'shown' && !(over || spect || e.p === i || e.to === i) ? { t: 'shown', p: e.p, to: e.to, id: e.id } : e)),
    env: over || spect ? g.env : undefined, opts: g.opts, weapons: g.weapons, npc: g.npc, open: g.open,
    archive: g.log.flatMap(e => (e.t === 'shown' && e.p !== i && e.to !== i ? [{ id: e.id, p: e.p, to: e.to }] : [])),
    walk: g.walk ?? null,
  };
}
