import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from './i18n/index.jsx';

// Screen recording: the chosen screen or window (with the PC's sound and / or the microphone). The camera is
// recorded as its own file: the bubble on the screen is a preview of where it will sit (on a screen recording
// the bubble stays visible in the video, as the Record window says), and its place and shape tell where the
// camera clip goes on the overlay track. The WebM data is streamed to the main process, which saves MP4s in
// Videos\Cutflow.
// System sound: the display-media handler asks Chromium for loopback audio. Chromium implements that on
// Windows and on Linux (via the PulseAudio/PipeWire monitor) — the track comes back live with deviceId
// 'loopback' on both. If the machine has no audio server the track is silent, and the finished file is flagged
// by the post-recording sound check instead of failing the start.
// onDone({ screen, camera, camShape, camStyle, camGeom }, at) gets the media items; `at` is the playhead.
// camStyle: { stroke, strokeColor, glow, glowColor } for the camera's outline and glow.
const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const mimeType = () => MIME.find((m) => window.MediaRecorder?.isTypeSupported(m)) || '';

// One MediaRecorder writing to one file in the main process. Chunks are sent in order.
// expectAudio (screen recorder only): sound was meant to be captured — the
// main process checks the finished file for silence and flags it.
function fileRecorder(stream, kind, bitrate, expectAudio = false) {
  const mr = new MediaRecorder(stream, { mimeType: mimeType(), videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000 });
  let id = null;
  let chain = window.api.screenBegin(kind).then((v) => { id = v; });
  mr.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    chain = chain.then(async () => window.api.screenChunk(id, new Uint8Array(await e.data.arrayBuffer())));
  };
  const stopped = new Promise((resolve) => { mr.onstop = resolve; });
  return {
    mr,
    start: () => mr.start(1000),
    async finish() {
      if (mr.state !== 'inactive') mr.stop();
      await stopped;
      await chain;
      return window.api.screenFinish(id, !!expectAudio);
    },
    async discard() {
      if (mr.state !== 'inactive') mr.stop();
      await stopped;
      await chain;
      await window.api.screenDiscard(id);
    },
  };
}

export function useScreenRecorder(onDone) {
  const t = useT();
  // phase: 'idle' | 'countdown' | 'recording' | 'saving'
  // notice: set when a finished recording came out silent although sound
  // was expected — the dialog shows it until dismissNotice clears it.
  const [state, setState] = useState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: '', notice: null });
  const live = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const cleanup = () => {
    const l = live.current;
    if (!l) return;
    clearInterval(l.timer);
    l.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    l.audioCtx?.close().catch(() => {});
    l.offs.forEach((off) => off());
    live.current = null;
  };

  const elapsed = (l) => (l.paused ? l.acc : l.acc + (Date.now() - l.since) / 1000);

  const stop = useCallback(async (discard = false) => {
    const l = live.current;
    if (!l || l.stopping) return;
    l.stopping = true;
    clearInterval(l.timer);
    l.camGeom = await window.api.screenCamGeom(l.sourceId).catch(() => null);
    window.api.screenBar(false);
    window.api.screenCamera(false);
    window.api.screenWindow('restore');
    setState((s) => ({ ...s, phase: 'saving' }));
    try {
      if (discard || !l.recorders.length) {
        await Promise.all(l.recorders.map((r) => r.discard()));
        cleanup();
        return setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: '', notice: null });
      }
      const [screen, camera] = await Promise.all(l.recorders.map((r) => r.finish()));
      cleanup();
      const bad = [screen, camera].find((x) => x && x.error);
      const notice = !bad && screen && screen.soundMissing ? { name: screen.name || '' } : null;
      setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: bad ? bad.error : '', notice });
      if (screen && !screen.error) doneRef.current({ screen, camera: camera && !camera.error ? camera : null, camShape: l.camShape, camStyle: l.camStyle, camGeom: l.camGeom }, l.at);
    } catch (e) {
      cleanup();
      setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: e.message, notice: null });
    }
  }, []);

  const togglePause = useCallback(() => {
    const l = live.current;
    if (!l || l.stopping || !l.recorders.length) return;
    if (l.paused) {
      l.recorders.forEach((r) => r.mr.resume());
      l.since = Date.now();
      l.paused = false;
    } else {
      l.recorders.forEach((r) => r.mr.pause());
      l.acc = elapsed(l);
      l.paused = true;
    }
    const s = { seconds: elapsed(l), paused: l.paused };
    setState((st) => ({ ...st, ...s }));
    window.api.screenBarState(s);
  }, []);

  // opts: { sourceId, systemAudio, mic, micId, camera, cameraId, camShape, camStroke, camStrokeColor, camGlow, camGlowColor, hideApp, at }
  const start = useCallback(async (opts) => {
    if (live.current) return;
    setState({ phase: 'countdown', count: 3, seconds: 0, paused: false, error: '', notice: null });
    const l = { streams: [], recorders: [], offs: [], at: opts.at || 0, acc: 0, paused: false, camShape: opts.camShape, sourceId: opts.sourceId,
      camStyle: { stroke: opts.camStroke || 0, strokeColor: opts.camStrokeColor || '#ffffff', glow: opts.camGlow || 0, glowColor: opts.camGlowColor || '#825cfb' } };
    live.current = l;
    try {
      await window.api.screenChoose(opts.sourceId, opts.systemAudio);
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: !!opts.systemAudio });
      l.streams.push(display);
      const mic = opts.mic ? await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: opts.micId ? { exact: opts.micId } : undefined, echoCancellation: true, noiseSuppression: true },
      }) : null;
      if (mic) l.streams.push(mic);
      const cam = opts.camera ? await navigator.mediaDevices.getUserMedia({
        video: { deviceId: opts.cameraId ? { exact: opts.cameraId } : undefined, width: 1280, height: 720, frameRate: 30 }, audio: false,
      }) : null;
      if (cam) l.streams.push(cam);

      // One sound track: the PC's sound and the microphone mixed together.
      const sounds = [display, mic].filter((s) => s && s.getAudioTracks().length);
      let audioTracks = [];
      if (sounds.length === 1) audioTracks = sounds[0].getAudioTracks();
      else if (sounds.length > 1) {
        l.audioCtx = new AudioContext();
        const dest = l.audioCtx.createMediaStreamDestination();
        sounds.forEach((s) => l.audioCtx.createMediaStreamSource(s).connect(dest));
        audioTracks = dest.stream.getAudioTracks();
      }
      const screenStream = new MediaStream([...display.getVideoTracks(), ...audioTracks]);
      // Sharing ended from outside (window closed, screen unplugged): save what was recorded.
      display.getVideoTracks()[0].addEventListener('ended', () => stop());

      for (let c = 3; c > 0; c--) {
        if (live.current !== l) return;
        setState((s) => ({ ...s, count: c }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (live.current !== l) return;
      if (opts.hideApp) {
        await window.api.screenWindow('minimize');
        await new Promise((r) => setTimeout(r, 400)); // let the minimize animation finish before recording
      }
      await window.api.screenBar(true, opts.sourceId).then((res) => {
        // Linux screen recording: there is no Stop bar (it would be burned into the video), so the user gets a
        // notification telling them how to stop instead — the Record window's Stop button is the other way.
        if (res && res.shown === false) {
          try { new Notification(t('rec.linuxBarHiddenTitle'), { body: t('rec.linuxBarHiddenBody') }).show(); } catch { /* notifications are best-effort */ }
        }
      }).catch(() => {});
      l.offs.push(window.api.onScreenStop(() => stop()), window.api.onScreenPause(() => togglePause()));
      // Sound was expected when the microphone or the computer sound was on:
      // the finished screen recording is then checked for silence.
      const expectAudio = !!(opts.mic || opts.systemAudio);
      l.recorders.push(fileRecorder(screenStream, 'screen', 8000000, expectAudio));
      if (cam) l.recorders.push(fileRecorder(cam, 'camera', 4000000));
      l.recorders.forEach((r) => r.start());
      l.since = Date.now();
      setState({ phase: 'recording', count: 0, seconds: 0, paused: false, error: '' });
      l.timer = setInterval(() => {
        const s = { seconds: elapsed(l), paused: l.paused };
        setState((st) => ({ ...st, ...s }));
        window.api.screenBarState(s);
      }, 250);
    } catch (e) {
      cleanup();
      window.api.screenBar(false);
      window.api.screenCamera(false);
      window.api.screenWindow('restore');
      const msg = e.name === 'NotAllowedError' ? 'Recording was not allowed (camera or microphone blocked, or the source is gone).' : e.message;
      setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: msg, notice: null });
    }
  }, [stop, togglePause, t]);

  const dismissNotice = useCallback(() => setState((s) => ({ ...s, notice: null })), []);

  useEffect(() => () => { if (live.current) stop(); }, [stop]);

  return { ...state, active: state.phase !== 'idle', start, stop, togglePause, cancel: () => stop(true), dismissNotice };
}
