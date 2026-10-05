/**
 * getUserMedia 視訊／音訊來源：AverMedia GC551 擷取卡優先，其次 OBS Virtual Camera。
 * 裝置選擇會記住 deviceId（localStorage）。
 */

export interface VideoDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export const DEVICE_STORAGE_KEY = 'pkmn-champions-video-device';
export const AUDIO_DEVICE_STORAGE_KEY = 'pkmn-champions-audio-device';

const PREFERRED_LABEL_RE = /gc551|avermedia|aver.?media/i;
const OBS_LABEL_RE = /obs/i;

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;
const TARGET_FPS = 60;

const FORMAT_ALIASES: Record<string, string> = {
  mjpeg: 'MJPG',
  mjpg: 'MJPG',
  'video/mjpeg': 'MJPG',
  'video/x-motion-jpeg': 'MJPG',
  yuy2: 'YUY2',
  yuyv: 'YUY2',
  yuyv422: 'YUY2',
  nv12: 'NV12',
  i420: 'I420',
  rgb24: 'RGB24',
};

type ExtraTrackSettings = MediaTrackSettings & Record<string, unknown>;

export function isPreferredCaptureDevice(label: string): boolean {
  return PREFERRED_LABEL_RE.test(label);
}

export function isObsVirtualCam(label: string): boolean {
  return OBS_LABEL_RE.test(label);
}

/** 排序：GC551/AVerMedia → OBS → 其餘 */
export function rankVideoDevices(devices: VideoDevice[]): VideoDevice[] {
  return [...devices].sort((a, b) => {
    const score = (d: VideoDevice) => {
      if (isPreferredCaptureDevice(d.label)) return 0;
      if (isObsVirtualCam(d.label)) return 1;
      return 2;
    };
    return score(a) - score(b);
  });
}

export function rankAudioDevices(
  devices: AudioDevice[],
  videoGroupId?: string | null,
): AudioDevice[] {
  return [...devices].sort((a, b) => {
    const score = (d: AudioDevice) => {
      if (isPreferredCaptureDevice(d.label)) return 0;
      if (videoGroupId && d.groupId && d.groupId === videoGroupId) return 1;
      if (isObsVirtualCam(d.label)) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
}

export function pickPreferredDeviceId(
  devices: VideoDevice[],
  savedId?: string | null,
): string {
  if (savedId && devices.some((d) => d.deviceId === savedId)) return savedId;
  const ranked = rankVideoDevices(devices);
  return ranked[0]?.deviceId ?? '';
}

export function pickPreferredAudioDeviceId(
  devices: AudioDevice[],
  savedId?: string | null,
  videoGroupId?: string | null,
): string {
  if (savedId && devices.some((d) => d.deviceId === savedId)) return savedId;
  const ranked = rankAudioDevices(devices, videoGroupId);
  return ranked[0]?.deviceId ?? '';
}

export function loadSavedDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveDeviceId(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    else localStorage.removeItem(DEVICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSavedAudioDeviceId(): string | null {
  try {
    return localStorage.getItem(AUDIO_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveAudioDeviceId(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(AUDIO_DEVICE_STORAGE_KEY, deviceId);
    else localStorage.removeItem(AUDIO_DEVICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function probePermission(kind: 'video' | 'audio'): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'video' ? { video: true, audio: false } : { video: false, audio: true },
    );
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* labels may stay empty; listing still proceeds */
  }
}

async function enumerateKind(
  kind: 'videoinput' | 'audioinput',
  unlabeled: string,
): Promise<Array<{ deviceId: string; label: string; groupId?: string }>> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === kind)
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `${unlabeled} ${i + 1}`,
      groupId: d.groupId || undefined,
    }));
}

export async function listVideoDevices(opts?: { probe?: boolean }): Promise<VideoDevice[]> {
  try {
    // 部分瀏覽器需先取得權限才會顯示 label；已有 live stream 時唔好 probe，以免搶走鏡頭。
    if (opts?.probe !== false) await probePermission('video');
    return rankVideoDevices(await enumerateKind('videoinput', '攝影機'));
  } catch {
    return [];
  }
}

export async function listAudioDevices(opts?: { probe?: boolean }): Promise<AudioDevice[]> {
  try {
    if (opts?.probe !== false) await probePermission('audio');
    return await enumerateKind('audioinput', '音訊輸入');
  } catch {
    return [];
  }
}

/** 列出音訊裝置但不主動要麥克風權限（避免打斷視訊連線）。 */
export async function listAudioDevicesSilent(): Promise<AudioDevice[]> {
  return listAudioDevices({ probe: false });
}

function supportedConstraintMap(): Record<string, boolean> {
  try {
    return (navigator.mediaDevices.getSupportedConstraints?.() ?? {}) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function buildVideoConstraints(deviceId: string | undefined, preferMjpeg: boolean): MediaTrackConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: TARGET_WIDTH },
    height: { ideal: TARGET_HEIGHT },
    frameRate: { ideal: TARGET_FPS },
    aspectRatio: { ideal: 16 / 9 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };

  const supported = supportedConstraintMap();
  const advanced: MediaTrackConstraintSet[] = [];

  if (preferMjpeg) {
    // Chromium / Electron 偶有非標準 format／pixelFormat；有就優先 MJPEG 減 USB 頻寬。
    if (supported.pixelFormat) {
      advanced.push({ pixelFormat: 'mjpeg' } as MediaTrackConstraintSet);
    }
    if (supported.format) {
      advanced.push({ format: 'mjpeg' } as MediaTrackConstraintSet);
    }
  }

  if (advanced.length) video.advanced = advanced;
  return video;
}

async function tryPreferMjpeg(track: MediaStreamTrack): Promise<void> {
  const supported = supportedConstraintMap();
  const keys = ['pixelFormat', 'format'] as const;
  const values = ['mjpeg', 'MJPG', 'MJPEG'];
  for (const key of keys) {
    if (!supported[key]) continue;
    for (const value of values) {
      try {
        await track.applyConstraints({
          advanced: [{ [key]: value } as MediaTrackConstraintSet],
        });
        return;
      } catch {
        /* try next */
      }
    }
  }
}

async function applyIdeal1080p60(track: MediaStreamTrack): Promise<void> {
  try {
    await track.applyConstraints({
      width: { ideal: TARGET_WIDTH },
      height: { ideal: TARGET_HEIGHT },
      frameRate: { ideal: TARGET_FPS },
    });
  } catch {
    /* keep whatever the device granted */
  }
  await tryPreferMjpeg(track);
}

export async function openVideoStream(deviceId?: string): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: buildVideoConstraints(deviceId, true) },
    { audio: false, video: buildVideoConstraints(deviceId, false) },
    {
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    },
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
      const track = stream.getVideoTracks()[0];
      if (track) await applyIdeal1080p60(track);
      return stream;
    } catch (e) {
      lastError = e;
      const name = (e as DOMException | undefined)?.name ?? '';
      // 權限／占用／找不到裝置：唔好再試較寬約束，直接交俾 UI 分類。
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') throw e;
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') throw e;
      if (name === 'NotReadableError' || name === 'AbortError') throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('無法開啟擷取裝置');
}

export async function openAudioStream(deviceId?: string): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export function classifyGetUserMediaError(e: unknown, kind: 'video' | 'audio' = 'video'): string {
  const err = e as DOMException | Error | undefined;
  const name = (err && 'name' in err ? err.name : '') || '';
  const msg = (err?.message || '').toLowerCase();

  if (kind === 'audio') {
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return '擷取卡無音訊裝置或未授權麥克風權限';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '擷取卡無音訊裝置或未授權麥克風權限';
    }
    return '擷取卡無音訊裝置或未授權麥克風權限';
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '無權限：瀏覽器／系統未授權攝影機。請允許鏡頭權限後重試。';
  }
  if (
    name === 'NotReadableError' ||
    name === 'AbortError' ||
    msg.includes('in use') ||
    msg.includes('busy') ||
    msg.includes('occupied')
  ) {
    return '裝置占用：擷取卡正被其他程式使用（AVerMedia 軟體、OBS、其他分頁）。請關閉後重試。';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '無支援解析度：裝置無法提供 1920×1080 60fps。請確認 GC551／遊戲機輸出為 1080p60。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '找不到擷取裝置。請確認 GC551 已接上，或改選 OBS Virtual Camera。';
  }
  return err?.message || '無法開啟擷取裝置';
}

export function formatFromTrackSettings(settings: MediaTrackSettings): string | undefined {
  const extra = settings as ExtraTrackSettings;
  const candidates = [extra.pixelFormat, extra.format, extra.mimeType];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || !raw) continue;
    const lower = raw.toLowerCase();
    const compact = lower.replace(/[\s_-]/g, '');
    return FORMAT_ALIASES[lower] || FORMAT_ALIASES[compact] || raw.toUpperCase();
  }
  return undefined;
}

/** 實機訊號摘要，例如 `1920×1080 @ 60 · YUY2` */
export function describeCaptureSignal(
  video: HTMLVideoElement,
  track?: MediaStreamTrack | null,
): string {
  const settings = track?.getSettings() ?? {};
  const w = video.videoWidth || settings.width || 0;
  const h = video.videoHeight || settings.height || 0;
  const fpsRaw = settings.frameRate;
  const fps = typeof fpsRaw === 'number' && fpsRaw > 0 ? Math.round(fpsRaw) : 0;
  const format = track ? formatFromTrackSettings(settings) : undefined;
  if (!w || !h) return '';
  const fpsPart = fps ? ` @ ${fps}` : '';
  const fmtPart = format ? ` · ${format}` : ' · YUY2|MJPG';
  return `${w}×${h}${fpsPart}${fmtPart}`;
}

export function waitForVideoDimensions(
  video: HTMLVideoElement,
  timeoutMs = 2500,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const started = performance.now();
    const finish = () => {
      resolve({ width: video.videoWidth || 0, height: video.videoHeight || 0 });
    };
    const tick = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        finish();
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        finish();
        return;
      }
      requestAnimationFrame(tick);
    };
    video.addEventListener('loadedmetadata', tick, { once: true });
    tick();
  });
}

/** 從 video 元素抓一幀到 canvas（單次，非連續） */
export function grabFrame(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas');
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('無法取得 canvas context');
  ctx.drawImage(video, 0, 0, w, h);
  return c;
}

/** 從靜態圖／ImageBitmap 抓到 canvas（驗收用：team-preview.png） */
export function grabImageSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('無法取得 canvas context');
  ctx.drawImage(source, 0, 0, width, height);
  return c;
}

/** `recognize-frame-YYYYMMDD-HHMMSS-mmm.png` — browser/Electron download (Downloads). */
export function recognizeFrameFilename(when = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = [
    when.getFullYear(),
    pad(when.getMonth() + 1),
    pad(when.getDate()),
  ].join('');
  const clock = [pad(when.getHours()), pad(when.getMinutes()), pad(when.getSeconds())].join('');
  return `recognize-frame-${stamp}-${clock}-${pad(when.getMilliseconds(), 3)}.png`;
}

/**
 * Save the full game/capture frame that recognition just used.
 * Web and Electron both use a browser download (no extra filesystem bridge).
 */
export function downloadRecognizeFrame(canvas: HTMLCanvasElement, when = new Date()): void {
  let href = '';
  try {
    href = canvas.toDataURL('image/png');
  } catch {
    return;
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = recognizeFrameFilename(when);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
