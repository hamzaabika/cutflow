// Transcript editing (v1.1.5): the project's caption clips read as one flowing
// transcript of sentences and words, plus the range math that turns a word
// selection (or a silence list) into ripple cuts on the main track.
//
// The data source is the caption clips themselves — auto captions carry word
// timings from the transcription engine; imported .srt cues have no word
// timings, so each cue is a single selectable unit. Nothing here invents a
// parallel transcript: the panel edits the same clips the timeline shows, and
// a cut is the store's existing cutRanges action (with text ripple enabled),
// so undo, locking and link sync behave exactly like every other edit.

// Sentences of the transcript, in timeline order. Words carry ABSOLUTE
// timeline times so selection math never has to know about clip offsets.
export function transcriptSentences(project) {
  return (project.textClips || [])
    .filter((c) => c.caption)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const end = c.start + c.duration;
      const words = (c.words && c.words.length)
        ? c.words.map((w) => ({ text: w.text, start: c.start + w.start, end: c.start + w.end, ...(Number.isFinite(w.conf) ? { conf: w.conf } : {}) }))
        : [{ text: c.text || '', start: c.start, end }];
      // AI-03: the speaker label rides on the sentence (from the clip), and
      // word confidence rides on the words (from the transcription engine).
      // speaker is always present ('' when unlabeled) so consumers never
      // branch on its absence.
      return { clipId: c.id, start: c.start, end, text: c.text || '', speaker: c.speaker || '', hasWords: !!(c.words && c.words.length), words };
    });
}

// Every word of the transcript as one flat list (selection indices refer to it).
export function flatWords(sentences) {
  const out = [];
  sentences.forEach((s, si) => s.words.forEach((w, wi) => out.push({ ...w, clipId: s.clipId, sentence: si, index: wi })));
  return out;
}

// Sort ranges and merge overlapping / touching ones.
export function mergeRanges(ranges) {
  const list = ranges
    .filter((r) => r && r.end - r.start > 0.001)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.001) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

// Cut ranges for a flat word selection [from, to] (inclusive indices into
// flatWords): one range per run of selected words of the same clip, merged.
export function selectionCutRanges(words, from, to) {
  if (from == null || to == null || !words.length) return [];
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(words.length - 1, Math.max(from, to));
  const ranges = [];
  for (let i = lo; i <= hi; i++) {
    const w = words[i];
    const last = ranges[ranges.length - 1];
    if (last && last.clipId === w.clipId && w.start <= last.end + 0.001) last.end = Math.max(last.end, w.end);
    else ranges.push({ clipId: w.clipId, start: w.start, end: w.end });
  }
  return mergeRanges(ranges);
}

// The whole span of a sentence, as a cut range.
export const sentenceRange = (s) => ({ start: s.start, end: s.end });

// Silence list -> cut ranges, the same shaping the assistant's silence tool
// uses: keep `pad` seconds of the silence at both ends (breathing room around
// the neighbouring speech), clamp the tail to the project duration, and drop
// anything that shrinks to a sliver.
export function silenceCutRanges(silences, pad, total) {
  return mergeRanges((silences || []).map((s) => ({
    start: s.start + Math.max(0, pad),
    end: Math.min(s.end, total) - Math.max(0, pad),
  })).filter((r) => r.end - r.start > 0.05));
}

export const rangesSeconds = (ranges) => ranges.reduce((n, r) => n + (r.end - r.start), 0);

// --- Retake assistant (v1.1.7) -------------------------------------------
// A retake is the same line said again: consecutive transcript sentences
// whose words are (nearly) the same set, where an earlier attempt is often
// a cut-off subset of the full line. Grouping is purely textual and runs on
// the same sentences the panel renders — no parallel data. The suggested
// keeper is the LAST complete take: the last member at least 85% as long
// (in words) as the group's longest member, so a trailing fragment never
// wins over a full earlier take, and a full final take always wins.

export function normalizeTakeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function wordCounts(words) {
  const m = new Map();
  words.forEach((w) => m.set(w, (m.get(w) || 0) + 1));
  return m;
}

// 0..1 similarity of two word lists: the better of the Dice coefficient on
// word multisets (same line, reordered a little) and containment (one is
// mostly a subset of the other — the classic cut-off retake).
export function takeSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const ca = wordCounts(a);
  const cb = wordCounts(b);
  let inter = 0;
  for (const [w, n] of ca) inter += Math.min(n, cb.get(w) || 0);
  const dice = (2 * inter) / (a.length + b.length);
  const containment = inter / Math.min(a.length, b.length);
  return Math.max(dice, containment >= 0.8 ? containment : 0);
}

const TAKE_MIN_WORDS = 2; // a one-word line ("okay") repeating is not a retake
const TAKE_SIMILAR = 0.55;

// Groups of consecutive sentences that are retakes of one line.
// Returns [{ members: [sentenceIndex, ...], keep: sentenceIndex }] with
// indices into the sentences array; only groups of 2+ are returned.
export function retakeGroups(sentences) {
  const words = sentences.map((s) => normalizeTakeWords(s.text));
  const groups = [];
  let cur = null; // { members: [idx] }
  const close = () => { if (cur && cur.members.length >= 2) groups.push(cur); cur = null; };
  sentences.forEach((s, i) => {
    if (words[i].length < TAKE_MIN_WORDS) { close(); return; }
    if (cur) {
      const prev = cur.members[cur.members.length - 1];
      const first = cur.members[0];
      if (takeSimilarity(words[i], words[prev]) >= TAKE_SIMILAR || takeSimilarity(words[i], words[first]) >= TAKE_SIMILAR) {
        cur.members.push(i);
        return;
      }
      close();
    }
    cur = { members: [i] };
  });
  close();
  return groups.map((g) => {
    const counts = g.members.map((i) => words[i].length);
    const max = Math.max(...counts);
    let keep = g.members[g.members.length - 1];
    for (const i of g.members) if (words[i].length >= 0.85 * max) keep = i;
    return { members: g.members, keep };
  });
}

// Cut ranges for every member of a retake group except the kept take.
export function retakeCutRanges(sentences, group) {
  return mergeRanges(group.members.filter((i) => i !== group.keep).map((i) => sentenceRange(sentences[i])));
}

// --- P1-33 / P1-34 — transcript confidence controls + proofreading --------
// Words carry `conf` (0..1) when the transcription engine reported one
// (Whisper word timestamps); a word without one is treated as unknown, never
// as low-confidence. The project stores the threshold at
// project.transcript.confidenceThreshold (default 0.6); the panel hides or
// flags words below it and the proofreader never "fixes" a low-confidence
// word by guessing — it only flags it for a human.
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

// Every word whose confidence is below the threshold, with the sentence
// it belongs to (for the review list: click to seek) and who said it.
// Sorted by time. Shape is a superset of both predecessors: the P1-33
// { text, conf, clipId, start, end } plus AI-03's sentence index and
// speaker, so both test suites read what they pin.
export function lowConfidenceWords(sentences, threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  const out = [];
  (sentences || []).forEach((s, si) => {
    for (const w of s.words || []) {
      if (Number.isFinite(w.conf) && w.conf < threshold) {
        out.push({ text: w.text, conf: w.conf, clipId: s.clipId, start: w.start, end: w.end, sentence: si, speaker: s.speaker });
      }
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

// Coverage stats for the confidence header: how many words actually carry
// a score, their mean, and how many sit below the threshold.
export function confidenceStats(sentences, threshold = 0.7) {
  let total = 0; let withConf = 0; let sum = 0; let low = 0;
  (sentences || []).forEach((s) => (s.words || []).forEach((w) => {
    total++;
    if (Number.isFinite(w.conf)) { withConf++; sum += w.conf; if (w.conf < threshold) low++; }
  }));
  return { total, withConf, low, avg: withConf ? Math.round((sum / withConf) * 1000) / 1000 : null };
}

// The P1-33 summary shape, computed from confidenceStats so the two
// never drift: { words: scored words, mean, low }.
export function confidenceSummary(sentences) {
  const st = confidenceStats(sentences, DEFAULT_CONFIDENCE_THRESHOLD);
  return { words: st.withConf, mean: st.avg, low: st.low };
}

// Proofreading: deterministic, rule-based corrections over the caption text.
// Rules only ever fire on exact patterns (no model, no guessing): collapsed
// whitespace, a doubled word ("the the"), a space before , . ! ? or ), a
// missing space after , . ! ? or ), and a capital at the start of a Latin
// sentence. Arabic script has no case, so the capital rule skips it.
// Returns { sentences, corrections: [{ clipId, before, after, rule }] } —
// the caller applies the text edits through the store (one undo step).
const PROOF_RULES = [
  { id: 'whitespace', fix: (t) => t.replace(/\s+/g, ' ').trim() },
  { id: 'double-word', fix: (t) => t.replace(/\b(\p{L}+)\s+\1\b/giu, '$1') },
  { id: 'space-before-punct', fix: (t) => t.replace(/\s+([,.!?:;)])/g, '$1') },
  { id: 'space-after-punct', fix: (t) => t.replace(/([,.!?;:])(?=\S)/g, '$1 ') },
  {
    id: 'sentence-capital',
    fix: (t) => t.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase()),
  },
];
export function proofreadSentences(sentences) {
  const corrections = [];
  const next = (sentences || []).map((s) => {
    let text = s.text || '';
    for (const r of PROOF_RULES) {
      const fixed = r.fix(text);
      if (fixed !== text) { corrections.push({ clipId: s.clipId, before: text, after: fixed, rule: r.id }); text = fixed; }
    }
    return text === s.text ? s : { ...s, text };
  });
  return { sentences: next, corrections };
}

// --- P1-32 — transcript labelling (speaker labels) -------------------------
// A caption clip carries `speaker` (a free label, e.g. "Hamza" / "Speaker 1").
// labelSpeakers applies a { clipId: speaker } map to sentence objects;
// speakerSegments groups consecutive sentences with the same speaker so the
// panel can render turn blocks. Diarization itself is NOT done here: labels
// come from the user (or a future diarizer) — nothing is guessed.
export function labelSpeakers(sentences, labels) {
  if (!labels) return sentences;
  return (sentences || []).map((s) => (labels[s.clipId] ? { ...s, speaker: labels[s.clipId] } : s));
}
export function speakerSegments(sentences) {
  const out = [];
  for (const s of sentences || []) {
    const sp = s.speaker || null;
    const last = out[out.length - 1];
    if (last && last.speaker === sp) { last.sentences.push(s); last.end = s.end; }
    else out.push({ speaker: sp, start: s.start, end: s.end, sentences: [s] });
  }
  return out;
}

// ---- AI-03: speaker ids + names ------------------------------------------
// Speaker ids the panel offers. Names live on the project
// (project.speakers: { S1: 'Hamza', … }); an id with no name shows as
// "Speaker 1", "Speaker 2", …
export const SPEAKER_IDS = ['S1', 'S2', 'S3', 'S4'];
export function speakerName(project, id) {
  if (!id) return '';
  const named = project?.speakers?.[id];
  if (named) return String(named);
  const n = Number(String(id).replace(/^S/, ''));
  return Number.isFinite(n) && n >= 1 ? `Speaker ${n}` : String(id);
}

// The distinct speakers used across the transcript, in first-appearance order.
export function speakersUsed(sentences) {
  const out = [];
  (sentences || []).forEach((s) => { if (s.speaker && !out.includes(s.speaker)) out.push(s.speaker); });
  return out;
}

