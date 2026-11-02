/**
 * 产品视频 Skills：拆解亚马逊 Gallery/A+、TikTok Shop、展会循环、潮玩 IP 短片等
 * 高转化结构，固化为「选场景 + 填卖点」傻瓜包（内置分镜，非联网抓取）。
 *
 * 结构来源（方法论对齐，非抄片）：
 * - Amazon SPV / A+：前 3s 产品可见、一镜一卖点、静音可读、15–30s 验证型
 * - TikTok Shop：钩子→卖点→实证→行动；开箱信息差在前 1–3s
 * - 展会 loop：任意切入可读、首尾同帧、无声大字幕友好、30–90s 节拍压缩到短片
 * - B2B 采购：机制证明 + 规格/配件/场景，而非品牌广告
 */

export type VideoSkillId =
  | 'amazon_gallery'
  | 'amazon_aplus'
  | 'hero_orbit'
  | 'feature_demo'
  | 'scale_parts'
  | 'transform_play'
  | 'unbox_hook'
  | 'tiktok_shop'
  | 'toy_ip_skit'
  | 'shelf_lifestyle'
  | 'kids_play'
  | 'booth_loop'
  | 'b2b_buyer'
  | 'free';

export type VideoDurationSec = 4 | 5 | 6 | 8 | 10 | 12 | 15;

export type VideoSkillDef = {
  id: VideoSkillId;
  label: string;
  category: string;
  /** 渠道角标，如 Amazon / TikTok / 展会 */
  channel: string;
  hint: string;
  /** 为何有效（给业务员看的一句） */
  whyItWorks: string;
  /** 写入引擎的英文底稿骨架（可被组装器强化） */
  defaultPrompt: string;
  /** 中文分镜模板；{p1}/{p2}/{p3} 可被卖点替换 */
  storyboardZh: string;
  negativeHints: string;
  qaChecklist: string[];
  aspectHint: string;
  defaultAspect: '16:9' | '9:16' | '1:1';
  defaultDurationSec: VideoDurationSec;
  /** 推荐卖点槽位数 */
  sellingPointSlots: 1 | 2 | 3;
  /** 是否优先要求产品图 */
  preferImage: boolean;
};

export type VideoSkillSlots = {
  productName?: string;
  sellingPoints?: string[];
  categoryHint?: string;
  extraNote?: string;
};

const pointsLine = (pts: string[]): string => {
  const clean = pts.map((p) => p.trim()).filter(Boolean).slice(0, 3);
  if (!clean.length) return '';
  return clean.map((p, i) => `Selling point ${i + 1}: ${p}`).join('. ');
};

const fillStoryboard = (tpl: string, pts: string[]): string => {
  let out = tpl;
  const a = pts[0]?.trim() || '核心卖点';
  const b = pts[1]?.trim() || '材质/细节';
  const c = pts[2]?.trim() || '场景收尾';
  out = out.replace(/\{p1\}/g, a).replace(/\{p2\}/g, b).replace(/\{p3\}/g, c);
  return out;
};

/** 按 Skill + 用户槽位组装引擎提示词与分镜（傻瓜模式核心） */
export const assembleVideoSkillPayload = (
  skill: VideoSkillDef,
  slots: VideoSkillSlots = {}
): { prompt: string; storyboardZh: string; negative: string; aspect: VideoSkillDef['defaultAspect']; durationSec: VideoDurationSec } => {
  const pts = (slots.sellingPoints || []).map((p) => p.trim()).filter(Boolean).slice(0, 3);
  const name = (slots.productName || '').trim();
  const cat = (slots.categoryHint || '').trim();
  const note = (slots.extraNote || '').trim();
  const storyboardZh = fillStoryboard(skill.storyboardZh, pts);

  const prompt = [
    skill.defaultPrompt,
    name ? `Product name / SKU focus: ${name}.` : '',
    cat ? `Category context: ${cat}.` : '',
    pointsLine(pts),
    note ? `Additional creative note: ${note}.` : '',
    'Muted-friendly storytelling: meaning must read from visuals alone; avoid reliance on spoken VO.',
    'Commercial toy/gift export look: true materials, locked identity, no watermark, no gibberish text overlays baked into the plate.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    prompt,
    storyboardZh,
    negative: skill.negativeHints,
    aspect: skill.defaultAspect,
    durationSec: skill.defaultDurationSec,
  };
};

export const VIDEO_SKILLS: VideoSkillDef[] = [
  {
    id: 'amazon_gallery',
    label: '亚马逊主图视频',
    category: 'Amazon',
    channel: 'Gallery',
    hint: '15–25s · 前 3 秒产品入画 · 静音可读 · 解决一个购买疑问',
    whyItWorks:
      'Gallery 自动静音播放：前 3s 不出产品就流失；一镜证明「子弹说的那件事」转化最高。',
    defaultPrompt:
      'Amazon product gallery video, product-first in the opening frames, clear mechanism or play demo, soft commercial lighting, 16:9 marketplace framing, muted-friendly pacing, one primary buying question answered visually, honest scale, locked SKU identity, no logo splash intro, no watermark, no baked-in captions required',
    storyboardZh:
      '0–3s 产品正面入画并开始动作（禁止黑场/Logo）→ 3–12s 演示 {p1}（手部或机构特写）→ 12–18s 补充 {p2} 或配件/尺寸感 → 18–22s 干净英雄角定格（可作循环尾帧）',
    negativeHints:
      'logo splash, talking head, slideshow stills, letterboxing, emoji overlays, morphing product, identity drift, watermark, medical claims text, competitor packs in focus',
    qaChecklist: [
      '前 3 秒产品占画面主体且在动',
      '静音也能看懂在证明什么',
      '无片头 Logo 动画',
      '外形与参考图一致',
    ],
    aspectHint: '16:9',
    defaultAspect: '16:9',
    defaultDurationSec: 10,
    sellingPointSlots: 2,
    preferImage: true,
  },
  {
    id: 'amazon_aplus',
    label: '亚马逊 A+ 验证片',
    category: 'Amazon',
    channel: 'A+',
    hint: '25s 级验证结构：识别→场景问题→运动证明→异议消除→收尾',
    whyItWorks:
      'A+ 区用户在「确认」而非「发现」：每段视频只打消一个疑虑时转化最好。',
    defaultPrompt:
      'Amazon A+ validation video, product identification first, then visual use-case, then proof-in-motion, then objection removal (size/parts/care), brand-safe close on clean hero shot, softbox ecommerce lighting, accurate accessories, locked product identity, muted-friendly, no hard coupon pitch, no watermark',
    storyboardZh:
      '0–3s 识别产品 → 3–8s 使用场景/痛点画面 → 8–18s 运动证明 {p1} → 18–24s 消除疑虑（{p2}：尺寸/配件/收纳）→ 末秒 产品+中性利益收尾',
    negativeHints:
      'unsupported claims, exaggerated before-after, wrong bundle contents, morphing product, watermark, cluttered lifestyle padding',
    qaChecklist: ['只证明一个核心疑虑', '配件与实物一致', '结尾可作静帧缩略', '无夸大功效'],
    aspectHint: '16:9',
    defaultAspect: '16:9',
    defaultDurationSec: 12,
    sellingPointSlots: 2,
    preferImage: true,
  },
  {
    id: 'hero_orbit',
    label: '产品环绕主片',
    category: '电商',
    channel: 'Hero',
    hint: '慢速环绕 / 推近，独立站与主视觉',
    whyItWorks: '电商主视觉需要「看得清材质与配色」的稳定英雄镜头，环绕+推近是默认成交片型。',
    defaultPrompt:
      'Cinematic product hero video of the toy or gift, slow 360 orbit then gentle push-in, soft three-point studio lighting, seamless white or soft gradient cyclorama, sharp macro detail on materials, commercial ecommerce hero, locked product identity for entire clip, no watermark, no on-screen text unless specified',
    storyboardZh:
      '0–2s 正面定格 → 2–6s 缓慢环绕展示外形与配色 → 6–8s 推近关键细节（{p1}）→ 8–10s 回到英雄角收尾',
    negativeHints:
      'jitter, morphing, identity drift, extra limbs, blurry logo, watermark, stock lower-third spam, melting plastics, frame-to-frame redesign',
    qaChecklist: ['产品外形与参考图一致', '运镜平滑无闪烁', '背景干净可裁切'],
    aspectHint: '16:9 / 1:1',
    defaultAspect: '16:9',
    defaultDurationSec: 8,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'feature_demo',
    label: '功能卖点演示',
    category: 'Listing',
    channel: 'Demo',
    hint: '每 2–3 秒一个卖点动作，适合 Listing 主视频',
    whyItWorks: 'Listing 买家扫读：节奏化卖点比一条长运镜更容易记住「能干什么」。',
    defaultPrompt:
      'Product feature demo video for marketplace listing, clear beat-by-beat demonstrations of toy or gift functions, bright even softbox lighting, readable motion, commercial clarity, same SKU look in every beat, kid-safe playful energy without chaos, no watermark',
    storyboardZh:
      '镜头1 亮相 → 镜头2 演示 {p1} → 镜头3 演示 {p2} → 镜头4 细节/配件 {p3} → 镜头5 英雄角收尾',
    negativeHints:
      'chaotic cuts, unreadable action, dark underexposure, fake UI overlays, morphing product, identity drift',
    qaChecklist: ['每个卖点动作可看清', '节奏适合 Listing', '无乱码字幕'],
    aspectHint: '1:1 / 16:9',
    defaultAspect: '1:1',
    defaultDurationSec: 10,
    sellingPointSlots: 3,
    preferImage: true,
  },
  {
    id: 'scale_parts',
    label: '尺寸与配件证明',
    category: 'Listing',
    channel: 'Proof',
    hint: '手比/桌面参照 + 开箱配件平铺，打消「实物偏小/缺件」',
    whyItWorks: '玩具差评高频是尺寸与配件预期差；视觉证明比文案更能降退货。',
    defaultPrompt:
      'Product scale and contents proof video, hand or desk reference for true size, lay-flat of included parts, honest lighting, ecommerce clarity, locked SKU identity matching reference, no misleading zoom, no watermark',
    storyboardZh:
      '0–3s 产品与手/常见物对照 → 3–8s 旋转展示体积感 → 8–12s 配件/内含物平铺强调 {p1} → 收尾整机英雄角',
    negativeHints:
      'misleading macro that fakes size, missing parts vs claim, morphing product, watermark',
    qaChecklist: ['有真实尺寸参照', '配件完整可见', '无欺骗性特写'],
    aspectHint: '16:9 / 1:1',
    defaultAspect: '16:9',
    defaultDurationSec: 8,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'transform_play',
    label: '变形 / 核心玩法',
    category: '玩具',
    channel: 'Play',
    hint: '变形、弹射、声光、拼装完成态——玩具类目高点击结构',
    whyItWorks:
      'Amazon 玩具指引强调 launch / build / transformation；把「玩法完成态」拍清楚，CTR 更稳。',
    defaultPrompt:
      'Toy transformation or core-play demo video, show the play mechanism clearly beat by beat, satisfying reveal of transformed or completed state, bright playful commercial lighting, locked product identity, readable motion for marketplace, no watermark',
    storyboardZh:
      '0–2s 初始形态 → 2–8s 操作 {p1}（变形/发射/拼装过程）→ 8–12s 完成态展示 → 可选 {p2} 安全/易用细节 → 英雄角',
    negativeHints:
      'unsafe play, broken mechanism, morphing into wrong toy, identity drift, dark scary mood, watermark',
    qaChecklist: ['玩法步骤可读', '完成态清晰', '无危险动作暗示'],
    aspectHint: '16:9 / 1:1',
    defaultAspect: '16:9',
    defaultDurationSec: 10,
    sellingPointSlots: 2,
    preferImage: true,
  },
  {
    id: 'unbox_hook',
    label: '开箱钩子短视频',
    category: '社媒',
    channel: 'Unbox',
    hint: '前 1–3 秒悬念，适合 TikTok / Reels',
    whyItWorks: '开箱用「信息差」留人：密封包装制造好奇，再快速兑现外形与手感。',
    defaultPrompt:
      'Short-form unboxing hook video, curiosity gap in first second, sealed package then satisfying reveal, product pop against clean backdrop, vertical framing friendly, high retention pacing, social commerce aesthetic, locked product identity after reveal, no watermark',
    storyboardZh:
      '0–1s 悬念特写（盒面/剪影，不说破）→ 1–4s 开盖/撕膜爽感 → 4–8s 产品亮相+快速展示 {p1} → 8–12s 手感/配件一瞥 → 完结定格',
    negativeHints: 'slow boring open, messy desk clutter, shaky handheld extreme, morphing product, watermark',
    qaChecklist: ['前 1 秒有钩子', '竖屏主体居中', '开箱动作完整'],
    aspectHint: '9:16',
    defaultAspect: '9:16',
    defaultDurationSec: 8,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'tiktok_shop',
    label: '短视频带货四段式',
    category: '社媒',
    channel: 'TikTok',
    hint: '钩子→卖点→实证→收束；9:16；单视频单主卖点',
    whyItWorks:
      '高转化短视频共享骨架 hook→benefit→proof→close；堆砌卖点会断转化链。',
    defaultPrompt:
      'Vertical short-form product commerce video, hook in first 1–2 seconds with product motion or surprising detail, one primary selling point proven on camera, fast readable pacing, bright even light, locked SKU identity, social feed native 9:16, no watermark, no logo intro',
    storyboardZh:
      '0–2s 钩子（结果先行或悬念）：点出 {p1} → 2–6s 卖点可视化 → 6–10s 实证（试用/对比/特写）→ 末 2s 产品定格收束',
    negativeHints:
      'slow brand film, multi-unrelated claims, watermark, morphing product, cluttered background, hard-to-read action',
    qaChecklist: ['只有一个主卖点', '3 秒内出现产品动作', '竖屏构图安全'],
    aspectHint: '9:16',
    defaultAspect: '9:16',
    defaultDurationSec: 10,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'toy_ip_skit',
    label: '潮玩 IP 短剧',
    category: 'IP',
    channel: 'Story',
    hint: '三幕微剧：出场→冲突/反转→定格；角色感但锁产品外形',
    whyItWorks:
      '潮玩靠情绪与人设传播；短剧结构提升完播，但必须锁模具外形避免「换脸」。',
    defaultPrompt:
      'Collectible designer-toy IP mini-skit video, three-beat micro story with playful character energy, cinematic mini lighting, product remains the exact same physical figure as reference (no face redesign), satisfying ending freeze on hero pose, social-friendly pacing, no watermark, no readable real-child faces required',
    storyboardZh:
      '幕1 出场亮相（英雄角）→ 幕2 小冲突/反转围绕 {p1} → 幕3 情绪高潮+产品定格；全程外形与配色锁死参考图',
    negativeHints:
      'redesigned face or body, identity drift, recognizable celebrity, unsafe play, watermark, horror tone',
    qaChecklist: ['外形未换模', '有完整三拍情绪', '结尾可当封面静帧'],
    aspectHint: '9:16 / 1:1',
    defaultAspect: '9:16',
    defaultDurationSec: 8,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'shelf_lifestyle',
    label: '货架 / 生活场景',
    category: '零售',
    channel: 'Retail',
    hint: '商超货架或客厅，给买家上架想象',
    whyItWorks: '零售买家要看见「上架后长什么样」；货架→取货→场景是经典说服路径。',
    defaultPrompt:
      'Retail shelf and lifestyle product video, toy or gift on supermarket shelf then cut to cozy living-room or desk play context, natural window light plus soft fill, aspirational but realistic for mass retail, locked product identity, no watermark',
    storyboardZh:
      '货架陈列推镜 → 手取产品 → 切客厅/桌面演示 {p1} → 回到包装正面收尾',
    negativeHints:
      'empty unrealistic CGI shelf only, brand-infringing competitor packs in focus, morphing product, watermark',
    qaChecklist: ['场景真实可信', '包装朝向可读', '无竞品侵权特写'],
    aspectHint: '16:9',
    defaultAspect: '16:9',
    defaultDurationSec: 8,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'kids_play',
    label: '儿童试玩氛围',
    category: '情感',
    channel: 'Emotion',
    hint: '快乐试玩氛围（勿生成可识别真童模）',
    whyItWorks: '玩具要「快乐可感知」，但合规上避免可识别儿童肖像；手部/虚化更安全。',
    defaultPrompt:
      'Joyful play-atmosphere product video focusing on the toy in motion, colorful safe play space, shallow depth of field, warm daylight, emphasize fun interaction with the product as hero, no readable child faces required, hands or silhouette OK, locked product identity, no watermark',
    storyboardZh:
      '玩具进入画面 → 互动玩法特写 {p1} → 氛围（虚化/手部）→ 产品英雄角定格',
    negativeHints:
      'recognizable celebrity child, unsafe play, dark scary mood, morphing product, watermark',
    qaChecklist: ['产品是视觉中心', '氛围积极安全', '无可识别真童脸'],
    aspectHint: '9:16 / 1:1',
    defaultAspect: '9:16',
    defaultDurationSec: 8,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'booth_loop',
    label: '展会循环片',
    category: '展会',
    channel: 'Booth',
    hint: '无声也可懂；首尾近同帧；过道 3 秒钩住',
    whyItWorks:
      '展台观众任意时刻切入：每段自洽、首尾可接、禁止片头黑场，循环才不穿帮。',
    defaultPrompt:
      'Silent-friendly exhibition booth loop video for toy or gift fair screen, bold product beauty shots, slow elegant moves, high contrast for bright hall lighting, self-contained beats, seamless loop ending near starting frame, no watermark, minimal baked text, no logo intro sting',
    storyboardZh:
      '0–3s 视觉钩子（产品在动）→ 3–8s 品类/外形 → 8–14s 证明 {p1} → 收束回到接近开场的英雄角（可无缝循环）',
    negativeHints:
      'fast seizure cuts, tiny unreadable text, black end card, hard motion stop, watermark, long logo intro',
    qaChecklist: ['可无声理解', '结尾接近开场可循环', '高亮度场合仍清晰'],
    aspectHint: '16:9',
    defaultAspect: '16:9',
    defaultDurationSec: 10,
    sellingPointSlots: 1,
    preferImage: true,
  },
  {
    id: 'b2b_buyer',
    label: '采购商 15 秒介绍',
    category: 'B2B',
    channel: 'Buyer',
    hint: '给进口商/买手：外观→机制→场景；偏样品说服',
    whyItWorks:
      'B2B 要的是「能不能卖、好不好解释」；机制证明 + 零售场景，比品牌广告片有效。',
    defaultPrompt:
      'B2B buyer product introduction video for toy/gift importers, clear exterior, mechanism proof, retail or use context, professional catalog lighting, locked SKU identity, muted-friendly, concise commercial pacing, no watermark, no hype claims',
    storyboardZh:
      '0–3s 外观英雄角 → 3–8s 机制/卖点 {p1} → 8–12s 零售或使用场景 → 12–15s 整机+包装可读收尾',
    negativeHints:
      'consumer hype slang only, morphing product, fake certificates, watermark, cluttered booth nonsense',
    qaChecklist: ['买手 15 秒能懂品类', '机制可见', '包装朝向专业'],
    aspectHint: '16:9',
    defaultAspect: '16:9',
    defaultDurationSec: 12,
    sellingPointSlots: 2,
    preferImage: true,
  },
  {
    id: 'free',
    label: '自由分镜',
    category: '通用',
    channel: 'Custom',
    hint: '完全按你的分镜与提示词执行',
    whyItWorks: '给熟练用户保留完整控制。',
    defaultPrompt: '',
    storyboardZh: '',
    negativeHints: 'watermark, morphing, extra limbs, identity drift',
    qaChecklist: ['符合你的分镜描述', '产品身份一致'],
    aspectHint: '自定义',
    defaultAspect: '16:9',
    defaultDurationSec: 5,
    sellingPointSlots: 3,
    preferImage: false,
  },
];

export const getVideoSkill = (id: VideoSkillId | string): VideoSkillDef =>
  VIDEO_SKILLS.find((s) => s.id === id) || VIDEO_SKILLS[0];
