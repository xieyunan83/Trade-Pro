/**
 * 网站设计开发 · 内置模板（对话驱动生成完整 HTML 预览）
 * 界面文案不暴露第三方建站产品名。
 */
import { newCreativeId, type SiteSection } from './creativeStudioStore';
import { planSiteCopyFromPrompt, type PlannedSiteCopy } from './siteBriefPlanner';

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
  /** 可选：规划好的文案（优先于 brief 切片） */
  planned?: PlannedSiteCopy;
};

const copyByLocale = (locale: BuildSiteHtmlOpts['locale']) => {
  if (locale === 'zh') {
    return {
      navHome: '首页',
      navProducts: '产品',
      navWhy: '优势',
      navAbout: '关于',
      navContact: '联系',
      cta: '获取报价',
      productsTitle: '精选产品',
      whyTitle: '为什么选择我们',
      contactTitle: '留下需求，我们尽快回复',
      contactHint: '邮箱 / WhatsApp 将用于跟进',
      trust: '工厂直达 · MOQ 灵活 · 证书齐全 · 专属跟单',
      aboutTitle: '关于我们',
    };
  }
  return {
    navHome: 'Home',
    navProducts: 'Products',
    navWhy: 'Why us',
    navAbout: 'About',
    navContact: 'Contact',
    cta: 'Request quote',
    productsTitle: 'Featured products',
    whyTitle: 'Why work with us',
    contactTitle: 'Tell us what you need',
    contactHint: 'Email / WhatsApp for follow-up',
    trust: 'Factory-direct · Flexible MOQ · Certificates · Dedicated desk',
    aboutTitle: 'About us',
  };
};

const esc = (s: string) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 从对话简报生成区块（先规划文案，禁止整段 prompt 进标题） */
export const buildSectionsFromPrompt = (
  brief: string,
  productLabels: string[],
  templateId: SiteTemplateId
): SiteSection[] => {
  const plan = planSiteCopyFromPrompt(brief, productLabels, templateId);
  return [
    {
      id: newCreativeId('sec'),
      kind: 'hero',
      title: plan.heroTitle,
      body: plan.heroBody,
    },
    {
      id: newCreativeId('sec'),
      kind: 'products',
      title: plan.productsTitle,
      body: plan.productCards.join(' · '),
    },
    {
      id: newCreativeId('sec'),
      kind: 'features',
      title: plan.featuresTitle,
      body: plan.featuresBody,
    },
    {
      id: newCreativeId('sec'),
      kind: 'cta',
      title: plan.ctaTitle,
      body: plan.ctaBody,
    },
    {
      id: newCreativeId('sec'),
      kind: 'contact',
      title: plan.aboutTitle,
      body: plan.aboutBody,
    },
  ];
};

/** Vibe Coding 气质：氛围底、表现力标题字体、克制动效 */
const themeCss = (id: SiteTemplateId, accent: string, fashion: boolean): string => {
  const dark = id !== 'minimal_clean';
  const bg = dark ? (fashion ? '#07060c' : '#06080f') : '#f6f7fb';
  const fg = dark ? '#e8edf7' : '#0f172a';
  const muted = dark ? '#9aa8c0' : '#64748b';
  const card = dark ? 'rgba(255,255,255,0.045)' : '#ffffff';
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)';
  return `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@500;600;700&display=swap');
:root{--bg:${bg};--fg:${fg};--muted:${muted};--accent:${accent};--card:${card};--border:${border}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:Manrope,ui-sans-serif,system-ui,sans-serif;background:
  radial-gradient(1000px 480px at 8% -8%, color-mix(in srgb,var(--accent) 26%, transparent), transparent 62%),
  radial-gradient(720px 400px at 96% 4%, color-mix(in srgb,var(--accent) 14%, transparent), transparent 55%),
  ${fashion && dark ? 'linear-gradient(180deg,#0a0812 0%,#06080f 40%,#06080f 100%),' : ''}var(--bg);color:var(--fg);line-height:1.55}
a{color:inherit;text-decoration:none}
.wrap{max-width:1120px;margin:0 auto;padding:0 1.25rem}
.nav{display:flex;align-items:center;justify-content:space-between;padding:1.05rem 0;border-bottom:1px solid var(--border);position:sticky;top:0;backdrop-filter:blur(14px);background:color-mix(in srgb,var(--bg) 78%,transparent);z-index:5}
.brand{font-family:Syne,Manrope,sans-serif;font-weight:800;letter-spacing:-0.04em;font-size:1.08rem}
.nav-links{display:flex;gap:1rem;font-size:.78rem;font-weight:700;color:var(--muted);flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:.4rem;background:var(--accent);color:${dark ? '#041016' : '#fff'};font-weight:800;font-size:.85rem;padding:.75rem 1.15rem;border-radius:999px;border:none;cursor:pointer;box-shadow:0 10px 30px color-mix(in srgb,var(--accent) 35%, transparent);transition:transform .2s ease}
.btn:hover{transform:translateY(-1px)}
.btn-ghost{background:transparent;color:var(--fg);border:1px solid var(--border);box-shadow:none}
.hero{padding:4.5rem 0 2.8rem;display:grid;gap:1.1rem;animation:rise .7s ease both}
.hero h1{font-family:Syne,Manrope,sans-serif;font-size:clamp(2.1rem,4.6vw,3.4rem);line-height:1.08;letter-spacing:-0.045em;margin:0;max-width:16ch}
.hero p{color:var(--muted);max-width:48ch;margin:0;font-size:1.05rem}
.hero-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:.35rem}
.trust{display:flex;flex-wrap:wrap;gap:.55rem;padding:.35rem 0 1.5rem}
.trust span{font-size:.72rem;font-weight:700;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:.35rem .7rem;background:var(--card)}
.cats{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.25rem}
.cats span{font-size:.75rem;font-weight:800;padding:.4rem .75rem;border-radius:.7rem;background:color-mix(in srgb,var(--accent) 16%, transparent);color:var(--fg)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;padding:.5rem 0 2.5rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:1.2rem;padding:0;min-height:9.5rem;overflow:hidden;backdrop-filter:blur(8px);transition:border-color .2s ease, transform .2s ease;display:flex;flex-direction:column}
.card:hover{border-color:color-mix(in srgb,var(--accent) 45%, var(--border));transform:translateY(-2px)}
.card-visual{height:88px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 35%,#111),#1a1f2e);position:relative}
.card-visual::after{content:'';position:absolute;inset:auto 12px 10px auto;width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.12)}
.card-body{padding:1rem 1.1rem 1.15rem}
.card h3{margin:0 0 .35rem;font-family:Syne,sans-serif;font-size:.95rem;letter-spacing:-0.02em}
.card p{margin:0;font-size:.78rem;color:var(--muted)}
.section{padding:2.4rem 0;border-top:1px solid var(--border)}
.section h2{margin:0 0 .75rem;font-family:Syne,sans-serif;font-size:1.4rem;letter-spacing:-0.03em}
.section p{margin:0;color:var(--muted);max-width:56ch}
.split{display:grid;gap:1.5rem}
@media(min-width:800px){.split{grid-template-columns:1.2fr .8fr;align-items:center}}
.panel{background:var(--card);border:1px solid var(--border);border-radius:1.35rem;padding:1.35rem}
.cta-band{margin:1.5rem 0 2.5rem;padding:2.1rem;border-radius:1.6rem;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 30%,transparent),transparent);border:1px solid var(--border)}
.footer{padding:2rem 0 3rem;color:var(--muted);font-size:.75rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.pill{display:inline-block;font-size:.65rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.55rem}
.form-mock{display:grid;gap:.65rem;margin-top:1rem}
.form-mock input,.form-mock textarea{width:100%;border-radius:.8rem;border:1px solid var(--border);background:color-mix(in srgb,var(--bg) 70%,transparent);color:var(--fg);padding:.7rem .85rem;font:inherit}
.form-mock textarea{min-height:72px;resize:vertical}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
`;
};

/** 生成可放入 iframe 的完整 HTML */
export const buildSitePreviewHtml = (opts: BuildSiteHtmlOpts): string => {
  const plan =
    opts.planned ||
    planSiteCopyFromPrompt(
      opts.brief || opts.title,
      opts.productLabels,
      opts.templateId
    );
  const meta = SITE_TEMPLATES.find((t) => t.id === (opts.templateId || plan.templateId)) || SITE_TEMPLATES[0];
  const locale = (opts.locale === 'zh' || plan.locale === 'zh' ? 'zh' : 'en') as 'zh' | 'en';
  const copy = copyByLocale(locale);
  const sections =
    opts.sections && opts.sections.length
      ? opts.sections
      : buildSectionsFromPrompt(opts.brief, opts.productLabels, opts.templateId);
  const hero = sections.find((s) => s.kind === 'hero') || sections[0];
  const products = sections.find((s) => s.kind === 'products');
  const features = sections.find((s) => s.kind === 'features');
  const cta = sections.find((s) => s.kind === 'cta');
  const about = sections.find((s) => s.kind === 'contact');

  const productNames =
    opts.productLabels.length > 0
      ? opts.productLabels.slice(0, 8)
      : plan.productCards.length
        ? plan.productCards
        : (products?.body || '')
            .split(/[·|,，]/)
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 8);

  const productCards =
    productNames
      .map(
        (p, i) =>
          `<article class="card"><div class="card-visual" style="filter:hue-rotate(${i * 28}deg)"></div><div class="card-body"><h3>${esc(p.split(' ').slice(0, 8).join(' '))}</h3><p>${esc(plan.trustLine || copy.trust)}</p></div></article>`
      )
      .join('') ||
    `<article class="card"><div class="card-visual"></div><div class="card-body"><h3>SKU showcase</h3><p>${esc(copy.trust)}</p></div></article>`;

  const catHtml = (plan.categories || [])
    .map((c) => `<span>${esc(c)}</span>`)
    .join('');

  const trustBits = (plan.trustLine || copy.trust)
    .split(/[·|]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((t) => `<span>${esc(t)}</span>`)
    .join('');

  const dir = opts.locale === 'ar' ? 'rtl' : 'ltr';
  const brand = esc((plan.brandName || opts.title || 'Studio Site').slice(0, 28));
  const heroTitle = esc((hero?.title || plan.heroTitle).slice(0, 64));
  const heroBody = esc(hero?.body || plan.heroBody || '');

  return `<!DOCTYPE html><html lang="${esc(locale)}" dir="${dir}"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${brand}</title>
<style>${themeCss(meta.id, meta.accent, plan.styleHint === 'fashion' || plan.styleHint === 'playful')}</style>
</head><body>
<div class="wrap">
  <header class="nav">
    <div class="brand">${brand}</div>
    <nav class="nav-links">
      <a href="#top">${esc(copy.navHome)}</a>
      <a href="#products">${esc(copy.navProducts)}</a>
      <a href="#why">${esc(copy.navWhy)}</a>
      <a href="#about">${esc(copy.navAbout)}</a>
      <a href="#contact">${esc(copy.navContact)}</a>
    </nav>
  </header>

  <section class="hero" id="top">
    <div class="pill">${esc(meta.labelEn)}</div>
    <h1>${heroTitle}</h1>
    <p>${heroBody}</p>
    <div class="hero-actions">
      <a class="btn" href="#contact">${esc(cta?.title || plan.ctaTitle || copy.cta)}</a>
      <a class="btn btn-ghost" href="#products">${esc(copy.navProducts)}</a>
    </div>
  </section>

  <div class="trust">${trustBits}</div>

  <section class="section" id="products" style="border-top:none;padding-top:0">
    <h2>${esc(products?.title || plan.productsTitle || copy.productsTitle)}</h2>
    <div class="cats">${catHtml}</div>
    <div class="grid">${productCards}</div>
  </section>

  <section class="section" id="why">
    <h2>${esc(features?.title || plan.featuresTitle || copy.whyTitle)}</h2>
    <p>${esc(features?.body || plan.featuresBody || copy.trust)}</p>
  </section>

  <section class="section" id="about">
    <div class="split">
      <div>
        <h2>${esc(about?.title || plan.aboutTitle || copy.aboutTitle)}</h2>
        <p>${esc(about?.body || plan.aboutBody || '')}</p>
      </div>
      <div class="panel">
        <div class="pill">OEM / ODM</div>
        <p style="margin:0;color:var(--muted);font-size:.9rem">${esc(plan.trustLine)}</p>
      </div>
    </div>
  </section>

  <section class="cta-band" id="contact">
    <h2 style="margin:0 0 .5rem;letter-spacing:-0.03em">${esc(cta?.title || plan.ctaTitle || copy.contactTitle)}</h2>
    <p style="margin:0;color:var(--muted)">${esc(cta?.body || plan.ctaBody || copy.contactHint)}</p>
    <div class="form-mock">
      <input placeholder="${locale === 'zh' ? '公司 / 市场' : 'Company / market'}" />
      <input placeholder="Email / WhatsApp" />
      <textarea placeholder="${locale === 'zh' ? '目标产品与数量' : 'Target products & quantity'}"></textarea>
      <div><a class="btn" href="mailto:sales@example.com">${esc(copy.cta)}</a></div>
    </div>
  </section>

  <footer class="footer">
    <span>${brand} · Web Studio preview</span>
    <span>${esc(plan.trustLine)}</span>
  </footer>
</div>
</body></html>`;
};

export const getTemplateMeta = (id?: string): SiteTemplateMeta =>
  SITE_TEMPLATES.find((t) => t.id === id) || SITE_TEMPLATES[0];
