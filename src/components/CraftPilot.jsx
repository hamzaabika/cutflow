import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Zap, Captions, CircleAlert, CircleCheck, Loader2, MessageCircle, MessageSquarePlus, Palette, RectangleVertical, Scissors, Settings, Square, StyleGlyph, Undo2, X, Shuffle } from '../icons.jsx';
import { runAgent, TRACK_LABELS } from '../agent/runAgent.js';
import { createPlanRun, replayPlan, diffPlan } from '../agent/plan.js';
import { describeStepFor, mutatesTool } from '../agent/tools.js';
import { projectDuration } from '../store.js';
import PlanReviewDialog from './PlanReviewDialog.jsx';
import AiBadge from './AiBadge.jsx';
import { badgeForProvider } from '../ai/badges.js';
import { EDIT_STYLES, STYLE_NAMES } from '../agent/motionGuide.js';
import { tr, useT } from '../i18n/index.jsx';
import AiCostBadge from './AiCostBadge.jsx';

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

// A-F9 — per-track change summary for a finished FlowAI run: one line per track
// that gained, lost or changed clips, plus the duration shift. Rendered under the
// model's reply, so the user sees exactly what the run did without opening History.
function RunSummary({ summary, t }) {
  if (!summary) return null;
  const lines = Object.entries(summary.lists || {})
    .filter(([, c]) => c.added || c.removed || c.changed)
    .map(([key, c]) => t('ai.sumTrack', { track: t(`ai.track.${TRACK_LABELS[key] || key}`), added: c.added, removed: c.removed, changed: c.changed }));
  if (!lines.length && summary.durationBefore === summary.durationAfter) return null;
  return (
    <div className="pilot-summary" aria-label={t('ai.sumTitle')}>
      <b>{t('ai.sumTitle')}</b>
      <ul>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
        {summary.durationBefore !== summary.durationAfter && (
          <li>{t('ai.planDuration', { from: summary.durationBefore.toFixed(1), to: summary.durationAfter.toFixed(1) })}</li>
        )}
      </ul>
    </div>
  );
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
  const [config, setConfig] = useState(null); // { ready, provider, model, ollama? }
  const [style, setStyle] = useState(null); // picked editing style id, sent with the next message
  const [showStyles, setShowStyles] = useState(false); // the style cards once the chat has started
  const [confirm, setConfirm] = useState(null); // { tool, summary, resolve } — the confirm gate (P1-30)
  // Plan mode (P1-31): ON by default — FlowAI builds the edit against a clone
  // and the user reviews it before anything touches the real project. Stored
  // in localStorage so the choice survives a restart.
  const [planMode, setPlanMode] = useState(() => {
    try { return localStorage.getItem('cutflow.planMode') !== '0'; } catch { return true; }
  });
  const [plan, setPlan] = useState(null); // the plan under review, or null
  const [planOpen, setPlanOpen] = useState(false); // the review dialog is visible
  const [planBusy, setPlanBusy] = useState(false); // a toggle recompute is running
  const contents = useRef([]); // the model conversation, kept between messages
  const canceled = useRef(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const refreshConfig = useCallback(async () => {
    const s = await window.api.settingsGet();
    // The Ollama free path is only ready when the local server is actually up
    // and has a model pulled — "provider is ollama" alone used to count as ready
    // and the user only found out on the first send (opaque error).
    let ollama = null;
    let ready = s.provider === 'ollama' || !!s.keys[s.provider];
    if (s.provider === 'ollama' && window.api.ollamaStatus) {
      ollama = await window.api.ollamaStatus({}).catch(() => null);
      ready = !!ollama?.running && ollama.models.length > 0;
    }
    setConfig({ ready, provider: s.provider, model: s.models[s.provider], ollama });
  }, []);
  useEffect(() => {
    refreshConfig();
  }, [refreshConfig, settingsVersion, open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // A confirm left hanging when the panel closes counts as declined — the agent
  // loop must never stall on a promise nobody can answer.
  useEffect(() => {
    if (!open && confirm) { confirm.resolve(false); setConfirm(null); }
  }, [open, confirm]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const updateLast = (fn) => setMessages((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));

  const pickStyle = (id) => {
    setStyle(id);
    setShowStyles(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  // Plan mode (P1-31): the agent loop runs against a CLONED project. Every
  // mutating tool call is recorded as a plan step with the project it saw, so
  // the review dialog can show exact numbers; nothing reaches the real store
  // until the user applies the plan. A provider failure mid-run leaves a
  // partial plan (or none) and the real project exactly as it was.
  const sendPlan = async (startLen) => {
    const baseProject = getProject();
    const run = createPlanRun(baseProject, window.api, { fontIds: app.fontIds });
    const recorded = [];
    const beforeById = new Map();
    const pushChatStep = (ev) => updateLast((last) => {
      const steps = [...(last.steps || [])];
      const i = steps.findIndex((s) => s.id === ev.id);
      if (i >= 0) steps[i] = ev; else steps.push(ev);
      return { ...last, steps };
    });
    const result = await runAgent({
      contents: contents.current,
      ctx: {
        getProject: run.ctx.getProject, dispatch: run.ctx.dispatch, api: window.api,
        settle: run.ctx.settle, fontIds: run.ctx.fontIds, addProbed: run.ctx.addProbed,
        undoOwn: run.ctx.undoOwn,
        historyDepth: () => run.getDraft().past.length,
        // No onConfirm here: the plan review IS the confirmation. Bounds
        // checks inside the tools still reject invalid calls.
      },
      isCanceled: () => canceled.current,
      onEvent: async (ev) => {
        pushChatStep(ev);
        if (ev.status === 'running') {
          beforeById.set(ev.id, structuredClone(run.getPlannedProject()));
          return;
        }
        if (!mutatesTool(ev.name)) return;
        const before = beforeById.get(ev.id) || baseProject;
        if (ev.status === 'done') {
          const desc = await describeStepFor(before, window.api, ev.name, ev.args || {});
          recorded.push({
            tool: ev.name, args: ev.args || {}, label: ev.label, enabled: true, ok: true, error: null,
            summary: desc?.error ? null : (desc?.text || ev.label), summaryError: desc?.error || null,
            durationBefore: projectDuration(before), durationAfter: projectDuration(run.getPlannedProject()),
          });
        } else if (ev.status === 'error') {
          recorded.push({
            tool: ev.name, args: ev.args || {}, label: ev.label, enabled: true, ok: false,
            error: ev.detail || '', summary: null, summaryError: null,
            durationBefore: projectDuration(before), durationAfter: projectDuration(run.getPlannedProject()),
          });
        }
        beforeById.delete(ev.id);
      },
    }).catch((e) => ({ error: { error: e.message } }));

    const after = run.getPlannedProject();
    if (recorded.length) {
      setPlan({
        steps: recorded, before: baseProject, after, diff: diffPlan(baseProject, after),
        partial: !!result.error || !!result.canceled,
        error: result.error?.error || (result.canceled ? t('ai.stopped') : ''),
        baseRev: startLen, baseId: baseProject.id, modelText: result.text || '',
      });
      setPlanOpen(true);
      updateLast((last) => ({ ...last, pending: false, text: t(recorded.length === 1 ? 'ai.planReadyOne' : 'ai.planReady', { count: recorded.length }), plan: true }));
      return;
    }
    if (result.error) {
      contents.current.pop();
      while (contents.current.length && contents.current.at(-1).role !== 'user') contents.current.pop();
      updateLast((last) => ({ ...last, pending: false, error: result.error, changed: false }));
    } else {
      updateLast((last) => ({ ...last, pending: false, text: result.canceled ? t('ai.stopped') : result.text || t('ai.doneFallback'), changed: false }));
    }
  };

  // Apply the reviewed plan: one dispatch, one undo step, back to the exact
  // pre-plan project. Refuses when the real project moved since the plan was
  // made (edits made while the dialog was open) rather than overwriting them.
  const applyPlan = () => {
    if (!plan) return;
    if (getProject().id !== plan.baseId || getHistoryLength() !== plan.baseRev) {
      setPlan({ ...plan, stale: true });
      return;
    }
    dispatch({ type: 'applyPlan', project: plan.after });
    const n = plan.steps.filter((s) => s.enabled && s.ok).length;
    updateLast((last) => ({
      ...last, pending: false, changed: true, plan: false,
      text: (plan.modelText ? `${plan.modelText}\n\n` : '') + t(n === 1 ? 'ai.planAppliedOne' : 'ai.planApplied', { count: n }),
    }));
    setPlan(null);
    setPlanOpen(false);
  };
  const discardPlan = () => {
    if (!plan) return;
    updateLast((last) => ({
      ...last, pending: false, plan: false,
      text: (plan.modelText ? `${plan.modelText}\n\n` : '') + t('ai.planDiscarded'),
    }));
    setPlan(null);
    setPlanOpen(false);
  };
  // Switching a step off/on recomputes the plan by replaying the enabled steps
  // from the original project — later steps always see the times the earlier
  // enabled steps produced.
  const togglePlanStep = async (i) => {
    if (!plan || planBusy) return;
    const steps = plan.steps.map((s, j) => (j === i ? { ...s, enabled: !s.enabled } : s));
    setPlanBusy(true);
    try {
      const rep = await replayPlan(plan.before, window.api, steps, { fontIds: app.fontIds });
      setPlan({ ...plan, steps: rep.steps, after: rep.project, diff: rep.diff });
    } finally {
      setPlanBusy(false);
    }
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
    if (planMode) {
      await sendPlan(startLen);
      setBusy(false);
      return;
    }
    const result = await runAgent({
      contents: contents.current,
      ctx: {
        getProject, dispatch, api: window.api, settle, ...app,
        // Confirm gate (P1-30): before a tool removes content, the user sees what
        // it would remove and says yes or no. The promise resolves from the modal.
        onConfirm: (c) => new Promise((resolve) => setConfirm({ ...c, resolve })),
        // Undo only what this request did: the user's earlier edits stay.
        undoOwn: () => {
          if (getHistoryLength() <= startLen) return false;
          dispatch({ type: 'undo' });
          return true;
        },
        historyDepth: getHistoryLength,
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
      updateLast((last) => ({ ...last, pending: false, error: result.error, changed: result.changed, summary: result.summary || null, rolledBack: !!result.rolledBack }));
    } else {
      updateLast((last) => ({ ...last, pending: false, text: result.canceled ? t('ai.stopped') : result.text || t('ai.doneFallback'), changed: result.changed, summary: result.summary || null, rolledBack: !!result.rolledBack }));
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

  // Providers whose models can call the editing tools. Ollama counts: the agent
  // loop routes it through the OpenAI-compatible endpoint and parses the same
  // tool_calls the hosted providers return, and the one-click free model
  // (qwen2.5:3b) is tool-capable. A pulled model without tool support simply
  // answers in text instead of editing — it never breaks the loop.
  const notGemini = config && config.ready && !['gemini', 'groq', 'openai', 'ollama'].includes(config.provider);

  return (
    <>
      {open && (
        <section className="pilot-panel pilot2" aria-label={t('ai.assistant')}>
          <header className="pilot-head">
            <span className="pilot-title"><Zap size={16} /> <span className="pilot-wordmark">Flow<span className="grad">AI</span></span></span>
            <span className="pilot-model" title={config ? `${config.provider} · ${config.model}` : ''}>{config ? config.model : ''}</span>
            {config && <AiBadge kind={badgeForProvider(config.provider)} />}
            {/* AI-02: Ollama runs on this PC for free; a hosted provider bills per token and receives the prompt + project context. */}
            {config && <AiCostBadge featureId={config.provider === 'ollama' ? 'flowai-ollama' : 'flowai-hosted'} />}
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
                <p>{config.provider === 'ollama'
                  ? (config.ollama?.running ? t('ai.ollamaNoModel') : t('ai.ollamaNotRunning'))
                  : t('ai.connectNote')}</p>
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
                    {m.rolledBack && <div className="pilot-note" role="status">{t('ai.rolledBack')}</div>}
                    {m.summary && <RunSummary summary={m.summary} t={t} />}
                    {m.plan && plan && !planOpen && (
                      <button className="btn btn-sm" onClick={() => setPlanOpen(true)}>{t('ai.planReopen')}</button>
                    )}
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
          {confirm && (
            <div className="pilot-confirm" role="dialog" aria-modal="true" aria-label={t('ai.confirmTitle')}>
              <b>{t('ai.confirmTitle')}</b>
              <p>{confirm.summary}</p>
              <div className="pilot-confirm-actions">
                <button className="btn btn-primary btn-sm" onClick={() => { confirm.resolve(true); setConfirm(null); }}>{t('ai.confirmApply')}</button>
                <button className="btn btn-sm" onClick={() => { confirm.resolve(false); setConfirm(null); }}>{t('ai.confirmDiscard')}</button>
              </div>
            </div>
          )}
          <label className="pilot-plan-toggle">
            <input type="checkbox" checked={planMode} disabled={busy}
              onChange={(e) => { setPlanMode(e.target.checked); try { localStorage.setItem('cutflow.planMode', e.target.checked ? '1' : '0'); } catch { /* private mode */ } }} />
            <span>{t('ai.planReview')}</span>
          </label>
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

      {plan && planOpen && (
        <PlanReviewDialog plan={plan} busy={planBusy} onToggleStep={togglePlanStep}
          onApply={applyPlan} onDiscard={discardPlan} onClose={() => setPlanOpen(false)} />
      )}

      <button className={`pilot-fab ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('ai.assistant')}>
        <span className="pilot-fab-icon"><Zap size={17} /></span>
        <span>FlowAI</span>
      </button>
    </>
  );
}
