import fs from 'node:fs';
import path from 'node:path';

/** Resolves a user/model supplied path against the workspace. Relative paths live inside the
 *  workspace; anything that escapes it is refused unless full disk access is on. Symlinks
 *  are resolved so a link inside the workspace can't point the assistant outside it. */
export function resolvePath(p, workspace, fullAccess = false) {
  const ws = path.resolve(workspace);
  const raw = String(p ?? '').trim() || '.';
  const expanded = raw.startsWith('~') ? path.join(process.env.USERPROFILE || process.env.HOME || ws, raw.slice(1)) : raw;
  let target = path.resolve(ws, expanded);
  try {
    // Resolve symlinks on the longest existing prefix.
    let probe = target;
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const real = fs.realpathSync(probe);
    target = path.join(real, path.relative(probe, target));
  } catch {
    /* keep lexical path */
  }
  let wsReal = ws;
  try {
    wsReal = fs.realpathSync(ws);
  } catch {
    /* workspace may not exist yet */
  }
  const rel = path.relative(wsReal, target);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside && !fullAccess) {
    throw new Error(`"${raw}" is outside the workspace folder (${ws}). Use a path inside it, or turn on Full disk access in Settings → Permissions.`);
  }
  return { target, inside, display: inside ? rel.replace(/\\/g, '/') || '.' : target };
}

/** Commands the person allowlisted run without asking — but only plain invocations with no
 *  chaining, pipes, redirects or substitutions that could smuggle in a second command. */
export function isAllowlisted(command, allowlist = []) {
  const cmd = String(command ?? '').trim();
  if (!cmd || /[;&|<>`$(){}\n\r]/.test(cmd)) return false;
  return allowlist.some((entry) => {
    const e = String(entry).trim();
    return e && (cmd === e || cmd.toLowerCase().startsWith(e.toLowerCase() + ' '));
  });
}

const BLOCKED = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\*|\/\*)(\s|$)/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=.+\s+of=\/dev\//i,
  /\bformat(\.com)?\s+[a-z]:/i,
  /\b(diskpart|bcdedit|cipher\s+\/w)\b/i,
  /\breg(\.exe)?\s+delete\s+hk(lm|ey_local_machine)/i,
  /Remove-Item\s+.*(-Recurse).*\s+['"]?[a-z]:\\?['"]?\s*$/i,
  /\b(shutdown|poweroff|reboot)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bvssadmin\s+delete\b/i,
];

/** Hard stops that apply in every permission mode, including Auto. */
export function isBlockedCommand(command) {
  return BLOCKED.some((re) => re.test(String(command ?? '')));
}
