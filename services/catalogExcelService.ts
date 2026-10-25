/**
 * 产品库 · Excel 模板下载 / 导入（含嵌入产品图，压缩后入库供设计模块复用）
 */
import type { CatalogSku, ProductSource } from './productCatalogTypes';

declare const XLSX: any;
declare const JSZip: any;

const TEMPLATE_HEADERS = [
  '品名',
  '货号',
  '装箱数',
  '内盒',
  '外箱规格',
  '毛净KG',
  '包装',
  '价格',
  '常规颜色',
  '产品测试报告',
  '品类',
  '英文名',
  'MOQ',
  '币种',
  '供应商',
] as const;

const SAMPLE = [
  {
    品名: '三角型多孔泡中泡西洋剑泡泡棒',
    货号: '889-102',
    装箱数: '6盒/72只',
    内盒: '0',
    外箱规格: '50*43*49',
    毛净KG: '25/24',
    包装: '彩盒',
    价格: '4.1',
    常规颜色: '蓝/绿/紫/红混装（含200ML泡泡水）',
    产品测试报告: 'EN71、ASTM、CE…',
    品类: '泡泡棒',
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

/** 下载可填写的产品资料模板（对齐工厂报价表字段） */
export const downloadCatalogExcelTemplate = () => {
  ensureXlsx();
  const ws = XLSX.utils.json_to_sheet(SAMPLE, { header: [...TEMPLATE_HEADERS] });
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({
    wch: Math.min(28, Math.max(10, h.length + 4)),
  }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    ['1. 在「产品资料」表按列填写；货号与品名为必填。'],
    ['2. 产品图片：可在 Excel 中把图片插入到对应货号行（「图片」列区域），上传后会自动关联；也可导入后再在产品库补图。'],
    ['3. 价格默认按出厂价（USD）；币种列可改 CNY 等。'],
    ['4. 也支持工厂报价表原格式（含标题行 + 图片/品名/货号…），直接上传即可识别。'],
    ['5. 同货号再次导入会覆盖更新（保留其它货号）。'],
  ]);
  guide['!cols'] = [{ wch: 88 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '产品资料');
  XLSX.utils.book_append_sheet(wb, guide, '填写说明');
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
      else if (/装箱/.test(cell)) map.cartonQty = i;
      else if (/内盒/.test(cell)) map.innerBox = i;
      else if (/外箱/.test(cell)) map.cartonSpec = i;
      else if (/毛净|毛\/净|gw\/nw/.test(cell)) map.grossNet = i;
      else if (/^包装$|packing/.test(cell)) map.packing = i;
      else if (/^(价格|单价|出厂价|price|fob)$/.test(cell)) map.price = i;
      else if (/颜色|colour|color/.test(cell)) map.colors = i;
      else if (/测试|认证|证书|证书报告|report/.test(cell)) map.certs = i;
      else if (/品类|分类|category/.test(cell)) map.category = i;
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
    const category = cell(row, map.category) || undefined;
    const nameEn = cell(row, map.nameEn) || undefined;
    const supplier = cell(row, map.supplier) || undefined;
    const cartonSpec = cell(row, map.cartonSpec);
    const innerBox = cell(row, map.innerBox);
    const grossNet = cell(row, map.grossNet);

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

  if (!skus.length) throw new Error('未解析到有效货号行，请检查表格内容');
  return { skus, imageCount, skipped };
};

/** 合并导入结果到现有库（按货号覆盖） */
export const mergeCatalogImports = (
  existing: CatalogSku[],
  incoming: CatalogSku[]
): CatalogSku[] => {
  const map = new Map(existing.map((r) => [r.skuCode.toLowerCase(), r]));
  for (const s of incoming) {
    const prev = map.get(s.skuCode.toLowerCase());
    if (prev) {
      map.set(s.skuCode.toLowerCase(), {
        ...prev,
        ...s,
        id: prev.id,
        createdAt: prev.createdAt,
        images: s.images?.length ? s.images : prev.images,
        updatedAt: Date.now(),
      });
    } else {
      map.set(s.skuCode.toLowerCase(), s);
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
};
