import { audit } from '../db.js';
import { requestApproval } from '../approvals.js';
import { truncate } from '../util/text.js';
import tasks from './tasks.js';
import web from './web.js';
import files from './files.js';
import shell from './shell.js';
import browser from './browser.js';
import misc from './misc.js';

export const ALL_TOOLS = [...tasks, ...web, ...browser, ...files, ...shell, ...misc];

/**
 * Risk levels and what each permission mode does with them:
 *
 *   risk        readonly   ask        auto
 *   safe        allow      allow      allow    assistant's own data: memory, to-dos, schedules
 *   read        allow      allow      allow    web reads, files inside the workspace, allowlisted commands
 *   workspace   deny       allow      allow    writing files inside the workspace
 *   sensitive   ask        ask        allow    reading outside the workspace
 *   write       deny       ask        allow    writing outside the workspace, creating skills
 *   exec        deny       ask        allow    shell commands
 *   external    deny       ask        allow    acting on the outside world: clicking/typing on sites, POST requests
 */
const POLICY = {
  readonly: { safe: 'allow', read: 'allow', workspace: 'deny', sensitive: 'ask', write: 'deny', exec: 'deny', external: 'deny' },
  ask: { safe: 'allow', read: 'allow', workspace: 'allow', sensitive: 'ask', write: 'ask', exec: 'ask', external: 'ask' },
  auto: { safe: 'allow', read: 'allow', workspace: 'allow', sensitive: 'allow', write: 'allow', exec: 'allow', external: 'allow' },
};

export function enabledTools(settings) {
  const groups = settings.toolGroups || {};
  return ALL_TOOLS.filter((t) => groups[t.group] !== false);
}

export function toolByName(name) {
  return ALL_TOOLS.find((t) => t.name === name);
}

function assess(tool, args, ctx) {
  let risk;
  try {
    risk = typeof tool.risk === 'function' ? tool.risk(args, ctx) : tool.risk;
  } catch (err) {
    return { action: 'deny', risk: 'unknown', reason: err.message };
  }
  const mode = POLICY[ctx.settings.permissionMode] ? ctx.settings.permissionMode : 'ask';
  return { action: POLICY[mode][risk] || 'ask', risk, mode };
}

/** Validates arguments against the tool's JSON schema just enough to give the model a useful error. */
function checkArgs(tool, args) {
  const req = tool.parameters?.required || [];
  const missing = req.filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
  if (missing.length) throw new Error(`Missing required argument(s): ${missing.join(', ')}`);
}

/**
 * Runs one tool call with policy, approval and audit. Never throws — errors come back as
 * text the model can read and recover from.
 */
export async function executeTool(call, ctx) {
  const started = Date.now();
  const tool = toolByName(call.name);
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const finish = (status, output, extra = {}) => {
    audit({ sessionId: ctx.sessionId, kind: 'tool', name: call.name, input: args, output, status, durationMs: Date.now() - started });
    return { status, output: String(output), ...extra };
  };

  if (!tool || ctx.settings.toolGroups?.[tool.group] === false) return finish('error', `Unknown or disabled tool "${call.name}".`);
  try {
    checkArgs(tool, args);
  } catch (err) {
    return finish('error', err.message);
  }

  const verdict = assess(tool, args, ctx);
  if (verdict.action === 'deny') {
    return finish('denied', verdict.reason || `"${call.name}" is not allowed in ${verdict.mode === 'readonly' ? 'Read-only' : verdict.mode} mode. Tell the user what you wanted to do so they can do it or change the permission mode.`);
  }
  if (verdict.action === 'ask') {
    let summary = `${call.name} ${JSON.stringify(args)}`;
    try {
      if (tool.summarize) summary = tool.summarize(args, ctx);
    } catch {
      /* fall back to raw args */
    }
    ctx.onEvent?.('tool_waiting', { callId: call.id, summary });
    const decision = await requestApproval({ sessionId: ctx.sessionId, tool: call.name, args, summary: truncate(summary, 600), signal: ctx.signal });
    if (decision !== 'approved') {
      return finish('denied', decision === 'expired' ? 'The user did not answer the approval request in time, so this was not done.' : 'The user declined this action. Do not retry it; ask what they would like instead.');
    }
  }

  try {
    const result = await tool.run(args, ctx);
    if (result && typeof result === 'object') return finish('ok', result.output, { image: result.image });
    return finish('ok', result ?? '(done)');
  } catch (err) {
    if (ctx.signal?.aborted) return finish('error', 'Stopped by the user.');
    return finish('error', `Error: ${err.message}`);
  }
}
