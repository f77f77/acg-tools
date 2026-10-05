/// <reference types="vite/client" />

/** Injected from package.json `version` in vite.config.ts — bump there only. */
declare const __APP_VERSION__: string;

interface PkmnBridge {
  platform: string;
  versions: { node: string; chrome: string; electron: string };
}

interface Window {
  pkmnBridge?: PkmnBridge;
}
