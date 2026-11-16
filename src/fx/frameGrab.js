// Real-footage effect thumbnails (FX-03): grab one frame from the user's
// own selected clip and run the effect tiles on it, instead of the standard
// sample pair. One frame is grabbed per clip selection and shared by every
// tile; transitions keep the sample pair (a transition needs TWO clips'
// frames, which is a different feature — the tile pair stays as-is).
// Pure helpers + one DOM grabber; no Electron APIs (a plain <video> seek
// works for local files through toFileUrl, and for images a plain <img>).

// The local time (seconds into the clip) to grab: the playhead when it sits
// inside the clip, else the clip's midpoint — so the tile shows the picture
// the user is actually looking at, not the first frame.
export function thumbTimeFor(clip, playheadTime, clipStart) {
  const span = Math.max(0, (clip?.out ?? clip?.duration ?? 0) - (clip?.in ?? 0));
  if (!Number.isFinite(span) || span <= 0) return 0;
  const local = (playheadTime ?? 0) - (clipStart ?? 0);
  if (Number.isFinite(local) && local >= 0 && local <= span) return local;
  return span / 2;
}

// Cover-fit draw of an image/video/canvas source into a fresh canvas.
export function coverDraw(source, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh || !ctx) return cv;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return cv;
}

// Grab one frame of a media item at local time `at` (seconds into the
// clip's source range: clip.in + at for video). Returns a 320x180 canvas,
// or null when the frame cannot be read (missing file, bad codec, timeout).
// `url` is a file:// URL (toFileUrl); `isImage` skips the video seek.
export function grabFrame({ url, at = 0, isImage = false, width = 320, height = 180, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    let done = false;
    const finish = (cv) => { if (!done) { done = true; resolve(cv); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (isImage) {
      const img = new Image();
      img.onload = () => { clearTimeout(timer); try { finish(coverDraw(img, width, height)); } catch { finish(null); } };
      img.onerror = () => { clearTimeout(timer); finish(null); };
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.onseeked = () => { clearTimeout(timer); try { finish(coverDraw(video, width, height)); } catch { finish(null); } };
    video.onerror = () => { clearTimeout(timer); finish(null); };
    // Seeking before metadata arrives throws in some browsers; wait for it.
    video.onloadedmetadata = () => {
      try { video.currentTime = Math.max(0, Math.min(at, (video.duration || at) - 0.05)); } catch { clearTimeout(timer); finish(null); }
    };
    video.src = url;
    video.load();
  });
}
