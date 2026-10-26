/**
 * 平面设计 / 3D / 视频 / 包装 互通：素材清单 + 跨模块交接包。
 * 仅存 localStorage，不碰 CRM。
 */
import { ModuleType } from '../types';
import { loadCatalogSkus, type CatalogSku } from './productCatalogTypes';
import { loadDesignAssets, loadDesignProjects, type DesignAsset } from './designAgentStore';

export type CreativeRefSource = 'catalog' | 'design' | 'upload';

export type CreativeRefItem = {
  id: string;
  url: string;
  label: string;
  source: CreativeRefSource;
  skuCode?: string;
  skuName?: string;
  angle?: string;
  createdAt?: number;
};

export type CreativeHandoff = {
  images: string[];
  skuCode?: string;
  skuName?: string;
  note?: string;
  from: 'design_2d' | 'catalog' | 'manual' | 'packaging';
  target: 'design_3d' | 'ai_video' | 'packaging';
  at: number;
};

const LS_HANDOFF = 'trade_scout_creative_handoff_v1';

export const MULTI_ANGLE_VIEWS: Array<{ id: string; label: string; prompt: string }> = [
  {
    id: 'front',
    label: '正面',
    prompt:
      'same product, front orthographic view, centered, clean white seamless background, studio softbox lighting, sharp focus, commercial product photography, no watermark, no text',
  },
  {
    id: 'three_quarter',
    label: '45°',
    prompt:
      'same product, three-quarter view about 45 degrees, centered, clean white seamless background, studio softbox lighting, sharp focus, commercial product photography, no watermark, no text',
  },
  {
    id: 'side',
    label: '侧面',
    prompt:
      'same product, pure side profile view, centered, clean white seamless background, studio softbox lighting, sharp focus, commercial product photography, no watermark, no text',
  },
  {
    id: 'back',
    label: '背面',
    prompt:
      'same product, rear / back view, centered, clean white seamless background, studio softbox lighting, sharp focus, commercial product photography, no watermark, no text',
  },
];

export const listCatalogRefItems = (limit = 80): CreativeRefItem[] => {
  const out: CreativeRefItem[] = [];
  for (const sku of loadCatalogSkus().slice(0, limit)) {
    (sku.images || []).forEach((url, i) => {
      if (!url?.trim()) return;
      out.push({
        id: `cat_${sku.id}_${i}`,
        url,
        label: `${sku.skuCode} · ${sku.name}${i > 0 ? ` #${i + 1}` : ''}`,
        source: 'catalog',
        skuCode: sku.skuCode,
        skuName: sku.name,
        createdAt: sku.updatedAt,
      });
    });
  }
  return out;
};

export const listDesignRefItems = (limit = 60): CreativeRefItem[] => {
  const projects = loadDesignProjects();
  const titleOf = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.title || '平面项目';
  return loadDesignAssets()
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .filter((a) => !!(a.url || '').trim())
    .map((a: DesignAsset) => ({
      id: `des_${a.id}`,
      url: a.url,
      label: `${titleOf(a.projectId)}${a.angle ? ` · ${a.angle}` : ''}`,
      source: 'design' as const,
      angle: a.angle,
      createdAt: a.createdAt,
      skuCode: projects.find((p) => p.id === a.projectId)?.skuCode,
      skuName: projects.find((p) => p.id === a.projectId)?.skuName,
    }));
};

export const listCreativeRefItems = (): CreativeRefItem[] => [
  ...listDesignRefItems(),
  ...listCatalogRefItems(),
];

export const findSkuByIdOrCode = (pick: string): CatalogSku | undefined => {
  const skus = loadCatalogSkus();
  return skus.find((s) => s.id === pick || s.skuCode === pick);
};

export const setCreativeHandoff = (payload: Omit<CreativeHandoff, 'at'>) => {
  const next: CreativeHandoff = { ...payload, at: Date.now() };
  localStorage.setItem(LS_HANDOFF, JSON.stringify(next));
  return next;
};

export const peekCreativeHandoff = (): CreativeHandoff | null => {
  try {
    const raw = localStorage.getItem(LS_HANDOFF);
    if (!raw) return null;
    const p = JSON.parse(raw) as CreativeHandoff;
    if (!p?.images?.length) return null;
    return p;
  } catch {
    return null;
  }
};

/** 读取并清除指定目标的交接包 */
export const consumeCreativeHandoff = (
  target: CreativeHandoff['target']
): CreativeHandoff | null => {
  const cur = peekCreativeHandoff();
  if (!cur || cur.target !== target) return null;
  localStorage.removeItem(LS_HANDOFF);
  return cur;
};

export const handoffTargetToModule = (target: CreativeHandoff['target']): ModuleType => {
  if (target === 'design_3d') return ModuleType.PRODUCT_DESIGN_3D;
  if (target === 'packaging') return ModuleType.PRODUCT_PACKAGING;
  return ModuleType.PRODUCT_AI_VIDEO;
};

export const CREATIVE_PIPELINE: Array<{
  id: string;
  label: string;
  module: ModuleType;
  blurb: string;
}> = [
  {
    id: '2d',
    label: '1 平面图',
    module: ModuleType.PRODUCT_DESIGN_2D,
    blurb: '主图 / 多角度',
  },
  {
    id: '3d',
    label: '2 三维',
    module: ModuleType.PRODUCT_DESIGN_3D,
    blurb: '图生 GLB',
  },
  {
    id: 'video',
    label: '3 视频',
    module: ModuleType.PRODUCT_AI_VIDEO,
    blurb: '样片→正片',
  },
  {
    id: 'packaging',
    label: '4 包装设计',
    module: ModuleType.PRODUCT_PACKAGING,
    blurb: '形态 × 卖场 × 配色',
  },
];
