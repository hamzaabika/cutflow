import React, { useRef, useState } from 'react';
import { Check, ImagePlus, Layers, X } from '../icons.jsx';
import Dropdown from './Dropdown.jsx';
import { loadBrand, saveBrand, sanitizeBrand, sanitizeColor, serializeBrandPack, parseBrandPack, relinkBrandPack } from '../brand.js';
import { allFonts } from '../fonts.js';
import { toFileUrl } from '../store.js';
import { useT } from '../i18n/index.jsx';

const downloadText = (filename, text) => {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Brand kit panel (R1): the settings-level brand registry from src/brand.js —
// logo files, palette colours and a font pick, shared by every project.
// Logos can be placed on the timeline as overlays from here; the font and the
// colour marked "Text" are what new text clips start with (App.jsx merges
// brandTextPatch under the caller's patch, so templates keep their own style).
export default function BrandPanel({ onAddFile }) {
  const t = useT();
  const [brand, setBrand] = useState(() => loadBrand());
  const [colorDraft, setColorDraft] = useState('#825cfb');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);
  const introRef = useRef(null);
  const outroRef = useRef(null);
  const packRef = useRef(null);

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

  // Intro / outro: one media file each, picked the same way as a logo.
  const onMediaRef = async (e, key) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length || !window.api?.probeFiles) return;
    const probed = await window.api.probeFiles(files);
    const r = (probed || []).find((x) => x && x.path && !x.error);
    if (r) update({ ...brand, [key]: { path: r.path, name: r.name || r.path.split(/[\\/]/).pop(), ...(r.duration ? { duration: r.duration } : {}) } });
  };

  // P2-40: export the kit as a versioned pack file, and import one. Import
  // relinks against this machine's files: a bundled font resolves by family
  // name, a media file by the path the user points at (probeFiles resolves
  // the recorded name). Missing assets are reported, never substituted.
  const onImportPack = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { brand: imported, assets, errors } = parseBrandPack(await file.text());
    if (!imported) { setNote(errors.join(' ')); return; }
    const fontIds = new Set(allFonts().map((f) => f.id));
    // Media relinks against the recorded path first (same machine, or the
    // user has the files in the same place); anything not found there is
    // listed as missing for the user to repair, never silently substituted.
    const recorded = new Map();
    imported.logos.forEach((l) => recorded.set(`logos/${l.name}`, l.path));
    if (imported.intro) recorded.set(`intro/${imported.intro.name}`, imported.intro.path);
    if (imported.outro) recorded.set(`outro/${imported.outro.name}`, imported.outro.path);
    const { brand: relinked, missing } = await relinkBrandPack({ brand: imported, assets }, async (a) => {
      if (a.kind === 'font') return fontIds.has(a.name) ? { path: `font:${a.name}` } : null;
      const p = recorded.get(a.relPath);
      if (!p || !window.api?.probePaths) return null;
      const [res] = await window.api.probePaths([p]);
      return res && !res.error ? { path: res.path } : null;
    });
    update(relinked);
    setNote(missing.length
      ? t('brand.packImportedMissing', { missing: missing.map((a) => a.name).join(', ') })
      : t('brand.packImported'));
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

      <span className="lib-group-name pad-x">{t('brand.introOuttro')}</span>
      <div className="pad-block brand-media-refs">
        {[['intro', brand.intro, introRef], ['outro', brand.outro, outroRef]].map(([key, ref, inputRef]) => (
          <div key={key} className="brand-media-row">
            <span className="brand-media-label">{t(`brand.${key}`)}</span>
            {ref ? (
              <>
                <span className="brand-logo-name" title={ref.path}>{ref.name}</span>
                <button className="btn btn-sm" onClick={() => onAddFile && onAddFile(ref.path, 'main')}
                  title={t('brand.placeMedia')}>{t('brand.addToTimeline')}</button>
                <button className="icon-btn brand-x" onClick={() => update({ ...brand, [key]: null })}
                  aria-label={t('brand.removeMedia', { name: ref.name })} title={t('brand.removeMediaTitle')}><X size={14} /></button>
              </>
            ) : (
              <button className="btn btn-sm" onClick={() => inputRef.current?.click()}>{t('brand.chooseMedia')}</button>
            )}
            <input ref={inputRef} type="file" accept="video/*,image/*" hidden onChange={(e) => onMediaRef(e, key)} aria-label={t(`brand.choose${key === 'intro' ? 'Intro' : 'Outro'}`)} />
          </div>
        ))}
        <p className="hint">{t('brand.introOutroNote')}</p>
      </div>

      <span className="lib-group-name pad-x">{t('brand.pack')}</span>
      <div className="pad-block brand-pack">
        <button className="btn btn-sm" onClick={() => downloadText('cutflow-brand-pack.json', serializeBrandPack(brand))}>{t('brand.packExport')}</button>
        <button className="btn btn-sm" onClick={() => packRef.current?.click()}>{t('brand.packImport')}</button>
        <input ref={packRef} type="file" accept=".json,application/json" hidden onChange={onImportPack} aria-label={t('brand.packImport')} />
        <p className="hint">{t('brand.packNote')}</p>
        {note && <p className="hint">{note}</p>}
      </div>
    </div>
  );
}
