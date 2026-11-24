import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from '../util/sandbox.js';
import { truncate } from '../util/text.js';

const ws = (ctx) => {
  fs.mkdirSync(ctx.settings.workspace, { recursive: true });
  return ctx.settings.workspace;
};
const where = (args, ctx, key = 'path') => resolvePath(args[key], ws(ctx), ctx.settings.fullDiskAccess);
const readRisk = (args, ctx) => (where(args, ctx).inside ? 'read' : 'sensitive');
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache']);

function isBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) yield* walk(full, depth + 1);
    } else if (e.isFile()) yield full;
  }
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default [
  {
    name: 'read_file',
    group: 'files',
    risk: readRisk,
    summarize: (a) => `Read file ${a.path}`,
    description: 'Read a text file. Relative paths are inside the assistant workspace folder.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: (args, ctx) => {
      const { target, display } = where(args, ctx);
      if (!fs.existsSync(target)) return `No file at ${display}.`;
      const st = fs.statSync(target);
      if (st.isDirectory()) return `${display} is a folder — use list_files.`;
      const fd = fs.openSync(target, 'r');
      const buf = Buffer.alloc(Math.min(st.size, 400_000));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      if (isBinary(buf)) return `${display} is a binary file (${fmtSize(st.size)}).`;
      return `${display} (${fmtSize(st.size)}):\n${truncate(buf.toString('utf8'), Math.max(3000, ctx.settings.contextWindow))}`;
    },
  },
  {
    name: 'write_file',
    group: 'files',
    risk: (args, ctx) => (where(args, ctx).inside ? 'workspace' : 'write'),
    summarize: (a) => `${a.append ? 'Append to' : 'Write'} ${a.path} (${String(a.content ?? '').length} characters)`,
    description: 'Create or overwrite a text file (or append to it). Relative paths go in the workspace folder. Use for notes, drafts, lists, code and exports.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
      required: ['path', 'content'],
    },
    run: (args, ctx) => {
      const { target, display } = where(args, ctx);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const content = String(args.content ?? '');
      if (args.append) fs.appendFileSync(target, content, 'utf8');
      else fs.writeFileSync(target, content, 'utf8');
      return `${args.append ? 'Appended' : 'Wrote'} ${content.length} characters to ${display}.`;
    },
  },
  {
    name: 'list_files',
    group: 'files',
    risk: readRisk,
    summarize: (a) => `List folder ${a.path || '.'}`,
    description: 'List a folder (default: the workspace).',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    run: (args, ctx) => {
      const { target, display } = where(args, ctx);
      if (!fs.existsSync(target)) return `No folder at ${display}.`;
      const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 300);
      if (!entries.length) return `${display} is empty.`;
      const lines = entries.map((e) => {
        if (e.isDirectory()) return `📁 ${e.name}/`;
        let size = '';
        try {
          size = fmtSize(fs.statSync(path.join(target, e.name)).size);
        } catch {
          /* unreadable */
        }
        return `   ${e.name}  ${size}`;
      });
      return `${display}:\n${lines.join('\n')}`;
    },
  },
  {
    name: 'search_files',
    group: 'files',
    risk: readRisk,
    summarize: (a) => `Search files in ${a.path || '.'} for "${a.query}"`,
    description: 'Find files whose name or text contains the query (case-insensitive), inside a folder (default: workspace).',
    parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] },
    run: (args, ctx) => {
      const { target, display } = where(args, ctx);
      const q = String(args.query).toLowerCase();
      const hits = [];
      let scanned = 0;
      for (const file of walk(target)) {
        if (++scanned > 3000 || hits.length >= 60) break;
        const rel = path.relative(target, file).replace(/\\/g, '/');
        if (rel.toLowerCase().includes(q)) hits.push(`${rel}  (name match)`);
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        if (st.size > 1_000_000) continue;
        const buf = fs.readFileSync(file);
        if (isBinary(buf)) continue;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < 60; i++) {
          if (lines[i].toLowerCase().includes(q)) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
        }
      }
      return hits.length ? `Matches in ${display}:\n${hits.join('\n')}` : `No matches for "${args.query}" in ${display}.`;
    },
  },
];
