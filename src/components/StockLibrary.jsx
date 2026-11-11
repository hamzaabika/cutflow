import React, { useEffect, useState } from 'react';
import { ExternalLink, Image as ImageIcon, KeyRound, Layers, Loader2, Plus, Search, Video, WifiOff, X } from '../icons.jsx';
import { formatTime, toFileUrl } from '../store.js';
import { FavStar, favStock } from '../favorites.jsx';
import { useT, tr, getLanguage } from '../i18n/index.jsx';

// Chip label -> { q, category } for Pixabay. Green screen, intros and the like are searches, not categories.
export const CHIPS = {
  video: [
    ['Trending', {}], ['Green screen', { q: 'green screen' }], ['Background', { q: 'background loop' }], ['Nature', { category: 'nature' }],
    ['Travel', { category: 'travel' }], ['City', { q: 'city' }], ['People', { category: 'people' }], ['Business', { category: 'business' }],
    ['Abstract', { q: 'abstract' }], ['Sky', { q: 'sky clouds' }], ['Ocean', { q: 'ocean' }], ['Particles', { q: 'particles' }],
    ['Food', { category: 'food' }], ['Sports', { category: 'sports' }], ['Animals', { category: 'animals' }], ['Technology', { category: 'computer' }],
  ],
  photo: [
    ['Trending', {}], ['Backgrounds', { category: 'backgrounds' }], ['Nature', { category: 'nature' }], ['Travel', { category: 'travel' }],
    ['People', { category: 'people' }], ['Business', { category: 'business' }], ['Food', { category: 'food' }], ['Animals', { category: 'animals' }],
    ['Places', { category: 'places' }], ['Buildings', { category: 'buildings' }], ['Sports', { category: 'sports' }], ['Fashion', { category: 'fashion' }],
    ['Technology', { category: 'computer' }], ['Music', { category: 'music' }], ['Science', { category: 'science' }], ['Feelings', { category: 'feelings' }],
  ],
};

const thumbCache = new Map(); // remote thumbnail -> local file URL
export function Thumb({ url, alt }) {
  const [src, setSrc] = useState(thumbCache.get(url) || '');
  useEffect(() => {
    if (!url || thumbCache.has(url)) return undefined;
    let alive = true;
    window.api.stockThumb(url).then((r) => {
      if (!r.path) return;
      const u = toFileUrl(r.path);
      thumbCache.set(url, u);
      if (alive) setSrc(u);
    });
    return () => { alive = false; };
  }, [url]);
  return src ? <img src={src} alt={alt} draggable={false} /> : <div className="stock-ph" aria-hidden="true" />;
}

// Stock photos and videos from Pixabay.
export default function StockLibrary({ onStockAdd, onOpenSettings, hasKey, kind = 'video', chip = 'Trending', onKindChange }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [orientation, setOrientation] = useState('');
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  const [busy, setBusy] = useState({}); // id -> 'main' | 'overlay'
  const [addError, setAddError] = useState('');

  const load = async (page) => {
    const preset = (CHIPS[kind].find(([c]) => c === chip) || CHIPS[kind][0])[1];
    const opts = q.trim() ? { q: q.trim() } : preset;
    setRes((r) => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    const out = await window.api.stockSearch({ kind, ...opts, orientation, page });
    if (out.error) return setRes((r) => ({ ...r, loading: false, error: out.error }));
    setRes((r) => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(''); }, [kind, chip]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasKey) load(1); }, [kind, chip, orientation, hasKey]);

  const add = async (item, where) => {
    setBusy((b) => ({ ...b, [item.id]: where }));
    setAddError('');
    const r = await onStockAdd(item, where);
    setBusy((b) => ({ ...b, [item.id]: undefined }));
    if (r?.error) setAddError(r.error);
  };

  if (!hasKey) {
    return (
      <div className="card stock-key">
        <div className="card-row">
          <span className="card-icon"><KeyRound size={18} /></span>
          <div>
            <b>{t('stock.title')}</b>
            <p>{t('stock.note')}</p>
          </div>
        </div>
        <div className="stock-key-actions">
          <button className="btn btn-sm" onClick={() => window.api.openHelp('https://pixabay.com/api/docs/')}><ExternalLink size={13} /> {t('lib.getFreeKey')}</button>
          <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>{t('topbar.openSettings')}</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="stock-top">
        <b className="tab-title">{t(kind === 'video' ? 'stock.videosTitle' : 'stock.photosTitle')} · {chip}</b>
        {kind === 'photo' && (
          <select className="stock-orient" value={orientation} aria-label={t('stock.orientation')} onChange={(e) => setOrientation(e.target.value)}>
            <option value="">{t('stock.anyShape')}</option>
            <option value="horizontal">{t('stock.landscape')}</option>
            <option value="vertical">{t('stock.portrait')}</option>
          </select>
        )}
      </div>
      <form className="lib-search" onSubmit={(e) => { e.preventDefault(); load(1); }}>
        {onKindChange && (
          <select className="stock-kind-select" value={kind} aria-label={t('stock.kind')} onChange={(e) => onKindChange(e.target.value)}>
            <option value="video">{t('stock.videosOpt')}</option>
            <option value="photo">{t('stock.photosOpt')}</option>
          </select>
        )}
        <Search size={14} aria-hidden="true" />
        <input type="search" value={q} placeholder={t(kind === 'video' ? 'stock.searchVideos' : 'stock.searchPhotos')} aria-label={t('stock.searchMedia')}
          onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="lib-search-clear" aria-label={t('lib.clearSearch')} onClick={() => setQ('')}><X size={13} /></button>}
      </form>
      {res.error && <div className="lib-error"><WifiOff size={15} /> <span>{res.error}</span> <button className="btn btn-sm" onClick={() => load(1)}>{t('common.retry')}</button></div>}
      {addError && <p className="error-text">{addError}</p>}
      <div className="stock-grid">
        {res.results.map((it) => (
          <div key={it.id} className="stock-tile" title={t('stock.tileTitle', { tags: it.tags, user: it.user })}
            onDoubleClick={() => add(it, 'main')}>
            <Thumb url={it.thumb} alt={it.tags} />
            {it.kind === 'video' && <span className="asset-dur">{formatTime(it.duration).slice(0, 5)}</span>}
            <FavStar entry={favStock(it)} className="tile-star" />
            {busy[it.id] ? (
              <span className="stock-busy"><Loader2 size={18} className="spin" /> {t('stock.downloading')}</span>
            ) : (
              <span className="stock-actions">
                <button onClick={() => add(it, 'overlay')} aria-label={t('stock.addOverlay')} title={t('stock.addOverlayTitle')}><Layers size={13} /></button>
                <button onClick={() => add(it, 'main')} aria-label={t('stock.addMain')} title={t('stock.addMainTitle')}><Plus size={14} /></button>
              </span>
            )}
          </div>
        ))}
      </div>
      {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('lib.loading')}</div>}
      {!res.loading && !res.error && !res.results.length && <p className="empty-note">{t('stock.nothing')}</p>}
      {!res.loading && res.page < res.pages && res.results.length > 0 && (
        <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>{t('lib.loadMore')}</button>
      )}
      <p className="lib-note">{t('stock.noteFooter1')}<b>Pixabay</b>{t('stock.noteFooter2')}</p>
    </>
  );
}
