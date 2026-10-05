/** App version — sourced from package.json via Vite `define` (`__APP_VERSION__`). */
export const APP_VERSION: string = __APP_VERSION__;

/** Header / title display: `1.3.0` → `v1.3` (major.minor). */
export function formatAppVersion(version: string = APP_VERSION): string {
  const [major = '0', minor = '0'] = version.split('.');
  return `v${major}.${minor}`;
}

export const APP_NAME = 'Pokémon Champions 對戰助手';

export const SHOWDOWN_TEAMBUILDER_URL = 'https://play.pokemonshowdown.com/teambuilder';
