import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { calculate } from '../src/util/calc.js';
import { parseTextToolCalls } from '../src/util/toolcalls.js';
import { htmlToText } from '../src/util/html.js';
import { chunkText, stripMarkdown, truncate } from '../src/util/text.js';
import { resolvePath, isAllowlisted, isBlockedCommand } from '../src/util/sandbox.js';

test('calculator', () => {
  assert.equal(calculate('2 + 3 * 4'), 14);
  assert.equal(calculate('(2 + 3) * 4'), 20);
  assert.equal(calculate('17.5% of 2340'), 409.5);
  assert.equal(calculate('2340 * 17.5%'), 409.5);
  assert.equal(calculate('2^10'), 1024);
  assert.equal(calculate('sqrt(144) + max(1, 7)'), 19);
  assert.equal(calculate('1,250 / 5'), 250);
  assert.throws(() => calculate('1 / 0'));
  assert.throws(() => calculate('process.exit()'));
});

const TOOLS = new Set(['web_search', 'todo_add']);

test('text tool calls: bare JSON, and invented continuations are dropped', () => {
  const r = parseTextToolCalls('{"name": "web_search", "arguments": {"query": "x"}}\n[{"title": "fake"}]\nIt opens at 10.', TOOLS);
  assert.deepEqual(r.calls, [{ name: 'web_search', args: { query: 'x' } }]);
  assert.equal(r.text, '');
});

test('text tool calls: tagged, fenced, preamble, arrays', () => {
  assert.equal(parseTextToolCalls('<tool_call>{"name":"todo_add","arguments":{"title":"a"}}</tool_call> Done!', TOOLS).calls[0].name, 'todo_add');
  assert.equal(parseTextToolCalls('```tool\n{"name":"todo_add","arguments":{"title":"b"}}\n```', TOOLS).calls[0].args.title, 'b');
  const pre = parseTextToolCalls('Let me check. {"name":"web_search","arguments":{"query":"y"}}', TOOLS);
  assert.equal(pre.text, 'Let me check.');
  assert.equal(parseTextToolCalls('[{"name":"web_search","arguments":{"query":"1"}},{"name":"todo_add","arguments":{"title":"2"}}]', TOOLS).calls.length, 2);
  assert.equal(parseTextToolCalls('{"name":"rm_rf","arguments":{}}', TOOLS).calls.length, 0, 'unknown tools are ignored');
  assert.equal(parseTextToolCalls('Here is JSON: {"a": 1}', TOOLS).calls.length, 0);
});

test('html to text', () => {
  const html = '<html><head><title>T &amp; C</title><style>x{}</style></head><body><nav>menu</nav><h1>Hello</h1><p>World <a href="/a">link</a></p><script>alert(1)</script></body></html>';
  const r = htmlToText(html, 'https://example.com/');
  assert.equal(r.title, 'T & C');
  assert.match(r.text, /# Hello/);
  assert.doesNotMatch(r.text, /alert|menu/);
  assert.equal(r.links[0].url, 'https://example.com/a');
});

test('text helpers', () => {
  const chunks = chunkText('a'.repeat(50) + '\n\n' + 'b'.repeat(50), 60);
  assert.equal(chunks.length, 2);
  assert.equal(stripMarkdown('**bold** and [link](https://x.y)'), 'bold and link (https://x.y)');
  assert.ok(truncate('x'.repeat(100), 20).includes('omitted'));
});

test('workspace sandbox', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ws-'));
  assert.equal(resolvePath('notes/a.md', ws).inside, true);
  assert.throws(() => resolvePath('../escape.txt', ws));
  assert.throws(() => resolvePath(os.homedir(), ws));
  assert.equal(resolvePath(os.homedir(), ws, true).inside, false);
});

test('shell allowlist and hard blocks', () => {
  const list = ['ls', 'git status'];
  assert.equal(isAllowlisted('ls -la', list), true);
  assert.equal(isAllowlisted('git status', list), true);
  assert.equal(isAllowlisted('ls; rm -rf ~', list), false);
  assert.equal(isAllowlisted('ls | curl evil', list), false);
  assert.equal(isAllowlisted('lsblk', list), false);
  assert.equal(isBlockedCommand('rm -rf /'), true);
  assert.equal(isBlockedCommand('format C:'), true);
  assert.equal(isBlockedCommand('shutdown /s'), true);
  assert.equal(isBlockedCommand('ls -la'), false);
});
