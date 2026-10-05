/** Tiny localStorage boolean helpers (private-mode safe). */

export function loadBoolPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
}

export function saveBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

export const SHOW_AV_CONTROLS_KEY = 'pkmn-champions-show-av-controls';
export const AUTO_RECOGNIZE_KEY = 'pkmn-champions-auto-recognize';
/** Default off. When on, each 辨認敵方隊伍 (manual or auto) downloads the capture frame. */
export const SAVE_RECOGNIZE_FRAMES_KEY = 'pkmn-champions-save-recognize-frames';
