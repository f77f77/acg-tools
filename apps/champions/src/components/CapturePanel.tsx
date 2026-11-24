import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  listVideoDevices,
  listAudioDevices,
  listAudioDevicesSilent,
  openVideoStream,
  openAudioStream,
  stopStream,
  pickPreferredDeviceId,
  pickPreferredAudioDeviceId,
  loadSavedDeviceId,
  saveDeviceId,
  loadSavedAudioDeviceId,
  saveAudioDeviceId,
  isPreferredCaptureDevice,
  grabFrame,
  grabImageSource,
  downloadRecognizeFrame,
  classifyGetUserMediaError,
  describeCaptureSignal,
  waitForVideoDimensions,
  type VideoDevice,
  type AudioDevice,
} from '../lib/videoSource';
import {
  resolveEnemyPanel,
  panelCssPercent,
  cardCssPercent,
  thumbCssPercent,
  SLOT_COUNT,
  fixtureTeamPreviewUrl,
  currentFixtureLabel,
  type RoiFineTune,
} from '../lib/recognize';
import type { EnemyFocus } from '../lib/enemyFocus';
import type { PokemonSet } from '../types';
import {
  AUTO_RECOGNIZE_TICK_MS,
  autoRecognizePhaseLabel,
  detectTeamPreviewAnchors,
  initialAutoRecognizeState,
  stepAutoRecognize,
  type AutoRecognizeState,
} from '../lib/previewAnchors';

interface Props {
  onSourceChange: () => void;
  busy: boolean;
  /** 單幀 canvas（鏡頭或靜態選隊圖），走同一套 ROI → thumb → recognize */
  onRecognize: (canvas: HTMLCanvasElement, fresh?: boolean) => void;
  statusText: string;
  fineTune: RoiFineTune;
  debugOverlay: boolean;
  enemyTeam: PokemonSet[];
  enemyFocus: EnemyFocus;
  autoRecognize?: boolean;
  /** When on, manual and automatic 辨認敵方隊伍 download the capture frame. */
  saveRecognizeFrames?: boolean;
}

export interface CapturePanelHandle {
  recognizeNow: () => void;
}

export const CapturePanel = forwardRef<CapturePanelHandle, Props>(function CapturePanel(
  {
    busy,
    onRecognize,
    onSourceChange,
    statusText,
    fineTune,
    debugOverlay,
    enemyTeam,
    enemyFocus,
    autoRecognize = false,
    saveRecognizeFrames = false,
  }: Props,
  ref,
) {
  const sourceMenu = useRef<HTMLDetailsElement>(null);
  const closeSources = () => { if (sourceMenu.current) sourceMenu.current.open = false; };

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stillImgRef = useRef<HTMLImageElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoStateRef = useRef<AutoRecognizeState>(initialAutoRecognizeState());
  const streamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const stillUrlRef = useRef<string | null>(null);
  const [devices, setDevices] = useState<VideoDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [framesOk, setFramesOk] = useState(false);
  const [signalMeta, setSignalMeta] = useState('');
  const [listen, setListen] = useState(false);
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const [stillReady, setStillReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [autoPhase, setAutoPhase] = useState<AutoRecognizeState['phase']>('idle');
  const [fullscreen, setFullscreen] = useState(false);

  const panel = useMemo(() => resolveEnemyPanel(fineTune), [fineTune]);
  const panelPct = useMemo(() => panelCssPercent(panel), [panel]);
  const hasValidFrames = framesOk || (!!stillUrl && stillReady);
  const trackLive = live;

  const selectedVideo = devices.find((d) => d.deviceId === deviceId);

  useEffect(() => {
    if (!live) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    const update = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setFramesOk(true);
        setSignalMeta(describeCaptureSignal(video, stream.getVideoTracks()[0]));
      }
    };
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('loadeddata', update);
    const id = window.setInterval(update, 400);
    update();
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('loadeddata', update);
      window.clearInterval(id);
    };
  }, [live]);

  useEffect(() => {
    let cancelled = false;

    async function refreshDevices(probeVideo: boolean) {
      try {
        const videoList = await listVideoDevices({ probe: probeVideo });
        if (cancelled) return;
        setDevices(videoList);
        setDeviceId((prev) => pickPreferredDeviceId(videoList, prev || loadSavedDeviceId()));
        const audioList = await listAudioDevicesSilent();
        if (cancelled) return;
        setAudioDevices(audioList);
        const videoGroup =
          videoList.find((d) => d.deviceId === pickPreferredDeviceId(videoList, loadSavedDeviceId()))
            ?.groupId;
        setAudioDeviceId((audioPrev) =>
          pickPreferredAudioDeviceId(audioList, audioPrev || loadSavedAudioDeviceId(), videoGroup),
        );
      } catch {
        if (!cancelled) {
          setDevices([]);
          setAudioDevices([]);
        }
      }
    }

    void refreshDevices(true);
    const onDeviceChange = () => {
      void refreshDevices(false);
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      stopStream(streamRef.current);
      stopStream(audioStreamRef.current);
      if (stillUrlRef.current) {
        URL.revokeObjectURL(stillUrlRef.current);
        stillUrlRef.current = null;
      }
    };
  }, []);

  function revokeStill() {
    if (stillUrlRef.current) {
      URL.revokeObjectURL(stillUrlRef.current);
      stillUrlRef.current = null;
    }
    setStillUrl(null);
    setStillReady(false);
  }

  function onDeviceChange(id: string) {
    setDeviceId(id);
    saveDeviceId(id);
  }

  function onAudioDeviceChange(id: string) {
    setAudioDeviceId(id);
    saveAudioDeviceId(id);
  }

  function loadStillFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('請選擇圖片檔（image/*）');
      return;
    }
    // 靜態圖覆寫預覽，直到使用者重新開啟鏡頭
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setFramesOk(false);
    setSignalMeta('');

    revokeStill();
    const url = URL.createObjectURL(file);
    stillUrlRef.current = url;
    setStillUrl(url);
    onSourceChange();
    closeSources();
    setStillReady(false);
    setError(null);
  }

  /** 載入內建 Team Preview 測試圖（最新實機畫面） */
  function loadFixtureStill() {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setFramesOk(false);
    setSignalMeta('');
    revokeStill();
    // 非 blob URL，revokeStill 不會誤撤銷
    const label = currentFixtureLabel();
    setStillUrl(fixtureTeamPreviewUrl(true));
    onSourceChange();
    closeSources();
    setStillReady(false);
    setError(null);
    console.info('[fixtures] loaded', label);
  }

  function readSignal(video: HTMLVideoElement, stream: MediaStream): string {
    const track = stream.getVideoTracks()[0];
    return describeCaptureSignal(video, track);
  }

  async function connect() {
    setError(null);
    try {
      revokeStill();
      stopStream(streamRef.current);
      streamRef.current = null;
      setFramesOk(false);
      setSignalMeta('');
      const stream = await openVideoStream(deviceId || undefined);
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
        const dims = await waitForVideoDimensions(video);
        const meta = readSignal(video, stream);
        setSignalMeta(meta);
        // 有非零畫面＝擷取成功；盒上 Signal Out of Range 唔當無訊號。
        if (dims.width > 0 && dims.height > 0) {
          setFramesOk(true);
        } else {
          setFramesOk(false);
        }
      }
      if (deviceId) saveDeviceId(deviceId);
      setLive(true);
      onSourceChange();
      closeSources();
      // 連線後再 enumerate，補齊 label／groupId；probe:false 以免搶走 live track。
      try {
        const videoList = await listVideoDevices({ probe: false });
        setDevices(videoList);
        const audioList = await listAudioDevicesSilent();
        setAudioDevices(audioList);
        setAudioDeviceId((prev) =>
          pickPreferredAudioDeviceId(
            audioList,
            prev || loadSavedAudioDeviceId(),
            videoList.find((d) => d.deviceId === (deviceId || pickPreferredDeviceId(videoList)))
              ?.groupId,
          ),
        );
      } catch {
        /* ignore */
      }
    } catch (e) {
      setLive(false);
      setFramesOk(false);
      setSignalMeta('');
      setError(classifyGetUserMediaError(e, 'video'));
    }
  }

  function disconnect() {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setFramesOk(false);
    setSignalMeta('');
  }

  async function startListen(id: string) {
    try {
      stopStream(audioStreamRef.current);
      audioStreamRef.current = null;
      const stream = await openAudioStream(id || undefined);
      audioStreamRef.current = stream;
      const el = audioRef.current;
      if (el) {
        el.srcObject = stream;
        el.muted = false;
        el.volume = 1;
        await el.play();
      }
      setAudioStatus(null);
      if (id) saveAudioDeviceId(id);
    } catch (e) {
      stopStream(audioStreamRef.current);
      audioStreamRef.current = null;
      setListen(false);
      setAudioStatus(classifyGetUserMediaError(e, 'audio'));
    }
  }

  function stopListen() {
    stopStream(audioStreamRef.current);
    audioStreamRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.srcObject = null;
    }
  }

  async function onListenChange(next: boolean) {
    setListen(next);
    if (next) {
      let list = audioDevices;
      if (list.length === 0 || list.every((d) => d.label.startsWith('音訊輸入'))) {
        list = await listAudioDevices();
        setAudioDevices(list);
        if (!audioDeviceId) {
          const picked = pickPreferredAudioDeviceId(
            list,
            loadSavedAudioDeviceId(),
            selectedVideo?.groupId,
          );
          setAudioDeviceId(picked);
          await startListen(picked);
          return;
        }
      }
      if (list.length === 0) {
        setListen(false);
        setAudioStatus('擷取卡無音訊裝置或未授權麥克風權限');
        return;
      }
      await startListen(audioDeviceId);
    } else {
      stopListen();
    }
  }

  async function onAudioSelect(id: string) {
    onAudioDeviceChange(id);
    if (listen) {
      await startListen(id);
    }
  }

  const handleRecognize = useCallback((fresh = false) => {
    let canvas: HTMLCanvasElement | null = null;
    if (stillUrl && stillImgRef.current?.naturalWidth) {
      const img = stillImgRef.current;
      canvas = grabImageSource(img, img.naturalWidth, img.naturalHeight);
    } else if (videoRef.current?.videoWidth) {
      canvas = grabFrame(videoRef.current);
    }
    if (!canvas) return;
    if (saveRecognizeFrames) downloadRecognizeFrame(canvas);
    onRecognize(canvas, fresh);
  }, [onRecognize, saveRecognizeFrames, stillUrl]);

  useImperativeHandle(ref, () => ({ recognizeNow: handleRecognize }), [handleRecognize]);

  useEffect(() => {
    autoStateRef.current = initialAutoRecognizeState();
    setAutoPhase('idle');
  }, [stillUrl, live, autoRecognize]);

  useEffect(() => {
    if (!autoRecognize || !hasValidFrames) return;
    const id = window.setInterval(() => {
      if (!autoRecognize) return;
      let previewVisible = false;
      if (stillUrl && stillImgRef.current?.naturalWidth) {
        const img = stillImgRef.current;
        previewVisible = detectTeamPreviewAnchors(img, img.naturalWidth, img.naturalHeight);
      } else if (videoRef.current?.videoWidth) {
        const video = videoRef.current;
        previewVisible = detectTeamPreviewAnchors(video, video.videoWidth, video.videoHeight);
      }
      const { next, fire } = stepAutoRecognize(autoStateRef.current, previewVisible, busy);
      autoStateRef.current = next;
      setAutoPhase(next.phase);
      if (fire) handleRecognize(true);
    }, AUTO_RECOGNIZE_TICK_MS);
    return () => window.clearInterval(id);
  }, [autoRecognize, busy, handleRecognize, hasValidFrames, stillUrl, live]);

  useEffect(() => {
    const onFs = () => {
      const el = previewRef.current;
      setFullscreen(!!el && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  async function toggleFullscreen() {
    const el = previewRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* user gesture / browser policy */
    }
  }

  function onPreviewDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }

  function onPreviewDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function onPreviewDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    loadStillFile(e.dataTransfer.files?.[0]);
  }

  const statusLabel = stillUrl && stillReady
    ? '靜態圖'
    : trackLive && framesOk
      ? '擷取中'
      : trackLive
        ? '連接中'
        : '未連接';
  const statusOn = hasValidFrames || trackLive;

  return (
    <section className="panel panel--capture">
      <header className="capture-bar">
        <span className={`status-pill ${statusOn ? 'is-on' : ''}`} title={signalMeta || statusLabel}>{statusLabel}</span>
        <span className="capture-result" role="status" title={autoRecognize ? autoRecognizePhaseLabel(autoPhase) : undefined}>
          {busy ? '辨認中…' : statusText}
        </span>
        <details ref={sourceMenu} className="capture-sources"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              closeSources();
              sourceMenu.current?.querySelector('summary')?.focus();
            }
          }}
          onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) closeSources(); }}
        >
          <summary className="btn btn--ghost">來源</summary>
          <div className="capture-sources__menu">
            <div className="capture-toolbar">
              <select
                value={deviceId}
                onChange={(e) => onDeviceChange(e.target.value)}
                aria-label="選擇攝影機（優先 GC551／AVerMedia）"
              >
                <option value="">自動（GC551 → OBS → 預設）</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {isPreferredCaptureDevice(d.label) ? `★ ${d.label}` : d.label}
                  </option>
                ))}
              </select>
              {!live ? (
                <button type="button" className="btn btn--ghost" onClick={() => void connect()}>
                  開啟鏡頭
                </button>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={disconnect}>
                  關閉鏡頭
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                載入靜態選隊圖
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={loadFixtureStill}
                title="循環載入 public/fixtures/team-preview-test-1.jpg～test-4.jpg"
              >
                載入測試圖
              </button>
            </div>

            {audioDevices.length > 0 ? (
              <div className="capture-toolbar capture-toolbar--audio">
                <label className="capture-audio-label" htmlFor="capture-audio-select">
                  擷取音訊
                </label>
                <select
                  id="capture-audio-select"
                  value={audioDeviceId}
                  onChange={(e) => void onAudioSelect(e.target.value)}
                  aria-label="擷取音訊"
                >
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {isPreferredCaptureDevice(d.label) ? `★ ${d.label}` : d.label}
                    </option>
                  ))}
                </select>
                <label className="capture-listen">
                  <input
                    type="checkbox"
                    checked={listen}
                    onChange={(e) => void onListenChange(e.target.checked)}
                  />
                  監聽擷取音訊
                </label>
              </div>
            ) : null}
            {signalMeta && <p className="capture-signal">{signalMeta}</p>}
          </div>
        </details>
        <button type="button" className="btn btn--primary" disabled={busy || !hasValidFrames} onClick={() => handleRecognize()}>
          辨認
        </button>
      </header>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          loadStillFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <audio ref={audioRef} hidden playsInline />

      <div
        ref={previewRef}
        className={`capture-preview capture-preview--16x9${dragOver ? ' is-dragover' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
        onDragOver={onPreviewDragOver}
        onDragLeave={onPreviewDragLeave}
        onDrop={onPreviewDrop}
      >
        <div className="capture-preview__frame">
          <video
            ref={videoRef}
            muted
            playsInline
            className="capture-preview__video"
            hidden={!live || !!stillUrl}
          />
          {stillUrl && (
            <img
              ref={stillImgRef}
              src={stillUrl}
              alt="靜態選隊圖預覽"
              className="capture-preview__still"
              onLoad={() => setStillReady(true)}
              onError={() => {
                setStillReady(false);
                setError('靜態圖載入失敗');
                revokeStill();
              }}
            />
          )}
          {!hasValidFrames && !trackLive && (
            <div className="capture-preview__placeholder">
              <p>從「來源」開啟鏡頭，或拖入截圖</p>
            </div>
          )}
          {trackLive && !framesOk && !stillUrl && (
            <div className="capture-preview__placeholder">
              <p>已連接 · 等待畫面…</p>
            </div>
          )}
          {hasValidFrames && enemyTeam.map((pokemon, slot) => {
            if (!pokemon.identified) return null;
            const box = cardCssPercent(panel, slot);
            return (
              <button
                key={pokemon.id}
                type="button"
                className={`capture-slot${enemyFocus.active === slot ? ' is-linked' : ''}`}
                aria-label={`對照敵方 ${pokemon.species}`}
                aria-pressed={enemyFocus.pinned === slot}
                onPointerEnter={e => { if (e.pointerType === 'mouse') enemyFocus.hover(slot); }}
                onPointerLeave={() => enemyFocus.hover(null)}
                onClick={() => enemyFocus.pin(slot)}
                style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
              />
            );
          })}
          {/* ROI 除錯疊加：綠面板／紅槽／黃縮圖（關閉時全部隱藏，含綠框）；座標相對 16:9 __frame */}
          {debugOverlay && (
            <>
              <div
                className="capture-preview__roi capture-preview__roi--panel"
                style={{
                  left: `${panelPct.left}%`,
                  top: `${panelPct.top}%`,
                  width: `${panelPct.width}%`,
                  height: `${panelPct.height}%`,
                }}
                title="敵方面板 ROI"
              />
              {Array.from({ length: SLOT_COUNT }, (_, slot) => {
                const c = cardCssPercent(panel, slot);
                const t = thumbCssPercent(panel, slot);
                return (
                  <div key={slot}>
                    <div
                      className="capture-preview__roi capture-preview__roi--slot"
                      style={{
                        left: `${c.left}%`,
                        top: `${c.top}%`,
                        width: `${c.width}%`,
                        height: `${c.height}%`,
                      }}
                    />
                    <div
                      className="capture-preview__roi capture-preview__roi--thumb"
                      style={{
                        left: `${t.left}%`,
                        top: `${t.top}%`,
                        width: `${t.width}%`,
                        height: `${t.height}%`,
                      }}
                      title={`槽 ${slot + 1} 縮圖`}
                    />
                  </div>
                );
              })}
            </>
          )}
        </div>
        {dragOver && (
          <div className="capture-preview__drop-hint" aria-hidden>
            放開以載入靜態選隊圖
          </div>
        )}
        <button
          type="button"
          className="capture-preview__fs"
          onClick={() => void toggleFullscreen()}
          title={fullscreen ? '離開全螢幕' : '擷取預覽全螢幕'}
          aria-pressed={fullscreen}
          aria-label={fullscreen ? '離開全螢幕' : '擷取預覽全螢幕'}
        >
          {fullscreen ? '退出' : '全螢幕'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {audioStatus && <p className="error-text">{audioStatus}</p>}
    </section>
  );
});
