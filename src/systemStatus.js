// System status (FB-30 / P1-45): one hook for the tray's System section,
// so no async job runs without visible status. Two sources, merged:
//   · a snapshot polled from the main process (`system:status`): proxy +
//     caches, the AI model states (Whisper / matting / reframe / Piper),
//     the effect-cache figures, and which main-process jobs are active;
//   · the progress events the main process already emits (audiofx,
//     captions, translate, enhance, matting, reframe, esrgan, tts) —
//     several of these had NO subscriber anywhere, so the work they
//     reported (notably the audio-preview renders) was invisible.
// A live entry is only trusted while its job is still active in the
// snapshot; when the snapshot says the job is gone, the row goes away
// instead of freezing at its last fraction.
import { useCallback, useEffect, useRef, useState } from 'react';

const LIVE_TTL_MS = 20000; // a progress event older than this is stale

// Normalise the differently-shaped progress payloads to { stage, fraction }.
export const normalizeProgress = (kind, p) => {
  if (!p) return null;
  if (kind === 'translate') {
    const total = Number(p.total) || 0;
    return { stage: 'translate', fraction: total > 0 ? Math.min(1, (Number(p.done) || 0) / total) : 0 };
  }
  if (kind === 'captions') return { stage: p.stage || 'captions', fraction: Number(p.progress) || 0 };
  return { stage: p.stage || p.phase || kind, fraction: Number(p.fraction) || 0 };
};

const CANCEL = {
  audioFx: () => window.api.audioFxCancel?.(),
  enhance: () => window.api.enhanceCancel?.(),
  matting: () => window.api.mattingCancel?.(),
  reframe: () => window.api.reframeCancel?.(),
  translate: () => window.api.translateCancel?.(),
  esrgan: () => window.api.esrganCancel?.(),
  detach: () => window.api.detachCancel?.(),
  reverse: () => window.api.reverseCancel?.(),
  // captions has no cancel path in the main process (the run is short and
  // finishes on its own); the row shows progress only. See the FB-30 note.
};

export function useSystemStatus(enabled) {
  const [snapshot, setSnapshot] = useState(null);
  const [live, setLive] = useState({}); // kind -> { stage, fraction, at, path? }
  const liveRef = useRef({});
  const putLive = useCallback((kind, payload) => {
    const n = normalizeProgress(kind, payload);
    if (!n) return;
    const entry = { ...n, at: Date.now(), path: payload?.path || null };
    liveRef.current = { ...liveRef.current, [kind]: entry };
    setLive(liveRef.current);
  }, []);
  const cancel = useCallback((kind) => CANCEL[kind]?.(), []);

  useEffect(() => {
    if (!enabled || !window.api?.systemStatus) return undefined;
    let dead = false;
    const poll = () => window.api.systemStatus().then((s) => { if (!dead) setSnapshot(s); }).catch(() => {});
    poll();
    const id = setInterval(poll, 2000);
    const subs = [
      window.api.onAudioFxProgress && window.api.onAudioFxProgress((p) => putLive('audioFx', p)),
      window.api.onCaptionsProgress && window.api.onCaptionsProgress((p) => putLive('captions', p)),
      window.api.onTranslateProgress && window.api.onTranslateProgress((p) => putLive('translate', p)),
      window.api.onEnhanceProgress && window.api.onEnhanceProgress((p) => putLive('enhance', p)),
      window.api.onMattingProgress && window.api.onMattingProgress((p) => putLive('matting', p)),
      window.api.onReframeProgress && window.api.onReframeProgress((p) => putLive('reframe', p)),
      window.api.onEsrganProgress && window.api.onEsrganProgress((p) => putLive('esrgan', p)),
      window.api.onTtsProgress && window.api.onTtsProgress((p) => putLive('tts', p)),
    ].filter(Boolean);
    return () => { dead = true; clearInterval(id); subs.forEach((off) => off()); };
  }, [enabled, putLive]);

  // The unified job list the tray renders: active jobs first (with live
  // progress where fresh), then the always-visible states (models, caches).
  const now = Date.now();
  const active = snapshot?.active || {};
  const jobs = [];
  for (const kind of ['audioFx', 'captions', 'translate', 'enhance', 'matting', 'reframe', 'esrgan', 'tts', 'detach', 'reverse']) {
    if (!active[kind]) continue;
    const l = live[kind];
    const fresh = l && now - l.at < LIVE_TTL_MS;
    jobs.push({ kind, stage: fresh ? l.stage : kind, fraction: fresh ? l.fraction : null, path: fresh ? l.path : null, cancelable: !!CANCEL[kind] });
  }
  return { snapshot, jobs, cancel, retryModel: (id) => window.api.modelsInstall?.(id) };
}
