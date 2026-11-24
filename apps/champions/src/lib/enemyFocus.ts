/** Enemy slots keep the order of the capture, cards and speed rows. */
export interface EnemyFocus {
  active: number | null;
  pinned: number | null;
  hover: (slot: number | null) => void;
  pin: (slot: number) => void;
}
