import crypto from 'node:crypto';
import { all, run } from './db.js';
import { DEFAULT_WORKSPACE } from './paths.js';

export const CHANNEL_DEFAULTS = {
  telegram: { enabled: false, token: '' },
  discord: { enabled: false, token: '' },
  slack: { enabled: false, botToken: '', appToken: '' },
  whatsapp: { enabled: false, token: '', phoneNumberId: '', verifyToken: '', appSecret: '' },
  phone: { enabled: false, accountSid: '', authToken: '', fromNumber: '', voice: true },
};

export const TOOL_GROUPS = ['memory', 'tasks', 'web', 'browser', 'files', 'shell', 'messaging', 'skills', 'http'];

const DEFAULTS = {
  onboarded: false,
  assistantName: 'Assistant',
  userName: '',
  aboutUser: '',
  persona: 'Warm, direct and practical. Gets things done, keeps answers short, and checks in before doing anything risky.',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',

  provider: 'ollama', // 'ollama' | 'openai' (any OpenAI-compatible server: LM Studio, llama.cpp, vLLM, LocalAI…)
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  openaiBaseUrl: 'http://127.0.0.1:1234/v1',
  openaiApiKey: '',
  model: '',
  visionModel: '',
  contextWindow: 8192,
  temperature: 0.3,
  maxToolSteps: 8,
  historyMessages: 24,

  permissionMode: 'ask', // 'ask' | 'auto' | 'readonly'
  workspace: DEFAULT_WORKSPACE,
  fullDiskAccess: false,
  shellTimeoutSec: 60,
  // Commands that run without asking in Ask mode (exact prefix, no pipes/redirects/chaining).
  // Deliberately excludes file readers like cat/type/Get-Content so a prompt-injected page
  // can't quietly read secrets off the disk.
  shellAllowlist: ['ls', 'dir', 'pwd', 'echo', 'whoami', 'date', 'Get-Date', 'Get-ChildItem', 'git status', 'git log', 'git diff', 'node -v', 'node --version', 'python --version'],
  toolGroups: Object.fromEntries(TOOL_GROUPS.map((g) => [g, true])),
  disabledSkills: [],

  autoMemory: true,
  searchProvider: 'duckduckgo', // 'duckduckgo' | 'searxng'
  searxngUrl: '',
  browserPath: '',
  browserHeadless: true,

  publicUrl: '',
  accessToken: '',
  channels: CHANNEL_DEFAULTS,
  defaultPeers: {},
  chatSessions: {},
};

const SECRET_PATHS = [
  'openaiApiKey',
  'accessToken',
  'channels.telegram.token',
  'channels.discord.token',
  'channels.slack.botToken',
  'channels.slack.appToken',
  'channels.whatsapp.token',
  'channels.whatsapp.appSecret',
  'channels.phone.authToken',
];

let cache = null;

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

function load() {
  const stored = {};
  for (const row of all('SELECT key, value FROM settings')) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      /* ignore corrupt values */
    }
  }
  return deepMerge(DEFAULTS, stored);
}

export function getSettings() {
  if (cache) return cache;
  cache = load();
  if (!cache.accessToken) {
    setSettings({ accessToken: crypto.randomBytes(24).toString('base64url') });
    return getSettings();
  }
  return cache;
}

export function setSettings(patch) {
  const current = cache || load();
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    const merged = isObj(value) && isObj(current[key]) ? deepMerge(current[key], value) : value;
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(merged));
  }
  cache = null;
  return getSettings();
}

const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, p, v) {
  const keys = p.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) return;
    o = o[k];
  }
  o[keys.at(-1)] = v;
}

export const MASK = '••••••••';

/** Settings safe to send to the browser: secrets are masked. */
export function publicSettings() {
  const s = structuredClone(getSettings());
  for (const p of SECRET_PATHS) {
    const v = getPath(s, p);
    if (v) setPath(s, p, p === 'accessToken' ? v : MASK + String(v).slice(-4));
  }
  return s;
}

/** Drops masked placeholder values so saving the form never overwrites a real secret with dots. */
export function stripMasked(patch) {
  const copy = structuredClone(patch);
  for (const p of SECRET_PATHS) {
    const v = getPath(copy, p);
    if (typeof v === 'string' && v.startsWith(MASK)) {
      const keys = p.split('.');
      let o = copy;
      for (const k of keys.slice(0, -1)) o = o?.[k];
      if (o) delete o[keys.at(-1)];
    }
  }
  return copy;
}
