/**
 * 开发策略 ↔ 创作流水线：汇总平面 / 包装 / 发文素材，供对话与邮件群引用。
 */
import { listCatalogRefItems, listDesignRefItems } from './creativeAssetBridge';
import { loadPackagingAssets, loadPackagingProjects } from './packagingAgentStore';
import { loadSocialPieces } from './creativeStudioStore';
import { resolveToUploadableImage } from './creativeAssetVault';
import { listPoolKeys } from './apiKeyPool';
import { env } from './env';
import { loadDataProviderLocal } from './dataProviders';

export const getStrategyLlmStatus = (): { ready: boolean; detail: string } => {
  const design = loadDataProviderLocal('design_agent');
  if (design.enabled && (design.apiKey || '').trim()) {
    return { ready: true, detail: '策略服务已就绪' };
  }
  if (listPoolKeys('qwen').length > 0 || (env.qwenApiKey || '').trim()) {
    return { ready: true, detail: '策略服务已就绪' };
  }
  return {
    ready: false,
    detail: '策略服务未就绪，请联系管理员开通后再生成开发信。',
  };
};

export type StrategyOfferKind = 'design' | 'packaging' | 'social' | 'catalog';

export type StrategyOfferAsset = {
  id: string;
  url: string;
  label: string;
  kind: StrategyOfferKind;
  /** 文案线索（发文 caption / 卖点） */
  textHint?: string;
  skuCode?: string;
  skuName?: string;
  createdAt: number;
};

const KIND_LABEL: Record<StrategyOfferKind, string> = {
  design: '产品图',
  packaging: '包装图',
  social: '发文素材',
  catalog: '产品库',
};

export const listStrategyOfferAssets = (limit = 48): StrategyOfferAsset[] => {
  const out: StrategyOfferAsset[] = [];

  for (const a of listDesignRefItems(24)) {
    out.push({
      id: a.id,
      url: a.url,
      label: a.label,
      kind: 'design',
      skuCode: a.skuCode,
      skuName: a.skuName,
      createdAt: a.createdAt || 0,
    });
  }

  const pkgProjects = loadPackagingProjects();
  const titleOf = (projectId: string) =>
    pkgProjects.find((p) => p.id === projectId)?.title || '包装项目';
  for (const a of loadPackagingAssets()
    .slice()
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, 16)) {
    if (!(a.url || '').trim()) continue;
    const proj = pkgProjects.find((p) => p.id === a.projectId);
    out.push({
      id: `pkg_${a.id}`,
      url: a.url,
      label: `${titleOf(a.projectId)} · 包装`,
      kind: 'packaging',
      skuCode: proj?.skuCode,
      skuName: proj?.skuName,
      textHint: (a.prompt || '').slice(0, 120),
      createdAt: a.createdAt,
    });
  }

  for (const s of loadSocialPieces()
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12)) {
    const url = s.coverImageDataUrl || s.productImageDataUrl || s.referenceImageDataUrl;
    const captionBits = [s.caption, s.hashtags?.join(' '), s.cta].filter(Boolean).join(' · ');
    if (url) {
      out.push({
        id: `soc_img_${s.id}`,
        url,
        label: s.title || '发文配图',
        kind: 'social',
        textHint: captionBits.slice(0, 220),
        skuCode: s.skuCode,
        skuName: s.skuName,
        createdAt: s.updatedAt || s.createdAt,
      });
    } else if (captionBits.trim()) {
      out.push({
        id: `soc_txt_${s.id}`,
        url: '',
        label: s.title || '发文文案',
        kind: 'social',
        textHint: captionBits.slice(0, 280),
        skuCode: s.skuCode,
        skuName: s.skuName,
        createdAt: s.updatedAt || s.createdAt,
      });
    }
  }

  for (const a of listCatalogRefItems(12)) {
    out.push({
      id: a.id,
      url: a.url,
      label: a.label,
      kind: 'catalog',
      skuCode: a.skuCode,
      skuName: a.skuName,
      createdAt: a.createdAt || 0,
    });
  }

  return out
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

/** 未手动点选时，自动带上最新产品图/包装/发文（各取优先） */
export const pickDefaultStrategyOfferIds = (assets: StrategyOfferAsset[]): string[] => {
  const ids: string[] = [];
  const take = (kind: StrategyOfferKind) => {
    const hit = assets.find((a) => a.kind === kind && (a.url || a.textHint));
    if (hit) ids.push(hit.id);
  };
  take('design');
  take('packaging');
  take('social');
  if (!ids.length) {
    const any = assets.find((a) => a.url);
    if (any) ids.push(any.id);
  }
  return ids.slice(0, 4);
};

export const buildCreativeOfferBrief = (
  assets: StrategyOfferAsset[],
  selectedIds: string[]
): string => {
  const selected = assets.filter((a) => selectedIds.includes(a.id));
  const pool = selected.length ? selected : assets.slice(0, 6);
  if (!pool.length) return '';

  const lines: string[] = ['Creative pipeline assets (use as our offer proof; do not invent specs/prices):'];
  for (const a of pool.slice(0, 8)) {
    const kind = KIND_LABEL[a.kind];
    const sku = [a.skuCode, a.skuName].filter(Boolean).join(' ');
    lines.push(
      `- [${kind}] ${a.label}${sku ? ` · ${sku}` : ''}${a.url ? ' · has image' : ''}${
        a.textHint ? `\n  Copy/hint: ${a.textHint.slice(0, 200)}` : ''
      }`
    );
  }
  return lines.join('\n').slice(0, 1600);
};

/** 解析 vault/远程图为可压缩上传的 data URL，最多 max 张 */
export const resolveOfferImagesForLlm = async (
  assets: StrategyOfferAsset[],
  selectedIds: string[],
  max = 1
): Promise<string[]> => {
  const selected = assets.filter((a) => selectedIds.includes(a.id) && a.url);
  const pool = (selected.length ? selected : assets.filter((a) => a.url)).slice(0, max + 2);
  const out: string[] = [];
  for (const a of pool) {
    if (out.length >= max) break;
    try {
      const resolved = await resolveToUploadableImage(a.url);
      if (resolved) out.push(resolved);
    } catch (e) {
      console.warn('[strategyOfferBridge] resolve image failed', e);
    }
  }
  return out;
};

export const strategyOfferKindLabel = (kind: StrategyOfferKind) => KIND_LABEL[kind];
