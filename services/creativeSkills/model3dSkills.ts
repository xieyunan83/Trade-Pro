/**
 * 产品 3D Skills：图生/文生网格的专业规格（内置行业最佳实践，非联网抓取）。
 */

export type Model3dSkillId =
  | 'turntable_hero'
  | 'toy_figure'
  | 'pack_mock_volume'
  | 'hard_surface_mech'
  | 'soft_plush'
  | 'print_ready'
  | 'free';

export type Model3dSkillDef = {
  id: Model3dSkillId;
  label: string;
  category: string;
  hint: string;
  defaultPrompt: string;
  negativeHints: string;
  qaChecklist: string[];
  /** 建议品质档 */
  qualityHint: 'high_detail' | 'engine_ready';
};

export const MODEL3D_SKILLS: Model3dSkillDef[] = [
  {
    id: 'turntable_hero',
    label: '电商转台精品',
    category: '电商',
    hint: '干净拓扑感、可转台展示，适合独立站 3D / AR 预览',
    defaultPrompt:
      'High-quality product 3D asset of the toy, clean silhouette, accurate proportions from reference, subtle bevels, PBR-friendly materials, centered on ground plane, studio turntable ready, no floating debris',
    negativeHints: 'broken topology, melted geometry, extra limbs, blurry logo emboss, scene props clutter',
    qaChecklist: ['比例与参考一致', '底部可放稳', '无明显破面'],
    qualityHint: 'high_detail',
  },
  {
    id: 'toy_figure',
    label: '玩具人仔 / 角色',
    category: '潮玩',
    hint: '关节与头部比例可读，适合潮玩/盲盒角色',
    defaultPrompt:
      'Stylized collectible toy figure 3D model, readable silhouette, consistent character proportions, smooth plastic toy finish, slight stylization suitable for blind-box / designer toy, clean mesh',
    negativeHints: 'hyperreal skin pores, uncanny face, clothing cloth sim mess, extra fingers',
    qaChecklist: ['剪影可识别角色', '无多余肢体', '表面适合喷漆/注塑观感'],
    qualityHint: 'high_detail',
  },
  {
    id: 'pack_mock_volume',
    label: '包装体积块',
    category: '包装',
    hint: '彩盒/开窗盒体积示意，供包装视觉与陈列预演',
    defaultPrompt:
      'Simple accurate packaging volume 3D mockup (box / window box), correct aspect ratio, clean cardboard edges, optional clear window plane, retail pack proportion, minimal logos as flat decals if needed',
    negativeHints: 'warped box, non-manifold edges, random stickers spam',
    qaChecklist: ['长宽高比例可信', '开窗位置合理', '可导出给包装平面贴图'],
    qualityHint: 'engine_ready',
  },
  {
    id: 'hard_surface_mech',
    label: '硬表面机甲/车',
    category: '结构',
    hint: '硬边、板件、车体等硬表面玩具',
    defaultPrompt:
      'Hard-surface toy vehicle or mech 3D model, crisp panel lines, solid plastic/metal toy materials, accurate wheels or limbs from reference, clean boolean-like forms without mesh noise',
    negativeHints: 'organic mush, soft blurry edges, asymmetric wheels, missing axles',
    qaChecklist: ['硬边清晰', '对称件对齐', '无漂浮零件'],
    qualityHint: 'high_detail',
  },
  {
    id: 'soft_plush',
    label: '毛绒 / 软体',
    category: '毛绒',
    hint: '圆润体积与缝线暗示，避免过度真实毛发噪点',
    defaultPrompt:
      'Soft plush toy 3D model, rounded volumes, subtle seam suggestions, fabric-like shading without heavy hair cards, cute proportions, clean closed mesh',
    negativeHints: 'photoreal animal fur chaos, holes in mesh, scary realism',
    qaChecklist: ['体积圆润可爱', '封闭网格', '适合渲染展示'],
    qualityHint: 'high_detail',
  },
  {
    id: 'print_ready',
    label: '打印预备',
    category: '打印',
    hint: '更偏实心、可支撑的打印向（后续接打印模块）',
    defaultPrompt:
      '3D print oriented toy model, manifold-friendly solid feel, slightly thickened thin parts, stable base, minimal tiny overhang spikes, clean watertight intent',
    negativeHints: 'paper-thin walls, non-manifold spikes, disconnected shells',
    qaChecklist: ['无明显薄片', '可站立', '适合后续 STL 检查'],
    qualityHint: 'engine_ready',
  },
  {
    id: 'free',
    label: '自由描述',
    category: '通用',
    hint: '完全按你的文字与参考图生成',
    defaultPrompt: '',
    negativeHints: 'broken mesh, extra limbs, watermark floating text',
    qaChecklist: ['符合描述', '可下载预览'],
    qualityHint: 'high_detail',
  },
];
