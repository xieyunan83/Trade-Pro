/**
 * 产品视频 Skills：玩具/礼品跨境电商与展会演示的专业分镜规格（内置，非联网抓取）。
 * 对标行业常用：开箱、功能演示、货架陈列、短视频钩子、展会循环片。
 */

export type VideoSkillId =
  | 'hero_orbit'
  | 'feature_demo'
  | 'unbox_hook'
  | 'shelf_lifestyle'
  | 'kids_play'
  | 'booth_loop'
  | 'free';

export type VideoSkillDef = {
  id: VideoSkillId;
  label: string;
  category: string;
  hint: string;
  /** 写入提示词 / 分镜的英文底稿 */
  defaultPrompt: string;
  /** 中文分镜模板，填入 UI 分镜框 */
  storyboardZh: string;
  negativeHints: string;
  qaChecklist: string[];
  aspectHint: string;
};

export const VIDEO_SKILLS: VideoSkillDef[] = [
  {
    id: 'hero_orbit',
    label: '产品环绕主片',
    category: '电商',
    hint: '慢速环绕 / 推近，独立站与亚马逊 A+ 视频主视觉',
    defaultPrompt:
      'Cinematic product hero video of the toy, slow 360 orbit then gentle push-in, soft three-point studio lighting, seamless white or soft gradient cyclorama, sharp macro detail on materials, commercial ecommerce hero, locked product identity for entire clip, no watermark, no on-screen text unless specified',
    storyboardZh:
      '0–2s 正面定格 → 2–6s 缓慢环绕展示外形与配色 → 6–8s 推近关键细节（按键/开窗/材质）→ 8–10s 回到英雄角收尾',
    negativeHints:
      'jitter, morphing, identity drift, extra limbs, blurry logo, watermark, stock lower-third spam, melting plastics, frame-to-frame redesign',
    qaChecklist: [
      '产品外形与参考图一致，无变形',
      '运镜平滑，无明显抖动或闪烁',
      '背景干净，适合裁切主视频',
    ],
    aspectHint: '16:9 / 1:1',
  },
  {
    id: 'feature_demo',
    label: '功能卖点演示',
    category: 'Listing',
    hint: '每 2–3 秒一个卖点动作，适合 Listing 主视频',
    defaultPrompt:
      'Product feature demo video for marketplace listing, clear beat-by-beat demonstrations of toy functions, bright even softbox lighting, readable motion, kid-safe playful energy without chaos, commercial clarity, same SKU look in every beat, no watermark',
    storyboardZh:
      '镜头1 开箱/亮相 → 镜头2 核心玩法演示 → 镜头3 安全/易用细节 → 镜头4 多件/配件展示 → 镜头5 收尾号召（静帧可叠卖点）',
    negativeHints:
      'chaotic cuts, unreadable action, dark underexposure, fake UI overlays, morphing product, identity drift',
    qaChecklist: ['每个卖点动作可看清', '节奏适合 15–30 秒 Listing', '无乱码字幕'],
    aspectHint: '1:1 / 16:9',
  },
  {
    id: 'unbox_hook',
    label: '开箱钩子短视频',
    category: '社媒',
    hint: '前 1 秒抓眼，适合 TikTok / Reels / 短视频投流',
    defaultPrompt:
      'Short-form unboxing hook video, first-frame curiosity reveal, satisfying package open, product pop against clean backdrop, vertical framing friendly, high retention pacing, social commerce aesthetic, no watermark',
    storyboardZh:
      '0–1s 悬念特写（盒面/剪影）→ 1–4s 开盖/撕膜爽感 → 4–8s 产品亮相+快速玩法 → 8–12s 笑脸/完结卡（可后加字幕）',
    negativeHints: 'slow boring open, messy desk clutter, shaky handheld extreme',
    qaChecklist: ['前 1 秒有钩子', '竖屏构图主体居中', '开箱动作完整'],
    aspectHint: '9:16',
  },
  {
    id: 'shelf_lifestyle',
    label: '货架 / 生活场景',
    category: '零售',
    hint: '商超货架或客厅场景，给买家「上架想象」',
    defaultPrompt:
      'Retail shelf and lifestyle product video, toy on supermarket shelf then cut to cozy living-room play context, natural window light plus soft fill, aspirational but realistic for mass retail, no watermark',
    storyboardZh:
      '货架陈列推镜 → 手取产品 → 切客厅/桌面场景演示 → 回到包装正面收尾',
    negativeHints: 'empty unrealistic CGI shelf only, brand-infringing competitor packs in focus',
    qaChecklist: ['场景真实可信', '包装朝向可读', '无竞品侵权特写'],
    aspectHint: '16:9',
  },
  {
    id: 'kids_play',
    label: '儿童试玩氛围',
    category: '情感',
    hint: '快乐试玩氛围（注意：生成图/视频勿用可识别真童模侵权素材）',
    defaultPrompt:
      'Joyful kids play atmosphere product video focusing on the toy in motion, colorful safe play space, shallow depth of field, warm daylight, emphasize fun interaction with the product as hero, no readable faces required, no watermark',
    storyboardZh:
      '玩具进入画面 → 互动玩法特写 → 表情/笑声氛围（可用虚化或手部）→ 产品英雄角定格',
    negativeHints: 'recognizable celebrity child, unsafe play, dark scary mood',
    qaChecklist: ['产品始终是视觉中心', '氛围积极安全', '无不当内容'],
    aspectHint: '9:16 / 1:1',
  },
  {
    id: 'booth_loop',
    label: '展会循环片',
    category: '展会',
    hint: '无声也可懂的循环演示，适合展台屏',
    defaultPrompt:
      'Silent-friendly exhibition loop video for toy booth screen, bold product beauty shots, slow elegant moves, high contrast for bright hall lighting, seamless loop ending near starting frame, no watermark, minimal text',
    storyboardZh:
      '英雄角 → 三点细节 → 功能一瞥 → 包装/系列 → 回到英雄角（可无缝循环）',
    negativeHints: 'fast seizure cuts, tiny unreadable text, watermark',
    qaChecklist: ['可无声理解', '结尾可循环', '高亮度场合仍清晰'],
    aspectHint: '16:9',
  },
  {
    id: 'free',
    label: '自由分镜',
    category: '通用',
    hint: '完全按你的分镜与提示词执行',
    defaultPrompt: '',
    storyboardZh: '',
    negativeHints: 'watermark, morphing, extra limbs',
    qaChecklist: ['符合你的分镜描述', '产品身份一致'],
    aspectHint: '自定义',
  },
];
