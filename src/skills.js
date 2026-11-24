import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_SKILLS_DIR, USER_SKILLS_DIR } from './paths.js';
import { getSettings } from './config.js';
import { emit } from './events.js';

/**
 * Skills are folders with a SKILL.md: YAML-ish frontmatter (name, description) and
 * Markdown instructions. The model sees the index (name + description) and loads the full
 * instructions on demand with the use_skill tool. User skills in data/skills override
 * bundled ones with the same name; the assistant can write new ones itself.
 */

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,48}$/;

export function parseSkill(raw) {
  const text = String(raw ?? '').replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  let body = text;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: body.trim() };
}

function readDir(dir, source) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body } = parseSkill(raw);
    out.push({ name: meta.name || entry.name, description: meta.description || body.split('\n')[0].slice(0, 140), source, file, raw, body });
  }
  return out;
}

export function allSkills() {
  const disabled = new Set(getSettings().disabledSkills || []);
  const map = new Map();
  for (const s of readDir(BUNDLED_SKILLS_DIR, 'bundled')) map.set(s.name, s);
  for (const s of readDir(USER_SKILLS_DIR, 'custom')) map.set(s.name, { ...s, overridesBundled: map.has(s.name) });
  return [...map.values()].map((s) => ({ ...s, enabled: !disabled.has(s.name) })).sort((a, b) => a.name.localeCompare(b.name));
}

export const enabledSkills = () => allSkills().filter((s) => s.enabled);

export function getSkill(name) {
  return allSkills().find((s) => s.name === name) || null;
}

export function saveSkill(name, raw) {
  if (!SKILL_NAME.test(name)) throw new Error('Skill names use lowercase letters, numbers and dashes (2–49 characters)');
  const { meta, body } = parseSkill(raw);
  if (!body) throw new Error('Skill instructions are empty');
  let text = String(raw);
  if (!meta.name || meta.name !== name) {
    text = `---\nname: ${name}\ndescription: ${meta.description || body.split('\n')[0].slice(0, 140)}\n---\n\n${body}\n`;
  }
  const dir = path.join(USER_SKILLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text, 'utf8');
  emit('skills_changed', { name });
  return getSkill(name);
}

export function createSkill({ name, description, instructions }) {
  const clean = String(name || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 49);
  const desc = String(description || '').replace(/\s+/g, ' ').trim();
  if (!desc) throw new Error('A skill needs a one-line description of when to use it');
  return saveSkill(clean, `---\nname: ${clean}\ndescription: ${desc}\n---\n\n${String(instructions || '').trim()}\n`);
}

export function deleteSkill(name) {
  const dir = path.join(USER_SKILLS_DIR, name);
  if (!SKILL_NAME.test(name) || !fs.existsSync(dir)) throw new Error('Only custom skills can be deleted (bundled skills can be disabled instead)');
  fs.rmSync(dir, { recursive: true, force: true });
  emit('skills_changed', { name });
}
