import React, { useMemo, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Italic, Search, Star, Underline } from '../icons.jsx';
import Slider from './Slider.jsx';
import NumBox from './NumBox.jsx';
import KitToggle from '../ui/Toggle.jsx';
import { InspCard } from '../ui/Section.jsx';
import BrandSwatches from './BrandSwatches.jsx';
import { dragProps } from '../dnd.js';
import TextPreview from './TextPreview.jsx';
import FontPicker from './FontPicker.jsx';
import { resolveStyle } from '../text/render.js';
import {
  ANIM_LOOP, BUBBLES, HIGHLIGHTS, TEMPLATE_CATEGORIES, TEXT_EFFECTS, TEXT_TEMPLATES,
} from '../text/catalog.js';
import TextAnimBrowser from './TextAnimBrowser.jsx';
import { PinToTrack } from './ClipInspector.jsx';
import { useT } from '../i18n/index.jsx';
import { libName, slugifyPhrase } from '../i18n/libNames.js';

const TABS = ['Basic', 'Templates', 'Bubble', 'Effects', 'Animation'];
// Keys that describe how text looks (shared by "apply to all captions"); text and timing stay per clip.
const PER_CLIP = ['id', 'text', 'start', 'duration', 'words', 'caption'];

function stylePatch(patch) {
  const out = { ...patch };
  PER_CLIP.forEach((k) => delete out[k]);
  return out;
}

const FAV_KEY = 'clipcraft.favoriteTemplates';
function loadFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function TemplateGrid({ onPick, activeId, captionOnly, sampleText, draggable, category }) {
  const t = useT();
  const [ownCat, setCat] = useState(captionOnly ? 'Captions' : 'All');
  const cat = category || ownCat;
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState(loadFavs);
  const [hover, setHover] = useState(null);
  const toggleFav = (id) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    } catch {
      // Favorites are a convenience; ignore storage failures.
    }
  };
  const list = TEXT_TEMPLATES.filter((t) => {
    if (captionOnly && !t.caption && cat === 'Captions') return false;
    if (cat === 'Favorites') return favs.has(t.id);
    if (cat !== 'All' && !t.tags.includes(cat)) return false;
    return !q || t.name.toLowerCase().includes(q.toLowerCase());
  });
  return (
    <div className="tpl">
      <label className="search">
        <Search size={14} aria-hidden="true" />
        <input type="text" placeholder={t('ti.searchTemplates')} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!category && <div className="chips scroll-x" onWheel={(e) => { e.currentTarget.scrollLeft += e.deltaY; }}>
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c === 'All' ? t('panel.text.all') : c === 'Favorites' ? t('panel.text.favorites') : libName('cat', slugifyPhrase(c), c)}{c === 'Favorites' ? '' : ` · ${c === 'All' ? TEXT_TEMPLATES.length : TEXT_TEMPLATES.filter((x) => x.cat === c || (x.tags || []).includes(c)).length}`}</button>
        ))}
      </div>}
      <div className="tpl-grid">
        {list.map((tpl) => (
          <div key={tpl.id} className={`tpl-item ${activeId === tpl.id ? 'on' : ''}`}
            onMouseEnter={() => setHover(tpl.id)} onMouseLeave={() => setHover(null)}>
            <button className="tpl-btn" onClick={() => onPick(tpl)} title={libName('tpl', tpl.id, tpl.name)}
              {...(draggable ? dragProps({ kind: 'text', patch: { ...tpl.patch, template: tpl.id } }) : {})}>
              <TextPreview style={tpl.caption ? { ...tpl.patch, caption: true } : tpl.patch} text={sampleText || tpl.previewText} hover={hover === tpl.id} width={128} height={72} />
            </button>
            <span className="tpl-name">{libName('tpl', tpl.id, tpl.name)}</span>
            <button className={`tpl-fav ${favs.has(tpl.id) ? 'on' : ''}`} onClick={() => toggleFav(tpl.id)}
              aria-label={favs.has(tpl.id) ? t('ti.favRemove') : t('ti.favAdd')}>
              <Star size={12} fill={favs.has(tpl.id) ? 'currentColor' : 'none'} />
            </button>
          </div>
        ))}
        {!list.length && <p className="muted">{t('ti.noTemplates')}</p>}
      </div>
    </div>
  );
}

function StyleTiles({ items, value, onPick, styleFor, sample, ns }) {
  const [hover, setHover] = useState(null);
  return (
    <div className="tpl-grid">
      {items.map((it) => (
        <div key={it.id} className={`tpl-item ${value === it.id ? 'on' : ''}`}
          onMouseEnter={() => setHover(it.id)} onMouseLeave={() => setHover(null)}>
          <button className="tpl-btn" onClick={() => onPick(it.id)} title={ns ? libName(ns, it.id, it.name) : it.name}>
            <TextPreview style={styleFor(it.id)} text={sample} hover={hover === it.id} width={128} height={72} />
          </button>
          <span className="tpl-name">{ns ? libName(ns, it.id, it.name) : it.name}</span>
        </div>
      ))}
    </div>
  );
}

function Toggle({ on, onClick, label, children }) {
  return <button className={`icon-toggle ${on ? 'on' : ''}`} aria-pressed={!!on} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Color({ label, value, onChange }) {
  return (
    <>
      <label className="field row">
        <span>{label}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <BrandSwatches onPick={onChange} />
    </>
  );
}

export default function TextInspector({ clip, dispatch, project = null }) {
  const t = useT();
  const [tab, setTab] = useState('Basic');
  const [applyAll, setApplyAll] = useState(true);
  const [animTab, setAnimTab] = useState('In');
  const st = useMemo(() => resolveStyle(clip), [clip]);
  const sharedToCaptions = clip.caption && applyAll;

  // Style changes go to every caption when "Apply to all main captions" is on.
  const set = (patch) => {
    const style = stylePatch(patch);
    const own = Object.fromEntries(Object.entries(patch).filter(([k]) => PER_CLIP.includes(k)));
    if (sharedToCaptions && Object.keys(style).length) dispatch({ type: 'styleCaptions', patch: style });
    else if (Object.keys(style).length) dispatch({ type: 'update', track: 'text', id: clip.id, patch: style });
    if (Object.keys(own).length) dispatch({ type: 'update', track: 'text', id: clip.id, patch: own });
  };
  const nested = (key) => (p) => set({ [key]: { ...st[key], ...p } });
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  // The colour roles the clip's style actually paints with, derived from the resolved style
  // (so every template — captions, titles, labels — gets exactly its own roles, no more).
  // They used to be scattered: the word box colour lived only in the Animation tab, the
  // bubble colour only in the Bubble tab, the second/glow colours only in the Effects tab —
  // a user recolouring a template (e.g. the Word Box violet box) could not find them. The
  // swatches below write the very same clip fields those tabs write, through set()/nested(),
  // so the one renderer (preview + export) honours them and caption sharing still applies.
  const colorRoles = [];
  if (st.highlight.mode !== 'none') {
    colorRoles.push(<Color key="hl-color" label={t('ti.wordColor')} value={st.highlight.color} onChange={(color) => nested('highlight')({ color })} />);
    if (st.highlight.mode === 'box' || st.highlight.mode === 'marker') {
      colorRoles.push(<Color key="hl-bg" label={t('ti.boxColor')} value={st.highlight.bg} onChange={(bgc) => nested('highlight')({ bg: bgc })} />);
    }
  }
  if (st.bg.on) colorRoles.push(<Color key="bg" label={t('ti.bgColor')} value={st.bg.color} onChange={(color) => nested('bg')({ color })} />);
  if (st.bubble && st.bubble !== 'none') colorRoles.push(<Color key="bubble" label={t('ti.bubbleColor')} value={st.bubbleColor} onChange={(bubbleColor) => set({ bubbleColor })} />);
  if (['gradient', 'fire', 'ice', 'shadow3d', 'retro', 'double'].includes(st.effect)) {
    colorRoles.push(<Color key="color2" label={t('ti.secondColor')} value={st.color2} onChange={(color2) => set({ color2 })} />);
  }
  if (['neon', 'glow', 'fire', 'ice'].includes(st.effect)) {
    colorRoles.push(<Color key="glow" label={t('ti.glowColor')} value={st.glowColor} onChange={(glowColor) => set({ glowColor })} />);
  }
  // Stable style objects for the tiles (style + one changed key).
  const styleWith = (key, val) => ({ ...stylePatch(st), [key]: val, caption: clip.caption });
  const animStyle = (kind) => (id) => {    const base = { ...stylePatch(st), animIn: { id: 'none', dur: 0.5 }, animOut: { id: 'none', dur: 0.4 }, animLoop: { id: 'none', speed: 1 } };
    if (kind === 'In') base.animIn = { id, dur: 0.8 };
    if (kind === 'Out') base.animOut = { id, dur: 0.8 };
    if (kind === 'Loop') base.animLoop = { id, speed: 1 };
    return base;
  };

  return (
    <div className="text-inspector">
      <div className="seg-tabs" role="tablist">
        {TABS.map((tb) => (
          <button key={tb} role="tab" aria-selected={tab === tb} className={tab === tb ? 'on' : ''} onClick={() => setTab(tb)}>{t('ti.tab.' + tb.toLowerCase())}</button>
        ))}
      </div>
      {clip.caption && (
        <label className="apply-all">
          <KitToggle checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          {t('ti.applyAllCaptions')}
        </label>
      )}

      {tab === 'Basic' && (
        <div className="fields">
          {project && <PinToTrack clip={clip} project={project} card
            set={(patch) => dispatch({ type: 'update', track: 'text', id: clip.id, patch })} />}
          <InspCard id="text:type" title={t('ti.type')}>
          <label className="field">
            <span>{t('ti.text')}</span>
            <textarea rows={3} dir="auto" value={clip.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <div className="field">
            <span>{t('ti.font')}</span>
            <FontPicker value={st.font} onChange={(font) => set({ font })} />
          </div>
          <div className="toggle-row">
            <Toggle label={t('ti.bold')} on={st.bold} onClick={() => set({ bold: !st.bold })}><Bold size={15} /></Toggle>
            <Toggle label={t('ti.italic')} on={st.italic} onClick={() => set({ italic: !st.italic })}><Italic size={15} /></Toggle>
            <Toggle label={t('ti.underline')} on={st.underline} onClick={() => set({ underline: !st.underline })}><Underline size={15} /></Toggle>
            <Toggle label={t('ti.uppercase')} on={st.uppercase} onClick={() => set({ uppercase: !st.uppercase })}><CaseUpper size={15} /></Toggle>
            <span className="tool-sep" />
            <Toggle label={t('ti.alignLeft')} on={st.align === 'left'} onClick={() => set({ align: 'left' })}><AlignLeft size={15} /></Toggle>
            <Toggle label={t('ti.alignCenter')} on={st.align === 'center'} onClick={() => set({ align: 'center' })}><AlignCenter size={15} /></Toggle>
            <Toggle label={t('ti.alignRight')} on={st.align === 'right'} onClick={() => set({ align: 'right' })}><AlignRight size={15} /></Toggle>
          </div>
          {S({ label: t('ti.size'), value: st.size, min: 12, max: 260, step: 1, onChange: (size) => set({ size }) })}
          {S({ label: t('ti.letterSpacing'), value: st.letterSpacing, min: -5, max: 40, step: 1, onChange: (letterSpacing) => set({ letterSpacing }) })}
          {S({ label: t('ti.lineHeight'), value: st.lineHeight, min: 0.8, max: 2.5, step: 0.05, onChange: (lineHeight) => set({ lineHeight }) })}
          {S({ label: t('ti.maxWidth'), value: st.maxWidth, min: 0.2, max: 1, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (maxWidth) => set({ maxWidth }) })}
          </InspCard>
          <InspCard id="text:fill" title={t('ti.fill')}>
            <Color label={t('ti.color')} value={st.color} onChange={(color) => set({ color })} />
            {S({ label: t('insp.opacity'), value: st.opacity ?? 1, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (opacity) => set({ opacity }) })}
          </InspCard>
          {colorRoles.length > 0 && (
            <InspCard id="text:style-colors" title={t('ti.styleColors')}>
              {colorRoles}
            </InspCard>
          )}
          <InspCard id="text:stroke" title={t('ti.stroke')}>
          {S({ label: t('ti.width'), value: st.stroke.width, min: 0, max: 30, step: 1, onChange: (width) => nested('stroke')({ width }) })}
          <Color label={t('ti.strokeColor')} value={st.stroke.color} onChange={(color) => nested('stroke')({ color })} />

          </InspCard>
          <InspCard id="text:shadow" title={t('ti.shadow')}
            right={<KitToggle checked={st.shadow.on} onChange={(e) => nested('shadow')({ on: e.target.checked })} aria-label={t('ti.shadow')} />}>
          {st.shadow.on && (
            <>
              <Color label={t('ti.shadowColor')} value={st.shadow.color} onChange={(color) => nested('shadow')({ color })} />
              {S({ label: t('insp.opacity'), value: st.shadow.opacity, onChange: (opacity) => nested('shadow')({ opacity }) })}
              {S({ label: t('ti.blur'), value: st.shadow.blur, min: 0, max: 60, step: 1, onChange: (blur) => nested('shadow')({ blur }) })}
              {S({ label: t('ti.distance'), value: st.shadow.y, min: -30, max: 30, step: 1, onChange: (y) => nested('shadow')({ y }) })}
            </>
          )}

          </InspCard>
          <InspCard id="text:background" title={t('ti.background')}
            right={<KitToggle checked={st.bg.on} onChange={(e) => nested('bg')({ on: e.target.checked })} aria-label={t('ti.background')} />}>
          {st.bg.on && (
            <>
              <div className="chips">
                {['block', 'line'].map((m) => (
                  <button key={m} className={`chip ${st.bg.mode === m ? 'on' : ''}`} onClick={() => nested('bg')({ mode: m })}>
                    {m === 'block' ? t('ti.wholeText') : t('ti.eachLine')}
                  </button>
                ))}
              </div>
              <Color label={t('ti.bgColor')} value={st.bg.color} onChange={(color) => nested('bg')({ color })} />
              {S({ label: t('insp.opacity'), value: st.bg.opacity, onChange: (opacity) => nested('bg')({ opacity }) })}
              {S({ label: t('ti.cornerRadius'), value: st.bg.radius, min: 0, max: 60, step: 1, onChange: (radius) => nested('bg')({ radius }) })}
            </>
          )}

          </InspCard>
          <InspCard id="text:position" title={t('ti.positionTiming')}>
            <p className="dim small">{t('ti.dragNote')}</p>
          {S({ label: t('insp.positionX'), value: st.x, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (x) => set({ x }) })}
          {S({ label: t('insp.positionY'), value: st.y, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (y) => set({ y }) })}
          {S({ label: t('insp.rotation'), value: st.rotation || 0, min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°`, onChange: (rotation) => set({ rotation }) })}
          <NumBox layout="field" label={t('insp.startS')} step={0.1} min={0} value={clip.start}
            onChange={(v) => set({ start: Math.max(0, v) })} />
          <NumBox layout="field" label={t('insp.durationS')} step={0.1} min={0.1} value={clip.duration}
            onChange={(v) => set({ duration: Math.max(0.1, v) })} />
          </InspCard>
        </div>
      )}

      {tab === 'Templates' && (
        <div className="pad-block">
          <TemplateGrid activeId={clip.template} captionOnly={clip.caption} sampleText={clip.caption ? undefined : clip.text}
            onPick={(t) => set({ ...stylePatch(t.patch), template: t.id })} />
        </div>
      )}

      {tab === 'Bubble' && (
        <div className="pad-block">
          <Color label={t('ti.bubbleColor')} value={st.bubbleColor} onChange={(bubbleColor) => set({ bubbleColor })} />
          <StyleTiles ns="bubble" items={BUBBLES} value={st.bubble} sample={clip.text} onPick={(bubble) => set({ bubble })}
            styleFor={(id) => styleWith('bubble', id)} />
        </div>
      )}

      {tab === 'Effects' && (
        <div className="pad-block">
          <div className="color-pair">
            <Color label={t('ti.secondColor')} value={st.color2} onChange={(color2) => set({ color2 })} />
            <Color label={t('ti.glowColor')} value={st.glowColor} onChange={(glowColor) => set({ glowColor })} />
          </div>
          <StyleTiles ns="txtfx" items={TEXT_EFFECTS} value={st.effect} sample={clip.text} onPick={(effect) => set({ effect })}
            styleFor={(id) => styleWith('effect', id)} />
        </div>
      )}

      {tab === 'Animation' && (
        <div className="pad-block">
          <div className="sub-head">{t('ti.wordHighlight')}</div>
          <div className="chips">
            {HIGHLIGHTS.map((h) => (
              <button key={h.id} className={`chip ${st.highlight.mode === h.id ? 'on' : ''}`}
                onClick={() => nested('highlight')({ mode: h.id })}>{libName('hl', h.id, h.name)}</button>
            ))}
          </div>
          {st.highlight.mode !== 'none' && (
            <div className="color-pair">
              <Color label={t('ti.wordColor')} value={st.highlight.color} onChange={(color) => nested('highlight')({ color })} />
              {(st.highlight.mode === 'box' || st.highlight.mode === 'marker') && (
                <Color label={t('ti.boxColor')} value={st.highlight.bg} onChange={(bgc) => nested('highlight')({ bg: bgc })} />
              )}
            </div>
          )}
          <div className="seg-tabs small">
            {['In', 'Out', 'Loop'].map((tb) => (
              <button key={tb} className={animTab === tb ? 'on' : ''} onClick={() => setAnimTab(tb)}>{t('ti.anim' + tb)}</button>
            ))}
          </div>
          {animTab === 'In' && (
            <>
              {S({ label: t('insp.duration'), value: st.animIn.dur, min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(1)}s`, onChange: (dur) => nested('animIn')({ dur }) })}
              <TextAnimBrowser kind="in" value={st.animIn.id} unit={st.animIn.unit} sampleText={clip.text}
                baseStyle={{ ...stylePatch(st), caption: clip.caption }}
                onPick={(p) => nested('animIn')({ id: p.anim, dur: p.dur })}
                onUnit={(unit) => nested('animIn')({ unit })}
                onClear={() => nested('animIn')({ id: 'none' })} />
            </>
          )}
          {animTab === 'Out' && (
            <>
              {S({ label: t('insp.duration'), value: st.animOut.dur, min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(1)}s`, onChange: (dur) => nested('animOut')({ dur }) })}
              <TextAnimBrowser kind="out" value={st.animOut.id} unit={st.animOut.unit} sampleText={clip.text}
                baseStyle={{ ...stylePatch(st), caption: clip.caption }}
                onPick={(p) => nested('animOut')({ id: p.anim, dur: p.dur })}
                onUnit={(unit) => nested('animOut')({ unit })}
                onClear={() => nested('animOut')({ id: 'none' })} />
            </>
          )}
          {animTab === 'Loop' && (
            <>
              {S({ label: t('ci.speed'), value: st.animLoop.speed, min: 0.2, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)}×`, onChange: (speed) => nested('animLoop')({ speed }) })}
              <StyleTiles ns="animloop" items={ANIM_LOOP} value={st.animLoop.id} sample={clip.text} onPick={(id) => nested('animLoop')({ id })} styleFor={animStyle('Loop')} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
