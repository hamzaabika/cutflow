import React, { useEffect, useState } from 'react';
import { loadBrand } from '../brand.js';

// The brand palette as pickable swatches (R3, the R1 deferral): wherever the
// inspector picks a colour — text fill/stroke/shadow, the chroma key, mask
// stroke/glow, the project background — the saved brand colours are offered
// alongside, and picking one writes through the very same onChange the colour
// input itself uses, so the value lands identically (one undo step, same
// field). An empty palette renders nothing: no dead surface. The list
// re-reads when the Brand panel saves (it dispatches 'clipcraft:brand') or
// another window changes the kit ('storage').
export default function BrandSwatches({ onPick }) {
  const [colors, setColors] = useState(() => loadBrand().colors);
  useEffect(() => {
    const read = () => setColors(loadBrand().colors);
    window.addEventListener('clipcraft:brand', read);
    window.addEventListener('storage', read);
    return () => { window.removeEventListener('clipcraft:brand', read); window.removeEventListener('storage', read); };
  }, []);
  if (!colors.length) return null;
  return (
    <div className="brand-swatches">
      <span className="brand-swatches-label">Brand</span>
      {colors.map((c) => (
        <button key={c} type="button" className="chip-color" style={{ background: c }}
          title={`Brand colour ${c}`} aria-label={`Use brand colour ${c}`} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}
