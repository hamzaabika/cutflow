import React, { useState } from 'react';
import { AudioLines, Bot, Check, ChevronDown, CircleAlert, Download, Film, FolderOpen, Heart, History, Home, Info, Keyboard, MoreHorizontal, Save, Settings, Smartphone } from '../icons.jsx';
import ContextMenu from './ContextMenu.jsx';
import ShortcutsDialog from './ShortcutsDialog.jsx';
import { SUPPORT_URL } from './HomeScreen.jsx';
import { formatChord, getCurrentKeymap } from '../keymap.js';


// Next to the project name: where the project stands (it saves itself once it
// has a file). The shortcut names are read from the user's keymap at render
// time, so they never advertise a key that does something else.
const saveStates = () => {
  const save = getCurrentKeymap().bindings.save || [];
  return {
    new: ['Not saved yet', save.length ? `Not saved yet: choose Save (${formatChord(save[0])}) from the Menu once, then every change is saved automatically` : 'Not saved yet: choose Save from the Menu once, then every change is saved automatically'],
    saving: ['Saving…', 'Saving to the project file'],
    saved: ['Auto-saved', save.length > 1 ? `Every change is saved automatically to the project file. ${formatChord(save[1])}: save as` : 'Every change is saved automatically to the project file'],
    error: ['Not saved', 'The project file could not be written. Choose Save from the Menu to pick another place'],
  };
};

// Three zones (Hamza's UI review, 2026-11-10): left = wordmark, Home and ONE
// Menu that gathers the secondary actions; centre = the project name with its
// auto-save state and the backups entry; right = Export alone (the FlowAI
// toggle that sat beside it was removed on Hamza's order — the floating pill
// over the timeline is the panel's only entrance). The
// aspect-ratio picker no longer lives here — it was duplicated three times;
// it stays on the player badge and in Project Settings.
export default function TopBar({ project, dispatch, onOpen, onSave, saveState = 'new', onHistory, onBridge, bridgePending = 0, onExport, onExportAudio, onReframe, onSettings, onAbout, onHome, updateReady = false }) {
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
        <button className="btn btn-ghost" onClick={onHome} aria-label="Projects" title="Back to projects (home)"><Home size={15} /> <span className="top-word">Projects</span></button>
        <button className="btn btn-ghost" aria-haspopup="menu" aria-expanded={!!mainMenu} aria-label="Menu" title="Menu"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMainMenu({ x: r.left, y: r.bottom + 6 }); }}>
          <MoreHorizontal size={15} /> <span className="top-word">Menu</span> <ChevronDown size={13} />
        </button>
      </div>

      <div className="project-meta">
        <input className="project-name" value={project.name} aria-label="Project name" spellCheck={false}
          size={Math.min(34, Math.max(8, (project.name || '').length + 2))}
          onChange={(e) => set({ name: e.target.value })} />
        <span className={`save-state ${saveState}`} title={SAVE_STATES[saveState][1]} role="status">
          {saveState === 'saved' ? <Check size={13} /> : saveState === 'error' ? <CircleAlert size={13} /> : saveState === 'new' ? <span className="save-dot" aria-hidden="true" /> : null} {SAVE_STATES[saveState][0]}
        </span>
        {onHistory && (
          <>
            <span className="meta-div" aria-hidden="true" />
            <button className="btn btn-ghost" onClick={onHistory} aria-label="Project backups" title="Project backups: earlier saved and automatic states of this project, and restoring them"><History size={15} /> <span className="top-word">Backups</span></button>
          </>
        )}
      </div>

      <div className="top-actions">
        <div className="export-split">
          <button className="btn btn-export" onClick={onExport}><Download size={15} /> Export</button>
          <button className="btn btn-export caret" aria-label="More export options" aria-haspopup="menu"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 6 }); }}>
            <ChevronDown size={15} />
          </button>
        </div>
      </div>
      {/* Outside .top-actions/.top-left: those are size containers, which would shift these fixed-position menus. */}
      {mainMenu && (
        <ContextMenu x={mainMenu.x} y={mainMenu.y} label="Menu" onClose={() => setMainMenu(null)} items={[
          { label: 'Open project…', icon: FolderOpen, onClick: onOpen },
          { label: 'Save', icon: Save, shortcut: saveChord ? formatChord(saveChord) : undefined, onClick: () => onSave(false) },
          { label: 'Settings', icon: Settings, onClick: onSettings },
          'sep',
          ...(onBridge ? [{ label: bridgePending > 0 ? `Agent drafts (${bridgePending} waiting)` : 'Agent drafts', icon: Bot, onClick: onBridge }] : []),
          { label: 'Make vertical copy', icon: Smartphone, onClick: onReframe },
          'sep',
          { label: 'About Cutflow', icon: Info, hint: updateReady ? 'Update available' : undefined, onClick: onAbout },
          { label: 'Support the project', icon: Heart, onClick: () => window.api.openHelp(SUPPORT_URL) },
          { label: 'Keyboard shortcuts', icon: Keyboard, onClick: () => setShortcutsOpen(true) },
        ]} />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="Export" onClose={() => setMenu(null)} items={[
          { label: 'Video (MP4)', icon: Film, onClick: onExport },
          'sep',
          { label: 'Audio only (MP3)', icon: AudioLines, onClick: () => onExportAudio('mp3') },
          { label: 'Audio only (WAV)', icon: AudioLines, onClick: () => onExportAudio('wav') },
          { label: 'Audio only (M4A)', icon: AudioLines, onClick: () => onExportAudio('m4a') },
        ]} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </header>
  );
}
