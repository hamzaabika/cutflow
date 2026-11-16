// Creative Composer panel (P1-56 / CC-07 core): the one place to browse,
// apply, save, edit, delete, import and export CreativePresets — and the
// browse surface for the whole creative catalog (text, motion, transitions,
// glow, film, titles, graphics, sound) built live from the app's own
// catalogs (src/composer/catalog.js). Tiles preview through the real engine
// (FxThumb / AnimThumb / TextPreview), never a detached fake; an entry whose
// content id is not in the live catalogs renders as honestly unavailable.
//   - Apply goes through updateTarget (picture clips) or an 'update' on the
//     selected text clip: one undoable dispatch, and the preview updates
//     live because the patch writes the same clip fields the preview reads.
//     With several picture clips selected, a picture apply goes to all of
//     them in one undo step.
//   - Save captures the current clip's settings for the chosen target.
//   - Edit changes a preset's registry parameters and live-applies them.
//   - Import/export are .json files in the v1 format (schema.js); validated
//     .cutflowpack files import through src/packs.js (malformed or
//     dangerous packs are rejected, never partially applied).
// Opening the panel runs the one-shot legacy migration (idempotent).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Slider from './Slider.jsx';
import SearchBox from './SearchBox.jsx';
import { useT } from '../i18n/index.jsx';
import { PRESET_TARGETS, paramDefs, targetDef, getParam, setParam, clampParams } from '../presets/registry.js';
import { newCreativePreset, newPresetId, serializeCreativePreset, serializeCreativePresets, parseCreativePresetFile } from '../presets/schema.js';
import { loadCreativePresets, saveCreativePresets, upsertCreativePreset, removeCreativePreset, migrateLegacyPresets, migratePresetAssets } from '../presets/store.js';
import { relinkAssets } from '../presets/assets.js';
import { BUNDLED_LUTS } from '../fx/lut.js';
import { allFonts } from '../fonts.js';
import { capturePresetFromClip, presetClipPatch, presetTextPatch, presetAppliesTo } from '../presets/apply.js';
import { seedPresets } from '../presets/seeds.js';
import {
  COMPOSER_SECTIONS, COMPOSER_PACKS_KEY, buildComposerItems, filterComposerItems,
  loadComposerFavs, toggleComposerFav, loadComposerRecentPresets, recordComposerRecentPreset,
  validatePackFile,
} from '../composer/catalog.js';
import { FxThumb } from '../fx/previews.jsx';
import { AnimThumb } from './AnimationPanel.jsx';
import TextPreview from './TextPreview.jsx';
import { readPayload } from '../dnd.js';
import { TRANSITIONS } from '../effects.js';
import { buildManifest } from '../packs.js';
import { uid } from '../store.js';

const downloadText = (filename, text) => {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const slug = (s) => String(s || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'preset';

// Sticker art, resolved like the Stickers tab (bundled path); a tile is never
// blank art — while the path resolves it shows the empty tile frame.
function StickerThumb({ sticker }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    if (window.api?.bundledPath) {
      window.api.bundledPath('stickers', sticker.file).then((p) => { if (live) setSrc(p); }).catch(() => {});
    }
    return () => { live = false; };
  }, [sticker.file]);
  if (!src) return <span className="tile-preview" />;
  return <img src={src} alt="" draggable={false} className="fx-thumb" />;
}

const CHIPS = ['all', 'recommended', 'favorites', 'recent', 'in', 'out', 'loop', '2d', '3d', 'noflash', 'lowend'];
const MEDIA_FILTERS = ['all', 'picture', 'text', 'audio', 'sticker'];

export default function ComposerPanel({ target, updateTarget, dispatch, selectedText, onAddText, project, selection, time }) {
  // `selection` is held for the F3 plug-in (see the TODO on applyPicturePatch):
  // the shared applyToSelected helper will take it as its target source.
  const t = useT();
  const [stored, setStored] = useState(() => {
    migrateLegacyPresets(localStorage);
    migratePresetAssets(localStorage);
    return loadCreativePresets(localStorage);
  });
  const [filter, setFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [saveName, setSaveName] = useState('');
  const [saveTarget, setSaveTarget] = useState('filter');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);
  const packFileRef = useRef(null);

  // ---- Browse state (CC-07) ----
  const [q, setQ] = useState('');
  const [chip, setChip] = useState('all');
  const [media, setMedia] = useState('all');
  const [section, setSection] = useState('all');
  const [motionKind, setMotionKind] = useState('in');
  const [hideUnavailable, setHideUnavailable] = useState(false);
  const [showAllSection, setShowAllSection] = useState(false);
  const [favs, setFavs] = useState(() => loadComposerFavs(typeof localStorage !== 'undefined' ? localStorage : null));
  const [recentPresets, setRecentPresets] = useState(() => loadComposerRecentPresets(typeof localStorage !== 'undefined' ? localStorage : null));
  const [hoverKey, setHoverKey] = useState(null);
  const [packItems, setPackItems] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(COMPOSER_PACKS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  const [abA, setAbA] = useState(null);
  const [abB, setAbB] = useState(null);
  const [abTransition, setAbTransition] = useState('fade');
  const [abDur, setAbDur] = useState(0.5);
  const [lastApplied, setLastApplied] = useState(null);
  const [bypassed, setBypassed] = useState(false);

  const persist = (list) => { setStored(list); saveCreativePresets(localStorage, list); };
  const all = [...seedPresets(), ...stored];
  const shown = filter === 'all' ? all : all.filter((p) => p.target === filter);
  const isSeed = (p) => p.source === 'seed';
  const findStored = (id) => stored.find((p) => p.id === id);

  const presetIds = useMemo(() => new Set([
    ...seedPresets().map((p) => p.id),
    ...stored.map((p) => p.id),
    ...packItems.map((p) => p.id),
  ]), [stored, packItems]);
  const items = useMemo(() => buildComposerItems({ presetIds }), [presetIds]);
  const counts = useMemo(() => {
    const c = { all: items.length };
    for (const s of COMPOSER_SECTIONS) c[s.id] = items.filter((i) => i.section === s.id).length;
    return c;
  }, [items]);
  const visible = useMemo(() => {
    let list = filterComposerItems(items, { q, chip, media, section, favs, recentPresets, hideUnavailable });
    if (section === 'motion') list = list.filter((i) => i.phase === motionKind);
    return list;
  }, [items, q, chip, media, section, favs, recentPresets, hideUnavailable, motionKind]);

  const mediaMissing = (clip) => {
    if (!clip?.mediaId || !project?.media) return false;
    const m = project.media.find((x) => x.id === clip.mediaId);
    return !!m?.missing;
  };
  const markUsed = (item) => {
    setRecentPresets(recordComposerRecentPreset(typeof localStorage !== 'undefined' ? localStorage : null, item.key));
  };

  // Apply a per-clip patch function to the TARGETED picture clip (selection
  // first, else the clip under the playhead): one undoable dispatch.
  // `family` names the clip field the patch touches, so Bypass / Reset know
  // what to restore / clear.
  // TODO(CC-07/F3): multi-clip apply plugs in here. Stream F3 owns "apply
  // to multiple selected clips" as ONE shared helper
  // (src/fx/applyToSelected.js) — do NOT build a local copy in this panel.
  // When it lands, route this function through it (same per-clip patch fn,
  // targets from `selection` + `project`) and restore the multi-target path;
  // until then, picture applies go to the targeted clip only.
  const applyPicturePatch = (fn, label, family) => {
    if (!target) { setNote(t('composer.needClip')); return false; }
    if (mediaMissing(target.clip)) { setNote(t('composer.missingMedia', { n: 1 })); return false; }
    const patch = fn(target.clip);
    if (!patch) { setNote(t('composer.alreadyApplied', { name: label })); return false; }
    const track = target.track || 'video';
    dispatch({ type: 'update', track, id: target.clip.id, patch });
    const snap = {};
    if (family === 'motion') snap.anim = target.clip.anim;
    if (family === 'effect') snap.effects = target.clip.effects;
    if (family === 'transition') snap.transition = target.clip.transition;
    if (family === 'audio') snap.audioFx = target.clip.audioFx;
    setLastApplied({ label, family, restore: [{ track, id: target.clip.id, patch: snap }], reapply: [{ track, id: target.clip.id, patch }] });
    setBypassed(false);
    setNote(t('composer.appliedNote', { name: label }));
    return true;
  };

  const applyItem = (item) => {
    if (!item.available) return;
    if (item.kind === 'anim') {
      const ok = applyPicturePatch((clip) => {
        const a = { ...(clip.anim || {}) };
        if (item.animKind === 'combo') {
          delete a.in; delete a.out;
          a.combo = { type: item.engineId };
        } else {
          delete a.combo;
          a[item.animKind] = { type: item.engineId, duration: a[item.animKind]?.duration ?? 0.5 };
        }
        return { anim: a };
      }, item.name, 'motion');
      if (ok) markUsed(item);
      return;
    }
    if (item.kind === 'effect') {
      const ok = applyPicturePatch((clip) => (
        (clip.effects || []).includes(item.engineId) ? null : { effects: [...(clip.effects || []), item.engineId] }
      ), item.name, 'effect');
      if (ok) markUsed(item);
      return;
    }
    if (item.kind === 'transition') {
      if (!target || (target.track || 'video') !== 'video') { setNote(t('composer.needVideo')); return; }
      const ok = applyPicturePatch((clip) => ({ transition: { type: item.engineId, duration: item.duration || 0.5 } }), item.name, 'transition');
      if (ok) markUsed(item);
      return;
    }
    if (item.kind === 'text') {
      const tpl = item.template;
      const font = tpl.patch?.font;
      if (font) {
        const known = new Set(allFonts().map((f) => f.id));
        if (!known.has(font)) { setNote(t('composer.missingFont', { name: item.name, font })); return; }
      }
      const patch = { ...tpl.patch, template: tpl.id };
      if (selectedText) dispatch({ type: 'update', track: 'text', id: selectedText.id, patch });
      else if (onAddText) onAddText(patch);
      else { setNote(t('composer.needTextClip')); return; }
      markUsed(item);
      setNote(t('composer.appliedNote', { name: item.name }));
      return;
    }
    if (item.kind === 'sticker') {
      const st = item.sticker;
      dispatch({ type: 'addSticker', clipId: uid(), sticker: st.file, name: st.name, w: st.w, h: st.h, at: time || 0 });
      markUsed(item);
      setNote(t('composer.appliedNote', { name: item.name }));
      return;
    }
    if (item.kind === 'audio') {
      const ok = applyPicturePatch(() => ({ audioFx: item.audioPreset.fx }), item.name, 'audio');
      if (ok) markUsed(item);
    }
  };

  const toggleBypass = () => {
    if (!lastApplied) return;
    const list = bypassed ? lastApplied.reapply : lastApplied.restore;
    if (list.length > 1) dispatch({ type: 'updateMany', updates: list });
    else if (list.length === 1) dispatch({ type: 'update', track: list[0].track, id: list[0].id, patch: list[0].patch });
    setBypassed(!bypassed);
    setNote(t(bypassed ? 'composer.restoredNote' : 'composer.bypassedNote', { name: lastApplied.label }));
  };
  const resetLast = () => {
    if (!lastApplied) return;
    const clear = lastApplied.family === 'motion' ? { anim: {} }
      : lastApplied.family === 'effect' ? { effects: [] }
      : lastApplied.family === 'transition' ? { transition: null }
      : { audioFx: null };
    const updates = lastApplied.restore.map(({ track, id }) => ({ track, id, patch: clear }));
    if (updates.length > 1) dispatch({ type: 'updateMany', updates });
    else if (updates.length === 1) dispatch({ type: 'update', track: updates[0].track, id: updates[0].id, patch: updates[0].patch });
    setNote(t('composer.resetDone', { name: lastApplied.label }));
    setLastApplied(null);
    setBypassed(false);
  };

  // ---- A/B transition compare ----
  const clipName = (ref) => {
    if (!ref || !project) return '';
    const list = ref.track === 'overlay' ? (project.overlayClips || []) : project.videoClips;
    const clip = list.find((c) => c.id === ref.id);
    const m = clip?.mediaId && project.media?.find((x) => x.id === clip.mediaId);
    return m?.name || clip?.name || ref.id.slice(0, 8);
  };
  const assignAB = (slot) => {
    if (!target) { setNote(t('composer.needClip')); return; }
    const ref = { track: target.track || 'video', id: target.clip.id };
    if (slot === 'a') setAbA(ref); else setAbB(ref);
  };
  const dropAB = (slot) => (e) => {
    e.preventDefault();
    const p = readPayload(e);
    if (!p || p.kind !== 'media' || !project) return;
    const clip = project.videoClips.find((c) => c.mediaId === p.id)
      || (project.overlayClips || []).find((c) => c.mediaId === p.id);
    if (!clip) { setNote(t('composer.abNotOnTimeline')); return; }
    const ref = { track: project.videoClips.some((c) => c.id === clip.id) ? 'video' : 'overlay', id: clip.id };
    if (slot === 'a') setAbA(ref); else setAbB(ref);
  };
  const applyAB = () => {
    if (!abA || !abB) { setNote(t('composer.abNeedBoth')); return; }
    if (abB.track !== 'video') { setNote(t('composer.abNeedVideoB')); return; }
    dispatch({ type: 'update', track: 'video', id: abB.id, patch: { transition: { type: abTransition, duration: abDur } } });
    setNote(t('composer.abApplied', { name: clipName(abB) }));
  };

  // ---- My Library: apply / save / edit / delete / import / export (.json) ----
  const applyPreset = (preset) => {
    if (presetAppliesTo(preset) === 'picture') {
      if (!target) { setNote(t('composer.needClip')); return; }
      updateTarget(presetClipPatch(preset));
    } else {
      if (!selectedText) { setNote(t('composer.needTextClip')); return; }
      dispatch({ type: 'update', track: 'text', id: selectedText.id, patch: presetTextPatch(preset) });
    }
    setNote(t('composer.appliedNote', { name: preset.name }));
  };

  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) return;
    const clip = presetAppliesTo({ target: saveTarget }) === 'picture' ? target?.clip : selectedText;
    const preset = capturePresetFromClip(clip, saveTarget, name);
    if (!preset) { setNote(t('composer.nothingToCapture')); return; }
    persist(upsertCreativePreset(stored, preset));
    setSaveName('');
    setNote(t('composer.savedNote', { name }));
  };

  // Seeds are read-only examples: editing one copies it into your presets.
  const editable = (preset) => {
    if (!isSeed(preset)) return preset;
    const copy = newCreativePreset({
      name: `${preset.name} (${t('composer.copy')})`, target: preset.target,
      variant: preset.variant, params: JSON.parse(JSON.stringify(preset.params)),
    });
    persist(upsertCreativePreset(stored, copy));
    return copy;
  };

  const startEdit = (preset) => {
    const wasSeed = isSeed(preset);
    const p = editable(preset);
    if (wasSeed) setNote(t('composer.copiedNote', { name: preset.name }));
    setEditingId(editingId === p.id ? null : p.id);
  };

  const changeParam = (preset, def, value) => {
    if (!preset) return;
    const next = { ...preset, params: clampParams(preset.target, setParam(preset.params, def.key, value)), updatedAt: new Date().toISOString() };
    persist(upsertCreativePreset(stored, next));
    // Live preview: the edited preset applies to the current clip as it moves.
    if (presetAppliesTo(next) === 'picture') {
      if (target) updateTarget(presetClipPatch(next));
    } else if (selectedText) {
      dispatch({ type: 'update', track: 'text', id: selectedText.id, patch: presetTextPatch(next) });
    }
  };

  const editValue = (preset, def) => {
    const cur = getParam(preset.params, def.key);
    if (cur != null && Number.isFinite(Number(cur))) return Number(cur);
    if (def.def != null) return def.def;
    // Text/caption size/opacity fall back to the selected text clip.
    if (def.key === 'style.size') return selectedText?.size ?? 72;
    if (def.key === 'style.opacity') return selectedText?.opacity ?? 1;
    return def.min;
  };

  const duplicatePreset = (preset) => {
    const copy = newCreativePreset({
      name: `${preset.name} (${t('composer.copy')})`, target: preset.target,
      variant: preset.variant, params: JSON.parse(JSON.stringify(preset.params)),
    });
    persist(upsertCreativePreset(stored, copy));
    setNote(t('composer.duplicatedNote', { name: preset.name }));
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { presets, errors } = parseCreativePresetFile(await file.text());
    let list = stored;
    let n = 0;
    // P2-17: relink the imported presets' assets against this machine — a
    // bundled LUT resolves by file, a font by family name. Missing assets
    // are reported, never silently substituted; the preset still imports.
    const fontIds = new Set(allFonts().map((f) => f.id));
    const missingAssets = [];
    for (const p of presets) {
      const { missing } = await relinkAssets(p.assets || [], async (a) => {
        if (a.kind === 'lut') {
          const f = a.name;
          return BUNDLED_LUTS.some((l) => l.file === f) ? { path: `bundled:${f}` } : null;
        }
        if (a.kind === 'font') return fontIds.has(a.name) ? { path: `font:${a.name}` } : null;
        return null;
      });
      missing.forEach((a) => missingAssets.push(`${p.name}: ${a.name}`));
      const clash = list.find((x) => x.id === p.id && (x.name !== p.name || x.target !== p.target));
      list = upsertCreativePreset(list, clash ? { ...p, id: newPresetId() } : p);
      n += 1;
    }
    if (n) persist(list);
    setNote(missingAssets.length
      ? t('composer.importedMissing', { n, missing: missingAssets.join(', ') })
      : errors.length
        ? t('composer.importedNote', { n, errors: errors.length })
        : t('composer.importedClean', { n }));
  };

  // Validated .cutflowpack import (P2-14 / CC-07): the manifest is validated
  // before anything lands; a malformed or dangerous pack is rejected whole.
  const onImportPack = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { ok, errors, pack } = validatePackFile(await file.text());
    if (!ok || !pack) {
      setNote(t('composer.packInvalid', { errors: errors.join('; ') }));
      return;
    }
    const next = [...packItems, ...pack.presets.map((p) => ({ ...p, pack: pack.name }))];
    setPackItems(next);
    try { localStorage.setItem(COMPOSER_PACKS_KEY, JSON.stringify(next)); } catch { /* convenience only */ }
    setNote(t('composer.packImported', { n: pack.presets.length, name: pack.name }));
  };

  const exportPack = () => {
    const entries = [];
    let skipped = 0;
    for (const p of stored) {
      if (p.target === 'transition' && p.variant) {
        entries.push({ kind: 'transition', id: p.id, name: p.name, data: { type: p.variant, duration: p.params?.duration ?? 0.5 } });
      } else if ((p.target === 'text' || p.target === 'caption') && p.variant) {
        entries.push({ kind: 'text', id: p.id, name: p.name, data: { template: p.variant, style: p.params?.style || {} } });
      } else skipped += 1;
    }
    const manifest = buildManifest({ name: 'Cutflow Composer presets', presets: entries });
    downloadText('cutflow-presets.cutflowpack', JSON.stringify(manifest, null, 2));
    setNote(t('composer.packExported', { n: entries.length, skipped }));
  };

  const canSave = (() => {
    if (presetAppliesTo({ target: saveTarget }) === 'picture') return !!target;
    return !!selectedText;
  })();

  const applyPackItem = (p) => {
    if (p.kind === 'anim') {
      applyPicturePatch(() => ({ anim: p.data?.anim || p.data }), p.name, 'motion');
    } else if (p.kind === 'transition') {
      applyPicturePatch(() => ({ transition: { type: p.data?.type, duration: p.data?.duration || 0.5 } }), p.name, 'transition');
    } else if (p.kind === 'effect') {
      const fx = p.data?.fx || [];
      applyPicturePatch((clip) => ({ effects: [...new Set([...(clip.effects || []), ...fx])] }), p.name, 'effect');
    } else if (p.kind === 'text') {
      const patch = p.data?.patch || p.data || {};
      if (selectedText) dispatch({ type: 'update', track: 'text', id: selectedText.id, patch });
      else if (onAddText) onAddText(patch);
      setNote(t('composer.appliedNote', { name: p.name }));
    }
  };

  const tilePreview = (item) => {
    if (!item.available) return <span className="tile-preview composer-unavail" aria-hidden="true">✕</span>;
    if (item.kind === 'anim') return <span className="tile-preview"><AnimThumb kind={item.animKind} id={item.engineId} /></span>;
    if (item.kind === 'effect') return <span className="tile-preview fx-live"><FxThumb kind="effect" id={item.engineId} /></span>;
    if (item.kind === 'transition') return <span className="tile-preview fx-live"><FxThumb kind="transition" id={item.engineId} duration={item.duration || 0.5} /></span>;
    if (item.kind === 'text') return <span className="tile-preview"><TextPreview style={item.template.patch} text={item.previewText || item.template.previewText || 'Cutflow'} hover={hoverKey === item.key} width={128} height={72} /></span>;
    if (item.kind === 'sticker') return <span className="tile-preview"><StickerThumb sticker={item.sticker} /></span>;
    if (item.kind === 'audio') return <span className="tile-preview composer-audio" aria-hidden="true">♪</span>;
    return <span className="tile-preview" />;
  };

  const tile = (item) => (
    <button key={item.key} className={`tile composer-tile ${!item.available ? 'composer-tile-off' : ''}`}
      disabled={!item.available}
      onClick={() => applyItem(item)}
      onMouseEnter={() => setHoverKey(item.key)} onMouseLeave={() => setHoverKey(null)}
      title={item.available ? t('composer.applyTitle', { name: item.name }) : t('composer.unavailableMissing', { name: item.name })}>
      {tilePreview(item)}
      <span className="tile-label">{item.name}</span>
      <span className="composer-badges">
        {item.phase && <span className="composer-badge">{t(`composer.phase${item.phase === 'loop' ? 'Loop' : item.phase === 'in' ? 'In' : 'Out'}`)}</span>}
        {item.dims === '3d' && <span className="composer-badge">3D</span>}
        {!item.noFlash && <span className="composer-badge">{t('composer.flash')}</span>}
        {!item.available && <span className="composer-badge composer-badge-off">{t('composer.unavailable')}</span>}
      </span>
      <span className={`tile-star ${favs.has(item.key) ? 'on' : ''}`} role="button"
        aria-label={favs.has(item.key) ? t('composer.favRemove') : t('composer.favAdd')}
        title={favs.has(item.key) ? t('composer.favRemove') : t('composer.favAdd')}
        onClick={(e) => { e.stopPropagation(); setFavs(toggleComposerFav(typeof localStorage !== 'undefined' ? localStorage : null, item.key)); }}
        onPointerDown={(e) => e.stopPropagation()}>★</span>
    </button>
  );

  const renderSection = (sectionId) => {
    const list = visible.filter((i) => i.section === sectionId);
    // In the All view the list is capped so the page stays short — but the
    // unavailable tiles are the honest "coming soon" signal, so they are
    // never the ones the cap hides.
    const shownList = section === 'all' && !showAllSection
      ? [...list.filter((i) => i.available).slice(0, 8), ...list.filter((i) => !i.available)]
      : list;
    if (!list.length) return null;
    return (
      <div key={sectionId} className="pad-block">
        <div className="look-cat-title">{t(`composer.section${sectionId[0].toUpperCase()}${sectionId.slice(1)}`)} · {list.length}</div>
        <div className="tile-grid">{shownList.map(tile)}</div>
        {section === 'all' && list.length > 8 && !showAllSection && (
          <button className="btn btn-sm" onClick={() => { setSection(sectionId); setShowAllSection(true); }}>
            {t('composer.showAll', { name: t(`composer.section${sectionId[0].toUpperCase()}${sectionId.slice(1)}`), n: list.length })}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="lib-head">
        <div>
          <h2>{t('composer.title')}</h2>
          <p>{t('composer.hint')}</p>
        </div>
      </div>

      <div className="pad-block">
        <SearchBox value={q} onChange={setQ} placeholder={t('composer.searchPh')} ariaLabel={t('composer.searchAria')} />
        <div className="chips scroll-x" role="group" aria-label={t('composer.sections')}>
          <button className={`chip ${section === 'all' ? 'on' : ''}`} onClick={() => { setSection('all'); setShowAllSection(false); }}>{t('composer.sectionAll')} · {counts.all}</button>
          {COMPOSER_SECTIONS.filter((s) => s.id !== 'library').map((s) => (
            <button key={s.id} className={`chip ${section === s.id ? 'on' : ''}`} onClick={() => { setSection(s.id); setShowAllSection(true); }}>
              {t(`composer.section${s.id[0].toUpperCase()}${s.id.slice(1)}`)} · {counts[s.id]}
            </button>
          ))}
        </div>
        <div className="chips scroll-x" role="group" aria-label={t('composer.filters')}>
          {CHIPS.map((c) => (
            <button key={c} className={`chip ${chip === c ? 'on' : ''}`} onClick={() => setChip(c)}>
              {t(`composer.chip${c[0].toUpperCase()}${c.slice(1)}`)}
            </button>
          ))}
        </div>
        <div className="composer-tools">
          <select value={media} onChange={(e) => setMedia(e.target.value)} aria-label={t('composer.mediaAria')}>
            {MEDIA_FILTERS.map((m) => (
              <option key={m} value={m}>{t(`composer.media${m[0].toUpperCase()}${m.slice(1)}`)}</option>
            ))}
          </select>
          <label className="field check">
            <input type="checkbox" checked={hideUnavailable} onChange={(e) => setHideUnavailable(e.target.checked)} />
            <span>{t('composer.hideUnavailable')}</span>
          </label>
        </div>
        {section === 'motion' && (
          <div className="seg-tabs small" role="tablist" aria-label={t('composer.motionTabs')}>
            {['in', 'out', 'loop'].map((k) => (
              <button key={k} role="tab" aria-selected={motionKind === k} className={motionKind === k ? 'on' : ''}
                onClick={() => setMotionKind(k)}>{t(`composer.motion${k[0].toUpperCase()}${k.slice(1)}`)}</button>
            ))}
          </div>
        )}
      </div>

      {section === 'all'
        ? COMPOSER_SECTIONS.filter((s) => s.id !== 'library').map((s) => renderSection(s.id))
        : renderSection(section)}
      {!visible.length && (
        <div className="pad-block"><p className="hint">{t('composer.emptyBrowse')}</p></div>
      )}

      {lastApplied && (
        <div className="pad-block">
          <div className="look-cat-title">{t('composer.lastApplied', { name: lastApplied.label })}</div>
          <div className="composer-io">
            <button className="btn btn-sm" onClick={toggleBypass}>{bypassed ? t('composer.restore') : t('composer.bypass')}</button>
            <button className="btn btn-sm" onClick={resetLast}>{t('composer.reset')}</button>
          </div>
        </div>
      )}

      <div className="pad-block">
        <div className="look-cat-title">{t('composer.abTitle')}</div>
        <p className="hint">{t('composer.abHint')}</p>
        <div className="composer-ab">
          {['a', 'b'].map((slot) => {
            const ref = slot === 'a' ? abA : abB;
            return (
              <div key={slot} className="composer-ab-slot"
                onDragOver={(e) => e.preventDefault()} onDrop={dropAB(slot)}>
                <span className="dim small">{t(slot === 'a' ? 'composer.abSlotA' : 'composer.abSlotB')}</span>
                <b>{ref ? clipName(ref) : t('composer.abEmpty')}</b>
                <button className="btn btn-sm" onClick={() => assignAB(slot)}>{t('composer.abUseSelected')}</button>
              </div>
            );
          })}
        </div>
        <div className="composer-tools">
          <select value={abTransition} onChange={(e) => setAbTransition(e.target.value)} aria-label={t('composer.abTransitionAria')}>
            {TRANSITIONS.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
          </select>
          <Slider dispatch={dispatch} label={t('insp.duration')} value={abDur} min={0.2} max={2} step={0.05}
            fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setAbDur(v)} />
        </div>
        <div className="tile-grid">
          <div className="tile" aria-hidden="true">
            <span className="tile-preview fx-live"><FxThumb kind="transition" id={abTransition} duration={abDur} /></span>
            <span className="tile-label">{t('composer.abPreview')}</span>
          </div>
        </div>
        <div className="composer-io">
          <button className="btn btn-sm" disabled={!abA || !abB} onClick={applyAB}>{t('composer.abApply')}</button>
        </div>
      </div>

      <div className="pad-block">
        <div className="look-cat-title">{t('composer.saveTitle')}</div>
        <div className="preset-save">
          <input type="text" value={saveName} placeholder={t('composer.saveNamePh')} aria-label={t('composer.saveNameAria')}
            onChange={(e) => setSaveName(e.target.value)} />
          <select value={saveTarget} onChange={(e) => setSaveTarget(e.target.value)} aria-label={t('composer.saveTargetAria')}>
            {PRESET_TARGETS.map((tg) => <option key={tg} value={tg}>{targetDef(tg).label}</option>)}
          </select>
          <button className="btn btn-sm" disabled={!canSave || !saveName.trim()} onClick={saveCurrent}
            title={canSave ? t('composer.saveTitle') : t('composer.saveDisabledTitle')}>{t('composer.save')}</button>
        </div>
        {!canSave && <p className="hint">{presetAppliesTo({ target: saveTarget }) === 'picture' ? t('composer.needClip') : t('composer.needTextClip')}</p>}
      </div>

      {note && <div className="pad-block"><p className="hint">{note}</p></div>}

      <div className="pad-block">
        <div className="look-cat-title">{t('composer.libraryTitle')}</div>
        <div className="chips scroll-x">
          <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>{t('composer.all')} · {all.length}</button>
          {PRESET_TARGETS.map((tg) => (
            <button key={tg} className={`chip ${filter === tg ? 'on' : ''}`} onClick={() => setFilter(tg)}>
              {targetDef(tg).label} · {all.filter((p) => p.target === tg).length}
            </button>
          ))}
        </div>
        {!shown.length && <p className="hint">{t('composer.empty')}</p>}
        {shown.map((preset) => {
          const editing = editingId === preset.id && findStored(preset.id);
          const shown_preset = editing || preset;
          return (
            <div key={preset.id} className="composer-row">
              <button className="composer-apply" onClick={() => applyPreset(preset)} title={t('composer.applyTitle', { name: preset.name })}>
                <span className="composer-name">{preset.name}</span>
                <span className="composer-meta">{targetDef(preset.target).label} · {preset.variant || preset.family}{preset.source === 'seed' ? ` · ${t('composer.seed')}` : preset.source?.startsWith('legacy') ? ` · ${t('composer.migrated')}` : ''}</span>
              </button>
              <span className="composer-actions">
                <button className="btn btn-sm" onClick={() => startEdit(preset)}>{editing ? t('composer.done') : t('composer.edit')}</button>
                <button className="btn btn-sm" onClick={() => downloadText(`cutflow-preset-${slug(preset.name)}.json`, serializeCreativePreset(preset))}>{t('composer.export')}</button>
                <button className="btn btn-sm" onClick={() => duplicatePreset(preset)}>{t('composer.duplicate')}</button>
                {!isSeed(preset) && (
                  <button className="btn btn-sm" aria-label={t('composer.deletePreset', { name: preset.name })}
                    onClick={() => { persist(removeCreativePreset(stored, preset.id)); if (editingId === preset.id) setEditingId(null); setNote(t('composer.deletedNote', { name: preset.name })); }}>×</button>
                )}
              </span>
              {editing && (
                <div className="composer-edit">
                  {paramDefs(shown_preset.target).map((def) => (
                    <Slider key={def.key} dispatch={dispatch} label={def.label}
                      value={editValue(shown_preset, def)} min={def.min} max={def.max} step={def.step}
                      fmt={(v) => `${Number(v).toFixed(def.step >= 1 ? 0 : 2)}${def.unit || ''}`}
                      onChange={(v) => changeParam(findStored(shown_preset.id), def, v)} />
                  ))}
                  <p className="hint">{t('composer.editHint')}</p>
                </div>
              )}
            </div>
          );
        })}
        {packItems.length > 0 && (
          <div className="pad-block">
            <div className="look-cat-title">{t('composer.packItemsTitle')}</div>
            {packItems.map((p, i) => (
              <div key={`${p.kind}:${p.id}:${i}`} className="composer-row">
                <button className="composer-apply" onClick={() => applyPackItem(p)} title={t('composer.applyTitle', { name: p.name })}>
                  <span className="composer-name">{p.name}</span>
                  <span className="composer-meta">{p.kind} · {p.pack || ''}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pad-block">
        <div className="composer-io">
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>{t('composer.import')}</button>
          <button className="btn btn-sm" onClick={() => downloadText('cutflow-presets.json', serializeCreativePresets(stored))} disabled={!stored.length}>{t('composer.exportAll')}</button>
          <button className="btn btn-sm" onClick={() => packFileRef.current?.click()}>{t('composer.packImport')}</button>
          <button className="btn btn-sm" onClick={exportPack} disabled={!stored.length}>{t('composer.packExport')}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
          <input ref={packFileRef} type="file" accept=".cutflowpack,application/json" style={{ display: 'none' }} onChange={onImportPack} />
        </div>
        <p className="hint">{t('composer.ioHint')}</p>
      </div>
    </>
  );
}
