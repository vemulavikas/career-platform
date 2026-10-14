import { renderBody, renderResume, formatDate } from '../src/render';
import { resumeDataSchema } from '../src/validation';

const full = resumeDataSchema.parse({
  personalInfo: {
    fullName: 'Asha Rao',
    email: 'asha@example.com',
    phone: '+91 98765 43210',
    location: 'Hyderabad',
    linkedin: 'https://linkedin.com/in/asha',
  },
  summary: '<p>Backend engineer.</p>',
  education: [{ institution: 'JNTU', degree: 'B.Tech', field: 'CSE', startDate: '2016', endDate: '2020', grade: '8.5 CGPA' }],
  experience: [
    { company: 'Acme', title: 'Engineer', location: 'Remote', startDate: '2021-03', current: true, description: '<ul><li>Built APIs</li></ul>' },
    { company: 'Beta', title: 'Intern', startDate: '2020-06', endDate: '2020-12', description: '<p>Helped</p>' },
  ],
  skills: [{ category: 'Languages', items: ['TypeScript', 'Go'] }],
  projects: [{ name: 'Portfolio', url: 'https://example.com', technologies: ['Next.js'], description: '<p>Site</p>' }],
  certifications: [{ name: 'AWS CCP', issuer: 'Amazon', date: '2023-05' }],
  achievements: ['Won hackathon'],
});

describe('templates', () => {
  it('formats dates', () => {
    expect(formatDate('2021-03')).toBe('Mar 2021');
    expect(formatDate('2021')).toBe('2021');
    expect(formatDate('')).toBe('');
  });

  it('renders the same data with both templates, differing only in styling', () => {
    const modern = renderResume(full, 'modern');
    const classic = renderResume(full, 'ats-classic');
    expect(modern).not.toBe(classic);
    expect(modern).toContain('tpl-modern');
    expect(classic).toContain('tpl-ats-classic');
    // identical document structure
    expect(modern.match(/<body[\s\S]*<\/body>/)![0].replace('tpl-modern', 'X')).toBe(
      classic.match(/<body[\s\S]*<\/body>/)![0].replace('tpl-ats-classic', 'X'),
    );
  });
});

describe('ATS-friendly structure', () => {
  const html = renderResume(full, 'ats-classic');

  it('has exactly one h1 and standard section headings in a sensible order', () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    const headings = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual(['Professional Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications', 'Achievements']);
  });

  it('uses semantic elements and real lists, with no tables, images, scripts or inline styles', () => {
    expect(html).toContain('<header>');
    expect(html).toContain('<main>');
    expect(html).toContain('<section>');
    expect(html).toContain('<ul');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toMatch(/<table|<img|<script|<svg|style="/i);
  });

  it('keeps contact details as machine-readable plain text', () => {
    expect(html).toContain('asha@example.com | +91 98765 43210 | Hyderabad');
  });

  it('renders present roles as "Present" and ranges with an en dash', () => {
    expect(html).toContain('Mar 2021 \u2013 Present');
    expect(html).toContain('Jun 2020 \u2013 Dec 2020');
  });

  it('omits empty sections instead of printing empty headings', () => {
    const sparse = renderBody(resumeDataSchema.parse({ personalInfo: { fullName: 'Only Name' } }));
    expect(sparse).toContain('<h1>Only Name</h1>');
    expect(sparse).not.toContain('<h2>');
  });
});

describe('output safety', () => {
  it('escapes plain-text fields', () => {
    const data = resumeDataSchema.parse({
      personalInfo: { fullName: '<script>alert(1)</script>' },
      achievements: ['<img src=x onerror=alert(1)>'],
      skills: [{ category: '"><b>x</b>', items: ['<i>y</i>'] }],
    });
    const html = renderResume(data, 'modern');
    expect(html).not.toMatch(/<script>alert|<img|<b>x|<i>y/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not render non-http links even if they somehow reached storage', () => {
    const data = { ...full, personalInfo: { ...full.personalInfo, linkedin: 'javascript:alert(1)' } };
    expect(renderResume(data, 'modern')).not.toContain('javascript:');
  });

  it('re-sanitises rich text at render time', () => {
    const data = { ...full, summary: '<p>ok</p><script>alert(1)</script>' };
    expect(renderResume(data, 'modern')).not.toContain('<script>alert');
  });
});
