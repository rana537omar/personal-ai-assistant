import { decodeEntities } from './text.js';

/** Turns an HTML page into readable text for the model: drops scripts, styles and
 *  navigation chrome, keeps headings, paragraphs, list items and link targets. */
export function htmlToText(html, baseUrl = '') {
  let s = String(html ?? '');
  const title = decodeEntities((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const description = decodeEntities(s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '');

  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|template|iframe|head|canvas)\b[\s\S]*?<\/\1>/gi, ' ');

  // Prefer the main content area when the page marks one.
  const main = s.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || s.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  if (main && main.length > 500) s = main;
  else s = s.replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');

  const links = [];
  s = s.replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    let url = href;
    try {
      url = new URL(href, baseUrl || undefined).href;
    } catch {
      /* keep relative */
    }
    if (text && /^https?:/.test(url) && links.length < 60) links.push({ text: text.slice(0, 80), url });
    return text ? ` ${text} ` : ' ';
  });

  s = s
    .replace(/<h([1-6])[^>]*>/gi, (m, n) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|tr|table|ul|ol|blockquote|pre|form|dd|dt)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(s)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, arr) => l && !(l === '-' || (l === arr[i - 1] && l.length < 40)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, description, text, links };
}
