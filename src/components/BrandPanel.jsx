import React, { useRef, useState } from 'react';
import { Check, ImagePlus, Layers, X } from '../icons.jsx';
import Dropdown from './Dropdown.jsx';
import { loadBrand, saveBrand, sanitizeBrand, sanitizeColor } from '../brand.js';
import { allFonts } from '../fonts.js';
import { toFileUrl } from '../store.js';
import { useT } from '../i18n/index.jsx';

// Brand kit panel (R1): the settings-level brand registry from src/brand.js —
// logo files, palette colours and a font pick, shared by every project.
// Logos can be placed on the timeline as overlays from here; the font and the
// colour marked "Text" are what new text clips start with (App.jsx merges
// brandTextPatch under the caller's patch, so templates keep their own style).
export default function BrandPanel({ onAddFile }) {
  const t = useT();
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
    { value: '', label: t('brand.noFont') },
    ...allFonts().map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <div className="brand-panel">
      <div className="lib-head">
        <div>
          <h2>{t('brand.title')}</h2>
          <p>{t('brand.note')}</p>
        </div>
      </div>

      <span className="lib-group-name pad-x">{t('brand.logos')}</span>
      <div className="pad-block brand-logos">
        {brand.logos.map((l) => (
          <div key={l.path} className="brand-logo-row">
            <span className="brand-logo-thumb"><img src={toFileUrl(l.path)} alt="" draggable={false} /></span>
            <span className="brand-logo-name" title={l.path}>{l.name}</span>
            <button className="btn btn-sm" onClick={() => onAddFile && onAddFile(l.path, 'overlay')}
              title={t('brand.placeLogo')}>
              <Layers size={13} /> {t('brand.overlay')}
            </button>
            <button className="icon-btn brand-x" onClick={() => update({ ...brand, logos: brand.logos.filter((x) => x.path !== l.path) })}
              aria-label={t('brand.removeLogo', { name: l.name })} title={t('brand.removeLogoTitle')}>
              <X size={14} />
            </button>
          </div>
        ))}
        {!brand.logos.length && <p className="hint">{t('brand.noLogos')}</p>}
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> {t('brand.addLogo')}</button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onLogoFiles} aria-label={t('brand.chooseLogos')} />
      </div>

      <span className="lib-group-name pad-x">{t('brand.colours')}</span>
      <div className="pad-block brand-colors">
        {brand.colors.map((c) => (
          <div key={c} className={`brand-swatch-row ${brand.color === c ? 'is-text' : ''}`}>
            <button className="brand-swatch" style={{ background: c }} onClick={() => update({ ...brand, color: c })}
              title={t(brand.color === c ? 'brand.colorIsText' : 'brand.colorMakeText')}
              aria-label={t('brand.useColor', { color: c })} />
            <span className="brand-hex">{c}</span>
            {brand.color === c && <span className="brand-text-mark"><Check size={12} /> {t('brand.textMark')}</span>}
            <button className="icon-btn brand-x" onClick={() => removeColor(c)}
              aria-label={t('brand.removeColour', { color: c })} title={t('brand.removeColourTitle')}>
              <X size={14} />
            </button>
          </div>
        ))}
        {!brand.colors.length && <p className="hint">{t('brand.noColours')}</p>}
        <div className="brand-add-color">
          <input type="color" className="brand-color-input" value={colorDraft}
            onChange={(e) => setColorDraft(e.target.value)} aria-label={t('brand.pickColour')} />
          <span className="brand-hex">{colorDraft}</span>
          <button className="btn btn-sm" onClick={addColor}>{t('brand.addColour')}</button>
        </div>
      </div>

      <span className="lib-group-name pad-x">{t('brand.font')}</span>
      <div className="pad-block brand-font">
        <Dropdown value={brand.font} options={fontOptions} onChange={(v) => update({ ...brand, font: v })}
          ariaLabel={t('brand.fontAria')} />
        <p className="hint">{t('brand.fontNote')}</p>
      </div>
    </div>
  );
}
