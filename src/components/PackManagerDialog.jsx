// Creative Pack Manager (P2-14): import / export versioned preset packs,
// list installed packs with their missing assets (and repair), and apply a
// pack's presets — text presets install into the user's caption templates,
// animation / transition presets apply to the selected picture clip.
import React, { useEffect, useState } from 'react';
import { useT } from '../i18n/index.jsx';
import { ANIMATIONS } from '../anim.js';
import { TRANSITIONS } from '../effects.js';
import { buildManifest } from '../packs.js';
import { loadUserTemplates, saveUserTemplates, upsertUserTemplate } from '../text/userTemplates.js';
import { loadCreativePresets, saveCreativePresets, upsertCreativePreset } from '../presets/store.js';
import { sha256Hex } from '../presets/assets.js';
import { collectFilterPackAssets, exportFilterPresetsToPack, packPresetToCreativePreset } from '../presets/packBridge.js';

// Asset `reason` strings come from electron/packs.cjs (stable codes, also
// asserted by test-packs.mjs) — map them to translated text at render time.
const PACK_REASON_KEY = {
  'file not in pack': 'prim.packReasonNotInPack',
  'asset too large': 'prim.packReasonTooLarge',
  'pack too large': 'prim.packReasonPackTooLarge',
  'hash mismatch': 'prim.packReasonHash',
  'size mismatch': 'prim.packReasonSize',
  'pack.json is gone': 'prim.packReasonPackGone',
  'file not installed': 'prim.packReasonNotInstalled',
  'not installed': 'prim.packReasonNotInstalled',
};

const slug = (s) => String(s || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'preset';

export default function PackManagerDialog({ onClose, dispatch, selection, project }) {
  const t = useT();
  const [packs, setPacks] = useState(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState(t('prim.packDefaultName'));
  const [includeText, setIncludeText] = useState(true);
  const [includeAnim, setIncludeAnim] = useState(true);
  const [includeTrans, setIncludeTrans] = useState(false);
  const [includeFilter, setIncludeFilter] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const res = await window.api.packsList();
    if (res.error) { setMsg(t('prim.packListError', { error: res.error })); setPacks([]); return; }
    setPacks(res.packs || []);
  };
  useEffect(() => { refresh(); }, []);

  const selectedClip = () => {
    if (!selection || !project) return null;
    const list = selection.track === 'overlay' ? project.overlayClips || [] : selection.track === 'video' ? project.videoClips || [] : [];
    return list.find((c) => c.id === selection.id) || null;
  };

  const doImport = async () => {
    setBusy(true);
    const res = await window.api.packsImport();
    setBusy(false);
    if (!res) return;
    if (res.ok) {
      setMsg(t('prim.packImported', { name: res.manifest.name, presets: res.manifest.presets.length, assets: res.manifest.assets.length }) +
        (res.missingAssets?.length ? t('prim.packImportedMissing', { count: res.missingAssets.length, names: res.missingAssets.map((a) => a.name).join(', ') }) : ''));
    } else setMsg(t('prim.packImportFailed', { error: res.error || (res.errors || []).join('; ') }));
    refresh();
  };

  const doExport = async () => {
    const presets = [];
    let assets = [];
    let skippedNote = '';
    if (includeText) {
      for (const tpl of loadUserTemplates()) {
        presets.push({ kind: 'text', id: slug(tpl.name), name: tpl.name, data: tpl.patch });
      }
    }
    if (includeAnim) {
      for (const kind of ['in', 'out', 'combo']) {
        for (const a of ANIMATIONS[kind]) presets.push({ kind: 'anim', id: `${kind}-${a.id}`, name: a.name, data: { kind, type: a.id, duration: 0.5 } });
      }
    }
    if (includeTrans) {
      for (const tr of TRANSITIONS) presets.push({ kind: 'transition', id: slug(tr.id), name: tr.name, data: { type: tr.id, duration: 0.5 } });
    }
    if (includeFilter) {
      // Filter looks (B-F10): CreativePresets with target 'filter' travel
      // as pack 'filter' presets; a LUT look ships its .cube bytes as a
      // pack asset (hash-checked on import). Looks whose LUT cannot be read
      // are skipped, never exported dangling.
      const looks = loadCreativePresets().filter((p) => p.target === 'filter');
      const { assets: lutAssets, skipped } = await collectFilterPackAssets(looks, (ref) => window.api.readLut(ref), sha256Hex);
      const blobs = Object.fromEntries(lutAssets.map((a) => [a.name, { sha256: a.sha256, size: a.size, data: a.data }]));
      const { manifest, skipped: skippedNoBlob } = exportFilterPresetsToPack(looks, { name, assetBlobs: blobs });
      presets.push(...manifest.presets);
      assets = manifest.assets;
      const skippedNames = [...skipped, ...skippedNoBlob];
      if (skippedNames.length) skippedNote = t('prim.packFilterSkipped', { count: skippedNames.length, names: skippedNames.join(', ') });
    }
    if (!presets.length) { setMsg(t('prim.packNothing')); return; }
    setBusy(true);
    const res = await window.api.packsExport(buildManifest({ name, presets, assets }));
    setBusy(false);
    if (res?.ok) setMsg(t('prim.packExported', { count: presets.length, path: res.path }) + skippedNote);
    else setMsg(t('prim.packExportFailed', { error: res?.error || (res?.errors || []).join('; ') }));
  };

  const applyPreset = (pack, preset) => {
    if (preset.kind === 'text') {
      const list = upsertUserTemplate(loadUserTemplates(), preset.data, preset.name);
      saveUserTemplates(localStorage, list);
      setMsg(t('prim.packTextInstalled', { name: preset.name }));
      return;
    }
    if (preset.kind === 'filter') {
      // Filter looks install into the looks library (the Filters panel),
      // like text templates install into the text library. The LUT asset
      // entry rides on the installed preset; the existing relink flow
      // reports it missing if the pack does not carry the bytes.
      const cp = packPresetToCreativePreset(preset);
      if (!cp) { setMsg(t('prim.packImportFailed', { error: preset.name })); return; }
      saveCreativePresets(localStorage, upsertCreativePreset(loadCreativePresets(), cp));
      const lutMissing = preset.data?.lut && (pack.missingAssets || []).some((a) => a.name === preset.data.lut);
      setMsg(t('prim.packFilterInstalled', { name: preset.name }) + (lutMissing ? t('prim.packFilterLutMissing', { name: preset.data.lut }) : ''));
      return;
    }
    const clip = selectedClip();
    if (!clip) { setMsg(t('prim.packSelectClip')); return; }
    const track = selection.track;
    if (preset.kind === 'anim') {
      const { kind, type, duration } = preset.data;
      if (kind === 'combo') dispatch({ type: 'update', track, id: clip.id, patch: { anim: { combo: { type } } } });
      else dispatch({ type: 'update', track, id: clip.id, patch: { anim: { ...(clip.anim || {}), [kind]: { type, duration: duration || 0.5 } } } });
      setMsg(t('prim.packAnimApplied', { name: preset.name }));
    } else if (preset.kind === 'transition') {
      if (track !== 'video') { setMsg(t('prim.packTransMainOnly')); return; }
      dispatch({ type: 'update', track, id: clip.id, patch: { transition: { type: preset.data.type, duration: preset.data.duration || 0.5 } } });
      setMsg(t('prim.packTransApplied', { name: preset.name }));
    } else {
      setMsg(t('prim.packFxRef'));
    }
  };

  const doRepair = async (pack, asset) => {
    setBusy(true);
    const res = await window.api.packsRepair(pack.id, asset.name);
    setBusy(false);
    setMsg(res?.ok ? t('prim.packRepaired', { name: asset.name }) : t('prim.packRepairFailed', { error: res?.error || 'unknown error' }));
    refresh();
  };

  const doRemove = async (pack) => {
    if (!window.confirm(t('prim.packRemoveConfirm', { name: pack.name }))) return;
    await window.api.packsRemove(pack.id);
    setMsg(t('prim.packRemoved', { name: pack.name }));
    refresh();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label={t('prim.packs')}>
      <div className="modal-card packs-dialog">
        <div className="modal-head">
          <h2>{t('prim.packs')}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>✕</button>
        </div>
        <p className="dim small">{t('prim.packIntro')}</p>
        {msg && <p className="dim small" role="status">{msg}</p>}
        <div className="packs-actions">
          <button type="button" className="btn" disabled={busy} onClick={doImport}>{t('prim.packImport')}</button>
        </div>
        <h3>{t('prim.packExportTitle')}</h3>
        <label className="field">
          <span>{t('prim.packName')}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field row"><span>{t('prim.packMyText')}</span><input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} /></label>
        <label className="field row"><span>{t('prim.packAnim')}</span><input type="checkbox" checked={includeAnim} onChange={(e) => setIncludeAnim(e.target.checked)} /></label>
        <label className="field row"><span>{t('prim.packTrans')}</span><input type="checkbox" checked={includeTrans} onChange={(e) => setIncludeTrans(e.target.checked)} /></label>
        <label className="field row"><span>{t('prim.packMyFilter')}</span><input type="checkbox" checked={includeFilter} onChange={(e) => setIncludeFilter(e.target.checked)} /></label>
        <button type="button" className="btn" disabled={busy} onClick={doExport}>{t('prim.packExport')}</button>
        <h3>{t('prim.packInstalled')}</h3>
        {packs === null && <p className="dim small">{t('prim.packLoading')}</p>}
        {packs !== null && packs.length === 0 && <p className="dim small">{t('prim.packNone')}</p>}
        {packs !== null && packs.map((pack) => (
          <div key={pack.id} className="pack-entry">
            <div className="pack-head">
              <b>{pack.name}</b> <span className="dim small">{t('prim.packVersionLine', { version: pack.version, presets: pack.presetCount, assets: pack.assetCount })}</span>
              <button type="button" className="btn btn-sm" onClick={() => doRemove(pack)}>{t('prim.packRemove')}</button>
            </div>
            {pack.missingAssets?.length > 0 && (
              <div className="pack-missing" role="alert">
                {pack.missingAssets.map((a) => (
                  <div key={a.name} className="dim small">
                    {t('prim.packMissing', { name: a.name, reason: t(PACK_REASON_KEY[a.reason] || 'prim.packReasonNotInstalled') })}
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => doRepair(pack, a)}>{t('prim.packLocate')}</button>
                  </div>
                ))}
              </div>
            )}
            {(pack.manifest?.presets || []).map((preset) => (
              <div key={`${preset.kind}:${preset.id}`} className="pack-preset">
                <span className="dim small">{preset.kind}</span> {preset.name}
                <button type="button" className="btn btn-sm" onClick={() => applyPreset(pack, preset)}>{t('prim.packApply')}</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
