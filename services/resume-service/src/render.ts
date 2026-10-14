import { escapeHtml as esc, isSafeUrl, sanitizeRich } from './html';
import { DEFAULT_TEMPLATE, TEMPLATES, TemplateId } from './templates';
import type { ResumeData } from './validation';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value: string): string {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(value);
  if (!m) return '';
  return m[2] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : m[1];
}

const dateRange = (start: string, end: string, current: boolean) =>
  [formatDate(start), current ? 'Present' : formatDate(end)].filter(Boolean).join(' \u2013 ');

const joinNonEmpty = (parts: string[], sep: string) =>
  parts.map((p) => p.trim()).filter(Boolean).join(sep);

const rich = (html: string) => (html.trim() ? `<div class="rich">${sanitizeRich(html)}</div>` : '');

const link = (url: string) =>
  isSafeUrl(url)
    ? `<a href="${esc(url)}">${esc(url.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`
    : '';

// Sections with no content are omitted entirely, so there are never empty headings.
const section = (title: string, inner: string) => (inner.trim() ? `<section><h2>${title}</h2>${inner}</section>` : '');

const entry = (head: string, dates: string, sub: string, body: string) =>
  head.trim()
    ? `<article><div class="entry-head"><h3>${esc(head)}</h3>${dates ? `<span class="dates">${esc(dates)}</span>` : ''}</div>` +
      `${sub ? `<p class="org">${esc(sub)}</p>` : ''}${body}</article>`
    : '';

/**
 * Semantic, single-column markup shared by every template:
 * one <h1>, <h2> per section, <h3> per entry, real lists, plain text, no tables/images/columns.
 * User text is escaped; rich-text fields are re-sanitised with the same allow-list used on write.
 */
export function renderBody(d: ResumeData): string {
  const p = d.personalInfo;
  const contact = joinNonEmpty([p.email, p.phone, p.location], ' | ');
  const links = [p.linkedin, p.github, p.website].map(link).filter(Boolean).join(' | ');

  const header =
    `<header><h1>${esc(p.fullName || 'Your Name')}</h1>` +
    `${contact ? `<p class="contact">${esc(contact)}</p>` : ''}` +
    `${links ? `<p class="links">${links}</p>` : ''}</header>`;

  const summary = section('Professional Summary', rich(d.summary));

  const experience = section(
    'Experience',
    d.experience
      .map((e) =>
        entry(
          e.title || e.company,
          dateRange(e.startDate, e.endDate, e.current),
          joinNonEmpty([e.title ? e.company : '', e.location], ', '),
          rich(e.description),
        ),
      )
      .join(''),
  );

  const education = section(
    'Education',
    d.education
      .map((e) => {
        const degreeLine = joinNonEmpty([e.degree, e.field], ', ');
        return entry(
          degreeLine || e.institution,
          dateRange(e.startDate, e.endDate, false),
          joinNonEmpty([degreeLine ? e.institution : '', e.grade ? `Grade: ${e.grade}` : ''], ' | '),
          rich(e.description),
        );
      })
      .join(''),
  );

  const skillItems = d.skills
    .filter((g) => g.items.length)
    .map((g) => `<li>${g.category ? `<strong>${esc(g.category)}:</strong> ` : ''}${esc(g.items.join(', '))}</li>`)
    .join('');
  const skills = section('Skills', skillItems ? `<ul class="skills">${skillItems}</ul>` : '');

  const projects = section(
    'Projects',
    d.projects
      .map((pr) =>
        entry(
          pr.name,
          '',
          pr.technologies.length ? `Technologies: ${pr.technologies.join(', ')}` : '',
          `${pr.url && isSafeUrl(pr.url) ? `<p class="links">${link(pr.url)}</p>` : ''}${rich(pr.description)}`,
        ),
      )
      .join(''),
  );

  const certifications = section(
    'Certifications',
    d.certifications
      .map((c) => entry(c.name, formatDate(c.date), c.issuer, c.url && isSafeUrl(c.url) ? `<p class="links">${link(c.url)}</p>` : ''))
      .join(''),
  );

  const achievements = section(
    'Achievements',
    d.achievements.length ? `<ul>${d.achievements.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '',
  );

  return `${header}<main>${summary}${experience}${education}${skills}${projects}${certifications}${achievements}</main>`;
}

export function renderResume(data: ResumeData, templateId: TemplateId = DEFAULT_TEMPLATE): string {
  const tpl = TEMPLATES[templateId] ?? TEMPLATES[DEFAULT_TEMPLATE];
  const name = data.personalInfo.fullName || 'Resume';
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(name)} - Resume</title><style>${tpl.css}</style></head>` +
    `<body class="tpl-${tpl.id}"><div class="page">${renderBody(data)}</div></body></html>`
  );
}
