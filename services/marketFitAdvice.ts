/**
 * 适市建议（行业通则启发式，非客户观察数据）。
 * 按品类关键词 × 目标市场给出包装/功能/认证提示，供选品兜底。
 * 设计约束卡在有库内观察时应优先库内；本模块输出须标注「待验证」。
 * 不调用外部供应商，不展示内部数据源名。
 */

export type MarketFitAdvice = {
  market: string;
  categoryHint: string;
  scoreLabel: '高匹配' | '可优化' | '需谨慎';
  scoreTone: 'emerald' | 'amber' | 'rose';
  highlights: string[];
  packaging: string[];
  features: string[];
  compliance: string[];
  nextActions: string[];
};

type MarketProfile = {
  id: string;
  label: string;
  countries: string[];
  preferred: RegExp[];
  packaging: string[];
  features: string[];
  compliance: string[];
};

const MARKETS: MarketProfile[] = [
  {
    id: 'eu',
    label: '欧盟 / 英国',
    countries: ['germany', 'netherlands', 'poland', 'france', 'spain', 'italy', 'united kingdom', 'ireland', 'eu', 'europe'],
    preferred: [/磁力|magnetic|益智|educational|stem|遥控|rc\b|泡泡|bubble|积木|building/i],
    packaging: [
      '彩盒 + 多语种说明书（英 / 德 / 法优先）',
      '窗口盒展示卖点；避免过度塑料填充',
      '标注年龄段与警示语，符合当地零售货架习惯',
    ],
    features: [
      '强调安全材质与可拼可玩时长',
      '系列化 SKU（入门装 / 进阶装）便于连锁补货',
      '低噪音、低风险结构优先于「夸张声光」',
    ],
    compliance: ['CE / UKCA 思路准备', '邻苯、重金属等玩具安全关注点', '外箱唛头清晰：品名、件数、原产地'],
  },
  {
    id: 'na',
    label: '北美',
    countries: ['united states', 'usa', 'canada', 'us', 'america'],
    preferred: [/泡泡|bubble|派对|party|水枪|water|遥控|rc\b|小玩具|fidget|季节|halloween|christmas/i],
    packaging: [
      '悬挂孔 / 吸塑或彩盒，适配沃尔玛式货架与亚马逊主图',
      '英文卖点条（3–5 条）印在正面',
      '季节主题款单独礼品装，便于电商上新',
    ],
    features: [
      '开箱即玩、电池说明清晰',
      'SKU 适合「派对装 / 多件装」',
      '短视频演示友好（泡泡量、声光、变形）',
    ],
    compliance: ['CPC / ASTM 思路准备', '加州 Prop 65 警示评估', '条码与内包装英文一致'],
  },
  {
    id: 'me',
    label: '中东海湾',
    countries: ['uae', 'united arab emirates', 'saudi', 'saudi arabia', 'kuwait', 'qatar', 'oman', 'bahrain'],
    preferred: [/遥控|rc\b|合金|diecast|户外|outdoor|电动|电动车|大件/i],
    packaging: [
      '耐高温运输说明；避免易融胶件外露',
      '阿拉伯语 + 英语双语贴（可贴标方案）',
      '礼品感外盒，适合节庆采购',
    ],
    features: [
      '遥控距离与续航卖点',
      '外观炫酷、合金质感',
      '家庭场景演示（庭院 / 室内）',
    ],
    compliance: ['海湾合格评估咨询', '插头 / 充电器规格确认', '清真市场无特殊禁令但仍需安全警示'],
  },
  {
    id: 'latam',
    label: '拉美',
    countries: ['mexico', 'brazil', 'chile', 'colombia', 'argentina', 'peru'],
    preferred: [/益智|educational|过家家|娃娃|doll|低价|引流|早教|baby/i],
    packaging: [
      '西班牙语主文案 + 简明图示',
      '坚固外箱适应长途海运',
      '混装箱方案降低试单门槛',
    ],
    features: [
      '价格带清晰的引流款 + 利润款组合',
      '耐用、易修配件',
      '本地节日主题可定制贴纸',
    ],
    compliance: ['目标国进口证件提前清单', '年龄警示西班牙语', '避免侵权卡通形象'],
  },
];

const matchMarket = (marketRaw: string): MarketProfile => {
  const m = (marketRaw || '').trim().toLowerCase();
  for (const profile of MARKETS) {
    if (profile.countries.some((c) => m.includes(c) || c.includes(m))) return profile;
    if (m.includes(profile.label.slice(0, 2).toLowerCase())) return profile;
  }
  if (/德|荷|波|法|英|欧/i.test(marketRaw)) return MARKETS[0];
  if (/美|加|北美/i.test(marketRaw)) return MARKETS[1];
  if (/阿联酋|沙特|中东|迪拜/i.test(marketRaw)) return MARKETS[2];
  if (/墨|巴|智|拉美|墨西哥/i.test(marketRaw)) return MARKETS[3];
  return MARKETS[0];
};

export const buildMarketFitAdvice = (opts: {
  categoryOrName: string;
  targetMarket: string;
}): MarketFitAdvice => {
  const profile = matchMarket(opts.targetMarket);
  const text = (opts.categoryOrName || '').trim() || '通用玩具';
  const hit = profile.preferred.some((re) => re.test(text));
  const softHit = /玩具|toy|game|积木|车|娃娃|泡泡/i.test(text);

  let scoreLabel: MarketFitAdvice['scoreLabel'] = '可优化';
  let scoreTone: MarketFitAdvice['scoreTone'] = 'amber';
  if (hit) {
    scoreLabel = '高匹配';
    scoreTone = 'emerald';
  } else if (!softHit) {
    scoreLabel = '需谨慎';
    scoreTone = 'rose';
  }

  const highlights = hit
    ? [
        `「${text}」与${profile.label}常见采购偏好较吻合`,
        '建议用系列化报价（入门 / 主力 / 礼品装）提高成交率',
      ]
    : softHit
      ? [
          `「${text}」可作为该市场的补充线，建议对照当地畅销结构微调功能与包装`,
          '优先补齐适市卖点与合规材料，再批量开发客户',
        ]
      : [
          `「${text}」与${profile.label}主流玩具采购画像偏差较大`,
          '建议先换关键词/类目，或改走细分渠道后再获客',
        ];

  return {
    market: profile.label,
    categoryHint: text,
    scoreLabel,
    scoreTone,
    highlights,
    packaging: profile.packaging,
    features: profile.features,
    compliance: profile.compliance,
    nextActions: [
      '在产品库完善规格、MOQ、出厂价与主图',
      '生成报价/选品单，标注适市包装建议',
      '用对应市场剧本启动自动化获客',
      '对意向客户做背调，核对品类与价位带',
    ],
  };
};

export const MARKET_PICK_OPTIONS = [
  { id: 'eu', label: '欧盟 / 英国' },
  { id: 'na', label: '北美' },
  { id: 'me', label: '中东海湾' },
  { id: 'latam', label: '拉美' },
] as const;
