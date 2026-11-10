// On-screen keystroke display (Sprint 11): while the Settings toggle is
// on, shortcut key presses appear as large chips at the bottom of the
// player window — for tutorials and screen recordings (the recorder
// captures this window, so the chips land in the video). What may appear
// is decided by src/keystrokes.js: chord labels only, never text content,
// and complete silence for password fields. The overlay itself is
// pointer-transparent and purely presentational.
import React, { useEffect, useRef, useState } from 'react';
import { strokeLabel } from '../keystrokes.js';
import { isKeyCaptureActive } from '../keymap.js';

const SHOW_MS = 1500;

export default function KeystrokesOverlay() {
  const [items, setItems] = useState([]); // [{ id, label }]
  const nextId = useRef(1);
  const timers = useRef(new Map());

  useEffect(() => {
    const timersMap = timers.current;
    const onKey = (e) => {
      if (isKeyCaptureActive()) return; // keys being bound in Settings are not strokes to show
      const t = e.target;
      const tag = t && t.tagName;
      const label = strokeLabel(e, {
        inPassword: tag === 'INPUT' && t.type === 'password',
        inText: ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || !!(t && t.isContentEditable),
      });
      if (!label) return;
      setItems((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.label === label) {
          // Same stroke again in quick succession: refresh its timer
          // instead of stacking identical chips.
          clearTimeout(timersMap.get(last.id));
          timersMap.set(last.id, setTimeout(() => setItems((p) => p.filter((i) => i.id !== last.id)), SHOW_MS));
          return prev;
        }
        const id = nextId.current++;
        timersMap.set(id, setTimeout(() => setItems((p) => p.filter((i) => i.id !== id)), SHOW_MS));
        return [...prev.slice(-2), { id, label }];
      });
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); timersMap.forEach(clearTimeout); };
  }, []);

  if (!items.length) return null;
  return (
    <div className="keystrokes-overlay" aria-hidden="true">
      {items.map((i) => <span key={i.id} className="keystroke-chip">{i.label}</span>)}
    </div>
  );
}
