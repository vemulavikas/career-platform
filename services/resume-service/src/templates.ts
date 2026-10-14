export const TEMPLATE_IDS = ['modern', 'ats-classic'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const DEFAULT_TEMPLATE: TemplateId = 'modern';

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  css: string;
}

// Both templates render the SAME semantic markup (see render.ts). A template is only a stylesheet,
// so adding a template never touches resume data or business logic. Web-safe fonts only: no external requests.
const COMMON = `
*{box-sizing:border-box}
body{margin:0;background:#fff;line-height:1.45}
.page{max-width:820px;margin:0 auto;padding:36px 44px}
p{margin:2px 0}
ul{margin:4px 0 4px 20px;padding:0}
.skills{list-style:none;margin:0;padding:0}
.skills li{margin:2px 0}
@page{margin:14mm}
@media print{.page{max-width:none;padding:0}}
`;

const MODERN = `${COMMON}
body{color:#1f2933;font-family:"Segoe UI",Calibri,Helvetica,Arial,sans-serif;font-size:10.5pt}
header{border-left:6px solid #1f4e79;padding-left:14px;margin-bottom:14px}
h1{font-size:24pt;margin:0 0 4px;color:#1f4e79;letter-spacing:.3px}
.contact,.links{color:#52606d}
h2{font-size:11pt;text-transform:uppercase;letter-spacing:1.2px;color:#1f4e79;border-bottom:2px solid #d9e2ec;padding-bottom:3px;margin:20px 0 8px}
h3{font-size:11pt;margin:10px 0 0}
.entry-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.dates{color:#52606d;font-size:9.5pt;white-space:nowrap}
.org{color:#52606d;font-style:italic}
a{color:#1f4e79}
`;

const CLASSIC = `${COMMON}
body{color:#000;font-family:Arial,Helvetica,sans-serif;font-size:11pt}
header{text-align:center;margin-bottom:12px}
h1{font-size:20pt;margin:0 0 4px}
h2{font-size:12pt;text-transform:uppercase;border-bottom:1px solid #000;padding-bottom:2px;margin:18px 0 8px}
h3{font-size:11pt;margin:10px 0 0}
.dates{display:block}
.org{font-style:italic}
a{color:#000;text-decoration:underline}
`;

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  modern: {
    id: 'modern',
    name: 'Modern Professional',
    description: 'Clean single-column layout with a restrained accent colour.',
    css: MODERN,
  },
  'ats-classic': {
    id: 'ats-classic',
    name: 'ATS Classic',
    description: 'Plain black-and-white layout optimised for applicant tracking systems.',
    css: CLASSIC,
  },
};

export const listTemplates = () => TEMPLATE_IDS.map((id) => ({ id, name: TEMPLATES[id].name, description: TEMPLATES[id].description }));
