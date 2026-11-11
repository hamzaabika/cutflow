import { displayProjectName, spritePosterStyle } from '../recents.js';
import { daysLeftInTrash, filterHomeEntries, fmtDuration, sortHomeEntries } from '../homeList.js';
import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, Clock3, CopyPlus, Film, FolderOpen, Heart, History, Home, Import, Instagram,
  LayoutGrid, ListRows, Monitor, MoreVertical, Pencil, Play, Plus, RotateCcw, Settings, Trash2,
} from '../icons.jsx';
import { Button, ConfirmDialog, ContextMenu, Dropdown, IconButton, SearchBox } from '../ui/index.js';
import { getLanguage, tr, useT } from '../i18n/index.jsx';

// The developer's Instagram — shown in the home footer and the About dialog.
export const DEV_INSTAGRAM_URL = 'https://www.instagram.com/hamza_abika/';

// Support Cutflow's development — the developer's PayPal.me page, opened in the
// system browser (app:openHelp allowlist) from the Home sidebar and the top bar.
export const SUPPORT_URL = 'https://paypal.me/hamzaAbika';

// Cutflow home / start screen (pass 4, R5; shell restructured 10/10 step 5) —
// the project switchboard on the design system: a left sidebar (brand, version,
// and a nav whose entries really navigate — Home and Projects scroll this
// screen, Settings opens the dialog), one large
// violet "Create project" tile spanning the hero that starts a 16:9 project
// on click (Hamza, 2026-11-10 — no format list beside it), a quick-tools row
// where every tile does something real, and the switchboard itself — poster
// cards with duration + state, search and sort, and a per-card menu (open /
// rename / duplicate / version history / move to trash). Deleted projects
// wait in the trash section at the bottom, restorable for 30 days. Every
// control on this screen is wired; anything that could not work was left off.

// ratio -> the sizeFor() short side that yields the labelled pixel size; img -> the preview
// photo whose crop suits the format (bundled in public/preview, see CREDITS.txt there).
const PRESETS = [
  { ratio: '16:9', label: 'Landscape', use: 'YouTube & desktop', size: '1920 × 1080', short: 1080, img: './preview/p1015.jpg' },
  { ratio: '9:16', label: 'Vertical', use: 'Reels, TikTok, Shorts', size: '1080 × 1920', short: 1080, img: './preview/p1025.jpg' },
  { ratio: '1:1', label: 'Square', use: 'Feed posts', size: '1080 × 1080', short: 1080, img: './preview/p292.jpg' },
  { ratio: '4:5', label: 'Portrait', use: 'Feed portrait', size: '1080 × 1350', short: 1080, img: './preview/p1060.jpg' },
  { ratio: '21:9', label: 'Ultrawide', use: 'Cinematic', size: '2520 × 1080', short: 1080, img: './preview/p1016.jpg' },
];
// Home creates at a fixed 30 fps (Hamza's home review, 2026-11-10): the rate
// is the editor's Project Settings away from any other value, so the hero
// carries no frame-rate control any more.
const HOME_FPS = 30;
// The big Create tile starts here (Hamza, 2026-11-10): 16:9 by default — the
// frame is the editor's Project Settings away from any other shape.
const DEFAULT_PRESET = PRESETS[0];
// The hero's frame pills: a pill SELECTS the frame (16:9 until changed) and
// the card body creates with the current selection — a pill never creates on
// its own, so one gesture can never both pick a frame and launch.
const CREATE_CHIPS = [PRESETS[0], PRESETS[1], PRESETS[2]];
// '16:9' -> 'wide', '9:16' -> 'tall', '1:1' -> 'sq': the little bordered
// frame glyph each pill draws before its label, in the frame's proportions.
const frameKind = (ratio) => {
  const [w, h] = String(ratio).split(':').map(Number);
  return w === h ? 'sq' : w > h ? 'wide' : 'tall';
};
const SORTS = [
  { value: 'recent' },
  { value: 'name' },
];

const DATE_LOCALES = { en: 'en-GB', fr: 'fr-FR', ar: 'ar' };
const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleDateString(DATE_LOCALES[getLanguage()] || 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

// "Today" / "Yesterday" / "N days ago" inside the last week, a plain date before that.
const relDate = (ts) => {
  if (!ts) return '';
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(new Date(ts))) / 864e5);
  if (days <= 0) return tr('home.today');
  if (days === 1) return tr('home.yesterday');
  if (days < 7) return tr('home.daysAgo', { days });
  return fmtDate(ts);
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return tr('home.greetStillUp');
  if (h < 12) return tr('home.greetMorning');
  if (h < 18) return tr('home.greetAfternoon');
  return tr('home.greetEvening');
};

const baseName = (p) => String(p || '').split(/[\\/]/).pop();

// Where a project lives, in the user's terms: its file's name, or the auto-save.
const stateLine = (e) => (e.path ? baseName(e.path) : tr('home.autoSavedPc'));

// '9:16' -> '9 / 16' for CSS aspect-ratio: card thumbnails take the PROJECT's true shape
// (W4) instead of a forced 16/9 box that letterboxes portrait projects into a smear.
function ratioCss(ratio) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio || ''));
  return m ? `${m[1]} / ${m[2]}` : '16 / 9';
}

// A recent's thumbnail: the video sprite's first frame, an image, or the placeholder glyph.
// Shared by the continue card, the gallery cards and the trash rows.
function RecentThumb({ r, placeholder = 22 }) {
  if (r.thumb && r.thumb.kind === 'sprite') return <div className="home-card-poster" style={spritePosterStyle(r.thumb)} role="img" aria-label="" />;
  if (r.thumb) return <img src={r.thumb.kind === 'image' ? r.thumb.src : r.thumb} alt="" draggable={false} />;
  return <Film size={placeholder} />;
}

// The empty-state mark: a mini stage — three ratio frames on a floor, a playhead over two
// timeline bars — built from divs only.
function EmptyStage() {
  return (
    <div className="home-empty-stage" aria-hidden="true">
      <div className="home-empty-frames">
        <span className="home-empty-f f-wide" />
        <span className="home-empty-f f-tall" />
        <span className="home-empty-f f-sq" />
      </div>
      <div className="home-empty-track">
        <span className="home-empty-playhead" />
        <span className="home-empty-bar a" />
        <span className="home-empty-bar b" />
      </div>
    </div>
  );
}

// Rename in place: a small dialog over the switchboard. Enter saves, Escape cancels;
// an unchanged or empty name simply closes (the store refuses empties too).
function RenameDialog({ entry, onSubmit, onClose }) {
  const t = useT();
  const [value, setValue] = useState(entry.name || '');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const submit = async (e) => {
    e.preventDefault();
    const name = value.trim();
    if (!name || name === (entry.name || '')) { onClose(); return; }
    setBusy(true);
    const ok = await onSubmit(entry, name);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="home-rename-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal home-rename" onSubmit={submit}>
        <h3 id="home-rename-title">{t('home.renameTitle')}</h3>
        <input ref={input} className="home-rename-input" value={value} maxLength={120}
          onChange={(e) => setValue(e.target.value)} aria-label={t('topbar.projectName')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />
        <div className="modal-actions">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || !value.trim()}>{t('home.rename')}</Button>
        </div>
      </form>
    </div>
  );
}

export default function HomeScreen({
  recents, trash = [], onNew, onOpen, onOpenRecent, onDuplicate, onRename, onTrash,
  onRestoreTrashed, onDeleteTrashed, onEmptyTrash, onHistory,
  onImportMedia, onRecordStart, onSettings, unsavedNote, onRestoreUnsaved, onDiscardUnsaved,
}) {
  const t = useT();
  // The version badge reads the real app version (package.json via app:version) —
  // it must never drift from the shipped build again.
  const [version, setVersion] = useState('');
  useEffect(() => {
    window.api?.appVersion?.().then((v) => { if (v) setVersion(v.split('.').slice(0, 2).join('.')); }).catch(() => {});
  }, []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid'); // 'grid' | 'list' — how Recent projects renders
  const [menu, setMenu] = useState(null); // { entry, x, y }
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // a trash entry, or 'all'
  const [trashOpen, setTrashOpen] = useState(false);
  // Step 5 shell: the sidebar nav really navigates — Home and Projects scroll
  // within this screen, Templates and Settings leave/open over it.
  const [nav, setNav] = useState('home');
  const topRef = useRef(null);
  const projectsRef = useRef(null);
  const goHome = () => { setNav('home'); topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const goProjects = () => { setNav('projects'); projectsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // The Create tile starts the project itself (Hamza, 2026-11-10): one big
  // tile — the new project opens in the frame the hero pills have selected
  // (16:9 until changed) at the fixed home rate, and can be reshaped in the
  // editor.
  const [framePreset, setFramePreset] = useState(DEFAULT_PRESET);
  const createProject = () => onNew(framePreset, HOME_FPS);

  const shown = sortHomeEntries(filterHomeEntries(recents, query), sort);
  // "Jump back in" is the most recent project — it only means something in the
  // default view; searching or sorting shows one flat grid instead.
  const featured = (!query.trim() && sort === 'recent') ? (shown[0] || null) : null;
  const rest = featured ? shown.slice(1) : shown;

  const openMenu = (entry, x, y) => setMenu({ entry, x, y });
  const menuFor = (entry) => (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(entry, r.left, r.bottom + 4);
  };
  const menuItems = (entry) => [
    { label: t('home.menuOpen'), icon: Play, onClick: () => onOpenRecent(entry) },
    { label: t('home.menuRename'), icon: Pencil, onClick: () => setRenameTarget(entry) },
    { label: t('home.menuDuplicate'), icon: CopyPlus, onClick: () => onDuplicate(entry) },
    ...(entry.slotId ? [{ label: t('home.menuBackups'), icon: History, onClick: () => onHistory(entry) }] : []),
    'sep',
    { label: t('home.menuTrash'), icon: Trash2, onClick: () => onTrash(entry) },
  ];
  const cardKeys = (entry) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenRecent(entry); }
  };

  const deleteText = deleteTarget === 'all'
    ? t('home.deleteAllText')
    : deleteTarget?.kind === 'slot'
      ? t('home.deleteSlotText', { name: displayProjectName(deleteTarget.name), fileNote: deleteTarget.path ? t('home.deleteSlotFileNote') : '' })
      : t('home.deleteFileText', { name: displayProjectName(deleteTarget?.name) });

  return (
    <div className="home">
      <div className="home-shell">
        <aside className="home-side">
          <div className="home-side-brand">
            <img src="./logo.png" alt="" className="home-logo" draggable={false} />
            <span className="home-name">Cut<b>flow</b></span>
            <span className="home-ver-badge">{version ? `v${version}` : 'v2.0'}</span>
          </div>
          <nav className="home-nav" aria-label={t('home.navAria')}>
            <button className={`home-nav-item ${nav === 'home' ? 'on' : ''}`} aria-current={nav === 'home' ? 'page' : undefined} onClick={goHome}>
              <Home size={16} /><span>{t('home.navHome')}</span>
            </button>
            <button className={`home-nav-item ${nav === 'projects' ? 'on' : ''}`} aria-current={nav === 'projects' ? 'page' : undefined} onClick={goProjects}>
              <FolderOpen size={16} /><span>{t('topbar.projects')}</span><span className="side-count">{recents.length}</span>
            </button>
            <button className="home-nav-item" onClick={() => onSettings?.()}>
              <Settings size={16} /><span>{t('settings.title')}</span>
            </button>
          </nav>
          <div className="home-side-foot">
            <button className="home-support" onClick={() => window.api.openHelp(SUPPORT_URL)} aria-label={t('home.supportAria')}>
              <Heart size={14} /><span>{t('topbar.supportProject')}</span>
            </button>
            <span className="home-greet">{t('home.greetLine', { greeting: greeting() })}</span>
          </div>
        </aside>

        <div className="home-main" ref={topRef}>
      <main className="home-body">
        {unsavedNote && (
          <div className="home-recover" role="status">
            <div>
              <b>{t('home.recoverTitle')}</b>
              <span>{t('home.recoverKept', { date: new Date(unsavedNote.savedAt).toLocaleString(DATE_LOCALES[getLanguage()] || 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
            </div>
            <div className="home-recover-actions">
              <Button variant="primary" size="sm" onClick={onRestoreUnsaved}>{t('home.restore')}</Button>
              <Button size="sm" onClick={onDiscardUnsaved}>{t('home.discard')}</Button>
            </div>
          </div>
        )}

        <section className="home-hero" aria-labelledby="home-new">
          <div className="home-create" role="button" tabIndex={0} onClick={createProject}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); createProject(); } }}
            aria-label={t('home.createAria')}>
            <div className="home-create-main">
              <span className="home-create-icon"><Plus size={26} /></span>
              <span className="home-eyebrow">{t('home.newProject')}</span>
              <h1 id="home-new">{t('home.createProject')}</h1>
              <p className="home-hero-sub">{t('home.heroSub')}</p>
            </div>
            {/* Frame pills ride the card's right side: a pill only SELECTS
                its frame (the white .on state); the card body creates with
                the selection. Clicks/keys stop here so a pill gesture can
                never also fire the card's create for the same gesture. */}
            <span className="home-create-chips" role="group" aria-label={t('home.frameGroupAria')}
              onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {CREATE_CHIPS.map((p) => (
                <button key={p.ratio} type="button"
                  className={`home-chip${p.ratio === framePreset.ratio ? ' on' : ''}`}
                  aria-label={t('home.frameAria', { ratio: p.ratio })} aria-pressed={p.ratio === framePreset.ratio}
                  onClick={() => setFramePreset(p)}>
                  <span className={`home-chip-frame ${frameKind(p.ratio)}`} aria-hidden="true" />
                  {p.ratio}
                </button>
              ))}
            </span>
          </div>
        </section>

        <section className="home-quick" aria-label={t('home.quickTools')}>
          <button className="home-action" onClick={onOpen}>
            <span className="home-action-icon"><FolderOpen size={18} /></span>
            <span className="home-action-text"><b>{t('topbar.openProject')}</b><span>{t('home.openProjectSub')}</span></span>
          </button>
          <button className="home-action" onClick={onImportMedia}>
            <span className="home-action-icon"><Import size={18} /></span>
            <span className="home-action-text"><b>{t('home.importMedia')}</b><span>{t('home.importMediaSub')}</span></span>
          </button>
          <button className="home-action" onClick={() => onRecordStart?.(HOME_FPS)}>
            <span className="home-action-icon"><Monitor size={18} /></span>
            <span className="home-action-text"><b>{t('home.recordScreen')}</b><span>{t('home.recordScreenSub')}</span></span>
          </button>
        </section>

        <section className="home-recents" aria-labelledby="home-recent-title" ref={projectsRef}>
          <div className="home-recents-head">
            <h2 id="home-recent-title"><Clock3 size={16} /> {t('home.recentProjects')}</h2>
            {recents.length > 0 && (
              <span className="home-recents-tools">
                <Dropdown value={sort} options={SORTS.map((s) => ({ value: s.value, label: t(`home.sort.${s.value}`) }))} onChange={setSort} ariaLabel={t('home.sortProjects')} className="home-sort" />
                <SearchBox value={query} onChange={setQuery} placeholder={t('home.searchProjectsPh')} ariaLabel={t('home.searchProjects')} />
                <span className="home-view-toggle" role="group" aria-label={t('home.projectsView')}>
                  <button type="button" className={view === 'grid' ? 'on' : ''} aria-label={t('home.gridView')} aria-pressed={view === 'grid'}
                    title={t('home.gridView')} onClick={() => setView('grid')}><LayoutGrid size={15} /></button>
                  <button type="button" className={view === 'list' ? 'on' : ''} aria-label={t('home.listView')} aria-pressed={view === 'list'}
                    title={t('home.listView')} onClick={() => setView('list')}><ListRows size={15} /></button>
                </span>
              </span>
            )}
          </div>
          {!recents.length && (
            <div className="home-empty">
              <EmptyStage />
              <p><b>{t('home.emptyTitle')}</b></p>
              <p className="muted">{t('home.emptyText')}</p>
            </div>
          )}
          {recents.length > 0 && !shown.length && (
            <p className="muted">{t('home.noMatch', { query })}</p>
          )}
          {featured && (
            <div className="home-continue" onClick={() => onOpenRecent(featured)} onKeyDown={cardKeys(featured)}
              onContextMenu={(e) => { e.preventDefault(); openMenu(featured, e.clientX, e.clientY); }}
              tabIndex={0} role="button" title={featured.path || featured.name}>
              <div className="home-card-thumb home-continue-thumb" style={{ aspectRatio: ratioCss(featured.ratio) }}>
                <RecentThumb r={featured} placeholder={30} />
                <span className="home-card-ratio">{featured.ratio || '16:9'}</span>
                {fmtDuration(featured.duration) && <span className="home-card-dur">{fmtDuration(featured.duration)}</span>}
              </div>
              <div className="home-continue-body">
                <span className="home-eyebrow">{t('home.jumpBackIn')}</span>
                <b className="home-continue-name">{displayProjectName(featured.name) || t('common.untitled')}</b>
                <span className="home-continue-meta">
                  {featured.ratio || '16:9'} · {relDate(featured.modifiedAt)}{fmtDuration(featured.duration) ? ` · ${fmtDuration(featured.duration)}` : ''}
                </span>
                <span className="home-continue-meta home-card-state">{stateLine(featured)}</span>
                <span className="home-continue-cta">
                  <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onOpenRecent(featured); }}>
                    <Play size={13} fill="currentColor" /> {t('home.resume')}
                  </Button>
                </span>
              </div>
              <IconButton className="home-card-menu" aria-label={t('home.actionsFor', { name: featured.name || t('home.projectFallback') })} title={t('home.projectActions')}
                onClick={menuFor(featured)}><MoreVertical size={15} /></IconButton>
            </div>
          )}
          {rest.length > 0 && view === 'list' && (
            <div className="home-list">
              {rest.map((r) => (
                <div key={r.slotId || r.path} className="home-row" onClick={() => onOpenRecent(r)} onKeyDown={cardKeys(r)}
                  onContextMenu={(e) => { e.preventDefault(); openMenu(r, e.clientX, e.clientY); }}
                  tabIndex={0} role="button" title={r.path || r.name}>
                  <span className="home-row-thumb"><RecentThumb r={r} placeholder={16} /></span>
                  <b className="home-row-name">{displayProjectName(r.name) || t('common.untitled')}</b>
                  <span className="home-row-meta">
                    {r.ratio || '16:9'} · {relDate(r.modifiedAt)}{fmtDuration(r.duration) ? ` · ${fmtDuration(r.duration)}` : ''} · {stateLine(r)}
                  </span>
                  <IconButton className="home-card-menu" aria-label={t('home.actionsFor', { name: r.name || t('home.projectFallback') })} title={t('home.projectActions')}
                    onClick={menuFor(r)}><MoreVertical size={15} /></IconButton>
                </div>
              ))}
            </div>
          )}
          {rest.length > 0 && view === 'grid' && (
            <div className="home-grid">
              {rest.map((r) => (
                <div key={r.slotId || r.path} className="home-card" onClick={() => onOpenRecent(r)} onKeyDown={cardKeys(r)}
                  onContextMenu={(e) => { e.preventDefault(); openMenu(r, e.clientX, e.clientY); }}
                  tabIndex={0} role="button" title={r.path || r.name}>
                  <div className="home-card-thumb" style={{ aspectRatio: ratioCss(r.ratio) }}>
                    <RecentThumb r={r} />
                    <span className="home-card-ratio">{r.ratio || '16:9'}</span>
                    {fmtDuration(r.duration) && <span className="home-card-dur">{fmtDuration(r.duration)}</span>}
                  </div>
                  <div className="home-card-body">
                    <b className="home-card-name">{displayProjectName(r.name) || t('common.untitled')}</b>
                    <span className="home-card-meta">{relDate(r.modifiedAt)}{fmtDuration(r.duration) ? ` · ${fmtDuration(r.duration)}` : ''}</span>
                    <span className="home-card-meta home-card-state">{stateLine(r)}</span>
                  </div>
                  <IconButton className="home-card-menu" aria-label={t('home.actionsFor', { name: r.name || t('home.projectFallback') })} title={t('home.projectActions')}
                    onClick={menuFor(r)}><MoreVertical size={15} /></IconButton>
                </div>
              ))}
            </div>
          )}
        </section>

        {trash.length > 0 && (
          <section className="home-trash" aria-labelledby="home-trash-title">
            <div className="home-trash-head">
              <button className="home-trash-toggle" onClick={() => setTrashOpen(!trashOpen)} aria-expanded={trashOpen}>
                {trashOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <Trash2 size={15} />
                <span id="home-trash-title">{t('home.trashCount', { count: trash.length })}</span>
                <span className="home-trash-note">{t('home.trashKept')}</span>
              </button>
              {trashOpen && (
                <Button variant="ghost" size="sm" onClick={() => setDeleteTarget('all')}>{t('home.emptyTrash')}</Button>
              )}
            </div>
            {trashOpen && (
              <div className="home-trash-list">
                {trash.map((t) => (
                  <div key={t.kind === 'slot' ? `slot:${t.slotId}` : `file:${t.path}`} className="home-trash-row">
                    <span className="home-trash-thumb"><RecentThumb r={t} placeholder={16} /></span>
                    <span className="home-trash-info">
                      <b className="home-trash-name">{displayProjectName(t.name) || tr('common.untitled')}</b>
                      <span className="home-trash-meta">
                        {tr('home.trashMeta', { when: relDate(t.trashedAt).toLowerCase(), days: daysLeftInTrash(t.trashedAt) })}
                        {t.kind === 'file' ? tr('home.trashFileStaysSeg') : ''}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => onRestoreTrashed(t)}>
                      <RotateCcw size={13} /> {tr('home.restore')}
                    </Button>
                    <IconButton className="home-trash-del" aria-label={tr('home.deleteForeverAria', { name: t.name || tr('home.projectFallback') })} title={tr('home.deleteForever')}
                      onClick={() => setDeleteTarget(t)}><Trash2 size={14} /></IconButton>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="home-foot">
        <button className="home-dev" onClick={() => window.api.openHelp(DEV_INSTAGRAM_URL)} title={t('home.devTitle')}>
          {t('home.devBy')} <b>Hamza Abika</b> <Instagram size={13} /> @hamza_abika
        </button>
        <span>{t('home.tagline')}</span>
      </footer>
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} label={t('home.projectActions')} />}
      {renameTarget && <RenameDialog entry={renameTarget} onSubmit={onRename} onClose={() => setRenameTarget(null)} />}
      {deleteTarget && (
        <ConfirmDialog icon={Trash2} title={deleteTarget === 'all' ? t('home.emptyTrashTitle') : t('home.deleteForeverTitle')}
          text={deleteText} confirmLabel={deleteTarget === 'all' ? t('home.emptyTrash') : t('home.deleteForever')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { if (deleteTarget === 'all') onEmptyTrash(); else onDeleteTrashed(deleteTarget); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
