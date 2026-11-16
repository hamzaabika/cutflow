// Audio roles + track mixer (P2-23, AU-09) — Dialogue / Music / SFX /
// Ambience buses with per-bus gain, mute and solo, plus a master bus.
// A clip's role is explicit when set (clip.role); otherwise the smart
// default applies: picture clips (main + overlay) carry dialogue, audio
// clips carry music. The renderer (Preview) and the export (ffmpeg.cjs)
// both read these helpers, so a bus level sounds the same in both.
export const AUDIO_ROLES = ['dialogue', 'music', 'sfx', 'ambience'];
export const ROLE_NAMES = { dialogue: 'Dialogue', music: 'Music', sfx: 'SFX', ambience: 'Ambience' };

// Smart-default bus levels (dB): music and ambience sit under dialogue so a
// fresh project already balances instead of clipping the mix.
export const ROLE_DEFAULT_GAIN_DB = { dialogue: 0, music: -6, sfx: 0, ambience: -12 };
export const GAIN_DB_MIN = -60;
export const GAIN_DB_MAX = 12;

export const DEFAULT_MIXER = {
  dialogue: 0, music: -6, sfx: 0, ambience: -12, master: 0,
  muted: {}, solo: {},
};

export const isRole = (r) => AUDIO_ROLES.includes(r);

// The clip's bus: explicit role wins; otherwise the smart default by track.
export function roleOf(clip, track) {
  if (clip && isRole(clip.role)) return clip.role;
  if (track === 'audio') return 'music';
  return 'dialogue';
}

export const clampGainDb = (db) => Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, Number.isFinite(Number(db)) ? Number(db) : 0));
export const gainDbToLinear = (db) => Math.pow(10, clampGainDb(db) / 20);

export function mixerOf(project) {
  const m = (project && project.mixer) || {};
  return { ...DEFAULT_MIXER, ...m, muted: { ...(m.muted || {}) }, solo: { ...(m.solo || {}) } };
}

export function roleGainDb(project, role) {
  const m = mixerOf(project);
  return clampGainDb(m[role] ?? ROLE_DEFAULT_GAIN_DB[role] ?? 0);
}

export function masterGainDb(project) {
  return clampGainDb(mixerOf(project).master ?? 0);
}

// Does this bus reach the mix? A muted bus is silent; once any bus is
// soloed, only soloed buses sound.
export function busAudible(project, role) {
  const m = mixerOf(project);
  if (m.muted[role]) return false;
  const anySolo = AUDIO_ROLES.some((r) => m.solo[r]);
  return !anySolo || !!m.solo[role];
}

// The linear gain a clip's sound is multiplied by in preview and export:
// 0 when its bus is muted / soloed-out, else its bus gain.
export function busGainLinear(project, clip, track) {
  const role = roleOf(clip, track);
  if (!busAudible(project, role)) return 0;
  return gainDbToLinear(roleGainDb(project, role));
}

// Sanitize a stored mixer (project loads): gains clamped, mute/solo kept to
// known roles only.
export function sanitizeMixer(m) {
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
