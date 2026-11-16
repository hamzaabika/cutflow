// Audio roles + track mixer (P2-23, AU-09) — the main-process mirror of
// src/mixer.js. The renderer needs the same numbers to preview bus levels;
// the export needs them to build volume filters. A suite
// (scripts/test-mixer.mjs) keeps the two in sync, the same arrangement as
// the audioFx chain mirror.
const AUDIO_ROLES = ['dialogue', 'music', 'sfx', 'ambience'];
const ROLE_DEFAULT_GAIN_DB = { dialogue: 0, music: -6, sfx: 0, ambience: -12 };
const GAIN_DB_MIN = -60;
const GAIN_DB_MAX = 12;
const DEFAULT_MIXER = {
  dialogue: 0, music: -6, sfx: 0, ambience: -12, master: 0,
  muted: {}, solo: {},
};

const isRole = (r) => AUDIO_ROLES.includes(r);

function roleOf(clip, track) {
  if (clip && isRole(clip.role)) return clip.role;
  if (track === 'audio') return 'music';
  return 'dialogue';
}

const clampGainDb = (db) => Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, Number.isFinite(Number(db)) ? Number(db) : 0));
const gainDbToLinear = (db) => Math.pow(10, clampGainDb(db) / 20);

function mixerOf(project) {
  const m = (project && project.mixer) || {};
  return { ...DEFAULT_MIXER, ...m, muted: { ...(m.muted || {}) }, solo: { ...(m.solo || {}) } };
}

function roleGainDb(project, role) {
  const m = mixerOf(project);
  return clampGainDb(m[role] ?? ROLE_DEFAULT_GAIN_DB[role] ?? 0);
}

function masterGainDb(project) {
  return clampGainDb(mixerOf(project).master ?? 0);
}

function busAudible(project, role) {
  const m = mixerOf(project);
  if (m.muted[role]) return false;
  const anySolo = AUDIO_ROLES.some((r) => m.solo[r]);
  return !anySolo || !!m.solo[role];
}

function busGainLinear(project, clip, track) {
  const role = roleOf(clip, track);
  if (!busAudible(project, role)) return 0;
  return gainDbToLinear(roleGainDb(project, role));
}

const num = (v) => String(Math.round(v * 1000) / 1000);

// The volume filter for one clip's bus in the export graph, or null when the
// bus sits at unity (and audible — silence is handled by the caller's mute
// filtering, exactly as clip.muted already is).
function busVolumeFilter(project, clip, track) {
  const g = busGainLinear(project, clip, track);
  if (g === 1) return null;
  if (g === 0) return 'volume=0';
  return `volume=${num(g)}`;
}

// The master bus filter for the finished mix, or null at unity.
function masterVolumeFilter(project) {
  const g = gainDbToLinear(masterGainDb(project));
  return g === 1 ? null : `volume=${num(g)}`;
}

function sanitizeMixer(m) {
  const out = { ...DEFAULT_MIXER };
  if (!m || typeof m !== 'object') return out;
  for (const r of AUDIO_ROLES) if (Number.isFinite(Number(m[r]))) out[r] = clampGainDb(m[r]);
  if (Number.isFinite(Number(m.master))) out.master = clampGainDb(m.master);
  for (const k of ['muted', 'solo']) {
    out[k] = {};
    if (m[k] && typeof m[k] === 'object') {
      for (const r of AUDIO_ROLES) if (m[k][r]) out[k][r] = true;
    }
  }
  return out;
}

module.exports = {
  AUDIO_ROLES, ROLE_DEFAULT_GAIN_DB, DEFAULT_MIXER, GAIN_DB_MIN, GAIN_DB_MAX,
  isRole, roleOf, clampGainDb, gainDbToLinear, mixerOf, roleGainDb,
  masterGainDb, busAudible, busGainLinear, busVolumeFilter, masterVolumeFilter, sanitizeMixer,
};
