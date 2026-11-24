import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.ASSISTANT_DATA || path.join(ROOT, 'data'));
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const BUNDLED_SKILLS_DIR = path.join(ROOT, 'skills');
export const USER_SKILLS_DIR = path.join(DATA_DIR, 'skills');
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
export const DEFAULT_WORKSPACE = path.join(ROOT, 'workspace');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USER_SKILLS_DIR, { recursive: true });
