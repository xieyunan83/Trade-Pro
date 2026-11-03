/**
 * 一键建站后台流水线：按确认表单依次调用生图 / 视频 / 3D / 对话写站，
 * 最终汇成可预览的成品网站。任务在客户端内存中执行，请勿关闭页面。
 */
import { generateDesignImages, getDesignAgentConfigStatus } from './designAgentService';
import { generateProductVideo, getVideoProviderStatus } from './wanVideoService';
import { generateModel3d, getModel3dProviderStatus } from './model3dService';
import {
  generateSiteHtmlWithLlm,
  getSiteVibeLlmStatus,
  hardenPreviewHtml,
} from './siteVibeAgent';
import {
  type SiteProject,
  loadSiteProjects,
  saveSiteProjects,
  newCreativeId,
} from './creativeStudioStore';
import { putSiteHtml } from './siteProjectVault';
import { DEFAULT_STACK } from './siteStackCatalog';
import { buildSectionsFromPrompt } from './siteBuilderTemplates';
import {
  formatDirectionForPrompt,
  needsDirectionFields,
  needsPolishPass,
  polishSiteHtmlWithLlm,
  type SiteVisualProcessMode,
} from './siteUnslopPass';

export type SiteBuildJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SiteBuildStepId =
  | 'plan'
  | 'hero_image'
  | 'product_images'
  | 'bg_video'
  | 'transition_video'
  | 'model_3d'
  | 'assemble'
  | 'polish'
  | 'persist';

export type SiteBuildStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export type SiteBuildStep = {
  id: SiteBuildStepId;
  label: string;
  status: SiteBuildStepStatus;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
};

export type SiteBuildConfirmForm = {
  brandName: string;
  /** 一句话定位 / 官网用途 */
  tagline: string;
  /** 详细需求 */
  brief: string;
  /** 参考站 URL（可选） */
  referenceUrl?: string;
  locale: 'zh' | 'en' | 'auto';
  /** 行业 / 品类 */
  industry: string;
  /** 产品清单（每行一个，或逗号分隔） */
  productsText: string;
  /** 视觉风格 */
  visualStyle: 'cinematic' | 'corporate' | 'playful' | 'minimal' | 'tech';
  primaryColor?: string;
  contactEmail?: string;
  contactWhatsapp?: string;
  /**
   * 视觉处理方式（用户自选）：
   * fast=直接出站；direction=先定风格；polish=出站后再润色；direction_polish=两者都要
   */
  visualProcessMode: SiteVisualProcessMode;
  /** 路径 B：性格 / 世界 / 高潮 / 签名（仅 direction* 模式使用） */
  directionCharacter?: string;
  directionWorld?: string;
  directionMoment?: string;
  directionSignature?: string;
  /** 素材开关 */
  wantHeroImage: boolean;
  wantProductImages: boolean;
  productImageCount: number;
  wantBgVideo: boolean;
  wantTransitionVideo: boolean;
  wantModel3d: boolean;
  ownerUsername?: string;
};

export type SiteBuildAssets = {
  heroImageUrl?: string;
  productImageUrls: string[];
  bgVideoUrl?: string;
  transitionVideoUrl?: string;
  model3dUrl?: string;
  model3dPreviewUrl?: string;
};

export type SiteBuildJob = {
  id: string;
  status: SiteBuildJobStatus;
  form: SiteBuildConfirmForm;
  steps: SiteBuildStep[];
  progressPct: number;
  statusText: string;
  assets: SiteBuildAssets;
  projectId?: string;
  title?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

type Listener = (jobs: SiteBuildJob[]) => void;

const LS_JOBS = 'trade_scout_site_build_jobs_meta_v1';
const JOB_STALE_MS = 45 * 60 * 1000;

const jobs: SiteBuildJob[] = [];
const listeners = new Set<Listener>();
let pumping = false;
let beforeUnloadBound = false;

const STYLE_LABEL: Record<SiteBuildConfirmForm['visualStyle'], string> = {
  cinematic: '电影感大片首屏（视频背景 + 流畅过渡）',
  corporate: '专业商务外贸展厅',
  playful: '活泼潮玩 / 气泡玩具感',
  minimal: '极简留白高端感',
  tech: '科技感深色界面',
};

const STEP_DEFS: Array<{ id: SiteBuildStepId; label: string; gate?: (f: SiteBuildConfirmForm) => boolean }> = [
  { id: 'plan', label: '整理建站方案' },
  { id: 'hero_image', label: '生成首屏主视觉', gate: (f) => f.wantHeroImage },
  { id: 'product_images', label: '生成产品展示图', gate: (f) => f.wantProductImages },
  { id: 'bg_video', label: '生成背景氛围视频', gate: (f) => f.wantBgVideo },
  { id: 'transition_video', label: '生成区块过渡视频', gate: (f) => f.wantTransitionVideo },
  { id: 'model_3d', label: '生成产品 3D 模型', gate: (f) => f.wantModel3d },
  { id: 'assemble', label: '汇集成品网站代码' },
  {
    id: 'polish',
    label: '专业润色（去模板感）',
    gate: (f) => needsPolishPass(f.visualProcessMode || 'polish'),
  },
  { id: 'persist', label: '写入本机站点库' },
];

const notify = () => {
  const snapshot = jobs.map((j) => ({
    ...j,
    form: { ...j.form },
    steps: j.steps.map((s) => ({ ...s })),
    assets: {
      ...j.assets,
      productImageUrls: [...j.assets.productImageUrls],
    },
  }));
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (e) {
      console.error('siteBuildPipeline listener error', e);
    }
  });
  persistMeta();
};

const persistMeta = () => {
  try {
    const slim = jobs.slice(0, 12).map((j) => ({
      id: j.id,
      status: j.status,
      progressPct: j.progressPct,
      statusText: j.statusText,
      projectId: j.projectId,
      title: j.title,
      error: j.error,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      form: {
        brandName: j.form.brandName,
        tagline: j.form.tagline,
        brief: j.form.brief.slice(0, 400),
        locale: j.form.locale,
        industry: j.form.industry,
        visualStyle: j.form.visualStyle,
      },
      steps: j.steps.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        detail: s.detail,
      })),
      // 不持久化超大 data URL，避免撑爆 localStorage
      assets: {
        heroImageUrl: j.assets.heroImageUrl?.startsWith('http') ? j.assets.heroImageUrl : undefined,
        productImageUrls: j.assets.productImageUrls.filter((u) => u.startsWith('http')).slice(0, 8),
        bgVideoUrl: j.assets.bgVideoUrl,
        transitionVideoUrl: j.assets.transitionVideoUrl,
        model3dUrl: j.assets.model3dUrl,
        model3dPreviewUrl: j.assets.model3dPreviewUrl,
      },
    }));
    localStorage.setItem(LS_JOBS, JSON.stringify(slim));
  } catch {
    /* ignore quota */
  }
};

const bindBeforeUnload = () => {
  if (beforeUnloadBound || typeof window === 'undefined') return;
  beforeUnloadBound = true;
  window.addEventListener('beforeunload', (e) => {
    const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!active) return;
    e.preventDefault();
    e.returnValue = '网站正在后台生成，关闭页面会中断任务。确定离开？';
  });
};

const parseProducts = (text: string): string[] =>
  (text || '')
    .split(/[\n,，;；|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

const buildSteps = (form: SiteBuildConfirmForm): SiteBuildStep[] =>
  STEP_DEFS.map((d) => ({
    id: d.id,
    label: d.label,
    status: d.gate && !d.gate(form) ? 'skipped' : 'pending',
  }));

const setStep = (job: SiteBuildJob, id: SiteBuildStepId, patch: Partial<SiteBuildStep>) => {
  const step = job.steps.find((s) => s.id === id);
  if (!step) return;
  Object.assign(step, patch);
};

const recalcProgress = (job: SiteBuildJob) => {
  const actionable = job.steps.filter((s) => s.status !== 'skipped');
  if (!actionable.length) {
    job.progressPct = 0;
    return;
  }
  const done = actionable.filter((s) => s.status === 'done' || s.status === 'failed').length;
  const running = actionable.some((s) => s.status === 'running') ? 0.45 : 0;
  job.progressPct = Math.min(99, Math.round(((done + running) / actionable.length) * 100));
};

const markRunning = (job: SiteBuildJob, id: SiteBuildStepId, detail?: string) => {
  setStep(job, id, { status: 'running', detail, startedAt: Date.now() });
  job.statusText = detail || job.steps.find((s) => s.id === id)?.label || '执行中…';
  recalcProgress(job);
  notify();
};

const markDone = (job: SiteBuildJob, id: SiteBuildStepId, detail?: string) => {
  setStep(job, id, { status: 'done', detail, finishedAt: Date.now() });
  recalcProgress(job);
  notify();
};

const markFailed = (job: SiteBuildJob, id: SiteBuildStepId, detail: string) => {
  setStep(job, id, { status: 'failed', detail, finishedAt: Date.now() });
  job.status = 'failed';
  job.error = detail;
  job.statusText = detail;
  job.finishedAt = Date.now();
  recalcProgress(job);
  notify();
};

const failStale = () => {
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== 'running') continue;
    const started = job.startedAt || job.createdAt;
    if (now - started > JOB_STALE_MS) {
      job.status = 'failed';
      job.finishedAt = now;
      job.error = '生成超时。请保持客户端打开后重新提交一键建站。';
      job.statusText = job.error;
      changed = true;
    }
  }
  if (changed) notify();
};

export const defaultSiteBuildForm = (partial?: Partial<SiteBuildConfirmForm>): SiteBuildConfirmForm => ({
  brandName: '',
  tagline: '',
  brief: '',
  referenceUrl: '',
  locale: 'auto',
  industry: '澄海玩具 / 礼品出口',
  productsText: '',
  visualStyle: 'cinematic',
  primaryColor: '#0f766e',
  contactEmail: '',
  contactWhatsapp: '',
  visualProcessMode: 'polish',
  directionCharacter: '稳重务实',
  directionWorld: '澄海注塑工厂',
  directionMoment: '首屏真产品静物',
  directionSignature: 'WhatsApp 联系绿点',
  wantHeroImage: true,
  wantProductImages: true,
  productImageCount: 4,
  wantBgVideo: true,
  wantTransitionVideo: true,
  wantModel3d: false,
  ...partial,
});

export const getSiteBuildCapabilityStatus = (): {
  llm: boolean;
  image: boolean;
  video: boolean;
  model3d: boolean;
  detail: string;
} => {
  const llm = getSiteVibeLlmStatus();
  const image = getDesignAgentConfigStatus();
  const video = getVideoProviderStatus();
  const model3d = getModel3dProviderStatus();
  const parts: string[] = [];
  if (llm.ready) parts.push('写站就绪');
  else parts.push('写站未就绪');
  if (image.configured) parts.push('生图就绪');
  if (video.ready) parts.push('视频就绪');
  if (model3d.ready) parts.push('3D 就绪');
  return {
    llm: llm.ready,
    image: image.configured,
    video: video.ready,
    model3d: model3d.ready,
    detail: parts.join(' · '),
  };
};

export const subscribeSiteBuildJobs = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(jobs.map((j) => ({ ...j, form: { ...j.form }, steps: j.steps.map((s) => ({ ...s })), assets: { ...j.assets, productImageUrls: [...j.assets.productImageUrls] } })));
  return () => {
    listeners.delete(listener);
  };
};

export const getSiteBuildJobs = (): SiteBuildJob[] =>
  jobs.map((j) => ({
    ...j,
    form: { ...j.form },
    steps: j.steps.map((s) => ({ ...s })),
    assets: { ...j.assets, productImageUrls: [...j.assets.productImageUrls] },
  }));

export const hasActiveSiteBuildJob = (): boolean =>
  jobs.some((j) => j.status === 'queued' || j.status === 'running');

export const dismissSiteBuildJob = (id: string) => {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  const job = jobs[idx];
  if (job.status === 'queued' || job.status === 'running') {
    job.status = 'cancelled';
    job.statusText = '已取消';
    job.finishedAt = Date.now();
  }
  jobs.splice(idx, 1);
  notify();
};

export const clearFinishedSiteBuildJobs = () => {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'completed' || jobs[i].status === 'failed' || jobs[i].status === 'cancelled') {
      jobs.splice(i, 1);
    }
  }
  notify();
};

const buildAssetPromptBlock = (assets: SiteBuildAssets): string => {
  const lines: string[] = [
    '【必须嵌入的已生成素材 URL — 请原样写入 HTML，勿改写路径】',
  ];
  if (assets.heroImageUrl) {
    lines.push(`- 首屏静帧 / 海报图：${assets.heroImageUrl}`);
  }
  if (assets.productImageUrls.length) {
    lines.push('- 产品展示图：');
    assets.productImageUrls.forEach((u, i) => lines.push(`  ${i + 1}. ${u}`));
  }
  if (assets.bgVideoUrl) {
    lines.push(
      `- 首屏背景视频（全屏 <video autoplay muted loop playsinline>）：${assets.bgVideoUrl}`
    );
  }
  if (assets.transitionVideoUrl) {
    lines.push(
      `- 区块过渡短视频（产品区与优势区之间，可半透明叠放或作为分隔媒体）：${assets.transitionVideoUrl}`
    );
  }
  if (assets.model3dUrl) {
    lines.push(
      `- 产品 3D 模型文件：${assets.model3dUrl}${
        assets.model3dPreviewUrl ? `（预览图 ${assets.model3dPreviewUrl}）` : ''
      }；可用 model-viewer CDN 或提供下载按钮`
    );
  }
  if (lines.length === 1) return '';
  lines.push(
    '若素材为 http(s) 外链请直接引用；若为 data: URL 也请原样写入 src。首屏优先用背景视频，静帧作 poster。'
  );
  return lines.join('\n');
};

const composeUserPrompt = (form: SiteBuildConfirmForm, assets: SiteBuildAssets): string => {
  const products = parseProducts(form.productsText);
  const mode = form.visualProcessMode || 'polish';
  const directionBlock = needsDirectionFields(mode)
    ? formatDirectionForPrompt({
        character: form.directionCharacter,
        world: form.directionWorld,
        moment: form.directionMoment,
        signature: form.directionSignature,
      })
    : '';
  const parts = [
    `品牌 / 公司名：${form.brandName || '未命名品牌'}`,
    form.tagline ? `定位一句话：${form.tagline}` : '',
    `行业：${form.industry}`,
    `视觉风格：${STYLE_LABEL[form.visualStyle]}`,
    form.primaryColor ? `主色倾向：${form.primaryColor}` : '',
    directionBlock,
    form.brief ? `详细需求：\n${form.brief}` : '',
    products.length
      ? `产品清单：\n${products.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : '',
    form.contactEmail ? `询盘邮箱：${form.contactEmail}` : '',
    form.contactWhatsapp ? `WhatsApp：${form.contactWhatsapp}` : '',
    form.referenceUrl ? `参考站：${form.referenceUrl}` : '',
    '请做成可演示的外贸官网单页：强首屏、产品区、信任/证书条、工厂介绍、询盘表单。',
    '若有背景视频必须全屏铺开并配静音循环；首屏用真产品/场景，不要抽象光球。',
    buildAssetPromptBlock(assets),
  ];
  return parts.filter(Boolean).join('\n\n');
};

const runJob = async (job: SiteBuildJob) => {
  job.status = 'running';
  job.startedAt = Date.now();
  job.statusText = '后台流水线已启动，请勿关闭本客户端…';
  notify();

  const form = job.form;
  const products = parseProducts(form.productsText);
  const brand = form.brandName.trim() || 'Export Brand';
  const industry = form.industry.trim() || 'toys and gifts';

  try {
    // —— plan ——
    markRunning(job, 'plan', '正在核对素材能力与建站方案…');
    const cap = getSiteBuildCapabilityStatus();
    if (!cap.llm) {
      markFailed(job, 'plan', getSiteVibeLlmStatus().detail);
      return;
    }
    if (form.wantHeroImage || form.wantProductImages) {
      if (!cap.image) {
        markFailed(job, 'plan', '生图服务未就绪，请联系管理员开通后再勾选图片素材。');
        return;
      }
    }
    if ((form.wantBgVideo || form.wantTransitionVideo) && !cap.video) {
      markFailed(job, 'plan', '视频生成服务未就绪，请联系管理员开通后再勾选视频素材。');
      return;
    }
    if (form.wantModel3d && !cap.model3d) {
      markFailed(job, 'plan', '3D 生成服务未就绪，请联系管理员开通后再勾选 3D 素材。');
      return;
    }
    markDone(job, 'plan', cap.detail);

    // —— hero image ——
    if (form.wantHeroImage) {
      markRunning(job, 'hero_image', '正在生成首屏主视觉…');
      try {
        const r = await generateDesignImages({
          prompt: `Cinematic website hero still for ${brand}, ${industry} B2B export brand. ${form.tagline || ''}. ${STYLE_LABEL[form.visualStyle]}. Wide 16:9 composition, premium lighting, no text overlay, no watermark, product atmosphere suitable as video poster.`,
          n: 1,
          size: '2K',
          negativePrompt: 'text, watermark, logo mashup, low quality, blurry',
        });
        job.assets.heroImageUrl = r.images[0];
        markDone(job, 'hero_image', '首屏主视觉已就绪');
      } catch (e: any) {
        markFailed(job, 'hero_image', e?.message || String(e));
        return;
      }
    }

    // —— product images ——
    if (form.wantProductImages) {
      markRunning(job, 'product_images', '正在生成产品展示图…');
      try {
        const n = Math.min(6, Math.max(1, form.productImageCount || 4));
        const names = products.length
          ? products.slice(0, n)
          : Array.from({ length: n }, (_, i) => `${industry} product ${i + 1}`);
        const urls: string[] = [];
        for (let i = 0; i < names.length; i++) {
          job.statusText = `正在生成产品图 ${i + 1}/${names.length}…`;
          notify();
          const r = await generateDesignImages({
            prompt: `Studio product photo for B2B catalog: ${names[i]}. Clean background, soft shadow, commercial lighting, single product centered, no text, no watermark. Brand: ${brand}.`,
            n: 1,
            size: '1K',
            series: true,
            negativePrompt: 'text, watermark, collage, multiple products, hands',
          });
          if (r.images[0]) urls.push(r.images[0]);
        }
        job.assets.productImageUrls = urls;
        markDone(job, 'product_images', `已生成 ${urls.length} 张产品图`);
      } catch (e: any) {
        markFailed(job, 'product_images', e?.message || String(e));
        return;
      }
    }

    // —— background video ——
    if (form.wantBgVideo) {
      markRunning(job, 'bg_video', '正在生成背景氛围视频（耗时较长）…');
      try {
        const r = await generateProductVideo({
          mode: job.assets.heroImageUrl ? 'image' : 'text',
          prompt: `Slow cinematic atmospheric loop for website hero background. ${brand} ${industry} factory / product mood. Subtle camera drift, premium lighting, seamless loop feel, no text, no logo.`,
          sourceImage: job.assets.heroImageUrl,
          durationSec: 5,
          aspect: '16:9',
          resolution: '720P',
          tier: 'draft',
          negativePrompt: 'text, watermark, flicker, low quality',
          onProgress: (pct, status) => {
            job.statusText = `背景视频 ${pct}% · ${status}`;
            notify();
          },
        });
        job.assets.bgVideoUrl = r.videoUrl;
        markDone(job, 'bg_video', '背景视频已就绪');
      } catch (e: any) {
        markFailed(job, 'bg_video', e?.message || String(e));
        return;
      }
    }

    // —— transition video ——
    if (form.wantTransitionVideo) {
      markRunning(job, 'transition_video', '正在生成区块过渡视频…');
      try {
        const ref =
          job.assets.productImageUrls[0] || job.assets.heroImageUrl || undefined;
        const r = await generateProductVideo({
          mode: ref ? 'image' : 'text',
          prompt: `Short elegant transition clip between website sections. Soft parallax of ${industry} products, light particles, brand-grade motion graphics feel for ${brand}. No text.`,
          sourceImage: ref,
          durationSec: 5,
          aspect: '16:9',
          resolution: '720P',
          tier: 'draft',
          negativePrompt: 'text, watermark, harsh cuts',
          onProgress: (pct, status) => {
            job.statusText = `过渡视频 ${pct}% · ${status}`;
            notify();
          },
        });
        job.assets.transitionVideoUrl = r.videoUrl;
        markDone(job, 'transition_video', '过渡视频已就绪');
      } catch (e: any) {
        markFailed(job, 'transition_video', e?.message || String(e));
        return;
      }
    }

    // —— 3D ——
    if (form.wantModel3d) {
      markRunning(job, 'model_3d', '正在生成产品 3D 模型…');
      try {
        const src =
          job.assets.productImageUrls[0] || job.assets.heroImageUrl || undefined;
        const r = await generateModel3d({
          mode: src ? 'image' : 'text',
          prompt: src
            ? undefined
            : `A clean product 3D model for ${brand}: ${products[0] || industry} showcase piece`,
          sourceImage: src,
          quality: 'high_detail',
          onProgress: (pct, status) => {
            job.statusText = `3D 模型 ${pct}% · ${status}`;
            notify();
          },
        });
        job.assets.model3dUrl = r.modelUrl;
        job.assets.model3dPreviewUrl = r.previewImageUrl;
        markDone(job, 'model_3d', '3D 模型已就绪');
      } catch (e: any) {
        markFailed(job, 'model_3d', e?.message || String(e));
        return;
      }
    }

    // —— assemble ——
    markRunning(job, 'assemble', '正在汇集素材并编写成品网站…');
    let html = '';
    let title = brand;
    let summaryZh = '';
    try {
      const result = await generateSiteHtmlWithLlm({
        userPrompt: composeUserPrompt(form, job.assets),
        productLabels: products.length ? products : undefined,
        referenceUrl: form.referenceUrl || undefined,
        localeHint: form.locale,
        brandHint: brand,
        assetManifest: buildAssetPromptBlock(job.assets) || undefined,
        onProgress: (msg) => {
          job.statusText = msg;
          notify();
        },
      });
      html = hardenPreviewHtml(result.html);
      title = result.title || brand;
      summaryZh = result.summaryZh;
      markDone(job, 'assemble', summaryZh);
    } catch (e: any) {
      markFailed(job, 'assemble', e?.message || String(e));
      return;
    }

    // —— polish（路径 A，用户自选）——
    if (needsPolishPass(form.visualProcessMode || 'polish')) {
      markRunning(job, 'polish', '正在专业润色（去模板感）…');
      try {
        const polished = await polishSiteHtmlWithLlm({
          html,
          brandHint: brand,
          direction: needsDirectionFields(form.visualProcessMode || 'polish')
            ? {
                character: form.directionCharacter,
                world: form.directionWorld,
                moment: form.directionMoment,
                signature: form.directionSignature,
              }
            : null,
          onProgress: (msg) => {
            job.statusText = msg;
            notify();
          },
        });
        html = hardenPreviewHtml(polished.html);
        if (polished.title) title = polished.title;
        summaryZh = `${summaryZh}；${polished.summaryZh}`;
        markDone(job, 'polish', polished.summaryZh);
      } catch (e: any) {
        // 润色失败不丢整站：保留 assemble 结果并标失败明细，继续落盘
        const step = job.steps.find((s) => s.id === 'polish');
        if (step) {
          step.status = 'failed';
          step.detail = e?.message || String(e);
          step.finishedAt = Date.now();
        }
        job.statusText = `专业润色未成功，已保留初版成品（${e?.message || e}）`;
        notify();
      }
    }

    // —— persist ——
    markRunning(job, 'persist', '正在写入本机站点库…');
    try {
      const id = newCreativeId('site');
      const now = Date.now();
      const sections = buildSectionsFromPrompt(
        form.brief || form.tagline || brand,
        products,
        'trade_hero'
      );
      const proj: SiteProject = {
        id,
        title,
        brief: [form.tagline, form.brief, `一键建站任务 ${job.id}`].filter(Boolean).join('\n'),
        locale: form.locale === 'zh' ? 'zh' : 'en',
        templateId: 'trade_hero',
        referenceUrl: form.referenceUrl || undefined,
        frontendId: DEFAULT_STACK.frontendId,
        backendId: DEFAULT_STACK.backendId,
        databaseId: DEFAULT_STACK.databaseId,
        deployId: DEFAULT_STACK.deployId,
        genMode: 'llm',
        skuCodes: [],
        sections,
        messages: [
          {
            id: newCreativeId('m'),
            role: 'agent',
            text: `一键建站后台任务已完成。${summaryZh}。素材：图 ${
              (job.assets.heroImageUrl ? 1 : 0) + job.assets.productImageUrls.length
            } / 视频 ${
              (job.assets.bgVideoUrl ? 1 : 0) + (job.assets.transitionVideoUrl ? 1 : 0)
            } / 3D ${job.assets.model3dUrl ? 1 : 0}。可继续对话改版或导出 HTML。`,
            at: now,
          },
        ],
        published: false,
        ownerUsername: form.ownerUsername,
        createdAt: now,
        updatedAt: now,
        htmlPersisted: false,
      };
      try {
        await putSiteHtml(id, html, title);
        proj.htmlPersisted = true;
      } catch {
        proj.htmlPersisted = false;
      }
      const existing = loadSiteProjects().filter((p) => p.id !== id);
      saveSiteProjects([proj, ...existing]);
      job.projectId = id;
      job.title = title;
      markDone(job, 'persist', proj.htmlPersisted ? '本机已备份' : '元数据已保存，请尽快导出 HTML');

      job.status = 'completed';
      job.progressPct = 100;
      job.statusText = '成品网站已生成，可在「网站设计开发」中打开预览';
      job.finishedAt = Date.now();
      notify();

      try {
        window.dispatchEvent(
          new CustomEvent('tp-site-build-completed', {
            detail: { jobId: job.id, projectId: id, title },
          })
        );
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      markFailed(job, 'persist', e?.message || String(e));
    }
  } catch (e: any) {
    job.status = 'failed';
    job.error = e?.message || String(e);
    job.statusText = job.error;
    job.finishedAt = Date.now();
    notify();
  }
};

const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    failStale();
    while (true) {
      const next = jobs.find((j) => j.status === 'queued');
      if (!next) break;
      if (next.status === 'cancelled') continue;
      await runJob(next);
    }
  } finally {
    pumping = false;
  }
};

export const enqueueSiteBuildJob = (form: SiteBuildConfirmForm): SiteBuildJob => {
  bindBeforeUnload();
  const job: SiteBuildJob = {
    id: newCreativeId('sitebuild'),
    status: 'queued',
    form: {
      ...form,
      brandName: form.brandName.trim(),
      tagline: form.tagline.trim(),
      brief: form.brief.trim(),
      visualProcessMode: form.visualProcessMode || 'polish',
      productImageCount: Math.min(6, Math.max(1, form.productImageCount || 4)),
    },
    steps: buildSteps({
      ...form,
      visualProcessMode: form.visualProcessMode || 'polish',
    }),
    progressPct: 0,
    statusText: '已排队 · 后台执行中请勿关闭客户端',
    assets: { productImageUrls: [] },
    createdAt: Date.now(),
  };
  jobs.unshift(job);
  notify();
  void pump();
  return job;
};
