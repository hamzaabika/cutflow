import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Zap, Captions, CircleAlert, CircleCheck, Loader2, MessageCircle, MessageSquarePlus, Palette, RectangleVertical, Scissors, Settings, Square, StyleGlyph, Undo2, X, Shuffle } from '../icons.jsx';
import { runAgent } from '../agent/runAgent.js';
import { EDIT_STYLES, STYLE_NAMES } from '../agent/motionGuide.js';
import { tr, useT } from '../i18n/index.jsx';

// Quick actions on the empty state, grouped by what they do; each sends its text as-is.
const ACTIONS = [
  { icon: Scissors, group: 'ai.act.cut', text: 'ai.act.cutText' },
  { icon: Captions, group: 'ai.act.captions', text: 'ai.act.captionsText' },
  { icon: MessageCircle, group: 'ai.act.ask', text: 'ai.act.askText' },
  { icon: RectangleVertical, group: 'ai.act.format', text: 'ai.act.formatText' },
];

// The named editing styles as cards: pick one, then say what you want (or just send) to edit the video in it.
function StyleGrid({ value, onPick, disabled }) {
  return (
    <div className="pilot-styles" role="listbox" aria-label={tr('ai.styles')}>
      {STYLE_NAMES.map((id) => {
        const st = EDIT_STYLES[id];
        return (
          <button key={id} type="button" role="option" aria-selected={value === id} disabled={disabled}
            className={`pilot-style ${value === id ? 'on' : ''}`} title={st.look} onClick={() => onPick(value === id ? null : id)}>
            <span className="pilot-style-emoji" aria-hidden="true"><StyleGlyph id={id} size={17} /></span>
            <b>{st.title}</b>
            <span>{st.tag}</span>
          </button>
        );
      })}
    </div>
  );
}

// The message for a picked style: the user's words (in their language) plus the style's name for edit_style.
const styledMessage = (text, styleId) => {
  if (!styleId) return text.trim();
  const name = EDIT_STYLES[styleId].title;
  return text.trim() ? `${text.trim()}

${tr('ai.styleSuffix', { name })}` : tr('ai.styleOnly', { name });
};

// Tiny formatter for the assistant's reply: paragraphs, **bold** and "- " bullet lists.
function Rich({ text }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part));
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
  });
}

export default function CraftAI({ getProject, getHistoryLength, dispatch, settle, onOpenSettings, settingsVersion, app = {}, open: openProp, onToggle }) {
  const t = useT();
  // The open state is owned by App; the floating button over the timeline
  // is the panel's only entrance. (The FAB was removed in the 2026-11-10 UI
  // review because it covered the audio meter, then restored the same
  // evening on Hamza's direct order: "keep FlowAI as it was — visible and
  // clear"; the TopBar toggle that had replaced it was removed on his
  // order the same evening.) Internal state remains as a fallback for any
  // mount that does not pass the props.
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = (v) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (onToggle) onToggle(next); else setOpenState(next);
  };
  const [messages, setMessages] = useState([]); // { role: 'user' | 'assistant', text, steps?, error?, changed? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(null); // { ready, provider, model }
  const [style, setStyle] = useState(null); // picked editing style id, sent with the next message
  const [showStyles, setShowStyles] = useState(false); // the style cards once the chat has started
  const contents = useRef([]); // the model conversation, kept between messages
  const canceled = useRef(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const refreshConfig = useCallback(async () => {
    const s = await window.api.settingsGet();
    setConfig({ ready: s.provider === 'ollama' || !!s.keys[s.provider], provider: s.provider, model: s.models[s.provider] });
  }, []);
  useEffect(() => {
    refreshConfig();
  }, [refreshConfig, settingsVersion, open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const updateLast = (fn) => setMessages((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));

  const pickStyle = (id) => {
    setStyle(id);
    setShowStyles(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const send = async (text) => {
    const msg = styledMessage(text, style);
    if (!msg || busy) return;
    setInput('');
    setStyle(null);
    setBusy(true);
    canceled.current = false;
    setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '', steps: [], pending: true }]);
    contents.current.push({ role: 'user', parts: [{ text: msg }] });

    const startLen = getHistoryLength();
    const result = await runAgent({
      contents: contents.current,
      ctx: {
        getProject, dispatch, api: window.api, settle, ...app,
        // Undo only what this request did: the user's earlier edits stay.
        undoOwn: () => {
          if (getHistoryLength() <= startLen) return false;
          dispatch({ type: 'undo' });
          return true;
        },
      },
      isCanceled: () => canceled.current,
      onEvent: (ev) => updateLast((last) => {
        const steps = [...last.steps];
        const i = steps.findIndex((s) => s.id === ev.id);
        if (i >= 0) steps[i] = ev;
        else steps.push(ev);
        return { ...last, steps };
      }),
    }).catch((e) => ({ error: { error: e.message } }));

    // Everything the assistant did becomes a single Undo step.
    if (result.changed) dispatch({ type: 'collapseHistory', from: startLen });
    if (result.error) {
      // Drop the unanswered user turn so the conversation stays valid for the next message.
      contents.current.pop();
      while (contents.current.length && contents.current.at(-1).role !== 'user') contents.current.pop();
      updateLast((last) => ({ ...last, pending: false, error: result.error, changed: result.changed }));
    } else {
      updateLast((last) => ({ ...last, pending: false, text: result.canceled ? t('ai.stopped') : result.text || t('ai.doneFallback'), changed: result.changed }));
    }
    setBusy(false);
  };

  const newChat = () => {
    if (busy) return;
    contents.current = [];
    setMessages([]);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  // Providers whose models can call the editing tools.
  const notGemini = config && config.ready && !['gemini', 'groq', 'openai'].includes(config.provider);

  return (
    <>
      {open && (
        <section className="pilot-panel pilot2" aria-label={t('ai.assistant')}>
          <header className="pilot-head">
            <span className="pilot-title"><Zap size={16} /> <span className="pilot-wordmark">Flow<span className="grad">AI</span></span></span>
            <span className="pilot-model" title={config ? `${config.provider} · ${config.model}` : ''}>{config ? config.model : ''}</span>
            <button className={`icon-btn ${showStyles ? 'active' : ''}`} onClick={() => setShowStyles((v) => !v)} aria-pressed={showStyles}
              aria-label={t('ai.styles')} title={t('ai.styles')}><Palette size={16} /></button>
            <button className="icon-btn" onClick={newChat} disabled={busy || !messages.length} aria-label={t('ai.newChat')} title={t('ai.newChat')}><MessageSquarePlus size={16} /></button>
            <button className="icon-btn" onClick={onOpenSettings} aria-label={t('ai.aiSettings')} title={t('ai.aiSettings')}><Settings size={16} /></button>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('ai.closeAssistant')}><X size={16} /></button>
          </header>

          <div className="pilot-list" ref={listRef}>
            {config && !config.ready && (
              <div className="pilot-callout">
                <b>{t('ai.connectTitle')}</b>
                <p>{t('ai.connectNote')}</p>
                <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>{t('topbar.openSettings')}</button>
              </div>
            )}
            {notGemini && (
              <div className="pilot-callout warn">
                <b>{t('ai.providerTitle')}</b>
                <p>{t('ai.providerNote')}</p>
                <button className="btn btn-sm" onClick={onOpenSettings}>{t('topbar.openSettings')}</button>
              </div>
            )}

            {!messages.length && (
              <div className="pilot-welcome">
                <div className="pilot-logo"><Zap size={22} /></div>
                <h3>{t('ai.welcomeTitle')}</h3>
                <p>{t('ai.welcomeNote')}</p>
                <div className="pilot-actions">
                  {ACTIONS.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button key={a.text} className="pilot-action" disabled={busy || !config?.ready} onClick={() => send(t(a.text))}>
                        <span className="pa-icon"><Icon size={15} /></span>
                        <span className="pa-text"><b>{t(a.group)}</b><small>{t(a.text)}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div className="pilot-styles-head">{t('ai.stylesHead')}</div>
                <StyleGrid value={style} onPick={pickStyle} disabled={busy || !config?.ready} />
              </div>
            )}
            {messages.length > 0 && showStyles && (
              <div className="pilot-styles-box">
                <div className="pilot-styles-head">{t('ai.stylesHead2')}</div>
                <StyleGrid value={style} onPick={pickStyle} disabled={busy || !config?.ready} />
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`pilot-msg ${m.role}`}>
                {m.role === 'user' ? (
                  <div className="bubble" dir="auto">{m.text}</div>
                ) : (
                  <div className="reply">
                    {m.steps?.length > 0 && (
                      <ul className="pilot-steps">
                        {m.steps.map((s) => (
                          <li key={s.id} className={s.status} title={s.detail || ''}>
                            {s.status === 'running' ? <Loader2 size={13} className="spin" /> : s.status === 'done' ? <CircleCheck size={13} />
                              : s.status === 'switch' ? <Shuffle size={13} /> : <CircleAlert size={13} />}
                            <span>{s.label}{s.status === 'error' ? ` — ${s.detail}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.pending && !m.steps?.length && <div className="pilot-thinking"><Loader2 size={14} className="spin" /> {t('ai.thinking')}</div>}
                    {m.text && <div className="bubble" dir="auto"><Rich text={m.text} /></div>}
                    {m.error && (
                      <div className="pilot-error" role="alert">
                        <b>{t('ai.errorTitle')}</b>
                        <p>{m.error.error}</p>
                        <div className="pilot-error-actions">
                          {m.error.suggestModel && <button className="btn btn-sm btn-primary" onClick={onOpenSettings}>{t('ai.changeModel')}</button>}
                          {m.error.link && <button className="btn btn-sm" onClick={() => window.api.openHelp(m.error.link)}>{m.error.linkLabel || t('set.openGoogle')}</button>}
                          {!m.error.link && !m.error.suggestModel && <button className="btn btn-sm" onClick={onOpenSettings}>{t('topbar.openSettings')}</button>}
                        </div>
                      </div>
                    )}
                    {m.changed && !m.pending && (
                      <button className="pilot-undo" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={13} /> {t('ai.undoChanges')}</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {style && (
            <div className="pilot-picked">
              <span className="pilot-picked-pill" title={EDIT_STYLES[style].look}>
                <StyleGlyph id={style} size={12} /> {EDIT_STYLES[style].title}
                <button type="button" onClick={() => setStyle(null)} aria-label={t('ai.removeStyle')}><X size={12} /></button>
              </span>
              <span className="pilot-picked-hint">{t('ai.pickedHint')}</span>
            </div>
          )}
          <div className="pilot-input">
            <textarea ref={inputRef} rows={2} value={input} dir="auto"
              placeholder={style ? t('ai.placeholderStyle', { style: EDIT_STYLES[style].title }) : t('ai.placeholder')}
              onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={!config?.ready} aria-label={t('ai.message')} />
            {busy ? (
              <button className="send stop" onClick={() => { canceled.current = true; }} aria-label={t('ai.stop')}><Square size={14} fill="currentColor" /></button>
            ) : (
              <button className="send" onClick={() => send(input)} disabled={(!input.trim() && !style) || !config?.ready} aria-label={t('ai.send')}><ArrowUp size={16} /></button>
            )}
          </div>
        </section>
      )}

      <button className={`pilot-fab ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('ai.assistant')}>
        <span className="pilot-fab-icon"><Zap size={17} /></span>
        <span>FlowAI</span>
      </button>
    </>
  );
}
