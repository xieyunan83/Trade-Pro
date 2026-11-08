/**
 * 产品库 · Excel 模板下载 / 导入（含嵌入产品图，压缩后入库供设计模块复用）
 * 官方类目（阿里巴巴全站树）为必填：一级类目ID + 二级类目ID（小类）均必选。
 */
import {
  ensureSkuTaxonomy,
  type CatalogSku,
  type ProductSource,
} from './productCatalogTypes';
import {
  PRODUCT_TAXONOMY_BY_ID,
  PRODUCT_TAXONOMY_L1,
  PRODUCT_TAXONOMY_L2,
  PRODUCT_TAXONOMY_ROOTS,
  TOY_ROOT_ID,
  formatTaxonomyLabel,
  getTaxonomyL1ByRoot,
  getTaxonomyChildren,
  resolveLegacyCategoryId,
} from '../data/productTaxonomy';

declare const XLSX: any;
declare const JSZip: any;

const TEMPLATE_HEADERS = [
  '品名',
  '货号',
  '一级类目ID',
  '二级类目ID',
  '装箱数',
  '内盒',
  '外箱规格',
  '毛净KG',
  '包装',
  '价格',
  '常规颜色',
  '产品测试报告',
  '品类备注',
  '英文名',
  'MOQ',
  '币种',
  '供应商',
] as const;

const SAMPLE_L1 =
  getTaxonomyL1ByRoot(TOY_ROOT_ID).find((n) => /bubble|泡泡|outdoor|户外/i.test(`${n.nameEn} ${n.nameZh}`)) ||
  getTaxonomyL1ByRoot(TOY_ROOT_ID)[0] ||
  PRODUCT_TAXONOMY_L1[0];
const SAMPLE_L2 = SAMPLE_L1 ? getTaxonomyChildren(SAMPLE_L1.id)[0] : undefined;

const SAMPLE = [
  {
    品名: '三角型多孔泡中泡西洋剑泡泡棒',
    货号: '889-102',
    一级类目ID: SAMPLE_L1?.id || '',
    二级类目ID: SAMPLE_L2?.id || '',
    装箱数: '6盒/72只',
    内盒: '0',
    外箱规格: '50*43*49',
    毛净KG: '25/24',
    包装: '彩盒',
    价格: '4.1',
    常规颜色: '蓝/绿/紫/红混装（含200ML泡泡水）',
    产品测试报告: 'EN71、ASTM、CE…',
    品类备注: SAMPLE_L1 ? formatTaxonomyLabel(SAMPLE_L2?.id || SAMPLE_L1.id) : '泡泡棒',
    英文名: 'Bubble Sword Wand',
    MOQ: '72',
    币种: 'USD',
    供应商: '示例厂',
  },
];

const ensureXlsx = () => {
  if (typeof XLSX === 'undefined') throw new Error('Excel 引擎未加载，请刷新页面');
};

const ensureZip = () => {
  if (typeof JSZip === 'undefined') throw new Error('压缩库未加载，请刷新页面');
};

const taxonomyOptionLabel = (id: string, zh: string, en: string) => `${zh} · ${en} [${id}]`;

/** 解析单元格中的官方类目：支持纯 ID，或「中文 · 英文 [id]」 */
export const resolveTaxonomyCell = (
  raw: string
): { id?: string; level?: 0 | 1 | 2 } => {
  const s = String(raw || '').trim();
  if (!s) return {};
  const bracket = s.match(/\[([^\]]+)\]\s*$/);
  const cand = (bracket?.[1] || s).trim();
  const id = resolveLegacyCategoryId(cand) || cand;
  const node = PRODUCT_TAXONOMY_BY_ID[id];
  if (node) return { id: node.id, level: node.level };
  const lower = s.toLowerCase();
  const byName = Object.values(PRODUCT_TAXONOMY_BY_ID).find((n) => {
    if (n.nameZh === s || n.nameEn.toLowerCase() === lower) return true;
    return (n.aliases || []).some((a) => a.toLowerCase() === lower);
  });
  return byName ? { id: byName.id, level: byName.level } : {};
};

/** 下载可填写的产品资料模板（对齐工厂报价表 + 官方类目必选） */
export const downloadCatalogExcelTemplate = () => {
  ensureXlsx();
  const ws = XLSX.utils.json_to_sheet(SAMPLE, { header: [...TEMPLATE_HEADERS] });
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({
    wch: Math.min(36, Math.max(12, h.length + 6)),
  }));

  const rootRows = [
    ['大类ID', '中文名', '英文名', '下拉选项'],
    ...PRODUCT_TAXONOMY_ROOTS.map((n) => [
      n.id,
      n.nameZh,
      n.nameEn,
      taxonomyOptionLabel(n.id, n.nameZh, n.nameEn),
    ]),
  ];
  const l1Rows = [
    ['一级类目ID', '中文名', '英文名', '所属大类ID', '下拉选项'],
    ...PRODUCT_TAXONOMY_L1.map((n) => [
      n.id,
      n.nameZh,
      n.nameEn,
      n.parentId || '',
      taxonomyOptionLabel(n.id, n.nameZh, n.nameEn),
    ]),
  ];
  // 二级全量过大时模板仍可用；默认附全站二级供复制 ID
  const l2Rows = [
    ['二级类目ID', '中文名', '英文名', '所属一级ID', '下拉选项'],
    ...PRODUCT_TAXONOMY_L2.map((n) => [
      n.id,
      n.nameZh,
      n.nameEn,
      n.parentId || '',
      taxonomyOptionLabel(n.id, n.nameZh, n.nameEn),
    ]),
  ];

  const guide = XLSX.utils.aoa_to_sheet([
    ['填写说明（官方类目必选）'],
    ['1. 「货号」「品名」「一级类目ID」「二级类目ID」均为必填（二级小类决定精准匹配）。'],
    ['2. 类目请从「官方一级」「官方二级」复制对应 ID 列，或整格复制「下拉选项」（含 [id]）；二级的所属一级须与一级列一致。'],
    ['3. 缺一级或二级官方类目的行将在导入时跳过，不会进入产品库。'],
    ['4. 入库后系统按一级+二级类目自动匹配已背调客户并打分分级。'],
    ['5. 产品图片可插入对应货号行；价格默认出厂价（USD）。同货号再导入会覆盖更新。'],
    ['6. 旧版工厂表若无类目列，请先用本模板补全一级与二级类目后再上传。'],
  ]);
  guide['!cols'] = [{ wch: 96 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '产品资料');
  XLSX.utils.book_append_sheet(wb, guide, '填写说明');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rootRows), '官方大类');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(l1Rows), '官方一级');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(l2Rows), '官方二级');

  // 尽力写入数据验证（部分 Excel 引擎会忽略；导入侧仍强制校验）
  try {
    const l1End = Math.max(2, PRODUCT_TAXONOMY_L1.length + 1);
    const l2End = Math.max(2, PRODUCT_TAXONOMY_L2.length + 1);
    ws['!dataValidation'] = [
      {
        type: 'list',
        allowBlank: false,
        showErrorMessage: true,
        error: '请从「官方一级」复制一级类目ID',
        sqref: 'C2:C2000',
        formulas: [`'官方一级'!$A$2:$A$${l1End}`],
      },
      {
        type: 'list',
        allowBlank: false,
        showErrorMessage: true,
        error: '请从「官方二级」复制二级类目ID（小类必选）',
        sqref: 'D2:D2000',
        formulas: [`'官方二级'!$A$2:$A$${l2End}`],
      },
    ];
  } catch {
    /* ignore */
  }

  XLSX.writeFile(wb, `产品资料导入模板_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

const norm = (s: unknown) =>
  String(s || '')
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .toLowerCase();

type ColMap = {
  name?: number;
  sku?: number;
  cartonQty?: number;
  innerBox?: number;
  cartonSpec?: number;
  grossNet?: number;
  packing?: number;
  price?: number;
  colors?: number;
  certs?: number;
  category?: number;
  categoryL1?: number;
  categoryL2?: number;
  categoryRoot?: number;
  nameEn?: number;
  moq?: number;
  currency?: number;
  supplier?: number;
  image?: number;
};

const detectHeader = (aoa: unknown[][]): { rowIndex: number; map: ColMap } | null => {
  for (let r = 0; r < Math.min(aoa.length, 25); r++) {
    const row = (aoa[r] || []).map((c) => norm(c));
    const map: ColMap = {};
    row.forEach((cell, i) => {
      if (!cell) return;
      if (/^(品名|产品名称|商品名|name)$/.test(cell) || cell === '产品名') map.name = i;
      else if (/^(货号|sku|skucode|型号|article)$/.test(cell)) map.sku = i;
      else if (/一级类目id|类目l1id|l1id|官方一级/.test(cell)) map.categoryL1 = i;
      else if (/二级类目id|类目l2id|l2id|官方二级/.test(cell)) map.categoryL2 = i;
      else if (/大类id|类目root|rootid|官方大类/.test(cell)) map.categoryRoot = i;
      else if (/装箱/.test(cell)) map.cartonQty = i;
      else if (/内盒/.test(cell)) map.innerBox = i;
      else if (/外箱/.test(cell)) map.cartonSpec = i;
      else if (/毛净|毛\/净|gw\/nw/.test(cell)) map.grossNet = i;
      else if (/^包装$|packing/.test(cell)) map.packing = i;
      else if (/^(价格|单价|出厂价|price|fob)$/.test(cell)) map.price = i;
      else if (/颜色|colour|color/.test(cell)) map.colors = i;
      else if (/测试|认证|证书|证书报告|report/.test(cell)) map.certs = i;
      else if (/品类备注|品类|分类|category/.test(cell)) map.category = i;
      else if (/英文/.test(cell) || cell === 'nameen') map.nameEn = i;
      else if (/^moq$|起订/.test(cell)) map.moq = i;
      else if (/币种|currency/.test(cell)) map.currency = i;
      else if (/供应商|工厂|supplier/.test(cell)) map.supplier = i;
      else if (/^图片$|image|photo/.test(cell)) map.image = i;
    });
    if (map.name != null && map.sku != null) return { rowIndex: r, map };
  }
  return null;
};

const cell = (row: unknown[], idx?: number) =>
  idx == null ? '' : String(row[idx] ?? '').replace(/\r\n/g, '\n').trim();

const parsePrice = (raw: string): number | undefined => {
  if (!raw) return undefined;
  const m = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

const parseMoq = (raw: string, cartonQty: string): number | undefined => {
  if (raw) {
    const m = raw.replace(/,/g, '').match(/\d+/);
    if (m) return Number(m[0]);
  }
  // 从「6盒\n72只」取最大数字作参考起订
  const nums = [...cartonQty.matchAll(/\d+/g)].map((x) => Number(x[0]));
  if (nums.length) return Math.max(...nums);
  return undefined;
};

/** 压缩嵌入图，避免撑爆 localStorage */
export const compressImageDataUrl = async (
  dataUrl: string,
  maxEdge = 1024,
  quality = 0.72
): Promise<string> => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

const mimeFromPath = (p: string) => {
  const lower = p.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
};

type AnchorHit = { row: number; relId: string; descr?: string };

/** 从 xlsx drawings 解析：工作表行 → 图片关系 */
const extractImageAnchors = async (
  zip: any
): Promise<{ anchors: AnchorHit[]; relToPath: Record<string, string> }> => {
  const anchors: AnchorHit[] = [];
  const relToPath: Record<string, string> = {};

  const drawingFiles = Object.keys(zip.files).filter((n) =>
    /xl\/drawings\/drawing\d+\.xml$/i.test(n)
  );
  for (const drawingPath of drawingFiles) {
    const xml: string = await zip.file(drawingPath).async('string');
    const relPath = drawingPath.replace(/drawing(\d+)\.xml$/i, '_rels/drawing$1.xml.rels');
    const relFile = zip.file(relPath);
    if (relFile) {
      const relXml: string = await relFile.async('string');
      const relRe =
        /Id="(rId\d+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="(rId\d+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = relRe.exec(relXml))) {
        const id = m[1] || m[4];
        const target = m[2] || m[3];
        if (id && target) {
          const abs = target.startsWith('../')
            ? `xl/${target.replace(/^\.\.\//, '')}`
            : target.startsWith('xl/')
              ? target
              : `xl/drawings/${target}`;
          relToPath[id] = abs.replace(/\\/g, '/');
        }
      }
    }

    const anchorRe =
      /<xdr:twoCellAnchor[\s\S]*?<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>[\s\S]*?(?:descr="([^"]*)")?[\s\S]*?r:embed="(rId\d+)"[\s\S]*?<\/xdr:twoCellAnchor>/gi;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(xml))) {
      anchors.push({
        row: Number(am[1]),
        descr: am[2] || '',
        relId: am[3],
      });
    }
    // fallback simpler
    if (!anchors.length) {
      const simple =
        /<xdr:row>(\d+)<\/xdr:row>[\s\S]{0,800}?r:embed="(rId\d+)"/gi;
      let sm: RegExpExecArray | null;
      while ((sm = simple.exec(xml))) {
        anchors.push({ row: Number(sm[1]), relId: sm[2] });
      }
    }
  }
  return { anchors, relToPath };
};

const loadMediaDataUrl = async (zip: any, path: string): Promise<string | null> => {
  const file = zip.file(path) || zip.file(path.replace(/^xl\//, 'xl/'));
  if (!file) {
    // try media folder basename
    const base = path.split('/').pop();
    const alt = Object.keys(zip.files).find((n) => n.endsWith(`/media/${base}`));
    if (!alt) return null;
    const buf: ArrayBuffer = await zip.file(alt).async('arraybuffer');
    const b64 = arrayBufferToBase64(buf);
    return `data:${mimeFromPath(alt)};base64,${b64}`;
  }
  const buf: ArrayBuffer = await file.async('arraybuffer');
  const b64 = arrayBufferToBase64(buf);
  return `data:${mimeFromPath(path)};base64,${b64}`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export type CatalogExcelSkuDraft = Omit<
  CatalogSku,
  'id' | 'ownerUsername' | 'departmentId' | 'createdAt' | 'updatedAt'
>;

export type CatalogExcelImportResult = {
  skus: CatalogExcelSkuDraft[];
  imageCount: number;
  skipped: number;
  /** 因缺少官方类目被跳过的行数 */
  skippedNoTaxonomy: number;
};

/**
 * 解析产品资料 Excel（工厂报价表或标准模板），提取 SKU + 嵌入图
 */
export const parseCatalogExcelFile = async (file: File): Promise<CatalogExcelImportResult> => {
  ensureXlsx();
  ensureZip();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName =
    wb.SheetNames.find((n: string) => /产品|报价|资料|catalog|sku/i.test(n)) ||
    wb.SheetNames[0];
  if (!sheetName) throw new Error('表格为空');
  const sheet = wb.Sheets[sheetName];
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const detected = detectHeader(aoa);
  if (!detected) {
    throw new Error('未找到表头（需含「品名」「货号」列）。请先下载模板对照填写。');
  }
  const { rowIndex, map } = detected;

  const zip = await JSZip.loadAsync(buf);
  const { anchors, relToPath } = await extractImageAnchors(zip);
  const rowImages = new Map<number, string>();
  const descrImages = new Map<string, string>();

  for (const a of anchors) {
    const mediaPath = relToPath[a.relId];
    if (!mediaPath) continue;
    const raw = await loadMediaDataUrl(zip, mediaPath);
    if (!raw) continue;
    const compressed = await compressImageDataUrl(raw);
    rowImages.set(a.row, compressed);
    if (a.descr?.trim()) descrImages.set(a.descr.trim().toLowerCase(), compressed);
  }

  const skus: CatalogExcelSkuDraft[] = [];
  let skipped = 0;
  let skippedNoTaxonomy = 0;
  let imageCount = 0;

  for (let r = rowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const name = cell(row, map.name);
    const skuCode = cell(row, map.sku);
    if (!name && !skuCode) {
      const joined = row.map((c) => String(c || '')).join('');
      if (/联系人|电话|传真|QQ/.test(joined)) break;
      skipped++;
      continue;
    }
    if (!skuCode || !name) {
      skipped++;
      continue;
    }

    const cartonQty = cell(row, map.cartonQty);
    const packing = cell(row, map.packing);
    const colors = cell(row, map.colors);
    const certsRaw = cell(row, map.certs);
    const price = parsePrice(cell(row, map.price));
    const moq = parseMoq(cell(row, map.moq), cartonQty);
    const currency = cell(row, map.currency) || 'USD';
    const categoryNote = cell(row, map.category) || undefined;
    const nameEn = cell(row, map.nameEn) || undefined;
    const supplier = cell(row, map.supplier) || undefined;
    const cartonSpec = cell(row, map.cartonSpec);
    const innerBox = cell(row, map.innerBox);
    const grossNet = cell(row, map.grossNet);

    const l1Hit = resolveTaxonomyCell(cell(row, map.categoryL1));
    const l2Hit = resolveTaxonomyCell(cell(row, map.categoryL2));
    const rootHit = resolveTaxonomyCell(cell(row, map.categoryRoot));
    let categoryL1Id = l1Hit.level === 1 ? l1Hit.id : l1Hit.level === 2 ? undefined : l1Hit.id;
    let categoryL2Id = l2Hit.level === 2 ? l2Hit.id : l2Hit.level === 1 ? undefined : l2Hit.id;
    if (l1Hit.level === 2) {
      categoryL2Id = l1Hit.id;
      categoryL1Id = PRODUCT_TAXONOMY_BY_ID[l1Hit.id!]?.parentId || categoryL1Id;
    }
    if (l2Hit.level === 1 && !categoryL1Id) categoryL1Id = l2Hit.id;
    if (categoryL2Id && !categoryL1Id) {
      categoryL1Id = PRODUCT_TAXONOMY_BY_ID[categoryL2Id]?.parentId || undefined;
    }
    // 兼容旧表仅有「品类」自由文本：尝试解析为官方类目，失败则跳过
    if ((!categoryL1Id || !categoryL2Id) && categoryNote) {
      const noteHit = resolveTaxonomyCell(categoryNote);
      if (noteHit.level === 2) {
        categoryL2Id = categoryL2Id || noteHit.id;
        categoryL1Id =
          categoryL1Id ||
          (noteHit.id ? PRODUCT_TAXONOMY_BY_ID[noteHit.id]?.parentId : undefined);
      }
    }
    // 一级 + 二级（小类）均必选，否则跳过
    if (!categoryL1Id || !categoryL2Id) {
      skippedNoTaxonomy++;
      skipped++;
      continue;
    }
    // 校验二级归属一级
    const l2Parent = PRODUCT_TAXONOMY_BY_ID[categoryL2Id]?.parentId;
    if (l2Parent && categoryL1Id && l2Parent !== categoryL1Id) {
      categoryL1Id = l2Parent;
    }
    const l1Node = categoryL1Id ? PRODUCT_TAXONOMY_BY_ID[categoryL1Id] : undefined;
    const categoryRootId =
      rootHit.id || l1Node?.parentId || l1Node?.rootId || undefined;
    const category =
      categoryNote ||
      formatTaxonomyLabel(categoryL2Id || categoryL1Id) ||
      undefined;

    const specsParts = [
      cartonQty && `装箱：${cartonQty}`,
      cartonSpec && `外箱：${cartonSpec}`,
      grossNet && `毛净：${grossNet}`,
      colors && `颜色：${colors}`,
    ].filter(Boolean);

    let img =
      rowImages.get(r) || descrImages.get(skuCode.toLowerCase()) || undefined;
    if (!img && anchors.length === 1 && skus.length === 0) {
      img = [...rowImages.values()][0];
    }
    const images = img ? [img] : [];
    if (img) imageCount++;

    skus.push({
      skuCode,
      name,
      nameEn,
      category,
      categoryRootId,
      categoryL1Id,
      categoryL2Id,
      categoryIds: [categoryRootId, categoryL1Id, categoryL2Id].filter(Boolean) as string[],
      images,
      specs: specsParts.join('；') || undefined,
      moq,
      currency,
      factoryPrice: price,
      packing: packing || undefined,
      certificates: certsRaw
        ? certsRaw
            .split(/[,，、;；]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 40)
        : undefined,
      colors: colors || undefined,
      cartonQty: cartonQty || undefined,
      innerBox: innerBox || undefined,
      cartonSpec: cartonSpec || undefined,
      grossNetKg: grossNet || undefined,
      supplierName: supplier,
      source: 'import' as ProductSource,
      externalId: skuCode,
    });
  }

  if (!skus.length) {
    if (skippedNoTaxonomy > 0) {
      throw new Error(
        `未导入任何产品：有 ${skippedNoTaxonomy} 行缺少官方「一级类目ID」或「二级类目ID」。请下载最新模板，从「官方一级」「官方二级」复制后再上传（二级小类必填）。`
      );
    }
    throw new Error('未解析到有效货号行，请检查表格内容');
  }
  return { skus, imageCount, skipped, skippedNoTaxonomy };
};

/** 合并导入结果到现有库（按货号覆盖） */
export const mergeCatalogImports = (
  existing: CatalogSku[],
  incoming: CatalogSku[]
): CatalogSku[] => {
  const map = new Map(existing.map((r) => [r.skuCode.toLowerCase(), r]));
  for (const s of incoming) {
    const next = ensureSkuTaxonomy(s);
    const prev = map.get(next.skuCode.toLowerCase());
    if (prev) {
      map.set(next.skuCode.toLowerCase(), ensureSkuTaxonomy({
        ...prev,
        ...next,
        id: prev.id,
        createdAt: prev.createdAt,
        images: next.images?.length ? next.images : prev.images,
        updatedAt: Date.now(),
      }));
    } else {
      map.set(next.skuCode.toLowerCase(), next);
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
};
