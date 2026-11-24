/** Enemy slots keep the order of the capture, cards and speed rows. */
export interface EnemyFocus {
  scarfSlot: number | null;
  toggleScarf: (slot: number) => void;
  active: number | null;
  pinned: number | null;
  hover: (slot: number | null) => void;
  pin: (slot: number) => void;
}
