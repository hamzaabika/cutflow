import React, { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  Anvil, ArrowLeftRight, Blend, Captions as CaptionsIcon, Contrast, Download, Film, Flag, FolderOpen, ImagePlus, Mic, Music, Plus, Scissors, SlidersHorizontal,
  Loader2, Sparkles, Square, Trash2, Type, Upload, WandSparkles, X, Copy, Palette, Pencil,
  Layers, Check, ChevronDown, ChevronRight, Sparkles as SparklesIcon, FolderPlus, MonitorUp, History, UserRound, Users,
  Languages, Sticker, SwatchBook, Unlink, Star } from '../icons.jsx';
import Card from '../ui/Card.jsx';
import BrandPanel from './BrandPanel.jsx';
// Forge + Composer are tab panels, not startup UI: they load on first open (P2-28).
const ComposerPanel = lazy(() => import('./ComposerPanel.jsx'));
const ForgePanel = lazy(() => import('./ForgePanel.jsx'));
import { useAssets } from '../useAssets.js';
import { mediaTreeCounts, mediaTreeFilter, mediaMatchesQuery, mediaTranscriptTexts, sortMedia } from '../assetsLib.js';
import { autoTags, buildMediaIndex, searchMediaIndex, loadMediaIndexPrefs, saveMediaIndexPrefs, deleteMediaIndex } from '../mediaIndex.js';
import { collectProjectSignals, recommendAssets, loadRecommendPrefs, saveRecommendPrefs, dismissRecommendation } from '../recommend.js';
import GradePanel from './GradePanel.jsx';
import AiBadge from './AiBadge.jsx';
import { badgeForProvider } from '../ai/badges.js';
import { LookThumb } from './FilterThumbs.jsx';
import { FILTER_CATS, filterName } from '../fx/filters.js';
import { loadPresets, savePresets, upsertPreset, removePreset, presetPatch } from '../fx/presets.js';
import {
  loadUserTemplates, saveUserTemplates, upsertUserTemplate, removeUserTemplate, userTemplatePatch,
  captureStylePatch, loadDefaultTemplateName, saveDefaultTemplateName,
} from '../text/userTemplates.js';
import { BUNDLED_LUTS } from '../fx/lut.js';
import { colourSpaceLabel } from '../colour.js';
import { loadLutLibrary, saveLutLibrary, addLutEntry, removeLutEntry } from '../fx/lutlib.js';
import { formatTime, getPlaybackQuality, layerCount, levelCopyState, previewPath, projectDuration, proxyPrefOn, toFileUrl, uid } from '../store.js';
import SourceMonitor from './SourceMonitor.jsx';
import { TRANSLATE_LANGS, langName, translationSources, translationStyle } from '../translate.js';
import { flatWords, rangesSeconds, retakeCutRanges, retakeGroups, selectionCutRanges, sentenceRange, silenceCutRanges, transcriptSentences, DEFAULT_CONFIDENCE_THRESHOLD, confidenceSummary, confidenceStats, lowConfidenceWords, proofreadSentences, speakerName, SPEAKER_IDS } from '../transcript.js';
import { correctCaptionClips } from '../captionCorrection.js';
import { correctClip } from '../captionCorrect.js';
import AiCostBadge from './AiCostBadge.jsx';
import { cloudCaptionFeature } from '../aiCost.js';
import { detectFillers } from '../fillers.js';
import { scoreFillerDetection, scoreRetakeCuts, scoreSilenceRanges } from '../aiCutConfidence.js';
import CutReviewDialog from './CutReviewDialog.jsx';
import CaptionProofreadDialog from './CaptionProofreadDialog.jsx';
import { COLLECTIONS, PACKS, COLLECTION_ITEMS, loadFavorites, saveFavorites, toggleFavorite } from '../fx/collections.js';
import { catalogCounts, catalogEntryBySlug, engineVariantCounts } from '../fx/transitionCatalog.js';

// FB-10: honest catalog numbers — 135 names, 45 real, 90 adapted, 41 distinct
// engine transitions used (of 119 in the engine). Computed once; the counts
// line in the Transitions tab renders these, never "135 unique algorithms".
const TR_COUNTS = catalogCounts();
const TR_VARIANT_COUNTS = engineVariantCounts();
// Status per catalog slug: the 135 catalog's status where the slug is in it,
// else the collection item's own status (§A extras / pack items).
const TR_STATUS_BY_SLUG = new Map(COLLECTION_ITEMS.map((e) => [e.slug, catalogEntryBySlug(e.slug)?.status || e.status]));
import { GRAPHIC_TEMPLATES } from '../graphics/catalog.js';
import { drawTextClip } from '../text/render.js';
import { fontsReady } from '../fonts.js';
import { parseSRT, regroupSegments, toSRT } from '../subtitles.js';
import { autoChapters, chaptersText } from '../chapters.js';
import { DEFAULT_ADJUST, EFFECTS, EFFECT_GROUPS, FILTERS, TRANSITIONS } from '../effects.js';
import { dragProps } from '../dnd.js';
import Slider from './Slider.jsx';
import SearchBox from './SearchBox.jsx';
import AudioLibrary, { MUSIC_TAGS, SFX_TAGS, SOUNDZA_TAGS, TROLL_TAGS } from './AudioLibrary.jsx';
import StockLibrary, { CHIPS as STOCK_CHIPS } from './StockLibrary.jsx';
import SideNav, { TabFrame } from './SideNav.jsx';
import ContextMenu from './ContextMenu.jsx';
import { FxThumb, samplePictureUrl, useFootageCanvas, useLiveThumbFrame } from '../fx/previews.jsx';
import { loadRecentEffects, recordRecentEffect } from '../fx/recentEffects.js';
import { effectUpdatesForSelection } from '../fx/applyToSelected.js';
import MediaFavorites from './MediaFavorites.jsx';
import { FavStar, favFile, useFavorites } from '../favorites.jsx';
import { TemplateGrid } from './TextInspector.jsx';
import { TEMPLATE_CATEGORIES, TEXT_TEMPLATES } from '../text/catalog.js';
import { STICKER_CATS, STICKERS } from '../stickers.js';
import { tr, useT } from '../i18n/index.jsx';
import { libName, slugifyPhrase, bestForName, libTr } from '../i18n/libNames.js';

// The workspace rail (R1): library categories in the order an edit flows —
// media in, sound, text and captions, then the look (effects, transitions,
// filters, adjust) — with the workspace-level tools (Brand kit, Forge) grouped
// under a divider. Every entry opens a real panel; surfaces Cutflow does not
// ship get no entry. (The project-Templates gallery was removed for good on
// 2026-11-10 at Hamza's order — no tab, no panel, no bundled packages.)
// Captions carries the transcript card: the transcript edits caption clips, so
// it lives in the Captions panel rather than behind a duplicate rail entry.
export const TABS = [
  { id: 'media', icon: Film, name: 'Media' },
  { id: 'audio', icon: Music, name: 'Audio' },
  { id: 'text', icon: Type, name: 'Text' },
  { id: 'captions', icon: CaptionsIcon, name: 'Captions' },
  { id: 'stickers', icon: Sticker, name: 'Stickers' },
  { id: 'effects', icon: WandSparkles, name: 'Effects' },
  { id: 'transitions', icon: Blend, name: 'Transitions' },
  { id: 'filters', icon: Contrast, name: 'Filters' },
  { id: 'adjust', icon: SlidersHorizontal, name: 'Adjust' },
  { id: 'composer', icon: Sparkles, name: 'Composer' },
  { sep: true },
  { id: 'brand', icon: SwatchBook, name: 'Brand' },
  { id: 'forge', icon: Anvil, name: 'Forge' },
];

// Default category of each tab (the side column remembers the last one per tab).
const SUB_DEFAULT = { media: 'yours', audio: 'music:Vlog', text: 'All' };

export default function LeftPanel(props) {
  const { tab } = props;
  // A stale tab id (e.g. from an older version's saved UI state) falls back to Media.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'media';
  const [sub, setSubState] = useState(SUB_DEFAULT);
  const setSub = (id) => setSubState((s) => ({ ...s, [activeTab]: id }));
  const p = { ...props, sub: sub[activeTab], setSub };
  // 10/10 step 5: the category rail moved to the top of the editor (TopRail,
  // under the titlebar); this panel is only the library the rail selects.
  // Tabs with a category column (effects, transitions, stickers,
  // filters, text, audio, media) render their own TabFrame with a SideNav;
  // the tool panels keep the plain frame.
  return (
    <aside className="left">
      <div className="library">
        {activeTab === 'media' && <MediaTab {...p} />}
        {activeTab === 'audio' && <AudioTab {...p} />}
        {activeTab === 'text' && <TextTab {...p} />}
        {activeTab === 'effects' && <EffectsTab {...p} />}
        {activeTab === 'transitions' && <TransitionsTab {...p} />}
        {activeTab === 'captions' && <TabFrame><CaptionsTab {...p} /></TabFrame>}
        {activeTab === 'stickers' && <StickersTab {...p} />}
        {activeTab === 'filters' && <FiltersTab {...p} />}
        {activeTab === 'adjust' && <TabFrame><AdjustTab {...p} /></TabFrame>}
        {activeTab === 'composer' && <TabFrame><Suspense fallback={null}><ComposerPanel {...p} /></Suspense></TabFrame>}
        {activeTab === 'brand' && <TabFrame><BrandPanel {...p} /></TabFrame>}
        {activeTab === 'forge' && <TabFrame><Suspense fallback={null}><ForgePanel {...p} /></Suspense></TabFrame>}
      </div>
    </aside>
  );
}


// Stickers (10/10 step 3): Cutflow's own drawn set, shipped in shared/stickers/ and
// listed from src/stickers.js (generated by scripts/gen-stickers.cjs). Clicking a
// sticker places it on the Sticker lane at the playhead; it then behaves like any
// free clip — drag, trim, transform and opacity in the inspector, exported in place.
// Stickers whose art is drawn in the set's dark ink (measured mean luminance
// of the shipped PNGs): on the panel's dark tiles they all but vanish, so
// their cells get a light halo treatment (.sticker-cell.dark in styles.css).
const DARK_STICKERS = new Set(['arrow-swoosh', 'frame-dashed', 'social-tv']);

function StickersTab({ dispatch, time }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [paths, setPaths] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      for (const st of STICKERS) out[st.id] = await window.api.bundledPath('stickers', st.file);
      if (live) setPaths(out);
    })();
    return () => { live = false; };
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = STICKERS.filter((st) => !needle || st.name.toLowerCase().includes(needle) || st.cat.toLowerCase().includes(needle));
  const add = (st) => dispatch({ type: 'addSticker', clipId: uid(), sticker: st.file, name: st.name, w: st.w, h: st.h, at: time || 0 });
  // Step 5: the shelves live in the category column (name + count), the grid
  // shows the picked shelf — 'All' stacks every shelf as before.
  const navItems = [
    { id: 'All', label: t('panel.stickers.all'), count: STICKERS.length },
    ...STICKER_CATS.map((c) => ({ id: c, label: libName('cat', slugifyPhrase(c), c), count: STICKERS.filter((s) => s.cat === c).length })),
  ];
  return (
    <TabFrame nav={<SideNav items={navItems} value={cat} onChange={setCat} label={t('panel.stickers.navLabel')} />}>
      <Head title={t('panel.stickers.titleCount', { n: STICKERS.length })} hint={t('panel.stickers.hint')} />
      <div className="panel-search panel-sticky"><SearchBox value={q} onChange={setQ} placeholder={t('panel.stickers.search')} ariaLabel={t('panel.stickers.search')} /></div>
      {!paths && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('panel.stickers.loading')}</div>}
      {paths && STICKER_CATS.filter((c) => cat === 'All' || c === cat).map((catName) => {
        const list = shown.filter((st) => st.cat === catName);
        if (!list.length) return null;
        return (
          <div key={catName} className="lib-group">
            <span className="lib-group-name pad-x">{libName('cat', slugifyPhrase(catName), catName)} · {list.length}</span>
            <div className="sticker-grid">
              {list.map((st) => (
                <button key={st.id} type="button" className={`sticker-cell ${DARK_STICKERS.has(st.id) ? 'dark' : ''}`} onClick={() => add(st)}
                  title={t('panel.stickers.addTitle', { name: libName('sticker', st.id, st.name) })} aria-label={t('panel.stickers.addAria', { name: libName('sticker', st.id, st.name) })}>
                  {paths[st.id] ? <img src={toFileUrl(paths[st.id])} alt="" draggable={false} /> : <span className="sticker-missing">?</span>}
                  <span>{libName('sticker', st.id, st.name)}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {paths && !shown.length && <p className="empty-note">{t('panel.stickers.none')}</p>}
    </TabFrame>
  );
}

function Head({ title, hint, children }) {
  return (
    <div className="lib-head">
      <div>
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// A media item. Click selects it and plays it in the player (then Delete removes it), double-click adds it to the
// timeline. Right-click opens the item menu (Rename / Duplicate / Delete).
function MediaCard({ m, onAdd, onRemove, onOverlay, onPeek, peeking, onRelink, selected, onSelectCard, onCardMenu, onDeleteCard, renaming, onRename, onRenameEnd, transcriptMatch }) {
  const t = useT();
  const lost = !!m.missing;
  // Gap-build C (CSV row 231): hover scrub — moving the pointer across a
  // video thumbnail scrubs through its filmstrip sprite (m.thumb, one frame
  // per thumbCount) and shows the time under the pointer. The poster still
  // shows at rest; the sprite only takes over while scrubbing.
  const [scrub, setScrub] = useState(null);
  const canScrub = m.type === 'video' && m.thumb && (m.thumbCount || 0) > 1 && Number(m.duration) > 0;
  const onScrubMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setScrub({ frame: Math.min(m.thumbCount - 1, Math.floor(frac * m.thumbCount)), time: frac * m.duration });
  };
  // One frame of the filmstrip sprite (poster not generated yet: the sprite
  // IS the thumbnail, showing its last frame; while scrubbing it shows the
  // frame under the pointer instead).
  const sprite = (frame) => (
    <div className="asset-sprite" style={{
      aspectRatio: `${m.thumbW || 16} / ${m.thumbH || 9}`,
      [(m.thumbW || 16) / (m.thumbH || 9) < 4 / 3 ? 'width' : 'height']: '100%',
      backgroundImage: `url("${toFileUrl(m.thumb)}")`,
      backgroundSize: `${m.thumbCount * 100}% 100%`,
      backgroundPosition: `${(frame / (m.thumbCount - 1)) * 100}% 0`,
    }} />
  );
  // Rename input: Escape must win over the blur commit below (unmounting a
  // focused input can still fire blur), so a cancelled rename never saves.
  const renameCancelled = useRef(false);
  useEffect(() => { if (renaming) renameCancelled.current = false; }, [renaming]);
  const onKeyDown = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    // Handled here so the timeline's Delete shortcut does not also remove the selected clip.
    // A selected card deletes the whole multi-selection; otherwise just itself.
    e.preventDefault();
    e.stopPropagation();
    if (onDeleteCard) onDeleteCard(m);
    else if (onRemove) onRemove(m.id);
  };
  return (
    <div className={`asset ${peeking ? 'peeking' : ''} ${lost ? 'lost' : ''} ${selected ? 'selected' : ''}`} tabIndex={0} data-sel-id={m.id} {...dragProps({ kind: 'media', id: m.id, mediaType: m.type })} onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target.closest('button') || e.target.closest('input')) return; if (lost && onRelink) { onRelink(m); return; } if (onSelectCard) onSelectCard(m, e); else if (onPeek) onPeek(m.id); }}
      onDoubleClick={() => (lost && onRelink ? onRelink(m) : onAdd(m.id))}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (onCardMenu) onCardMenu(m, e); }}
      title={lost ? t('panel.media.cardLost', { name: m.name }) : `${m.name}\n${onPeek ? t('panel.media.cardPeek') : ''}${t('panel.media.cardDrag')}${onRemove ? t('panel.media.cardDelete') : ''}`}>
      <div className="asset-thumb" onMouseMove={canScrub ? onScrubMove : undefined} onMouseLeave={canScrub ? () => setScrub(null) : undefined}>
        {lost ? (
          // Lost source (Part 3, 2026-11-10): the file is gone from disk, so
          // no thumbnail — cached or otherwise — stands in for it. The card
          // stays in the pool, red, and clicking it reopens the relink flow.
          <div className="asset-lost">
            <Unlink size={22} aria-hidden="true" />
            <span className="asset-lost-tag">{t('panel.media.lost')}</span>
            <span className="asset-lost-name">{m.name}</span>
          </div>
        ) : (<>
        {m.type === 'video' && (scrub != null ? sprite(scrub.frame) : m.poster ? (
          // W4b: the dedicated poster frame fills the card (object-fit: cover) — a portrait
          // video no longer renders as a thin strip in a wide black card.
          <img src={toFileUrl(m.poster)} alt="" draggable={false} />
        ) : m.thumb && m.thumbCount > 1 ? (
          // Sprite fallback (poster not generated yet): one frame, sized to COVER the
          // thumb box — the frame overflows on its long axis and the box crops it.
          sprite(m.thumbCount - 1)
        ) : <video src={toFileUrl(m.path) + '#t=0.5'} preload="metadata" muted />)}
        {m.type === 'image' && <img src={toFileUrl(m.path)} alt="" draggable={false} />}
        {m.type === 'audio' && (
          <div className="asset-audio">
            {m.wave ? <img src={toFileUrl(m.wave)} alt="" draggable={false} /> : <Music size={22} aria-hidden="true" />}
          </div>
        )}
        {m.type !== 'image' && <span className="asset-dur">{formatTime(m.duration).slice(0, 5)}</span>}
        {scrub != null && <span className="asset-scrub">{formatTime(scrub.time).slice(0, 5)}</span>}
        {m.vfr && <span className="asset-opt vfr" title={t('panel.media.vfrTitle')}>{t('panel.media.vfr')}</span>}
        {transcriptMatch && <span className="asset-opt transcript" title={t('panel.media.transcriptMatchTitle')}>{t('panel.media.transcriptMatch')}</span>}
        {colourSpaceLabel(m) && <span className="asset-opt colour" title={t('panel.media.colourTitle', { label: colourSpaceLabel(m) })}>{colourSpaceLabel(m)}</span>}
        {m.optimizing && <span className="asset-opt" title={t('panel.media.optimizingTitle')}>{t('panel.media.optimizing')}</span>}
        {!m.optimizing && proxyPrefOn() && previewPath(m) !== (m.proxy || m.path) && (
          <span className="asset-opt proxy" title={t('panel.media.proxyTitle')}>{t('panel.media.proxy')}</span>
        )}
        {!m.optimizing && m.proxyFailed && (
          <button className="asset-opt failed as-btn" title={t('panel.media.previewFailedTitle')}
            onClick={(e) => { e.stopPropagation(); window.api.ensureVisuals([{ path: m.path, type: m.type, duration: m.duration, hasAudio: m.hasAudio, width: m.width, height: m.height, proxy: m.proxy, lightProxy: m.lightProxy, proxies: m.proxies, remux: m.remux, container: m.container, vcodec: m.vcodec, pixFmt: m.pixFmt, hdr: m.hdr }], { force: true }); }}>
            {t('panel.media.previewFailed')}
          </button>
        )}
        {!m.optimizing && levelCopyState(m, getPlaybackQuality()) === 'failed' && (
          <span className="asset-opt failed" title={t('panel.media.proxyFailedTitle')}>{t('panel.media.proxyFailed')}</span>
        )}
        </>)}
        <button className="asset-add" onClick={() => onAdd(m.id)} aria-label={t('panel.media.addToTimeline', { name: m.name })}><Plus size={14} /></button>
        {onOverlay && m.type !== 'audio' && (
          <button className="asset-add overlay" onClick={() => onOverlay(m.id)} aria-label={t('panel.media.addAsOverlay', { name: m.name })}
            title={t('panel.media.addOverlayTitle')}><Layers size={13} /></button>
        )}
        {m.path && <FavStar entry={favFile(m)} className="asset-star" />}
        {onRemove && (
          <button className="asset-remove" onClick={() => onRemove(m.id)} aria-label={t('panel.media.remove', { name: m.name })} title={t('panel.media.removeTitle')}><Trash2 size={12} /></button>
        )}
      </div>
      {renaming ? (
        <input className="asset-rename" defaultValue={m.name} autoFocus
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { if (onRename) onRename(m.id, e.target.value); if (onRenameEnd) onRenameEnd(); }
            else if (e.key === 'Escape') { renameCancelled.current = true; if (onRenameEnd) onRenameEnd(); }
          }}
          onBlur={(e) => { if (!renameCancelled.current && onRename) onRename(m.id, e.target.value); if (onRenameEnd) onRenameEnd(); }} />
      ) : (
        <div className="asset-name">{m.name}</div>
      )}
    </div>
  );
}

// Intelligent asset recommendations (P3-10): the local P2-41 index ranked
// by the project's own signals (transcript words, timeline clip names,
// timeline media tags). Local only — no network — and each suggestion says
// why it was suggested. Dismissing one persists locally; the index itself is
// managed by the row above (off = no suggestions, delete = wipes it).
function Recommendations({ mediaIndex, project, visual, transcripts, dismissed, onAdd, onDismiss }) {
  const t = useT();
  const byId = useMemo(() => new Map(visual.map((m) => [m.id, m])), [visual]);
  const recs = useMemo(() => {
    if (!mediaIndex) return [];
    const signals = collectProjectSignals(project, byId, transcripts);
    return recommendAssets({ index: mediaIndex, items: visual, signals, dismissed, limit: 5 });
  }, [mediaIndex, project, byId, transcripts, visual, dismissed]);
  if (!recs.length) return null;
  const reasonText = (r) => {
    if (r.kind === 'transcript') return t('panel.media.reasonTranscript', { term: r.term });
    if (r.kind === 'clip') return t('panel.media.reasonClip', { clip: r.clip, term: r.term });
    if (r.kind === 'tag') return t('panel.media.reasonTag', { term: r.term });
    return t('panel.media.reasonName', { term: r.term });
  };
  return (
    <div className="media-recommend" data-testid="recommendations">
      <div className="media-recommend-title"><Sparkles size={13} /> {t('panel.media.recommendTitle')}</div>
      {recs.map((rec) => (
        <div key={rec.id} className="media-recommend-row">
          <button type="button" className="media-recommend-add" title={t('panel.media.recommendAdd')} onClick={() => onAdd(rec.item.id)}>
            <Plus size={13} /> <span className="media-recommend-name">{rec.item.name}</span>
            <span className="media-recommend-type">{rec.item.type}</span>
          </button>
          <span className="media-recommend-why" title={rec.reasons.map(reasonText).join(' · ')}>{rec.reasons.map(reasonText).join(' · ')}</span>
          <button type="button" className="media-recommend-dismiss" aria-label={t('panel.media.recommendDismiss')} title={t('panel.media.recommendDismiss')} onClick={() => onDismiss(rec.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MediaTab({ media, project, onImport, onAdd, onAddRange, onRemoveMedia, onRenameMedia, onDuplicateMedia, onRemoveMediaMany, onAddAsOverlay, onStockAdd, onAddFile, onOpenSettings, stockKey, sub, setSub, onRecordScreen, onPeek, peekId, onRelink, onNewBlackVideo, onNewMatte }) {
  const t = useT();
  const visual = media; // videos, photos and audio
  // One source switcher replaces the old second rail: Yours / Favorites / Stock live in a
  // segmented control at the top of the panel; Stock adds a kind switch + category chips.
  const [kind, chip] = sub.split(':');
  const view = sub === 'favorites' ? 'favorites' : (kind === 'video' || kind === 'photo') ? 'stock' : 'yours';
  const [lastStock, setLastStock] = useState('video:Trending');
  const goStock = (id) => { setLastStock(id); setSub(id); };
  // Filter chips over this project's media (P5 — they replace the old folder
  // tree): All / Video / Audio / Images / AI Generated, plus the Generated
  // sub-sources Speech and Processed as their own chips. Counts are computed
  // live from the registry (src/assetsLib.js); picking a chip filters the
  // grid below it for real (mediaTreeFilter).
  const [treeSel, setTreeSel] = useState('all');
  const counts = mediaTreeCounts(visual);
  // Media search (P1-47): the same SearchBox the other panels use, over the
  // chip-filtered list. Query matches name, extension, kind/origin tags and
  // any tags the item carries, plus spoken dialogue attributed from the
  // project's caption clips (assetsLib.mediaTranscriptTexts). Favorites-only
  // narrows to the starred files (the star on each card, same list as the
  // Favorites view). Search is a plain substring scan over the filtered list,
  // so it stays linear and allocation-light on big libraries.
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('added');
  const [favOnly, setFavOnly] = useState(false);
  const { has: isFav } = useFavorites();
  const transcripts = useMemo(
    () => mediaTranscriptTexts(project || { media: visual, textClips: [], videoClips: [], audioClips: [], overlayClips: [] }),
    [project, visual],
  );
  const chipFiltered = mediaTreeFilter(visual, treeSel);
  const favFiltered = favOnly ? chipFiltered.filter((m) => m.path && isFav(`file:${m.path}`)) : chipFiltered;
  // Semantic search (P2-41): when the index is on, a query ranks by
  // relevance (name > tags > spoken dialogue, Arabic-normalised) instead of
  // the plain substring scan; when it is off, the old scan runs unchanged.
  // The index is built in memory from the project's own media + transcripts
  // and rebuilds on every media/transcript change — nothing leaves the PC.
  const [indexPrefs, setIndexPrefs] = useState(() => loadMediaIndexPrefs(localStorage));
  const mediaIndex = useMemo(() => {
    if (!indexPrefs.enabled) return null;
    return buildMediaIndex(visual.map((m) => ({
      id: m.id, name: m.name, type: m.type,
      tags: autoTags(m, transcripts.get(m.id) || ''),
      transcript: transcripts.get(m.id) || '',
    })));
  }, [visual, transcripts, indexPrefs.enabled]);
  const setIndexEnabled = (on) => {
    setIndexPrefs((prev) => {
      const next = { ...prev, enabled: on };
      saveMediaIndexPrefs(localStorage, next);
      return next;
    });
  };
  const deleteIndex = () => setIndexPrefs(deleteMediaIndex(localStorage));
  // Recommendations (P3-10): on by default, dismissals persist locally.
  const [recPrefs, setRecPrefs] = useState(() => loadRecommendPrefs(localStorage));
  const setRecEnabled = (on) => {
    setRecPrefs((prev) => {
      const next = { ...prev, enabled: on };
      saveRecommendPrefs(localStorage, next);
      return next;
    });
  };
  const dismissRec = (id) => setRecPrefs(dismissRecommendation(localStorage, id));
  const byId = useMemo(() => new Map(visual.map((m) => [m.id, m])), [visual]);
  const ranked = useMemo(() => (mediaIndex && query.trim() ? searchMediaIndex(mediaIndex, query) : null), [mediaIndex, query]);
  const matched = ranked
    ? ranked.map((r) => ({ m: byId.get(r.id), match: true, viaTranscript: r.viaTranscript })).filter((r) => r.m && favFiltered.some((f) => f.id === r.m.id) && chipFiltered.some((f) => f.id === r.m.id))
    : favFiltered.map((m) => ({ m, ...mediaMatchesQuery(m, query, transcripts.get(m.id) || '') })).filter((r) => r.match);
  const transcriptHits = new Map(matched.filter((r) => r.viaTranscript).map((r) => [r.m.id, true]));
  const shownMedia = ranked ? matched.map((r) => r.m) : sortMedia(matched.map((r) => r.m), sort);
  const searching = !!query.trim() || favOnly;
  // Multi-select (checklist #14) + context menus (#9, #10): the selection
  // lives here, next to the grid it describes. Click still peeks (as before);
  // Ctrl/Cmd-click toggles one item, Shift-click ranges from the anchor,
  // Ctrl+A selects all shown, and dragging on empty grid space marquees.
  const [selIds, setSelIds] = useState(() => new Set());
  const anchorRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const gridRef = useRef(null);
  const marqueeRef = useRef(null);
  const [marquee, setMarquee] = useState(null);
  const selList = [...selIds];
  const selectCard = (m, e) => {
    if (e.ctrlKey || e.metaKey) {
      setSelIds((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; });
      anchorRef.current = m.id;
      return; // toggle only — the peeked card stays put
    }
    if (e.shiftKey && anchorRef.current) {
      const ids = shownMedia.map((x) => x.id);
      const a = ids.indexOf(anchorRef.current);
      const b = ids.indexOf(m.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelIds(new Set(ids.slice(lo, hi + 1)));
        if (onPeek) onPeek(m.id);
        return;
      }
    }
    anchorRef.current = m.id;
    setSelIds(new Set([m.id]));
    if (onPeek) onPeek(m.id);
  };
  const selectAllShown = () => { setSelIds(new Set(shownMedia.map((m) => m.id))); if (shownMedia.length) anchorRef.current = shownMedia[0].id; };
  const deleteCard = (m) => {
    if (selIds.has(m.id) && selIds.size > 1 && onRemoveMediaMany) onRemoveMediaMany(selList);
    else if (onRemoveMedia) onRemoveMedia(m.id);
  };
  const openCardMenu = (m, e) => {
    if (!selIds.has(m.id)) { anchorRef.current = m.id; setSelIds(new Set([m.id])); }
    const multi = selIds.has(m.id) && selIds.size > 1;
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: t('menu.mediaAdd'), icon: Plus, onClick: () => onAdd(m.id) },
      ...(onAddAsOverlay && m.type !== 'audio' ? [{ label: t('menu.mediaAddOverlay'), icon: Layers, onClick: () => onAddAsOverlay(m.id) }] : []),
      ...(m.missing && onRelink ? [{ label: t('menu.relink'), icon: Unlink, onClick: () => onRelink(m) }] : []),
      'sep',
      { label: t('menu.mediaRename'), icon: Pencil, onClick: () => setRenamingId(m.id) },
      { label: t('menu.duplicate'), icon: Copy, onClick: () => { if (onDuplicateMedia) onDuplicateMedia(m.id); } },
      { label: t('menu.deleteClip'), icon: Trash2, onClick: () => { if (multi && onRemoveMediaMany) onRemoveMediaMany(selList); else if (onRemoveMedia) onRemoveMedia(m.id); } },
    ] });
  };
  const openGridMenu = (e) => {
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: t('menu.mediaImport'), icon: Upload, onClick: () => onImport() },
      ...((onNewBlackVideo || onNewMatte) ? ['sep',
        ...(onNewBlackVideo ? [{ label: t('menu.newBlackVideo'), icon: Square, onClick: () => onNewBlackVideo() }] : []),
        ...(onNewMatte ? [{ label: t('menu.newMatte'), icon: Palette, onClick: () => onNewMatte() }] : []),
      ] : []),
      ...(shownMedia.length ? [{ label: t('menu.mediaSelectAll'), shortcut: 'Ctrl+A', onClick: () => selectAllShown() }] : []),
    ] });
  };
  const onGridKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAllShown(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selIds.size > 1 && onRemoveMediaMany) { e.preventDefault(); onRemoveMediaMany(selList); }
  };
  const onGridPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('.asset')) return;
    const grid = gridRef.current;
    if (!grid) return;
    const start = { x: e.clientX, y: e.clientY };
    marqueeRef.current = { ...start, active: false };
    const rect = grid.getBoundingClientRect();
    const move = (ev) => {
      const st = marqueeRef.current;
      if (!st) return;
      const dx = ev.clientX - st.x;
      const dy = ev.clientY - st.y;
      if (!st.active && Math.hypot(dx, dy) < 4) return;
      st.active = true;
      setMarquee({ left: Math.min(st.x, ev.clientX) - rect.left, top: Math.min(st.y, ev.clientY) - rect.top, width: Math.abs(dx), height: Math.abs(dy) });
      const box = { left: Math.min(st.x, ev.clientX), top: Math.min(st.y, ev.clientY), right: Math.max(st.x, ev.clientX), bottom: Math.max(st.y, ev.clientY) };
      const hits = [...grid.querySelectorAll('[data-sel-id]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
      }).map((el) => el.dataset.selId);
      setSelIds((prev) => { const next = new Set(ev.ctrlKey || ev.metaKey ? prev : []); for (const id of hits) next.add(id); return next; });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const st = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (st && !st.active) setSelIds(new Set()); // plain click on empty space clears
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const filterChips = [
    ['all', t('panel.media.filterAll'), counts.all], ['video', t('panel.media.filterVideo'), counts.video], ['audio', t('panel.media.filterAudio'), counts.audio],
    ['image', t('panel.media.filterImage'), counts.image], ['generated', t('panel.media.filterGenerated'), counts.generated],
    ['speech', t('panel.media.filterSpeech'), counts.speech], ['processed', t('panel.media.filterProcessed'), counts.processed],
  ];
  return (
    <TabFrame>
      {/* No panel heading (Hamza's UI review, 2026-11-10): the rail tab already
          says "Media", so the old MEDIA title + description only cost vertical
          space. The source tabs and the actions share one slim toolbar row. */}
      <div className="media-toolbar">
        <div className="src-seg seg-tabs" role="tablist" aria-label={t('panel.media.ariaSource')}>
          <button role="tab" aria-selected={view === 'yours'} className={view === 'yours' ? 'on' : ''} onClick={() => setSub('yours')}>{t('panel.media.thisProject')}</button>
          <button role="tab" aria-selected={view === 'favorites'} className={view === 'favorites' ? 'on' : ''} onClick={() => setSub('favorites')}>{t('panel.media.favorites')}</button>
          <button role="tab" aria-selected={view === 'stock'} className={view === 'stock' ? 'on' : ''} onClick={() => goStock(lastStock)}>{t('panel.media.stock')}</button>
        </div>
        <div className="head-btns">
          <button className="btn btn-sm" onClick={onRecordScreen} title={t('panel.media.recordTitle')}><MonitorUp size={14} /> {t('panel.media.record')}</button>
          <button className="btn btn-primary btn-sm" onClick={onImport}><Upload size={14} /> {t('panel.media.import')}</button>
        </div>
      </div>
      {view === 'stock' && (
        <div className="chips scroll-x src-chips" role="group" aria-label={t('panel.media.ariaStockCategory')}>
          {STOCK_CHIPS[kind].map(([c]) => (
            <button key={c} className={`chip ${chip === c ? 'on' : ''}`} aria-pressed={chip === c} onClick={() => goStock(`${kind}:${c}`)}>{c}</button>
          ))}
        </div>
      )}
      {view === 'yours' ? (
        !visual.length ? (
          <button className="dropzone" onClick={onImport}>
            <span className="dz-icon"><ImagePlus size={26} /></span>
            <b>{t('panel.media.dropTitle')}</b>
            <span>{t('panel.media.dropText')}</span>
          </button>
        ) : (
          <>
            <div className="panel-search panel-sticky media-search"><SearchBox value={query} onChange={setQuery} placeholder={t('panel.media.search')} ariaLabel={t('panel.media.searchAria')} /></div>
            {peekId && visual.find((m) => m.id === peekId) && (
              <SourceMonitor media={visual.find((m) => m.id === peekId)} onInsert={onAddRange || onAdd} onClose={() => onPeek(null)} />
            )}
            <div className="media-browse-row">
              <label className="media-sort-label">{t('panel.media.sort')}
                <select className="media-sort" value={sort} aria-label={t('panel.media.sortAria')} onChange={(e) => setSort(e.target.value)}>
                  <option value="added">{t('panel.media.sortAdded')}</option>
                  <option value="name">{t('panel.media.sortName')}</option>
                  <option value="duration">{t('panel.media.sortDuration')}</option>
                </select>
              </label>
              <button type="button" className={`chip media-fav-only ${favOnly ? 'on' : ''}`} aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)}>
                <Star size={12} fill={favOnly ? 'currentColor' : 'none'} /> {t('panel.media.favoritesOnly')}
              </button>
              {searching && <span className="media-count" role="status">{t('panel.media.results', { shown: shownMedia.length, total: chipFiltered.length })}{ranked ? ` · ${t('panel.media.indexRanked')}` : ''}</span>}
            </div>
            {/* Search index controls (P2-41): the offline index can be
                switched off (plain substring search) or deleted (its saved
                state is wiped; it rebuilds from the project). */}
            <div className="media-index-row">
              <span className="muted small">{t('panel.media.indexLabel')}</span>
              <button type="button" className={`chip ${indexPrefs.enabled ? 'on' : ''}`} aria-pressed={indexPrefs.enabled}
                title={indexPrefs.enabled ? t('panel.media.indexOn') : t('panel.media.indexOff')}
                onClick={() => setIndexEnabled(!indexPrefs.enabled)}>
                {indexPrefs.enabled ? t('panel.media.indexOn') : t('panel.media.indexOff')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" title={t('panel.media.indexDeleteTitle')} onClick={deleteIndex}>
                <Trash2 size={13} /> {t('panel.media.indexDelete')}
              </button>
              <button type="button" className={`chip ${recPrefs.enabled ? 'on' : ''}`} aria-pressed={recPrefs.enabled}
                title={recPrefs.enabled ? t('panel.media.recommendOn') : t('panel.media.recommendOff')}
                onClick={() => setRecEnabled(!recPrefs.enabled)}>
                {recPrefs.enabled ? t('panel.media.recommendOn') : t('panel.media.recommendOff')}
              </button>
            </div>
            {indexPrefs.enabled && recPrefs.enabled && (
              <Recommendations mediaIndex={mediaIndex} project={project} visual={visual} transcripts={transcripts}
                dismissed={recPrefs.dismissed} onAdd={onAdd} onDismiss={dismissRec} />
            )}
            <div className="chips scroll-x media-chips" role="group" aria-label={t('panel.media.ariaFilter')}>
              {filterChips.map(([id, label, n]) => (
                <button key={id} className={`chip ${treeSel === id ? 'on' : ''}`} aria-pressed={treeSel === id} onClick={() => setTreeSel(id)}>
                  {label} · {n}
                </button>
              ))}
            </div>
            {shownMedia.length ? (
              <div className="asset-grid" ref={gridRef} onPointerDown={onGridPointerDown} onKeyDown={onGridKeyDown} tabIndex={0}
                onContextMenu={(e) => { if (e.target.closest('.asset')) return; e.preventDefault(); openGridMenu(e); }}>
                {shownMedia.map((m) => <MediaCard key={m.id} m={m} onAdd={onAdd} onRemove={onRemoveMedia} onOverlay={onAddAsOverlay} onPeek={onPeek} peeking={peekId === m.id} onRelink={onRelink}
                  selected={selIds.has(m.id)} onSelectCard={selectCard} onCardMenu={openCardMenu} onDeleteCard={deleteCard} transcriptMatch={transcriptHits.has(m.id)}
                  renaming={renamingId === m.id} onRename={onRenameMedia} onRenameEnd={() => setRenamingId(null)} />)}
                {marquee && <div className="marquee" style={marquee} />}
              </div>
            ) : searching ? (
              <div className="empty-note media-empty-search" onContextMenu={(e) => { e.preventDefault(); openGridMenu(e); }}>
                <p>{query.trim()
                  ? t('panel.media.emptySearch', { q: query.trim() })
                  : t('panel.media.emptyFavFilter')}</p>
                <button type="button" className="btn btn-sm" onClick={() => { setQuery(''); setFavOnly(false); }}>{t('panel.media.clearSearch')}</button>
              </div>
            ) : (
              <p className="empty-note" onContextMenu={(e) => { e.preventDefault(); openGridMenu(e); }}>{treeSel === 'speech'
                ? t('panel.media.emptySpeech')
                : treeSel === 'processed'
                  ? t('panel.media.emptyProcessed')
                  : t('panel.media.emptyGeneric')}</p>
            )}
          </>
        )
      ) : view === 'favorites' ? (
        <div className="pad-block">
          <MediaFavorites onStockAdd={onStockAdd} onAddFile={onAddFile} />
        </div>
      ) : (
        <div className="pad-block">
          <StockLibrary kind={kind} chip={chip} onStockAdd={onStockAdd} onOpenSettings={onOpenSettings} hasKey={stockKey}
            onKindChange={(k) => goStock(`${k}:Trending`)} />
        </div>
      )}
      {view === 'yours' && <ProxyStatusLine media={visual} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </TabFrame>
  );
}

// Proxy status, always visible (P2-27): per-project preview-copy counts at the
// current playback quality plus the media-cache totals, polled from the same
// proxy:status the tray and Settings read. The tray's cache line only shows
// while a job runs and Settings is a dialog — this is the line a user checks
// at rest, in the panel where the per-clip Proxy/Failed badges already live.
function ProxyStatusLine({ media }) {
  const t = useT();
  const [cache, setCache] = useState(null);
  useEffect(() => {
    let dead = false;
    const poll = () => window.api.proxyStatus?.().then((st) => { if (!dead) setCache(st.mediaCache || null); }).catch(() => {});
    poll();
    const id = setInterval(poll, 5000);
    return () => { dead = true; clearInterval(id); };
  }, []);
  const videos = (media || []).filter((m) => m.type === 'video');
  if (!videos.length && !cache) return null;
  const q = getPlaybackQuality();
  const ready = videos.filter((m) => levelCopyState(m, q) === 'ready' || (q === 'full' && typeof m.proxy === 'string' && m.proxy)).length;
  const pending = videos.filter((m) => m.optimizing || levelCopyState(m, q) === 'fallback').length;
  const failed = videos.filter((m) => m.proxyFailed || levelCopyState(m, q) === 'failed').length;
  const mb = cache ? (cache.bytes / 1e6 >= 100 ? (cache.bytes / 1e6).toFixed(0) : (cache.bytes / 1e6).toFixed(1)) : null;
  return (
    <div className="proxy-status" role="status">
      <span>{t('panel.media.proxyStatus', { quality: t(`player.qualityShort.${q}`), ready, pending, failed })}</span>
      {cache && <span> · {t('tray.cacheLine', { files: cache.files, mb })}</span>}
    </div>
  );
}

function AudioTab(props) {
  const t = useT();
  const { sub, setSub } = props;
  // One audio surface: a source switcher (chips) on top, then the source's own category
  // chips — no second rail. Sub ids keep the exact values AudioLibrary routes on.
  const [group, subTag] = sub.includes(':') ? sub.split(':') : [sub, ''];
  const view = group === 'yours' && subTag === 'favorites' ? 'favorites' : group;
  const sources = [
    ['music', t('panel.audio.music')], ['sfx', t('panel.audio.sfx')], ['soundza', 'Soundza'], ['trolls', 'Trolls'], ['yours', t('panel.audio.yours')],
    ['favorites', t('panel.media.favorites')], ['tts', t('panel.audio.tts')], ['credits', t('panel.audio.credits')],
  ];
  const firstOf = { music: 'music:Vlog', sfx: 'sfx:Transition', soundza: 'soundza:Whoosh', trolls: 'trolls:Trending', yours: 'yours', favorites: 'yours:favorites', tts: 'tts', credits: 'credits' };
  // The asset pack's music collections lead the Music chips when the pack is installed
  // (sub ids 'music:pack:<collection>', routed by AudioLibrary to PackMusic).
  const lib = useAssets();
  const packSubs = lib ? [...new Set(lib.items.filter((i) => i.group === 'Music').map((i) => i.sub))]
    .sort((a, b) => (a === 'Library' ? -1 : b === 'Library' ? 1 : a.localeCompare(b))) : [];
  // The pack's sound effects lead the Sound FX chips (sub ids 'sfx:pack:<collection>',
  // routed by AudioLibrary to the pack list) — pack audio lives in Audio, with the
  // music, not in Assets (Hamza, 2026-11-01).
  const packSfxSubs = lib ? [...new Set(lib.items.filter((i) => i.group === 'Sound FX' && i.sub).map((i) => i.sub))] : [];
  const catChips = view === 'music' ? [...packSubs.map((s) => [`music:pack:${s}`, `${s}`]), ...MUSIC_TAGS.map(([c]) => [`music:${c}`, libName('mood', slugifyPhrase(c), c)])]
    : view === 'sfx' ? [...packSfxSubs.map((s) => [`sfx:pack:${s}`, `${s}`]), ...SFX_TAGS.map(([c]) => [`sfx:${c}`, libName('sfxtag', slugifyPhrase(c), c)])]
    : view === 'soundza' ? SOUNDZA_TAGS.map(([c]) => [`soundza:${c}`, libName('sztag', slugifyPhrase(c), c)])
    : view === 'trolls' ? TROLL_TAGS.map(([c]) => [`trolls:${c}`, c])
    : null;
  // Step 5: the sources move into the category column; the picked source's
  // own category chips stay in the content, above the library itself.
  const navItems = sources.map(([id, label]) => ({ id, label }));
  return (
    <TabFrame nav={<SideNav items={navItems} value={view} onChange={(id) => setSub(firstOf[id])} label={t('panel.audio.ariaSource')} />}>
      <Head title={t('panel.tab.audio')} hint={view === 'music' ? t('panel.audio.hintMusic') : view === 'sfx' ? t('panel.audio.hintSfx') : view === 'soundza' ? t('panel.audio.hintSoundza') : view === 'trolls' ? t('panel.audio.hintTrolls') : view === 'tts' ? t('panel.audio.hintTts') : view === 'credits' ? t('panel.audio.hintCredits') : view === 'favorites' ? t('panel.audio.hintFavorites') : t('panel.audio.hintYours')} />
      {catChips && (
        <div className="chips scroll-x src-chips" role="group" aria-label={t('panel.audio.ariaCategory')}>
          {catChips.map(([id, label]) => (
            <button key={id} className={`chip ${sub === id ? 'on' : ''}`} aria-pressed={sub === id} onClick={() => setSub(id)}>{label}</button>
          ))}
        </div>
      )}
      <div className="pad-block">
        <AudioLibrary {...props} section={sub} onAddMedia={props.onAdd} MediaCard={MediaCard} />
      </div>
    </TabFrame>
  );
}

function GraphicTile({ tpl }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(128 * dpr);
    cv.height = Math.round(72 * dpr);
    const ctx = cv.getContext('2d');
    let alive = true;
    fontsReady().then(() => {
      if (!alive) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(cv.width / 1280, 0, 0, cv.height / 720, 0, 0);
      // Mid-clip: in-animations done, time-driven graphics (ring, bar,
      // counter) half filled — the tile shows the motion, not just the end.
      const lt = tpl.duration / 2;
      for (const part of tpl.parts) {
        drawTextClip(ctx, { text: part.text ?? '', start: 0, duration: tpl.duration, y: 0.5, ...part.patch }, lt, 1280, 720);
      }
    });
    return () => { alive = false; };
  }, [tpl]);
  return <canvas ref={ref} style={{ width: 128, height: 72, display: 'block' }} aria-hidden="true" />;
}

function TextTab({ onAddText, onAddGraphic, sub, setSub }) {
  const t = useT();
  // Step 5: the template categories move into the category column (name +
  // count, the same counts the chips carried); the grid is unchanged.
  const navItems = TEMPLATE_CATEGORIES.map((c) => ({
    id: c, label: c === 'All' ? t('panel.text.all') : c === 'Favorites' ? t('panel.text.favorites') : libName('cat', slugifyPhrase(c), c),
    count: c === 'Favorites' ? undefined : (c === 'All' ? TEXT_TEMPLATES.length : TEXT_TEMPLATES.filter((t) => t.cat === c || (t.tags || []).includes(c)).length),
  }));
  return (
    <TabFrame nav={<SideNav items={navItems} value={sub} onChange={setSub} label={t('panel.text.categories')} />}>
      <Head title={sub === 'All' ? t('panel.text.templates') : libName('cat', slugifyPhrase(sub), sub)} hint={t('panel.text.hint')}>
        <button className="btn btn-primary btn-sm" onClick={() => onAddText({})}><Plus size={14} /> {t('panel.text.addText')}</button>
      </Head>
      <div className="pad-block">
        <TemplateGrid draggable category={sub} onPick={(t) => onAddText({ ...t.patch, template: t.id })} />
        {onAddGraphic && (
          <div className="lib-group">
            <span className="lib-group-name pad-x">Graphics · {GRAPHIC_TEMPLATES.length}</span>
            <div className="tpl-grid">
              {GRAPHIC_TEMPLATES.map((tpl) => (
                <div key={tpl.id} className="tpl-item">
                  <button className="tpl-btn" onClick={() => onAddGraphic(tpl.id)} title={`${tpl.name} — ${tpl.desc}`}>
                    <GraphicTile tpl={tpl} />
                  </button>
                  <span className="tpl-name">{tpl.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </TabFrame>
  );
}

function NeedClip({ target }) {
  const t = useT();
  if (target) return null;
  return <p className="hint">{t('panel.needClip')}</p>;
}

function EffectsTab({ target, updateTarget, clipSelected, onAddFreeEffect, onAddGradeLayer, onAddTextOver, project, selection, dispatch, selectedCount = 0, media, time }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  // FX-03: the tiles preview on the selected clip's own frame when one can
  // be grabbed; otherwise (no clip, audio, missing file) the sample pair.
  const live = useLiveThumbFrame(target, media, time);
  const fx = clipSelected ? target?.clip.effects || [] : [];
  const toggle = (id) => updateTarget({ effects: fx.includes(id) ? fx.filter((x) => x !== id) : [...fx, id] });
  // FB-28: recently-used effects (most recent first) + apply-to-all-selected.
  // The apply-to-all path runs through the ONE shared helper in
  // src/fx/applyToSelected.js (the Composer reuses it later) — one updateMany,
  // one undo step, clips that already have the effect untouched.
  const [recent, setRecent] = useState(() => loadRecentEffects());
  const [applyAll, setApplyAll] = useState(false);
  // FB-28: the tiles preview on the selected clip's own frame when one is
  // available, falling back to the stock-photo tiles when it is not.
  const footage = useFootageCanvas(live.on && clipSelected ? target?.clip?.id : null);
  const thumbSource = live.on ? (footage || live.frame) : null;
  const pick = (id) => {
    setRecent(recordRecentEffect(id));
    if (applyAll && selectedCount > 1 && clipSelected && target) {
      const updates = effectUpdatesForSelection(project, selection, id);
      if (updates.length) dispatch({ type: 'updateMany', updates });
      return;
    }
    return clipSelected && target ? toggle(id) : onAddFreeEffect(id);
  };
  const q = query.trim().toLowerCase();
  const groups = EFFECT_GROUPS.map((g) => [g, EFFECTS.filter((e) => e.group === g && (!q || e.name.toLowerCase().includes(q)))]).filter(([, list]) => list.length);
  // Step 5: groups move into the category column (name + count); the grid
  // shows the picked group, 'All' stacks them as before.
  const navItems = [
    { id: 'All', label: t('panel.effects.all'), count: EFFECTS.length },
    ...EFFECT_GROUPS.map((g) => ({ id: g, label: libName('cat', slugifyPhrase(g), g), count: EFFECTS.filter((e) => e.group === g).length })),
  ];
  const shownGroups = group === 'All' ? groups : groups.filter(([g]) => g === group);
  return (
    <TabFrame nav={<SideNav items={navItems} value={group} onChange={setGroup} label={t('panel.effects.ariaCategories')} />}>
      <Head title={t('panel.tab.effects')} hint={clipSelected ? t('panel.effects.hintSelected') : t('panel.effects.hintUnselected')} />
      <div className="panel-search panel-sticky"><SearchBox value={query} onChange={setQuery} placeholder={t('panel.effects.search')} ariaLabel={t('panel.effects.searchAria')} /></div>
      <p className="hint fx-mode">{clipSelected
        ? t('panel.effects.modeSelected')
        : t('panel.effects.modeFree')}</p>
      {clipSelected && selectedCount > 1 && (
        <div className="pad-x">
          <label className="field row">
            <span>{t('panel.effects.applyAll', { count: selectedCount })}</span>
            <input type="checkbox" checked={applyAll} aria-label={t('panel.effects.applyAll', { count: selectedCount })}
              onChange={(e) => setApplyAll(e.target.checked)} />
          </label>
        </div>
      )}
      {recent.length > 0 && (
        <div className="pad-x">
          <span className="lib-group-name">{t('panel.effects.recent')}</span>
          <div className="chips">
            {recent.map((id) => {
              const e = EFFECTS.find((x) => x.id === id);
              if (!e) return null;
              return (
                <button key={id} type="button" className={`chip ${fx.includes(id) ? 'on' : ''}`}
                  onClick={() => pick(id)} title={libName('fx', id, e.name)}>
                  {libName('fx', id, e.name)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {clipSelected && (
        <p className="hint pad-x">{thumbSource ? t('panel.effects.footageNote') : t('panel.effects.stockNote')}</p>
      )}
      {live.available && (
        <label className="pad-x fx-live-toggle" title={t('panel.effects.thumbMineHint')}>
          <input type="checkbox" checked={live.on} onChange={(e) => live.setOn(e.target.checked)} />
          {t('panel.effects.thumbMine')}
        </label>
      )}
      )}
      {!clipSelected && onAddGradeLayer && (
        <div className="pad-x">
          <button className="btn btn-sm" onClick={onAddGradeLayer} title={t('panel.effects.newLayerHint')}><Layers size={14} /> {t('panel.effects.newLayer')}</button>
        </div>
      )}
      {clipSelected && target && onAddTextOver && (
        <div className="pad-x">
          <button className="btn btn-sm" onClick={() => onAddTextOver(target.start, Math.max(0.1, target.end - target.start))}><Type size={14} /> {t('panel.effects.addTextOver')}</button>
        </div>
      )}
      {!shownGroups.length && <p className="hint pad-x">{t('panel.effects.none')}</p>}
      {shownGroups.map(([g, list]) => (
        <div key={g} className="fx-group">
          <span className="lib-group-name pad-x">{libName('cat', slugifyPhrase(g), g)} · {list.length}</span>
          <div className="tile-grid">
            {list.map((e) => (
              <button key={e.id} className={`tile ${fx.includes(e.id) ? 'on' : ''}`} onClick={() => pick(e.id)}
                aria-pressed={fx.includes(e.id)} {...dragProps({ kind: 'effect', id: e.id })}>
                <span className="tile-preview fx-live"><FxThumb kind="effect" id={e.id} source={thumbSource} /></span>
                <span className="tile-label">{libName('fx', e.id, e.name)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </TabFrame>
  );
}

function TransitionsTab({ target, updateTarget }) {
  const t = useT();
  const ok = target && target.index > 0;
  const cur = target?.clip.transition;
  const [dur, setDur] = useState(0.5);
  const [view, setView] = useState('catalog'); // 'catalog' (the 135 reference library) | 'classic'
  const [query, setQuery] = useState('');
  const [realOnly, setRealOnly] = useState(false); // FB-10: show only transitions the engine performs as named
  const [collection, setCollection] = useState('All'); // 'All' | 'fav' | a COLLECTIONS id
  const [favs, setFavs] = useState(() => loadFavorites());
  const toggleFav = (slug) => { const next = toggleFavorite(favs, slug); setFavs(next); saveFavorites(localStorage, next); };
  const engineById = Object.fromEntries(TRANSITIONS.map((t) => [t.id, t]));
  const applyEngine = (engineId, fxDuration) => {
    if (!ok) return;
    // Zoom/scale transitions feel best eased: new ones start on Smooth (the curve editor can change it).
    const ease = /zoom/i.test(engineId) ? { ease: 'smooth' } : {};
    updateTarget({ transition: { type: engineId, duration: fxDuration || dur, ...ease } });
  };
  // Localised tooltip parts for a catalog entry: engine display name and the
  // behaviour line (composed entries describe their engine; reference entries
  // carry their own behaviour text, translated per slug).
  const trEngine = (e) => libName('tr', e.engineId, libName('fx', e.engineId, e.engineName));
  const trBehavior = (e) => (e.slug.startsWith('xa-') || e.slug.startsWith('pk-')
    ? libTr(e.status === 'implemented' ? 'lib.trNative' : 'lib.trAdapted', { name: trEngine(e) })
    : libName('tr135d', e.slug, e.behavior));
  const tile = (key, engineId, label, extra) => (
    <button key={key} className={`tile ${cur?.type === engineId ? 'on' : ''}`} {...dragProps({ kind: 'transition', id: engineId, duration: engineById[engineId]?.fx ? engineById[engineId].duration : dur })}
      onClick={() => applyEngine(engineId, engineById[engineId]?.fx ? engineById[engineId].duration : null)} title={extra?.title || label}>
      <span className="tile-preview fx-live"><FxThumb kind="transition" id={engineId} pair={extra?.pair || 0} duration={engineById[engineId]?.fx ? engineById[engineId].duration : 0.8} /></span>
      <span className="tile-label">{label}</span>
      {extra?.slug && TR_STATUS_BY_SLUG.get(extra.slug) === 'adapted' && (
        <span className="tile-adapted">{t('panel.tr.adaptedBadge')}</span>
      )}
      {extra?.slug && TR_VARIANT_COUNTS[engineId] > 1 && (
        <span className="tile-variants">{t('panel.tr.variantCount', { n: TR_VARIANT_COUNTS[engineId] })}</span>
      )}
      {extra?.slug && (
        <span className={`tile-star ${favs.has(extra.slug) ? 'on' : ''}`} role="button" aria-label={favs.has(extra.slug) ? t('panel.tr.favRemove') : t('panel.tr.favAdd')}
          title={favs.has(extra.slug) ? t('panel.tr.favRemove') : t('panel.tr.favAdd')}
          onClick={(e) => { e.stopPropagation(); toggleFav(extra.slug); }}
          onPointerDown={(e) => e.stopPropagation()}>★</span>
      )}
    </button>
  );
  const q = query.trim().toLowerCase();
  const inSelection = (e) => (collection === 'All' ? true
    : collection === 'fav' ? favs.has(e.slug)
    : collection.startsWith('pack:') ? e.pack === collection.slice(5)
    : e.collection === collection);
  const catalogList = COLLECTION_ITEMS.filter((e) => inSelection(e)
    // FB-10: the 135 catalog carries the status; the §A extras and pack items
    // (outside the 135) carry their own status field — either way, real-only
    // keeps only transitions the engine performs as named.
    && (!realOnly || (catalogEntryBySlug(e.slug)?.status || e.status) === 'implemented')
    && (!q || e.name.toLowerCase().includes(q) || e.behavior.toLowerCase().includes(q) || e.family.toLowerCase().includes(q) || e.engineName.toLowerCase().includes(q)));
  // Step 5: the library switch and the collection chips move into the
  // category column — Catalog folds open over its collections and packs
  // (each with its count), Built-in is the plain engines list.
  const navItems = [
    {
      id: 'catalog', label: t('panel.tr.catalog'), count: COLLECTION_ITEMS.length,
      children: [
        { id: 'All', label: t('panel.tr.all'), count: COLLECTION_ITEMS.length },
        { id: 'fav', label: t('panel.tr.saved'), count: favs.size },
        ...COLLECTIONS.map((c) => ({ id: c.id, label: libName('coll', c.id, c.name), count: COLLECTION_ITEMS.filter((e) => e.collection === c.id).length })),
        ...PACKS.map((p) => ({ id: `pack:${p.id}`, label: t('panel.tr.packLabel', { name: libName('pack', p.id, p.name) }), count: COLLECTION_ITEMS.filter((e) => e.pack === p.id).length })),
      ],
    },
    { id: 'classic', label: t('panel.tr.builtIn'), count: TRANSITIONS.length },
  ];
  const navValue = view === 'classic' ? 'classic' : collection;
  const onNav = (v) => {
    if (v === 'classic') { setView('classic'); return; }
    setView('catalog');
    setCollection(v);
  };
  return (
    <TabFrame nav={<SideNav items={navItems} value={navValue} onChange={onNav} label={t('panel.tr.ariaCollections')} />}>
      <Head title={t('panel.tab.transitions')} hint={t('panel.tr.hint')} />
      {!ok && <p className="hint">{t('panel.tr.needSelect')}</p>}
      <div className="panel-sticky">
        <div className="field pad">
          <span>{t('panel.tr.duration')} <b>{dur.toFixed(1)}s</b></span>
          <input type="range" min="0.2" max="2" step="0.1" value={dur} onChange={(e) => {
            const d = Number(e.target.value);
            setDur(d);
            if (ok && cur) updateTarget({ transition: { ...cur, duration: d } });
          }} />
        </div>
        {view === 'catalog' && (
          <div className="field pad">
            <SearchBox placeholder={t('panel.tr.search', { n: COLLECTION_ITEMS.length })} value={query} onChange={setQuery} ariaLabel={t('panel.tr.searchAria')} />
          </div>
        )}
        {view === 'catalog' && (
          <div className="pad-x">
            <p className="hint">{t('panel.tr.counts', { entries: TR_COUNTS.entries, implemented: TR_COUNTS.implemented, adapted: TR_COUNTS.adapted, mapped: TR_COUNTS.mappedEngineIds })}</p>
            <label className="field row">
              <span title={t('panel.tr.realOnlyHint')}>{t('panel.tr.realOnly')}</span>
              <input type="checkbox" checked={realOnly} aria-label={t('panel.tr.realOnly')}
                onChange={(e) => setRealOnly(e.target.checked)} />
            </label>
          </div>
        )}
      </div>
      {view === 'classic' && (
        <div className="tile-grid">
          <button className={`tile ${ok && !cur ? 'on' : ''}`} onClick={() => ok && updateTarget({ transition: null })}>
            <span className="tile-preview"><X size={20} /></span>
            <span className="tile-label">{t('panel.tr.none')}</span>
          </button>
          {TRANSITIONS.map((t, i) => tile(t.id, t.id, libName('tr', t.id, t.name), { pair: i % 6 }))}
        </div>
      )}
      {view === 'catalog' && (
        <>
          {!catalogList.length && <p className="hint pad-x">{collection === 'fav' && !query ? t('panel.tr.emptyFav') : t('panel.tr.emptySearch')}</p>}
          {COLLECTIONS.filter((c) => collection === 'All' || collection === 'fav' || c.id === collection).map((c, ci) => {
            const list = catalogList.filter((e) => e.collection === c.id && (collection !== 'All' || !e.pack));
            if (!list.length) return null;
            return (
              <div key={c.id} className="fx-group">
                <span className="lib-group-name pad-x">{libName('coll', c.id, c.name)} · {list.length}</span>
                <div className="tile-grid">
                  {list.map((e, i) => tile(e.slug, e.engineId, libName('tr135', e.slug, e.name), {
                    slug: e.slug,
                    pair: (ci + i) % 6,
                    title: t('panel.tr.tileTitle', { behavior: trBehavior(e), bestFor: e.bestFor ? bestForName(e.bestFor) : '—', engine: trEngine(e) }),
                  }))}
                </div>
              </div>
            );
          })}
          {PACKS.filter((p) => collection === 'All' || collection === `pack:${p.id}`).map((p, pi) => {
            const list = catalogList.filter((e) => e.pack === p.id);
            if (!list.length) return null;
            return (
              <div key={p.id} className="fx-group">
                <span className="lib-group-name pad-x">{t('panel.tr.packLabel', { name: libName('pack', p.id, p.name) })} · {list.length}</span>
                <div className="tile-grid">
                  {list.map((e, i) => tile(e.slug, e.engineId, libName('tr135', e.slug, e.name), {
                    slug: e.slug,
                    pair: (pi + i + 2) % 6,
                    title: t('panel.tr.tileTitle', { behavior: trBehavior(e), bestFor: e.bestFor ? bestForName(e.bestFor) : '—', engine: trEngine(e) }),
                  }))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </TabFrame>
  );
}

const CAPTION_LANGS = [
  { id: 'auto', name: 'Auto-detect' }, { id: 'ar', name: 'Arabic (incl. Darija)' }, { id: 'fr', name: 'French' },
  { id: 'en', name: 'English' }, { id: 'es', name: 'Spanish' }, { id: 'de', name: 'German' }, { id: 'tr', name: 'Turkish' },
];

// Speech models, each downloaded on first use: base is quick; large-v3-turbo is much better at Arabic; darija is a
// Whisper medium trained on Moroccan Darija (Arabic only). Only the ones the app can download are listed.
const CAPTION_MODELS = [
  { id: 'base', name: 'Fast (base)', size: '150 MB' },
  { id: 'turbo', name: 'Accurate: Arabic (large-v3-turbo)', size: '575 MB' },
  { id: 'darija', name: 'Moroccan Darija (whisper-medium-darija)', size: '540 MB', arabicOnly: true },
];

// Transcript editing (v1.1.5): the captions read as one flowing transcript.
// Selecting words and cutting them cuts that stretch of the video itself —
// one cutRanges dispatch with text ripple, so the captions after the cut
// shift along with the picture and the whole edit is a single undo step.
// The silence finder runs the main process's detector over the main track's
// real audio mix (the same one the assistant uses) and lists what it found
// before anything is removed.
const TX_RENDER_CAP = 150; // sentences drawn at once; the rest is a note away

// P2: collapsible tool section — the Captions ▸ Transcript & AI sub-tab lists
// its tools as closed accordions instead of one endless scroll.
function Accordion({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="accordion">
      <button type="button" className="accordion-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className={open ? 'open' : ''} />
        <b>{title}</b>
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}

import { suggestBroll } from '../broll.js';

// AI-05 smart B-roll suggestions: what the speaker is saying names the
// B-roll — the local P2-41 index ranks the project's own library against
// each transcript sentence, and the best unused picture clip is offered as
// an overlay at that sentence. Local only; nothing is added automatically.
function BrollCard({ project, dispatch, onSeek }) {
  const t = useT();
  const [recPrefs, setRecPrefs] = useState(() => loadRecommendPrefs(localStorage));
  const [indexPrefs] = useState(() => loadMediaIndexPrefs(localStorage));
  const transcripts = useMemo(
    () => mediaTranscriptTexts(project || { media: project?.media || [], textClips: [], videoClips: [], audioClips: [], overlayClips: [] }),
    [project],
  );
  const visual = project?.media || [];
  const mediaIndex = useMemo(() => {
    if (!indexPrefs.enabled) return null;
    return buildMediaIndex(visual.map((m) => ({
      id: m.id, name: m.name, type: m.type,
      tags: autoTags(m, transcripts.get(m.id) || ''),
      transcript: transcripts.get(m.id) || '',
    })));
  }, [visual, transcripts, indexPrefs.enabled]);
  const suggestions = useMemo(
    () => (recPrefs.enabled ? suggestBroll({ project, index: mediaIndex, items: visual, dismissed: recPrefs.dismissed, limit: 8 }) : []),
    [project, mediaIndex, visual, recPrefs],
  );
  if (!suggestions.length) return null;
  return (
    <div className="card" data-testid="broll-suggestions">
      <div className="sub-panel-head">
        <b>{t('captions.brollTitle')}</b>
        <span className="muted small">{t('captions.brollLocal')}</span>
      </div>
      <p className="muted small">{t('captions.brollHelp')}</p>
      {suggestions.map((s) => (
        <div key={`${s.mediaId}@${s.start}`} className="media-recommend-row">
          <button type="button" className="media-recommend-add"
            title={t('captions.brollAdd', { name: s.name, time: formatTime(s.start) })}
            onClick={() => dispatch({ type: 'addOverlayClip', mediaId: s.mediaId, clipId: uid(), at: s.start })}>
            <Plus size={13} /> <span className="media-recommend-name">{s.name}</span>
            <span className="media-recommend-type">{formatTime(s.start)}</span>
          </button>
          <span className="media-recommend-why" title={s.reason.text}>{s.reason.text}</span>
          <button type="button" className="media-recommend-dismiss" aria-label={t('panel.media.recommendDismiss')}
            title={t('panel.media.recommendDismiss')}
            onClick={() => setRecPrefs(dismissRecommendation(localStorage, s.mediaId))}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function TranscriptCard({ project, dispatch, onSeek, onSelect }) {
  const t = useT();
  const sentences = transcriptSentences(project);
  const words = flatWords(sentences);
  const [sel, setSel] = useState(null); // { from, to } flat word indices
  const [moveSel, setMoveSel] = useState(false); // Sprint 10: pick a destination for the selection
  const anchor = useRef(null);
  // A selection only means something against the captions it was made on.
  useEffect(() => { setSel(null); setMoveSel(false); anchor.current = null; }, [project.textClips]);
  if (!sentences.length) {
    return (
      <Card className="tx-card">
        <b>{t('captions.transcriptTitle')}</b>
        <p className="muted">{t('captions.transcriptEmpty')}</p>
      </Card>
    );
  }
  const selRanges = sel ? selectionCutRanges(words, sel.from, sel.to) : [];
  const selSecs = rangesSeconds(selRanges);
  // P1-33 confidence: words below the project threshold are flagged (never
  // auto-fixed — the proofreader below only flags them for a human). Words
  // without a confidence score are unknown, never low-confidence.
  const threshold = project.transcript?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const lowWords = lowConfidenceWords(sentences, threshold);
  const lowSet = new Set(lowWords.map((w) => `${w.clipId}:${w.start}`));
  const confSummary = confidenceSummary(sentences);
  // AI-03: coverage stats for the same threshold (how many words carry a
  // score at all), and the review-list toggle. The threshold itself stays
  // the project setting above — no second local slider state.
  const confStats = confidenceStats(sentences, threshold);
  const [showLowConf, setShowLowConf] = useState(false);
  // P1-34 proofreading: deterministic rule-based corrections, applied only
  // when the user clicks Apply (one undo step via updateMany).
  const [proof, setProof] = useState(null);
  const applyProof = () => {
    if (!proof) return;
    const changed = proof.sentences.filter((s) => s.text !== (sentences.find((x) => x.clipId === s.clipId)?.text || ''));
    if (!changed.length) return;
    dispatch({ type: 'updateMany', updates: changed.map((s) => ({ track: 'text', id: s.clipId, patch: { text: s.text } })) });
    setProof(null);
  };
  const pickWord = (gi, w, e) => {
    if (e.shiftKey && anchor.current != null) setSel({ from: anchor.current, to: gi });
    else {
      anchor.current = gi;
      setSel({ from: gi, to: gi });
      onSeek?.(w.start);
      onSelect?.({ track: 'text', id: w.clipId });
    }
  };
  const cutSelection = () => {
    if (!selRanges.length) return;
    dispatch({ type: 'cutRanges', ranges: selRanges, rippleText: true });
    setSel(null);
    anchor.current = null;
  };
  // AI-04 caption correction: one click proofreads every caption clip
  // (rule-based, on-device, Darija kept as spoken) as a single undo step,
  // and reports how many fixes it made.
  const [correctNote, setCorrectNote] = useState('');
  const correctCaptions = () => {
    const updates = [];
    let fixes = 0;
    for (const c of project.textClips || []) {
      if (!c.caption) continue;
      const { patch, changes } = correctClip(c);
      if (patch) { updates.push({ track: 'text', id: c.id, patch }); fixes += changes.length; }
    }
    if (!updates.length) { setCorrectNote(t('captions.correctNone')); return; }
    dispatch({ type: 'updateMany', updates });
    setCorrectNote(t('captions.correctDone', { fixes, clips: updates.length }));
  };
  // Move (Sprint 10): the selection's ranges are lifted and re-inserted at
  // the chosen sentence — the store's moveRanges keeps the captions locked
  // to the picture, total duration unchanged, one undo step.
  const moveSelectionTo = (to) => {
    if (!selRanges.length) return;
    dispatch({ type: 'moveRanges', ranges: selRanges, to });
    setSel(null);
    setMoveSel(false);
    anchor.current = null;
  };
  const shown = sentences.slice(0, TX_RENDER_CAP);
  // Retake assistant (v1.1.7): repeated lines are grouped live from the same
  // sentences; each group suggests its last complete take as the keeper.
  const takeGroups = retakeGroups(sentences);
  const takeOf = new Map(); // sentenceIndex -> { group, takeNo, isKeep }
  takeGroups.forEach((g, gi2) => g.members.forEach((mi, ti) => takeOf.set(mi, { group: gi2, takeNo: ti + 1, takes: g.members.length, isKeep: mi === g.keep })));
  // FB-24: keeping a take opens the cut review (confidence per removed
  // take) instead of cutting blind; the dialog applies the accepted cuts.
  const [retakeReview, setRetakeReview] = useState(null);
  const keepTake = (g) => setRetakeReview({ cuts: scoreRetakeCuts(sentences, g), group: g });
  // FB-25: proofreading dialog (proper nouns, punctuation, timing, speakers).
  const [proofreadOpen, setProofreadOpen] = useState(false);
  let gi = -1;
  return (
    <div className="card tx-card">
      <div className="sub-panel-head">
        <b>{t('captions.transcriptTitle')}</b>
        <span className="muted small">{t(sentences.length > 1 ? 'captions.sentenceOther' : 'captions.sentenceOne', { n: sentences.length })}</span>
      </div>
      <p className="muted small">{t('captions.transcriptHelp')}</p>
      <div className="tx-quality">
        <label className="tx-threshold">
          <span>Confidence below <b>{Math.round(threshold * 100)}%</b> is flagged</span>
          <input type="range" min={0.5} max={0.95} step={0.05} value={threshold} aria-label="Confidence threshold"
            onChange={(e) => dispatch({ type: 'setTranscriptSettings', patch: { confidenceThreshold: Number(e.target.value) } })} />
        </label>
        <span className="muted small">
          {confSummary.words ? `${lowWords.length} of ${confSummary.words} words below ${Math.round(threshold * 100)}% (mean ${Math.round(confSummary.mean * 100)}%)` : 'No confidence scores on these words yet — they are unknown, not low-confidence.'}
        </span>
        <div className="tx-proof">
          <button type="button" className="btn btn-sm" onClick={() => setProof(proofreadSentences(sentences))}>Check text</button>
          {proof && (
            proof.corrections.length ? (
              <span className="small">{proof.corrections.length} fix{proof.corrections.length > 1 ? 'es' : ''} found ({[...new Set(proof.corrections.map((c) => c.rule))].join(', ')})
                <button type="button" className="btn btn-sm btn-primary" onClick={applyProof}>Apply all</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setProof(null)}>Dismiss</button>
              </span>
            ) : (
              <span className="small">No issues found.</span>
            )
          )}
        </div>
      </div>
      {/* AI-03 speaker labelling: names for the diarization ids (S1…S4).
          The per-sentence control below stays the free-text input — the
          live tests type a name into it, and the proofread dialog edits
          the same free-text value. */}
      <div className="tx-speakers" data-testid="tx-speakers">
        <span className="small"><b>{t('captions.speakers')}</b></span>
        {SPEAKER_IDS.map((id) => (
          <input key={id} type="text" className="tx-speaker-name" value={project.speakers?.[id] || ''}
            placeholder={speakerName(project, id)} aria-label={speakerName(project, id)}
            onChange={(e) => dispatch({ type: 'setProject', patch: { speakers: { ...(project.speakers || {}), [id]: e.target.value } }, transient: true })} />
        ))}
      </div>
      {confStats.withConf > 0 ? (
        <div className="tx-confidence" data-testid="tx-confidence">
          <span className="muted small">{t('captions.confStats', { avg: Math.round(confStats.avg * 100), low: confStats.low, withConf: confStats.withConf, total: confStats.total })}</span>
          <button type="button" className="btn btn-sm" disabled={!lowWords.length} onClick={() => setShowLowConf((v) => !v)}>
            {t('captions.reviewLowConf', { n: lowWords.length })}
          </button>
          {showLowConf && lowWords.length > 0 && (
            <ul className="tx-lowconf-list">
              {lowWords.slice(0, 30).map((w, i) => (
                <li key={i}><button type="button" onClick={() => { onSeek?.(w.start); onSelect?.({ track: 'text', id: w.clipId }); }}>
                  {w.text} <span className="muted">({Math.round(w.conf * 100)}% · {formatTime(w.start)})</span>
                </button></li>
              ))}
              {lowWords.length > 30 && <li className="muted small">{t('captions.lowConfMore', { n: lowWords.length - 30 })}</li>}
            </ul>
          )}
        </div>
      ) : (
        <p className="muted small">{t('captions.noConf')}</p>
      )}
      <div className="tx-body">
        {shown.map((s, si) => (
          <div key={s.clipId} className={`tx-sentence ${takeOf.has(si) ? 'tx-retake' : ''} ${takeOf.get(si)?.isKeep ? 'tx-retake-keep' : ''}`}>
            <button type="button" className="tx-time" title={t('captions.goSentence')}
              onClick={() => { onSeek?.(s.start); onSelect?.({ track: 'text', id: s.clipId }); }}>
              {formatTime(s.start)}
            </button>
            {/* P1-32 speaker label: free text, committed on blur (one undo step);
                never guessed — empty means unlabelled. (AI-03 offered an
                S1-S4 select here instead; the free-text input stays — the
                live tests type a name into it, and the proofread dialog
                edits the same free-text value. Diarization ids land on the
                clip via setCaptions and are named in the panel above.) */}
            <input className="tx-speaker" type="text" defaultValue={s.speaker || ''} placeholder="Speaker"
              aria-label={`Speaker for caption at ${formatTime(s.start)}`}
              onBlur={(e) => { if ((e.target.value || '') !== (s.speaker || '')) dispatch({ type: 'setCaptionSpeaker', clipId: s.clipId, speaker: e.target.value }); }} />
            <span className="tx-text" dir="auto">
              {s.words.map((w) => {
                gi += 1;
                const mine = gi;
                const on = sel && mine >= Math.min(sel.from, sel.to) && mine <= Math.max(sel.from, sel.to);
                const low = lowSet.has(`${s.clipId}:${w.start}`);
                return (
                  <span key={mine} className={`tx-word ${on ? 'on' : ''} ${low ? 'tx-word-low' : ''}`} title={low ? `Low confidence (${Math.round((w.conf ?? 0) * 100)}%)` : (Number.isFinite(w.conf) ? t('captions.wordConf', { pct: Math.round(w.conf * 100) }) : undefined)} onClick={(e) => pickWord(mine, w, e)}>
                    {w.text}{' '}
                  </span>
                );
              })}
            </span>
            <button type="button" className="tx-cut-sentence" title={t('captions.cutSentenceTitle')} aria-label={t('captions.cutSentence')}
              onClick={() => dispatch({ type: 'cutRanges', ranges: [sentenceRange(s)], rippleText: true })}>
              <Scissors size={12} />
            </button>
            {moveSel && (
              <button type="button" className="tx-move-here" title={t('captions.moveSentenceTitle')}
                onClick={() => moveSelectionTo(s.start)}>
                {t('captions.moveHere')}
              </button>
            )}
            {takeOf.has(si) && (
              <span className="tx-take-badge">{t('captions.takeOf', { n: takeOf.get(si).takeNo, total: takeOf.get(si).takes })}{takeOf.get(si).isKeep ? t('captions.takeSuggested') : ''}</span>
            )}
          </div>
        ))}
      </div>
      {sentences.length > TX_RENDER_CAP && <p className="muted small">{t('captions.showingFirst', { n: TX_RENDER_CAP })}</p>}
      <div className="tx-actions">
        <button className="btn btn-sm" onClick={() => setProofreadOpen(true)}>
          {t('proofread.open')}
        </button>
        <button className="btn btn-sm" disabled={!selRanges.length} onClick={cutSelection}>
          <Scissors size={14} /> {t('captions.cutSelected')}{selRanges.length ? t('captions.secsSuffix', { secs: selSecs.toFixed(1) }) : ''}
        </button>
        {!moveSel ? (
          <button className="btn btn-sm" disabled={!selRanges.length} onClick={() => setMoveSel(true)}>
            {t('captions.moveSelected')}{selRanges.length ? t('captions.secsSuffix', { secs: selSecs.toFixed(1) }) : ''}
          </button>
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => moveSelectionTo(projectDuration(project))}>{t('captions.moveToEnd')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setMoveSel(false)}>{t('captions.cancelMove')}</button>
          </>
        )}
        {sel && <button className="btn btn-sm btn-ghost" onClick={() => { setSel(null); anchor.current = null; }}>{t('captions.clearSelection')}</button>}
        <button className="btn btn-sm" onClick={correctCaptions}>{t('captions.correctCaptions')}</button>
      </div>
      {correctNote && <p className="muted small">{correctNote}</p>}
      {moveSel && <p className="muted small">{t('captions.moveHelp')}</p>}
      {takeGroups.length > 0 && (
        <div className="tx-retakes">
          <b className="small">{t('captions.retakes')}</b>
          <p className="muted small">{t('captions.retakeHelp')}</p>
          {takeGroups.map((g, n) => (
            <div key={n} className="tx-retake-row">
              <span>{t('captions.retakeRow', { from: g.members[0] + 1, to: g.members[g.members.length - 1] + 1, keep: g.keep + 1 })}</span>
              <button className="btn btn-sm" onClick={() => keepTake(g)}>
                <Scissors size={13} /> {t('captions.retakeKeep', { secs: rangesSeconds(retakeCutRanges(sentences, g)).toFixed(1) })}
              </button>
            </div>
          ))}
        </div>
      )}
      {retakeReview && (
        <CutReviewDialog title={t('cuts.reviewTitleRetakes')} cuts={retakeReview.cuts}
          onCancel={() => setRetakeReview(null)}
          onApply={(ranges) => { dispatch({ type: 'cutRanges', ranges, rippleText: true }); setRetakeReview(null); }} />
      )}
      {proofreadOpen && (
        <CaptionProofreadDialog project={project}
          onClose={() => setProofreadOpen(false)}
          onApply={(patches) => { dispatch({ type: 'proofreadCaptions', patches }); setProofreadOpen(false); }} />
      )}
    </div>
  );
}

// Silence removal (P2: extracted from the transcript card into its own
// accordion tool): runs the main process's detector over the main track's
// real audio mix and lists what it found before anything is removed.
function SilencesBlock({ project, dispatch }) {
  const t = useT();
  const [silDb, setSilDb] = useState(-35);
  const [silMin, setSilMin] = useState(0.4);
  const [silPad, setSilPad] = useState(0.1);
  const [sil, setSil] = useState(null); // { busy } | { list, ranges } | { error }
  // FB-24: the silence removal opens the cut review (confidence per span)
  // instead of cutting blind; the dialog applies the accepted cuts.
  const [silReview, setSilReview] = useState(null);
  const findSilences = async () => {
    setSil({ busy: true });
    const res = await window.api.agentSilences(project, { minDur: silMin, noiseDb: silDb });
    if (!res || !res.ok) { setSil({ error: (res && res.error) || t('captions.silDetectFail') }); return; }
    setSil({ list: res.silences, ranges: silenceCutRanges(res.silences, silPad, projectDuration(project)) });
  };
  const removeSilences = () => {
    if (!sil?.ranges?.length) return;
    setSilReview({ cuts: scoreSilenceRanges(sil.ranges, { minDur: silMin }) });
  };
  return (
    <div className="acc-tool">
      <label className="field">
        <span>{t('captions.silBelowPre')}<b>{silDb} dB</b>{t('captions.silBelowPost')}</span>
        <input type="range" min="-50" max="-25" step="1" value={silDb} aria-label={t('captions.silThresholdAria')}
          onChange={(e) => { setSilDb(Number(e.target.value)); setSil(null); }} />
      </label>
      <label className="field">
        <span>{t('captions.silShortestPre')}<b>{silMin.toFixed(1)} s</b></span>
        <input type="range" min="0.3" max="1.5" step="0.1" value={silMin} aria-label={t('captions.silMinAria')}
          onChange={(e) => { setSilMin(Number(e.target.value)); setSil(null); }} />
      </label>
      <label className="field">
        <span>{t('captions.silPadPre')}<b>{silPad.toFixed(2)} s</b>{t('captions.silPadPost')}</span>
        <input type="range" min="0" max="0.25" step="0.05" value={silPad} aria-label={t('captions.silPadAria')}
          onChange={(e) => { setSilPad(Number(e.target.value)); setSil(null); }} />
      </label>
      <button className="btn btn-sm" disabled={!!sil?.busy || !project.videoClips.length} onClick={findSilences}>
        {sil?.busy ? t('captions.listening') : t('captions.silFind')}
      </button>
      {sil?.error && <p className="error-text small">{sil.error}</p>}
      {sil?.list && (
        <>
          {sil.ranges.length ? (
            <>
              <div className="tx-sil-list">
                {sil.ranges.slice(0, 10).map((r, i) => (
                  <div key={i} className="tx-sil-row">
                    <span>{formatTime(r.start)} – {formatTime(r.end)}</span>
                    <span className="muted">{(r.end - r.start).toFixed(1)} s</span>
                  </div>
                ))}
                {sil.ranges.length > 10 && <p className="muted small">{t('captions.silMore', { n: sil.ranges.length - 10 })}</p>}
              </div>
              <button className="btn btn-sm btn-primary" onClick={removeSilences}>
                <Scissors size={14} /> {t(sil.ranges.length > 1 ? 'captions.removeSilencesOther' : 'captions.removeSilencesOne', { n: sil.ranges.length, secs: rangesSeconds(sil.ranges).toFixed(1) })}
              </button>
              {silReview && (
                <CutReviewDialog title={t('cuts.reviewTitleSilences')} cuts={silReview.cuts}
                  onCancel={() => setSilReview(null)}
                  onApply={(ranges) => { dispatch({ type: 'cutRanges', ranges, rippleText: true }); setSilReview(null); setSil(null); }} />
              )}
            </>
          ) : <p className="muted small">{t('captions.silNone')}</p>}
        </>
      )}
    </div>
  );
}

// Auto chapters (v1.1.11): chapters derived from the transcript's pauses —
// add them as timeline markers, or copy the YouTube description format.
function ChaptersBlock({ project, dispatch, sentences, bare }) {
  const t = useT();
  const [note, setNote] = useState('');
  const chapters = autoChapters(sentences);
  if (chapters.length < 2) return null;
  const fresh = chapters.filter((c) => !(project.markers || []).some((m) => Math.abs(m.time - c.time) < 0.5));
  const add = () => {
    dispatch({ type: 'addMarkers', markers: chapters.map((c) => ({ id: uid(), time: c.time, label: c.title })) });
    setNote(fresh.length === chapters.length
      ? t('captions.addedChapters', { n: chapters.length })
      : t('captions.addedChaptersPartial', { fresh: fresh.length, already: chapters.length - fresh.length }));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chaptersText(chapters));
      setNote(t('captions.copiedChapters'));
    } catch {
      setNote(t('captions.clipboardFail'));
    }
  };
  return (
    <div className={bare ? 'acc-tool' : 'tx-chapters'}>
      {!bare && <b className="small">{t('captions.chaptersTitle')}</b>}
      <p className="muted small">{t('captions.chaptersFound', { n: chapters.length })}</p>
      <div className="tx-actions">
        <button className="btn btn-sm" disabled={!fresh.length} onClick={add}>
          <Flag size={14} /> {fresh.length ? t('captions.addChapterMarkersN', { n: fresh.length }) : t('captions.addChapterMarkers')}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={copy}>{t('captions.copyChapters')}</button>
      </div>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

// SRT export (v1.1.11): write any caption set back out as a standalone .srt.
// Batch caption text editing (10/10 step 5): find & replace across a whole
// caption set at once — the fix-a-name-everywhere job that per-clip editing
// makes tedious. Literal, case-sensitive; the match count is computed from
// the same scope the store action will touch, and the replace is one undo.
function FindReplaceCard({ project, dispatch, bare }) {
  const t = useT();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [scope, setScope] = useState('all');
  const [note, setNote] = useState('');
  const inScope = (c) => (scope === 'srt' ? c.source === 'srt'
    : scope === 'captions' ? !!c.caption
    : scope === 'translation' ? c.source === 'translation'
    : c.source === 'srt' || !!c.caption || c.source === 'translation');
  const clips = project.textClips.filter(inScope);
  const matches = find ? clips.reduce((n, c) => n + (typeof c.text === 'string' ? c.text.split(find).length - 1 : 0), 0) : 0;
  const apply = () => {
    if (!matches) return;
    dispatch({ type: 'replaceCaptionText', find, replace, scope });
    setNote(t(matches === 1 ? 'captions.fr.replacedOne' : 'captions.fr.replacedOther', { n: matches }));
  };
  return (
    <div className={bare ? 'acc-tool' : 'card'}>
      {!bare && <b>{t('captions.fr.title')}</b>}
      <p className="muted">{t('captions.fr.desc')}</p>
      <div className="preset-save">
        <input type="text" value={find} placeholder={t('captions.findPh')} aria-label={t('captions.fr.ariaFind')}
          onChange={(e) => { setFind(e.target.value); setNote(''); }} />
        <input type="text" value={replace} placeholder={t('captions.fr.replacePh')} aria-label={t('captions.fr.ariaReplace')}
          onChange={(e) => setReplace(e.target.value)} />
      </div>
      <div className="preset-save">
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label={t('captions.ariaSetSearch')}>
          <option value="all">{t('captions.fr.scopeAll')}</option>
          <option value="captions">{t('captions.autoCaptions')}</option>
          <option value="srt">{t('captions.fr.scopeSrt')}</option>
          <option value="translation">{t('captions.fr.scopeTranslation')}</option>
        </select>
        <button className="btn btn-sm" disabled={!matches} onClick={apply}>
          {t('captions.fr.replaceAll')}{matches ? ` · ${matches}` : ''}
        </button>
      </div>
      {find && !matches && <p className="muted small">{t('captions.fr.noMatches')}</p>}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

// Caption proofreading (B-H-capcor): deterministic local rules over the
// caption clips — doubled spaces, repeated words, spacing before punctuation,
// sentence starts. Every change is previewed before anything is applied, and
// Apply is one updateMany dispatch, i.e. one undo step. The preview is
// re-derived from the live project at Apply time, so an edit made after
// Check can never apply a stale correction.
function CaptionProofreadCard({ project, dispatch, bare }) {
  const t = useT();
  const [result, setResult] = useState(null); // { clips, changes } | null
  const [note, setNote] = useState('');
  const count = (project.textClips || []).filter((c) => c.caption).length;
  const check = () => { setNote(''); setResult(correctCaptionClips(project.textClips)); };
  const apply = () => {
    const fresh = correctCaptionClips(project.textClips);
    if (!fresh.changes.length) return;
    const byId = new Map(fresh.clips.map((c) => [c.id, c]));
    dispatch({
      type: 'updateMany',
      updates: fresh.changes.map((ch) => {
        const c = byId.get(ch.id);
        return { track: 'text', id: ch.id, patch: { text: c.text, ...(c.words ? { words: c.words } : {}) } };
      }),
    });
    setNote(t('captions.proofreadApplied'));
    setResult(null);
  };
  return (
    <div className={bare ? 'acc-tool' : 'card'}>
      {!bare && <b>{t('captions.proofreadTitle')}</b>}
      <p className="muted">{t('captions.proofreadDesc')}</p>
      <button className="btn btn-sm" disabled={!count} onClick={check}>{t('captions.proofreadCheck')}{count ? ` · ${count}` : ''}</button>
      {result && !result.changes.length && <p className="muted small">{t('captions.proofreadNone')}</p>}
      {result && result.changes.length > 0 && (
        <>
          <p className="muted small">{t('captions.proofreadCount', { n: result.changes.length })}</p>
          <ul className="cap-proof-list">
            {result.changes.slice(0, 20).map((ch) => (
              <li key={ch.id}><span className="cap-proof-before">{ch.before}</span> → <span className="cap-proof-after">{ch.after}</span></li>
            ))}
          </ul>
          {result.changes.length > 20 && <p className="muted small">… +{result.changes.length - 20}</p>}
          <button className="btn btn-sm btn-primary" onClick={apply}>{t('captions.proofreadApply')}</button>
        </>
      )}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

// Filler-word removal (10/10 step 5): one click clears the ums, the يعني-s
// and the dead air between words from the generated captions — detection is
// src/fillers.js over the word timings, removal is the transcript editor's
// own cutRanges (text ripples, one undo step).
function FillerCard({ project, dispatch, bare }) {
  const t = useT();
  const [withFillers, setWithFillers] = useState(true);
  const [withPauses, setWithPauses] = useState(true);
  const [note, setNote] = useState('');
  // FB-24: filler removal opens the cut review (confidence per filler /
  // pause) instead of cutting blind; the dialog applies the accepted cuts.
  const [fillerReview, setFillerReview] = useState(null);
  const hasWords = project.textClips.some((c) => c.caption && c.words && c.words.length);
  const found = hasWords ? detectFillers(project, { fillers: withFillers, pauses: withPauses }) : { ranges: [], details: [], fillerCount: 0, pauseCount: 0 };
  const remove = () => {
    if (!found.ranges.length) return;
    setFillerReview({ cuts: scoreFillerDetection(found, { minPause: 0.7 }) });
  };
  return (
    <div className={bare ? 'acc-tool' : 'card'}>
      {!bare && <b>{t('captions.fillerTitle')}</b>}
      <p className="muted">{t('captions.fillerDesc')}</p>
      {!hasWords && <p className="muted small">{t('captions.fillerNeed')}</p>}
      {hasWords && (
        <>
          <div className="preset-save">
            <label className="check-row"><input type="checkbox" checked={withFillers} onChange={(e) => { setWithFillers(e.target.checked); setNote(''); }} /> {t('captions.fillerWords')}{withFillers ? ` · ${found.fillerCount}` : ''}</label>
            <label className="check-row"><input type="checkbox" checked={withPauses} onChange={(e) => { setWithPauses(e.target.checked); setNote(''); }} /> {t('captions.longPauses')}{withPauses ? ` · ${found.pauseCount}` : ''}</label>
          </div>
          <button className="btn btn-sm" disabled={!found.ranges.length} onClick={remove}>
            {found.ranges.length ? t(found.ranges.length === 1 ? 'captions.removeRangesOne' : 'captions.removeRangesOther', { n: found.ranges.length }) : t('common.remove')}
          </button>
          {!found.ranges.length && <p className="muted small">{t('captions.fillerNothing')}</p>}
          {fillerReview && (
            <CutReviewDialog title={t('cuts.reviewTitleFillers')} cuts={fillerReview.cuts}
              onCancel={() => setFillerReview(null)}
              onApply={(ranges, accepted) => {
                dispatch({ type: 'cutRanges', ranges, rippleText: true });
                setNote(t(accepted.length === 1 ? 'captions.fillerRemovedOne' : 'captions.fillerRemovedOther', { n: accepted.length }));
                setFillerReview(null);
              }} />
          )}
        </>
      )}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

function SrtExportCard({ project }) {
  const t = useT();
  const sources = translationSources(project);
  const translations = project.textClips.filter((c) => c.source === 'translation').slice().sort((a, b) => a.start - b.start);
  const sets = [
    { id: 'auto', label: t('captions.setAuto', { n: sources.auto.length }), clips: sources.auto },
    { id: 'srt', label: t('captions.setSrt', { n: sources.srt.length }), clips: sources.srt },
    { id: 'translation', label: t('captions.setTranslation', { n: translations.length }), clips: translations },
    { id: 'all', label: t('captions.setAll', { n: sources.all.length + translations.length }), clips: [...sources.all, ...translations] },
  ];
  const [setId, setSetId] = useState('auto');
  const [note, setNote] = useState('');
  const set = sets.find((s) => s.id === setId) || sets[0];
  const save = async () => {
    if (!set.clips.length) return;
    const base = (project.name || 'captions').replace(/[\\/:*?"<>|]+/g, '').trim() || 'captions';
    const res = await window.api.saveTextFile({
      title: t('captions.exportDialogTitle'),
      defaultName: `${base}${setId === 'auto' ? '' : `-${setId}`}.srt`,
      content: toSRT(set.clips),
      filters: [{ name: t('captions.exportDialogFilter'), extensions: ['srt'] }],
    });
    if (res?.ok) setNote(t('captions.exportSaved', { n: set.clips.length, path: res.path }));
    else if (res?.error) setNote(res.error);
    else setNote('');
  };
  return (
    <div className="card">
      <b>{t('captions.exportSrtTitle')}</b>
      <p className="muted">{t('captions.exportSrtDesc')}</p>
      <div className="preset-save">
        <select value={setId} onChange={(e) => setSetId(e.target.value)} aria-label={t('captions.ariaSetExport')}>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="btn btn-sm" disabled={!set.clips.length} onClick={save}><Download size={14} /> {t('captions.exportSrt')}</button>
      </div>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

// Caption translation (v1.1.10): send the caption lines to the AI provider
// configured in Settings; the translations come back as a NEW text layer
// with the original timings and styles, originals untouched.
function TranslateCard({ project, dispatch, bare }) {
  const t = useT();
  const sources = translationSources(project);
  const [src, setSrc] = useState('auto');
  const [lang, setLang] = useState('fr');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const clips = sources[src] || [];
  const existing = project.textClips.filter((c) => c.source === 'translation');

  useEffect(() => {
    if (!busy) return undefined;
    const off = window.api.onTranslateProgress((p) => setProgress(p));
    return off;
  }, [busy]);

  const run = async () => {
    if (!clips.length || busy) return;
    setBusy(true); setError(''); setNote(''); setProgress({ done: 0, total: clips.length });
    try {
      const res = await window.api.translateCaptions({ texts: clips.map((c) => c.text || ''), targetName: langName(lang) });
      if (res.canceled) { setNote(t('captions.translateCancelled')); return; }
      if (res.error) { setError(res.error); return; }
      if (!res.texts || res.texts.length !== clips.length) { setError(t('captions.translateUnexpected')); return; }
      const layer = layerCount(project, 'text');
      dispatch({
        type: 'addTranslatedCaptions',
        lang,
        layer,
        segments: clips.map((c, i) => ({
          id: uid(),
          text: res.texts[i],
          start: c.start,
          duration: c.duration,
          style: translationStyle(c),
        })),
      });
      setNote(t(clips.length > 1 ? 'captions.translateAddedOther' : 'captions.translateAddedOne', { n: clips.length, lang: langName(lang), layer: layer + 1 }));
    } catch (e) {
      setError(e.message || t('captions.translateFail'));
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  return (
    <div className={bare ? 'acc-tool' : 'card'}>
      {!bare && <b><Languages size={14} /> {t('captions.translateTitle')} <AiBadge kind={badgeForProvider(aiProvider)} /></b>}
      <p className="muted">{t('captions.translateDesc')}</p>
      <div className="preset-save">
        <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label={t('captions.ariaSetTranslate')} disabled={busy}>
          <option value="auto">{t('captions.setAuto', { n: sources.auto.length })}</option>
          <option value="srt">{t('captions.setSrt', { n: sources.srt.length })}</option>
          <option value="all">{t('captions.fr.scopeAll')} ({sources.all.length})</option>
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('captions.ariaTargetLang')} disabled={busy}>
          {TRANSLATE_LANGS.map((l) => <option key={l.code} value={l.code}>{t('translate.lang.' + l.code)}</option>)}
        </select>
      </div>
      {busy ? (
        <>
          <div className="progress"><div style={{ width: `${progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
          <p className="muted small">{progress ? t('captions.translateProgress', { done: progress.done, total: progress.total }) : t('captions.translateProgress', { done: 0, total: 0 })}</p>
          <button className="btn btn-ghost btn-sm" onClick={() => window.api.translateCancel()}>{t('common.cancel')}</button>
        </>
      ) : (
        <button className="btn btn-sm" disabled={!clips.length} onClick={run}>
          <Languages size={14} /> {clips.length ? t(clips.length > 1 ? 'captions.translateBtnOther' : 'captions.translateBtnOne', { n: clips.length, lang: langName(lang) }) : t('captions.translateTo', { lang: langName(lang) })}
        </button>
      )}
      {!clips.length && !busy && <p className="muted small">{t('captions.translateNeed')}</p>}
      {existing.length > 0 && <p className="muted small">{t(existing.length > 1 ? 'captions.translateExistingOther' : 'captions.translateExistingOne', { n: existing.length })}</p>}
      {error && <p className="muted small" role="alert">{error}</p>}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

function CaptionsTab({ onAddText, captions, project, dispatch, onSeek, onSelect }) {
  const t = useT();
  const [lang, setLang] = useState('auto');
  const [model, setModel] = useState('base');
  // Cloud engines (item O): the user's own provider key, saved through the same encrypted
  // service-key store as the stock/voice keys; never shown again after saving.
  const [engine, setEngine] = useState('local');
  const [provider, setProvider] = useState('groq');
  // AI-03: Deepgram diarization — label who is speaking per segment. Only
  // Deepgram offers it on this endpoint, so the checkbox only appears for
  // that provider; the flag rides through captions.run to the cloud call.
  const [diarize, setDiarize] = useState(false);
  const [cloudModel, setCloudModel] = useState('');
  const [keyField, setKeyField] = useState('');
  const [savedKeys, setSavedKeys] = useState({});
  const [keyNote, setKeyNote] = useState('');
  const [testNote, setTestNote] = useState(null);
  const [testing, setTesting] = useState(false);
  // P2: the panel is three sub-tabs now — Generate / Transcript & AI / Styles.
  const [capTab, setCapTab] = useState('generate');
  // A saved cloud key collapses to a one-line Connected state until Edit.
  const [keyEdit, setKeyEdit] = useState(false);
  // The FlowAI provider caption translation sends lines to (B-F14): the
  // translate badge follows it — local only when the provider is Ollama.
  const [aiProvider, setAiProvider] = useState('gemini');
  useEffect(() => {
    let live = true;
    window.api.settingsGet().then((st) => { if (live) { setSavedKeys(st.serviceKeys || {}); if (st.provider) setAiProvider(st.provider); } });
    return () => { live = false; };
  }, []);
  const CLOUD_PROVIDERS = [
    { id: 'groq', name: 'Groq', def: 'whisper-large-v3-turbo' },
    { id: 'openai', name: 'OpenAI', def: 'whisper-1' },
    { id: 'deepgram', name: 'Deepgram', def: 'nova-3' },
    { id: 'elevenlabs', name: 'ElevenLabs', def: 'scribe_v1' },
  ];
  const cloudMeta = CLOUD_PROVIDERS.find((p) => p.id === provider);
  const keyService = `cap-${provider}`;
  const savedHint = savedKeys[keyService];
  const saveKey = async () => {
    if (!keyField.trim()) return;
    const res = await window.api.settingsSaveServiceKey(keyService, keyField.trim());
    if (!res.ok) { setKeyNote(res.error || t('captions.keySaveFail')); return; }
    setSavedKeys(res.settings.serviceKeys || {});
    setKeyField('');
    setTestNote(null);
    setKeyEdit(false);
    setKeyNote(t('captions.keySavedNote'));
  };
  const testKey = async () => {
    setTesting(true);
    setTestNote(null);
    const res = await window.api.testCaptionsCloud(provider, keyField.trim() || undefined);
    setTesting(false);
    setTestNote(res.ok ? { ok: true, text: t('captions.testAccepted', { name: cloudMeta.name }) } : { ok: false, text: res.error || t('captions.testFail') });
  };
  const models = CAPTION_MODELS.filter((m) => !captions.available || captions.available.includes(m.id));
  const modelInfo = CAPTION_MODELS.find((m) => m.id === model);
  const needsDownload = !captions.models?.[model];
  const [source, setSource] = useState('all');
  const [tplId, setTplId] = useState('cap-classic');
  const tpl = TEXT_TEMPLATES.find((t) => t.id === tplId);
  const pickStyle = (t) => {
    setTplId(t.id);
    if (project.textClips.some((c) => c.caption)) dispatch({ type: 'styleCaptions', patch: { ...t.patch, template: t.id } });
  };
  const [len, setLen] = useState(42);
  // Words per caption line (0 = no limit, the historical behaviour). Applies to auto
  // captions when generating and to .srt imports below alike.
  const [wpl, setWpl] = useState(0);
  const count = project.textClips.filter((c) => c.caption).length;
  // Imported .srt subtitles: their own clips (source: 'srt'), styled separately from auto captions.
  const srtCount = project.textClips.filter((c) => c.source === 'srt').length;
  const srtFileRef = useRef(null);
  // User caption templates (src/text/userTemplates.js): styles saved from the
  // SRT captions, persisted in localStorage. srtTplId holds a built-in
  // template id, or `user:<name>` for one of these.
  const [userTpls, setUserTpls] = useState(() => loadUserTemplates(localStorage));
  const [tplName, setTplName] = useState('');
  const [defaultTplName, setDefaultTplName] = useState(() => loadDefaultTemplateName(localStorage));
  const [srtTplId, setSrtTplId] = useState(() => {
    const d = loadDefaultTemplateName(localStorage);
    return d && loadUserTemplates(localStorage).some((t) => t.name === d) ? `user:${d}` : 'cap-classic';
  });
  const [srtNote, setSrtNote] = useState('');
  const storeUserTpls = (list) => { setUserTpls(list); saveUserTemplates(localStorage, list); };
  const srtClip = project.textClips.find((c) => c.source === 'srt');
  const saveCurrentSrtStyle = () => {
    if (!srtClip || !tplName.trim()) return;
    storeUserTpls(upsertUserTemplate(userTpls, srtClip, tplName));
    setSrtTplId(`user:${tplName.trim()}`);
    setTplName('');
    setSrtNote(t('captions.savedStyleNote'));
  };
  const applyUserTpl = (t) => {
    setSrtTplId(`user:${t.name}`);
    dispatch({ type: 'styleSrtCaptions', patch: { ...userTemplatePatch(t), template: `user:${t.name}` } });
  };
  const deleteUserTpl = (t) => {
    storeUserTpls(removeUserTemplate(userTpls, t.name));
    if (defaultTplName === t.name) { setDefaultTplName(''); saveDefaultTemplateName(localStorage, ''); }
    if (srtTplId === `user:${t.name}`) setSrtTplId('cap-classic');
  };
  const makeDefaultTpl = (t) => {
    setDefaultTplName(t.name);
    saveDefaultTemplateName(localStorage, t.name);
    applyUserTpl(t);
  };
  const resolveSrtTemplate = () => {
    if (srtTplId.startsWith('user:')) {
      const t = userTpls.find((x) => x.name === srtTplId.slice(5));
      if (t) return { patch: userTemplatePatch(t), id: srtTplId };
    }
    const t = TEXT_TEMPLATES.find((x) => x.id === srtTplId) || tpl;
    return { patch: t.patch, id: t.id };
  };
  const onSrtFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const cues = regroupSegments(parseSRT(await f.text()), wpl);
    if (!cues.length) { setSrtNote(t('captions.importedNone')); return; }
    const tplDef = resolveSrtTemplate();
    dispatch({ type: 'importSrtCaptions', style: { ...tplDef.patch, template: tplDef.id }, segments: cues.map((c) => ({ ...c, id: uid() })) });
    setSrtNote(t(cues.length > 1 ? 'captions.importedOther' : 'captions.importedOne', { n: cues.length, file: f.name }));
  };
  const pickSrtStyle = (t) => {
    setSrtTplId(t.id);
    dispatch({ type: 'styleSrtCaptions', patch: { ...t.patch, template: t.id } });
  };
  // Full subtitle text panel: every subtitle clip (SRT imports and auto
  // captions) in timeline order, editable in place.
  const [subQuery, setSubQuery] = useState('');
  const subtitleClips = project.textClips
    .filter((c) => c.source === 'srt' || c.caption)
    .slice()
    .sort((a, b) => a.start - b.start);
  const subShown = subtitleClips.filter((c) => !subQuery.trim() || String(c.text || '').toLowerCase().includes(subQuery.trim().toLowerCase()));
  // For the Transcript & AI sub-tab: the Chapters accordion only exists when
  // the transcript actually yields chapters.
  const txSentences = transcriptSentences(project);
  const txChapters = autoChapters(txSentences);
  const busy = !!captions.busy;
  return (
    <>
      <Head title={t('panel.tab.captions')} hint={t('captions.headHint')} />
      <div className="seg-tabs cap-subtabs" role="tablist" aria-label={t('captions.ariaSections')}>
        <button type="button" role="tab" aria-selected={capTab === 'generate'} className={capTab === 'generate' ? 'on' : ''} onClick={() => setCapTab('generate')}>{t('captions.subGenerate')}</button>
        <button type="button" role="tab" aria-selected={capTab === 'transcript'} className={capTab === 'transcript' ? 'on' : ''} onClick={() => setCapTab('transcript')}>{t('captions.subTranscript')}</button>
        <button type="button" role="tab" aria-selected={capTab === 'styles'} className={capTab === 'styles' ? 'on' : ''} onClick={() => setCapTab('styles')}>{t('captions.subStyles')}</button>
      </div>
      {capTab === 'generate' && (
      <>
      <div className="card">
        <div className="card-row">
          <span className="card-icon accent"><Sparkles size={18} /></span>
          <div>
            <b>{t('captions.autoCaptions')}</b> <AiBadge kind={engine === 'local' ? 'local' : 'api'} />
            <p>{engine === 'local'
              ? <>{t('captions.whisperLocal')}{needsDownload && t('captions.firstUseDownloads', { size: modelInfo.size })}</>
              : <>{t('captions.whisperCloud', { name: cloudMeta.name })}</>}</p>
          </div>
        </div>
        <div className="proj-seg cap-engines" role="radiogroup" aria-label={t('captions.ariaEngine')}>
          <button type="button" role="radio" aria-checked={engine === 'local'} className={engine === 'local' ? 'on' : ''}
            disabled={busy} onClick={() => setEngine('local')}>{t('captions.engineLocal')}</button>
          <button type="button" role="radio" aria-checked={engine === 'cloud'} className={engine === 'cloud' ? 'on' : ''}
            disabled={busy} onClick={() => setEngine('cloud')}>{t('captions.engineCloud')}</button>
        </div>
        {/* AI-02: what this run costs + where the audio goes, before the user clicks Generate. */}
        <AiCostBadge featureId={engine === 'local' ? 'captions-local' : cloudCaptionFeature(provider)} minutes={projectDuration(project) / 60} />
        <label className="field">
          <span>{t('settings.language')}</span>
          <select value={modelInfo.arabicOnly && engine === 'local' ? 'ar' : lang} disabled={busy || (engine === 'local' && modelInfo.arabicOnly)} onChange={(e) => setLang(e.target.value)}>
            {CAPTION_LANGS.map((l) => <option key={l.id} value={l.id}>{l.id === 'auto' ? t('captions.langAuto') : t(`captions.lang.${l.id}`)}</option>)}
          </select>
        </label>
        {engine === 'local' ? (
          <label className="field">
            <span>{t('common.model')}</span>
            <select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id}>{t(`captions.model.${m.id}`)}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="field">
              <span>{t('common.provider')}</span>
              <select value={provider} disabled={busy} onChange={(e) => { setProvider(e.target.value); setTestNote(null); setKeyNote(''); setKeyEdit(false); }}>
                {CLOUD_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('common.model')}</span>
              <input type="text" value={cloudModel} disabled={busy} placeholder={cloudMeta.def} aria-label={t('captions.providerModel', { name: cloudMeta.name })}
                onChange={(e) => setCloudModel(e.target.value)} />
            </label>
            {provider === 'deepgram' && (
              <label className="field check">
                <input type="checkbox" checked={diarize} disabled={busy} onChange={(e) => setDiarize(e.target.checked)} />
                <span>{t('captions.diarize')}</span>
              </label>
            )}
            {savedHint && !keyEdit ? (
              <p className="cap-connected">
                <Check size={15} /> {t('captions.connected', { name: cloudMeta.name })}
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setKeyEdit(true)}>{t('common.edit')}</button>
              </p>
            ) : (
              <>
                <label className="field">
                  <span>{t('captions.apiKey', { name: cloudMeta.name })} {savedHint && <b className="cap-saved">{t('captions.keySavedSuffix', { hint: savedHint })}</b>}</span>
                  <input type="password" value={keyField} disabled={busy} autoComplete="off"
                    placeholder={savedHint ? t('captions.pasteNewKey') : t('captions.pasteKey', { name: cloudMeta.name })}
                    aria-label={t('captions.apiKey', { name: cloudMeta.name })} onChange={(e) => setKeyField(e.target.value)} />
                </label>
                <div className="cap-key-actions">
                  <button className="btn btn-sm" disabled={busy || !keyField.trim()} onClick={saveKey}>{t('captions.saveKey')}</button>
                  <button className="btn btn-sm" disabled={busy || testing || (!savedHint && !keyField.trim())} onClick={testKey}>
                    {testing ? t('captions.testTesting') : t('captions.testConnection')}
                  </button>
                  {savedHint && !keyField && (
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={async () => {
                      const st = await window.api.settingsClearServiceKey(keyService);
                      setSavedKeys(st.serviceKeys || {}); setKeyNote(t('captions.keyRemoved')); setTestNote(null);
                    }}>{t('captions.removeKey')}</button>
                  )}
                </div>
              </>
            )}
            {keyNote && <p className="muted small">{keyNote}</p>}
            {testNote && <p className={`small ${testNote.ok ? 'cap-test-ok' : 'error-text'}`}>{testNote.text}</p>}
            <p className="muted small">{t('captions.cloudNote', { name: cloudMeta.name })}</p>
          </>
        )}
        {engine === 'local' && lang === 'ar' && model === 'base' && (
          <p className="muted small">{t('captions.arabicTipBase')}{models.some((m) => m.id === 'darija') ? t('captions.arabicTipDarija') : ''}{t('captions.arabicTipTail')}</p>
        )}
        <label className="field">
          <span>{t('captions.transcribe')}</span>
          <select value={source} disabled={busy} onChange={(e) => setSource(e.target.value)}>
            <option value="all">{t('captions.transcribeAll')}</option>
            <option value="video">{t('captions.transcribeVideo')}</option>
            <option value="audio">{t('captions.transcribeAudio')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('captions.maxLineLength')} <b>{len}</b></span>
          <input type="range" min="16" max="80" step="2" value={len} disabled={busy} onChange={(e) => setLen(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>{t('captions.wordsPerLine')} <b>{wpl ? wpl : t('captions.noLimit')}</b></span>
          <input type="range" min="0" max="12" step="1" value={wpl} disabled={busy} onChange={(e) => setWpl(Number(e.target.value))} aria-label={t('captions.ariaWordsPerLine')} />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !(project.videoClips.length || project.audioClips.length) || (engine === 'cloud' && !savedHint)}
          onClick={() => (engine === 'cloud'
            ? captions.run({ engine: 'cloud', provider, model: cloudModel.trim() || undefined, language: lang, maxLen: len, wordsPerLine: wpl, source, diarize, style: { ...tpl.patch, template: tpl.id } })
            : captions.run({ language: modelInfo.arabicOnly ? 'ar' : lang, maxLen: len, wordsPerLine: wpl, source, model, style: { ...tpl.patch, template: tpl.id } }))}>
          {busy ? t('captions.working') : count ? t('captions.regenerate') : t('captions.generate')}
        </button>
        {engine === 'cloud' && !savedHint && <p className="muted small">{t('captions.needKey', { name: cloudMeta.name })}</p>}
        {busy && (
          <div className="progress-block" aria-live="polite">
            <span>{captions.stage} · {Math.round((captions.progress || 0) * 100)}%</span>
            <div className="progress"><div style={{ width: `${(captions.progress || 0) * 100}%` }} /></div>
          </div>
        )}
        {captions.error && <CaptionError error={captions.error} />}
        {!(project.videoClips.length || project.audioClips.length) && <p className="muted">{t('captions.needClipFirst')}</p>}
      </div>
      </>
      )}
      {capTab === 'transcript' && (
      <>
      <TranscriptCard project={project} dispatch={dispatch} onSeek={onSeek} onSelect={onSelect} />
      <BrollCard project={project} dispatch={dispatch} onSeek={onSeek} />
      <Accordion title={t('captions.silencesTitle')}>
        <SilencesBlock project={project} dispatch={dispatch} />
      </Accordion>
      <Accordion title={t('captions.fillerWords')}>
        <FillerCard bare project={project} dispatch={dispatch} />
      </Accordion>
      {txChapters.length >= 2 && (
        <Accordion title={t('captions.chaptersTitle')}>
          <ChaptersBlock bare project={project} dispatch={dispatch} sentences={txSentences} />
        </Accordion>
      )}
      <Accordion title={t('captions.translateTitle')}>
        <TranslateCard bare project={project} dispatch={dispatch} />
      </Accordion>
      <Accordion title={t('captions.subFindReplace')}>
        <FindReplaceCard bare project={project} dispatch={dispatch} />
      </Accordion>
      <Accordion title={t('captions.proofreadTitle')}>
        <CaptionProofreadCard bare project={project} dispatch={dispatch} />
      </Accordion>
      </>
      )}
      {capTab === 'styles' && (
      <div className="card">
        <b>{t('captions.styleTitle')}</b>
        <p className="muted">{count ? t('captions.styleApplies', { n: count }) : t('captions.styleUsed')}</p>
        <TemplateGrid captionOnly activeId={tplId} onPick={pickStyle} />
        {count > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'setCaptions', segments: [] })}>
            <Trash2 size={14} /> {t('captions.removeAuto')}
          </button>
        )}
      </div>
      )}
      {capTab === 'generate' && (
      <>
      <div className="card">
        <b>{t('captions.srtTitle')}</b>
        <p className="muted">{srtCount
          ? t(srtCount > 1 ? 'captions.srtApplyDescOther' : 'captions.srtApplyDescOne', { n: srtCount })
          : t('captions.srtDesc')}</p>
        <input ref={srtFileRef} type="file" accept=".srt" hidden onChange={onSrtFile} aria-label={t('captions.ariaSrtFile')} />
        <button className="btn btn-sm" onClick={() => srtFileRef.current?.click()}><Upload size={14} /> {t('captions.importSrt')}</button>
        <p className="muted small">{t('captions.srtWplNote')}</p>
        {srtNote && <p className="muted small">{srtNote}</p>}
        {srtCount > 0 && (
          <>
            <p className="muted small">{t('captions.templateForAll')}</p>
            <TemplateGrid captionOnly activeId={srtTplId} onPick={pickSrtStyle} />
            {!!userTpls.length && (
              <>
                <p className="muted small">{t('captions.myTemplates')}</p>
                <div className="user-tpl-list">
                  {userTpls.map((tplItem) => (
                    <div key={tplItem.name} className={`user-tpl-row ${srtTplId === `user:${tplItem.name}` ? 'on' : ''}`}>
                      <span className="user-tpl-name">{tplItem.name}{defaultTplName === tplItem.name ? tr('captions.defaultSuffix') : ''}</span>
                      <button className="btn btn-sm" onClick={() => applyUserTpl(tplItem)}>{tr('captions.applyBtn')}</button>
                      {defaultTplName !== tplItem.name && (
                        <button className="btn btn-sm btn-ghost" onClick={() => makeDefaultTpl(tplItem)} title={tr('captions.setDefaultTitle')}>{tr('captions.setDefault')}</button>
                      )}
                      <button className="btn btn-sm btn-ghost" aria-label={tr('captions.deleteTemplate', { name: tplItem.name })} onClick={() => deleteUserTpl(tplItem)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="preset-save">
              <input type="text" value={tplName} placeholder={t('captions.templateNamePh')} aria-label={t('captions.ariaTplName')}
                onChange={(e) => setTplName(e.target.value)} />
              <button className="btn btn-sm" disabled={!tplName.trim()} onClick={saveCurrentSrtStyle}>{t('captions.saveCurrentStyle')}</button>
            </div>
            <p className="muted small">{t('captions.saveStyleDesc')}</p>
            <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'removeSrtCaptions' })}>
              <Trash2 size={14} /> {t('captions.removeSrt')}
            </button>
          </>
        )}
      </div>
      </>
      )}
      {capTab === 'generate' && <SrtExportCard project={project} />}
      {capTab === 'transcript' && subtitleClips.length > 0 && (
        <div className="card sub-panel">
          <div className="sub-panel-head">
            <b>{t('captions.subtitlesTitle')}</b>
            <span className="muted small">{t(subtitleClips.length > 1 ? 'captions.cueOther' : 'captions.cueOne', { n: subtitleClips.length })}</span>
          </div>
          <SearchBox value={subQuery} onChange={setSubQuery} placeholder={t('captions.searchSubtitlePh')} ariaLabel={t('captions.subSearchAria')} />
          <div className="sub-list">
            {subShown.slice(0, 300).map((c) => {
              const idx = subtitleClips.indexOf(c);
              return (
                <div key={c.id} className="sub-row" onClick={() => { onSeek?.(c.start); onSelect?.({ track: 'text', id: c.id }); }}>
                  <span className="sub-idx">{idx + 1}</span>
                  <span className="sub-times">{formatTime(c.start)} – {formatTime(c.start + c.duration)}</span>
                  <textarea className="sub-text" dir="auto" rows={2} value={c.text || ''} aria-label={t('captions.subTextAria', { n: idx + 1 })}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => dispatch({ type: 'update', track: 'text', id: c.id, patch: { text: e.target.value } })} />
                </div>
              );
            })}
            {!subShown.length && <p className="muted small">{t('captions.subNoMatch')}</p>}
            {subShown.length > 300 && <p className="muted small">{t('captions.showingFirst300')}</p>}
          </div>
        </div>
      )}
      {capTab === 'generate' && (
      <div className="card">
        <b>{t('captions.manualTitle')}</b>
        <p className="muted">{t('captions.manualDesc')}</p>
        <button className="btn btn-sm" onClick={() => onAddText({ size: 44, y: 0.9, box: true, boxColor: '#000000', outline: false, font: 'segoe', anim: 'none' })}>
          <Plus size={14} /> {t('captions.addCaption')}
        </button>
      </div>
      )}
    </>
  );
}

// Error box: short reason plus a button to open the full whisper log.
function CaptionError({ error }) {
  const t = useT();
  const [msg, logPath] = error.split('\n\nFull log: ');
  return (
    <div className="error-box" role="alert">
      <b>{t('captions.errorTitle')}</b>
      <p>{msg.replace('Auto captions failed.\n', '')}</p>
      {logPath && (
        <button className="btn btn-ghost btn-sm" onClick={() => window.api.showInFolder(logPath.trim())}>
          <FolderOpen size={14} /> {t('captions.openLog')}
        </button>
      )}
    </div>
  );
}

// With several clips selected in the timeline, the Filters and Adjust tabs change all of them.
function ManyNote({ count }) {
  const t = useT();
  if (count < 2) return null;
  return <p className="hint many">{t('panel.manyNote', { n: count })}</p>;
}

function FiltersTab({ target, updateTarget, media, selectedCount = 0, dispatch, project }) {
  const t = useT();
  const current = target?.clip.filter || 'none';
  const k = target?.clip.filterIntensity ?? 100;
  const [presets, setPresets] = useState(() => loadPresets(localStorage));
  const [presetName, setPresetName] = useState('');
  const [compareId, setCompareId] = useState(null); // hold a tile: show the unfiltered picture
  const storePresets = (list) => { setPresets(list); savePresets(localStorage, list); };
  const canSave = !!target && current !== 'none' && !current.startsWith('lut:');
  // Step 5: the look categories move into the category column (name +
  // count) — 'All looks' stacks everything as before, a category shows its
  // own grid, and My presets / the LUT browser get their own entries.
  const [view, setView] = useState('all');
  const navItems = [
    { id: 'all', label: t('panel.filters.allLooks'), count: FILTERS.length },
    { id: 'presets', label: t('panel.filters.myPresets'), count: presets.length },
    ...FILTER_CATS.map((c) => ({ id: `cat:${c}`, label: libName('cat', slugifyPhrase(c), c), count: FILTERS.filter((f) => f.cat === c).length })),
    { id: 'luts', label: t('panel.filters.lutBrowser'), count: BUNDLED_LUTS.length },
  ];
  return (
    <TabFrame nav={<SideNav items={navItems} value={view} onChange={setView} label={t('panel.filters.ariaCategories')} />}>
      <Head title={t('panel.tab.filters')} hint={t('panel.filters.hint')} />
      <NeedClip target={target} />
      <ManyNote count={selectedCount} />
      {target && current !== 'none' && (
        <div className="pad-block filter-k panel-sticky">
          <Slider dispatch={dispatch} label={t('panel.filters.intensity', { name: filterName(current) })} value={k} min={0} max={100} step={1}
            fmt={(v) => `${Math.round(v)}`} onChange={(v) => updateTarget({ filterIntensity: v })} />
        </div>
      )}
      {(view === 'all' || view === 'presets') && (
      <div className="look-cat">
        <div className="look-cat-title">{t('panel.filters.myPresets')}</div>
        {target && (
          <div className="preset-save">
            <input type="text" value={presetName} placeholder={t('panel.filters.presetNamePh')} aria-label={t('panel.filters.presetNameAria')} onChange={(e) => setPresetName(e.target.value)} />
            <button className="btn btn-sm" disabled={!canSave || !presetName.trim()}
              title={current.startsWith('lut:') ? t('panel.filters.saveLookLutTitle') : t('panel.filters.saveLookTitle')}
              onClick={() => { storePresets(upsertPreset(presets, target.clip, presetName)); setPresetName(''); }}>{t('panel.filters.saveLook')}</button>
          </div>
        )}
        {!!presets.length && (
          <div className="tile-grid">
            {presets.map((pr) => (
              <button key={pr.name} className={`tile ${target && current === pr.filter ? 'on' : ''}`} title={t('panel.filters.presetTitle', { name: pr.name, filter: filterName(pr.filter), pct: Math.round(pr.filterIntensity) })}
                onClick={() => target && updateTarget(presetPatch(pr))}>
                <span className="tile-preview filter-thumb"><LookThumb filterId={pr.filter === 'none' ? null : pr.filter} /></span>
                <span className="tile-label">{pr.name}</span>
                <span className="tile-star" role="button" aria-label={t('panel.filters.deletePreset', { name: pr.name })} title={t('panel.filters.deletePresetTitle')}
                  onClick={(e) => { e.stopPropagation(); storePresets(removePreset(presets, pr.name)); }}
                  onPointerDown={(e) => e.stopPropagation()}>×</span>
              </button>
            ))}
          </div>
        )}
        {!presets.length && <p className="hint">{t('panel.filters.noPresets')}</p>}
      </div>
      )}
      {FILTER_CATS.filter((cat) => view === 'all' || view === `cat:${cat}`).map((cat) => (
        <div key={cat} className="look-cat">
          <div className="look-cat-title">{libName('cat', slugifyPhrase(cat), cat)} · {FILTERS.filter((f) => f.cat === cat).length}</div>
          <div className="tile-grid">
            {FILTERS.filter((f) => f.cat === cat).map((f) => (
              <button key={f.id} className={`tile ${current === f.id && target ? 'on' : ''}`}
                onClick={() => target && updateTarget({ filter: f.id })} {...dragProps({ kind: 'filter', id: f.id })}
                onPointerDown={() => setCompareId(f.id)} onPointerUp={() => setCompareId(null)} onPointerLeave={() => setCompareId(null)}>
                <span className="tile-preview filter-thumb"><LookThumb filterId={f.id === 'none' ? null : f.id} plain={compareId === f.id} /></span>
                <span className="tile-label">{libName('filter', f.id, f.name)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {(view === 'all' || view === 'luts') && (
        <LutBrowser target={target} updateTarget={updateTarget} dispatch={dispatch} project={project} current={current} />
      )}
    </TabFrame>
  );
}

// LUT browser: bundled LUTs by category (applied as the clip's filter, like the other looks)
// and the user's imported .cube library (applied through the grade's LUT slot, the mechanism
// that supports file paths). Imported entries persist in localStorage; invalid files surface
// the parser's error instead of failing silently.
function LutBrowser({ target, updateTarget, dispatch, project, current }) {
  const t = useT();
  const [lib, setLib] = useState(() => loadLutLibrary(localStorage));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const storeLib = (list) => { setLib(list); saveLutLibrary(localStorage, list); };
  const clipLutPath = target?.clip.grade?.lut?.ref?.path || null;
  const applyImported = (entry) => {
    if (!target) return;
    const g = target.clip.grade || {};
    updateTarget({ grade: { ...g, lut: { ref: { path: entry.path }, name: entry.name, intensity: g.lut?.intensity ?? 100 } } });
  };
  const applyImportedToAll = (entry) => {
    if (!project) return;
    const lut = { ref: { path: entry.path }, name: entry.name, intensity: 100 };
    dispatch({ type: 'updateMany', updates: [
      ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(c.grade || {}), lut } } })),
      ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(c.grade || {}), lut } } })),
    ] });
  };
  const importCube = async () => {
    setErr(''); setBusy(true);
    try {
      const res = await window.api.importLut();
      if (!res || res.canceled) return;
      if (res.error) { setErr(res.error); return; }
      if (res.path) storeLib(addLutEntry(lib, { name: res.name, path: res.path }));
    } catch (e) { setErr(e.message || t('panel.luts.importFail')); }
    finally { setBusy(false); }
  };
  const cats = [...new Set(BUNDLED_LUTS.map((l) => l.cat))];
  return (
    <div className="look-cat">
      <div className="look-cat-title">{t('panel.filters.lutBrowser')}</div>
      {cats.map((cat) => (
        <div key={cat}>
          <div className="look-cat-title sub">{libName('cat', slugifyPhrase(cat), cat)} <span className="dim">{(() => { const ls = BUNDLED_LUTS.filter((l) => l.cat === cat); return ls.every((l) => l.credit) ? t('panel.luts.creditCc') : ls.some((l) => l.credit) ? t('panel.luts.creditBundled') : t('panel.luts.creditCutflow'); })()}</span></div>
          <div className="tile-grid">
            {BUNDLED_LUTS.filter((l) => l.cat === cat).map((l) => {
              // A bundled LUT tile is a filter like the others: picking it replaces the current filter; None removes it.
              const id = `lut:${l.file}`;
              return (
                <button key={l.file} className={`tile ${target && current === id ? 'on' : ''}`} title={t('panel.luts.tileTitle', { name: libName('lut', l.file.replace(/\.cube$/, ''), l.name) })}
                  onClick={() => target && updateTarget({ filter: id })}>
                  <span className="tile-preview filter-thumb"><LookThumb lutRef={l.ref} /></span>
                  <span className="tile-label">{libName('lut', l.file.replace(/\.cube$/, ''), l.name)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="look-cat-title sub">{t('panel.luts.myLuts')} <span className="dim">{t('panel.luts.cubeHint')}</span></div>
      <div className="preset-save">
        <button className="btn btn-sm" disabled={busy} onClick={importCube}>{busy ? t('panel.luts.importing') : t('panel.luts.importBtn')}</button>
        {target && clipLutPath && <span className="dim">{t('panel.luts.intensityHint')}</span>}
      </div>
      {err && <p className="hint pad-x err" role="alert">⚠ {err}</p>}
      {!!lib.length && (
        <div className="tile-grid">
          {lib.map((e) => (
            <button key={e.path} className={`tile ${clipLutPath === e.path ? 'on' : ''}`} title={`${e.name} — ${e.path}`}
              onClick={() => applyImported(e)}>
              <span className="tile-preview filter-thumb"><LookThumb lutRef={{ path: e.path }} /></span>
              <span className="tile-label">{e.name}</span>
              <span className="tile-star" role="button" aria-label={t('panel.luts.removeAria', { name: e.name })} title={t('panel.luts.removeTitle')}
                onClick={(ev) => { ev.stopPropagation(); storeLib(removeLutEntry(lib, e.path)); }}
                onPointerDown={(ev) => ev.stopPropagation()}>×</span>
              <span className="tile-badge clickable" role="button" title={t('panel.luts.applyAllTitle')}
                onClick={(ev) => { ev.stopPropagation(); applyImportedToAll(e); }}
                onPointerDown={(ev) => ev.stopPropagation()}>{t('panel.luts.applyAll')}</span>
            </button>
          ))}
        </div>
      )}
      {!lib.length && <p className="hint">{t('panel.luts.none')}</p>}
      <p className="hint">{t('panel.luts.note')}</p>
    </div>
  );
}

function AdjustTab({ media: library = [], project, target, updateTarget, dispatch, selectedCount = 0, onApplyLookToAll }) {
  const t = useT();
  const media = target && library.find((m) => m.id === target.clip.mediaId);
  // P2-19: shot-match references — the other picture clips in the project,
  // same list the clip inspector's GradePanel gets.
  const mediaById = Object.fromEntries((project?.media || []).map((m) => [m.id, m]));
  const shotMatch = target?.track === 'video' ? {
    refs: (project?.videoClips || []).filter((c) => !c.gap && c.id !== target.clip.id)
      .map((c) => ({ id: c.id, name: mediaById[c.mediaId]?.name || c.id, media: mediaById[c.mediaId], clip: c }))
      .filter((r) => r.media),
  } : undefined;
  return (
    <>
      <Head title={t('panel.tab.adjust')} hint={t('panel.adjust.hint')} />
      <NeedClip target={target} />
      <ManyNote count={selectedCount} />
      {target && (
        <div className="pad-block">
          <GradePanel grade={target.clip.grade} adjust={target.clip.adjust} dispatch={dispatch}
            autoFrom={media ? { media, clip: target.clip } : undefined}
            shotMatch={shotMatch}
            onGrade={(grade) => updateTarget({ grade })} onAdjust={(adjust) => updateTarget({ adjust })}
            onApplyAll={onApplyLookToAll ? () => onApplyLookToAll(target.clip) : undefined} />
        </div>
      )}
    </>
  );
}




