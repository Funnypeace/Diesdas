
export enum GameState {
  IDLE,
  RUNNING,
  ENDED
}

export interface Chicken {
  id: number;
  x: number;
  y: number;
  speed: number;
  direction: 'left' | 'right';
  isHit: boolean;
  type: 'slow' | 'normal' | 'fast';
}
