import React, { useState } from 'react';
import { AudioLines, Bot, Check, ChevronDown, CircleAlert, Download, Film, FolderOpen, Gauge, Heart, History, Home, Info, Keyboard, MoreHorizontal, RotateCcw, Save, Settings, Smartphone } from '../icons.jsx';
import { WORKSPACE_IDS } from '../useWorkspaces.js';
import ContextMenu from './ContextMenu.jsx';
import ShortcutsDialog from './ShortcutsDialog.jsx';
import { SUPPORT_URL } from './HomeScreen.jsx';
import { formatChord, getCurrentKeymap } from '../keymap.js';
import { tr, useT } from '../i18n/index.jsx';


// Next to the project name: where the project stands (it saves itself once it
// has a file). The shortcut names are read from the user's keymap at render
// time, so they never advertise a key that does something else.
const saveStates = () => {
  const save = getCurrentKeymap().bindings.save || [];
  return {
    new: [tr('topbar.saveNew'), save.length ? tr('topbar.saveNewHintKey', { key: formatChord(save[0]) }) : tr('topbar.saveNewHint')],
    saving: [tr('topbar.saving'), tr('topbar.savingHint')],
    saved: [tr('topbar.saved'), save.length > 1 ? tr('topbar.savedHintKey', { key: formatChord(save[1]) }) : tr('topbar.savedHint')],
    error: [tr('topbar.saveError'), tr('topbar.saveErrorHint')],
  };
};

// Three zones (Hamza's UI review, 2026-11-10): left = wordmark, Home and ONE
// Menu that gathers the secondary actions; centre = the project name with its
// auto-save state and the backups entry; right = Export alone (the FlowAI
// toggle that sat beside it was removed on Hamza's order — the floating pill
// over the timeline is the panel's only entrance). The
// aspect-ratio picker no longer lives here — it was duplicated three times;
// it stays on the player badge and in Project Settings.
export default function TopBar({ project, dispatch, onOpen, onSave, saveState = 'new', onHistory, onBridge, bridgePending = 0, onExport, onExportAudio, onExportProjectZip, onReframe, onSettings, onPacks, onAbout, onHome, onResources, updateReady = false, workspace = 'default', onWorkspaceChange, onWorkspaceReset }) {
  const t = useT();
  const SAVE_STATES = saveStates();
  const [menu, setMenu] = useState(null);
  const [mainMenu, setMainMenu] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const set = (patch) => dispatch({ type: 'setProject', patch, transient: true });
  const saveChord = (getCurrentKeymap().bindings.save || [])[0];
  return (
    <header className="topbar">
      <div className="top-left">
        <div className="brand">
          <img src="./logo.png" alt="" className="brand-logo" draggable={false} />
          <span className="brand-name">Cut<b>flow</b></span>
        </div>
        <button className="btn btn-ghost" onClick={onHome} aria-label={t('topbar.projects')} title={t('topbar.backToProjects')}><Home size={15} /> <span className="top-word">{t('topbar.projects')}</span></button>
        <button className="btn btn-ghost" aria-haspopup="menu" aria-expanded={!!mainMenu} aria-label={t('topbar.menu')} title={t('topbar.menu')}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMainMenu({ x: r.left, y: r.bottom + 6 }); }}>
          <MoreHorizontal size={15} /> <span className="top-word">{t('topbar.menu')}</span> <ChevronDown size={13} />
        </button>
      </div>

      <div className="project-meta">
        <input className="project-name" value={project.name} aria-label={t('topbar.projectName')} spellCheck={false}
          size={Math.min(34, Math.max(8, (project.name || '').length + 2))}
          onChange={(e) => set({ name: e.target.value })} />
        <span className={`save-state ${saveState}`} title={SAVE_STATES[saveState][1]} role="status">
          {saveState === 'saved' ? <Check size={13} /> : saveState === 'error' ? <CircleAlert size={13} /> : saveState === 'new' ? <span className="save-dot" aria-hidden="true" /> : null} {SAVE_STATES[saveState][0]}
        </span>
        {onHistory && (
          <>
            <span className="meta-div" aria-hidden="true" />
            <button className="btn btn-ghost" onClick={onHistory} aria-label={t('topbar.backups')} title={t('topbar.backupsHint')}><History size={15} /> <span className="top-word">{t('topbar.backups')}</span></button>
          </>
        )}
      </div>

      <div className="top-actions">
        {/* Workspaces (P2-37): one control switches the whole arrangement
            (panel + sizes); the reset button restores the shipped preset. */}
        {onWorkspaceChange && (
          <label className="workspace-picker">
            <span className="sr-only">{t('workspace.label')}</span>
            <select value={workspace} aria-label={t('workspace.label')} onChange={(e) => onWorkspaceChange(e.target.value)}>
              {WORKSPACE_IDS.map((id) => <option key={id} value={id}>{t(`workspace.${id}`)}</option>)}
            </select>
            {onWorkspaceReset && (
              <button type="button" className="icon-btn" aria-label={t('workspace.reset')} title={t('workspace.resetTitle')} onClick={onWorkspaceReset}>
                <RotateCcw size={14} />
              </button>
            )}
          </label>
        )}
        <div className="export-split">
          <button className="btn btn-export" onClick={onExport}><Download size={15} /> {t('topbar.export')}</button>
          <button className="btn btn-export caret" aria-label={t('topbar.moreExportOptions')} aria-haspopup="menu"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 6 }); }}>
            <ChevronDown size={15} />
          </button>
        </div>
      </div>
      {/* Outside .top-actions/.top-left: those are size containers, which would shift these fixed-position menus. */}
      {mainMenu && (
        <ContextMenu x={mainMenu.x} y={mainMenu.y} label={t('topbar.menu')} onClose={() => setMainMenu(null)} items={[
          { label: t('topbar.openProject'), icon: FolderOpen, onClick: onOpen },
          { label: t('common.save'), icon: Save, shortcut: saveChord ? formatChord(saveChord) : undefined, onClick: () => onSave(false) },
          { label: t('settings.title'), icon: Settings, onClick: onSettings },
          ...(onPacks ? [{ label: t('prim.packs'), icon: FolderOpen, onClick: onPacks }] : []),
          'sep',
          ...(onBridge ? [{ label: bridgePending > 0 ? t('topbar.agentDraftsWaiting', { count: bridgePending }) : t('topbar.agentDrafts'), icon: Bot, onClick: onBridge }] : []),
          { label: t('topbar.makeVerticalCopy'), icon: Smartphone, onClick: onReframe },
          'sep',
          { label: t('topbar.about'), icon: Info, hint: updateReady ? t('topbar.updateAvailable') : undefined, onClick: onAbout },
          { label: t('topbar.supportProject'), icon: Heart, onClick: () => window.api.openHelp(SUPPORT_URL) },
          { label: t('topbar.shortcuts'), icon: Keyboard, onClick: () => setShortcutsOpen(true) },
          ...(onResources ? [{ label: t('res.title'), icon: Gauge, onClick: onResources }] : []),
        ]} />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={t('topbar.export')} onClose={() => setMenu(null)} items={[
          { label: t('topbar.exportVideo'), icon: Film, onClick: onExport },
          'sep',
          { label: t('topbar.exportAudioMp3'), icon: AudioLines, onClick: () => onExportAudio('mp3') },
          { label: t('topbar.exportAudioWav'), icon: AudioLines, onClick: () => onExportAudio('wav') },
          { label: t('topbar.exportAudioM4a'), icon: AudioLines, onClick: () => onExportAudio('m4a') },
          'sep',
          { label: t('topbar.exportZip'), icon: Download, onClick: onExportProjectZip },
        ]} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </header>
  );
}
