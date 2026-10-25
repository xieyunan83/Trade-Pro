/**
 * 网站设计开发 · 内置模板（对话驱动生成完整 HTML 预览）
 * 界面文案不暴露第三方建站产品名。
 */
import { newCreativeId, type SiteSection } from './creativeStudioStore';

export type SiteTemplateId =
  | 'trade_hero'
  | 'catalog_grid'
  | 'inquiry_first'
  | 'brand_story'
  | 'minimal_clean';

export type SiteTemplateMeta = {
  id: SiteTemplateId;
  label: string;
  labelEn: string;
  blurb: string;
  accent: string;
  /** 预览卡渐变 */
  swatch: string;
};

export const SITE_TEMPLATES: SiteTemplateMeta[] = [
  {
    id: 'trade_hero',
    label: '外贸展厅',
    labelEn: 'Trade Showcase',
    blurb: '大首屏 + 产品卖点 + 询盘 CTA，适合工厂货源站',
    accent: '#0d9488',
    swatch: 'linear-gradient(135deg,#0f172a 0%,#134e4a 55%,#2dd4bf 100%)',
  },
  {
    id: 'catalog_grid',
    label: '产品目录',
    labelEn: 'Catalog Grid',
    blurb: '卡片网格展示 SKU，适合选品与报价引流',
    accent: '#0369a1',
    swatch: 'linear-gradient(135deg,#0c4a6e 0%,#0284c7 50%,#e0f2fe 100%)',
  },
  {
    id: 'inquiry_first',
    label: '询盘优先',
    labelEn: 'Inquiry First',
    blurb: '突出表单与信任背书，适合展会跟进页',
    accent: '#b45309',
    swatch: 'linear-gradient(135deg,#1c1917 0%,#78350f 45%,#fbbf24 100%)',
  },
  {
    id: 'brand_story',
    label: '品牌故事',
    labelEn: 'Brand Story',
    blurb: '叙事型落地页，适合品牌升级与 OEM 介绍',
    accent: '#be123c',
    swatch: 'linear-gradient(135deg,#1a0a0e 0%,#9f1239 50%,#fda4af 100%)',
  },
  {
    id: 'minimal_clean',
    label: '极简落地',
    labelEn: 'Minimal Clean',
    blurb: '留白克制、一屏说清价值，适合快速上线',
    accent: '#334155',
    swatch: 'linear-gradient(135deg,#f8fafc 0%,#e2e8f0 40%,#94a3b8 100%)',
  },
];

export type BuildSiteHtmlOpts = {
  templateId: SiteTemplateId;
  title: string;
  brief: string;
  locale: 'zh' | 'en' | 'es' | 'ar';
  productLabels: string[];
  sections?: SiteSection[];
};

const copyByLocale = (locale: BuildSiteHtmlOpts['locale']) => {
  if (locale === 'zh') {
    return {
      navHome: '首页',
      navProducts: '产品',
      navWhy: '优势',
      navContact: '联系',
      cta: '获取报价',
      productsTitle: '精选产品',
      whyTitle: '为什么选择我们',
      contactTitle: '留下需求，我们尽快回复',
      contactHint: '邮箱 / WhatsApp 将用于跟进（可回灌 CRM）',
      trust: '工厂直达 · MOQ 灵活 · 证书齐全 · 专属跟单',
    };
  }
  return {
    navHome: 'Home',
    navProducts: 'Products',
    navWhy: 'Why us',
    navContact: 'Contact',
    cta: 'Request quote',
    productsTitle: 'Featured products',
    whyTitle: 'Why work with us',
    contactTitle: 'Tell us what you need',
    contactHint: 'Email / WhatsApp for follow-up',
    trust: 'Factory-direct · Flexible MOQ · Certificates · Dedicated desk',
  };
};

const esc = (s: string) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 从对话简报生成区块 */
export const buildSectionsFromPrompt = (
  brief: string,
  productLabels: string[],
  templateId: SiteTemplateId
): SiteSection[] => {
  const b = brief.trim() || 'Professional export landing page';
  const productsLine =
    productLabels.length > 0
      ? productLabels.slice(0, 8).join(' · ')
      : 'Attach SKUs from your catalog to showcase here';
  const heroExtra =
    templateId === 'inquiry_first'
      ? 'Leave your target market and quantity — we reply within 24h.'
      : templateId === 'brand_story'
        ? 'Crafted with care. Built for importers who care about consistency.'
        : 'Reliable supply · Fast sampling · Global shipping.';

  return [
    {
      id: newCreativeId('sec'),
      kind: 'hero',
      title: b.slice(0, 72),
      body: heroExtra,
    },
    {
      id: newCreativeId('sec'),
      kind: 'products',
      title: 'Featured line',
      body: productsLine,
    },
    {
      id: newCreativeId('sec'),
      kind: 'features',
      title: 'Why partner with us',
      body: 'Factory-direct · Flexible MOQ · Full certificates · Dedicated merchandiser.',
    },
    {
      id: newCreativeId('sec'),
      kind: 'cta',
      title: 'Get a quote',
      body: 'Share destination market and volume — we respond fast.',
    },
    {
      id: newCreativeId('sec'),
      kind: 'contact',
      title: 'Contact',
      body: 'Email / WhatsApp form can sync back to CRM after go-live.',
    },
  ];
};

const themeCss = (id: SiteTemplateId, accent: string): string => {
  const dark = id !== 'minimal_clean';
  const bg = dark ? '#070b14' : '#f8fafc';
  const fg = dark ? '#e2e8f0' : '#0f172a';
  const muted = dark ? '#94a3b8' : '#64748b';
  const card = dark ? 'rgba(255,255,255,0.04)' : '#ffffff';
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  return `
:root{--bg:${bg};--fg:${fg};--muted:${muted};--accent:${accent};--card:${card};--border:${border}}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);line-height:1.55}
a{color:inherit;text-decoration:none}
.wrap{max-width:1080px;margin:0 auto;padding:0 1.25rem}
.nav{display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid var(--border);position:sticky;top:0;backdrop-filter:blur(12px);background:color-mix(in srgb,var(--bg) 82%,transparent);z-index:5}
.brand{font-weight:800;letter-spacing:-0.03em;font-size:1.05rem}
.nav-links{display:flex;gap:1rem;font-size:.8rem;font-weight:700;color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:.4rem;background:var(--accent);color:${dark ? '#041016' : '#fff'};font-weight:800;font-size:.85rem;padding:.7rem 1.1rem;border-radius:999px;border:none;cursor:pointer}
.hero{padding:4.5rem 0 3.5rem;display:grid;gap:1.25rem}
.hero h1{font-size:clamp(1.85rem,4vw,3rem);line-height:1.1;letter-spacing:-0.035em;margin:0;max-width:16ch}
.hero p{color:var(--muted);max-width:42ch;margin:0;font-size:1.02rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;padding:2.5rem 0}
.card{background:var(--card);border:1px solid var(--border);border-radius:1.1rem;padding:1.15rem;min-height:7.5rem}
.card h3{margin:0 0 .4rem;font-size:.95rem;letter-spacing:-0.02em}
.card p{margin:0;font-size:.8rem;color:var(--muted)}
.section{padding:2.75rem 0;border-top:1px solid var(--border)}
.section h2{margin:0 0 .75rem;font-size:1.35rem;letter-spacing:-0.03em}
.section p{margin:0;color:var(--muted);max-width:52ch}
.cta-band{margin:2rem 0 3rem;padding:2rem;border-radius:1.5rem;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 28%,transparent),transparent);border:1px solid var(--border)}
.footer{padding:2rem 0 3rem;color:var(--muted);font-size:.75rem;border-top:1px solid var(--border)}
.pill{display:inline-block;font-size:.65rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:.75rem}
`;
};

/** 生成可放入 iframe 的完整 HTML */
export const buildSitePreviewHtml = (opts: BuildSiteHtmlOpts): string => {
  const meta = SITE_TEMPLATES.find((t) => t.id === opts.templateId) || SITE_TEMPLATES[0];
  const copy = copyByLocale(opts.locale);
  const sections =
    opts.sections && opts.sections.length
      ? opts.sections
      : buildSectionsFromPrompt(opts.brief, opts.productLabels, opts.templateId);
  const hero = sections.find((s) => s.kind === 'hero') || sections[0];
  const products = sections.find((s) => s.kind === 'products');
  const features = sections.find((s) => s.kind === 'features');
  const cta = sections.find((s) => s.kind === 'cta');
  const contact = sections.find((s) => s.kind === 'contact');

  const productCards =
    opts.productLabels.length > 0
      ? opts.productLabels
          .slice(0, 8)
          .map(
            (p) =>
              `<article class="card"><h3>${esc(p.split(' ').slice(0, 6).join(' '))}</h3><p>${esc(copy.trust)}</p></article>`
          )
          .join('')
      : (products?.body || '')
          .split(/[·|,，]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 6)
          .map((p) => `<article class="card"><h3>${esc(p)}</h3><p>${esc(copy.trust)}</p></article>`)
          .join('') ||
        `<article class="card"><h3>SKU showcase</h3><p>${esc(products?.body || copy.trust)}</p></article>`;

  const dir = opts.locale === 'ar' ? 'rtl' : 'ltr';
  const brand = esc((opts.title || 'Studio Site').slice(0, 28));

  return `<!DOCTYPE html><html lang="${esc(opts.locale)}" dir="${dir}"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${brand}</title>
<style>${themeCss(opts.templateId, meta.accent)}</style>
</head><body>
<div class="wrap">
  <header class="nav">
    <div class="brand">${brand}</div>
    <nav class="nav-links">
      <a href="#top">${esc(copy.navHome)}</a>
      <a href="#products">${esc(copy.navProducts)}</a>
      <a href="#why">${esc(copy.navWhy)}</a>
      <a href="#contact">${esc(copy.navContact)}</a>
    </nav>
  </header>

  <section class="hero" id="top">
    <div class="pill">${esc(meta.labelEn)}</div>
    <h1>${esc(hero?.title || opts.brief || opts.title)}</h1>
    <p>${esc(hero?.body || '')}</p>
    <div><a class="btn" href="#contact">${esc(copy.cta)}</a></div>
  </section>

  <section class="section" id="products">
    <h2>${esc(products?.title || copy.productsTitle)}</h2>
    <div class="grid">${productCards}</div>
  </section>

  <section class="section" id="why">
    <h2>${esc(features?.title || copy.whyTitle)}</h2>
    <p>${esc(features?.body || copy.trust)}</p>
  </section>

  <section class="cta-band" id="contact">
    <h2 style="margin:0 0 .5rem;letter-spacing:-0.03em">${esc(cta?.title || contact?.title || copy.contactTitle)}</h2>
    <p style="margin:0 0 1rem;color:var(--muted)">${esc(cta?.body || contact?.body || copy.contactHint)}</p>
    <a class="btn" href="mailto:sales@example.com">${esc(copy.cta)}</a>
  </section>

  <footer class="footer">Built in Website Studio · Preview only</footer>
</div>
</body></html>`;
};

export const getTemplateMeta = (id?: string): SiteTemplateMeta =>
  SITE_TEMPLATES.find((t) => t.id === id) || SITE_TEMPLATES[0];
