// Shared front-end helpers: API calls, escaping, Markdown, icons, toasts, modals, time.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- icons ----------
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  play: '<path d="M7 5v14l12-7L7 5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.7 3.7 5.5 3.7 8.5s-1.2 5.8-3.7 8.5c-2.5-2.7-3.7-5.5-3.7-8.5s1.2-5.8 3.7-8.5Z"/>',
  page: '<path d="M6 3.5h8l4 4V20.5H6Z"/><path d="M14 3.5v4h4M9 12h6M9 16h6"/>',
  browser: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 10 3 2.5L7 15M12.5 15H17"/>',
  file: '<path d="M6 3.5h8l4 4V20.5H6Z"/><path d="M14 3.5v4h4"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z"/>',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3v.3A3.5 3.5 0 0 0 4 14a3.5 3.5 0 0 0 3.5 5H9V4.5Zm6 0a3 3 0 0 1 3 3v.3A3.5 3.5 0 0 1 20 14a3.5 3.5 0 0 1-3.5 5H15V4.5Z"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.5 6.5 1.2 1.2 2-2.2M3.5 12l1.2 1.2 2-2.2M3.5 17.5l1.2 1.2 2-2.2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  message: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.9A8.5 8.5 0 1 1 21 12Z"/>',
  bolt: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M4 4v4h4M20 20v-4h-4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9 12 3.5Z"/><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${P[name] || P.sparkle}</svg>`;

// ---------- time ----------
export function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 0) return until(ts);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function until(ts) {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return 'now';
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}
export const when = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

// ---------- markdown ----------
function inline(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/!\[([^\]]*)\]\((\/api\/[^\s)]+|https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

export function md(src) {
  const blocks = [];
  const codes = [];
  let text = esc(String(src ?? '').replace(/\r\n/g, '\n'));
  text = text.replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (m, lang, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  text = text.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  const lines = text.split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
  while (i < lines.length) {
    const line = lines[i];
    if (/^\u0000B\d+\u0000$/.test(line.trim())) {
      out.push(line.trim());
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) q.push(lines[i++].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${inline(q.join('<br>'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*+•]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        if (/^\s*([-*+•]|\d+[.)])\s+/.test(l)) {
          const nested = /^\s{2,}/.test(l) && items.length;
          const content = inline(l.replace(/^\s*([-*+•]|\d+[.)])\s+/, ''));
          if (nested) items[items.length - 1] += `<br><span class="muted">• </span>${content}`;
          else items.push(content);
        } else items[items.length - 1] += `<br>${inline(l.trim())}`;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${x}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|&gt;|\s*([-*+•]|\d+[.)])\s+|\u0000B)/.test(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1] || ''))) para.push(lines[i++]);
    if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
    else i++;
  }
  return out
    .join('')
    .replace(/\u0000B(\d+)\u0000/g, (m, n) => blocks[n])
    .replace(/\u0000C(\d+)\u0000/g, (m, n) => codes[n]);
}

// ---------- toasts & modals ----------
export function toast(title, text = '', { error = false, timeout = 5000 } = {}) {
  const t = el(`<div class="toast ${error ? 'err' : ''}">${icon(error ? 'x' : 'bell', 'sm')}<div><b>${esc(title)}</b>${text ? `<span class="muted">${esc(text)}</span>` : ''}</div></div>`);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), timeout);
}

export function modal(html, { wide = false, onClose } = {}) {
  const root = document.getElementById('modalRoot');
  const back = el(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`);
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  back.addEventListener('mousedown', (e) => e.target === back && close());
  document.addEventListener('keydown', onKey);
  root.append(back);
  const box = back.firstElementChild;
  setTimeout(() => box.querySelector('input,textarea,select')?.focus(), 30);
  return { box, close };
}

export function confirmDialog(title, text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const { box, close } = modal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p><div class="modal-foot"><button class="btn ghost" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(okLabel)}</button></div>`, { onClose: () => resolve(false) });
    box.querySelector('[data-a=no]').onclick = () => close();
    box.querySelector('[data-a=yes]').onclick = () => {
      resolve(true);
      close();
    };
  });
}

export function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard'), () => toast('Copy failed', '', { error: true }));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function fileToBase64(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('Not an image'));
    img.src = url;
  });
}

export const CHANNEL_COLORS = { web: '#8b7cff', cli: '#6b7280', api: '#6b7280', telegram: '#2aabee', discord: '#5865f2', slack: '#4a154b', whatsapp: '#25d366', phone: '#f22f46', job: '#f2b544' };
export const CHANNEL_LABEL = { web: 'Web', cli: 'Terminal', api: 'API', telegram: 'Telegram', discord: 'Discord', slack: 'Slack', whatsapp: 'WhatsApp', phone: 'Phone', job: 'Scheduled' };
