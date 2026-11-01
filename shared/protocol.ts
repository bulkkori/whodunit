// 서버 ↔ 브라우저 WebSocket 메시지 형식
import type { Action, GameOpts, ThemeKey, View } from './game.ts';

export type ClientMsg =
  | { t: 'create'; theme: ThemeKey; name: string; token: string; opts?: Partial<GameOpts>; title?: string; maxPlayers?: number }
  | { t: 'join'; code: string; name: string; token: string }
  | { t: 'act'; action: Action }
  | { t: 'theme'; theme: ThemeKey }
  | { t: 'opt'; roles?: boolean; bluff?: boolean; voice?: boolean }
  /** 말 고르기 단계에서 내 인물 말 고르기 */
  | { t: 'pick'; suspect: number }
  /** 대기실: 준비 완료 / 방장: 최대 인원 변경 */
  | { t: 'ready'; on: boolean } | { t: 'maxp'; n: number }
  | { t: 'addBot' } | { t: 'removeBot' } | { t: 'start' } | { t: 'again' }
  /** 스스로 나가기: 게임 중이면 탈락(카드 공개), 대기실이면 자리 비움 */
  | { t: 'leave' }
  /** 방장(대기실): 자리 i 사람 내보내기 / 방장 넘기기. name은 그 사이 자리가 바뀌었는지 확인용 */
  | { t: 'kick'; i: number; name: string } | { t: 'host'; i: number; name: string };

export interface SeatView { name: string; bot: boolean; online: boolean; suspect: number | null; ready: boolean; host: boolean }
export interface StateMsg {
  t: 'state'; code: string; title: string; maxPlayers: number; stage: 'lobby' | 'pick' | 'game'; pickLeft: number;
  theme: ThemeKey; you: number; host: boolean;
  seats: SeatView[]; game: View | null; opts: GameOpts;
  /** 현재 차례 남은 시간(ms). 서버·브라우저 시계 차이를 피하려고 절대 시각 대신 남은 시간을 보낸다 */
  left: number | null;
  /** 게임 시작 연출이 끝나기까지 남은 시간(ms). 이 동안 타이머·봇이 멈춘다 */
  intro: number;
}
export type ServerMsg = StateMsg | { t: 'error'; msg: string } | { t: 'kicked' };
