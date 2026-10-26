/**
 * 今日看板 · 行业新品展示样本（投资人演示用）
 * 正式货源对接后由接口数据覆盖；前台不展示供应商名与接入说明。
 */
import type { LandingProductItem } from './landingDataCore';

/** 公开展区采集的代表性新品（含主图与可见参数） */
export const LANDING_SHOWCASE_PRODUCTS: LandingProductItem[] = [
  {
    id: 'showcase-01',
    title: '6.5CM 益智磁力片积木块 139PCS 百变拼搭',
    image:
      'https://imgs.toysbear.net/PIM/TS177241421253549/HS0000002/P17724521600211348_17724521606217078648.jpg',
    source: '优选展区',
    specs: [
      { label: '片规', value: '6.5 CM' },
      { label: '件数', value: '139 PCS' },
      { label: '品类', value: '磁力积木' },
    ],
  },
  {
    id: 'showcase-02',
    title: '恐龙沙滩车 · 三角龙套装',
    image:
      'https://imgs.toysbear.net/PIM/HS0016434/HS0000003/P17775471387195420_YX18228370_1777546466861.jpg',
    source: '优选展区',
    specs: [
      { label: '件数', value: '7 PCS' },
      { label: '品类', value: '沙滩车 / 恐龙' },
    ],
  },
  {
    id: 'showcase-03',
    title: '窗盒 9 关节 11.5 寸晚装芭比娃娃套装',
    image:
      'https://imgs.toysbear.net/PIM/HS159989662501368/HS0000005/P17145339579475943_542177741815878.jpg',
    source: '优选展区',
    specs: [
      { label: '尺寸', value: '11.5 寸' },
      { label: '关节', value: '9 关节实身' },
      { label: '配件', value: '服装 / 梳妆 / 包袋' },
    ],
  },
  {
    id: 'showcase-04',
    title: '超级飞侠 60cm 游泳圈',
    image: 'https://imgs.toysbear.net/PIM/a97d8914f6ed3354/G874_1792983185217438512.jpg',
    source: '优选展区',
    specs: [
      { label: '直径', value: '60 CM' },
      { label: '品类', value: '水上玩具' },
    ],
  },
  {
    id: 'showcase-05',
    title: '我的世界积木小号桶装 200 颗 + 10 人仔',
    image:
      'https://imgs.toysbear.net/PIM/HS176579240584318/HS0000002/P17658839968159955_17658839974462440460.jpg',
    source: '优选展区',
    specs: [
      { label: '件数', value: '210 PCS' },
      { label: '组成', value: '200 颗 + 10 人仔' },
      { label: '品类', value: '磁力积木方块' },
    ],
  },
  {
    id: 'showcase-06',
    title: '电动透明太空枪泡泡枪（带灯）',
    image:
      'https://imgs.toysbear.net/PIM/HS168301368615915/HS0000005/P17109367668961343_527441388294213.jpg',
    source: '优选展区',
    specs: [
      { label: '件数', value: '12 PCS / 箱' },
      { label: '功能', value: '电动 / 灯光' },
      { label: '品类', value: '泡泡枪' },
    ],
  },
  {
    id: 'showcase-07',
    title: '惊喜娃娃泡泡棒（4 色混装）',
    image:
      'https://imgs.toysbear.net/PIM/HS168007782044923/HS0000002/P17750147234029559_17750147241031993426.jpg',
    source: '优选展区',
    specs: [
      { label: '长度', value: '36 CM' },
      { label: '配色', value: '4 色混装' },
      { label: '品类', value: '泡泡棒' },
    ],
  },
  {
    id: 'showcase-08',
    title: '1:16 四通遥控车带灯光（敞篷款）',
    image:
      'https://imgs.toysbear.net/PIM/HS168310862356946/HS0000003/P17521405372312555_696214923726917.jpg',
    source: '优选展区',
    specs: [
      { label: '比例', value: '1:16' },
      { label: '通道', value: '四通遥控' },
      { label: '功能', value: '灯光' },
    ],
  },
  {
    id: 'showcase-09',
    title: '桌游摇摆叠叠乐 · 卡通鲨鱼平衡积木',
    image:
      'https://imgs.toysbear.net/PIM/HS160810544934535/HS0000003/P17148952959545773_543662067609670.jpg',
    source: '优选展区',
    specs: [
      { label: '块数', value: '48 块' },
      { label: '玩法', value: '摇摆叠叠 / 平衡' },
      { label: '品类', value: '桌游积木' },
    ],
  },
  {
    id: 'showcase-10',
    title: '120 毫升光棒萝卜兔泡泡棒',
    image:
      'https://imgs.toysbear.net/PIM/HS171775405706656/HS0000002/P17793417591565068_17793417608886878559.jpg',
    source: '优选展区',
    specs: [
      { label: '容量', value: '120 ML' },
      { label: '品类', value: '泡泡棒 / 光棒' },
    ],
  },
];

/** 接口无带图新品时用展示样本铺满看板（不覆盖已有带图真实数据） */
export const withShowcaseProducts = (
  items: LandingProductItem[] | undefined | null
): LandingProductItem[] => {
  const list = (items || []).filter((p) => (p.title || '').trim());
  const withImg = list.filter((p) => !!(p.image || '').trim());
  if (withImg.length >= 6) return withImg.slice(0, 16);
  const seen = new Set(withImg.map((p) => p.title.trim().toLowerCase()));
  const merged = [...withImg];
  for (const p of LANDING_SHOWCASE_PRODUCTS) {
    if (seen.has(p.title.toLowerCase())) continue;
    merged.push(p);
    if (merged.length >= 10) break;
  }
  return merged.slice(0, 10);
};
