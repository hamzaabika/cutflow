// App settings stored in <userData>/settings.json.
// API keys are encrypted with Electron safeStorage (Windows DPAPI: only this Windows user on this PC can
// decrypt them). They are never written in plain text, never logged and never sent to the renderer;
// the UI only gets a short hint (last 4 characters).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const PROVIDERS = ['gemini', 'groq', 'ollama', 'openai', 'openrouter', 'claude', 'custom'];
const DEFAULT_MODELS = {
  gemini: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',
  ollama: 'qwen2.5:7b',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  claude: 'claude-haiku-5-5',
  custom: '',
};

function settingsFile() {
  // UI tests must never touch the real settings.
  const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'settings-test') : app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'settings.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function write(data) {
  fs.writeFileSync(settingsFile(), JSON.stringify(data, null, 2), 'utf8');
}

// What the renderer may see.
function getPublic() {
  const ai = read().ai || {};
  const keys = {};
  for (const p of PROVIDERS) if (ai.keys && ai.keys[p]) keys[p] = ai.keys[p].hint;
  return {
    provider: PROVIDERS.includes(ai.provider) ? ai.provider : 'gemini',
    models: { ...DEFAULT_MODELS, ...(ai.models || {}) },
    baseUrls: ai.baseUrls || {},
    keys, // provider -> "…abcd" for providers that have a saved key
    defaultModels: DEFAULT_MODELS,
    encryption: safeStorage.isEncryptionAvailable(),
    serviceKeys: Object.fromEntries(SERVICES.filter((n) => read().services?.[n]).map((n) => [n, read().services[n].hint])),
    mcpServers: getMcpServers(),
    bridgeEnabled: getBridgeEnabled(),
    keymap: getKeymap(),
    keystrokes: getKeystrokes(),
  };
}

// ---- Agent bridge (electron/bridge.cjs): a local, token-gated door for
// external agent tools. Only the on/off choice persists — the token is minted
// per launch in memory and the port is discovered at runtime, so neither is
// ever written here. Default OFF: while off, nothing listens. ----
const getBridgeEnabled = () => read().bridge?.enabled === true;
function setBridgeEnabled(on) {
  const data = read();
  data.bridge = { ...(data.bridge || {}), enabled: on === true };
  write(data);
  return data.bridge.enabled;
}

// ---- Keyboard shortcuts (Sprint 11): the user's rebindings, stored as a
// diff from the shipped defaults — { actionId: [chord, ...] }, an empty
// array meaning "unbound". src/keymap.js owns the catalogue, the defaults
// and resolution; this layer only sanitises the shape for storage (known
// size bounds, strings only) so a corrupt file can never grow teeth. ----
function sanitizeKeymap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, list] of Object.entries(raw)) {
    if (typeof id !== 'string' || id.length > 40 || !Array.isArray(list)) continue;
    const chords = list.filter((c) => typeof c === 'string' && c.length > 0 && c.length <= 48).slice(0, 6);
    out[id] = chords;
  }
  return out;
}
const getKeymap = () => sanitizeKeymap(read().keymap);
function setKeymap(map) {
  const data = read();
  data.keymap = sanitizeKeymap(map);
  write(data);
  return getPublic();
}

// ---- On-screen keystroke display (Sprint 11): a plain on/off choice. ----
const getKeystrokes = () => read().keystrokes === true;
function setKeystrokes(on) {
  const data = read();
  data.keystrokes = on === true;
  write(data);
  return getPublic();
}

// ---- MCP servers (external tool servers the agent may call) ----
// A server is one of two transports (10/10 step 4): a local stdio process
// (command + args) or a remote streamable-HTTP endpoint (url). Entries may
// carry per-server env vars and HTTP headers. Values may reference the
// app's own environment as ${VAR} — the client expands those at connect
// time (electron/mcp.cjs) — which is the way to hand a server a token:
// the secret stays in the environment, never in this file. Literal values
// are stored as plain config, like the command line itself.
function sanitizeMcpServer(s) {
  if (!s || typeof s !== 'object') return null;
  const name = String(s.name || '').trim();
  if (!name) return null;
  const command = String(s.command || '').trim();
  const url = String(s.url || '').trim();
  if (!command && !url) return null;
  if (url && !/^https?:\/\//i.test(url)) return null;
  const strMap = (v) => {
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v)) {
        const key = String(k).trim();
        if (key && typeof val === 'string' && val.length <= 4096) out[key] = val;
      }
    }
    return out;
  };
  const env = strMap(s.env);
  const headers = strMap(s.headers);
  return {
    name,
    command,
    args: Array.isArray(s.args) ? s.args.map(String).slice(0, 32) : [],
    ...(url ? { url } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

function getMcpServers() {
  const list = read().mcpServers;
  return (Array.isArray(list) ? list : []).map(sanitizeMcpServer).filter(Boolean);
}

function setMcpServers(list) {
  const clean = (Array.isArray(list) ? list : []).map(sanitizeMcpServer).filter(Boolean);
  const data = read();
  data.mcpServers = clean;
  write(data);
  return getPublic();
}

// ---- Keys of other services (stock media). Same encryption, same rules as the AI keys. ----
const SERVICES = ['pixabay', 'soundza', 'elevenlabs', 'cap-groq', 'cap-openai', 'cap-deepgram', 'cap-elevenlabs'];

function getServiceKey(name) {
  const entry = read().services?.[name];
  if (!SERVICES.includes(name) || !entry || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
  } catch {
    return '';
  }
}

function saveServiceKey(name, key) {
  if (!SERVICES.includes(name)) throw new Error('Unknown service');
  const k = String(key || '').trim();
  if (!k) throw new Error('Paste a key first.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this PC, so the key was not saved.');
  const data = read();
  data.services = { ...(data.services || {}), [name]: { enc: safeStorage.encryptString(k).toString('base64'), hint: `…${k.slice(-4)}` } };
  write(data);
  return getPublic();
}

function clearServiceKey(name) {
  const data = read();
  if (data.services) delete data.services[name];
  write(data);
  return getPublic();
}

// Active configuration for the main process, including the decrypted key.
function getActive(providerOverride) {
  const ai = read().ai || {};
  const provider = providerOverride || (PROVIDERS.includes(ai.provider) ? ai.provider : 'gemini');
  let apiKey = '';
  const entry = ai.keys && ai.keys[provider];
  if (entry && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
    } catch {
      apiKey = ''; // saved under another Windows account or corrupted: treat as not set
    }
  }
  return {
    provider,
    model: (ai.models && ai.models[provider]) || DEFAULT_MODELS[provider],
    baseUrl: (ai.baseUrls && ai.baseUrls[provider]) || '',
    apiKey,
  };
}

// patch: { provider, model, baseUrl, apiKey } (apiKey optional: omitted keeps the saved key).
function save(patch) {
  const data = read();
  const ai = data.ai || {};
  const provider = PROVIDERS.includes(patch.provider) ? patch.provider : ai.provider || 'gemini';
  ai.provider = provider;
  ai.models = { ...(ai.models || {}), [provider]: (patch.model || '').trim() || DEFAULT_MODELS[provider] };
  ai.baseUrls = { ...(ai.baseUrls || {}), [provider]: (patch.baseUrl || '').trim().replace(/\/+$/, '') };
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this PC, so the key was not saved.');
    }
    const key = patch.apiKey.trim();
    ai.keys = {
      ...(ai.keys || {}),
      [provider]: { enc: safeStorage.encryptString(key).toString('base64'), hint: `…${key.slice(-4)}` },
    };
  }
  data.ai = ai;
  write(data);
  return getPublic();
}

function clearKey(provider) {
  const data = read();
  if (data.ai && data.ai.keys) delete data.ai.keys[provider];
  write(data);
  return getPublic();
}

// Playback quality (which scaled copy the player uses; the export always reads the originals).
// Stored as `quality`; the old boolean `proxy` is migrated (on -> 'medium', off -> 'full') and
// kept in sync for anything that still reads it. See quality.cjs.
const { qualityFromStored, isQuality } = require('./quality.cjs');
const getQuality = () => qualityFromStored(read());
function setQuality(q) {
  const data = read();
  data.quality = isQuality(q) ? q : 'full';
  data.proxy = data.quality !== 'full';
  write(data);
  return data.quality;
}
const getProxy = () => getQuality() !== 'full';
function setProxy(on) {
  return setQuality(on === true ? 'medium' : 'full') !== 'full';
}

// First-run default (Sprint 9, parity-matrix Arch-2: proxy mode default-on for
// new projects): a brand-new install — no settings file at all — starts at
// playback quality 'medium', so scaled preview copies (and the light fallback)
// are generated from the first import and a weak machine gets smooth playback
// without a trip to Settings. An existing settings file is never touched: a
// stored choice stands, and so does the historical no-key resolution that
// quality.cjs pins ('full'). Called once at startup; a failed write must
// never block it.
function ensureQualityDefault() {
  try {
    if (process.env.FVE_SMOKE) return; // UI tests manage their own settings file
    if (fs.existsSync(settingsFile())) return;
    write({ quality: 'medium', proxy: true });
  } catch { /* the default is a convenience, not a requirement */ }
}

// Performance mode (perf program, 2026-11-01): a bundle of resource knobs — the
// playback-quality default, how many background media jobs run at once, and whether
// exports yield CPU to the rest of the PC. It never touches export quality settings.
const PERF_MODES = ['low-end', 'balanced', 'high-performance'];
const getPerfMode = () => { const m = read().perfMode; return PERF_MODES.includes(m) ? m : 'balanced'; };
function setPerfMode(m) {
  const data = read();
  data.perfMode = PERF_MODES.includes(m) ? m : 'balanced';
  write(data);
  return data.perfMode;
}

// ---- Fx segment cache cap (10/10 step 4): the size bound for the persistent
// fx-segment cache (electron/fxjobs.cjs eviction). Stored in MB for a sane
// Settings control; the engine reads bytes. Default 2048 MB (the engine's own
// DEFAULT_CACHE_CAP_BYTES); a corrupt value resolves to the default. ----
const FX_CACHE_CAP_DEFAULT_MB = 2048;
const getFxCacheCapMB = () => {
  const v = Number(read().fxCacheCapMB);
  return Number.isFinite(v) && v >= 128 && v <= 65536 ? Math.round(v) : FX_CACHE_CAP_DEFAULT_MB;
};
function setFxCacheCapMB(mb) {
  const data = read();
  const v = Number(mb);
  data.fxCacheCapMB = Number.isFinite(v) ? Math.min(65536, Math.max(128, Math.round(v))) : FX_CACHE_CAP_DEFAULT_MB;
  write(data);
  return data.fxCacheCapMB;
}

// ---- First-run experience: the welcome card shows exactly once. Its seen-flag
// lives here, alongside the other settings. ----
const FIRST_RUN_KEYS = ['tourSeen'];
const getFirstRun = () => {
  const f = read().firstRun || {};
  return Object.fromEntries(FIRST_RUN_KEYS.map((k) => [k, f[k] === true]));
};
function setFirstRun(patch) {
  const data = read();
  const cur = { ...(data.firstRun || {}) };
  for (const k of FIRST_RUN_KEYS) if (typeof patch?.[k] === 'boolean') cur[k] = patch[k];
  data.firstRun = cur;
  write(data);
  return getFirstRun();
}

module.exports = { getProxy, setProxy, getQuality, setQuality, ensureQualityDefault, getPerfMode, setPerfMode, PERF_MODES, getPublic, getActive, save, clearKey, getServiceKey, saveServiceKey, clearServiceKey, getMcpServers, setMcpServers, sanitizeMcpServer, getFirstRun, setFirstRun, getBridgeEnabled, setBridgeEnabled, getKeymap, setKeymap, getKeystrokes, setKeystrokes, getFxCacheCapMB, setFxCacheCapMB, PROVIDERS, DEFAULT_MODELS };
