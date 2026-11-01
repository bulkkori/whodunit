// 서버 ↔ 브라우저 WebSocket 메시지 형식
import type { Action, GameOpts, ThemeKey, View } from './game.ts';

export type ClientMsg =
  | { t: 'create'; theme: ThemeKey; name: string; token: string; opts?: Partial<GameOpts> }
  | { t: 'join'; code: string; name: string; token: string }
  | { t: 'act'; action: Action }
  | { t: 'theme'; theme: ThemeKey }
  | { t: 'opt'; roles?: boolean; bluff?: boolean }
  /** 대기실에서 내 인물 말 고르기 */
  | { t: 'pick'; suspect: number }
  | { t: 'addBot' } | { t: 'removeBot' } | { t: 'start' } | { t: 'again' };

export interface SeatView { name: string; bot: boolean; online: boolean; suspect: number | null }
export interface StateMsg {
  t: 'state'; code: string; theme: ThemeKey; you: number; host: boolean;
  seats: SeatView[]; game: View | null; opts: GameOpts;
  /** 현재 차례 남은 시간(ms). 서버·브라우저 시계 차이를 피하려고 절대 시각 대신 남은 시간을 보낸다 */
  left: number | null;
  /** 게임 시작 연출이 끝나기까지 남은 시간(ms). 이 동안 타이머·봇이 멈춘다 */
  intro: number;
}
export type ServerMsg = StateMsg | { t: 'error'; msg: string };
