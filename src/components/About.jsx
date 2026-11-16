import React, { useEffect, useState } from 'react';
import { CheckCircle2, Compass, Download, Globe, Instagram, RefreshCw, Sparkles, WifiOff, X } from '../icons.jsx';
import { DEV_INSTAGRAM_URL } from './HomeScreen.jsx';
import { useT } from '../i18n/index.jsx';

// About Cutflow — version, the developer (Hamza Abika), his links, and a manual update
// check: nothing is checked automatically; the user clicks "Check for updates" and decides.
// The check asks the update feed on clipcrafts.pages.dev (see electron/updates.cjs). A failed
// check shows its reason as an error — "You're up to date" appears only after a successful
// check whose latest version is not newer than the installed one.
const DEV_SITE_URL = 'https://hamzaabika.com';

export function AboutDialog({ onClose, onWelcome }) {
  const t = useT();
  const [version, setVersion] = useState('');
  const [check, setCheck] = useState(null); // null | 'checking' | result object from updates:check
  useEffect(() => {
    window.api.appVersion?.().then(setVersion).catch(() => {});
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const runCheck = () => {
    setCheck('checking');
    setDl(null);
    window.api.updatesCheck?.(false).then((r) => setCheck(r || { error: t('about.updateCheckFailed') })).catch(() => setCheck({ error: t('about.updateCheckFailed') }));
  };
  const [dl, setDl] = useState(null); // in-app installer download state
  useEffect(() => window.api.onUpdateProgress?.((p) => setDl((d) => (d?.phase === 'downloading' ? { phase: 'downloading', ...p } : d))), []);
  const startDownload = () => {
    setDl({ phase: 'downloading', received: 0, total: 0 });
    window.api.updatesDownload?.()
      .then((r) => setDl(r?.error ? { phase: 'error', error: r.error } : { phase: 'done', fileName: r?.fileName || '', verified: r?.verified === true }))
      .catch(() => setDl({ phase: 'error', error: t('about.downloadFailed') }));
  };
  const openInstaller = () => window.api.updatesOpenInstaller?.().then((r) => { if (r?.error) setDl({ phase: 'error', error: r.error }); }).catch(() => {});
  const startInstall = () => {
    setDl({ phase: 'installing' });
    window.api.updatesInstall?.()
      .then((r) => {
        if (r?.error) setDl((d) => ({ phase: 'install-error', error: r.error, fileName: d?.fileName || '' }));
        else if (r?.opened) setDl((d) => ({ phase: 'opened', fileName: d?.fileName || '' }));
        else setDl((d) => ({ phase: 'restarting', fileName: d?.fileName || '' }));
      })
      .catch(() => setDl((d) => ({ phase: 'install-error', error: t('about.installFailed'), fileName: d?.fileName || '' })));
  };
  const mb = (n) => (n / 1048576).toFixed(1);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal about about2${check && check.newer ? ' has-update' : ''}`}>
        <button className="icon-btn about-close" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button>
        <div className="about-hero">
          <div className="about-halo"><img src="./logo.png" alt="" draggable={false} /></div>
          <h3 id="about-title">Cut<span className="grad">flow</span></h3>
          <span className="about-vpill">{t('about.version', { v: version || '2.0.0' })}</span>
          <p className="about-tag">{t('about.tag')}</p>
        </div>
        <div className="about-devcard">
          <span className="about-devlabel">{t('about.developedBy')}</span>
          <b className="about-devname">Hamza Abika</b>
          <div className="about-devlinks">
            <button className="btn btn-ig" onClick={() => window.api.openHelp(DEV_INSTAGRAM_URL)}><Instagram size={14} /> @hamza_abika</button>
            <button className="btn" onClick={() => window.api.openHelp(DEV_SITE_URL)}><Globe size={14} /> hamzaabika.com</button>
          </div>
        </div>
        <div className="about-chips">
          <span>{t('about.offline')}</span>
          <span>{t('about.noWatermark')}</span>
          <span>{t('about.free')}</span>
        </div>
        {onWelcome && (
          <div className="about-tour">
            <button className="btn" onClick={onWelcome}><Compass size={14} /> {t('about.welcomeCard')}</button>
            <span className="muted small">{t('about.welcomeNote')}</span>
          </div>
        )}
        <div className="about-updates">
          {check !== 'checking' && !(check && check.newer) && (
            <button className="btn" onClick={runCheck}><RefreshCw size={14} /> {t('about.checkUpdates')}</button>
          )}
          {check === 'checking' && <span className="about-status"><RefreshCw size={14} className="spin" /> {t('about.checking')}</span>}
          {check && check.newer && (
            <div className="about-update">
              <b>{t('about.available', { v: check.latest })}</b>
              {(check.releaseDate || check.size) && <span className="muted small">{[check.releaseDate, check.size].filter(Boolean).join(' · ')}</span>}
              {check.notes && <span className="about-notes">{check.notes}</span>}
              {!dl && (
                <>
                  <div className="about-devlinks">
                    <button className="btn btn-primary btn-sm" onClick={startDownload}><Download size={13} /> {t('about.downloadInstall')}</button>
                    {check.notesUrl && <button className="btn btn-sm" onClick={() => window.api.openHelp(check.notesUrl)}>{t('about.whatsNew')}</button>}
                  </div>
                  <span className="muted small">{t('about.youHave', { v: check.current })} <button className="linklike" onClick={() => window.api.openHelp(check.downloadUrl)}>{t('about.orBrowser')}</button></span>
                </>
              )}
              {dl?.phase === 'downloading' && (
                <div className="about-dl">
                  <div className="about-dl-track"><div className="about-dl-fill" style={{ width: dl.total ? `${Math.min(100, Math.round((dl.received / dl.total) * 100))}%` : '30%' }} /></div>
                  <span className="muted small">{dl.total ? t('about.downloadingOf', { a: mb(dl.received), b: mb(dl.total) }) : t('about.downloading')}</span>
                </div>
              )}
              {dl?.phase === 'done' && (
                <>
                  <span className="about-status ok"><CheckCircle2 size={15} /> {dl.fileName ? t('about.downloadedFile', { file: dl.fileName }) : t('about.downloadedPlain')}{dl.verified ? t('about.verifiedSuffix') : ''}</span>
                  <div className="about-devlinks">
                    <button className="btn btn-primary btn-sm" onClick={startInstall}><Download size={13} /> {t('about.installRestart')}</button>
                    <button className="btn btn-sm" onClick={openInstaller}>{t('about.openInstaller')}</button>
                  </div>
                  <span className="muted small">{t('about.installNote')}</span>
                </>
              )}
              {dl?.phase === 'installing' && (
                <span className="about-status"><RefreshCw size={14} className="spin" /> {t('about.installing')}</span>
              )}
              {dl?.phase === 'restarting' && (
                <span className="about-status ok"><CheckCircle2 size={15} /> {t('about.restarting')}</span>
              )}
              {dl?.phase === 'opened' && (
                <>
                  <span className="about-status ok"><CheckCircle2 size={15} /> {dl.fileName ? t('about.downloadedFile', { file: dl.fileName }) : t('about.downloadedPlain')}</span>
                  <span className="muted small">{t('about.openedNote')}</span>
                </>
              )}
              {dl?.phase === 'install-error' && (
                <>
                  <span className="about-status error"><WifiOff size={15} /> {dl.error}</span>
                  <div className="about-devlinks">
                    <button className="btn btn-primary btn-sm" onClick={startInstall}><Download size={13} /> {t('about.installRestart')}</button>
                    <button className="btn btn-sm" onClick={openInstaller}>{t('about.openInstaller')}</button>
                  </div>
                </>
              )}
              {dl?.phase === 'error' && (
                <span className="about-status error"><WifiOff size={15} /> {dl.error} <button className="btn btn-ghost btn-sm" onClick={startDownload}>{t('about.tryAgain')}</button></span>
              )}
            </div>
          )}
          {check && check.storeManaged && (
            <span className="about-status ok"><CheckCircle2 size={15} /> {t('about.snap')}</span>
          )}
          {check && !check.newer && !check.error && !check.storeManaged && (
            <span className="about-status ok"><CheckCircle2 size={15} /> {t('about.upToDate', { v: check.latest })}</span>
          )}
          {check && check.error && (
            <span className="about-status error"><WifiOff size={15} /> {check.error} <button className="btn btn-ghost btn-sm" onClick={runCheck}>{t('about.tryAgain')}</button></span>
          )}
        </div>
      </div>
    </div>
  );
}

// A one-time banner shape kept for compatibility with App.jsx; the live update flow is the
// manual check inside the About dialog, which is where the download is offered.
export function UpdateNotice({ update, onDismiss, onAbout }) {
  const t = useT();
  if (!update?.newer) return null;
  return (
    <div className="stats-note update-note" role="dialog" aria-labelledby="update-note-title">
      <Sparkles size={18} />
      <div className="stats-note-body">
        <b id="update-note-title">{t('about.available', { v: update.latest })}</b>
        <span>{t('about.youHaveVersion', { v: update.current })}</span>
        <div className="stats-note-actions">
          <button className="btn btn-sm btn-primary" onClick={() => { window.api.openHelp(update.downloadUrl); onDismiss(); }}><Download size={13} /> {t('about.download')}</button>
          {update.notesUrl && <button className="btn btn-sm" onClick={() => window.api.openHelp(update.notesUrl)}>{t('about.whatsNew')}</button>}
          <button className="btn btn-sm btn-ghost" onClick={onDismiss}>{t('about.later')}</button>
        </div>
      </div>
      <button className="icon-btn" aria-label={t('common.close')} onClick={onDismiss}><X size={15} /></button>
    </div>
  );
}

// Startup is deliberately silent about updates: checking is the user's choice, from the
// "Check for updates" button in About. This hook stays as the App's update-state holder
// (kept inert) so the TopBar/notice wiring has a single home if an automatic check is
// ever wanted again.
export function useUpdateCheck() {
  const [update, setUpdate] = useState(null);
  return [update, setUpdate];
}
