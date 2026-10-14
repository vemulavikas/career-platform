import sanitizeHtml from 'sanitize-html';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Rich-text fields (edited with Tiptap) are stored as HTML, so they are allow-listed on the way in
// AND again on render. Anything else (script, style, iframe, on* handlers, javascript: links) is dropped.
const RICH_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'a'],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true) },
};

export const sanitizeRich = (html: string): string => sanitizeHtml(html, RICH_OPTIONS);

export const isSafeUrl = (url: string): boolean => /^https?:\/\//i.test(url);

export function bulletsToHtml(bullets: string[]): string {
  const items = bullets.map((b) => b.trim()).filter(Boolean);
  return items.length ? `<ul>${items.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : '';
}
