// Scopes: histogram, waveform, RGB parade and vectorscope computed from the
// current preview frame. The frame sampled is the one the player is
// SHOWING: the displayed main picture after crop/key/matte and the shared
// pixel passes — filters and grading included (Sprint 11: scopes used to
// read the raw source <video>, so they judged a frame the user never
// sees). During a shader transition the transition canvas is the frame.
// Sampling runs on a small 96x54 copy at ~4 fps while the panel is open,
// and the last good sample is retained: switching modes or a momentarily
// unreadable frame never blanks the scope.
import React, { useEffect, useRef, useState } from 'react';
import { tr, useT } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';
import { histogramBins, waveformLuma, channelPlanes, vectorPoints, pickScopeSource, pickSlotIndex } from '../scopesMath.js';

const MODES = [
  { id: 'hist', name: 'Histogram' },
  { id: 'wave', name: 'Waveform' },
  { id: 'parade', name: 'Parade' },
  { id: 'vector', name: 'Vectorscope' },
];
const SW = 96; const SH = 54;

function drawScope(ctx, W, H, mode, data) {
  ctx.fillStyle = '#0c0c14'; ctx.fillRect(0, 0, W, H);
  if (!data) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '11px system-ui';
    ctx.fillText(tr('scopes.idle'), 10, H / 2);
    return;
  }
  const px = data.data; const n = SW * SH;
  if (mode === 'hist') {
    const { bins, max } = histogramBins(px);
    const cols = ['rgba(255,80,80,0.75)', 'rgba(80,255,120,0.75)', 'rgba(90,140,255,0.75)'];
    ctx.globalCompositeOperation = 'lighter';
    bins.forEach((b, c) => {
      ctx.fillStyle = cols[c];
      for (let i = 0; i < 256; i++) {
        const h = (b[i] / max) * (H - 8);
        ctx.fillRect((i / 256) * W, H - h, Math.max(1, W / 256), h);
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  } else if (mode === 'wave' || mode === 'parade') {
    const luma = mode === 'wave' ? waveformLuma(px) : null;
    const planes = mode === 'parade' ? channelPlanes(px) : null;
    const cols = ['rgba(255,80,80,0.6)', 'rgba(80,255,120,0.6)', 'rgba(90,140,255,0.6)'];
    ctx.fillStyle = 'rgba(130,92,251,0.5)';
    for (let x = 0; x < SW; x++) {
      for (let y = 0; y < SH; y++) {
        const i = y * SW + x;
        if (mode === 'wave') {
          ctx.fillRect((x / SW) * W, H - luma[i] * H, Math.max(1, W / SW), 1.5);
        } else {
          const third = W / 3;
          for (let c = 0; c < 3; c++) {
            ctx.fillStyle = cols[c];
            ctx.fillRect(c * third + (x / SW) * third, H - planes[c][i] * H, Math.max(1, third / SW), 1.5);
          }
        }
      }
    }
  } else if (mode === 'vector') {
    const cx = W / 2; const cy = H / 2; const R = Math.min(W, H) / 2 - 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(130,92,251,0.55)';
    const pts = vectorPoints(px);
    for (let i = 0; i < pts.length; i += 2) {
      const x = cx + (pts[i] / 0.62) * R; const y = cy - (pts[i + 1] / 0.62) * R;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
  }
}

// The frame the player is showing right now, as a 96x54 ImageData — or
// null when nothing readable is on the main picture yet.
function sampleStageFrame(scratch) {
  const stage = document.querySelector('.stage');
  if (!stage) return null;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const grab = (el) => {
    try { sctx.drawImage(el, 0, 0, SW, SH); return sctx.getImageData(0, 0, SW, SH); }
    catch { return null; } // frame not decoded/readable yet
  };
  const trans = stage.querySelector('canvas.fx-transition');
  const slots = [...stage.querySelectorAll(':scope > .slot:not(.ov)')].map((slot) => {
    const cv = slot.querySelector('canvas.keyed');
    return {
      slot, cv,
      visible: slot.style.visibility !== 'hidden',
      z: Number(slot.style.zIndex) || 0,
      processed: !!cv && cv.style.display === 'block' && cv.width > 0,
    };
  });
  const kind = pickScopeSource({
    transition: !!trans && trans.style.display !== 'none' && trans.width > 0,
    slots,
  });
  if (kind === 'transition') return grab(trans);
  if (!kind) return null;
  const best = slots[pickSlotIndex(slots)];
  if (kind === 'keyed') return grab(best.cv);
  const v = best.slot.querySelector('video:not(.matte-src)');
  if (v && v.style.display !== 'none' && v.readyState >= 2 && v.videoWidth > 0) return grab(v);
  const img = best.slot.querySelector('img');
  if (img && img.style.display !== 'none' && img.complete && img.naturalWidth > 0) return grab(img);
  return null;
}

export default function Scopes() {
  const t = useT();
  const canvasRef = useRef(null);
  const scratchRef = useRef(null);
  const lastDataRef = useRef(null); // last good sample — never blank once we have one
  const [mode, setMode] = useState('hist');
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!scratchRef.current) {
      const c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      scratchRef.current = c;
    }
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const fresh = sampleStageFrame(scratchRef.current);
      if (fresh) lastDataRef.current = fresh;
      drawScope(canvas.getContext('2d'), canvas.width, canvas.height, modeRef.current, lastDataRef.current);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, []);

  // Mode switch: redraw the retained frame in the new mode at once — the
  // scope never sits blank waiting for the next tick.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawScope(canvas.getContext('2d'), canvas.width, canvas.height, mode, lastDataRef.current);
  }, [mode]);

  return (
    <div className="scopes">
      <div className="seg-tabs small" role="group" aria-label={t('scopes.aria')}>
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{libName('scope', m.id, m.name)}</button>
        ))}
      </div>
      <canvas ref={canvasRef} width={264} height={110} className="scopes-canvas" aria-label={t('scopes.frameOf', { name: libName('scope', mode, MODES.find((m) => m.id === mode).name) })} />
      <p className="hint">{t('scopes.note')}</p>
    </div>
  );
}
