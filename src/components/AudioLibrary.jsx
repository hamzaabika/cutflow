import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Copyright, ExternalLink, KeyRound, Loader2, Mic, Music, Pause, Play, Plus, Search, Square, Upload, WifiOff, X } from '../icons.jsx';
import { formatTime, toFileUrl } from '../store.js';
import { FavStar, favLibrary, useFavorites } from '../favorites.jsx';
import TextToSpeech from './TextToSpeech.jsx';
import PackMusic from './PackMusic.jsx';
import { SFX_CATS, SFX_ITEMS } from '../sfx.js';
import { AUDIO_PRESETS, PRESET_CATS, activePreset } from '../fx/audioPresets.js';
import Card from '../ui/Card.jsx';
import { useT } from '../i18n/index.jsx';
import { libName, slugifyPhrase } from '../i18n/libNames.js';

// Chip label -> search words. Openverse matches titles and tags, so some genres search better under another word.
export const MUSIC_TAGS = [
  ['Vlog', 'upbeat'], ['Happy', 'happy'], ['Chill', 'chill'], ['Epic', 'epic'], ['Cinematic', 'cinematic'], ['Inspiring', 'inspiring'],
  ['Hip hop', 'beat'], ['Rap', 'rap'], ['Dance', 'dance'], ['Electronic', 'electro'], ['Funny', 'funny'], ['Romantic', 'romantic'],
  ['Sad', 'sad'], ['Travel', 'travel'], ['Fitness', 'energy'], ['Corporate', 'motivational'], ['Acoustic', 'guitar'],
];
// Sound effects: [label, search words, online category]. Both online sources are searched
// together (the category browses one of them, the words the other).
export const SFX_TAGS = [
  ['Transition', 'transition', 'transition', ['Transition']], ['Whoosh', 'whoosh'], ['UI', 'interface', 'ui', ['UI']],
  ['Impact', 'impact', 'impact', ['Hit']], ['Cartoon', 'cartoon', 'cartoon', ['Funny']], ['Pop', 'pop'], ['Click', 'click'],
  ['Notification', 'notification'], ['Laugh', 'laugh'], ['Applause', 'applause'], ['Camera', 'camera'], ['Explosion', 'explosion'],
  ['Magic', 'magic'], ['Horror', 'horror', 'horror'], ['Ambience', 'ambience', 'ambience', ['Ambience']], ['Animals', 'animal', 'animal'],
  ['Human', 'human', 'human'], ['Footsteps', 'footsteps', 'footsteps'], ['Crowd', 'crowd', 'crowd'], ['Vehicles', 'vehicle', 'vehicle'],
  ['Doors', 'door', 'door'], ['Water', 'water', 'water'], ['Wind', 'wind'], ['Foley', 'foley', 'foley'],
];

// Soundza (sound effects from soundza.com, searched through its API): [label, search params].
// Chips lean on the API's own ranking filters (good_for) or a style; the words go in the box.
export const SOUNDZA_TAGS = [
  ['Whoosh', { q: 'whoosh' }], ['Transition', { goodFor: 'transition' }], ['UI clicks', { goodFor: 'ui_click' }],
  ['Notification', { goodFor: 'notification' }], ['Impact', { goodFor: 'impact_on_beat' }], ['Reveal', { goodFor: 'reveal' }],
  ['Footsteps', { goodFor: 'footsteps' }], ['Magic', { q: 'magic' }], ['Explosion', { q: 'explosion' }],
  ['Cartoon', { style: 'cartoon' }], ['Retro', { style: 'retro' }], ['Ambience', { type: 'ambience', goodFor: 'background_bed' }],
];

// Trolls (meme sounds from MyInstants): [label, search words, list]. Trending and Best browse the site's lists.
export const TROLL_TAGS = [
  ['Trending', '', 'trending'], ['Best of all time', '', 'best'], ['Bruh', 'bruh'], ['Vine boom', 'vine boom'], ['Laugh', 'laugh'],
  ['Fail', 'fail'], ['Wow', 'wow'], ['Airhorn', 'airhorn'], ['Sus', 'among us'], ['Sad', 'sad violin'], ['Scream', 'scream'],
  ['Fart', 'fart'], ['Anime', 'anime'], ['Gaming', 'game over'],
];

// One shared player for previews: play() resolves the file (online sounds are downloaded once
// into the library folder) and plays it. Soundza results carry a preview link: the main
// process fetches that small preview file once (the page itself may only play local media),
// and it never counts as a download of the sound.
function usePreview() {
  const audio = useRef(null);
  const [state, setState] = useState({ id: null, loading: false, error: '', progress: 0 });
  useEffect(() => {
    const a = new Audio();
    a.onended = () => setState((s) => ({ ...s, id: null, progress: 0 }));
    // Preview progress (P5): the playing row paints a thin fill from this.
    a.ontimeupdate = () => setState((s) => (s.id ? { ...s, progress: a.duration > 0 ? a.currentTime / a.duration : 0 } : s));
    audio.current = a;
    return () => a.pause();
  }, []);
  const toggle = async (item) => {
    const a = audio.current;
    if (state.id === item.id && !state.loading) {
      a.pause();
      return setState({ id: null, loading: false, error: '', progress: 0 });
    }
    a.pause();
    setState({ id: item.id, loading: true, error: '', progress: 0 });
    // Imported files (favorites) play straight from disk; Soundza previews are fetched by the
    // main process; other library sounds are resolved (and downloaded once).
    const res = item.path ? { path: item.path } : item.previewUrl ? await window.api.soundzaPreview(item) : await window.api.libraryFile(item);
    if (res.error) return setState({ id: null, loading: false, error: res.error, progress: 0 });
    a.src = toFileUrl(res.path);
    a.play().catch(() => {});
    setState({ id: item.id, loading: false, error: '', progress: 0 });
  };
  const stop = () => {
    audio.current?.pause();
    setState({ id: null, loading: false, error: '', progress: 0 });
  };
  return { ...state, toggle, stop };
}

function Row({ item, preview, onAdd, adding, fav = item.path ? null : favLibrary(item) }) {
  const t = useT();
  const playing = preview.id === item.id;
  return (
    <div className={`lib-row ${playing ? 'on' : ''}`} onDoubleClick={() => onAdd(item)}>
      <button className="lib-play" onClick={() => preview.toggle(item)} aria-label={playing ? t('lib.stopTitle', { title: item.title }) : t('lib.playTitle', { title: item.title })}>
        {playing && preview.loading ? <Loader2 size={15} className="spin" /> : playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <div className="lib-meta">
        <b title={item.title}>{item.title}</b>
        <span className="lib-sub">
          <span>{item.provider === 'sfxmint' || item.provider === 'soundza' ? (item.category || '').replace(/^./, (c) => c.toUpperCase()) || item.creator : item.creator}</span>
          {item.license === 'by' && (
            <span className="lic-ico" title={t('lib.creditTitle')}><Copyright size={13} /></span>
          )}
        </span>
      </div>
      {item.duration > 0 && <span className="lib-dur">{formatTime(item.duration).slice(0, 5)}</span>}
      {playing && <span className="lib-prog" style={{ width: `${Math.round((preview.progress || 0) * 100)}%` }} aria-hidden="true" />}
      {fav && <FavStar entry={fav} />}
      <button className="lib-add" onClick={() => onAdd(item)} aria-label={t('lib.addAtPlayhead', { title: item.title })} title={t('lib.addAtPlayheadTitle')} disabled={adding === item.id}>
        {adding === item.id ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
      </button>
    </div>
  );
}

function OnlineSearch({ kind, tags, preview, onAdd, adding, fixedTag }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [ownTag, setTag] = useState(tags[0][0]);
  const tag = fixedTag || ownTag;
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  const chip = tags.find(([label]) => label === tag) || tags[0];
  const query = q.trim() || chip[1];
  const load = async (page) => {
    setRes((r) => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    const out = await window.api.librarySearch({ kind, q: query, category: q.trim() ? '' : chip[2], page });
    if (out.error) return setRes((r) => ({ ...r, loading: false, error: out.error }));
    setRes((r) => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(''); }, [fixedTag]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [tag, kind]);
  return (
    <>
      <form className="lib-search" onSubmit={(e) => { e.preventDefault(); load(1); }}>
        <Search size={14} aria-hidden="true" />
        <input type="search" value={q} placeholder={kind === 'music' ? t('lib.searchMusic') : kind === 'trolls' ? t('lib.searchMeme') : t('lib.searchSfx')} aria-label={t('lib.searchLibrary')}
          onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="lib-search-clear" aria-label={t('lib.clearSearch')} onClick={() => setQ('')}><X size={13} /></button>}
      </form>
      {!fixedTag && <div className="chips scroll-x">
        {tags.map(([t]) => (
          <button key={t} className={`chip ${!q.trim() && tag === t ? 'on' : ''}`} onClick={() => { setQ(''); setTag(t); }}>{libName(kind === 'music' ? 'mood' : kind === 'soundza' ? 'sztag' : kind === 'trolls' ? 'trolltag' : 'sfxtag', slugifyPhrase(t), t)}</button>
        ))}
      </div>}
      {res.error && (
        <div className="lib-error"><WifiOff size={15} /> <span>{res.error}</span> <button className="btn btn-sm" onClick={() => load(1)}>{t('common.retry')}</button></div>
      )}
      <div className="lib-list">
        {res.results.map((it) => <Row key={it.id} item={it} preview={preview} onAdd={onAdd} adding={adding} />)}
        {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('lib.loading')}</div>}
        {!res.loading && !res.error && !res.results.length && <p className="empty-note">{t('lib.nothingFor', { q: query || tag })}</p>}
        {!res.loading && res.page < res.pages && res.results.length > 0 && (
          <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>{t('lib.loadMore')}</button>
        )}
      </div>
    </>
  );
}

// Soundza search: needs the user's free Soundza key (Settings); without one it shows the same
// "get a free key" card the stock library uses. Results preview from Soundza's preview links;
// adding downloads the full file once, through the shared library-add flow.
function SoundzaSearch({ fixedTag, preview, onAdd, adding, onOpenSettings }) {
  const t = useT();
  const [hasKey, setHasKey] = useState(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  const chip = SOUNDZA_TAGS.find(([label]) => label === fixedTag) || SOUNDZA_TAGS[0];
  useEffect(() => { window.api.soundzaStatus().then((s) => setHasKey(!!s.hasKey)).catch(() => setHasKey(false)); }, []);
  const load = async (page) => {
    setRes((r) => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    const out = await window.api.soundzaSearch({ ...chip[1], q: q.trim(), page });
    if (out.error) return setRes((r) => ({ ...r, loading: false, error: out.error }));
    setRes((r) => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(''); }, [fixedTag]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasKey) load(1); }, [fixedTag, hasKey]);

  if (hasKey === null) return <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('lib.loading')}</div>;
  if (!hasKey) {
    return (
      <Card className="stock-key">
        <div className="card-row">
          <span className="card-icon"><KeyRound size={18} /></span>
          <div>
            <b>{t('lib.soundzaTitle')}</b>
            <p>{t('lib.soundzaNote')}</p>
          </div>
        </div>
        <div className="stock-key-actions">
          <button className="btn btn-sm" onClick={() => window.api.openHelp('https://soundza.com/developers/keys')}><ExternalLink size={13} /> {t('lib.getFreeKey')}</button>
          <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>{t('topbar.openSettings')}</button>
        </div>
      </Card>
    );
  }
  return (
    <>
      <form className="lib-search" onSubmit={(e) => { e.preventDefault(); load(1); }}>
        <Search size={14} aria-hidden="true" />
        <input type="search" value={q} placeholder={t('lib.searchSfx')} aria-label={t('lib.searchSoundza')}
          onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="lib-search-clear" aria-label={t('lib.clearSearch')} onClick={() => setQ('')}><X size={13} /></button>}
      </form>
      {res.error && (
        <div className="lib-error"><WifiOff size={15} /> <span>{res.error}</span> <button className="btn btn-sm" onClick={() => load(1)}>{t('common.retry')}</button></div>
      )}
      <div className="lib-list">
        {res.results.map((it) => <Row key={it.id} item={it} preview={preview} onAdd={onAdd} adding={adding} />)}
        {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('lib.loading')}</div>}
        {!res.loading && !res.error && !res.results.length && <p className="empty-note">{t('lib.nothingFor', { q: q.trim() || fixedTag })}</p>}
        {!res.loading && res.page < res.pages && res.results.length > 0 && (
          <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>{t('lib.loadMore')}</button>
        )}
      </div>
      <p className="lib-note">{t('lib.poweredBy1')} <a href="#" onClick={(e) => { e.preventDefault(); window.api.openHelp('https://soundza.com'); }}>soundza</a> {t('lib.poweredBy2')}</p>
    </>
  );
}


// Bundled sound effects (10/10 step 3): Cutflow's own synthesized SFX, shipped in
// shared/sfx/ and listed from src/sfx.js (generated by scripts/gen-bundled-sfx.cjs).
// Fully offline: preview plays the file, + drops it on the timeline like any audio
// asset. Below them, the AudioFx preset packs apply to the selected clip.
function BundledSfx({ preview, onAddFile, target, updateTarget }) {
  const t = useT();
  const [paths, setPaths] = useState(null);
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      for (const it of SFX_ITEMS) out[it.id] = await window.api.bundledPath('sfx', it.file);
      if (live) setPaths(out);
    })();
    return () => { live = false; };
  }, []);
  const add = async (item) => {
    if (!item.path) return;
    setAdding(item.id);
    setErr('');
    const r = await onAddFile(item.path);
    setAdding(null);
    if (r?.error) setErr(r.error);
  };
  const needle = q.trim().toLowerCase();
  const shown = SFX_ITEMS.filter((it) => (cat === 'All' || it.cat === cat) && (!needle || it.name.toLowerCase().includes(needle)));
  const clip = target?.clip || null;
  const active = clip ? activePreset(clip.audioFx) : null;
  return (
    <>
      <div className="tab-title">{t('lib.bundledTitle', { count: SFX_ITEMS.length })}</div>
      <p className="lib-src-note">{t('lib.bundledNote')}</p>
      {err && <p className="error-text">{err}</p>}
      <form className="lib-search" onSubmit={(e) => e.preventDefault()}>
        <Search size={14} aria-hidden="true" />
        <input type="search" value={q} placeholder={t('lib.searchBundled')} aria-label={t('lib.searchBundledAria')}
          onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="lib-search-clear" aria-label={t('lib.clearSearch')} onClick={() => setQ('')}><X size={13} /></button>}
      </form>
      <div className="chips scroll-x" role="group" aria-label={t('lib.bundledCatAria')}>
        {['All', ...SFX_CATS].map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c === 'All' ? t('lib.all') : libName('cat', slugifyPhrase(c), c)}{c !== 'All' ? ` · ${SFX_ITEMS.filter((it) => it.cat === c).length}` : ` · ${SFX_ITEMS.length}`}
          </button>
        ))}
      </div>
      <div className="lib-list">
        {!paths && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('lib.loading')}</div>}
        {paths && shown.map((it) => (
          <Row key={it.id} preview={preview} adding={adding}
            item={{ id: it.id, title: it.name, path: paths[it.id], provider: 'bundled', creator: t('lib.bundledCreator', { cat: libName('cat', slugifyPhrase(it.cat), it.cat) }), duration: it.dur }}
            onAdd={add} />
        ))}
        {paths && !shown.length && <p className="empty-note">{t('lib.noBundledMatch')}</p>}
      </div>
      <div className="tab-title">{t('lib.presetPacks')}</div>
      <p className="lib-src-note">{clip
        ? t('lib.packApplyNote')
        : t('lib.packSelectNote')}</p>
      {PRESET_CATS.map((pc) => (
        <div key={pc}>
          <div className="afx-group-title">{libName('cat', slugifyPhrase(pc), pc)} · {AUDIO_PRESETS.filter((pr) => pr.cat === pc).length}</div>
          <div className="afx-presets" role="group" aria-label={t('lib.presetsAria', { cat: libName('cat', slugifyPhrase(pc), pc) })}>
            {AUDIO_PRESETS.filter((pr) => pr.cat === pc).map((pr) => (
              <button key={pr.id} type="button" disabled={!clip}
                className={`afx-chip ${active?.id === pr.id ? 'on' : ''}`}
                aria-pressed={active?.id === pr.id} title={t('lib.presetTitle', { name: libName('afx', pr.id, pr.name) })}
                onClick={() => clip && updateTarget({ audioFx: structuredClone(pr.fx) })}>{libName('afx', pr.id, pr.name)}</button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// Audio panel: Music, Sound effects and Yours (imported audio and voice-over).
export default function AudioLibrary({ media, project, onImport, onAddMedia, onLibraryAdd, onAddFile, onTtsAdd, selectedText, onOpenSettings, recorder, onStartRecord, MediaCard, onRemoveMedia, onPeek, peekId, target, updateTarget, section = 'music:Vlog' }) {
  const t = useT();
  // Split on the FIRST colon only: pack sections carry a second one ('music:pack:Library').
  const [group, sub] = section.includes(':') ? [section.slice(0, section.indexOf(':')), section.slice(section.indexOf(':') + 1)] : [section, ''];
  const view = group === 'yours' && sub === 'favorites' ? 'favorites' : group;
  // The synthesized built-in sounds were removed from the app; favorites saved while they
  // existed are dropped here so they never offer a sound that is gone.
  const favs = useFavorites().list.filter((e) => e.type === 'audio' && e.item?.provider !== 'builtin');
  const [adding, setAdding] = useState(null);
  const [addError, setAddError] = useState('');
  const [copied, setCopied] = useState(false);
  const preview = usePreview();
  useEffect(() => preview.stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => preview.stop(), [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (item) => {
    setAdding(item.id);
    setAddError('');
    const res = await onLibraryAdd(item);
    setAdding(null);
    if (res?.error) setAddError(res.error);
  };

  // Credit lines for CC BY sounds used on the timeline.
  const used = new Set([...project.audioClips, ...project.videoClips, ...(project.overlayClips || [])].map((c) => c.mediaId));
  const credits = media.filter((m) => m.credit && m.credit.license === 'by' && used.has(m.id)).map((m) => m.credit.line);
  const copyCredits = async () => {
    await navigator.clipboard.writeText(credits.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const audio = media.filter((m) => m.type === 'audio');
  return (
    <>
      {(preview.error || addError) && <p className="error-text">{preview.error || addError}</p>}

      {view === 'music' && (sub.startsWith('pack:') ? (
        <PackMusic collection={sub.slice(5)} onAddFile={onAddFile} />
      ) : (
        <>
          <div className="tab-title">{t('lib.musicTitle', { sub: libName('mood', slugifyPhrase(sub), sub) })}</div>
          <OnlineSearch kind="music" tags={MUSIC_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} />
        </>
      ))}

      {view === 'sfx' && (sub === 'bundled' ? (
        <BundledSfx preview={preview} onAddFile={onAddFile} target={target} updateTarget={updateTarget} />
      ) : sub.startsWith('pack:') ? (
        <PackMusic group="Sound FX" collection={sub.slice(5)} onAddFile={onAddFile} />
      ) : (
        <>
          <div className="tab-title">{t('lib.sfxTitle', { sub: libName('sfxtag', slugifyPhrase(sub), sub) })}</div>
          <p className="lib-src-note">{t('lib.sfxNote')}</p>
          <OnlineSearch kind="sfxall" tags={SFX_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} />
        </>
      ))}

      {view === 'soundza' && (
        <>
          <div className="tab-title">{t('lib.soundzaSectionTitle', { sub: libName('sztag', slugifyPhrase(sub), sub) })}</div>
          <SoundzaSearch fixedTag={sub} preview={preview} onAdd={add} adding={adding} onOpenSettings={onOpenSettings} />
        </>
      )}

      {view === 'trolls' && (
        <>
          <div className="tab-title">{t('lib.trollsTitle', { sub: libName('trolltag', slugifyPhrase(sub), sub) })}</div>
          <OnlineSearch kind="trolls" tags={TROLL_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} />
          <p className="lib-note">{t('lib.soundsFrom')} <a href="#" onClick={(e) => { e.preventDefault(); window.api.openHelp('https://www.myinstants.com'); }}>MyInstants</a>.</p>
        </>
      )}

      {view === 'favorites' && (
        <>
          <div className="tab-title">{t('lib.favSounds')}</div>
          {!favs.length && (
            <p className="empty-note">{t('lib.favEmpty')}</p>
          )}
          <div className="lib-list">
            {favs.map((e) => (e.source === 'file' ? (
              e.missing ? (
                <div key={e.key} className="lib-row missing" title={e.item.path}>
                  <div className="lib-meta"><b>{e.item.name}</b><span className="lib-sub"><span>{t('lib.fileMoved')}</span></span></div>
                  <FavStar entry={e} />
                </div>
              ) : (
                <Row key={e.key} preview={preview} adding={adding} fav={e}
                  item={{ id: e.key, title: e.item.name, path: e.item.path, provider: 'file', creator: t('lib.yourFile'), duration: e.item.duration }}
                  onAdd={async () => { setAdding(e.key); const r = await onAddFile(e.item.path); setAdding(null); if (r?.error) setAddError(r.error); }} />
              )
            ) : (
              <Row key={e.key} item={e.item} preview={preview} onAdd={add} adding={adding} fav={e} />
            )))}
          </div>
        </>
      )}

      {view === 'tts' && <TextToSpeech onAdd={onTtsAdd} selectedText={selectedText} onOpenSettings={onOpenSettings} />}

      {view === 'credits' && (
        <>
          <div className="tab-title">{t('lib.credits')}</div>
          {!credits.length && (
            <p className="empty-note">{t('lib.creditsEmpty')}</p>
          )}
        </>
      )}

      {view === 'yours' && (
        <>
          <div className="tab-title">{t('lib.yourAudio')} <button className="btn btn-primary btn-sm" onClick={onImport}><Upload size={14} /> {t('panel.media.import')}</button></div>
          <div className={`card rec ${recorder.recording ? 'live' : ''}`}>
            <div className="card-row">
              <span className="card-icon"><Mic size={18} /></span>
              <div>
                <b>{t('lib.voiceover')}</b>
                <p>{t('lib.voiceoverNote')}</p>
              </div>
            </div>
            {recorder.recording ? (
              <button className="btn btn-danger" onClick={recorder.stop}><Square size={13} /> {t('lib.stopSecs', { s: Math.round(recorder.seconds) })}</button>
            ) : (
              <button className="btn" onClick={onStartRecord}><span className="rec-dot" /> {t('lib.record')}</button>
            )}
            {recorder.error && <p className="error-text">{recorder.error}</p>}
          </div>
          {audio.length ? (
            <div className="asset-list">
              {audio.map((m) => <MediaCard key={m.id} m={m} onAdd={onAddMedia} onRemove={onRemoveMedia} onPeek={onPeek} peeking={peekId === m.id} />)}
            </div>
          ) : (
            <p className="empty-note"><Music size={14} /> {t('lib.yoursEmpty')}</p>
          )}
        </>
      )}

      {credits.length > 0 && (
        <Card className="lib-credits">
          <b>{t('lib.creditsNeeded')}</b>
          <p>{t('lib.creditsNeededNote')}</p>
          <pre>{credits.join('\n')}</pre>
          <button className="btn btn-sm" onClick={copyCredits}>{copied ? <><Check size={13} /> {t('lib.copied')}</> : <><Copy size={13} /> {t('lib.copyCredits')}</>}</button>
        </Card>
      )}
      {(view === 'music' || view === 'credits') && (
        <p className="lib-note">{t('lib.ccNote')}</p>
      )}
    </>
  );
}
