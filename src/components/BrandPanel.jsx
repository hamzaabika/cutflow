import React, { useRef, useState } from 'react';
import { Check, ImagePlus, Layers, X } from '../icons.jsx';
import Dropdown from './Dropdown.jsx';
import { loadBrand, saveBrand, sanitizeBrand, sanitizeColor } from '../brand.js';
import { allFonts } from '../fonts.js';
import { toFileUrl } from '../store.js';

// Brand kit panel (R1): the settings-level brand registry from src/brand.js —
// logo files, palette colours and a font pick, shared by every project.
// Logos can be placed on the timeline as overlays from here; the font and the
// colour marked "Text" are what new text clips start with (App.jsx merges
// brandTextPatch under the caller's patch, so templates keep their own style).
export default function BrandPanel({ onAddFile }) {
  const [brand, setBrand] = useState(() => loadBrand());
  const [colorDraft, setColorDraft] = useState('#825cfb');
  const fileRef = useRef(null);

  const update = (next) => {
    const clean = sanitizeBrand(next);
    setBrand(clean);
    saveBrand(localStorage, clean);
    // The inspector's brand swatches (BrandSwatches) listen for this — a
    // same-window save fires no 'storage' event.
    window.dispatchEvent(new Event('clipcraft:brand'));
  };

  const onLogoFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length || !window.api?.probeFiles) return;
    const probed = await window.api.probeFiles(files);
    const logos = (probed || []).filter((r) => r && r.path && !r.error)
      .map((r) => ({ path: r.path, name: r.name || r.path.split(/[\\/]/).pop() }));
    if (logos.length) update({ ...brand, logos: [...brand.logos, ...logos] });
  };

  const addColor = () => {
    const c = sanitizeColor(colorDraft);
    if (!c || brand.colors.includes(c)) return;
    // The first colour added becomes the text colour, so the kit works without
    // a second step; the user can move the mark to any swatch afterwards.
    update({ ...brand, colors: [...brand.colors, c], color: brand.color || c });
  };

  const removeColor = (c) => update({
    ...brand,
    colors: brand.colors.filter((x) => x !== c),
    color: brand.color === c ? '' : brand.color,
  });

  const fontOptions = [
    { value: '', label: 'No brand font' },
    ...allFonts().map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <div className="brand-panel">
      <div className="lib-head">
        <div>
          <h2>Brand kit</h2>
          <p>Your logo, colours and font — saved on this PC, reused in every project.</p>
        </div>
      </div>

      <span className="lib-group-name pad-x">Logos</span>
      <div className="pad-block brand-logos">
        {brand.logos.map((l) => (
          <div key={l.path} className="brand-logo-row">
            <span className="brand-logo-thumb"><img src={toFileUrl(l.path)} alt="" draggable={false} /></span>
            <span className="brand-logo-name" title={l.path}>{l.name}</span>
            <button className="btn btn-sm" onClick={() => onAddFile && onAddFile(l.path, 'overlay')}
              title="Place this logo on the timeline as an overlay at the playhead">
              <Layers size={13} /> Overlay
            </button>
            <button className="icon-btn brand-x" onClick={() => update({ ...brand, logos: brand.logos.filter((x) => x.path !== l.path) })}
              aria-label={`Remove ${l.name} from the brand kit`} title="Remove from the kit (the file itself is not deleted)">
              <X size={14} />
            </button>
          </div>
        ))}
        {!brand.logos.length && <p className="hint">No logos yet. Add the image files you stamp on your videos.</p>}
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Add logo…</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onLogoFiles} aria-label="Choose logo image files" />
      </div>

      <span className="lib-group-name pad-x">Colours</span>
      <div className="pad-block brand-colors">
        {brand.colors.map((c) => (
          <div key={c} className={`brand-swatch-row ${brand.color === c ? 'is-text' : ''}`}>
            <button className="brand-swatch" style={{ background: c }} onClick={() => update({ ...brand, color: c })}
              title={brand.color === c ? 'This is the colour new text starts with' : 'Make this the colour new text starts with'}
              aria-label={`Use ${c} for new text`} />
            <span className="brand-hex">{c}</span>
            {brand.color === c && <span className="brand-text-mark"><Check size={12} /> Text</span>}
            <button className="icon-btn brand-x" onClick={() => removeColor(c)}
              aria-label={`Remove colour ${c}`} title="Remove colour">
              <X size={14} />
            </button>
          </div>
        ))}
        {!brand.colors.length && <p className="hint">No colours yet. Add your brand palette; the first colour becomes your text colour.</p>}
        <div className="brand-add-color">
          <input type="color" className="brand-color-input" value={colorDraft}
            onChange={(e) => setColorDraft(e.target.value)} aria-label="Pick a colour to add" />
          <span className="brand-hex">{colorDraft}</span>
          <button className="btn btn-sm" onClick={addColor}>Add colour</button>
        </div>
      </div>

      <span className="lib-group-name pad-x">Font</span>
      <div className="pad-block brand-font">
        <Dropdown value={brand.font} options={fontOptions} onChange={(v) => update({ ...brand, font: v })}
          ariaLabel="Brand font" />
        <p className="hint">New text clips start with this font and the colour marked Text. Templates and existing clips keep their own styles.</p>
      </div>
    </div>
  );
}
