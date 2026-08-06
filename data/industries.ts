/**
 * 国际贸易 / B2B 常用行业分类
 * 参考：UN ISIC Rev.4 大类 + NAICS 部门 + 外贸实务品类（HS 导向）
 * 下拉多选 + 可手动录入自定义行业
 */

export type IndustryOption = {
  /** 英文标准名（写入搜索与导出） */
  en: string;
  /** 中文显示 */
  zh: string;
  /** 分组（ISIC / 贸易实务） */
  group: string;
};

/** 分组顺序 */
export const INDUSTRY_GROUPS = [
  '消费品与零售',
  '母婴与玩具',
  '家居与家装',
  '电子与电器',
  '纺织服装与鞋包',
  '食品饮料与农业',
  '工业与机械',
  '化工与材料',
  '汽车与交通',
  '医疗与健康',
  '建筑与基建',
  '能源与环保',
  'IT与专业服务',
  '物流贸易与渠道',
  '其他',
] as const;

export const INDUSTRY_OPTIONS: IndustryOption[] = [
  // —— 消费品与零售 ——
  { en: 'General Merchandise Retail', zh: '综合零售 / 百货', group: '消费品与零售' },
  { en: 'E-commerce / Online Retail', zh: '电商 / 线上零售', group: '消费品与零售' },
  { en: 'Department Stores', zh: '百货商场', group: '消费品与零售' },
  { en: 'Supermarkets & Hypermarkets', zh: '商超 / 大卖场', group: '消费品与零售' },
  { en: 'Convenience Stores', zh: '便利店', group: '消费品与零售' },
  { en: 'Discount & Variety Stores', zh: '折扣店 / 杂货店', group: '消费品与零售' },
  { en: 'Gift & Novelty Products', zh: '礼品 / 创意小商品', group: '消费品与零售' },
  { en: 'Party Supplies', zh: '派对用品', group: '消费品与零售' },
  { en: 'Stationery & Office Supplies', zh: '文具办公用品', group: '消费品与零售' },
  { en: 'Sports & Outdoor Recreation', zh: '体育 / 户外休闲', group: '消费品与零售' },
  { en: 'Camping & Hiking Gear', zh: '露营徒步装备', group: '消费品与零售' },
  { en: 'Pet Products', zh: '宠物用品', group: '消费品与零售' },
  { en: 'Jewelry & Watches', zh: '珠宝钟表', group: '消费品与零售' },
  { en: 'Cosmetics & Personal Care', zh: '化妆品 / 个护', group: '消费品与零售' },
  { en: 'Beauty Tools & Accessories', zh: '美妆工具配件', group: '消费品与零售' },
  { en: 'Household Cleaning Products', zh: '家清日化', group: '消费品与零售' },

  // —— 母婴与玩具 ——
  { en: 'Baby Products', zh: '母婴用品', group: '母婴与玩具' },
  { en: 'Infant & Toddler Care', zh: '婴幼儿护理', group: '母婴与玩具' },
  { en: 'Maternity Products', zh: '孕产用品', group: '母婴与玩具' },
  { en: 'Toys & Games', zh: '玩具与游戏', group: '母婴与玩具' },
  { en: 'Educational Toys', zh: '益智教育玩具', group: '母婴与玩具' },
  { en: 'Plush & Soft Toys', zh: '毛绒玩具', group: '母婴与玩具' },
  { en: 'Electronic Toys', zh: '电子玩具', group: '母婴与玩具' },
  { en: 'Outdoor Play Equipment', zh: '户外游乐设施', group: '母婴与玩具' },
  { en: 'Bubble & Party Toys', zh: '泡泡 / 派对玩具', group: '母婴与玩具' },
  { en: "Children's Apparel", zh: '童装', group: '母婴与玩具' },
  { en: "Children's Footwear", zh: '童鞋', group: '母婴与玩具' },
  { en: 'Nursery Furniture', zh: '婴儿房家具', group: '母婴与玩具' },
  { en: 'School Supplies', zh: '学生用品', group: '母婴与玩具' },

  // —— 家居与家装 ——
  { en: 'Home Decor', zh: '家居装饰', group: '家居与家装' },
  { en: 'Furniture', zh: '家具', group: '家居与家装' },
  { en: 'Home Textiles', zh: '家纺', group: '家居与家装' },
  { en: 'Kitchenware & Tableware', zh: '厨具餐具', group: '家居与家装' },
  { en: 'Cookware', zh: '锅具', group: '家居与家装' },
  { en: 'Bathroom Products', zh: '卫浴用品', group: '家居与家装' },
  { en: 'Lighting Fixtures', zh: '灯具照明', group: '家居与家装' },
  { en: 'Garden & Lawn Products', zh: '园艺草坪用品', group: '家居与家装' },
  { en: 'Storage & Organization', zh: '收纳整理', group: '家居与家装' },
  { en: 'Bedding & Mattresses', zh: '床品床垫', group: '家居与家装' },
  { en: 'Carpets & Rugs', zh: '地毯', group: '家居与家装' },
  { en: 'Window Coverings', zh: '窗帘窗饰', group: '家居与家装' },
  { en: 'Hardware & DIY', zh: '五金 / DIY', group: '家居与家装' },

  // —— 电子与电器 ——
  { en: 'Consumer Electronics', zh: '消费电子', group: '电子与电器' },
  { en: 'Mobile Phones & Accessories', zh: '手机及配件', group: '电子与电器' },
  { en: 'Computer Hardware & Peripherals', zh: '电脑硬件外设', group: '电子与电器' },
  { en: 'Audio & Video Equipment', zh: '影音设备', group: '电子与电器' },
  { en: 'Smart Home Devices', zh: '智能家居', group: '电子与电器' },
  { en: 'Wearable Devices', zh: '可穿戴设备', group: '电子与电器' },
  { en: 'Home Appliances', zh: '家用电器', group: '电子与电器' },
  { en: 'Small Kitchen Appliances', zh: '小家电', group: '电子与电器' },
  { en: 'LED & Lighting Electronics', zh: 'LED 电子照明', group: '电子与电器' },
  { en: 'Batteries & Power Banks', zh: '电池充电宝', group: '电子与电器' },
  { en: 'Semiconductor & Components', zh: '半导体元器件', group: '电子与电器' },
  { en: 'Telecommunications Equipment', zh: '通信设备', group: '电子与电器' },

  // —— 纺织服装与鞋包 ——
  { en: 'Apparel & Fashion', zh: '服装时尚', group: '纺织服装与鞋包' },
  { en: 'Footwear', zh: '鞋类', group: '纺织服装与鞋包' },
  { en: 'Bags & Luggage', zh: '箱包', group: '纺织服装与鞋包' },
  { en: 'Textiles & Fabrics', zh: '纺织面料', group: '纺织服装与鞋包' },
  { en: 'Knitwear', zh: '针织服装', group: '纺织服装与鞋包' },
  { en: 'Sportswear & Activewear', zh: '运动服', group: '纺织服装与鞋包' },
  { en: 'Underwear & Lingerie', zh: '内衣', group: '纺织服装与鞋包' },
  { en: 'Workwear & Uniforms', zh: '工装制服', group: '纺织服装与鞋包' },
  { en: 'Accessories & Hats', zh: '服饰配件帽子', group: '纺织服装与鞋包' },

  // —— 食品饮料与农业 ——
  { en: 'Food & Beverage', zh: '食品饮料', group: '食品饮料与农业' },
  { en: 'Packaged Foods', zh: '包装食品', group: '食品饮料与农业' },
  { en: 'Confectionery & Snacks', zh: '糖果零食', group: '食品饮料与农业' },
  { en: 'Beverages & Soft Drinks', zh: '饮料', group: '食品饮料与农业' },
  { en: 'Alcoholic Beverages', zh: '酒类', group: '食品饮料与农业' },
  { en: 'Dairy Products', zh: '乳制品', group: '食品饮料与农业' },
  { en: 'Seafood', zh: '海鲜水产', group: '食品饮料与农业' },
  { en: 'Agriculture & Fresh Produce', zh: '农产品生鲜', group: '食品饮料与农业' },
  { en: 'Pet Food', zh: '宠物食品', group: '食品饮料与农业' },
  { en: 'Food Ingredients & Additives', zh: '食品原料添加剂', group: '食品饮料与农业' },

  // —— 工业与机械 ——
  { en: 'Industrial Machinery', zh: '工业机械', group: '工业与机械' },
  { en: 'Machine Tools', zh: '机床工具', group: '工业与机械' },
  { en: 'Packaging Machinery', zh: '包装机械', group: '工业与机械' },
  { en: 'Construction Machinery', zh: '工程机械', group: '工业与机械' },
  { en: 'Agricultural Machinery', zh: '农业机械', group: '工业与机械' },
  { en: 'Pumps Valves & Compressors', zh: '泵阀压缩机', group: '工业与机械' },
  { en: 'Bearings & Power Transmission', zh: '轴承传动', group: '工业与机械' },
  { en: 'Hand Tools & Power Tools', zh: '手工电动工具', group: '工业与机械' },
  { en: 'Industrial Automation', zh: '工业自动化', group: '工业与机械' },
  { en: 'Molds & Dies', zh: '模具', group: '工业与机械' },

  // —— 化工与材料 ——
  { en: 'Chemicals', zh: '化工', group: '化工与材料' },
  { en: 'Plastics & Rubber', zh: '塑料橡胶', group: '化工与材料' },
  { en: 'Plastic Products', zh: '塑料制品', group: '化工与材料' },
  { en: 'Packaging Materials', zh: '包装材料', group: '化工与材料' },
  { en: 'Paper & Pulp', zh: '造纸纸浆', group: '化工与材料' },
  { en: 'Glass & Ceramics', zh: '玻璃陶瓷', group: '化工与材料' },
  { en: 'Metals & Alloys', zh: '金属合金', group: '化工与材料' },
  { en: 'Steel & Iron Products', zh: '钢铁制品', group: '化工与材料' },
  { en: 'Coatings & Adhesives', zh: '涂料胶粘剂', group: '化工与材料' },
  { en: 'Fertilizers & Agrochemicals', zh: '化肥农化', group: '化工与材料' },

  // —— 汽车与交通 ——
  { en: 'Automotive Parts', zh: '汽车零部件', group: '汽车与交通' },
  { en: 'Automotive Aftermarket', zh: '汽车后市场', group: '汽车与交通' },
  { en: 'Electric Vehicles & EV Parts', zh: '新能源汽车配件', group: '汽车与交通' },
  { en: 'Tires', zh: '轮胎', group: '汽车与交通' },
  { en: 'Motorcycles & Scooters', zh: '摩托车电动车', group: '汽车与交通' },
  { en: 'Bicycles & E-Bikes', zh: '自行车电助力车', group: '汽车与交通' },
  { en: 'Marine Equipment', zh: '船舶设备', group: '汽车与交通' },
  { en: 'Aerospace Components', zh: '航空零部件', group: '汽车与交通' },

  // —— 医疗与健康 ——
  { en: 'Medical Devices', zh: '医疗器械', group: '医疗与健康' },
  { en: 'Pharmaceuticals', zh: '药品', group: '医疗与健康' },
  { en: 'Health & Wellness', zh: '健康养生', group: '医疗与健康' },
  { en: 'Dental Products', zh: '牙科产品', group: '医疗与健康' },
  { en: 'Laboratory Equipment', zh: '实验室设备', group: '医疗与健康' },
  { en: 'Personal Protective Equipment (PPE)', zh: '个人防护用品', group: '医疗与健康' },
  { en: 'Rehabilitation & Mobility Aids', zh: '康复助行', group: '医疗与健康' },

  // —— 建筑与基建 ——
  { en: 'Building Materials', zh: '建材', group: '建筑与基建' },
  { en: 'Construction Supplies', zh: '建筑耗材', group: '建筑与基建' },
  { en: 'Plumbing & HVAC', zh: '水暖暖通', group: '建筑与基建' },
  { en: 'Electrical Installation Materials', zh: '电工安装材料', group: '建筑与基建' },
  { en: 'Flooring', zh: '地板', group: '建筑与基建' },
  { en: 'Doors & Windows', zh: '门窗', group: '建筑与基建' },
  { en: 'Insulation Materials', zh: '保温隔热材料', group: '建筑与基建' },

  // —— 能源与环保 ——
  { en: 'Solar Energy & PV', zh: '太阳能光伏', group: '能源与环保' },
  { en: 'Renewable Energy Equipment', zh: '可再生能源设备', group: '能源与环保' },
  { en: 'Batteries & Energy Storage', zh: '电池储能', group: '能源与环保' },
  { en: 'Water Treatment', zh: '水处理', group: '能源与环保' },
  { en: 'Environmental Protection Equipment', zh: '环保设备', group: '能源与环保' },
  { en: 'Recycling & Waste Management', zh: '回收固废', group: '能源与环保' },

  // —— IT与专业服务 ——
  { en: 'Software & SaaS', zh: '软件 / SaaS', group: 'IT与专业服务' },
  { en: 'IT Services', zh: 'IT 服务', group: 'IT与专业服务' },
  { en: 'Telecommunications Services', zh: '电信服务', group: 'IT与专业服务' },
  { en: 'Marketing & Advertising', zh: '营销广告', group: 'IT与专业服务' },
  { en: 'Consulting Services', zh: '咨询服务', group: 'IT与专业服务' },
  { en: 'Education & Training', zh: '教育培训', group: 'IT与专业服务' },
  { en: 'Financial Services', zh: '金融服务', group: 'IT与专业服务' },

  // —— 物流贸易与渠道 ——
  { en: 'Import & Export Trading', zh: '进出口贸易', group: '物流贸易与渠道' },
  { en: 'Wholesale Distribution', zh: '批发分销', group: '物流贸易与渠道' },
  { en: 'Logistics & Freight', zh: '物流货运', group: '物流贸易与渠道' },
  { en: 'Warehousing', zh: '仓储', group: '物流贸易与渠道' },
  { en: 'Procurement / Buying Office', zh: '采购办公室', group: '物流贸易与渠道' },
  { en: 'Franchise & Chain Retail', zh: '加盟连锁零售', group: '物流贸易与渠道' },

  // —— 其他 ——
  { en: 'Printing & Publishing', zh: '印刷出版', group: '其他' },
  { en: 'Security & Surveillance', zh: '安防监控', group: '其他' },
  { en: 'Musical Instruments', zh: '乐器', group: '其他' },
  { en: 'Art & Craft Supplies', zh: '美术工艺用品', group: '其他' },
  { en: 'Hospitality Supplies', zh: '酒店用品', group: '其他' },
  { en: 'Safety Equipment', zh: '安全防护设备', group: '其他' },
];

export const industryLabel = (opt: IndustryOption) => `${opt.zh} · ${opt.en}`;

/** 解析已选行业字符串（兼容旧版单字符串） */
export const parseIndustrySelection = (raw?: string | string[]): string[] => {
  if (Array.isArray(raw)) return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[,，;/|]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
};

export const joinIndustries = (list: string[]): string => list.filter(Boolean).join(', ');
