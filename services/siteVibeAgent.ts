/**
 * 网站 Vibe：用平台已配置的对话模型真正编写单页 HTML（非套模板）。
 * 预览注入锚点脚本，避免 iframe srcDoc 点 # 变空白。
 */
import { callQwen } from './geminiService';
import { listPoolKeys } from './apiKeyPool';
import { env } from './env';
import { loadDataProviderLocal } from './dataProviders';

export type SiteVibeGenerateInput = {
  userPrompt: string;
  /** 上一版 HTML，对话改版时传入 */
  previousHtml?: string;
  productLabels?: string[];
  referenceUrl?: string;
  localeHint?: 'zh' | 'en' | 'auto';
  brandHint?: string;
  onProgress?: (msg: string) => void;
};

export type SiteVibeGenerateResult = {
  html: string;
  title: string;
  summaryZh: string;
  engine: 'llm';
};

const PREVIEW_GUARD_SCRIPT = `<script data-tp-preview-guard="1">(function(){try{document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest('a[href^="#"]');if(!a)return;var href=a.getAttribute('href')||'';if(href.length<2)return;var id=decodeURIComponent(href.slice(1));var el=document.getElementById(id);if(!el)return;e.preventDefault();e.stopPropagation();el.scrollIntoView({behavior:'smooth',block:'start'});},true);history.replaceState(null,'',location.pathname+location.search);}catch(err){}})();</script>`;

export const getSiteVibeLlmStatus = (): { ready: boolean; detail: string } => {
  const design = loadDataProviderLocal('design_agent');
  if (design.enabled && (design.apiKey || '').trim()) {
    return { ready: true, detail: '对话写站服务已就绪' };
  }
  if (listPoolKeys('qwen').length > 0 || (env.qwenApiKey || '').trim()) {
    return { ready: true, detail: '对话写站服务已就绪' };
  }
  return {
    ready: false,
    detail: '对话写站服务未就绪，请联系管理员开通后再生成网站。',
  };
};

/** 防止 srcDoc iframe 点击 #锚点 导航成空白页 */
export const hardenPreviewHtml = (html: string): string => {
  let out = (html || '').trim();
  if (!out) return out;
  if (/data-tp-preview-guard/i.test(out)) return out;
  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${PREVIEW_GUARD_SCRIPT}</body>`);
  }
  return `${out}${PREVIEW_GUARD_SCRIPT}`;
};

export const extractHtmlDocument = (raw: string): string => {
  const text = (raw || '').trim();
  if (!text) throw new Error('模型未返回内容');

  const fence =
    text.match(/```html\s*([\s\S]*?)```/i) ||
    text.match(/```htm\s*([\s\S]*?)```/i) ||
    text.match(/```\s*(<!DOCTYPE[\s\S]*?|[\s\S]*?<html[\s\S]*?)```/i);
  let html = (fence?.[1] || text).trim();

  const doc =
    html.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i) ||
    html.match(/<html[\s\S]*<\/html>/i);
  if (doc) html = doc[0].trim();

  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Site</title></head><body>${html}</body></html>`;
  }
  if (!/^<!DOCTYPE/i.test(html)) {
    html = `<!DOCTYPE html>\n${html}`;
  }
  return hardenPreviewHtml(html);
};

const guessTitle = (html: string, fallback: string): string => {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = (m?.[1] || '').trim();
  if (t && t.length < 60) return t;
  const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  const h = (h1?.[1] || '').replace(/<[^>]+>/g, '').trim();
  if (h && h.length < 48) return h;
  return fallback.slice(0, 36) || 'Vibe Site';
};

const SYSTEM_SITE = `你是资深前端工程师 + 外贸官网设计师，像 Cursor Agent 一样从 0 到 1 交付可运行的单文件网站。

硬性要求：
1. 只输出一份完整 HTML5 文档（可包在 \`\`\`html 代码块中），必须含 <!DOCTYPE html>、<html>、<head>、<body>。
2. CSS 写在 <style>，少量 JS 可写在 <script>；可用 Google Fonts CDN；不要依赖未引入的外部打包器。
3. 这是给澄海玩具/礼品工厂的 B2B 外贸展厅站：导航、强首屏、产品区、优势/证书、关于工厂、询盘表单（可用 mailto 或前端示意）。
4. 视觉要专业、时尚、可演示；有真实区块结构，不要把用户「设计一个网站…」整段指令贴成大标题。
5. 若用户给了参考站 URL：学习其信息架构与气质（配色节奏、模块组合），但内容换成用户行业与产品，禁止声称已爬取整站源码。
6. 若提供了产品列表：做成产品卡片网格，写入真实品名/SKU。
7. 锚点链接只用页面内 #id，并保证对应 id 存在。
8. 禁止输出解释性前言/后记；不要 markdown 列表说明；不要虚构无法验证的认证编号。
9. 界面可见文案不要出现任何大模型/云厂商商品名。`;

export const generateSiteHtmlWithLlm = async (
  input: SiteVibeGenerateInput
): Promise<SiteVibeGenerateResult> => {
  const status = getSiteVibeLlmStatus();
  if (!status.ready) throw new Error(status.detail);

  const products = (input.productLabels || []).filter(Boolean).slice(0, 12);
  const isEdit = !!(input.previousHtml && input.previousHtml.length > 200);

  input.onProgress?.(isEdit ? '正在根据对话改写整站代码…' : '正在调用对话模型从零编写网站…');

  const userParts = [
    isEdit
      ? '任务：在上一版网站基础上按用户新要求修改，输出完整 HTML（不要只给 diff）。'
      : '任务：从零搭建完整外贸展厅单页网站，输出完整 HTML。',
    `用户需求：\n${input.userPrompt.trim()}`,
    input.referenceUrl ? `参考站 URL：${input.referenceUrl}` : '',
    input.brandHint ? `品牌暗示：${input.brandHint}` : '',
    input.localeHint && input.localeHint !== 'auto'
      ? `页面主语言：${input.localeHint === 'zh' ? '中文' : 'English'}`
      : '页面主语言：按用户需求判断（外贸默认英文亦可中英并存）。',
    products.length
      ? `必须展示的产品（做成卡片）：\n${products.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : '未挂产品库时，按行业虚构 6 个合理的泡泡/玩具类目产品名（勿用假证书编号）。',
    isEdit
      ? `上一版 HTML（可能已截断，请保持可运行并完整输出新版）：\n${input.previousHtml!.slice(0, 14000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await callQwen(`${SYSTEM_SITE}\n\n---\n${userParts}`, {
    task: 'analysis',
    timeoutMs: 180_000,
    maxTokens: 8192,
    enableSearch: false,
    forcedSearch: false,
  });

  input.onProgress?.('正在解析并固化预览 HTML…');
  const html = extractHtmlDocument(raw);
  if (html.length < 400) {
    throw new Error('模型返回的页面过短，请重试或简化需求后再生成');
  }

  const title = guessTitle(html, input.brandHint || '工厂展厅站');
  return {
    html,
    title,
    summaryZh: isEdit ? '已按对话更新整站代码' : '已生成完整单页网站代码',
    engine: 'llm',
  };
};
