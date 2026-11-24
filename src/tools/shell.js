import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { resolvePath, isAllowlisted, isBlockedCommand } from '../util/sandbox.js';
import { truncate } from '../util/text.js';

const IS_WIN = process.platform === 'win32';

function killTree(child) {
  if (!child.pid) return;
  if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function runShell(command, { cwd, timeoutSec = 60, signal } = {}) {
  return new Promise((resolve) => {
    const child = IS_WIN
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { cwd, windowsHide: true })
      : spawn('/bin/sh', ['-c', command], { cwd, detached: true });
    let out = '';
    let err = '';
    let timedOut = false;
    const cap = (s, add) => (s.length > 200_000 ? s : s + add);
    child.stdout.on('data', (d) => (out = cap(out, d.toString('utf8'))));
    child.stderr.on('data', (d) => (err = cap(err, d.toString('utf8'))));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutSec * 1000);
    const onAbort = () => killTree(child);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, out, err, timedOut });
    });
  });
}

export default [
  {
    name: 'run_command',
    group: 'shell',
    risk: (args, ctx) => (isAllowlisted(args.command, ctx.settings.shellAllowlist) ? 'read' : 'exec'),
    summarize: (a) => `Run ${IS_WIN ? 'PowerShell' : 'shell'} command: ${a.command}${a.cwd ? `  (in ${a.cwd})` : ''}`,
    description: `Run a ${IS_WIN ? 'PowerShell' : 'shell'} command on this computer and return its output. Starts in the workspace folder. Use for things that genuinely need the system (installing, converting files, git, scripts).`,
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'Optional working folder' } },
      required: ['command'],
    },
    run: async (args, ctx) => {
      const command = String(args.command ?? '').trim();
      if (!command) throw new Error('Empty command');
      if (isBlockedCommand(command)) throw new Error('That command is on the hard block list (destructive system operation) and is never run.');
      fs.mkdirSync(ctx.settings.workspace, { recursive: true });
      const { target } = resolvePath(args.cwd || '.', ctx.settings.workspace, ctx.settings.fullDiskAccess);
      const r = await runShell(command, { cwd: target, timeoutSec: ctx.settings.shellTimeoutSec, signal: ctx.signal });
      const parts = [`exit code ${r.code}${r.timedOut ? ` (killed after ${ctx.settings.shellTimeoutSec}s timeout)` : ''}`];
      if (r.out.trim()) parts.push(truncate(r.out.trim(), 6000));
      if (r.err.trim()) parts.push(`stderr:\n${truncate(r.err.trim(), 2500)}`);
      if (!r.out.trim() && !r.err.trim()) parts.push('(no output)');
      return parts.join('\n');
    },
  },
];
