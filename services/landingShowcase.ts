/**
 * 今日看板 · 行业新品展示样本（投资人演示用）
 * 正式货源对接后由接口数据覆盖；前台不展示供应商名与接入说明。
 */
import type { LandingProductItem } from './landingDataCore';

/** 澄海玩具产业代表性品类（名称来自公开展区常见款式，作展示样例） */
export const LANDING_SHOWCASE_PRODUCTS: LandingProductItem[] = [
  {
    id: 'showcase-01',
    title: '世界杯微颗粒积木 · 足球场景拼装',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-02',
    title: '138PCS 动物滑道积木益智套装',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-03',
    title: '飞盘软弹枪（飞盘 / 软弹双用）',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-04',
    title: 'DIY 串珠手链过家家饰品套装',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-05',
    title: '解压海洋冰块捏捏乐 · 麦芽糖款',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-06',
    title: 'PVC 牧场家禽动物场景套装',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-07',
    title: '磁力积木电动轨道车 · 早教桌游',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-08',
    title: '恐龙变形折叠弹射轨道车套装',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-09',
    title: '婴儿声光多功能校巴 · 早教玩具',
    source: '优选展区',
    url: undefined,
  },
  {
    id: 'showcase-10',
    title: 'DIY 独角兽涂鸦水瓶（配水彩笔）',
    source: '优选展区',
    url: undefined,
  },
];

/** 接口无新品时用展示样本铺满看板（不覆盖已有真实数据） */
export const withShowcaseProducts = (
  items: LandingProductItem[] | undefined | null
): LandingProductItem[] => {
  const list = (items || []).filter((p) => (p.title || '').trim());
  if (list.length >= 6) return list.slice(0, 16);
  const seen = new Set(list.map((p) => p.title.trim().toLowerCase()));
  const merged = [...list];
  for (const p of LANDING_SHOWCASE_PRODUCTS) {
    if (seen.has(p.title.toLowerCase())) continue;
    merged.push(p);
    if (merged.length >= 10) break;
  }
  return merged.slice(0, Math.max(10, list.length));
};
