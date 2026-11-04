import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Plus,
  FolderOpen,
  LayoutGrid,
  Send,
  Loader2,
  Download,
  AlertTriangle,
  CheckCircle2,
  Package,
  ImagePlus,
  X,
  Trash2,
  Check,
  BookTemplate,
} from 'lucide-react';
import type { User } from '../types';
import { ModuleType } from '../types';
import {
  DESIGN_SKILLS,
  type DesignAsset,
  type DesignProject,
  type DesignSkillId,
  loadDesignAssets,
  loadDesignProjects,
  newDesignId,
  saveDesignAssets,
  saveDesignProjects,
} from '../services/designAgentStore';
import {
  generateDesignImages,
  MAX_DESIGN_REF_IMAGES,
  generateMultiAngleDesignImages,
  getDesignAgentConfigStatus,
} from '../services/designAgentService';
import { planCreativeBrief } from '../services/creativeAgent/runtime';
import type { CreativeBrief } from '../services/creativeAgent/types';
import { composeImageGenerationPrompt } from '../services/creativeQualityKit';
import { runMarketingCopyPipeline } from '../services/creativeMarketingCopyPipeline';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { compressImageDataUrl } from '../services/catalogExcelService';
import { setCreativeHandoff } from '../services/creativeAssetBridge';
import { persistDesignAssets, purgeDeletedCreativeMedia } from '../services/creativeAssetPersist';
import {
  applyPackNegative,
  applyPackStyleToPrompt,
  ensureEnterprisePacksSeeded,
  getActiveEnterprisePack,
  mergeRefsWithPack,
  packCraftNotes,
  packImpliesLayoutLastRef,
  type EnterpriseDesignPack,
} from '../services/enterpriseDesignPacks';
import {
  DEFAULT_SECONDARY_FIELDS,
  SECONDARY_CREATION_NEGATIVE,
  buildSecondaryCreationEditEnglish,
  buildSecondaryCreationUserBrief,
  secondaryFieldsHaveEdits,
  type SecondaryCreationFields,
} from '../services/secondaryCreationBrief';
import { CreativePipelineBar } from './CreativeRefPicker';
import { DesignConstraintCardPanel } from './DesignConstraintCardPanel';
import { CreativeStorageBadge } from './CreativeStorageBadge';
import { EnterpriseDesignPackPanel } from './EnterpriseDesignPackPanel';
import { SecondaryCreationPanel } from './SecondaryCreationPanel';
import { VaultImg } from './VaultMedia';
import { loadProductCatalog } from '../services/productCatalog';
import {
  buildDesignConstraintCard,
  designConstraintToPromptNote,
} from '../services/designConstraintCard';
import { loadTradeJourney } from '../services/tradeJourney';

type Props = {
  currentUser: User;
  onNavigateModule?: (mod: ModuleType) => void;
};

type LeftTab = 'projects' | 'skills' | 'packs' | 'assets';

/**
 * 产品设计 · 平面图：
 * Skills + 结构化 Brief（可插拔大脑）+ 确认后生图 + 画布资产
 */
export const ModuleProductDesign2D: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [projects, setProjects] = useState<DesignProject[]>(() => loadDesignProjects());
  const [assets, setAssets] = useState<DesignAsset[]>(() => loadDesignAssets());
  const [activeId, setActiveId] = useState<string | null>(projects[0]?.id || null);
  /** 默认落在「模板」，避免新功能藏在 Skills 里找不到 */
  const [leftTab, setLeftTab] = useState<LeftTab>('packs');
  const [prompt, setPrompt] = useState('');
  /** 负向约束：选 Skill 时预填，可自行增删；生成时还会合并全站通用拒绝项 */
  const [negativePrompt, setNegativePrompt] = useState(
    () => DESIGN_SKILLS.find((s) => s.id === 'product_hero')?.negativePrompt || ''
  );
  const [skillId, setSkillId] = useState<DesignSkillId>('product_hero');
  const [size, setSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [count, setCount] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBrief, setPendingBrief] = useState<CreativeBrief | null>(null);
  const [planning, setPlanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuPick, setSkuPick] = useState('');
  /** 用户上传的参考图（data URL），可与文字描述组合图生图；最多 9 张 */
  const [refUploads, setRefUploads] = useState<string[]>([]);
  /** 末张为版式/海报方案参考（仅用户勾选或企业模板时生效；多品技能不再默认把末张当版式） */
  const [lastRefIsLayout, setLastRefIsLayout] = useState(false);
  const [refBusy, setRefBusy] = useState(false);
  /** 画布多选：用于删除 / 推送到下游模块 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activePack, setActivePack] = useState<EnterpriseDesignPack | null>(null);
  /** 核心：结构化二次创作（默认） / 自由提示词 */
  const [agentMode, setAgentMode] = useState<'secondary' | 'free'>('secondary');
  const [secondaryFields, setSecondaryFields] = useState<SecondaryCreationFields>(
    () => ({ ...DEFAULT_SECONDARY_FIELDS })
  );
  const refInputRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const status = getDesignAgentConfigStatus();

  useEffect(() => {
    ensureEnterprisePacksSeeded();
    setActivePack(getActiveEnterprisePack());
  }, []);

  const resolveSkuForSecondary = () => {
    const s = skus.find((x) => x.id === skuPick || x.skuCode === skuPick);
    return {
      name: s?.name || active?.skuName,
      code: s?.skuCode || active?.skuCode,
    };
  };

  /** 二次创作最终用户改动清单（结构化优先，否则用自由提示词） */
  const resolveEditBrief = (): string => {
    const layoutMode = lastRefIsLayout || packImpliesLayoutLastRef(activePack);
    const layoutSwapZh =
      '【版式换品】末张是版式/海报模板：只借构图、色块、字体层级与装饰；必须把前面产品参考图换入成图；禁止复刻模板里的原商品（毛绒/字母罐等样本货）。';
    const multiProductZh =
      skillId === 'multi_product_poster' && !layoutMode
        ? '【多产品整合】上传的每张产品图都是独立 SKU，成图必须全部出现，禁止只画其中一张。'
        : '';
    if (agentMode === 'secondary' && secondaryFieldsHaveEdits(secondaryFields)) {
      const meta = resolveSkuForSecondary();
      return [
        buildSecondaryCreationUserBrief(secondaryFields, {
          skuName: meta.name,
          skuCode: meta.code,
        }),
        buildSecondaryCreationEditEnglish(secondaryFields),
        layoutMode ? layoutSwapZh : '',
        multiProductZh,
        prompt.trim() && !prompt.includes('【产品二次创作')
          ? `补充：${prompt.trim()}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    const base = prompt.trim();
    return [layoutMode ? layoutSwapZh : '', multiProductZh, base].filter(Boolean).join('\n');
  };

  const active = projects.find((p) => p.id === activeId) || null;
  const canvasAssets = useMemo(
    () => assets.filter((a) => a.projectId === activeId),
    [assets, activeId]
  );
  const selectedAssets = useMemo(
    () => canvasAssets.filter((a) => selectedIds.includes(a.id)),
    [canvasAssets, selectedIds]
  );

  /** 画布产品图可直接作二次创作参考：优先已选中，否则用当前画布图（正面角优先） */
  const canvasProductRefUrls = useMemo(() => {
    const pool = selectedAssets.length ? selectedAssets : canvasAssets;
    const rank = (ang?: string) => {
      if (!ang) return 9;
      if (/正面|front/i.test(ang)) return 0;
      if (/45|四分/i.test(ang)) return 1;
      if (/侧面|side/i.test(ang)) return 2;
      if (/背面|back/i.test(ang)) return 3;
      return 5;
    };
    return [...pool]
      .sort((a, b) => rank(a.angle) - rank(b.angle))
      .map((a) => a.url)
      .filter(Boolean);
  }, [selectedAssets, canvasAssets]);

  React.useEffect(() => {
    setSelectedIds([]);
  }, [activeId]);

  const persistProjects = (next: DesignProject[]) => {
    setProjects(next);
    saveDesignProjects(next);
  };
  const persistAssets = (next: DesignAsset[]) => {
    setAssets(next);
    saveDesignAssets(next);
  };

  /** 启动时：把仍挂临时外链 / dataURL 的图迁入本机 IndexedDB */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = loadDesignAssets();
        const migrated = await persistDesignAssets(raw);
        if (cancelled) return;
        saveDesignAssets(migrated);
        setAssets(migrated);
      } catch (e) {
        console.warn('design assets migrate', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const skill = DESIGN_SKILLS.find((s) => s.id === skillId) || DESIGN_SKILLS[0];

  const createProject = (sid: DesignSkillId = skillId) => {
    const sk = DESIGN_SKILLS.find((s) => s.id === sid) || DESIGN_SKILLS[0];
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const proj: DesignProject = {
      id: newDesignId('dp'),
      title: sku ? `${sku.skuCode} · ${sk.label}` : `新项目 · ${sk.label}`,
      skillId: sid,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      messages: [
        {
          id: newDesignId('m'),
          role: 'agent',
          text: `你好，我是产品设计助手。请选择 Skill、上传产品参考图并描述需求；系统会锁定产品身份、叠加负向约束与质检项，确认后生成。当前 Skill「${sk.label}」：${sk.hint}`,
          at: now,
        },
      ],
      assetIds: [],
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
      createdAt: now,
      updatedAt: now,
    };
    persistProjects([proj, ...projects]);
    setActiveId(proj.id);
    setSkillId(sid);
    setLeftTab('projects');
    if (sk.defaultPrompt) setPrompt(sk.defaultPrompt);
    setNegativePrompt(sk.negativePrompt || '');
    // 多品技能：默认全部上传图都是产品；仅套用企业模板或用户勾选时末张才当版式
    if (sid === 'multi_product_poster' && !packImpliesLayoutLastRef(activePack)) {
      setLastRefIsLayout(false);
    }
  };

  const resolveSkuMeta = () => {
    const fromActive = active?.skuCode
      ? { code: active.skuCode, name: active.skuName }
      : null;
    if (fromActive?.code) return fromActive;
    const s = skus.find((x) => x.id === skuPick || x.skuCode === skuPick);
    return s ? { code: s.skuCode, name: s.name } : { code: undefined, name: undefined };
  };

  const buildFinalPrompt = (refCountOverride?: number, layoutOverride?: boolean) => {
    if (pendingBrief?.toolPrompt) return pendingBrief.toolPrompt;
    const skuMeta = resolveSkuMeta();
    const skuRow = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const hasRefs =
      refUploads.length > 0 ||
      canvasProductRefUrls.length > 0 ||
      !!(skuRow?.images?.length) ||
      !!(activePack?.layoutRefs?.length);
    const refCountHint =
      refCountOverride ??
      Math.max(
        refUploads.length +
          canvasProductRefUrls.length +
          (activePack?.layoutRefs?.length || 0),
        hasRefs ? Math.min(skuRow?.images?.length || 0, MAX_DESIGN_REF_IMAGES) : 0
      );
    const layoutLast = layoutOverride ?? (effectiveLastIsLayout && refCountHint >= 2);
    const composed = composeImageGenerationPrompt({
      skillDefaultPrompt:
        skill.defaultPrompt || 'Create a polished commercial product design visual',
      craftNotes: [skill.craftNotes, packCraftNotes(activePack)].filter(Boolean).join('\n'),
      userBrief: prompt.trim(),
      skuName: skuMeta.name,
      skuCode: skuMeta.code,
      hasReferenceImages: hasRefs,
      referenceCount: refCountHint || (hasRefs ? 1 : 0),
      lastRefIsLayout: layoutLast,
      distinctProducts: skillId === 'multi_product_poster' && !layoutLast,
      skillNegative: applyPackNegative(
        negativePrompt.trim() || skill.negativePrompt,
        activePack
      ),
      series: skillId === 'listing_set',
    }).prompt;
    return applyPackStyleToPrompt(composed, activePack);
  };

  const requestGenerate = async () => {
    if (!status.configured) {
      setError(status.detail);
      return;
    }
    if (!active) {
      createProject(skillId);
    }
    setError(null);
    const skuRowEarly = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const hasRefsEarly =
      refUploads.length > 0 ||
      canvasProductRefUrls.length > 0 ||
      !!(skuRowEarly?.images?.length);
    if (!hasRefsEarly) {
      setError(
        '请先：上传参考图、从产品库选带图 SKU，或在画布勾选已生成的产品图，再填写包装/颜色/外观改动。'
      );
      return;
    }
    const editBriefCheck = resolveEditBrief();
    if (!editBriefCheck.trim()) {
      setError(
        agentMode === 'secondary'
          ? '请在「产品二次创作」中至少填写一项改动（包装、颜色、外观等），或切换到自由指令。'
          : '请写明二次创作要求，例如：包装改红色、去掉某配件、增加灯光功能等。'
      );
      return;
    }
    if (agentMode === 'secondary' && secondaryFieldsHaveEdits(secondaryFields)) {
      const meta = resolveSkuForSecondary();
      setPrompt(
        buildSecondaryCreationUserBrief(secondaryFields, {
          skuName: meta.name,
          skuCode: meta.code,
        })
      );
    }
    setPlanning(true);
    try {
      const skuMeta = resolveSkuMeta();
      const skuRow = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
      const hasRefs =
        refUploads.length > 0 ||
        canvasProductRefUrls.length > 0 ||
        !!(skuRow?.images?.length);
      let marketNote = '';
      try {
        const profiles = await loadProductCatalog();
        const journey = loadTradeJourney();
        const card = buildDesignConstraintCard({
          categoryOrName: skuRow?.category || skuMeta.name || prompt.trim() || '玩具',
          targetMarket: journey.targetMarket || undefined,
          profiles,
          ourFactoryCny:
            skuRow?.factoryPrice != null && skuRow.factoryPrice > 0
              ? skuRow.currency === 'USD'
                ? skuRow.factoryPrice * 7.2
                : skuRow.currency === 'EUR'
                  ? skuRow.factoryPrice * 7.8
                  : skuRow.factoryPrice
              : undefined,
        });
        marketNote = designConstraintToPromptNote(card);
      } catch {
        /* 约束卡失败不阻断设计 */
      }
      const previewProj = ensureProject();
      const previewRefs = collectRefImagesDetailed(previewProj);
      const layoutLast =
        previewRefs.lastRefIsLayout ||
        (lastRefIsLayout && previewRefs.refs.length >= 2);
      const copyPlan = await runMarketingCopyPipeline({
        productName: skuMeta.name || skuRow?.name,
        skuCode: skuMeta.code || skuRow?.skuCode,
        category: skuRow?.category,
        specs: skuRow?.specs,
        userHighlight: resolveEditBrief(),
        locale: 'en',
        seedLines: [skuMeta.name || '', skuMeta.code ? `Model ${skuMeta.code}` : ''].filter(
          Boolean
        ),
        onProgress: (msg) => setError(msg),
      });
      const brief = await planCreativeBrief({
        domain: 'design_2d',
        skillId,
        skillLabel: skill.label,
        skillHint: skill.hint,
        skillDefaultPrompt: applyPackStyleToPrompt(skill.defaultPrompt, activePack),
        skillNegativePrompt: applyPackNegative(
          [
            negativePrompt.trim() || skill.negativePrompt,
            agentMode === 'secondary' ? SECONDARY_CREATION_NEGATIVE : '',
          ]
            .filter(Boolean)
            .join(', '),
          activePack
        ),
        skillCraftNotes: [
          skill.craftNotes,
          packCraftNotes(activePack),
          hasRefs
            ? '二次创作：以参考图为唯一外形真相；用户提示词仅为改动清单（颜色/部位/包装/功能等）；未提及处保持一致。禁止整体换模。'
            : '',
          skillId === 'multi_product_poster' && !layoutLast
            ? '多产品整合：每张产品参考图对应独立 SKU，成图必须全部出现，禁止只保留一张。'
            : '',
          agentMode === 'secondary'
            ? buildSecondaryCreationEditEnglish(secondaryFields)
            : '',
          '图面文字只能使用已校验白名单短句；禁止自由编造英文段落。',
        ]
          .filter(Boolean)
          .join('\n'),
        skillQaChecklist: [
          ...(skill.qaChecklist || []),
          '图面英文无乱码、无假词、仅白名单短句',
        ].slice(0, 8),
        userBrief: [
          hasRefs
            ? `【参考图二次创作·改动清单】\n${resolveEditBrief()}`
            : resolveEditBrief(),
          activePack
            ? `【企业模板】${activePack.name}（L1 ${activePack.layoutRefs.length} 页）`
            : '',
          marketNote,
          copyPlan.productSummaryZh
            ? `【文案方案】${copyPlan.productSummaryZh}${
                copyPlan.functions.length ? `；功能：${copyPlan.functions.join('、')}` : ''
              }`
            : '',
          copyPlan.approvedOnImageEn.length
            ? `【可上图英文】\n${copyPlan.approvedOnImageEn.join('\n')}`
            : '【可上图英文】无 — 图面禁止文字',
        ]
          .filter(Boolean)
          .join('\n'),
        skuCode: skuMeta.code,
        skuName: skuMeta.name,
        hasReferenceImages: hasRefs || previewRefs.refs.length > 0,
        referenceCount: previewRefs.refs.length || (hasRefs ? 1 : 0),
        lastRefIsLayout: layoutLast,
        distinctProducts: skillId === 'multi_product_poster' && !layoutLast,
        lockedOnImageCopy: copyPlan.approvedOnImageEn,
        onImageLockBlock: copyPlan.onImageLockBlock,
      });
      setPendingBrief({
        ...brief,
        lockedOnImageCopy: copyPlan.approvedOnImageEn,
        onImageLockBlock: copyPlan.onImageLockBlock,
        copyPlanSummaryZh: [
          copyPlan.productSummaryZh,
          copyPlan.approvedOnImageEn.length
            ? `上图：${copyPlan.approvedOnImageEn.join(' · ')}`
            : '上图：无文字',
        ]
          .filter(Boolean)
          .join('；'),
      });
      setError(null);
      setConfirmOpen(true);
    } catch (e: any) {
      setError(e?.message || '方案编排失败，请重试');
    } finally {
      setPlanning(false);
    }
  };

  const ensureProject = (): DesignProject => {
    const existing = projects.find((p) => p.id === activeId);
    if (existing) return existing;
    const sk = DESIGN_SKILLS.find((s) => s.id === skillId) || DESIGN_SKILLS[0];
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const proj: DesignProject = {
      id: newDesignId('dp'),
      title: sku ? `${sku.skuCode} · ${sk.label}` : `新项目 · ${sk.label}`,
      skillId,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      messages: [
        {
          id: newDesignId('m'),
          role: 'agent',
          text: `项目已创建。Skill「${sk.label}」就绪。`,
          at: now,
        },
      ],
      assetIds: [],
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
      createdAt: now,
      updatedAt: now,
    };
    const next = [proj, ...projects];
    persistProjects(next);
    setActiveId(proj.id);
    return proj;
  };

  const onPickRefFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setRefBusy(true);
    setError(null);
    try {
      const next = [...refUploads];
      const many = files.length + next.length >= 4;
      for (const file of Array.from(files)) {
        if (next.length >= MAX_DESIGN_REF_IMAGES) break;
        if (!file.type.startsWith('image/')) continue;
        const raw = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(file);
        });
        if (!raw.startsWith('data:image/')) continue;
        const compressed = await compressImageDataUrl(
          raw,
          many ? 768 : 1024,
          many ? 0.62 : 0.72
        );
        next.push(compressed);
      }
      setRefUploads(next.slice(0, MAX_DESIGN_REF_IMAGES));
    } catch (e: any) {
      setError(e?.message || '参考图处理失败');
    } finally {
      setRefBusy(false);
      if (refInputRef.current) refInputRef.current.value = '';
    }
  };

  const collectRefImagesDetailed = (
    proj: DesignProject
  ): { refs: string[]; lastRefIsLayout: boolean } => {
    const boundSku =
      skus.find((s) => s.id === skuPick || s.skuCode === skuPick) ||
      skus.find((s) => s.skuCode === proj.skuCode);
    const fromSku = (boundSku?.images || []).filter(Boolean);
    const layoutSet = new Set((activePack?.layoutRefs || []).filter(Boolean));
    const productMerged: string[] = [];
    // 上传 → 画布选中/生成图 → 产品库；排除版式样本 URL；末位留给 1 张 L1 版式
    const reserveLayout = activePack?.layoutRefs?.length ? 1 : 0;
    const productCap = Math.max(1, MAX_DESIGN_REF_IMAGES - reserveLayout);
    for (const u of [...refUploads, ...canvasProductRefUrls, ...fromSku]) {
      if (!u || productMerged.includes(u) || layoutSet.has(u)) continue;
      productMerged.push(u);
      if (productMerged.length >= productCap) break;
    }
    const merged = mergeRefsWithPack(
      productMerged,
      activePack,
      MAX_DESIGN_REF_IMAGES
    );
    // 仅：企业模板末张 / 用户勾选末张为版式。多品技能本身不再自动把末张当版式。
    const layoutLast =
      merged.lastRefIsLayout ||
      (lastRefIsLayout && merged.refs.length >= 2);
    return { refs: merged.refs, lastRefIsLayout: layoutLast };
  };

  const collectRefImages = (proj: DesignProject): string[] =>
    collectRefImagesDetailed(proj).refs;

  /** 把画布选中图写入右侧参考槽（可见、可删） */
  const useSelectedAsRefs = () => {
    const urls = selectedAssets.map((a) => a.url).filter(Boolean);
    if (!urls.length) {
      setError('请先在画布勾选要用作参考的产品图');
      return;
    }
    setRefUploads((prev) => {
      const next = [...prev];
      for (const u of urls) {
        if (next.includes(u)) continue;
        next.push(u);
        if (next.length >= MAX_DESIGN_REF_IMAGES) break;
      }
      return next.slice(0, MAX_DESIGN_REF_IMAGES);
    });
    setError(null);
  };

  const effectiveLastIsLayout =
    lastRefIsLayout || packImpliesLayoutLastRef(activePack);

  const runGenerate = async () => {
    setConfirmOpen(false);
    const proj = ensureProject();
    const collected = collectRefImagesDetailed(proj);
    const refImages = collected.refs;
    const layoutLast = collected.lastRefIsLayout;
    const finalPrompt =
      pendingBrief?.toolPrompt || buildFinalPrompt(refImages.length, layoutLast);
    const qaLine = pendingBrief?.qaChecklist?.length
      ? `\n质检关注：${pendingBrief.qaChecklist.slice(0, 3).join('；')}`
      : '';
    const packHint = activePack ? ` · 模板「${activePack.name}」` : '';
    const modeHint = refImages.length
      ? `参考图 ${refImages.length} 张 + 文字${packHint}`
      : `纯文字${packHint}`;
    const editBrief = resolveEditBrief();
    const userMsg = {
      id: newDesignId('m'),
      role: 'user' as const,
      text: editBrief || prompt.trim() || `使用 Skill「${skill.label}」生成（${modeHint}）`,
      at: Date.now(),
    };
    const mergedNeg = applyPackNegative(
      [
        negativePrompt.trim() || skill.negativePrompt,
        agentMode === 'secondary' ? SECONDARY_CREATION_NEGATIVE : '',
        skillId === 'multi_product_poster'
          ? 'dropping any product SKU, single-product-only poster when multiple product refs provided'
          : '',
      ]
        .filter(Boolean)
        .join(', '),
      activePack
    );
    const styledPrompt = applyPackStyleToPrompt(finalPrompt, activePack);

    setLoading(true);
    setError(null);
    try {
      let genRefs = refImages;
      if (refImages.length) {
        setError('正在抠出产品主体（去背景）…');
        const { ensureProductCutouts } = await import('../services/productCutoutService');
        genRefs = await ensureProductCutouts(refImages, {
          lastIsLayout: layoutLast,
          allowApi: true,
          onProgress: (msg) => setError(msg),
        });
        setError(null);
      }
      const isMulti = skillId === 'multi_angle' || !!pendingBrief?.multiAngle;
      const result = isMulti
        ? await generateMultiAngleDesignImages({
            prompt: styledPrompt,
            size,
            thinkingMode: false,
            referenceImages: genRefs.length ? genRefs : undefined,
            negativePrompt: mergedNeg,
            userEditBrief: editBrief,
            onProgress: (done, total, label) => {
              setError(null);
              void done;
              void total;
              void label;
            },
          })
        : await generateDesignImages({
            prompt: styledPrompt,
            size,
            n: count,
            thinkingMode: false,
            referenceImages: genRefs.length ? genRefs : undefined,
            negativePrompt: [
              mergedNeg,
              'white product cards, rounded photo frames, boxed thumbnails, studio white backdrop behind product',
            ]
              .filter(Boolean)
              .join(', '),
            series: skillId === 'listing_set' || count > 1,
            lastRefIsLayout: layoutLast,
            distinctProducts: skillId === 'multi_product_poster' && !layoutLast,
            lockedOnImageCopy: pendingBrief?.lockedOnImageCopy,
            onImageLockBlock: pendingBrief?.onImageLockBlock,
            userEditBrief: editBrief,
          });
      const now = Date.now();
      const newAssetsRaw: DesignAsset[] = result.images.map((url, i) => ({
        id: newDesignId('da'),
        projectId: proj.id,
        url,
        prompt: styledPrompt,
        skillId,
        angle: result.angles?.[i],
        createdAt: now,
      }));
      // 立刻落本机素材库，避免供应商临时链过期后画布裂图
      const newAssets = await persistDesignAssets(newAssetsRaw);
      const agentMsg = {
        id: newDesignId('m'),
        role: 'agent' as const,
        text: isMulti
          ? `已生成 ${newAssets.length} 张多角度套图（${(result.angles || []).join(' / ')}）。可点画布上「送去 3D / 视频」继续流水线。${qaLine}`
          : `已按确认方案生成 ${newAssets.length} 张并放到画布（${modeHint}）。可继续改稿，或送去 3D / 视频。${qaLine}`,
        at: now,
        assetIds: newAssets.map((a) => a.id),
      };
      persistAssets([...newAssets, ...loadDesignAssets().filter((a) => !newAssets.some((n) => n.id === a.id))]);
      const latest = loadDesignProjects();
      persistProjects(
        latest.map((p) =>
          p.id === proj.id
            ? {
                ...p,
                skillId,
                messages: [...p.messages, userMsg, agentMsg],
                assetIds: [...newAssets.map((a) => a.id), ...p.assetIds],
                updatedAt: now,
              }
            : p
        )
      );
      setPrompt('');
    } catch (e: any) {
      setError(e?.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const downloadUrl = async (url: string, idx: number) => {
    try {
      const { downloadMediaFile } = await import('../services/creativeAssetVault');
      await downloadMediaFile(url, `design-2d-${idx + 1}`);
    } catch (e: any) {
      setError(e?.message || '下载失败。请确认本机素材未清理后重试。');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllCanvas = () => {
    setSelectedIds(canvasAssets.map((a) => a.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const deleteAssetIds = (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`确定删除 ${ids.length} 张图片？删除后不可恢复。`)) return;
    const ban = new Set(ids);
    const removedUrls = assets.filter((a) => ban.has(a.id)).map((a) => a.url);
    persistAssets(assets.filter((a) => !ban.has(a.id)));
    persistProjects(
      projects.map((p) => ({
        ...p,
        assetIds: (p.assetIds || []).filter((id) => !ban.has(id)),
        updatedAt: Date.now(),
      }))
    );
    setSelectedIds((prev) => prev.filter((id) => !ban.has(id)));
    setError(null);
    void purgeDeletedCreativeMedia(removedUrls);
  };

  const sendAssetsTo = (
    target: 'design_3d' | 'ai_video' | 'packaging' | 'product_match',
    urls: string[],
    note?: string
  ) => {
    if (!urls.length && target !== 'product_match') {
      setError('请先勾选要推送的图片（可多选）');
      return;
    }
    const sku =
      skus.find((s) => s.id === skuPick || s.skuCode === skuPick) ||
      (active?.skuCode
        ? { skuCode: active.skuCode, name: active.skuName || active.skuCode }
        : null);
    const maxImgs = target === 'design_3d' ? 4 : target === 'packaging' ? 3 : 6;
    const sliced = urls.slice(0, maxImgs);
    setCreativeHandoff({
      images: sliced,
      skuCode: sku?.skuCode || active?.skuCode,
      skuName: (sku as any)?.name || active?.skuName || active?.title,
      note: note || active?.title,
      from: 'design_2d',
      target,
    });
    onNavigateModule?.(
      target === 'design_3d'
        ? ModuleType.PRODUCT_DESIGN_3D
        : target === 'packaging'
          ? ModuleType.PRODUCT_PACKAGING
          : target === 'product_match'
            ? ModuleType.PRODUCT_MATCH
            : ModuleType.PRODUCT_AI_VIDEO
    );
  };

  const sendSelectedTo = (target: 'design_3d' | 'ai_video' | 'packaging' | 'product_match') => {
    const urls = selectedAssets.map((a) => a.url);
    if (!urls.length && target !== 'product_match') {
      setError('请先勾选图片，再推送到下游模块');
      return;
    }
    const label =
      target === 'design_3d'
        ? '3D'
        : target === 'packaging'
          ? '包装'
          : target === 'product_match'
            ? '产品匹配'
            : '视频';
    const fallbackUrls =
      urls.length > 0
        ? urls
        : canvasAssets
            .slice(0, 2)
            .map((a) => a.url)
            .filter(Boolean);
    sendAssetsTo(target, fallbackUrls, `${active?.title || '平面项目'} → ${label}`);
  };

  return (
    <div className="max-w-[96rem] mx-auto animate-fade-in px-1 space-y-3">
      {/* 顶栏：标题 / 流水线 / 适市约束压成一行，主画布尽量露出来 */}
      <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 via-white to-cyan-50/50 px-3 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 text-violet-200 text-[9px] font-black uppercase tracking-widest px-2 py-0.5">
              <Sparkles size={10} /> 平面
            </span>
            <h2 className="text-base font-extrabold text-slate-900">产品设计 · 平面图</h2>
            <span
              className={`text-[10px] font-black ${status.configured ? 'text-emerald-700' : 'text-amber-700'}`}
            >
              {status.configured ? status.label : status.label}
            </span>
            <button
              type="button"
              onClick={() => setLeftTab('packs')}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-black px-2.5 py-1"
            >
              <BookTemplate size={11} /> 企业模板在这 · 点开一键套用
            </button>
          </div>
          <button
            type="button"
            onClick={() => createProject(skillId)}
            className="inline-flex items-center gap-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-black px-2.5 py-1.5"
          >
            <Plus size={12} /> 新建
          </button>
        </div>
        <CreativePipelineBar current="2d" onNavigate={onNavigateModule} />
        <DesignConstraintCardPanel
          compact
          categoryOrName={
            skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.category ||
            skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.name ||
            active?.skuName ||
            '玩具'
          }
          skuCode={
            skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.skuCode ||
            active?.skuCode
          }
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 min-h-[36rem]">
        {/* 左：Projects / Skills / Assets */}
        <aside className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white flex flex-col min-h-[20rem] overflow-hidden">
          <div className="flex border-b border-slate-100">
            {(
              [
                ['packs', '模板', BookTemplate],
                ['skills', 'Skills', Sparkles],
                ['projects', '项目', FolderOpen],
                ['assets', '资产', LayoutGrid],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeftTab(id)}
                className={`flex-1 py-2.5 text-[10px] sm:text-[11px] font-black flex items-center justify-center gap-0.5 sm:gap-1 relative ${
                  leftTab === id
                    ? id === 'packs'
                      ? 'text-amber-800 border-b-2 border-amber-500 bg-amber-50/80'
                      : 'text-violet-700 border-b-2 border-violet-600 bg-violet-50/50'
                    : id === 'packs'
                      ? 'text-amber-700 bg-amber-50/40'
                      : 'text-slate-400'
                }`}
              >
                <Icon size={12} /> {label}
                {id === 'packs' && (
                  <span className="absolute -top-0.5 right-1 text-[8px] font-black text-white bg-rose-500 rounded px-1 leading-4">
                    新
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {leftTab === 'projects' &&
              (projects.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold p-4 text-center">暂无项目，点「模板」或新建</p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setActiveId(p.id);
                      setSkillId(p.skillId);
                    }}
                    className={`w-full text-left rounded-xl px-3 py-2.5 text-xs font-bold border ${
                      activeId === p.id
                        ? 'border-violet-300 bg-violet-50 text-violet-900'
                        : 'border-transparent hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="truncate">{p.title}</div>
                    <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                      {p.assetIds.length} 资产 · {new Date(p.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                ))
              ))}
            {leftTab === 'skills' && (
              <>
                <button
                  type="button"
                  onClick={() => setLeftTab('packs')}
                  className="w-full text-left rounded-xl px-3 py-2.5 border border-amber-300 bg-amber-50 hover:bg-amber-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-amber-900 inline-flex items-center gap-1">
                      <BookTemplate size={12} /> 企业模板技能库
                    </span>
                    <span className="text-[9px] font-bold text-rose-600">新 · 点这里</span>
                  </div>
                  <p className="text-[10px] text-amber-800/80 font-medium mt-0.5 leading-snug">
                    目录封面 / 网格内页 / 功能卖点文案 · 一键套用
                  </p>
                </button>
                {DESIGN_SKILLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSkillId(s.id);
                      if (s.defaultPrompt) setPrompt(s.defaultPrompt);
                      setNegativePrompt(s.negativePrompt || '');
                      if (
                        s.id === 'multi_product_poster' &&
                        !packImpliesLayoutLastRef(activePack)
                      ) {
                        setLastRefIsLayout(false);
                      }
                    }}
                    onDoubleClick={() => createProject(s.id)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 border ${
                      skillId === s.id
                        ? 'border-violet-300 bg-violet-50'
                        : 'border-slate-100 hover:border-violet-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-800">{s.label}</span>
                      <span className="text-[9px] font-bold text-violet-600 uppercase">{s.category}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">{s.hint}</p>
                  </button>
                ))}
              </>
            )}
            {leftTab === 'packs' && (
              <EnterpriseDesignPackPanel
                skuName={
                  skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.name ||
                  active?.skuName
                }
                skuCode={
                  skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.skuCode ||
                  active?.skuCode
                }
                onActiveChange={(p) => {
                  setActivePack(p);
                  if (p && packImpliesLayoutLastRef(p)) {
                    setLastRefIsLayout(true);
                  }
                }}
                onFoolproofApply={(p, foolPrompt) => {
                  setActivePack(p);
                  if (p.skillHints?.[0] && DESIGN_SKILLS.some((s) => s.id === p.skillHints[0])) {
                    const sid = p.skillHints[0];
                    setSkillId(sid);
                    const sk = DESIGN_SKILLS.find((s) => s.id === sid);
                    if (sk?.negativePrompt) setNegativePrompt(sk.negativePrompt);
                  }
                  if (packImpliesLayoutLastRef(p)) setLastRefIsLayout(true);
                  setPrompt(foolPrompt);
                  setLeftTab('skills');
                  setError(null);
                }}
              />
            )}
            {leftTab === 'assets' &&
              (assets.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold p-4 text-center">生成后会出现在这里</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 p-1">
                  {assets.slice(0, 40).map((a) => (
                    <div
                      key={a.id}
                      className="relative aspect-square rounded-lg overflow-hidden border border-slate-100 group"
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(a.projectId)}
                        className="w-full h-full"
                      >
                        <VaultImg src={a.url} alt="" className="w-full h-full object-cover" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAssetIds([a.id]);
                        }}
                        className="absolute top-1 right-1 rounded-md bg-rose-600 text-white p-1 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </aside>

        {/* 中：Canvas */}
        <section className="xl:col-span-6 rounded-2xl border border-slate-200 bg-slate-50/80 flex flex-col min-h-[22rem] overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200/80 bg-white/80 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-black text-slate-700 truncate">
              {active ? `画布 · ${active.title}` : '画布 · 新建或选择项目'}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <CreativeStorageBadge compact />
              <div className="text-[10px] font-bold text-slate-400">
                {canvasAssets.length} 张
                {selectedIds.length ? ` · 已选 ${selectedIds.length}` : ''}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {canvasAssets.length === 0 ? (
              <div className="h-full min-h-[16rem] flex flex-col items-center justify-center text-center px-6">
                <div className="h-14 w-14 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center mb-3">
                  <Sparkles size={24} />
                </div>
                <p className="text-sm font-black text-slate-700">空画布</p>
                <p className="text-xs text-slate-500 font-medium mt-1 max-w-sm leading-relaxed">
                  选左侧 Skill → 下方描述需求 → 确认生成。也可挂接「产品库」SKU，让 Agent 围绕真实货号出图。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button
                    type="button"
                    onClick={selectAllCanvas}
                    className="text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={!selectedIds.length}
                    className="text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5 disabled:opacity-40"
                  >
                    取消选择
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAssetIds(selectedIds)}
                    disabled={!selectedIds.length}
                    className="text-[10px] font-black rounded-lg bg-rose-600 text-white px-2.5 py-1.5 inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <Trash2 size={11} /> 删除选中
                  </button>
                  <button
                    type="button"
                    onClick={useSelectedAsRefs}
                    disabled={!selectedIds.length}
                    className="text-[10px] font-black rounded-lg bg-emerald-600 text-white px-2.5 py-1.5 inline-flex items-center gap-1 disabled:opacity-40"
                    title="将勾选的生成图写入右侧参考槽，供二次创作"
                  >
                    <ImagePlus size={11} /> 选中 → 作参考
                  </button>
                  {onNavigateModule ? (
                    <>
                      <span className="text-[10px] text-slate-300 px-0.5">|</span>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('design_3d')}
                        disabled={!selectedIds.length}
                        className="text-[10px] font-black rounded-lg bg-indigo-600 text-white px-2.5 py-1.5 disabled:opacity-40"
                      >
                        选中 → 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('ai_video')}
                        disabled={!selectedIds.length}
                        className="text-[10px] font-black rounded-lg bg-rose-600 text-white px-2.5 py-1.5 disabled:opacity-40"
                      >
                        选中 → 视频
                      </button>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('packaging')}
                        disabled={!selectedIds.length}
                        className="text-[10px] font-black rounded-lg bg-amber-600 text-white px-2.5 py-1.5 disabled:opacity-40"
                      >
                        选中 → 包装
                      </button>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('product_match')}
                        className="text-[10px] font-black rounded-lg bg-emerald-600 text-white px-2.5 py-1.5"
                      >
                        → 产品匹配
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="text-[10px] text-slate-400 font-medium">
                  勾选后可「选中 → 作参考」做二次创作，或直接确认生成（会自动用选中/画布图作身份锁）。也可推送 3D / 视频 / 包装。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {canvasAssets.map((a, i) => {
                    const selected = selectedIds.includes(a.id);
                    return (
                      <div
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSelect(a.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleSelect(a.id);
                          }
                        }}
                        className={`rounded-xl overflow-hidden border shadow-sm bg-white group relative cursor-pointer ${
                          selected
                            ? 'border-violet-500 ring-2 ring-violet-200'
                            : 'border-white hover:border-violet-200'
                        }`}
                      >
                        <VaultImg
                          src={a.url}
                          alt=""
                          className="w-full aspect-square object-contain bg-slate-50 pointer-events-none"
                        />
                        <span
                          className={`absolute top-2 right-2 h-6 w-6 rounded-full border-2 flex items-center justify-center ${
                            selected
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-white/90 border-slate-300 text-transparent'
                          }`}
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                        {a.angle ? (
                          <span className="absolute top-2 left-2 rounded-md bg-slate-900/80 text-white text-[10px] font-black px-2 py-0.5">
                            {a.angle}
                          </span>
                        ) : null}
                        <div
                          className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => void downloadUrl(a.url, i)}
                            className="rounded-lg bg-slate-900/80 text-white p-1.5"
                            title="下载"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteAssetIds([a.id])}
                            className="rounded-lg bg-rose-600/95 text-white p-1.5"
                            title="删除"
                          >
                            <Trash2 size={12} />
                          </button>
                          {onNavigateModule ? (
                            <>
                              <button
                                type="button"
                                onClick={() => sendAssetsTo('design_3d', [a.url], a.angle)}
                                className="rounded-lg bg-indigo-600/95 text-white text-[9px] font-black px-2 py-1.5"
                              >
                                → 3D
                              </button>
                              <button
                                type="button"
                                onClick={() => sendAssetsTo('ai_video', [a.url], a.angle)}
                                className="rounded-lg bg-rose-600/95 text-white text-[9px] font-black px-2 py-1.5"
                              >
                                → 视频
                              </button>
                              <button
                                type="button"
                                onClick={() => sendAssetsTo('packaging', [a.url], a.angle)}
                                className="rounded-lg bg-amber-600/95 text-white text-[9px] font-black px-2 py-1.5"
                              >
                                → 包装
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* 对话摘要 */}
          {active && active.messages.length > 0 && (
            <div className="border-t border-slate-200 bg-white/90 max-h-28 overflow-y-auto px-3 py-2 space-y-1">
              {active.messages.slice(-4).map((m) => (
                <div
                  key={m.id}
                  className={`text-[11px] leading-snug ${
                    m.role === 'user' ? 'text-violet-800 font-bold' : 'text-slate-600 font-medium'
                  }`}
                >
                  {m.role === 'user' ? '你：' : 'Agent：'}
                  {m.text}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 右：二次创作 / Agent */}
        <aside className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 flex flex-col gap-3 max-h-[min(90vh,56rem)] overflow-y-auto custom-scrollbar">
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setAgentMode('secondary')}
              className={`flex-1 py-2 text-[11px] font-black ${
                agentMode === 'secondary'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-50 text-slate-500'
              }`}
            >
              二次创作
            </button>
            <button
              type="button"
              onClick={() => setAgentMode('free')}
              className={`flex-1 py-2 text-[11px] font-black ${
                agentMode === 'free'
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-50 text-slate-500'
              }`}
            >
              自由指令
            </button>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
              <Package size={10} /> ① 产品库挑图（或下方上传）
            </label>
            <select
              className="w-full mt-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
              value={skuPick}
              onChange={(e) => setSkuPick(e.target.value)}
            >
              <option value="">不绑定 · 请上传参考图</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.skuCode} · {s.name}
                  {s.images?.length ? ' · 有图' : ''}
                </option>
              ))}
            </select>
            {(() => {
              const s = skus.find((x) => x.id === skuPick);
              const img0 = s?.images?.[0];
              if (!img0 || /toysbear\.net/i.test(img0)) return null;
              return (
                <div className="mt-2 flex items-center gap-2">
                  <img
                    src={img0}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover border border-emerald-200"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <span className="text-[10px] font-bold text-emerald-800">
                    将以此产品图为身份锁，做局部再设计
                  </span>
                </div>
              );
            })()}
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">当前 Skill</label>
            <div className="mt-1 text-sm font-black text-violet-800">{skill.label}</div>
            <div className="text-[10px] text-slate-500">{skill.aspectHint}</div>
            {activePack && (
              <button
                type="button"
                onClick={() => setLeftTab('packs')}
                className="mt-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1"
              >
                模板：{activePack.name}
                {activePack.layoutRefs.length
                  ? ` · L1 ${activePack.layoutRefs.length}`
                  : ' · L2 风格'}
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
              <ImagePlus size={10} /> ② 参考图（最多 {MAX_DESIGN_REF_IMAGES} 张）
            </label>
            {canvasProductRefUrls.length > 0 && (
              <div className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-bold text-emerald-800">
                {selectedIds.length
                  ? `将使用画布选中 ${Math.min(selectedIds.length, MAX_DESIGN_REF_IMAGES)} 张作产品参考`
                  : `将使用画布已有 ${Math.min(canvasProductRefUrls.length, MAX_DESIGN_REF_IMAGES)} 张作产品参考`}
                {selectedIds.length ? (
                  <button
                    type="button"
                    onClick={useSelectedAsRefs}
                    className="ml-2 underline text-emerald-700"
                  >
                    写入参考槽
                  </button>
                ) : null}
              </div>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/bmp"
              multiple
              className="hidden"
              onChange={(e) => void onPickRefFiles(e.target.files)}
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              {refUploads.map((src, i) => {
                const isLayout =
                  effectiveLastIsLayout &&
                  refUploads.length >= 2 &&
                  i === refUploads.length - 1;
                return (
                  <div
                    key={`${i}-${src.slice(-24)}`}
                    className={`relative w-14 h-14 rounded-lg overflow-hidden border bg-slate-50 ${
                      isLayout ? 'border-amber-400 ring-1 ring-amber-200' : 'border-violet-200'
                    }`}
                  >
                    <img src={src} alt="" className="w-full h-full object-contain" />
                    <span className="absolute bottom-0 left-0 right-0 text-[7px] font-black text-center text-white bg-slate-900/75 py-0.5">
                      {isLayout ? '版式' : `产品${i + 1}`}
                    </span>
                    <button
                      type="button"
                      aria-label="移除参考图"
                      onClick={() => {
                        const removed = refUploads[i];
                        setRefUploads((prev) => prev.filter((_, j) => j !== i));
                        if (removed) void purgeDeletedCreativeMedia([removed]);
                      }}
                      className="absolute top-0.5 right-0.5 rounded-full bg-slate-900/80 text-white p-0.5"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
              {refUploads.length < MAX_DESIGN_REF_IMAGES && (
                <button
                  type="button"
                  disabled={refBusy || loading}
                  onClick={() => refInputRef.current?.click()}
                  className="w-14 h-14 rounded-lg border border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50"
                >
                  {refBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                  <span className="text-[8px] font-black">上传</span>
                </button>
              )}
            </div>
            <label className="mt-2 flex items-start gap-2 text-[10px] font-medium text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-slate-300"
                checked={effectiveLastIsLayout}
                disabled={packImpliesLayoutLastRef(activePack)}
                onChange={(e) => setLastRefIsLayout(e.target.checked)}
              />
              <span>
                最后一张为<strong className="text-violet-800">版式/海报模板</strong>
                （只借排版；前面产品图换入成图，
                <strong className="text-rose-700">不会复刻模板里的原商品</strong>）
              </span>
            </label>
            <p className="text-[9px] text-slate-400 font-medium mt-1 leading-relaxed">
              多品整合：默认每张上传图都是产品且必须入画；仅有独立版式图时再勾选末张为模板。
            </p>
          </div>

          {agentMode === 'secondary' ? (
            <SecondaryCreationPanel
              value={secondaryFields}
              onChange={setSecondaryFields}
              skuName={resolveSkuForSecondary().name}
              skuCode={resolveSkuForSecondary().code}
              onApplyToPrompt={(brief) => {
                setPrompt(brief);
                setError(null);
              }}
            />
          ) : (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="只写要改的：如「机身改哑光黑、包装盒改红金、加声光、去掉肩带」——未写的部位保持与参考图一致"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium resize-y min-h-[5rem]"
              />
              <p className="text-[9px] text-violet-700/90 font-medium -mt-1 leading-relaxed">
                自由指令仍走二次创作引擎：必须有参考图；只改点名项，禁止整体换模。
              </p>
            </>
          )}
          {agentMode === 'secondary' && prompt.trim() && (
            <details className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
              <summary className="text-[10px] font-bold text-slate-500 cursor-pointer">
                已写入的改动清单（可展开）
              </summary>
              <pre className="mt-1 text-[10px] text-slate-600 whitespace-pre-wrap font-medium">
                {prompt}
              </pre>
            </details>
          )}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                负向约束（不想出现的）
              </label>
              <button
                type="button"
                onClick={() => setNegativePrompt(skill.negativePrompt || '')}
                className="text-[9px] font-bold text-violet-600 hover:text-violet-800"
              >
                恢复 Skill 默认
              </button>
            </div>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="如：水印、乱码字、换色、多面板拼图…"
              className="w-full rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2 text-xs font-medium text-slate-700 resize-y"
            />
            <p className="text-[9px] text-slate-400 font-medium mt-1 leading-relaxed">
              选 Skill 会预填；可自行增删。系统仍会自动叠加通用拒绝项（水印/乱码/假认证等）。
            </p>
          </div>
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
              value={size}
              onChange={(e) => setSize(e.target.value as '1K' | '2K' | '4K')}
            >
              <option value="1K">1K（省额度）</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
            <select
              className="w-20 rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 张
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={loading || planning || !status.configured}
            onClick={() => void requestGenerate()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-black py-3"
          >
            {loading || planning ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {planning
              ? '正在编排方案…'
              : loading
                ? skillId === 'multi_angle'
                  ? '多角度生成中（约需数分钟）…'
                  : '生图中，约 1–2 分钟…'
                : skillId === 'multi_angle'
                  ? '确认生成多角度套图'
                  : '确认生成'}
          </button>
          <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
            {skillId === 'multi_angle'
              ? '多角度将连续生成 4 张（默认 1K），便于后续 3D / 视频。'
              : '默认 1K、1 张更省额度；需要更清晰再选 2K。生成前需确认。'}
          </p>
        </aside>
      </div>

      {/* 确认卡 */}
      {confirmOpen && pendingBrief && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3 border border-violet-100">
            <div className="font-extrabold text-slate-900 text-lg">
              {pendingBrief.titleZh || '确认生成'}
            </div>
            <p className="text-sm text-slate-600 font-medium leading-relaxed">
              {pendingBrief.summaryZh}
              <br />
              <span className="text-slate-400 text-xs">
                Skill「{skill.label}」·{' '}
                {skillId === 'multi_angle' || pendingBrief.multiAngle
                  ? '4 视角套图'
                  : `${count} 张`}{' '}
                · {size}
              </span>
            </p>
            {(refUploads.length > 0 || canvasProductRefUrls.length > 0) && (
              <p className="text-[11px] text-violet-800 bg-violet-50 rounded-xl px-3 py-2 font-medium">
                参考图将使用{' '}
                {Math.min(
                  MAX_DESIGN_REF_IMAGES,
                  Math.max(
                    refUploads.length,
                    selectedIds.length || canvasProductRefUrls.length
                  )
                )}{' '}
                张；多角度须分别入画，禁止只复制正面。
              </p>
            )}
            {pendingBrief.copyPlanSummaryZh && (
              <div className="text-[11px] text-emerald-800 bg-emerald-50/90 rounded-xl px-3 py-2 font-medium leading-relaxed">
                <span className="font-black">文案方案（已校验·去重）</span>
                <br />
                {pendingBrief.copyPlanSummaryZh}
                {pendingBrief.lockedOnImageCopy?.length ? (
                  <ul className="mt-1.5 space-y-0.5 text-emerald-900">
                    {pendingBrief.lockedOnImageCopy.map((line) => (
                      <li key={line}>· {line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-emerald-700">图面将不印文字，避免乱码。</p>
                )}
              </div>
            )}
            {refUploads.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {refUploads.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-slate-50"
                  />
                ))}
              </div>
            )}
            {pendingBrief.qaChecklist?.length > 0 && (
              <ul className="text-[11px] text-slate-600 bg-violet-50/80 rounded-xl px-3 py-2 space-y-1 font-medium">
                {pendingBrief.qaChecklist.slice(0, 4).map((q) => (
                  <li key={q} className="flex gap-1.5">
                    <CheckCircle2 size={12} className="text-violet-500 shrink-0 mt-0.5" />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2 font-medium max-h-24 overflow-y-auto">
              {pendingBrief.toolPrompt || buildFinalPrompt()}
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setPendingBrief(null);
                }}
                className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 border border-slate-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void runGenerate()}
                className="px-4 py-2 rounded-xl text-sm font-black text-white bg-violet-600"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
