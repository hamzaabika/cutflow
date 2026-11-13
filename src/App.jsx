import React, { useMemo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useT, tr, getLanguage } from './i18n/index.jsx';
import { recentEntryFor } from './recents.js';
import { isTrashExpired, mergeHomeEntries, trashEntryForRecent, trashEntryForSlot } from './homeList.js';
import { IMAGE_DEFAULT, LAYERED, canvasFor, clipLayer, clipLen, emptyProject, exportDuration, findClipIn, findLinkPartner, freeLen, historyReducer, isLayerLocked, layerCount, layerFree, layerName, layerOf, levelCopyState, lockedMediaUse, markerNear, needsPreviewCopy, newVideoClip, parseEffectKey, pickAttributes, projectDuration, renderable, replaceClipPatch, setPlaybackQuality, toFileUrl, trimActions, uid, videoClipAt, videoLayout } from './store.js';

// Layer display name for menus/alerts: user rename wins, else the localised
// lane default. store.layerName stays the English data form.
const layerDispName = (p, track, layer) => (p.layerNames && p.layerNames[track] && p.layerNames[track][layer]) || `${tr('lane.' + track)} ${layer + 1}`;
import { sliceCurve, sourceOffsetAt, timelineOffsetAt } from './speedCurve.js';
import HomeScreen from './components/HomeScreen.jsx';
import SequenceDialog from './components/SequenceDialog.jsx';
import ColorMatteDialog from './components/ColorMatteDialog.jsx';
import { mismatchFor, sequencePatchFor } from './sequence.js';
import { buildVerticalCopy } from './reframe.js';
import { beatSplitTarget } from './beats.js';
import { sizeFor } from './effects.js';
import ContextMenu from './components/ContextMenu.jsx';
import {
  AudioLines, ChevronLeft, ChevronRight, CircleAlert, ClipboardPaste, Copy, CopyPlus, Crop, Crosshair, Eraser, Eye, EyeOff, FileAudio, FlipHorizontal2, Gauge, Info, Layers, Link2, ListChecks, Loader2, Paintbrush, PanelBottom, Pin, PinOff, Pipette, RefreshCw, Rewind, RotateCcw, RotateCw, Scissors, ScissorsLineDashed, Snowflake, Sparkles, Split, Trash2, Unlink,
} from './icons.jsx';
import { brandTextPatch, loadBrand } from './brand.js';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { useRecorder } from './useRecorder.js';
import { useLayout, effectiveWidths } from './useLayout.js';
import { customMaskImages, decoImages, maskImages } from './visual.js';
import { motionData } from './anim.js';
import { clipStartTl, motionDataPinned, trackedClips } from './track.js';
import { CROP_ASPECTS, aspectRatioOf, cropForAspect } from './cropMath.js';
import { chromaOf, cropOf, resetTransformPatch, transformOf } from './visual.js';
import { isLookPatch, lookAction, selectedPictures } from './look.js';
import { regroupSegments, toSRT } from './subtitles.js';
import { loadProjectLuts, onLutLoaded } from './fx/lut.js';
import { audioFxFilters, hasAudioFx } from './fx/audioFxChain.js';
import { audioFxPathOf, audioFxSourceFor } from './fx/audioFxPreview.js';
import LeftPanel from './components/LeftPanel.jsx';
import Preview from './components/Preview.jsx';
import Timeline, { makeSelection } from './components/Timeline.jsx';
import SpeedDialog from './components/SpeedDialog.jsx';
import Inspector from './components/Inspector.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import ExportJobsTray from './components/ExportJobsTray.jsx';
import EnhanceDialog from './components/EnhanceDialog.jsx';
import { audioPhaseId, audioPhases, enhancePhases, jobsAhead, videoPhases } from './exportJobs.js';
import { EXPORT_PRESETS, resolveExport, settingsPatch, storedExportSettings } from './exportQuality.js';
import CloseDialog from './components/CloseDialog.jsx';
import RelinkDialog from './components/RelinkDialog.jsx';
import HistoryDialog from './components/HistoryDialog.jsx';
import BridgeDialog from './components/BridgeDialog.jsx';
import TopBar from './components/TopBar.jsx';
import TopRail from './components/TopRail.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import KeystrokesOverlay from './components/KeystrokesOverlay.jsx';
import { actionForEvent, applyKeymapOverrides, bindingHint, firstBinding, getCurrentKeymap, isKeyCaptureActive } from './keymap.js';
import { AboutDialog, UpdateNotice, useUpdateCheck } from './components/About.jsx';
import WelcomeCard from './components/WelcomeCard.jsx';
import ScreenRecordDialog from './components/ScreenRecordDialog.jsx';
import { useScreenRecorder } from './useScreenRecorder.js';
import CraftAI from './components/CraftPilot.jsx';
import { isFiles, isInternal } from './dnd.js';
import { renderTextFrames } from './exportText.js';
import { fxWork, renderFxPass } from './fxExport.js';
import { TEXT_TEMPLATES } from './text/catalog.js';
import { allFonts } from './fonts.js';

// (The emoji-to-PNG rasterizer that lived here served only the Stickers feature, removed
// in R1 — emoji inside TEXT clips render through the text pipeline, not this helper.)

// The shortcut a context menu shows for an action, in the menu's
// space-joined house style ('Ctrl Shift S'). It reads the CURRENT keymap
// at render time, so a remapped action's menu label follows its binding —
// and an unbound action shows no shortcut at all rather than a stale one.
const menuKey = (id) => {
  const b = firstBinding(getCurrentKeymap(), id);
  return b ? b.replaceAll('+', ' ') : undefined;
};

export default function App() {
  const t = useT();
  const NUM_LOCALES = { en: 'en-US', fr: 'fr-FR', ar: 'ar' };
  const [state, dispatch] = useReducer(historyReducer, { past: [], present: emptyProject(), future: [] });
  const project = state.present;
  const [time, setTime] = useState(0);
  // Shared playback clock: Preview (writer) publishes { time, stamp, playing, rate } every
  // frame; the Timeline playhead reads it directly so it glides without React re-renders.
  const clockRef = useRef({ time: 0, stamp: 0, playing: false, rate: 1 });
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null); // { track, id }
  // Selection as the timeline and the preview see it: linked pairs (Detach audio) select
  // together, and clips on locked layers cannot be selected at all.
  const select = useCallback((sel) => {
    if (!sel) return setSelection(null);
    const p = projectRef.current;
    const items = sel.items ? [...sel.items] : [{ track: sel.track, id: sel.id }];
    const have = new Set(items.map((i) => `${i.track}:${i.id}`));
    for (const it of [...items]) {
      const c = findClipIn(p, it.track, it.id);
      const partner = c && findLinkPartner(p, c);
      if (partner && !have.has(`${partner.track}:${partner.clip.id}`)) {
        items.push({ track: partner.track, id: partner.clip.id });
        have.add(`${partner.track}:${partner.clip.id}`);
      }
    }
    const kept = items.filter((it) => {
      const c = findClipIn(p, it.track, it.id);
      return !c || !isLayerLocked(p, it.track, clipLayer(it.track, c));
    });
    setSelection(kept.length ? makeSelection(kept) : null);
  }, []);
  const [exporting, setExporting] = useState(null); // the export FORM state only (R4) — progress/done live in exportJobs
  const [enhanceDlg, setEnhanceDlg] = useState(null); // { sel, media } while the AI Enhance form is open
  const [jobToast, setJobToast] = useState(null); // one-line completion notice (AI Enhance), auto-dismissed
  const jobToastTimer = useRef(null);
  const showJobToast = (msg) => {
    setJobToast(msg);
    if (jobToastTimer.current) clearTimeout(jobToastTimer.current);
    jobToastTimer.current = setTimeout(() => setJobToast(null), 6000);
  };
  const [exportJobs, setExportJobs] = useState([]); // snapshots of the job records in exportJobMap, for the tray
  const exportJobMap = useRef(new Map()); // id -> live job record (payload + view fields); the queue's source of truth
  const exportActiveId = useRef(null); // the one running job's id — main has a single export slot per kind and one shared progress channel
  const [renderJob, setRenderJob] = useState(null); // derivative renders: { kind: 'reverse' | 'detach', label, fraction } | { error }
  const [trackPick, setTrackPick] = useState(null); // motion tracking pick mode: { track, id, point: {x,y} | null, box: {w,h} }
  const [cropEdit, setCropEdit] = useState(null); // visual crop mode: { track, id, snapshot: { crop, cropAspect } }
  const [silenceAsk, setSilenceAsk] = useState(null); // silence removal awaiting confirm: { track, id, ranges: [{start,end}] (timeline), totalSec }
  const [tab, setTab] = useState('media');
  const { layout: panes, collapsed, toggle: togglePanel, startDrag: startResize, reset: resetSize, nudge: nudgeSize } = useLayout();
  const effWidths = effectiveWidths(panes, collapsed);
  const [tool, setTool] = useState('select'); // timeline tool: 'select' | 'razor'
  const [clipboard, setClipboard] = useState(null); // { track, clip } for copy / cut / paste
  const [attrClipboard, setAttrClipboard] = useState(null); // copied look and placement
  const [menu, setMenu] = useState(null); // right-click menu: { x, y, track, id }
  const [speedAsk, setSpeedAsk] = useState(null); // clip whose Speed / Duration dialog is open: { track, id }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pilotOpen, setPilotOpen] = useState(false); // FlowAI panel: toggled from the floating pill over the timeline
  const [quality, setQuality] = useState('full'); // Playback quality: which scaled copy the player uses
  const [perfMode, setPerfMode] = useState('balanced'); // Performance mode (Settings + the player toggle)
  const prePerfQuality = useRef(null); // the playback quality Performance mode replaced, restored on toggle-off
  const [aboutOpen, setAboutOpen] = useState(false);
  // ---- First run: the welcome card shows exactly once (flag in settings.json via
  // firstrun IPC); About replays the card on demand. ----
  // B3 (2026-11-01): the multi-step tour became this single card. The persisted flag
  // keeps its name (tourSeen) so profiles that already saw the tour count as seen and
  // never get the card; the trigger and the dismissal chain are unchanged.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  // W6 (2026-11-01): the first-run surface no longer fires at app launch on the Home
  // screen. It starts the first time the user ENTERS a project (the editor), once
  // only. tourSeen stays null until the persisted flags load, so a fast first click
  // can't slip past it either way.
  const [tourSeen, setTourSeen] = useState(null);
  // The first-run flow is the Welcome card only — nothing chains after it.
  useEffect(() => {
    let alive = true;
    Promise.resolve(window.api.firstRunGet?.()).then((f) => {
      if (!alive || !f) return;
      setTourSeen(!!f.tourSeen);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false);
    setTourSeen(true);
    window.api.firstRunSet?.({ tourSeen: true }).catch(() => {});
  }, []);
  const [update, setUpdate] = useUpdateCheck(); // manual update check state (About dialog)
  const [updateSeen, setUpdateSeen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0); // bumps when Settings closes so the assistant re-reads the AI setup
  const [dragOver, setDragOver] = useState(false);
  const duration = projectDuration(project);
  const [captions, setCaptions] = useState({ installed: false });

  // Autosave for crashes: the project is kept in this PC's local storage a second after each change. If the
  // interface crashes and reloads by itself, it comes back as it was (the main process says when that happened).
  const [recoveredNote, setRecoveredNote] = useState(false);
  // Draft safety (Sprint 7): a note when an open was recovered from a backup/autosave
  // state, the relink offer when source media is missing, and the version-history dialog.
  const [fileNote, setFileNote] = useState(null);
  const [relinkAsk, setRelinkAsk] = useState(null); // { items: [{ id, name, path, ... }] }
  const [historyOpen, setHistoryOpen] = useState(false);
  // Agent draft bridge (Sprint 8): whether the local bridge is enabled, how many
  // agent shadow drafts wait for review, and the review dialog itself.
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [bridgeInfo, setBridgeInfo] = useState({ enabled: false, pending: 0 });
  // LUTs used by the clips are read from disk once; the player draws again when one is ready.
  const [, setLutTick] = useState(0);
  useEffect(() => onLutLoaded(() => setLutTick((n) => n + 1)), []);
  useEffect(() => { loadProjectLuts(project); }, [project]);
  // Auto save: a project that has a file is written to it 1.5 s after each change. A project that never had a file
  // is kept in local storage only; closing asks to save it, and the next start offers it back if it was lost.
  // On top of that, EVERY project is kept in its own autosave slot (electron/autosave.cjs, keyed by
  // project.id): Home lists the slots next to the file recents, so leaving a project — Home, a new
  // project, another open — never strands it. Switching flushes the slot first (flushAutosave).
  const autosave = useRef({ timer: null, project, file: null, fileTimer: null, writing: null, slotTimer: null });
  autosave.current.project = project;
  const [saveState, setSaveState] = useState('new'); // 'new' | 'saving' | 'saved' | 'error'
  const [unsavedNote, setUnsavedNote] = useState(null); // { savedAt, project } left by a session that ended unsaved
  const [closeAsk, setCloseAsk] = useState(null); // { name, resolve }: the "Save before closing?" question
  // ---- Home screen + recent projects (localStorage 'clipcraft.recents') ----
  const [screen, setScreen] = useState('home'); // 'home' | 'editor'
  // W6 deferred welcome trigger: the first entry into the editor with the first-run
  // surface unseen opens the welcome card (declared here, after `screen`). The pack
  // prompt is NOT moved — it still chains off closeWelcome, exactly as before.
  useEffect(() => {
    if (screen === 'editor' && tourSeen === false && !welcomeOpen) setWelcomeOpen(true);
  }, [screen, tourSeen, welcomeOpen]);
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clipcraft.recents') || '[]'); } catch { return []; }
  });
  const [seqAsk, setSeqAsk] = useState(null); // { media, mismatch, proceed }: sequence mismatch waiting for the user
  const [matteDlg, setMatteDlg] = useState(null); // { color }: the new-colour-matte dialog (checklist #11), null when closed
  const storeRecents = (list) => {
    setRecents(list);
    try { localStorage.setItem('clipcraft.recents', JSON.stringify(list)); } catch { /* storage full: recents just don't persist */ }
  };
  const pushRecent = (entry) => {
    if (!entry?.path) return;
    setRecents((list) => {
      const next = [entry, ...list.filter((r) => r.path !== entry.path)].slice(0, 12);
      try { localStorage.setItem('clipcraft.recents', JSON.stringify(next)); } catch { /* as above */ }
      return next;
    });
  };
  const recentOf = (p, path) => recentEntryFor(p, path, toFileUrl);
  const removeRecent = (path) => storeRecents(recents.filter((r) => r.path !== path));
  const hasContent = (p) => !!(p.media.length || p.videoClips.length || p.textClips.length || p.audioClips.length
    || (p.overlayClips || []).length);
  const keepRecovery = (unsaved) => {
    try {
      localStorage.setItem('clipcraft.recovery', JSON.stringify({
        savedAt: Date.now(), project: autosave.current.project, file: autosave.current.file, unsaved,
      }));
    } catch {
      // storage full: the next save tries again
    }
  };
  const writeFile = async () => {
    const a = autosave.current;
    clearTimeout(a.fileTimer);
    a.fileTimer = null;
    if (!a.file) return true;
    setSaveState('saving');
    const ok = await window.api.autosaveProject(a.file, JSON.stringify(a.project, null, 2));
    setSaveState(ok ? 'saved' : 'error');
    return ok;
  };
  // ---- Per-project autosave slots: Home's switchboard ----
  const [autoSlots, setAutoSlots] = useState([]);
  const refreshSlots = () => {
    window.api.slotList?.().then((l) => { if (Array.isArray(l)) setAutoSlots(l); }).catch(() => {});
  };
  // Home's trash (R5): slot-backed projects park inside the slot store (30-day purge
  // runs in the store's list pass); file-only projects park as a REFERENCE here in
  // localStorage — the user's file itself is never moved or deleted. Expired
  // references are dropped on load and on every refresh.
  const [slotTrash, setSlotTrash] = useState([]);
  const [fileTrash, setFileTrash] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('clipcraft.trash') || '[]');
      return Array.isArray(raw) ? raw.filter((t) => t && t.path && !isTrashExpired(t)) : [];
    } catch { return []; }
  });
  const storeFileTrash = (list) => {
    setFileTrash(list);
    try { localStorage.setItem('clipcraft.trash', JSON.stringify(list)); } catch { /* storage full: trash just doesn't persist */ }
  };
  const refreshTrash = () => {
    window.api.slotListTrashed?.().then((l) => { if (Array.isArray(l)) setSlotTrash(l); }).catch(() => {});
    const kept = fileTrash.filter((t) => !isTrashExpired(t));
    if (kept.length !== fileTrash.length) storeFileTrash(kept);
  };
  const refreshHome = () => { refreshSlots(); refreshTrash(); };
  useEffect(() => { refreshHome(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (screen === 'home') refreshHome(); }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Legacy namespace: the pre-B3 tour's scratch projects carried 'tour-' ids. None are
  // created any more, but ones saved by users still exist — they never get a slot, so
  // they can never pollute the Home list.
  const isTourId = (id) => typeof id === 'string' && id.startsWith('tour-');
  // The slot record for a project (defaults: the one in the editor). A project earns a slot
  // once it has content, or from the start when it is file-backed; a pristine empty project
  // has nothing to lose and stays slotless until the first real edit.
  const slotRecord = (p = autosave.current.project, file = autosave.current.file) => {
    if (!p || !p.id || isTourId(p.id)) return null;
    if (!file && !hasContent(p)) return null;
    const e = recentEntryFor(p, file || '', toFileUrl);
    return { id: p.id, title: p.name || 'Untitled', file: file || null, ratio: p.ratio || '', thumb: e.thumb, duration: e.duration || 0, updatedAt: Date.now(), projectJson: JSON.stringify(p) };
  };
  const writeSlotNow = async (p, file) => {
    const a = autosave.current;
    clearTimeout(a.slotTimer);
    a.slotTimer = null;
    const rec = slotRecord(p, file);
    if (!rec) return;
    try { await window.api.slotWrite(rec); refreshSlots(); } catch { /* the next change retries */ }
  };
  // Force-write everything pending for the CURRENT project (its file, then its slot) —
  // awaited before any switch (Home, new, open) so no edit hides inside a debounce window.
  const flushAutosave = async () => {
    await writeFile();
    await writeSlotNow();
  };
  // Opening a project FILE adopts the id of the slot bound to that file (if any), so the
  // file and its slot stay one identity; the caller then rewrites the slot from the file's
  // content (at open time the file wins — it is what the user chose to open).
  const adoptFileBinding = async (p, file) => {
    if (!file) return p;
    try {
      const entry = await window.api.slotForFile(file);
      return entry?.id ? { ...p, id: entry.id } : p;
    } catch { return p; }
  };
  // Draft safety, after any project load (file, slot, version): when the main process
  // recovered the project from a backup or the autosave slot because the file itself
  // was damaged, say so plainly; when source media is missing, offer the relink flow
  // instead of leaving black clips.
  const afterLoadNotes = (res) => {
    if (res?.recoveredFrom) {
      const when = res.recoveredFrom.savedAt
        ? new Date(res.recoveredFrom.savedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        : null;
      setFileNote(res.recoveredFrom.kind === 'backup'
        ? t('app.recoveredBackup', { when: when ? t('app.fromWhen', { when }) : '' })
        : t('app.recoveredAuto', { when: when ? t('app.parenWhen', { when }) : '' }));
    }
    if (Array.isArray(res?.missing)) {
      // The disk is the truth (Part 3, 2026-11-10): the load-time existence
      // check also lands on the media items themselves, so skipping the
      // relink dialog leaves the lost state visible in the pool, the
      // timeline and the player instead of vanishing with the dialog.
      dispatch({ type: 'setMediaMissing', ids: res.missing.map((m) => m.id) });
      if (res.missing.length) setRelinkAsk({ items: res.missing });
    }
  };
  // Relink applied: the store patches the media paths through every history state
  // (not an undo step); the regular autosave cadence then persists the new locations
  // to the project file and its slot.
  const applyRelink = (updates) => {
    const after = relinkAsk?.after;
    setRelinkAsk(null);
    if (!updates?.length) return;
    dispatch({ type: 'relinkMedia', updates });
    setFileNote(t(updates.length === 1 ? 'app.relinkedOne' : 'app.relinkedOther', { n: updates.length }));
    // Export-guard retry: this relink was standing in for a blocked export.
    // Once the store commit lands (projectRef syncs on render), re-enter the
    // export flow — its own fresh existence check decides if it may proceed.
    if (after?.kind === 'export') setTimeout(() => startExport(), 0);
    else if (after?.kind === 'audio') setTimeout(() => exportAudio(after.format, after.clipSel), 0);
  };
  // Re-open the relink flow for ONE lost item (pool card / clip menu): the
  // dialog item uses the same shape findMissingMedia returns at load.
  const reopenRelink = (m) => {
    if (!m) return;
    setRelinkAsk({ items: [{ id: m.id, name: m.name, path: m.path, type: m.type || '', duration: m.duration || 0, width: m.width || 0, height: m.height || 0 }] });
  };
  // Export guard (Part 3 addendum, 2026-11-10): before an export is set up or
  // started, re-verify the referenced paths against the disk with the
  // load-time mechanism (a file can be deleted while the app is open),
  // refresh the store's lost flags from the answer, and if anything is gone
  // stop here — the relink dialog lists the files; relinking retries the
  // export, closing the dialog cancels it. Returns true when blocked.
  // `scopedMedia` narrows the check (one clip's audio export) and merges the
  // flags instead of re-syncing them project-wide.
  const guardMissingForExport = async (proj, after, scopedMedia) => {
    let miss = [];
    try { miss = (await window.api.checkMissingMedia?.(scopedMedia ? { media: scopedMedia } : proj)) || []; } catch { miss = []; }
    dispatch({ type: 'setMediaMissing', ids: miss.map((m) => m.id), merge: !!scopedMedia });
    if (!miss.length) return false;
    setRelinkAsk({ items: miss, after });
    return true;
  };
  // Mid-session missing-media refresh (checklist #1, 2026-11-13): a file can
  // be deleted from disk while the app is open, and the load-time check never
  // sees it — the timeline would keep playing the cached proxy as if nothing
  // happened. Re-verify against the disk before playback starts and whenever
  // the window regains focus. Silent: only the lost flags refresh (red cards
  // and clips, dark slots, muted audio); the relink dialog stays a
  // load/export-time thing. Without `merge` the id list is the complete
  // truth, so a file that came back clears again.
  const refreshMissingMedia = useCallback(async () => {
    const p = projectRef.current;
    if (!p?.media?.length) return [];
    let miss = [];
    try { miss = (await window.api.checkMissingMedia?.(p)) || []; } catch { miss = []; }
    dispatch({ type: 'setMediaMissing', ids: miss.map((m) => m.id) });
    return miss;
  }, []);
  // Restore an earlier version: the CURRENT state is recorded as a restore point
  // first (and flushed to file + slot), so the restore itself can be undone from the
  // same history list. The project keeps its identity and its current file binding.
  const restoreVersion = async (entry) => {
    const p = projectRef.current;
    if (!p?.id || !entry?.file) return;
    try { await window.api.versionsRecord?.(p.id, JSON.stringify(p), autosave.current.file); } catch { /* the restore still proceeds */ }
    const res = await window.api.versionsRead?.(p.id, entry.file);
    if (!res?.json) {
      alert(t('app.versionUnreadable'));
      return;
    }
    let vp;
    try {
      vp = JSON.parse(res.json);
    } catch {
      alert(t('app.versionDamaged'));
      return;
    }
    await flushAutosave();
    dispatch({ type: 'load', project: { ...vp, id: p.id } });
    setHistoryOpen(false);
    setSaveState(autosave.current.file ? 'saved' : 'new');
    setUnsavedNote(null);
    setSelection(null);
    setTime(0);
    setFileNote(t('app.restoredVersion', { when: new Date(entry.savedAt).toLocaleString(NUM_LOCALES[getLanguage()] || 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) }));
    if (res.missing?.length) { dispatch({ type: 'setMediaMissing', ids: res.missing.map((m) => m.id) }); setRelinkAsk({ items: res.missing }); }
  };
  // Agent draft bridge: keep the TopBar badge + enabled flag fresh (main pushes
  // a change event whenever a shadow appears, is edited, or is resolved).
  const refreshBridge = useCallback(() => {
    window.api.bridgeGetState?.()
      .then((st) => { if (st) setBridgeInfo({ enabled: !!st.enabled, pending: st.pending || 0 }); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshBridge();
    return window.api.onBridgeShadowsChanged?.(refreshBridge);
  }, [refreshBridge]);
  // Accept an agent draft: flush first so main's view of the live project is
  // exactly this one (the accept is a revision compare-and-swap — a project
  // that moved since the draft was made refuses, and nothing is overwritten).
  // The current state is recorded as a restore point first, like a restore.
  const acceptBridgeDraft = async (shadow) => {
    const p = projectRef.current;
    if (!p?.id || shadow.projectId !== p.id) return { error: t('app.draftOtherProject') };
    try { await window.api.versionsRecord?.(p.id, JSON.stringify(p), autosave.current.file); } catch { /* the accept still proceeds */ }
    await flushAutosave();
    const res = await window.api.bridgeAccept?.(shadow.id, p.id);
    if (!res) return { error: t('app.bridgeNoAnswer') };
    if (res.conflict) { refreshBridge(); return { conflict: true }; }
    if (!res.ok) return { error: res.error || t('app.draftApplyFailed') };
    let np;
    try {
      np = JSON.parse(res.json);
    } catch {
      return { error: t('app.appliedUnreadable') };
    }
    dispatch({ type: 'load', project: { ...np, id: p.id } });
    setSaveState(autosave.current.file ? 'saved' : 'new');
    setUnsavedNote(null);
    setSelection(null);
    setTime(0);
    setFileNote(t('app.appliedDraft'));
    refreshBridge();
    return { ok: true };
  };
  const discardBridgeDraft = async (shadowId) => {
    try { await window.api.bridgeDiscard?.(shadowId); } catch { /* the list refresh shows the truth */ }
    refreshBridge();
  };
  useEffect(() => {
    const a = autosave.current;
    // At most once a second, and always the latest project (thumbnails arriving keep changing it).
    if (!a.timer) {
      a.timer = setTimeout(() => {
        a.timer = null;
        // An unsaved project offered back at start stays stored until the user answers or starts working.
        if (a.pendingRestore && !hasContent(a.project)) return;
        a.pendingRestore = false;
        keepRecovery(!a.file && hasContent(a.project));
      }, 1000);
    }
    if (a.file) {
      clearTimeout(a.fileTimer);
      a.fileTimer = setTimeout(writeFile, 1500);
    }
    // The project's own autosave slot, a second after the last change (true debounce:
    // thumbnail arrivals keep pushing it out, the write always carries the latest state).
    clearTimeout(a.slotTimer);
    a.slotTimer = setTimeout(() => { a.slotTimer = null; writeSlotNow(); }, 1000);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('clipcraft.recovery') || 'null');
    } catch {
      // nothing usable saved
    }
    window.api.wasRecovered?.().then(async (was) => {
      // The recovery snapshot lives in localStorage, whose commits lag behind the
      // edits (and a hard kill can lose the last one). The project's autosave slot is
      // written to disk on the same cadence, atomically — so when a slot exists for
      // the snapshot's project, the slot's state is the recovery payload: the exact
      // project that was open, at its freshest state.
      let snap = saved;
      const pid = saved?.project?.id;
      if (pid && !isTourId(pid)) {
        try {
          const slot = await window.api.slotRead?.(pid);
          if (slot?.project) {
            snap = { savedAt: slot.updatedAt || saved.savedAt, project: slot.project, file: slot.file || null, unsaved: saved.unsaved };
          }
        } catch { /* slot unreadable: the snapshot stands */ }
      }
      if (was && snap?.project) {
        // The window crashed and reloaded: same project, same file.
        autosave.current.file = snap.file || null;
        if (snap.file) setSaveState('saved');
        dispatch({ type: 'load', project: snap.project });
        setRecoveredNote(true);
        setScreen('editor');
      } else if (snap?.unsaved && snap.project && hasContent(snap.project)) {
        autosave.current.pendingRestore = true;
        setUnsavedNote(snap);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Thumbnails / waveforms are generated in the background after import.
  useEffect(() => window.api.onMediaVisuals(({ path, ...patch }) => dispatch({ type: 'mediaVisuals', path, patch })), []);
  // When a video thumbnail lands for the project that backs a recents entry, refresh that
  // entry's poster in place (no reorder, no date change). Degrades silently otherwise.
  const firstVideoThumb = (project.media || []).find((m) => m.type === 'video' && m.thumb)?.thumb || null;
  const firstVideoPoster = (project.media || []).find((m) => m.type === 'video' && m.poster)?.poster || null;
  useEffect(() => {
    const f = autosave.current.file;
    if (!f || (!firstVideoThumb && !firstVideoPoster)) return;
    setRecents((list) => {
      const e = list.find((r) => r.path === f);
      if (!e) return list;
      const fresh = recentEntryFor(project, f, toFileUrl);
      if (!fresh.thumb || JSON.stringify(fresh.thumb) === JSON.stringify(e.thumb)) return list;
      const next = list.map((r) => (r.path === f ? { ...r, thumb: fresh.thumb } : r));
      try { localStorage.setItem('clipcraft.recents', JSON.stringify(next)); } catch { /* as above */ }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstVideoThumb, firstVideoPoster]);
  // Ask for visuals that are missing (older projects, files imported before this feature, moved caches).
  // Below Full playback quality, every video also needs its copy for the level (levelCopyState 'fallback':
  // not made yet; 'failed' is retried once per session by the main process). While the copy is missing
  // the player uses a fallback file.
  // A video carrying saved copy pointers (proxy / lightProxy / proxies[q]) is also queued: those are
  // absolute cache paths saved in the project, and only the main process can check the files still
  // exist — a pointer whose cache file was deleted otherwise leaves the player on a dead file
  // (black picture) forever, because 'ready' state never re-queues. Main prunes dead pointers
  // (pruneDeadCopies) and regenerates; healthy pointers make the round-trip a no-op.
  const mediaKey = project.media.map((m) => `${m.path}|${m.thumbCount ? 1 : 0}|${m.poster ? 1 : 0}|${m.wave ? 1 : 0}|${m.optimizing ? 1 : 0}|${m.proxy ? 1 : 0}|${m.proxyFailed ? 1 : 0}|${m.lightProxy == null ? 0 : 1}|${m.proxies?.[quality] == null ? 0 : 1}`).join(';') + `|${quality}`;
  useEffect(() => {
    const carriesCopies = (m) => typeof m.proxy === 'string' || typeof m.lightProxy === 'string'
      || !!(m.proxies && Object.values(m.proxies).some((v) => typeof v === 'string'));
    // QA2 (2026-11-05): a video whose preview copy failed (proxyFailed) is re-queued so
    // the main process gives it its one automatic retry; a video that needs a preview
    // copy but has none (older projects whose items were never queued for one) is
    // queued too — the main process confirms with a real probe before making anything.
    const missing = project.media.filter((m) => (m.type === 'video' && (!m.thumbCount || !m.poster || m.optimizing || m.proxyFailed || (needsPreviewCopy(m) && !m.proxy) || levelCopyState(m, quality) === 'fallback' || levelCopyState(m, quality) === 'failed' || carriesCopies(m))) || (m.hasAudio && !m.wave));
    if (missing.length) {
      window.api.ensureVisuals(missing.map(({ path, type, duration, hasAudio, width, height, proxy, lightProxy, proxies, remux, container, vcodec, pixFmt, hdr }) => ({ path, type, duration, hasAudio, width, height, proxy, lightProxy, proxies, remux, container, vcodec, pixFmt, hdr })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  useEffect(() => {
    window.api.captionsStatus().then((st) => setCaptions((c) => ({ ...c, installed: st.installed, models: st.models || {}, available: st.available })));
  }, []);

  // Checklist #1: re-verify media against the disk when the window regains
  // focus (e.g. after deleting a file in the file manager) — the lost flags
  // refresh silently; red cards/clips show what is gone.
  useEffect(() => {
    const onFocus = () => { refreshMissingMedia(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshMissingMedia]);

  const runCaptions = async (opts) => {
    setPlaying(false);
    setCaptions((c) => ({ ...c, busy: true, error: null, stage: 'Preparing', progress: 0 }));
    const off = window.api.onCaptionsProgress(({ stage, progress }) => setCaptions((c) => ({ ...c, stage, progress })));
    const { style, engine, wordsPerLine, ...engineOpts } = opts;
    // Cloud engines return the same segment shape, so everything after this call —
    // caption clips, styling, apply-to-all — is the one shared path.
    const res = engine === 'cloud'
      ? await window.api.runCaptionsCloud(project, engineOpts)
      : await window.api.runCaptions(project, engineOpts);
    off();
    if (res.ok) {
      // Words-per-line (when set) regroups the segments here, once, for every engine.
      dispatch({ type: 'setCaptions', style, segments: regroupSegments(res.segments, wordsPerLine).map((s) => ({ ...s, id: uid() })) });
      if (engine === 'cloud') {
        setCaptions((c) => ({ ...c, busy: false }));
      } else {
        setCaptions((c) => ({ installed: true, available: c.available, models: { ...c.models, [engineOpts.model || 'base']: true }, busy: false }));
      }
      setTab('captions');
    } else {
      setCaptions((c) => ({ ...c, busy: false, error: res.error }));
    }
  };

  // Media item watched in the player before it is on the timeline (click a card in the Media panel). Seeking or
  // playing the project goes back to it.
  const [peekId, setPeekId] = useState(null);
  const peek = useCallback((id) => { setPlaying(false); setPeekId(id); }, []);
  // Library (pack / Generated) item watched in the player before adding it — the same
  // MediaPeek surface, fed a media-shaped object that carries its own add target
  // (assetPath + assetWhere) instead of a media id (QA K2, Hamza 2026-11-01).
  const [assetPeek, setAssetPeek] = useState(null);
  const peekAsset = useCallback((item) => { setPlaying(false); setPeekId(null); setAssetPeek(item); }, []);

  const [seekVer, setSeekVer] = useState(0);
  const seek = useCallback((t) => {
    setPeekId(null);
    setTime(Math.max(0, t));
    setSeekVer((v) => v + 1);
  }, []);

  const togglePlay = useCallback(async () => {
    setPeekId(null);
    if (playing) return setPlaying(false);
    if (time >= duration - 0.05) setTime(0);
    if (duration <= 0) return;
    // Checklist #1: refresh the lost flags before playback starts, so a file
    // deleted mid-session turns its clips red and stays silent instead of
    // playing its cached proxy.
    await refreshMissingMedia();
    setPlaying(true);
  }, [playing, time, duration, refreshMissingMedia]);

  const addItems = (items) => {
    const ok = items.filter((i) => !i.error).map((i) => ({ ...i, id: uid() }));
    const bad = items.filter((i) => i.error);
    if (bad.length) alert(t('app.couldNotImport') + bad.map((b) => `${b.name}: ${b.error}`).join('\n'));
    if (ok.length) dispatch({ type: 'addMedia', items: ok });
    return ok;
  };

  const importMedia = async () => addItems(await window.api.importMedia());

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    if (isInternal(e)) return;
    const files = [...e.dataTransfer.files];
    if (files.length) addItems(await window.api.probeFiles(files));
  };

  // Drop from an asset panel onto the timeline (info: { lane, time, index, clipId } from Timeline).
  const applyToClip = (clipId, payload) => {
    const vClip = project.videoClips.find((c) => c.id === clipId);
    const clip = vClip || (project.overlayClips || []).find((c) => c.id === clipId);
    if (!clip) return;
    const track = vClip ? 'video' : 'overlay';
    let patch;
    if (payload.kind === 'filter') patch = { filter: payload.id };
    else if (payload.kind === 'effect') patch = { effects: clip.effects?.includes(payload.id) ? clip.effects : [...(clip.effects || []), payload.id] };
    else if (payload.kind === 'transition') {
      if (!vClip || project.videoClips[0].id === clipId) return; // transitions live between main-track clips only
      patch = { transition: { type: payload.id, duration: payload.duration || 0.5 } };
    }
    dispatch({ type: 'update', track, id: clipId, patch });
    setSelection({ track, id: clipId });
  };

  const dropItem = (payload, info) => {
    if (!payload) return;
    const clipId = uid();
    const layer = (lane) => (info.layerLane === lane ? info.layer : undefined); // the layer it was dropped on
    if (info.insert) {
      // Insert mode (Sprint 10): the drop ripples — the store's insertClip
      // splits whatever straddles the drop point and pushes the rest of the
      // track right, instead of the normal append/overlap placement.
      if (payload.kind === 'media') {
        const m = project.media.find((x) => x.id === payload.id);
        if (!m) return;
        if (info.lane === 'overlay' && m.type !== 'audio') {
          const clip = { ...newVideoClip(clipId, m), transform: { scale: 0.5, x: 0, y: 0 }, ...(layer('overlay') != null ? { layer: layer('overlay') } : {}) };
          dispatch({ type: 'insertClip', track: 'overlay', at: info.time, clip, splitId: uid() });
          return setSelection({ track: 'overlay', id: clipId });
        }
        guardAdd(m, () => {
          if (m.type === 'audio') {
            const clip = { id: clipId, mediaId: m.id, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0, ...(layer('audio') != null ? { layer: layer('audio') } : {}) };
            dispatch({ type: 'insertClip', track: 'audio', at: info.time, clip, splitId: uid() });
            return setSelection({ track: 'audio', id: clipId });
          }
          dispatch({ type: 'insertClip', track: 'video', at: info.time, clip: newVideoClip(clipId, m), splitId: uid() });
          setSelection({ track: 'video', id: clipId });
        });
        return;
      }
      if (payload.kind === 'text') {
        const clip = { id: clipId, text: t('app.yourText'), duration: 3, y: 0.5, ...payload.patch, ...(layer('text') != null ? { layer: layer('text') } : {}) };
        dispatch({ type: 'insertClip', track: 'text', at: info.time, clip, splitId: uid() });
        return setSelection({ track: 'text', id: clipId });
      }
      if (payload.kind === 'effect' && info.lane === 'effect') {
        dispatch({ type: 'insertClip', track: 'effect', at: info.time, clip: { id: clipId, fx: payload.id, duration: 3 }, splitId: uid() });
        return setSelection({ track: 'effect', id: clipId });
      }
      if (info.clipId) applyToClip(info.clipId, payload);
      return;
    }
    if (payload.kind === 'media') {
      const m = project.media.find((x) => x.id === payload.id);
      if (!m) return;
      if (info.lane === 'overlay' && m.type !== 'audio') {
        dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: info.time, layer: layer('overlay') });
        return setSelection({ track: 'overlay', id: clipId });
      }
      guardAdd(m, () => {
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: info.time, index: info.index, layer: layer('audio') });
        setSelection({ track: m.type === 'audio' ? 'audio' : 'video', id: clipId });
      });
    } else if (payload.kind === 'text') {
      dispatch({ type: 'addText', clipId, at: info.time, patch: payload.patch, layer: layer('text') });
      setSelection({ track: 'text', id: clipId });
    } else if (payload.kind === 'effect' && info.lane === 'effect') {
      dispatch({ type: 'addEffectClip', clipId, fx: payload.id, at: info.time });
      setSelection({ track: 'effect', id: clipId });
    } else if (info.clipId) {
      applyToClip(info.clipId, payload);
    }
  };

  const dropFiles = async (files, info) => {
    const items = addItems(await window.api.probeFiles(files));
    // One sequence question per drop, for the first picture/video in it (overlay drops are exempt).
    const firstPic = info.lane === 'overlay' ? null : items.find((m) => m.type === 'video' || m.type === 'image');
    guardAdd(firstPic, () => {
      let index = info.index;
      let at = info.time;
      items.forEach((m) => {
        const clipId = uid();
        if (info.insert) {
          // Insert mode: each file ripples in at the running point, so a
          // multi-file drop lands as one inserted block, in order.
          const len = m.type === 'image' ? IMAGE_DEFAULT : m.duration;
          if (info.lane === 'overlay' && m.type !== 'audio') {
            const clip = { ...newVideoClip(clipId, m), transform: { scale: 0.5, x: 0, y: 0 }, ...(info.layerLane === 'overlay' && info.layer != null ? { layer: info.layer } : {}) };
            dispatch({ type: 'insertClip', track: 'overlay', at, clip, splitId: uid() });
          } else if (m.type === 'audio') {
            const clip = { id: clipId, mediaId: m.id, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0, ...(info.layerLane === 'audio' && info.layer != null ? { layer: info.layer } : {}) };
            dispatch({ type: 'insertClip', track: 'audio', at, clip, splitId: uid() });
          } else {
            dispatch({ type: 'insertClip', track: 'video', at, clip: newVideoClip(clipId, m), splitId: uid() });
          }
          at += len;
          return;
        }
        if (info.lane === 'overlay' && m.type !== 'audio') {
          dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at, layer: info.layerLane === 'overlay' ? info.layer : undefined });
          at += m.type === 'image' ? 3 : m.duration;
        } else if (m.type === 'audio') dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: info.time, layer: info.layerLane === 'audio' ? info.layer : undefined });
        else dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index: index++ });
      });
    });
  };

  // Drop onto the player: media goes to the end of the main track, looks apply to the clip on screen.
  const dropOnPreview = (payload) => {
    if (!payload) return;
    if (payload.kind === 'media') return dropItem(payload, { time, index: undefined });
    if (payload.kind === 'text') return dropItem(payload, { time });
    const v = videoClipAt(project, time);
    if (v) applyToClip(v.clip.id, payload);
  };

  // A sound from the audio library: one media item per file (reused), clip on the Audio track at the playhead.
  const libraryAdd = async (item) => {
    const res = await window.api.libraryAdd(item);
    if (res.error) return res;
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: t('app.couldNotAddSound') };
    const clipId = uid();
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: time });
    setSelection({ track: 'audio', id: clipId });
    return { ok: true };
  };

  // Text to speech: the voice goes on the Audio track where the selected text starts, or at the playhead.
  const selectedText = selection?.track === 'text' ? project.textClips.find((c) => c.id === selection.id) : null;
  const ttsAdd = (res, atText) => {
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([{ ...res, origin: 'tts' }]); // Media tree: Generated ▸ Speech
    if (!m) return;
    const clipId = uid();
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: atText ? selectedText.start : time });
    setSelection({ track: 'audio', id: clipId });
  };

  // Stock media (Pixabay): download once, then main track or overlay at the playhead.
  const [stockKey, setStockKey] = useState(false);
  useEffect(() => {
    window.api.settingsGet().then((st) => setStockKey(!!st.serviceKeys?.pixabay));
    window.api.proxyStatus?.().then((st) => { setPlaybackQuality(st.quality); setQuality(st.quality); }).catch(() => {});
    window.api.perfGetMode?.().then((m) => setPerfMode(m)).catch(() => {});
  }, [settingsVersion]);

  // Customisable shortcuts + keystroke display (Sprint 11): the effective
  // keymap is resolved from the persisted overrides each time settings
  // change (mount, and whenever the Settings dialog closes). The map lives
  // in keymap.js's shared slot so Preview's F key and every hint renderer
  // read the same truth; keymapTick just forces the hint surfaces to
  // re-render after a reload.
  const [, setKeymapTick] = useState(0);
  const [keystrokesOn, setKeystrokesOn] = useState(false);
  useEffect(() => {
    window.api.settingsGet().then((st) => {
      applyKeymapOverrides(st.keymap);
      setKeystrokesOn(!!st.keystrokes);
      setKeymapTick((v) => v + 1);
    }).catch(() => {});
  }, [settingsVersion]);
  const stockAdd = async (item, where) => {
    const res = await window.api.stockAdd(item);
    if (res.error) return res;
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: t('app.couldNotAddFile') };
    const clipId = uid();
    if (where === 'overlay') {
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: time });
      setSelection({ track: 'overlay', id: clipId });
    } else {
      guardAdd(m, () => {
        const index = videoLayout(projectRef.current.videoClips).filter((l) => (l.start + l.end) / 2 < time).length;
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
        setSelection({ track: 'video', id: clipId });
      });
    }
    return { ok: true };
  };

  // A favorite from disk: reuse the media item when the project has it, then add it at the playhead.
  const addFile = async (filePath, where = 'main') => {
    let m = projectRef.current.media.find((x) => x.path === filePath);
    if (!m) {
      const [res] = await window.api.probePaths([filePath]);
      if (!res || res.error) return { error: res ? `${res.name}: ${res.error}` : t('app.fileNotFound') };
      [m] = addItems([res]);
    }
    const clipId = uid();
    if (m.type === 'audio') {
      dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: time });
      setSelection({ track: 'audio', id: clipId });
    } else if (where === 'overlay') {
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: time });
      setSelection({ track: 'overlay', id: clipId });
    } else {
      guardAdd(m, () => {
        const index = videoLayout(projectRef.current.videoClips).filter((l) => (l.start + l.end) / 2 < time).length;
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
        setSelection({ track: 'video', id: clipId });
      });
    }
    return { ok: true };
  };

  // Picture-in-picture at the playhead (Media panel button).
  const addAsOverlay = (mediaId) => {
    const clipId = uid();
    dispatch({ type: 'addOverlayClip', mediaId, clipId, at: time });
    setSelection({ track: 'overlay', id: clipId });
  };

  // Sequence check: placing a video/photo on the main track whose resolution, aspect ratio or
  // frame rate differs from the project sequence asks first (SequenceDialog); project settings
  // are never changed silently on these paths. The first clip of a project whose format was not
  // locked still sets the canvas through canvasFor, as before.
  const guardAdd = (media, proceed) => {
    const p = projectRef.current;
    if (media && (media.type === 'video' || media.type === 'image')) {
      const firstClip = !(p.videoClips || []).some((c) => !c.gap);
      if (!(firstClip && !p.ratioLocked)) {
        const mm = mismatchFor(p, media);
        if (mm) { setSeqAsk({ media, mismatch: mm, proceed }); return; }
      }
    }
    proceed();
  };
  const resolveSeq = (change) => {
    const ask = seqAsk;
    setSeqAsk(null);
    if (!ask) return;
    if (change) {
      const patch = sequencePatchFor(ask.media);
      if (patch) dispatch({ type: 'setProject', patch });
    }
    ask.proceed();
  };

  // Checklist #3, after the fact: a 9:16 clip kept in a 16:9 project shows
  // black bars, and the add-time dialog is long gone. Re-open it for the
  // main clip at the playhead (proceed is a no-op — the clip is already
  // placed), so the project can still be matched to the clip in one click.
  const matchSequenceToClip = () => {
    const p = projectRef.current;
    const at = videoLayout(p.videoClips).find((l) => !l.clip.gap && !l.clip.disabled && time >= l.start && time < l.end);
    if (!at) return;
    const m = p.media.find((x) => x.id === at.clip.mediaId);
    if (!m) return;
    const mm = mismatchFor(p, m);
    if (!mm) return;
    setSeqAsk({ media: m, mismatch: mm, proceed: () => {} });
  };

  const addToTimeline = (mediaId) => {
    const m = project.media.find((x) => x.id === mediaId);
    guardAdd(m, () => {
      const clipId = uid();
      dispatch({ type: 'addToTimeline', mediaId, clipId, at: time });
      setSelection({ track: m && m.type === 'audio' ? 'audio' : 'video', id: clipId });
    });
  };

  // Voice-over: the clip goes where the recording started.
  const recorder = useRecorder((item, at) => {
    const m = { ...item, id: uid() };
    const clipId = uid();
    dispatch({ type: 'addMedia', items: [m] });
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at });
    setSelection({ track: 'audio', id: clipId });
  });
  // Remove a media item from the project; when clips use it, ask first (they go too). Ctrl+Z brings it back.
  const removeMedia = (id) => {
    const p = projectRef.current;
    const m = p.media.find((x) => x.id === id);
    if (!m) return;
    const lockedUse = lockedMediaUse(p, id);
    if (lockedUse) { alert(t('app.lockedMedia', { name: m.name, layer: layerDispName(p, lockedUse.track, lockedUse.layer) })); return; }
    const used = [p.videoClips, p.overlayClips || [], p.audioClips].reduce((n, list) => n + list.filter((c) => c.mediaId === id).length, 0);
    if (used && !window.confirm(`"${m.name}" is used by ${used} clip${used > 1 ? 's' : ''} on the timeline.\nRemove it and ${used > 1 ? 'those clips' : 'that clip'}? (${bindingHint(getCurrentKeymap(), 'undo') || 'Undo'} undoes it)`)) return;
    dispatch({ type: 'removeMedia', id });
  };
  // Rename a media item (checklist #9): display name only, the file path
  // never changes, so clips and relink state are untouched. Undoable.
  const renameMedia = (id, name) => {
    const p = projectRef.current;
    const m = p.media.find((x) => x.id === id);
    const clean = (name || '').trim();
    if (!m || !clean || clean === m.name) return;
    dispatch({ type: 'renameMedia', id, name: clean });
  };
  // Duplicate a media item in the pool (checklist #9): a second entry pointing
  // at the same file; no clips are copied. Returns the new id.
  const duplicateMedia = (id) => {
    const p = projectRef.current;
    const m = p.media.find((x) => x.id === id);
    if (!m) return null;
    const copy = { ...m, id: uid() };
    dispatch({ type: 'addMedia', items: [copy] });
    return copy.id;
  };
  // Remove several media items at once (checklist #14, multi-select): one
  // confirmation totalling the timeline clips, one undo step.
  const removeMediaMany = (ids) => {
    const p = projectRef.current;
    const items = (ids || []).map((id) => p.media.find((x) => x.id === id)).filter(Boolean);
    if (!items.length) return;
    for (const m of items) {
      const lockedUse = lockedMediaUse(p, m.id);
      if (lockedUse) { alert(t('app.lockedMedia', { name: m.name, layer: layerDispName(p, lockedUse.track, lockedUse.layer) })); return; }
    }
    const used = items.reduce((n, m) => n + [p.videoClips, p.overlayClips || [], p.audioClips].reduce((k, list) => k + list.filter((c) => c.mediaId === m.id).length, 0), 0);
    if (used && !window.confirm(`Remove ${items.length} item${items.length > 1 ? 's' : ''} used by ${used} clip${used > 1 ? 's' : ''} on the timeline?\nThose clips go too. (${bindingHint(getCurrentKeymap(), 'undo') || 'Undo'} undoes it)`)) return;
    dispatch({ type: 'beginGesture' });
    for (const m of items) dispatch({ type: 'removeMedia', id: m.id });
    dispatch({ type: 'endGesture' });
  };

  const toggleRecording = () => (recorder.recording ? recorder.stop() : recorder.start(time));

  // Screen recording: the video goes on the main track at the playhead. The camera, recorded as its own clip,
  // goes on the overlay track at the same time, cut round or square and placed where its bubble was on the screen
  // (bottom-right corner when that is unknown, e.g. a window recording).
  const [screenOpen, setScreenOpen] = useState(false);
  const screenRec = useScreenRecorder(({ screen, camera, camShape, camStyle, camGeom }, at) => {
    const [m, cam] = addItems(camera ? [screen, camera] : [screen]);
    if (!m) return;
    // The frame as it will be once the screen clip is in (it can set the canvas shape), not as it was.
    const frame = { ...projectRef.current, ...canvasFor(projectRef.current, m) };
    const clipId = uid();
    const layout = videoLayout(projectRef.current.videoClips);
    const index = layout.filter((l) => (l.start + l.end) / 2 < at).length;
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
    if (cam) {
      const camId = uid();
      // Where the screen clip starts: the clip it was put before, or the end of the track.
      const start = index < layout.length ? layout[index].start : layout.length ? layout[layout.length - 1].end : 0;
      dispatch({ type: 'addOverlayClip', mediaId: cam.id, clipId: camId, at: start });
      // Mask: the centered circle / rounded square the bubble showed (the camera picture fitted in the frame,
      // cropped to its height like the bubble's "cover"), in fractions of the frame.
      const { width: W, height: H } = frame;
      const fit = (w, h) => Math.min(W / (w || W), H / (h || H));
      const k = fit(cam.width, cam.height);
      // Size the camera takes in the video (pixels): where its bubble was, or a third of the frame.
      let target = 0.35 * Math.min(W, H);
      let place = { x: 0.3, y: 0.24 };
      if (camGeom) {
        // The screen video fitted in the frame; the bubble's center and size on it.
        const ks = fit(m.width, m.height);
        const sw = (m.width || W) * ks;
        const sh = (m.height || H) * ks;
        const X = (W - sw) / 2 + camGeom.cx * sw;
        const Y = (H - sh) / 2 + camGeom.cy * sh;
        target = camGeom.d * sw;
        place = { x: (X - W / 2) / W, y: (Y - H / 2) / H };
      }
      // The shape fills the camera picture's height, minus room for the outline and the glow, which are drawn
      // around it inside the frame (their size is for the final picture, so it grows as the clip is scaled down).
      const room = ((camStyle?.stroke > 0 ? camStyle.stroke / 2 : 0) + (camStyle?.glow > 0 ? camStyle.glow * 2 : 0)) * (Math.min(W, H) / 720);
      const full = Math.min((cam.width || W) * k, (cam.height || H) * k);
      const d = Math.min(full, Math.min(W, H) / (1 + (2 * room) / Math.max(1, target)));
      const shape = camShape === 'square' ? { type: 'rectangle', w: d / W, h: d / H, round: 0.28 } : { type: 'circle', w: d / W, h: d / H };
      // The outline and glow chosen in the Record window (Mask > Outline and glow changes them later).
      const mask = { ...shape, ...(camStyle?.stroke > 0 && { stroke: camStyle.stroke, strokeColor: camStyle.strokeColor }),
        ...(camStyle?.glow > 0 && { glow: camStyle.glow, glowColor: camStyle.glowColor }) };
      const transform = { scale: target / d, ...place };
      dispatch({ type: 'update', track: 'overlay', id: camId, patch: { start, mask, transform } });
    }
    setSelection({ track: 'video', id: clipId });
    setScreenOpen(false);
  });

  // Brand kit (R1): a UI-created text clip starts from the kit's font and text
  // colour when the user has set them; the caller's own patch is spread last,
  // so a template's style always wins. No kit configured → empty patch → the
  // clip is exactly what it was before the kit existed.
  const addText = (patch = {}) => {
    const clipId = uid();
    dispatch({ type: 'addText', clipId, at: time, patch: { ...brandTextPatch(loadBrand()), ...patch } });
    setSelection({ track: 'text', id: clipId });
  };

  // "Add text" from an effect's panel: a text clip spanning exactly the clip / effect range
  // it was invoked from, selected so its inspector opens ready to type. Same addText action
  // and selection flow as the Text tab — no parallel text path.
  const addTextOver = (start, duration) => {
    const clipId = uid();
    dispatch({ type: 'addText', clipId, at: start, patch: { ...brandTextPatch(loadBrand()), duration } });
    setSelection({ track: 'text', id: clipId });
  };

  // Contextual timeline tools (reference pattern): Detach audio and Link / Unlink appear
  // in the toolbar when the selection can use them, calling the same handlers as the menu.
  const selSingle = selection && !selection.items ? findClipIn(project, selection.track, selection.id) : null;
  const selMedia = selSingle?.mediaId && project.media.find((x) => x.id === selSingle.mediaId);
  const detachOk = !!(selSingle && (selection.track === 'video' || selection.track === 'overlay')
    && selMedia?.type === 'video' && selMedia.hasAudio && !selSingle.muted && !selSingle.linkId);
  const linkMode = selSingle?.linkId ? 'unlink'
    : (selection?.items?.length === 2 && selection.items.some((i) => i.track === 'audio')
      && selection.items.some((i) => i.track === 'video' || i.track === 'overlay')) ? 'link' : null;

  // Picture clip targeted by the Effects / Filters / Transitions / Adjust tabs: selection first, else under the playhead.
  // An overlay selection targets the overlay itself (tagged track: 'overlay'); the main-track
  // fallbacks stay video-only, and Transitions simply finds no index on an overlay target.
  const layout = videoLayout(project.videoClips);
  const overlaySel = selection?.track === 'overlay' ? (project.overlayClips || []).find((c) => c.id === selection.id) : null;
  const target = (overlaySel && { track: 'overlay', clip: overlaySel, start: overlaySel.start, end: overlaySel.start + freeLen('overlay', overlaySel) })
    || (selection?.track === 'video' && layout.find((l) => l.clip.id === selection.id && !l.clip.gap))
    || (selection?.items && layout.find((l) => !l.clip.gap && selection.items.some((it) => it.track === 'video' && it.id === l.clip.id)))
    || videoClipAt(project, time);
  // With several clips selected, a filter or color change goes to all of them (one undo step).
  const updateTarget = (patch) => {
    if (!target) return;
    const many = selectedPictures(project, selection);
    if (many.length > 1 && isLookPatch(patch)) dispatch(lookAction(many, target.clip, patch));
    else dispatch({ type: 'update', track: target.track || 'video', id: target.clip.id, patch });
  };

  const split = useCallback(() => {
    let tgt = selection;
    if (!tgt) {
      const v = videoClipAt(project, time);
      if (v) tgt = { track: 'video', id: v.clip.id };
    }
    if (tgt) dispatch({ type: 'split', track: tgt.track, id: tgt.id, t: time, newId: uid() });
  }, [selection, project, time]);

  // Delete everything left (or right) of the playhead in the selected clip when the playhead is inside it,
  // otherwise in the main-track clip under the playhead.
  const trimSide = useCallback((side) => {
    const targets = [];
    if (selection) targets.push(selection);
    const v = videoClipAt(project, time);
    if (v && !(selection && selection.id === v.clip.id)) targets.push({ track: 'video', id: v.clip.id });
    for (const tgt of targets) {
      const newId = uid();
      const actions = trimActions(project, { track: tgt.track, id: tgt.id, t: time, side, newId });
      if (!actions.length) continue;
      // Split + delete land as ONE undo step.
      dispatch({ type: 'beginGesture' });
      actions.forEach((a) => dispatch(a));
      dispatch({ type: 'endGesture' });
      setSelection(side === 'right' ? { track: tgt.track, id: tgt.id } : { track: tgt.track, id: newId });
      return;
    }
  }, [selection, project, time]);

  // Add a marker at the playhead, or remove the one that is already there.
  const toggleMarker = useCallback(() => {
    const near = markerNear(project.markers, time);
    if (near) dispatch({ type: 'removeMarker', id: near.id });
    else dispatch({ type: 'addMarker', id: uid(), time });
  }, [project.markers, time]);

  const remove = useCallback(() => {
    if (!selection) return;
    const removeOne = (sel) => {
      if (sel.track === 'transition') dispatch({ type: 'update', track: 'video', id: sel.id, patch: { transition: null } });
      else if (sel.track === 'effect' && sel.id.includes('|')) dispatch({ type: 'removeEffect', id: sel.id });
      else dispatch({ type: 'delete', track: sel.track, id: sel.id });
    };
    if (selection.items) {
      // Several clips: one undo step for all of them.
      dispatch({ type: 'beginGesture' });
      selection.items.forEach(removeOne);
      dispatch({ type: 'endGesture' });
    } else removeOne(selection);
    setSelection(null);
  }, [selection]);

  // What the player shows and exports: deactivated clips left out.
  const playProject = useMemo(() => renderable(project), [project]);

  // ---- Copy / cut / paste and the right-click clip menu ----
  const findClip = (p, sel) => {
    if (!sel) return null;
    const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', sticker: 'stickerClips' }[sel.track];
    return key ? p[key].find((c) => c.id === sel.id) : null;
  };
  const copy = useCallback(() => {
    const c = findClip(project, selection);
    if (c && !c.gap) setClipboard({ track: selection.track, clip: c });
    return !!(c && !c.gap);
  }, [project, selection]);
  const cut = useCallback(() => {
    if (copy()) {
      dispatch({ type: 'delete', ...selection });
      setSelection(null);
    }
  }, [copy, selection]);
  const paste = useCallback(() => {
    if (!clipboard) return;
    const newId = uid();
    dispatch({ type: 'paste', track: clipboard.track, clip: clipboard.clip, at: time, newId });
    setSelection({ track: clipboard.track, id: newId });
  }, [clipboard, time]);
  // Detach audio: render the clip's sound to its own file (electron/detach.cjs, cached),
  // put it on the Audio track at the clip's position and LINK the pair — the store keeps
  // linked clips in sync (select / move / trim / split / speed together). One undo step.
  const detachAudio = useCallback(async (sel = selection) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m || m.type !== 'video' || !m.hasAudio || c.muted || c.linkId) return;
    setRenderJob({ kind: 'detach', label: t('app.jobDetach'), fraction: 0 });
    const off = window.api.onDetachProgress((pr) => {
      if (pr.path === m.path) setRenderJob((j) => (j && !j.error ? { ...j, fraction: pr.fraction } : j));
    });
    let res;
    try {
      res = await window.api.detachRun({ path: m.path, duration: m.duration, hasAudio: m.hasAudio, type: m.type }, c.in || 0, c.out ?? m.duration);
    } catch (e) { res = { error: e.message }; }
    off();
    if (res.canceled) { setRenderJob(null); return; }
    if (res.error) { setRenderJob({ error: res.error }); return; }
    setRenderJob(null);
    const start = sel.track === 'video'
      ? (videoLayout(projectRef.current.videoClips).find((l) => l.clip.id === c.id)?.start ?? 0)
      : c.start;
    const linkId = uid();
    const audioId = uid();
    let media = projectRef.current.media.find((x) => x.path === res.path);
    dispatch({ type: 'beginGesture' });
    if (!media) { media = { ...res, id: uid(), origin: 'detach' }; dispatch({ type: 'addMedia', items: [media] }); } // Media tree: Generated ▸ Processed
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { muted: true, linkId } });
    dispatch({ type: 'insertAudioClip', clip: {
      id: audioId, mediaId: media.id, start, in: 0, out: Math.min(c.out - c.in, res.duration || (c.out - c.in)),
      speed: c.speed || 1, speedCurve: c.speedCurve, volume: c.volume ?? 1,
      // The detached sound carries the picture clip's fades and volume
      // keyframes, so detaching never changes how it plays. The keys are
      // rebased: they are absolute source times on the original media, and
      // the extracted file starts at the clip's in-point.
      fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0,
      ...(c.volKeys ? {
        volKeys: c.volKeys
          .filter((k) => k.t >= (c.in || 0) - 1e-6 && k.t <= (c.out ?? 0) + 1e-6)
          .map((k) => ({ ...k, t: Math.max(0, k.t - (c.in || 0)) })),
      } : {}),
      linkId, linkOff: 0, linkInOff: -(c.in || 0),
    } });
    dispatch({ type: 'endGesture' });
    select({ track: 'audio', id: audioId });
  }, [selection, select]);

  // Voice Enhancer: render the clip's range cleaned (electron/enhance.cjs, cached) and point
  // the clip at the result (clip.enhance = { on, strength, path, from, to }). Preview and export
  // both substitute that file for the clip's sound. Re-running with another strength re-renders.
  const enhanceClip = useCallback(async (sel, strength) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m || !m.hasAudio || m.type === 'image') return;
    setRenderJob({ kind: 'enhance', label: t('app.jobEnhance'), fraction: 0 });
    const off = window.api.onEnhanceProgress((pr) => {
      if (pr.path === m.path) setRenderJob((j) => (j && !j.error ? { ...j, fraction: pr.fraction } : j));
    });
    let res;
    try {
      res = await window.api.enhanceRun({ path: m.path, duration: m.duration, hasAudio: m.hasAudio, type: m.type }, c.in || 0, c.out ?? m.duration, strength);
    } catch (e) { res = { error: e.message }; }
    off();
    if (res.canceled) { setRenderJob(null); return; }
    if (res.error) { setRenderJob({ error: res.error }); return; }
    setRenderJob(null);
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { enhance: { on: true, strength, path: res.path, from: c.in || 0, to: c.out ?? m.duration } } });
  }, []);

  // AudioFx preview parity upkeep: a clip whose effected sound has no current derivative
  // (clip.audioFxRender — electron/audiofxrender.cjs) gets one rendered in the background,
  // debounced so slider drags coalesce into a single render per clip. Preview and export
  // both substitute that file for the clip's sound, so the panel is heard exactly as it
  // exports. Renders are silent upkeep (no job pill): the AudioFx panel reports whether
  // its preview is the effected render or still the original sound.
  const afxBusyRef = useRef(new Set()); // clip ids with a render in flight
  const afxFailedRef = useRef(new Map()); // clip id -> chain string that failed (retried when the chain changes)
  const [afxTick, setAfxTick] = useState(0); // bumped to rescan when the main process was busy
  useEffect(() => {
    const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
    const stale = [];
    for (const [track, clips] of [['video', project.videoClips], ['overlay', project.overlayClips || []], ['audio', project.audioClips]]) {
      for (const c of clips) {
        const m = mediaById[c.mediaId];
        if (!m || !m.hasAudio || m.type === 'image' || c.gap) continue;
        if (track === 'overlay' && m.type !== 'video') continue; // overlay sound exists only for video media
        if (!hasAudioFx(c.audioFx) || audioFxPathOf(c, m)) continue;
        if (afxBusyRef.current.has(c.id)) continue;
        const chain = audioFxFilters(c.audioFx).join(',');
        if (afxFailedRef.current.get(c.id) === chain) continue;
        stale.push({ track, id: c.id, chain });
      }
    }
    if (!stale.length) return undefined;
    const timer = setTimeout(async () => {
      for (const job of stale) {
        // Re-read the clip: its settings may have moved on while the debounce ran.
        const p = projectRef.current;
        const c = findClipIn(p, job.track, job.id);
        const m = c && p.media.find((x) => x.id === c.mediaId);
        if (!c || !m || !hasAudioFx(c.audioFx) || audioFxPathOf(c, m)) continue;
        if (audioFxFilters(c.audioFx).join(',') !== job.chain) { setAfxTick((n) => n + 1); continue; }
        const src = audioFxSourceFor(c, m);
        if (!src) continue;
        afxBusyRef.current.add(c.id);
        let res;
        try {
          res = await window.api.audioFxRender({ ...src, fx: c.audioFx });
        } catch (e) { res = { error: e && e.message }; }
        afxBusyRef.current.delete(c.id);
        if (res && res.path) {
          afxFailedRef.current.delete(c.id);
          dispatch({ type: 'clipDerivative', track: job.track, id: c.id, field: 'audioFxRender',
            value: { path: res.path, from: c.in || 0, to: c.out ?? m.duration, chain: res.chain, src: src.srcPath } });
        } else if (res && res.busy) {
          setAfxTick((n) => n + 1); // another clip's render holds the main process: rescan shortly
        } else if (!res || !res.canceled) {
          afxFailedRef.current.set(c.id, job.chain);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, afxTick]);

  // Unlink a linked pair: both clips become independent (one undo step).
  const unlinkClip = useCallback((sel = selection) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    if (!c || !c.linkId) return;
    const partner = findLinkPartner(p, c);
    dispatch({ type: 'beginGesture' });
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } });
    if (partner) dispatch({ type: 'update', track: partner.track, id: partner.clip.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } });
    dispatch({ type: 'endGesture' });
  }, [selection]);

  // Link the two selected clips (one picture + one audio) into a synced pair. The audio
  // clip's offsets are taken from the current positions, and its speed / window end are
  // matched to the picture clip so the sync invariants hold from the start.
  const linkPair = useCallback(() => {
    const p = projectRef.current;
    const items = selection?.items || [];
    const pic = items.find((it) => it.track === 'video' || it.track === 'overlay');
    const aud = items.find((it) => it.track === 'audio');
    if (items.length !== 2 || !pic || !aud) return;
    const pc = findClip(p, pic);
    const ac = findClip(p, aud);
    if (!pc || !ac || pc.linkId || ac.linkId) return;
    const vStart = pic.track === 'video'
      ? (videoLayout(p.videoClips).find((l) => l.clip.id === pc.id)?.start ?? 0)
      : pc.start;
    const linkId = uid();
    dispatch({ type: 'beginGesture' });
    dispatch({ type: 'update', track: pic.track, id: pic.id, patch: { linkId } });
    dispatch({ type: 'update', track: 'audio', id: ac.id, patch: {
      linkId, linkOff: ac.start - vStart, linkInOff: ac.in - pc.in,
      speed: pc.speed || 1, out: ac.in + (pc.out - pc.in),
      // A ramped picture hands the audio its own window's slice of the curve.
      ...(pc.speedCurve ? { speedCurve: sliceCurve(pc, ac.in - pc.in, ac.in - pc.in + (pc.out - pc.in)) } : {}),
    } });
    dispatch({ type: 'endGesture' });
  }, [selection]);

  // Select every clip on the layer of the given clip (Select all in the clip menu).
  const selectAllOnLayer = useCallback((sel) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    if (!c) return;
    const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', sticker: 'stickerClips' }[sel.track];
    if (!key) return;
    const layer = clipLayer(sel.track, c);
    const items = p[key].filter((x) => !x.gap && clipLayer(sel.track, x) === layer).map((x) => ({ track: sel.track, id: x.id }));
    if (items.length) select(makeSelection(items));
  }, [select]);

  // Move the selected clip(s) of one layered lane to another layer of that lane (one undo
  // step). Targets that would overlap are disabled in the menu, so this always fits.
  const moveSelectionToLayer = useCallback((sel, layer) => {
    const p = projectRef.current;
    const items = (selection?.items && selection.items.some((it) => it.track === sel.track && it.id === sel.id))
      ? selection.items.filter((it) => it.track === sel.track)
      : [sel];
    dispatch({ type: 'beginGesture' });
    items.forEach((it) => dispatch({ type: 'update', track: it.track, id: it.id, patch: { layer } }));
    dispatch({ type: 'endGesture' });
    return items;
  }, [selection]);

  // Sound of one clip, or of the whole timeline, as an audio file. An export
  // JOB like video (R4): it queues behind a running export, runs in the tray,
  // and its save dialog opens when the job starts (the main-process handler
  // asks) — the stamped project below is the job's snapshot either way.
  const exportAudio = async (format, clipSel) => {
    let p = renderable(project);
    let name = project.name;
    if (clipSel) {
      const c = findClip(project, clipSel);
      const m = c && project.media.find((x) => x.id === c.mediaId);
      if (!c || !m) return;
      // Scoped guard: only this clip's source can block its own audio export.
      if (await guardMissingForExport(project, { kind: 'audio', format, clipSel }, [m])) return;
      name = m.name.replace(/\.[^.]+$/, '');
      const only = { ...p, videoClips: [], overlayClips: [], audioClips: [], textClips: [] };
      p = clipSel.track === 'audio' ? { ...only, audioClips: [{ ...c, start: 0 }] } : { ...only, overlayClips: [{ ...c, start: 0, muted: false }] };
    }
    if (!clipSel && await guardMissingForExport(p, { kind: 'audio', format, clipSel: null })) return;
    setPlaying(false);
    // The audio export consumes the SAME resolved settings as video (its bitrate comes
    // from them, not a hardcoded rate): resolve here and stamp, exactly like startExport.
    let caps = { libx265: true };
    try { caps = await window.api.exportCaps(); } catch { /* the bundled build has libx265 */ }
    const stamped = { ...p, export: resolveExport(p, caps) };
    return enqueueExportJob({
      id: uid(), kind: 'audio', title: name || 'Audio', formatLabel: format.toUpperCase(),
      status: 'queued', progress: 0, phase: 'mix', phases: audioPhases(),
      project: stamped, audioFormat: format, name, cancelled: { current: false }, settle: null,
    });
  };

  // Freeze frame (item 12): hold the frame at the playhead (or the clip's start) as a 4-second
  // still. The original clip splits around the still; on the main track everything after shifts
  // by the still's length, on the overlay track the second part moves 4 s later. One undo step.
  const freezeClip = async (sel) => {
    const p = projectRef.current;
    const key = sel.track === 'video' ? 'videoClips' : 'overlayClips';
    const c = p[key].find((x) => x.id === sel.id);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    let start;
    let len;
    if (sel.track === 'video') {
      const l = videoLayout(p.videoClips).find((x) => x.clip.id === c.id);
      if (!l) return;
      start = l.start; len = l.end - l.start;
    } else { start = c.start || 0; len = freeLen('overlay', c); }
    const t = time > start && time < start + len ? time : start;
    const srcT = (c.in || 0) + sourceOffsetAt(c, t - start);
    let fm;
    try { fm = await window.api.frameImage(m.path, srcT); } catch (e) { fm = { error: e.message }; }
    if (!fm || fm.error) { setRenderJob({ error: (fm && fm.error) || t('app.frameGrabFailed') }); return; }
    let media = projectRef.current.media.find((x) => x.path === fm.path);
    const stillId = uid();
    dispatch({ type: 'beginGesture' });
    if (!media) { media = { ...fm, id: uid() }; dispatch({ type: 'addMedia', items: [media] }); }
    if (sel.track === 'video') {
      const idx = videoLayout(p.videoClips).findIndex((x) => x.clip.id === c.id);
      let insertIndex = idx;
      if (t > start + 0.01) {
        if (t < start + len - 0.01) dispatch({ type: 'split', track: 'video', id: c.id, t, newId: uid() });
        insertIndex = idx + 1;
      }
      dispatch({ type: 'addToTimeline', mediaId: media.id, clipId: stillId, index: insertIndex });
    } else {
      const secondId = uid();
      const interior = t > start + 0.01 && t < start + len - 0.01;
      if (interior) {
        dispatch({ type: 'split', track: 'overlay', id: c.id, t, newId: secondId });
        dispatch({ type: 'update', track: 'overlay', id: secondId, patch: { start: t + 4 } });
      } else {
        dispatch({ type: 'update', track: 'overlay', id: c.id, patch: { start: (c.start || 0) + 4 } });
      }
      dispatch({ type: 'addOverlayClip', mediaId: media.id, clipId: stillId, at: t, layer: c.layer });
      dispatch({ type: 'update', track: 'overlay', id: stillId, patch: { transform: c.transform || undefined } });
    }
    dispatch({ type: 'endGesture' });
    setSelection({ track: sel.track, id: stillId });
  };

  // Reverse (item 12): render the clip's range backwards (electron/reverse.cjs, cached) and swap
  // the clip onto the derivative, remembering the original in clip.reversed — choosing Reverse
  // again restores it. Progress rides the same pill as other derivative renders.
  const reverseClip = async (sel) => {
    const p = projectRef.current;
    const key = sel.track === 'video' ? 'videoClips' : sel.track === 'overlay' ? 'overlayClips' : 'audioClips';
    const c = p[key].find((x) => x.id === sel.id);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    if (c.reversed) {
      dispatch({ type: 'update', ...sel, patch: { mediaId: c.reversed.mediaId, in: c.reversed.in, out: c.reversed.out, speedCurve: c.reversed.speedCurve, reversed: null } });
      return;
    }
    setRenderJob({ kind: 'reverse', label: t('app.jobReverse'), fraction: 0 });
    const off = window.api.onReverseProgress((pr) => {
      if (pr.path === m.path) setRenderJob((j) => (j && !j.error ? { ...j, fraction: pr.fraction } : j));
    });
    let res;
    try {
      res = await window.api.reverseRun({ path: m.path, duration: m.duration, hdr: m.hdr, hasAudio: m.hasAudio, type: m.type }, c.in || 0, c.out ?? m.duration);
    } catch (e) { res = { error: e.message }; }
    off();
    if (res.canceled) { setRenderJob(null); return; }
    if (res.error) { setRenderJob({ error: res.error }); return; }
    setRenderJob(null);
    let media = projectRef.current.media.find((x) => x.path === res.path);
    dispatch({ type: 'beginGesture' });
    if (!media) { media = { ...res, id: uid(), origin: 'reverse' }; dispatch({ type: 'addMedia', items: [media] }); } // Media tree: Generated ▸ Processed
    // The curve was authored against the original direction; the reversed media
    // plays backwards, so it is dropped here and restored with the original.
    dispatch({ type: 'update', ...sel, patch: { mediaId: media.id, in: 0, out: res.duration, speedCurve: undefined, reversed: { mediaId: c.mediaId, in: c.in || 0, out: c.out ?? m.duration, speedCurve: c.speedCurve } } });
    dispatch({ type: 'endGesture' });
  };

  // Checklist #5 — Replace clip: swap the clip's media for another library
  // item without losing effects, transform or timing (replaceClipPatch).
  // A linked clip is replaced as a pair — its audio partner gets the same
  // new media so the pair stays in sync. Only a main-track replace can
  // change the project sequence, so only that one goes through guardAdd.
  const replaceClip = (sel, media) => {
    const p = projectRef.current;
    const c = findClip(p, sel);
    if (!c || !media) return;
    const partner = c.linkId ? findLinkPartner(p, c) : null;
    const apply = () => {
      const cur = projectRef.current;
      const clip = findClip(cur, sel);
      if (!clip) return;
      const oldMedia = cur.media.find((x) => x.id === clip.mediaId);
      dispatch({ type: 'beginGesture' });
      dispatch({ type: 'update', ...sel, patch: replaceClipPatch(clip, oldMedia, media) });
      if (partner) {
        const pc = findClip(cur, partner);
        if (pc) dispatch({ type: 'update', ...partner, patch: replaceClipPatch(pc, cur.media.find((x) => x.id === pc.mediaId), media) });
      }
      dispatch({ type: 'endGesture' });
    };
    if (sel.track === 'video') guardAdd(media, apply);
    else apply();
  };

  // The Replace-clip submenu for one timeline clip: every other library
  // item of a compatible kind. Images carry no sound, so they are not
  // offered for a linked clip (its audio partner would go silent), and a
  // linked clip only takes video that has audio. Unprobed video (no
  // duration) is not offered either.
  const replaceEntry = (sel, c, locked) => {
    if (locked) return { label: t('menu.replaceClip'), icon: RefreshCw, disabled: true, hint: t('menu.layerLocked') };
    const p = projectRef.current;
    const linked = !!c.linkId;
    const isAudio = sel.track === 'audio';
    const candidates = p.media.filter((mm) => {
      if (mm.id === c.mediaId || mm.missing) return false;
      if (isAudio) return mm.type === 'audio' || (mm.type === 'video' && mm.hasAudio);
      if (mm.type === 'image') return !linked;
      if (mm.type === 'video') return !!mm.duration && (!linked || mm.hasAudio);
      return false;
    });
    if (!candidates.length) return { label: t('menu.replaceClip'), icon: RefreshCw, disabled: true, hint: t('menu.replaceNone') };
    return {
      label: t('menu.replaceClip'), icon: RefreshCw,
      submenu: candidates.map((mm) => ({
        label: mm.name || String(mm.path || '').split(/[\\/]/).pop(),
        onClick: () => replaceClip(sel, mm),
      })),
    };
  };

  // Checklist #11 — a solid-colour still at project size, generated by the
  // main process through the same lavfi scene generator as the stock
  // scenes. The PNG lives in <userData>/library/scenes, never in the media
  // cache, so clearing proxies can never lose it. One media item per matte;
  // the file itself is shared when colour and size match (a solid PNG has
  // nothing to recolour — there is no recolour action). The matte lands on
  // the main track at the playhead, one undo step.
  const createMatte = async (color) => {
    const p = projectRef.current;
    let res = null;
    try { res = await window.api.makeScene({ color, width: p.width, height: p.height }); } catch (e) { res = { error: e.message }; }
    if (!res || res.error || !res.path) { setRenderJob({ error: (res && res.error) || t('matte.failed') }); return; }
    const black = String(color).toLowerCase() === '#000000';
    const media = { ...res, id: uid(), origin: 'matte', name: black ? t('matte.blackName') : t('matte.name', { color: String(color).toLowerCase() }) };
    const clipId = uid();
    dispatch({ type: 'beginGesture' });
    dispatch({ type: 'addMedia', items: [media] });
    dispatch({ type: 'addToTimeline', mediaId: media.id, clipId, at: time });
    dispatch({ type: 'endGesture' });
    setSelection({ track: 'video', id: clipId });
  };

  const openClipMenu = (e, track, clip) => {
    setSelection({ track, id: clip.id });
    setMenu({ x: e.clientX, y: e.clientY, track, id: clip.id });
  };

  // ---- Motion tracking: the user picks a point on the player (Preview reports it in media fractions),
  // the engine follows it through the clip (electron/track.cjs) and the path lands on the clip; overlay,
  // text clips can then be pinned to it (clip.pin — see src/track.js). ----
  const startTrackPick = (sel) => {
    const c = findClip(project, sel);
    if (!c || c.gap) return;
    select(sel);
    setPlaying(false);
    seek(clipStartTl(project, sel.track, c) + 0.01);
    setTrackPick({ track: sel.track, id: sel.id, point: null, box: { w: 0.055, h: 0.095 } });
  };
  // ---- Visual crop: an on-player mode (like track-pick). The whole mode is ONE undo step:
  // a gesture opens on entry, drags in the player dispatch transient updates inside it,
  // Done folds it into a single history entry, Cancel puts the entry snapshot back first.
  // Playback and scrubbing stay live while the mode is open. ----
  // ---- Chroma color pick: an on-player sampler (stage mode like track-pick). Replaces the
  // OS EyeDropper, which silently rejects under Electron on Linux — the old Pick button did
  // nothing there (K6). The player maps the click into the clip's source frame and reads
  // the pixel; a successful sample is the only thing that changes the project. ----
  const [colorPick, setColorPick] = useState(null); // { track, id }
  const startColorPick = (sel) => {
    const c = findClip(project, sel);
    if (!c || c.gap) return;
    select(sel);
    setPlaying(false);
    const start = clipStartTl(project, sel.track, c);
    const len = clipLen(c);
    if (time < start - 1e-6 || time > start + len + 1e-6) seek(start + 0.01);
    setColorPick({ track: sel.track, id: sel.id });
  };
  const finishColorPick = (hex) => {
    if (colorPick && hex) {
      const c = findClip(projectRef.current, colorPick);
      if (c) dispatch({ type: 'update', track: colorPick.track, id: colorPick.id, patch: { chroma: { ...chromaOf(c), on: true, color: hex } } });
    }
    setColorPick(null);
  };
  useEffect(() => {
    if (!colorPick) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setColorPick(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [colorPick]);

  // CROP-3: the crop mode is a BUFFERED edit. Entering snapshots the clip's crop, aspect
  // and rotation into a draft held here; every control in the mode (frame drags, centre
  // move, aspect chips, the rotation control) edits only the draft, and Preview renders
  // the draft (its project override below carries the draft rotation). The store — and
  // with it autosave, the inspector and any export — sees nothing until Done commits the
  // draft as exactly ONE undo step; Cancel (or Esc) just drops the draft.
  const startCropEdit = (sel) => {
    const c = findClip(project, sel);
    if (!c || c.gap) return;
    select(sel);
    const start = clipStartTl(project, sel.track, c);
    const len = clipLen(c);
    if (time < start - 1e-6 || time > start + len + 1e-6) seek(start + 0.01);
    const snap = { crop: cropOf(c), cropAspect: c.cropAspect || 'free', rot: transformOf(c).rot || 0 };
    setCropEdit({ track: sel.track, id: sel.id, snapshot: snap, draftCrop: snap.crop, draftAspect: snap.cropAspect, draftRot: snap.rot });
  };
  const doneCropEdit = () => {
    if (!cropEdit) return;
    const { snapshot: snap, draftCrop, draftAspect, draftRot } = cropEdit;
    const c = findClip(projectRef.current, cropEdit);
    const changed = c && (JSON.stringify(draftCrop) !== JSON.stringify(snap.crop)
      || draftAspect !== snap.cropAspect || draftRot !== snap.rot);
    if (changed) {
      dispatch({ type: 'beginGesture' });
      dispatch({ type: 'update', track: cropEdit.track, id: cropEdit.id, patch: { crop: draftCrop, cropAspect: draftAspect, transform: { ...transformOf(c), rot: draftRot } } });
      dispatch({ type: 'endGesture' });
    }
    setCropEdit(null);
  };
  const cancelCropEdit = () => { setCropEdit(null); };
  const applyCropAspect = (id) => {
    if (!cropEdit) return;
    const c = findClip(projectRef.current, cropEdit);
    const m = c && projectRef.current.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    if (id === 'free') { setCropEdit((e) => e && { ...e, draftAspect: 'free' }); return; }
    const R = aspectRatioOf(id, m.width, m.height);
    if (!R) return;
    setCropEdit((e) => e && { ...e, draftCrop: cropForAspect(e.draftCrop, m.width, m.height, R), draftAspect: id });
  };
  const setCropDraft = useCallback((crop) => { setCropEdit((e) => (e ? { ...e, draftCrop: crop } : e)); }, []);
  const setCropRot = (rot) => { const r = Math.round(Math.min(180, Math.max(-180, Number(rot) || 0)) * 10) / 10; setCropEdit((e) => (e ? { ...e, draftRot: r } : e)); };
  // While cropping, Preview shows the DRAFT rotation on the target clip (the crop itself
  // is suppressed there as before). Everything else about the project is untouched.
  const cropPreviewProject = useMemo(() => {
    if (!cropEdit) return playProject;
    const patchList = (list) => (list || []).map((c) => (c.id === cropEdit.id ? { ...c, transform: { ...transformOf(c), rot: cropEdit.draftRot } } : c));
    return { ...playProject, videoClips: patchList(playProject.videoClips), overlayClips: patchList(playProject.overlayClips) };
  }, [playProject, cropEdit]);
  useEffect(() => {
    if (!cropEdit) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelCropEdit(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cropEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTrack = async () => {
    const pick = trackPick;
    if (!pick || !pick.point) return;
    const p = projectRef.current;
    const c = findClip(p, pick);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    setTrackPick(null);
    if (!c || !m) return;
    setRenderJob({ kind: 'track', label: `Tracking motion in "${m.name || 'clip'}"`, fraction: 0 });
    const off = window.api.onTrackProgress(({ fraction }) => setRenderJob((j) => (j && j.kind === 'track' ? { ...j, fraction } : j)));
    let res = null;
    try { res = await window.api.trackRun(m, c.in || 0, c.out ?? m.duration, pick.point, pick.box); } catch { /* reported below */ }
    off();
    if (res && res.points && res.points.length) {
      dispatch({ type: 'beginGesture' });
      dispatch({ type: 'update', track: pick.track, id: pick.id, patch: { track: { points: res.points, box: pick.box, fps: res.fps } } });
      dispatch({ type: 'endGesture' });
      setRenderJob(null);
    } else if (res && res.canceled) setRenderJob(null);
    else setRenderJob({ error: (res && res.error) || t('app.trackingFailed') });
  };

  // Auto-reframe 9:16 (v1.1.8): track the faces on the main track, then switch to a NEW vertical
  // copy of the project whose pictures follow the subject (src/reframe.js). The original keeps
  // its file and autosave slot untouched — the copy starts unbound, like a new project.
  const startReframe = async () => {
    const p = projectRef.current;
    if (p.ratio === '9:16') { setRenderJob({ error: t('app.alreadyVertical') }); return; }
    const items = [];
    for (const c of p.videoClips) {
      if (c.gap) continue;
      const m = p.media.find((x) => x.id === c.mediaId);
      if (m && m.type === 'video' && m.path) {
        items.push({ clipId: c.id, item: { path: m.path, width: m.width, height: m.height, duration: m.duration, fps: m.fps, hdr: m.hdr }, from: c.in || 0, to: c.out ?? m.duration });
      }
    }
    const hasPicture = p.videoClips.some((c) => !c.gap && p.media.some((x) => x.id === c.mediaId));
    if (!hasPicture) { setRenderJob({ error: t('app.reframeNeedsVideo') }); return; }
    setRenderJob({ kind: 'reframe', label: items.length ? t('app.jobReframeFaces') : t('app.jobReframeMake'), fraction: 0 });
    let res = { results: {} };
    if (items.length) {
      const off = window.api.onReframeProgress(({ stage, fraction }) => setRenderJob((j) => (j && j.kind === 'reframe'
        ? { ...j, label: stage === 'download' ? t('app.jobModelDownload') : t('app.jobReframeFaces'), fraction } : j)));
      try { res = await window.api.reframeRun(items); } catch { res = null; }
      off();
    }
    if (!res || res.error) { setRenderJob({ error: (res && res.error) || 'Auto-reframe failed.' }); return; }
    if (res.canceled) { setRenderJob(null); return; }
    const paths = {};
    for (const [clipId, r] of Object.entries(res.results || {})) paths[clipId] = r.points;
    const copy = buildVerticalCopy(projectRef.current, paths, uid);
    await flushAutosave(); // the original keeps its last changes (file + slot)
    autosave.current.file = null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: copy });
    setSaveState('new');
    setUnsavedNote(null);
    setTime(0);
    setSelection(null);
    setRenderJob(null);
  };
  // Beat cuts (v1.1.9): hear the soundtrack's beat grid (electron/beats.cjs) and put
  // it on the project; the timeline draws the beat markers, snapping includes them,
  // and Split at beats cuts a main-track clip on them (src/beats.js + store).
  const startBeatDetect = async () => {
    const p = projectRef.current;
    const hasSound = p.media.some((m) => m.hasAudio) && (p.videoClips.length || p.audioClips.length);
    if (!hasSound) { setRenderJob({ error: t('app.beatsNeedsSound') }); return; }
    setRenderJob({ kind: 'beats', label: t('app.jobBeats'), fraction: 0 });
    const off = window.api.onBeatsProgress(({ stage, fraction }) => setRenderJob((j) => (j && j.kind === 'beats'
      ? { ...j, label: stage === 'render' ? t('app.jobMixing') : t('app.jobBeats'), fraction } : j)));
    let res = null;
    try { res = await window.api.beatsAnalyze(p); } catch { res = null; }
    off();
    if (!res || res.error) { setRenderJob({ error: (res && res.error) || t('app.beatFailed') }); return; }
    if (res.canceled) { setRenderJob(null); return; }
    dispatch({ type: 'setBeats', beats: { bpm: res.bpm, times: res.beats } });
    setRenderJob(null);
  };
  const splitAtBeats = useCallback(() => {
    const tgt = beatSplitTarget(project, time, selection);
    if (!tgt) return;
    dispatch({ type: 'splitAtBeats', id: tgt.clip.id, newIds: tgt.times.map(() => uid()) });
  }, [project, time, selection]);

  // Scene splitting (Sprint 10): the main process runs the FFmpeg
  // scene-score pass over the clip's media file; the boundaries inside the
  // clip's window map through the speed sampler into timeline times and
  // land as ordinary splits (one undo step, linked partners split along).
  const splitAtScenes = async (sel) => {
    const p = projectRef.current;
    const c = findClip(p, sel);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m || m.type !== 'video') return;
    setRenderJob({ kind: 'scenes', label: `Finding scene cuts in “${m.name || 'clip'}”…`, fraction: 0 });
    let res = null;
    try { res = await window.api.detectScenes(m.path, { threshold: 0.3 }); } catch { res = null; }
    if (!res || res.error) { setRenderJob({ error: (res && res.error) || t('app.sceneFailed') }); return; }
    if (res.canceled) { setRenderJob(null); return; }
    const start = sel.track === 'video'
      ? (videoLayout(p.videoClips).find((l) => l.clip.id === c.id)?.start ?? 0)
      : c.start;
    const times = (res.cuts || [])
      .filter((cut) => cut.time > (c.in || 0) + 0.05 && cut.time < (c.out ?? m.duration) - 0.05)
      .map((cut) => start + timelineOffsetAt(c, cut.time - (c.in || 0)));
    if (!times.length) { setRenderJob({ error: t('app.noScenes') }); return; }
    dispatch({ type: 'splitAtTimes', track: sel.track, id: c.id, times, newIds: times.map(() => uid()) });
    setRenderJob(null);
  };

  // Silence removal (10/10 step 4, Filmora merge row 14): the main process
  // runs the FFmpeg silencedetect pass over the clip's media; the spans
  // inside the clip's window are padded by SILENCE_PAD on each side (speech
  // edges survive), mapped through the speed sampler into timeline times,
  // shown on the waveform, and — on confirm — removed with the ordinary
  // range cuts: the main track ripples with its captions, a standalone
  // audio clip closes up inside itself. A LINKED audio clip is refused up
  // front: cutting its sound alone would desync the pair — the picture
  // clip is the one to run it on.
  const SILENCE_PAD = 0.08;
  const removeSilences = async (sel) => {
    const p = projectRef.current;
    const c = findClip(p, sel);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    if (sel.track === 'audio' && c.linkId) {
      setRenderJob({ error: t('app.silenceLinked') });
      return;
    }
    setRenderJob({ kind: 'silence', label: t('app.listeningSilences', { name: m.name || 'clip' }), fraction: 0 });
    let res = null;
    try { res = await window.api.detectSilence(m.path, { durationHint: m.duration }); } catch { res = null; }
    if (!res || res.error) { setRenderJob({ error: (res && res.error) || t('app.silenceFailed') }); return; }
    if (res.canceled) { setRenderJob(null); return; }
    const start = sel.track === 'video'
      ? (videoLayout(p.videoClips).find((l) => l.clip.id === c.id)?.start ?? 0)
      : c.start;
    const inAt = c.in || 0;
    const outAt = c.out ?? m.duration;
    const ranges = (res.ranges || [])
      .filter((r) => r.end > inAt + 0.05 && r.start < outAt - 0.05)
      .map((r) => {
        const a = Math.max(inAt, r.start) + SILENCE_PAD;
        const b = Math.min(outAt, r.end) - SILENCE_PAD;
        return { start: start + timelineOffsetAt(c, a - inAt), end: start + timelineOffsetAt(c, b - inAt) };
      })
      .filter((r) => r.end - r.start >= 0.2);
    if (!ranges.length) { setRenderJob({ error: t('app.noSilences') }); return; }
    setRenderJob(null);
    setSilenceAsk({ track: sel.track, id: c.id, ranges, totalSec: ranges.reduce((n, r) => n + (r.end - r.start), 0) });
  };

  const confirmSilenceRemoval = () => {
    const ask = silenceAsk;
    if (!ask) return;
    if (ask.track === 'video') dispatch({ type: 'cutRanges', ranges: ask.ranges, rippleText: true });
    else dispatch({ type: 'cutFreeRanges', track: ask.track, id: ask.id, ranges: ask.ranges });
    setSilenceAsk(null);
  };

  const menuItems = (sel) => {
    if (sel.track === 'effect' && !sel.id.includes('|')) {
      return [
        { label: t('tl.split'), icon: Split, shortcut: menuKey('split'), onClick: split },
        { label: t('menu.duplicate'), icon: CopyPlus, shortcut: menuKey('duplicate'), onClick: duplicate },
        { label: t('menu.deleteClip'), icon: Trash2, shortcut: menuKey('remove'), onClick: remove },
      ];
    }
    if (sel.track === 'effect') {
      const { track, clipId } = parseEffectKey(sel.id);
      return [
        { label: t('menu.deleteEffect'), icon: Trash2, shortcut: menuKey('remove'), onClick: () => { dispatch({ type: 'removeEffect', id: sel.id }); setSelection(null); } },
        { label: t('menu.selectClip'), icon: Layers, onClick: () => setSelection({ track, id: clipId }) },
      ];
    }
    const c = findClip(project, sel);
    if (!c) return [];
    // Checklist #15: a locked layer used to swallow every clip edit
    // silently (the store's actionLocked returns state unchanged with no
    // feedback). Mutating entries below are disabled with the lock hint
    // instead, so the menu says why nothing happens.
    const locked = isLayerLocked(project, sel.track, layerOf(c));
    const lockHint = t('menu.layerLocked');
    const pasteLocked = !!(clipboard && isLayerLocked(project, clipboard.track, layerOf(clipboard.clip)));
    if (c.gap) return [{ label: t('menu.closeGap'), icon: Trash2, shortcut: menuKey('remove'), disabled: locked, hint: locked ? lockHint : undefined, onClick: () => dispatch({ type: 'delete', ...sel }) }];
    const m = c.mediaId && project.media.find((x) => x.id === c.mediaId);
    const pic = sel.track === 'video' || sel.track === 'overlay';
    const withSound = (pic && m?.type === 'video' && m.hasAudio) || sel.track === 'audio';
    const canDetach = pic && m?.type === 'video' && m.hasAudio && !c.muted && !c.linkId;
    const detachHint = !(pic && m?.type === 'video') ? t('app.onlyVideo')
      : !m.hasAudio ? t('app.videoNoSound') : c.linkId ? t('app.alreadyDetached') : t('app.clipMuted');
    // Extract audio: an independent, unlinked copy of the sound (the extractAudio action) —
    // same availability as Detach, minus the link condition.
    const canExtract = pic && m?.type === 'video' && m.hasAudio && !c.muted;
    const extractHint = !(pic && m?.type === 'video') ? t('app.onlyVideo')
      : !m.hasAudio ? t('app.videoNoSound') : t('app.clipMuted');
    const items = [
      // A lost clip's first job is finding its file again (Part 3, 2026-11-10).
      ...(m?.missing ? [{ label: t('menu.relink'), icon: Unlink, onClick: () => reopenRelink(m) }, 'sep'] : []),
      { label: t('menu.copy'), icon: Copy, shortcut: menuKey('copy'), onClick: copy },
      { label: t('menu.cut'), icon: Scissors, shortcut: menuKey('cut'), onClick: cut, disabled: locked, hint: locked ? lockHint : undefined },
      { label: t('menu.paste'), icon: ClipboardPaste, shortcut: menuKey('paste'), onClick: paste, disabled: !clipboard || pasteLocked, hint: pasteLocked ? lockHint : t('menu.pasteHint') },
      { label: t('menu.deleteClip'), icon: Trash2, shortcut: menuKey('remove'), onClick: remove, disabled: locked, hint: locked ? lockHint : undefined },
      { label: t('menu.selectAllLayer'), icon: ListChecks, onClick: () => selectAllOnLayer(sel) },
      'sep',
      { label: t('tl.split'), icon: Split, shortcut: menuKey('split'), onClick: split, disabled: locked, hint: locked ? lockHint : undefined },
      { label: t('menu.deleteLeft'), icon: ScissorsLineDashed, shortcut: menuKey('trimLeft'), onClick: () => trimSide('left'), disabled: locked, hint: locked ? lockHint : undefined },
      { label: t('menu.deleteRight'), icon: ScissorsLineDashed, shortcut: menuKey('trimRight'), onClick: () => trimSide('right'), disabled: locked, hint: locked ? lockHint : undefined },
      { label: t('menu.duplicate'), icon: CopyPlus, shortcut: menuKey('duplicate'), onClick: duplicate, disabled: locked, hint: locked ? lockHint : undefined },
    ];
    // Move to Track: the other layers of this clip's lane (multi-selection moves together).
    if (LAYERED[sel.track]) {
      const count = layerCount(project, sel.track);
      const cur = layerOf(c);
      const span = sel.track === 'audio' ? { start: c.start, len: freeLen('audio', c) }
        : sel.track === 'overlay' ? { start: c.start, len: freeLen('overlay', c) }
        : { start: c.start, len: c.duration };
      if (count > 1) {
        items.push({
          label: t('menu.moveToLayer'), icon: Layers, disabled: locked, hint: locked ? lockHint : undefined,
          submenu: Array.from({ length: count }, (_, layer) => layer).filter((layer) => layer !== cur).map((layer) => ({
            label: layerDispName(project, sel.track, layer),
            disabled: !layerFree(project, sel.track, layer, span.start, span.len, c.id) || isLayerLocked(project, sel.track, layer),
            hint: isLayerLocked(project, sel.track, layer) ? t('menu.layerLocked') : t('menu.layerOverlap'),
            onClick: () => moveSelectionToLayer(sel, layer),
          })),
        });
      }
    }
    // Speed / Duration (constant speed — also on the inspector's Speed tab) and Properties.
    if (pic || sel.track === 'audio') {
      items.push({ label: t('menu.speedDuration'), icon: Gauge, onClick: () => setSpeedAsk({ track: sel.track, id: sel.id }), disabled: locked, hint: locked ? lockHint : undefined });
    }
    items.push({ label: t('menu.properties'), icon: Info, onClick: () => {
      select(sel);
      requestAnimationFrame(() => {
        const el = document.querySelector('aside.inspector');
        if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
      });
    } });
    if (pic) {
      items.push('sep',
        replaceEntry(sel, c, locked),
        { label: t('menu.copyAttrs'), icon: Paintbrush, onClick: () => setAttrClipboard(pickAttributes(c)) },
        { label: t('menu.pasteAttrs'), icon: Paintbrush, disabled: locked || !attrClipboard, hint: locked ? lockHint : t('menu.pasteAttrsHint'),
          onClick: () => dispatch({ type: 'update', ...sel, patch: attrClipboard }) },
        { label: t('menu.resetTransform'), icon: RotateCcw, disabled: locked, hint: locked ? lockHint : undefined,
          onClick: () => dispatch({ type: 'update', ...sel, patch: resetTransformPatch(c, sel.track) }) },
        { label: t('menu.removeFilter'), icon: Eraser, disabled: locked || !c.filter || c.filter === 'none', hint: locked ? lockHint : t('menu.noFilterHint'),
          onClick: () => dispatch({ type: 'update', ...sel, patch: { filter: 'none' } }) },
        sel.track === 'video'
          ? { label: t('menu.toOverlay'), icon: Layers, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => {
            const l = videoLayout(project.videoClips).find((x) => x.clip.id === c.id);
            dispatch({ type: 'moveToOverlay', id: c.id, at: l ? l.start : time });
            setSelection({ track: 'overlay', id: c.id });
          } }
          : { label: t('menu.toMain'), icon: PanelBottom, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => {
            const index = videoLayout(project.videoClips).filter((l) => (l.start + l.end) / 2 < c.start).length;
            dispatch({ type: 'moveToMain', id: c.id, index });
            setSelection({ track: 'video', id: c.id });
          } });
    }
    if (pic) {
      const fx = c.effects || [];
      items.push('sep',
        { label: t('menu.freeze'), icon: Snowflake, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => freezeClip(sel) },
        { label: c.reversed ? t('menu.reverseRestore') : t('menu.reverse'), icon: Rewind, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => reverseClip(sel) },
        { label: fx.includes('mirror') ? t('menu.mirrorOn') : t('menu.mirror'), icon: FlipHorizontal2, disabled: locked, hint: locked ? lockHint : undefined,
          onClick: () => dispatch({ type: 'update', ...sel, patch: { effects: fx.includes('mirror') ? fx.filter((x) => x !== 'mirror') : [...fx, 'mirror'] } }) },
        { label: t('menu.rotate90'), icon: RotateCw, disabled: locked, hint: locked ? lockHint : undefined,
          onClick: () => { const t = c.transform || {}; dispatch({ type: 'update', ...sel, patch: { transform: { ...t, rot: ((t.rot || 0) + 90) % 360 } } }); } });
    }
    if (pic && m?.type === 'video') {
      items.push({ label: t('menu.splitScenes'), icon: Scissors, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => splitAtScenes(sel) });
    }
    if (pic && m?.type === 'video') {
      items.push({ label: t('menu.aiEnhance'), icon: Sparkles, disabled: locked, hint: locked ? lockHint : t('menu.aiEnhanceHint'),
        onClick: () => setEnhanceDlg({ sel, media: m }) });
    }
    if (sel.track === 'video') {
      items.push({ label: t('menu.splitBeats'), icon: ScissorsLineDashed, disabled: locked || !(project.beats && project.beats.times && project.beats.times.length),
        hint: locked ? lockHint : t('menu.splitBeatsHint'),
        onClick: () => { const tgt = beatSplitTarget(project, time, sel); if (tgt) dispatch({ type: 'splitAtBeats', id: tgt.clip.id, newIds: tgt.times.map(() => uid()) }); } });
    }
    if (withSound) {
      items.push({ label: t('menu.removeSilences'), icon: AudioLines, disabled: locked || (sel.track === 'audio' && !!c.linkId),
        hint: locked ? lockHint : t('menu.removeSilencesHint'),
        onClick: () => removeSilences(sel) });
    }
    items.push('sep');
    if (pic) items.push({ label: t('menu.detachAudio'), icon: AudioLines, shortcut: menuKey('extractAudio'), onClick: () => detachAudio(sel), disabled: locked || !canDetach, hint: locked ? lockHint : detachHint });
    if (pic) items.push({ label: t('menu.extractAudio'), icon: FileAudio, onClick: () => dispatch({ type: 'extractAudio', track: sel.track, id: sel.id, newId: uid() }), disabled: locked || !canExtract, hint: locked ? lockHint : extractHint });
    if (c.linkId) {
      items.push({ label: t('menu.unlink'), icon: Unlink, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => unlinkClip(sel) });
    } else if (selection?.items?.length === 2
      && selection.items.some((it) => it.track === 'audio')
      && selection.items.some((it) => it.track === 'video' || it.track === 'overlay')) {
      items.push({ label: t('menu.link'), icon: Link2, disabled: locked, hint: locked ? lockHint : undefined, onClick: linkPair });
    }
    if (sel.track === 'audio') items.push(replaceEntry(sel, c, locked));
    if (sel.track === 'audio') items.push({ label: c.reversed ? t('menu.reverseRestore') : t('menu.reverse'), icon: Rewind, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => reverseClip(sel) });
    items.push({ label: t('menu.exportClipAudio'), icon: AudioLines, onClick: () => exportAudio('mp3', sel), disabled: !withSound, hint: t('menu.noSoundHint') });
    // Enhance voice on the clip's own menu too — the same render the inspector's
    // Enhance voice section drives (clip.enhance via enhanceClip), for audio clips and
    // picture clips with sound alike. Hamza, 2026-11-01: it must appear in the audio
    // context, not only in the video panel.
    if (withSound && m?.hasAudio) {
      const e = c.enhance;
      const stale = !!(e?.path && (Math.abs((e.from ?? -1) - (c.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (c.out ?? -1)) > 0.02));
      const enhOn = !!(e?.on && e?.path && !stale);
      items.push({
        label: enhOn ? t('menu.enhanceOn', { strength: e.strength }) : t('menu.enhance'), icon: Sparkles, disabled: locked, hint: locked ? lockHint : undefined,
        submenu: [
          { label: t('menu.off'), disabled: !e?.on, hint: t('menu.enhanceOffHint'), onClick: () => dispatch({ type: 'update', ...sel, patch: { enhance: { ...e, on: false } } }) },
          ...[['light', 'Light'], ['standard', 'Standard'], ['strong', 'Strong']].map(([s, name]) => ({
            label: enhOn && e.strength === s ? `${name} ✓` : name,
            onClick: () => enhanceClip(sel, s),
          })),
        ],
      });
    }
    items.push(c.disabled
      ? { label: t('menu.activate'), icon: Eye, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: false } }) }
      : { label: t('menu.deactivate'), icon: EyeOff, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: true } }) });
    // Motion tracking: track a video clip's moving point; pin overlay / text clips to a track.
    if (pic && m?.type === 'video') {
      items.push('sep', { label: c.track ? t('menu.trackAgain') : t('menu.track'), icon: Crosshair, disabled: locked, hint: locked ? lockHint : undefined, onClick: () => startTrackPick(sel) });
    }
    if (sel.track === 'overlay' || sel.track === 'text') {
      const sources = trackedClips(project).filter((s) => s.clip.id !== c.id);
      const submenu = [];
      if (c.pin) submenu.push({ label: t('menu.unpin'), icon: PinOff, onClick: () => dispatch({ type: 'update', ...sel, patch: { pin: null } }) });
      for (const s of sources) {
        const sm = project.media.find((x) => x.id === s.clip.mediaId);
        submenu.push({
          label: t('menu.trackIn', { name: sm?.name || 'clip' }), icon: Pin,
          onClick: () => dispatch({ type: 'update', ...sel, patch: { pin: { to: s.clip.id } } }),
        });
      }
      if (!submenu.length) submenu.push({ label: t('menu.noTracked'), disabled: true, hint: t('menu.noTrackedHint') });
      items.push({ label: t('menu.pinToTrack'), icon: Pin, submenu });
    }
    return items;
  };

  const duplicate = useCallback(() => {
    if (!selection) return;
    const okItem = (it) => it.track !== 'transition' && !(it.track === 'effect' && it.id.includes('|'));
    if (selection.items) {
      // Bulk duplicate: every selected clip, one undo step (locked layers refuse their own).
      const items = selection.items.filter(okItem);
      if (!items.length) return;
      dispatch({ type: 'beginGesture' });
      items.forEach((it) => dispatch({ type: 'duplicate', ...it, newId: uid() }));
      dispatch({ type: 'endGesture' });
    } else if (okItem(selection)) dispatch({ type: 'duplicate', ...selection, newId: uid() });
  }, [selection]);

  // Saves to the project's file (asks where the first time, or always with saveAs). Returns true once saved.
  const save = async (saveAs = false) => {
    const a = autosave.current;
    const p = projectRef.current;
    const res = await window.api.saveProject(JSON.stringify(p, null, 2), a.file, { saveAs, name: p.name });
    if (!res) return false;
    if (res.error) {
      setSaveState('error');
      alert(res.error);
      return false;
    }
    clearTimeout(a.fileTimer);
    a.file = res;
    setSaveState('saved');
    pushRecent(recentOf(p, res));
    keepRecovery(false);
    writeSlotNow(p, res); // the slot binds to the file it was just saved to
    return true;
  };

  const open = async () => {
    const res = await window.api.openProject();
    if (!res) return;
    if (res.corrupt) {
      alert(t('app.projectDamaged'));
      return;
    }
    try {
      const p = await adoptFileBinding(JSON.parse(res.json), res.file);
      await flushAutosave(); // the current project keeps its last changes (file + slot)
      autosave.current.file = res.file;
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      writeSlotNow(p, res.file); // the slot syncs to the file's content under the shared id
      setScreen('editor');
      afterLoadNotes(res);
    } catch (e) {
      alert(t('app.invalidProject', { msg: e.message }));
    }
  };

  // ---- Home screen actions ----
  const startNewProject = async (preset, fps) => {
    await flushAutosave(); // the project being left keeps everything, slot included
    const p = {
      ...emptyProject(), name: 'Untitled', ratio: preset.ratio,
      ...sizeFor(preset.ratio, preset.short), resolution: preset.short, fps, ratioLocked: true,
    };
    autosave.current.file = null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: p });
    setSaveState('new');
    setUnsavedNote(null);
    setSelection(null);
    setTime(0);
    setScreen('editor');
  };

  // Home quick tool: Record screen opens a fresh 16:9 project with the recorder up.
  const startRecording = (fps) => {
    startNewProject({ ratio: '16:9', short: 1080 }, fps);
    setPlaying(false);
    setScreenOpen(true);
  };

  // Open a project from its autosave slot (the card may be slot-only or merged with the
  // file recent for the same project). The current project is flushed first, then the
  // slot's state is restored whole — media paths included, exactly like a file open.
  const openSlot = async (entry) => {
    await flushAutosave(); // whatever is in the editor right now keeps its latest state
    const slot = await window.api.slotRead(entry.slotId);
    if (!slot) {
      refreshSlots();
      alert(t('app.autosaveGone'));
      return;
    }
    autosave.current.file = slot.file || null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: { ...slot.project, id: slot.id } });
    setSaveState(slot.file ? 'saved' : 'new');
    setUnsavedNote(null);
    setTime(0);
    setSelection(null);
    setScreen('editor');
    if (slot.missing?.length) { dispatch({ type: 'setMediaMissing', ids: slot.missing.map((m) => m.id) }); setRelinkAsk({ items: slot.missing }); }
  };

  const openRecent = async (r) => {
    if (r.slotId) return openSlot(r);
    const res = await window.api.openProjectPath?.(r.path);
    if (!res) {
      storeRecents(recents.filter((x) => x.path !== r.path));
      alert(t('app.projectGone'));
      return;
    }
    if (res.corrupt) {
      alert(t('app.projectDamaged'));
      return;
    }
    try {
      const p = await adoptFileBinding(JSON.parse(res.json), res.file);
      await flushAutosave();
      autosave.current.file = res.file;
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      writeSlotNow(p, res.file); // the slot syncs to the file's content under the shared id
      setScreen('editor');
      afterLoadNotes(res);
    } catch (e) {
      alert(t('app.invalidProject', { msg: e.message }));
    }
  };

  const importFromHome = async () => {
    await flushAutosave(); // the project in the editor keeps its state before media lands
    const ok = await importMedia();
    if (ok.length) {
      autosave.current.file = null;
      setSaveState('new');
      setScreen('editor');
    }
  };

  // The startup offer (a project the last session ended on, unsaved): restoring loads it
  // with its file binding, exactly as it was left; the editor's current work is flushed
  // first. Discarding clears the recovery AND the project's slot — the user said no.
  const restoreUnsaved = async () => {
    const note = unsavedNote;
    if (!note) return;
    await flushAutosave();
    autosave.current.file = note.file || null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: note.project });
    if (note.file) setSaveState('saved');
    setUnsavedNote(null);
    setTime(0);
    setSelection(null);
    setScreen('editor');
  };
  const discardUnsaved = () => {
    autosave.current.pendingRestore = false;
    const id = unsavedNote?.project?.id;
    keepRecovery(false);
    if (id && !isTourId(id)) window.api.slotDelete?.(id).then(refreshSlots).catch(() => {});
    setUnsavedNote(null);
  };

  // Home's switchboard: autosave slots and file recents merged into ONE list, newest
  // first (src/homeList.js owns the merge). A file-backed project appears once — its
  // slot and its recent describe the same project, merged by path (the open then
  // restores the slot's latest state).
  const homeProjects = useMemo(() => mergeHomeEntries(autoSlots, recents), [autoSlots, recents]);
  const homeTrash = useMemo(() => [...slotTrash.map(trashEntryForSlot), ...fileTrash]
    .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0)), [slotTrash, fileTrash]);

  // ---- Home switchboard actions (R5, parity §8): duplicate / rename / trash ----
  // Duplicate a slot project in the store (fresh id, unbound copy). A project that
  // lives only in its file is read WITHOUT being adopted (project:readPath) and its
  // document is copied into a fresh slot under a fresh id — the original file and its
  // binding are untouched either way.
  const duplicateHomeEntry = async (entry) => {
    if (!entry) return;
    if (entry.slotId) {
      const e = await window.api.slotCopy?.(entry.slotId).catch(() => null);
      if (e) { refreshSlots(); return; }
      alert(t('app.couldNotDuplicate'));
      return;
    }
    if (entry.path) {
      const res = await window.api.readProjectPath?.(entry.path).catch(() => null);
      if (!res?.json) { alert(t('app.duplicateUnreadable')); return; }
      try {
        const p = JSON.parse(res.json);
        const id = uid();
        const title = `${p.name || 'Untitled'} copy`;
        const copy = { ...p, id, name: title };
        const e2 = recentEntryFor(copy, '', toFileUrl);
        await window.api.slotWrite({ id, title, file: null, ratio: copy.ratio || '', thumb: e2.thumb, duration: e2.duration || 0, updatedAt: Date.now(), projectJson: JSON.stringify(copy) });
        refreshSlots();
      } catch { alert(t('app.couldNotDuplicate')); }
    }
  };

  // Rename in place: a slot project's title + document name move in the store; a
  // file-only project's document name is rewritten in its file (transactionally).
  // Either way the recents label follows, so no stale name survives anywhere.
  const renameHomeEntry = async (entry, title) => {
    const name = String(title || '').trim();
    if (!entry || !name) return false;
    if (entry.slotId) {
      const e = await window.api.slotRename?.(entry.slotId, name).catch(() => null);
      if (!e) { alert(t('app.couldNotRename')); return false; }
      if (entry.path) storeRecents(recents.map((r) => (r.path === entry.path ? { ...r, name } : r)));
      refreshSlots();
      return true;
    }
    if (entry.path) {
      const res = await window.api.renameProjectFile?.(entry.path, name).catch(() => null);
      if (!res) { alert(t('app.renameFailed')); return false; }
      storeRecents(recents.map((r) => (r.path === entry.path ? { ...r, name } : r)));
      return true;
    }
    return false;
  };

  // Move to trash: slot projects park in the store (restore brings back the slot AND
  // its file binding); a merged card's file recent leaves the list so the project
  // does not reappear as file-only. File-only projects park as a reference — the
  // file itself stays exactly where it is on disk.
  const trashHomeEntry = (entry) => {
    if (!entry) return;
    if (entry.slotId) {
      window.api.slotTrash?.(entry.slotId).then(refreshHome).catch(() => {});
      if (entry.path) removeRecent(entry.path);
    } else if (entry.path) {
      storeFileTrash([trashEntryForRecent(entry), ...fileTrash.filter((t) => t.path !== entry.path)]);
      removeRecent(entry.path);
    }
  };

  const restoreTrashedEntry = (t) => {
    if (!t) return;
    if (t.kind === 'slot' && t.slotId) {
      window.api.slotRestore?.(t.slotId).then(refreshHome).catch(() => {});
    } else if (t.kind === 'file' && t.path) {
      pushRecent({ path: t.path, name: t.name, ratio: t.ratio, thumb: t.thumb, duration: t.duration, modifiedAt: t.modifiedAt || Date.now() });
      storeFileTrash(fileTrash.filter((x) => x.path !== t.path));
    }
  };

  // Delete forever: a slot trash entry loses its auto-saved copy for real; a file
  // trash entry loses only the reference — the project FILE is never deleted.
  const deleteTrashedEntry = (t) => {
    if (!t) return;
    if (t.kind === 'slot' && t.slotId) {
      window.api.slotDelete?.(t.slotId).then(refreshHome).catch(() => {});
    } else if (t.kind === 'file' && t.path) {
      storeFileTrash(fileTrash.filter((x) => x.path !== t.path));
    }
  };

  const emptyHomeTrash = async () => {
    for (const t of slotTrash) { try { await window.api.slotDelete?.(t.id); } catch { /* the refresh shows the truth */ } }
    storeFileTrash([]);
    refreshHome();
  };

  // Version history from a Home card (slot projects carry the project id the history
  // is keyed by). Restoring follows the editor's rule: the current state is recorded
  // as a restore point first, so the restore itself can be undone from the same list.
  const [homeHistory, setHomeHistory] = useState(null); // { slotId, name }
  const restoreVersionFromHome = async (versionEntry) => {
    const target = homeHistory;
    if (!target?.slotId || !versionEntry?.file) return;
    const id = target.slotId;
    await flushAutosave(); // whatever sits in the editor is persisted before anything loads
    let slot = null;
    try {
      slot = await window.api.slotRead?.(id);
      if (slot?.project) await window.api.versionsRecord?.(id, JSON.stringify(slot.project), slot.file || null);
    } catch { /* the restore still proceeds */ }
    const res = await window.api.versionsRead?.(id, versionEntry.file);
    if (!res?.json) { alert(t('app.versionUnreadable')); return; }
    let vp;
    try { vp = JSON.parse(res.json); } catch { alert(t('app.versionDamaged')); return; }
    autosave.current.file = slot?.file || target.path || null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: { ...vp, id } });
    setHomeHistory(null);
    setSaveState(autosave.current.file ? 'saved' : 'new');
    setUnsavedNote(null);
    setSelection(null);
    setTime(0);
    setScreen('editor');
    setFileNote(t('app.restoredVersion', { when: new Date(versionEntry.savedAt).toLocaleString(NUM_LOCALES[getLanguage()] || 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) }));
    if (res.missing?.length) { dispatch({ type: 'setMediaMissing', ids: res.missing.map((m) => m.id) }); setRelinkAsk({ items: res.missing }); }
  };

  // Closing the window: write the project's file, or ask about a project that never had one.
  useEffect(() => window.api.onCloseRequest(async () => {
    const a = autosave.current;
    if (a.file) {
      await writeFile();
      keepRecovery(false);
      return window.api.closeNow();
    }
    if (!hasContent(a.project)) {
      keepRecovery(false);
      return window.api.closeNow();
    }
    window.api.closeCancel(); // the window waits for the answer
    if (a.asking) return; // already asking (the close button was clicked again)
    a.asking = true;
    const choice = await new Promise((resolve) => setCloseAsk({ name: a.project.name, resolve }));
    a.asking = false;
    setCloseAsk(null);
    if (choice === 'save') {
      if (await save()) return window.api.closeNow();
      return window.api.closeCancel();
    }
    if (choice === 'discard') {
      keepRecovery(false);
      const id = a.project?.id;
      if (id && !isTourId(id)) { try { await window.api.slotDelete(id); } catch { /* closing anyway */ } }
      return window.api.closeNow();
    }
    return window.api.closeCancel();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Export opens on a summary of the EFFECTIVE settings (src/exportQuality.js resolves the project's
  // stored export settings) — and that same resolved object is stamped onto the project the pipeline
  // receives, so the summary IS the export configuration, not a description of it.
  const startExport = async () => {
    const project = renderable(projectRef.current);
    if (!project.videoClips.length) return alert(t('app.needMediaToExport'));
    if (await guardMissingForExport(project, { kind: 'export' })) return;
    setPlaying(false);
    let caps = { libx265: true };
    try { caps = await window.api.exportCaps(); } catch { /* the bundled build has libx265 */ }
    setExporting({ ready: true, eff: resolveExport(project, caps), project, caps, target: null, name: (project.name || 'export').replace(/[\\/:*?"<>|]+/g, '_'), queueAhead: jobsAhead([...exportJobMap.current.values()]) });
  };
  // Export = enqueue (R4): the destination is settled FIRST, while the user is
  // still at the dialog (cancelling the save dialog keeps the form open, as
  // before); then the form closes and the job runs in the tray.
  const confirmExport = async () => {
    const { project, eff, target, name } = exporting;
    // Re-checked at render start too: a source deleted while the dialog was
    // open must stop the render here, not render around a hole.
    if (await guardMissingForExport(project, { kind: 'export' })) { setExporting(null); return; }
    if (target) {
      setExporting(null);
      return runExportFlow(project, eff, target, name);
    }
    const picked = await window.api.exportBegin(name, eff.format);
    if (picked.canceled) return undefined; // stay on the form
    setExporting(null);
    return runExportFlow(project, eff, picked, name);
  };
  // The dialog's own Browse: pick the output file up front (the frame folder comes with it).
  // The save dialog is told the chosen format, so the offered extension is the real one.
  const pickExportTarget = async (name) => {
    const prev = exporting?.target;
    const target = await window.api.exportBegin(name || exporting?.name, exporting?.eff?.format);
    if (target.canceled) return;
    if (prev && prev.frameDir !== target.frameDir) window.api.exportAbort(prev.frameDir);
    const base = String(target.file).split(/[\\/]/).pop().replace(/\.(mp4|mov|webm|gif)$/i, '');
    setExporting((e) => e && { ...e, target, name: base || e.name });
  };
  const renameExport = (name) => {
    setExporting((e) => {
      if (!e) return e;
      const clean = String(name).replace(/[\\/:*?"<>|]+/g, '_');
      let target = e.target;
      if (target) {
        const file = String(target.file);
        const dir = file.slice(0, file.length - file.split(/[\\/]/).pop().length);
        target = { ...target, file: `${dir}${clean || 'export'}.${e.eff?.format || 'mp4'}` };
      }
      return { ...e, name: clean, target };
    });
  };
  // The dialog's quality controls write the same stored settings Project Settings writes;
  // the effective object is re-resolved so the dialog and the pipeline never diverge.
  // A format change also re-extensions an already-picked target file.
  const changeExportSettings = (patch) => {
    dispatch({ type: 'setProject', patch });
    setExporting((e) => {
      if (!e) return e;
      const project = { ...e.project, ...patch };
      const eff = resolveExport(project, e.caps);
      let target = e.target;
      if (target && eff.format !== e.eff?.format) {
        target = { ...target, file: String(target.file).replace(/\.[^.\\\/]+$/, `.${eff.format}`) };
      }
      return { ...e, project, eff, target };
    });
  };
  const changeExportResolution = (resCap) => {
    const s = storedExportSettings(exporting.project);
    if (s.preset !== 'custom') {
      const base = EXPORT_PRESETS[s.preset];
      changeExportSettings(settingsPatch(exporting.project, { preset: 'custom', custom: { ...base, resCap } }));
    } else {
      changeExportSettings(settingsPatch(exporting.project, { preset: 'custom', custom: { ...s.custom, resCap } }));
    }
  };
  const changePosterAt = (t) => {
    dispatch({ type: 'setProject', patch: { posterAt: t } });
    setExporting((e) => e && { ...e, project: { ...e.project, posterAt: t } });
  };
  // ---- Export jobs (R4): a serial queue + tray records around the pipeline ----
  // The dialog is a form; an export is a JOB. Jobs run one at a time — the main
  // process has one video slot and one audio slot sharing a single progress
  // channel and a single cancel, so serialising here is what keeps progress and
  // cancel attributed to the right job. Each job runs on the snapshot it was
  // enqueued with and reports into the tray (ExportJobsTray) instead of a
  // modal, so the user keeps editing. runExportFlow keeps its old contract for
  // its other caller (the smoke hook's exportNow): the returned promise
  // resolves when the job settles.
  const syncExportJobs = () => setExportJobs([...exportJobMap.current.values()].map((j) => ({ ...j })));
  const updateExportJob = (job, patch) => { Object.assign(job, patch); syncExportJobs(); };
  const finishExportJob = (job, patch, result) => {
    if (job.settled) return;
    job.settled = true;
    exportActiveId.current = null;
    if (patch) updateExportJob(job, patch);
    else { exportJobMap.current.delete(job.id); syncExportJobs(); }
    job.settle?.(result);
    pumpExportJobs();
  };
  const enqueueExportJob = (job) => new Promise((resolve) => {
    job.settle = resolve;
    job.settled = false;
    exportJobMap.current.set(job.id, job);
    syncExportJobs();
    pumpExportJobs();
  });
  const pumpExportJobs = () => {
    if (exportActiveId.current) return;
    const next = [...exportJobMap.current.values()].find((j) => j.status === 'queued');
    if (!next) return;
    exportActiveId.current = next.id;
    updateExportJob(next, { status: 'running' });
    const run = next.kind === 'audio' ? runAudioJob(next) : next.kind === 'enhance' ? runEnhanceJob(next) : next.kind === 'zip' ? runZipJob(next) : runVideoJob(next);
    run.catch((e) => finishExportJob(next, { status: 'error', error: e.message, progress: next.progress }, { ok: false, error: e.message }));
  };
  const cancelExportJob = (id) => {
    const job = exportJobMap.current.get(id);
    if (!job) return;
    if (job.status === 'queued') {
      exportJobMap.current.delete(id);
      if (job.target?.frameDir) window.api.exportAbort(job.target.frameDir);
      job.settled = true;
      syncExportJobs();
      job.settle?.({ canceled: true });
      return;
    }
    if (job.status === 'running') {
      job.cancelled.current = true; // the renderer phases poll this flag
      if (job.kind === 'enhance') window.api.esrganCancel(); // kills the engine/ffmpeg child in the main process
      else if (job.kind === 'zip') window.api.zipCancel(); // aborts the archive, deletes the partial file
      else window.api.cancelExport(); // the main-process phases (encode, audio job)
    }
  };
  const dismissExportJob = (id) => { exportJobMap.current.delete(id); syncExportJobs(); };

  const runVideoJob = async (job) => {
    const { project, eff, target } = job;
    // Displayed progress is monotonic across phases: a phase callback can only
    // move the bar forward. The one genuine reset — the encoder falling back
    // to the CPU and restarting the encode — is detected in the encoding
    // callback below (a 0 after a positive encoding value) and re-bases it.
    job.prog = { max: 0, enc: null };
    const setProg = (v) => {
      const m = Math.max(job.prog.max, Math.min(1, Math.max(0, v || 0)));
      job.prog.max = m;
      updateExportJob(job, { progress: m });
    };
    // Text frames take the first part of the progress bar when the project has text.
    const textShare = project.textClips.length ? 0.35 : 0;
    const fxShare = fxWork(project) ? 0.4 * (1 - textShare) : 0;
    updateExportJob(job, { phase: textShare ? 'text' : fxShare ? 'effects' : 'encode' });
    let textFrames = 0;
    try {
      textFrames = await renderTextFrames(project, target.frameDir,
        (p) => setProg(p * textShare), () => job.cancelled.current);
    } catch (e) {
      await window.api.exportAbort(target.frameDir);
      return finishExportJob(job, { status: 'error', error: `Text rendering failed: ${e.message}`, progress: job.prog.max }, { ok: false, error: e.message });
    }
    if (textFrames < 0) {
      await window.api.exportAbort(target.frameDir);
      return finishExportJob(job, null, { canceled: true });
    }
    await loadProjectLuts(project);
    // Animated effects and transitions are drawn with the preview's WebGL shaders, frame by frame.
    let toExport = { ...project, export: eff, maskImages: maskImages(project), decoImages: decoImages(project), customMaskImages: customMaskImages(project), motion: motionDataPinned(project) };
    // Soft subtitle track (MP4/MOV): serialize the caption clips with the SRT writer and
    // hand the text to the main process, which stages it for the mov_text mux. The same
    // captions are still burned in by the text pass — the track is an addition, and its
    // language tag is set only when every caption clip shares one (translation layers).
    if (eff.subtitleTrack && (eff.format === 'mp4' || eff.format === 'mov')) {
      const capClips = (project.textClips || []).filter((c) => c.caption);
      const srt = toSRT(capClips);
      if (srt) {
        const langs = new Set(capClips.map((c) => c.lang).filter(Boolean));
        toExport = { ...toExport, subtitleSrt: srt, ...(langs.size === 1 ? { subtitleLang: [...langs][0] } : {}) };
      }
    }
    if (fxShare) {
      try {
        toExport = await renderFxPass(toExport, (p) => setProg(textShare + p * fxShare), () => job.cancelled.current);
      } catch (e) {
        await window.api.fxClear();
        await window.api.exportAbort(target.frameDir);
        return finishExportJob(job, { status: 'error', error: `Effect rendering failed: ${e.message}`, progress: job.prog.max }, { ok: false, error: e.message });
      }
      if (!toExport) {
        await window.api.fxClear();
        await window.api.exportAbort(target.frameDir);
        return finishExportJob(job, null, { canceled: true });
      }
    }
    if (job.cancelled.current) {
      // Cancel landed in the gap before the encode spawns: honour it here, or
      // the export:cancel sent earlier (when no main-process job existed yet)
      // would be lost and the encode would run anyway.
      await window.api.exportAbort(target.frameDir);
      return finishExportJob(job, null, { canceled: true });
    }
    updateExportJob(job, { phase: 'encode' });
    const base = textShare + fxShare;
    const off = window.api.onExportProgress((p) => {
      const r = job.prog;
      if (p === 0 && r.enc !== null && r.enc > 0) {
        // CPU-fallback reset: the encode restarted from zero — re-base the bar
        // to the start of the encoding phase instead of clamping it frozen.
        r.max = base;
        r.enc = 0;
        updateExportJob(job, { progress: base });
        return;
      }
      r.enc = p;
      setProg(base + p * (1 - base));
    });
    const res = await window.api.exportRun(toExport, target, textFrames);
    off();
    if (res.canceled) return finishExportJob(job, null, { canceled: true });
    if (!res.ok) return finishExportJob(job, { status: 'error', error: res.error, progress: job.prog.max }, { ok: false, error: res.error });
    // Poster cover: when the user picked a cover frame, embed it as the file's attached picture.
    // Best-effort by design — a failed embed never fails the export; the done card says so.
    // Attached pictures exist in MP4/MOV only: WebM and GIF exports skip the embed, and the
    // done card says that too instead of silently dropping the chosen cover.
    let size = res.size;
    let coverNote = null;
    let cover = null;
    if (typeof project.posterAt === 'number' && eff.format !== 'mp4' && eff.format !== 'mov') {
      coverNote = 'The cover picture is only embedded in MP4 and MOV exports — the video itself is complete.';
    }
    if (typeof project.posterAt === 'number' && (eff.format === 'mp4' || eff.format === 'mov')) {
      updateExportJob(job, { phase: 'cover' });
      try {
        const layout = videoLayout(project.videoClips);
        const slot = layout.find((l) => !l.clip.gap && project.posterAt >= l.start && project.posterAt <= l.end);
        const media = slot && project.media.find((m) => m.id === slot.clip.mediaId);
        if (media && (media.type === 'video' || media.type === 'image')) {
          const at = media.type === 'video' ? (slot.clip.in || 0) + sourceOffsetAt(slot.clip, project.posterAt - slot.start) : 0;
          const cov = await window.api.exportCover(res.file, media.path, at);
          if (cov.ok) { if (cov.size) size = cov.size; cover = 'embedded'; }
          else coverNote = 'The cover picture could not be embedded — the video itself is complete.';
        }
      } catch { coverNote = 'The cover picture could not be embedded — the video itself is complete.'; }
    }
    return finishExportJob(job, { status: 'done', file: res.file, size, cover, coverNote, duration: exportDuration(project), progress: 1 }, { ok: true, file: res.file });
  };

  const runAudioJob = async (job) => {
    const off = window.api.onExportProgress((pr) => {
      updateExportJob(job, { progress: pr, phase: audioPhaseId(pr) });
    });
    const res = await window.api.exportAudio(job.project, job.audioFormat, job.name);
    off();
    if (res.canceled) return finishExportJob(job, null, { canceled: true });
    if (!res.ok) return finishExportJob(job, { status: 'error', error: res.error, progress: job.progress }, { ok: false, error: res.error });
    return finishExportJob(job, { status: 'done', file: res.file, progress: 1 }, { ok: true, file: res.file });
  };

  // AI Enhance job: the main process runs the Real-ESRGAN pipeline
  // (electron/esrgan.cjs) on the clip's whole source file; the result is a
  // NEW library item beside the original, which stays untouched.
  const runEnhanceJob = async (job) => {
    const off = window.api.onEsrganProgress((p) => {
      updateExportJob(job, { progress: Math.max(job.progress || 0, Math.min(1, p.fraction || 0)), phase: p.phase || job.phase });
    });
    let res;
    try { res = await window.api.esrganStart({ src: job.srcPath, model: job.model, scale: job.scale, outFile: job.file }); }
    catch (e) { res = { error: e.message }; }
    off();
    if (job.cancelled.current || res.canceled) return finishExportJob(job, null, { canceled: true });
    if (!res.ok) return finishExportJob(job, { status: 'error', error: res.error || 'Enhance failed', progress: job.progress }, { ok: false, error: res.error });
    let media = projectRef.current.media.find((x) => x.path === res.path);
    if (!media) {
      media = { ...res.media, id: uid(), origin: 'enhance', name: job.title };
      dispatch({ type: 'addMedia', items: [media] }); // Media tree: Generated ▸ Processed
    }
    showJobToast(t('enhance.done', { name: job.title }));
    return finishExportJob(job, { status: 'done', file: res.file, size: res.media.size, duration: res.media.duration, progress: 1 }, { ok: true, file: res.file });
  };

  // Checklist #7 — the project-ZIP job: the tray's first-class job for a
  // .zip holding the project JSON plus every referenced media file. No
  // missing-media guard here (unlike video export): the ZIP is the tool
  // for a project with missing media — what exists is backed up, and the
  // missing files are listed on the done card.
  const runZipJob = async (job) => {
    const off = window.api.onZipProgress((pr) => {
      if (job.cancelled.current) return;
      updateExportJob(job, { progress: Math.max(job.progress || 0, Math.min(1, pr.fraction || 0)) });
    });
    let res;
    try { res = await window.api.exportProjectZip(JSON.stringify(job.project, null, 2), { name: job.name }); }
    catch (e) { res = { error: e.message }; }
    off();
    if (!res || res.canceled || job.cancelled.current) return finishExportJob(job, null, { canceled: true });
    if (res.error) return finishExportJob(job, { status: 'error', error: res.error }, { ok: false, error: res.error });
    return finishExportJob(job, {
      status: 'done', progress: 1, file: res.path, size: res.bytes,
      note: res.missing?.length ? t('tray.zipMissing', { count: res.missing.length, names: res.missing.slice(0, 3).map((m) => m.name).join(', ') + (res.missing.length > 3 ? '…' : '') }) : undefined,
    }, { ok: true, path: res.path });
  };

  // The TopBar export menu's "Export project as ZIP": enqueue the job (it
  // runs when the queue reaches it); the save dialog picks the .zip file.
  const exportProjectZip = () => {
    const p = projectRef.current;
    return enqueueExportJob({
      id: uid(), kind: 'zip', title: p.name || 'project', formatLabel: 'ZIP',
      status: 'queued', progress: 0, phase: 'pack', phases: zipPhases(),
      project: p, name: p.name || 'project', cancelled: { current: false }, settle: null,
    });
  };

  // The dialog's Start: enqueue the enhance job (it runs when the queue
  // reaches it) with the output beside the source file.
  const startEnhance = ({ model, scale }) => {
    const dlg = enhanceDlg;
    setEnhanceDlg(null);
    if (!dlg || !dlg.media) return;
    const m = dlg.media;
    const title = `${String(m.name || 'video').replace(/\.[^.]+$/, '')} (Enhanced ${scale}x)`;
    const sep = m.path.includes('\\') ? '\\' : '/';
    const parts = m.path.split(/[\\/]/);
    parts[parts.length - 1] = `${title}.mp4`;
    enqueueExportJob({
      id: uid(), kind: 'enhance', title, formatLabel: 'MP4',
      status: 'queued', progress: 0, phase: 'frames', phases: enhancePhases(),
      file: parts.join(sep), srcPath: m.path, model, scale, cancelled: { current: false }, settle: null,
    });
  };

  // Enqueue a video export job on a snapshot; resolves when the job settles.
  // The target is resolved by the caller when the user is present (the dialog)
  // or here for headless callers (the smoke hook's exportNow).
  const runExportFlow = async (project, eff, presetTarget, name) => {
    const target = presetTarget || await window.api.exportBegin(name, eff?.format);
    if (target.canceled) return { canceled: true }; // nothing was started
    return enqueueExportJob({
      id: uid(), kind: 'video', title: name || 'Export', formatLabel: eff.formatLabel,
      status: 'queued', progress: 0, phase: null, phases: videoPhases(project, eff, fxWork(project) > 0),
      project, eff, target, name, cancelled: { current: false }, settle: null,
    });
  };
  // Hook used by the automated smoke test (electron/smoke.cjs).
  useEffect(() => {
    window.__fve = {
      load: (p) => dispatch({ type: 'load', project: p }),
      seek,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      select: setSelection,
      tab: setTab,
      dispatch,
      exportData: () => {
        const p = renderable(projectRef.current);
        return { project: { ...p, maskImages: maskImages(p), decoImages: decoImages(p), customMaskImages: customMaskImages(p), motion: motionDataPinned(p) } };
      },
      // Test hook: exports immediately (no summary gate), resolving settings the same way.
      exportNow: () => { const p = renderable(projectRef.current); return runExportFlow(p, resolveExport(p)); },
      fxSelfTest: async () => (await import('./fx/selftest.js')).fxSelfTest(),
      duration: () => projectDuration(projectRef.current),
      // Test helper: give clips that name a template the template's full style (clip values win).
      applyTemplates: () => {
        const p = projectRef.current;
        const textClips = p.textClips.map((c) => {
          const t = TEXT_TEMPLATES.find((x) => x.id === c.template);
          return t ? { ...t.patch, ...c } : c;
        });
        dispatch({ type: 'load', project: { ...p, textClips } });
      },
    };
  }, [seek]);
  const startExportRef = useRef(null);
  startExportRef.current = startExport;
  // What FlowAI can do beyond project actions: add a file it fetched (library sound, stock clip, voice-over)
  // to the media library, start the export, check font names.
  const pilotApp = {
    addProbed: (res) => {
      if (!res?.path) return null;
      const m = projectRef.current.media.find((x) => x.path === res.path);
      return m || addItems([res])[0] || null;
    },
    startExport: () => startExportRef.current(),
    fontIds: () => allFonts().map((f) => f.id),
  };
  const projectRef = useRef(project);
  projectRef.current = project;
  const historyRef = useRef(state);
  historyRef.current = state;

  // Timed auto-backup (10/10 step 4, Filmora merge row 10): while a project is
  // open in the editor, offer its current state to the version store every
  // five minutes. The store dedupes unchanged content and throttles
  // background snapshots (versions.cjs), so the cadence yields a backup
  // timeline in the Project Backups browser — not a file per tick, and
  // nothing at all while the project sits untouched.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    const timer = setInterval(() => {
      if (screenRef.current !== 'editor') return;
      const p = projectRef.current;
      if (!p || !p.id || isTourId(p.id)) return;
      try {
        window.api.versionsAutoBackup?.(p.id, JSON.stringify(p), autosave.current.file);
      } catch { /* a backup failure is silent; editing never depends on it */ }
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  // After the assistant dispatches edits, wait for React to render them so the next tool reads the new project.
  const settle = useCallback(() => new Promise((r) => setTimeout(r, 60)), []);

  // Keyboard shortcuts. The bindings come from the user's keymap (Settings
  // > Keyboard; src/keymap.js resolves the stored overrides over the
  // shipped defaults) — this handler only dispatches the resolved action,
  // so a remapped key fires here exactly as its default did, everywhere.
  const keys = useRef({});
  keys.current = { togglePlay, split, remove, duplicate, seek, time, trimSide, toggleMarker, setTool, copy, cut, paste, extractAudio: detachAudio, save, togglePanel };
  useEffect(() => {
    const onKey = (e) => {
      if (isKeyCaptureActive()) return; // Settings is capturing this key for a rebind
      const k = keys.current;
      const action = actionForEvent(getCurrentKeymap(), e);
      if (!action) return;
      // Save fires even while typing in a field (it did before remapping
      // existed); holding Alt picks the Save-as variant.
      if (action === 'save') { e.preventDefault(); k.save(e.altKey); return; }
      const t = e.target;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      switch (action) {
        case 'play': e.preventDefault(); k.togglePlay(); break;
        case 'split': e.preventDefault(); k.split(); break;
        case 'duplicate': e.preventDefault(); k.duplicate(); break;
        case 'extractAudio': e.preventDefault(); k.extractAudio(); break;
        case 'copy': k.copy(); break;
        case 'cut': k.cut(); break;
        case 'paste': k.paste(); break;
        case 'remove': k.remove(); break;
        case 'undo': dispatch({ type: 'undo' }); break;
        case 'redo': dispatch({ type: 'redo' }); break;
        case 'seekBack': k.seek(k.time - (e.shiftKey ? 1 : 1 / 30)); break;
        case 'seekFwd': k.seek(k.time + (e.shiftKey ? 1 : 1 / 30)); break;
        case 'seekStart': k.seek(0); break;
        case 'trimLeft': k.trimSide('left'); break;
        case 'trimRight': k.trimSide('right'); break;
        case 'marker': k.toggleMarker(); break;
        case 'toolRazor': k.setTool('razor'); break;
        case 'toolSelect': k.setTool('select'); break;
        case 'toggleDock': e.preventDefault(); k.togglePanel('left'); break;
        case 'toggleInspector': e.preventDefault(); k.togglePanel('right'); break;
        default: break; // 'fullscreen' is the preview player's own handler
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (screen === 'home') {
    return (
      <div className="app home-app">
        <HomeScreen recents={homeProjects} trash={homeTrash} onNew={startNewProject} onOpen={open} onOpenRecent={openRecent}
          onDuplicate={duplicateHomeEntry} onRename={renameHomeEntry} onTrash={trashHomeEntry}
          onRestoreTrashed={restoreTrashedEntry} onDeleteTrashed={deleteTrashedEntry} onEmptyTrash={emptyHomeTrash}
          onHistory={(entry) => entry?.slotId && setHomeHistory({ slotId: entry.slotId, name: entry.name, path: entry.path || null })}
          onImportMedia={importFromHome}
          onRecordStart={startRecording}
          onSettings={() => setSettingsOpen(true)}
          unsavedNote={unsavedNote}
          onRestoreUnsaved={restoreUnsaved}
          onDiscardUnsaved={discardUnsaved} />
        {homeHistory && (
          <HistoryDialog projectId={homeHistory.slotId} projectName={homeHistory.name}
            onRestore={restoreVersionFromHome} onClose={() => setHomeHistory(null)} />
        )}
        {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
          onProxiesCleared={(deleted) => projectRef.current.media.forEach((m) => {
            if (m.lightProxy && deleted.includes(m.lightProxy)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { lightProxy: null } });
            if (m.proxies) {
              const proxies = Object.fromEntries(Object.entries(m.proxies).map(([k, v]) => [k, deleted.includes(v) ? null : v]));
              if (JSON.stringify(proxies) !== JSON.stringify(m.proxies)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { proxies } });
            }
          })} />}
        {closeAsk && <CloseDialog name={closeAsk.name} onChoice={closeAsk.resolve} />}
        {keystrokesOn && <KeystrokesOverlay />}
      </div>
    );
  }

  return (
    <div className={`app ${dragOver ? 'drag-over' : ''}`} style={{ gridTemplateRows: `48px minmax(0, 1fr) ${panes.bottom}px` }}
      onDragOver={(e) => { e.preventDefault(); if (isFiles(e) && !isInternal(e)) setDragOver(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}>
      <TopBar project={project} dispatch={dispatch} onOpen={open} onSave={save} saveState={saveState} onHistory={() => setHistoryOpen(true)} onBridge={bridgeInfo.enabled ? () => setBridgeOpen(true) : null} bridgePending={bridgeInfo.pending} onExport={startExport} onExportAudio={(f) => exportAudio(f)} onExportProjectZip={exportProjectZip} onReframe={startReframe} onSettings={() => setSettingsOpen(true)}
        onHome={async () => { await flushAutosave(); refreshSlots(); setScreen('home'); }}
        onAbout={() => setAboutOpen(true)} updateReady={!!update?.newer} />

      <div className="workspace" style={{ gridTemplateColumns: `${effWidths.left}px minmax(0, 1fr) ${effWidths.right}px` }}>
        <div className="left-col">
        {!collapsed.left && <TopRail tab={tab} setTab={setTab} />}
        {collapsed.left ? (
          <button type="button" className="panel-rail" aria-label={t('app.showLeft')}
            title={`${t('app.showLeft')}${firstBinding(getCurrentKeymap(), 'toggleDock') ? ` (${firstBinding(getCurrentKeymap(), 'toggleDock')})` : ''}`}
            onClick={() => togglePanel('left')}><ChevronRight size={15} /><span>{t('app.panels')}</span></button>
        ) : (
        <LeftPanel tab={tab} setTab={setTab} media={project.media} dispatch={dispatch} time={time}
          onRelink={reopenRelink}
          onImport={importMedia} onAdd={addToTimeline} onAddAsOverlay={addAsOverlay} onLibraryAdd={libraryAdd} onStockAdd={stockAdd} onAddFile={addFile} stockKey={stockKey} onTtsAdd={ttsAdd} selectedText={selectedText} onOpenSettings={() => setSettingsOpen(true)}
          onNewBlackVideo={() => createMatte('#000000')} onNewMatte={() => setMatteDlg({ color: '#e5484d' })}
          onOpenSettings={() => setSettingsOpen(true)} onRemoveMedia={removeMedia} onRenameMedia={renameMedia} onDuplicateMedia={duplicateMedia} onRemoveMediaMany={removeMediaMany} onPeek={peek} peekId={peekId} onPeekAsset={peekAsset}
          recorder={recorder} onStartRecord={() => recorder.start(time)} onAddText={addText} onAddTextOver={addTextOver}
          onRecordScreen={() => { setPlaying(false); setScreenOpen(true); }}
          target={target} updateTarget={updateTarget} selectedCount={selectedPictures(project, selection).length}
          onSeek={seek} onSelect={select}
          onApplyLookToAll={(clip) => dispatch({ type: 'updateMany', updates: [
            ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
            ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
          ] })}
          clipSelected={selection?.track === 'video' || selection?.track === 'overlay'}
          onAddFreeEffect={(fx) => { const clipId = uid(); dispatch({ type: 'addEffectClip', clipId, fx, at: time }); setSelection({ track: 'effect', id: clipId }); }}
          project={project} captions={{ ...captions, run: runCaptions }} />
        )}
        </div>
        <Preview project={cropPreviewProject} editProject={project} selection={selection} onSelect={select} dispatch={dispatch} time={time} seekVer={seekVer} playing={playing} duration={duration}
          onTime={setTime} onEnd={() => setPlaying(false)} onTogglePlay={togglePlay} onSeek={seek} onDropItem={dropOnPreview}
          onMatchSequence={matchSequenceToClip}
          peek={project.media.find((m) => m.id === peekId) || assetPeek} onClosePeek={() => { setPeekId(null); setAssetPeek(null); }}
          onAddPeek={(m) => { setPeekId(null); setAssetPeek(null); if (m && m.assetPath) addFile(m.assetPath, m.assetWhere || 'main'); else if (m) addToTimeline(m.id); }}
          quality={quality} onQualityChange={async (q) => { const st = await window.api.qualitySet(q); setPlaybackQuality(st.quality); setQuality(st.quality); }}
          perfMode={perfMode} onPerfToggle={async (on) => {
            // Performance mode is the persisted Low-End bundle (main: quality
            // floor, visuals concurrency, export priority, lite visuals).
            // Toggling off returns to Balanced and restores the playback
            // quality the toggle replaced.
            if (on) {
              prePerfQuality.current = quality;
              const st = await window.api.perfSetMode('low-end');
              setPerfMode(st.mode); setPlaybackQuality(st.quality); setQuality(st.quality);
            } else {
              const st = await window.api.perfSetMode('balanced');
              setPerfMode(st.mode);
              const back = prePerfQuality.current;
              prePerfQuality.current = null;
              if (back && back !== st.quality) {
                const st2 = await window.api.qualitySet(back);
                setPlaybackQuality(st2.quality); setQuality(st2.quality);
              }
            }
          }}
          clockRef={clockRef}
          trackPick={trackPick} onTrackPoint={(point) => setTrackPick((p) => (p ? { ...p, point } : p))}
          cropEdit={cropEdit} onCropDraft={setCropDraft}
          colorPick={colorPick} onColorPicked={finishColorPick} />
        {collapsed.right ? (
          <button type="button" className="panel-rail" aria-label={t('app.showProps')}
            title={`${t('app.showProps')}${firstBinding(getCurrentKeymap(), 'toggleInspector') ? ` (${firstBinding(getCurrentKeymap(), 'toggleInspector')})` : ''}`}
            onClick={() => togglePanel('right')}><ChevronLeft size={15} /><span>{t('app.properties')}</span></button>
        ) : (
        <Inspector project={project} selection={selection} dispatch={dispatch} duration={duration} time={time} onSeek={seek}
          onAddTextOver={addTextOver}
          onEnhance={(strength) => selection && enhanceClip({ track: selection.track, id: selection.id }, strength)}
          onTrackPick={(sel) => startTrackPick(sel)} onCropEdit={(sel) => startCropEdit(sel)} onColorPick={(sel) => startColorPick(sel)} />
        )}
        {!collapsed.left && <Splitter which="left" style={{ left: panes.left }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label={t('layout.resizeLeft')} />}
        {!collapsed.right && <Splitter which="right" style={{ right: panes.right }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label={t('layout.resizeProps')} />}
        {!collapsed.left && (
          <button type="button" className="panel-hide-btn" style={{ left: panes.left - 30 }} aria-label={t('app.hideLeft')}
            title={`${t('app.hideLeft')}${firstBinding(getCurrentKeymap(), 'toggleDock') ? ` (${firstBinding(getCurrentKeymap(), 'toggleDock')})` : ''}`}
            onClick={() => togglePanel('left')}><ChevronLeft size={14} /></button>
        )}
        {!collapsed.right && (
          <button type="button" className="panel-hide-btn" style={{ right: panes.right - 30 }} aria-label={t('app.hideProps')}
            title={`${t('app.hideProps')}${firstBinding(getCurrentKeymap(), 'toggleInspector') ? ` (${firstBinding(getCurrentKeymap(), 'toggleInspector')})` : ''}`}
            onClick={() => togglePanel('right')}><ChevronRight size={14} /></button>
        )}
      </div>
      <Splitter which="bottom" style={{ bottom: panes.bottom + 6 }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label={t('layout.resizeTimeline')} />

      <Timeline project={project} time={time} duration={duration} selection={selection} clockRef={clockRef} playing={playing}
        onSelect={select} onSeek={seek} dispatch={dispatch}
        onDetach={() => detachAudio()} detachOk={detachOk} linkMode={linkMode}
        onLinkToggle={() => (linkMode === 'unlink' ? unlinkClip() : linkPair())}
        onSplit={split} onDelete={remove} onDuplicate={duplicate}
        onDetectBeats={startBeatDetect} onSplitBeats={splitAtBeats}
        silenceMarks={silenceAsk ? { id: silenceAsk.id, ranges: silenceAsk.ranges } : null}
        tool={tool} setTool={setTool} onTrimSide={trimSide} onMarker={toggleMarker} recorder={recorder} onToggleRecord={toggleRecording}
        onDropItem={dropItem} onDropFiles={dropFiles} canUndo={!!state.past.length} canRedo={!!state.future.length} onClipMenu={openClipMenu} onAddText={addText}
        onScrubStart={() => setPlaying(false)} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
      {speedAsk && (() => {
        const c = findClip(project, speedAsk);
        if (!c) return null;
        const m = c.mediaId && project.media.find((x) => x.id === c.mediaId);
        return (
          <SpeedDialog clip={c} name={m?.name || 'Clip'} onClose={() => setSpeedAsk(null)}
            onApply={(speed) => dispatch({ type: 'update', track: speedAsk.track, id: speedAsk.id, patch: { speed } })} />
        );
      })()}

      {(screenOpen || screenRec.active || screenRec.notice) && <ScreenRecordDialog rec={screenRec} at={time} onClose={() => setScreenOpen(false)} />}
      {enhanceDlg && <EnhanceDialog name={enhanceDlg.media?.name} onStart={startEnhance} onClose={() => setEnhanceDlg(null)} />}
      {recoveredNote && (
        <div className="recovered-note" role="status">
          <b>{t('app.crashNote')}</b>{t('app.crashNote2')}
          <button className="btn btn-sm" onClick={() => window.api.openCrashLog()}>{t('app.showCrashLog')}</button>
          <button className="icon-btn" aria-label={t('common.close')} onClick={() => setRecoveredNote(false)}>×</button>
        </div>
      )}
      {fileNote && (
        <div className="recovered-note" role="status">
          <span>{fileNote}</span>
          <button className="icon-btn" aria-label={t('common.close')} onClick={() => setFileNote(null)}>×</button>
        </div>
      )}
      {relinkAsk && (
        <RelinkDialog items={relinkAsk.items} onApply={applyRelink} onClose={() => setRelinkAsk(null)}
          context={relinkAsk.after ? 'export' : undefined} closeLabel={relinkAsk.after ? 'Cancel export' : undefined} />
      )}
      {historyOpen && project?.id && (
        <HistoryDialog projectId={project.id} projectName={project.name}
          onRestore={restoreVersion} onClose={() => setHistoryOpen(false)} />
      )}
      {bridgeOpen && project?.id && (
        <BridgeDialog projectId={project.id} projectName={project.name}
          onAccept={acceptBridgeDraft} onDiscard={discardBridgeDraft} onClose={() => setBridgeOpen(false)} />
      )}
      {unsavedNote && !recoveredNote && (
        <div className="recovered-note" role="status">
          <span><b>{t('app.unsavedTitle')}</b>{t('app.unsavedNote', { when: new Date(unsavedNote.savedAt).toLocaleString(NUM_LOCALES[getLanguage()] || 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
          <button className="btn btn-primary btn-sm" onClick={restoreUnsaved}>{t('app.restore')}</button>
          <button className="btn btn-sm" onClick={discardUnsaved}>{t('app.discard')}</button>
        </div>
      )}
            {!updateSeen && !aboutOpen && <UpdateNotice update={update} onDismiss={() => setUpdateSeen(true)} />}
      {aboutOpen && <AboutDialog update={update} onUpdate={setUpdate} onClose={() => { setAboutOpen(false); setUpdateSeen(true); }}
        onWelcome={() => { setAboutOpen(false); setWelcomeOpen(true); }} />}
      {welcomeOpen && <WelcomeCard onClose={closeWelcome} />}
      {closeAsk && <CloseDialog name={closeAsk.name} onChoice={closeAsk.resolve} />}
      {seqAsk && <SequenceDialog media={seqAsk.media} mismatch={seqAsk.mismatch}
        onChangeSettings={() => resolveSeq(true)} onKeepSettings={() => resolveSeq(false)} />}
      {matteDlg && <ColorMatteDialog initialColor={matteDlg.color}
        onConfirm={(color) => { setMatteDlg(null); createMatte(color); }} onCancel={() => setMatteDlg(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
        onProxiesCleared={(deleted) => projectRef.current.media.forEach((m) => {
          if (m.lightProxy && deleted.includes(m.lightProxy)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { lightProxy: null } });
          if (m.proxies) {
            const proxies = Object.fromEntries(Object.entries(m.proxies).map(([k, v]) => [k, deleted.includes(v) ? null : v]));
            if (JSON.stringify(proxies) !== JSON.stringify(m.proxies)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { proxies } });
          }
        })} />}
      <CraftAI getProject={() => projectRef.current} getHistoryLength={() => historyRef.current.past.length}
        dispatch={dispatch} settle={settle} onOpenSettings={() => setSettingsOpen(true)} settingsVersion={settingsVersion}
        app={pilotApp} open={pilotOpen} onToggle={setPilotOpen} />
      {dragOver && <div className="drop-overlay"><div>{t('app.dropFiles')}</div></div>}
      {renderJob && (
        <div className="render-job" role="status">
          {renderJob.error ? (
            <><CircleAlert size={15} /><span>{renderJob.error}</span>
              <button className="btn btn-sm" onClick={() => setRenderJob(null)}>{t('app.dismiss')}</button></>
          ) : (
            <><Loader2 size={15} className="spin" /><span>{renderJob.label}</span>
              <div className="progress render-job-bar"><div style={{ width: `${Math.round((renderJob.fraction || 0) * 100)}%` }} /></div>
              <button className="btn btn-sm btn-ghost" onClick={() => (renderJob.kind === 'detach' ? window.api.detachCancel() : renderJob.kind === 'enhance' ? window.api.enhanceCancel() : renderJob.kind === 'track' ? window.api.trackCancel() : renderJob.kind === 'reframe' ? window.api.reframeCancel() : renderJob.kind === 'beats' ? window.api.beatsCancel() : renderJob.kind === 'scenes' ? window.api.scenesCancel() : renderJob.kind === 'silence' ? window.api.silenceCancel() : window.api.reverseCancel())}>{t('common.cancel')}</button></>
          )}
        </div>
      )}
      {trackPick && (
        <div className="render-job" role="status">
          <Crosshair size={15} />
          <span>{trackPick.point ? 'Point set — track it through the whole clip?' : 'Click the object on the player that you want to follow'}</span>
          <button className="btn btn-sm" disabled={!trackPick.point} onClick={runTrack}>{t('app.trackMotion')}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setTrackPick(null)}>{t('common.cancel')}</button>
        </div>
      )}
      {silenceAsk && (
        <div className="render-job" role="status">
          <AudioLines size={15} />
          <span>{silenceAsk.ranges.length} silence{silenceAsk.ranges.length === 1 ? '' : 's'} found ({silenceAsk.totalSec.toFixed(1)} s) — shown shaded on the clip. Remove {silenceAsk.ranges.length === 1 ? 'it' : 'them'} and close the gaps?</span>
          <button className="btn btn-sm" onClick={confirmSilenceRemoval}>{t('app.removeSilences')}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSilenceAsk(null)}>{t('common.cancel')}</button>
        </div>
      )}
      {cropEdit && (() => {
        const c = findClip(project, cropEdit);
        const cur = cropEdit.draftAspect || 'free';
        const rot = cropEdit.draftRot || 0;
        return (
          <div className="render-job crop-bar" role="status">
            <Crop size={15} />
            <span>Cropping{c ? ` “${project.media.find((m) => m.id === c.mediaId)?.name || 'clip'}”` : ''} — drag the frame's edges, or drag inside it to move it; what is dimmed gets cut. Nothing is applied until you confirm.</span>
            <span className="chips" role="group" aria-label={t('app.cropAspect')}>
              {CROP_ASPECTS.map((a) => (
                <button key={a.id} type="button" className={`chip ${cur === a.id ? 'on' : ''}`} aria-pressed={cur === a.id}
                  onClick={() => applyCropAspect(a.id)}>{a.label}</button>
              ))}
            </span>
            <span className="crop-rot" role="group" aria-label={t('app.rotateGroup')}>
              <RotateCw size={13} />
              <input type="range" min="-45" max="45" step="0.5" value={Math.min(45, Math.max(-45, rot))} aria-label={t('app.rotateDeg')}
                onChange={(e) => setCropRot(Number(e.target.value))} />
              <input type="number" className="crop-rot-num" min="-180" max="180" step="0.5" value={rot} aria-label={t('app.rotationDeg')}
                onChange={(e) => setCropRot(Number(e.target.value))} />
              <span className="crop-rot-val">{rot > 0 ? `+${rot}` : rot}°</span>
            </span>
            <button className="btn btn-sm" onClick={doneCropEdit}>{t('exp.done')}</button>
            <button className="btn btn-sm btn-ghost" onClick={cancelCropEdit}>{t('common.cancel')}</button>
          </div>
        );
      })()}
      {colorPick && (
        <div className="render-job" role="status">
          <Pipette size={15} />
          <span>{t('app.colorPickHint')}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setColorPick(null)}>{t('common.cancel')}</button>
        </div>
      )}
      {exporting && <ExportDialog state={exporting} onStart={confirmExport}
        onClose={() => setExporting(null)} onPickTarget={pickExportTarget}
        onRename={renameExport} onSettings={changeExportSettings} onResolution={changeExportResolution}
        onPosterAt={changePosterAt} />}
      <ExportJobsTray jobs={exportJobs} onCancelJob={cancelExportJob} onDismissJob={dismissExportJob}
        onShow={(file) => window.api.showInFolder(file)} onOpen={(file) => window.api.openFile(file)} />
      {jobToast && <div className="app-toast" role="status">{jobToast}</div>}
      {keystrokesOn && <KeystrokesOverlay />}
    </div>
  );
}

// Draggable border between panels (double-click: default size, arrow keys: move).
function Splitter({ which, style, onStart, onReset, onNudge, label }) {
  const vertical = which !== 'bottom';
  return (
    <div className={`splitter ${vertical ? 'col' : 'row'}`} style={style} role="separator" tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-label={label} title={`${label}\n${tr('layout.resizeHint')}`}
      onPointerDown={(e) => onStart(which, e)} onDoubleClick={() => onReset(which)} onKeyDown={(e) => onNudge(which, e)} />
  );
}
