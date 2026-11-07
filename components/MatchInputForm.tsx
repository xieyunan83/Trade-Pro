import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Sparkles,
  Compass,
  Briefcase,
  Target,
  Package,
  Upload,
  ImagePlus,
  Search,
} from 'lucide-react';
import { DesignConstraintCardPanel } from './DesignConstraintCardPanel';
import { CreativeRefPicker, SelectedRefsStrip } from './CreativeRefPicker';
import { VaultImg } from './VaultMedia';
import { loadCatalogSkus, type CatalogSku } from '../services/productCatalogTypes';
import { compressImageDataUrl } from '../services/catalogExcelService';

export type MatchProductSource = 'catalog' | 'upload' | 'design';

export type MatchFormValues = {
  productName: string;
  category: string;
  /** 官方品类 ID（选自产品库时自动带入） */
  categoryIds?: string[];
  priceBand: string;
  skuCode: string;
  notes: string;
  /** 选中的产品图（库内 / 上传 / 设计模块） */
  imageUrls?: string[];
  source?: MatchProductSource;
};

type Props = {
  initial: MatchFormValues;
  /** 变化时重置表单（如收到设计模块交接） */
  seedKey?: string | number;
  busy: boolean;
  progress: string;
  error: string | null;
  crmCount: number;
  historyCount: number;
  onGoCrm?: () => void;
  onSubmit: (values: MatchFormValues) => void;
};

const priceLabel = (sku: CatalogSku): string => {
  if (sku.factoryPrice == null) return '';
  return `${sku.currency || 'USD'} ${sku.factoryPrice}`;
};

const applySku = (sku: CatalogSku) => ({
  name: sku.name || sku.skuCode,
  category: sku.category || '',
  categoryIds: sku.categoryIds?.length
    ? sku.categoryIds
    : ([sku.categoryL1Id, sku.categoryL2Id].filter(Boolean) as string[]),
  priceBand: priceLabel(sku),
  skuCode: sku.skuCode || '',
  notes: [sku.packing && `包装:${sku.packing}`, sku.colors && `配色:${sku.colors}`, sku.specs]
    .filter(Boolean)
    .join('；'),
  images: (sku.images || []).filter(Boolean).slice(0, 4),
});

/**
 * 独立输入岛：击键只更新本组件 state。
 * 选品三路：产品库 / 上传图+填资料 / 设计模块出图。
 */
const MatchInputFormInner: React.FC<Props> = ({
  initial,
  seedKey = 0,
  busy,
  progress,
  error,
  crmCount,
  historyCount,
  onGoCrm,
  onSubmit,
}) => {
  const [source, setSource] = useState<MatchProductSource>(
    initial.source || (initial.imageUrls?.length ? 'design' : 'catalog')
  );
  const [name, setName] = useState(initial.productName);
  const [category, setCategory] = useState(initial.category);
  const [categoryIds, setCategoryIds] = useState<string[]>(initial.categoryIds || []);
  const [priceBand, setPriceBand] = useState(initial.priceBand);
  const [skuCode, setSkuCode] = useState(initial.skuCode);
  const [notes, setNotes] = useState(initial.notes);
  const [images, setImages] = useState<string[]>(initial.imageUrls || []);
  const [skuQuery, setSkuQuery] = useState('');
  const [pickedSkuId, setPickedSkuId] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [constraintKey, setConstraintKey] = useState('');
  const [constraintPrice, setConstraintPrice] = useState('');
  const [constraintSku, setConstraintSku] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const skus = useMemo(() => loadCatalogSkus(), [seedKey]);
  const filteredSkus = useMemo(() => {
    const q = skuQuery.trim().toLowerCase();
    if (!q) return skus.slice(0, 40);
    return skus
      .filter(
        (s) =>
          s.skuCode.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.category || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [skus, skuQuery]);

  // 父级交接 / 建议变化时整表重置
  useEffect(() => {
    setSource(initial.source || (initial.imageUrls?.length ? 'design' : 'catalog'));
    setName(initial.productName || '');
    setCategory(initial.category || '');
    setCategoryIds(initial.categoryIds || []);
    setPriceBand(initial.priceBand || '');
    setSkuCode(initial.skuCode || '');
    setNotes(initial.notes || '');
    setImages(initial.imageUrls || []);
    setPickedSkuId('');
    setLocalError(null);
    setConstraintKey('');
    if (initial.skuCode) {
      const hit = skus.find((s) => s.skuCode === initial.skuCode || s.id === initial.skuCode);
      if (hit) {
        setPickedSkuId(hit.id);
        const ids = hit.categoryIds?.length
          ? hit.categoryIds
          : ([hit.categoryL1Id, hit.categoryL2Id].filter(Boolean) as string[]);
        if (ids.length) setCategoryIds(ids);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const pickCatalogSku = (sku: CatalogSku) => {
    const filled = applySku(sku);
    setPickedSkuId(sku.id);
    setName(filled.name);
    setCategory(filled.category);
    setCategoryIds(filled.categoryIds || []);
    setPriceBand(filled.priceBand);
    setSkuCode(filled.skuCode);
    setNotes(filled.notes);
    setImages(filled.images);
    setSource('catalog');
    setLocalError(null);
  };

  const onUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadBusy(true);
    setLocalError(null);
    try {
      const next: string[] = [...images];
      for (const file of Array.from(files).slice(0, 4)) {
        if (!file.type.startsWith('image/')) continue;
        const raw = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(file);
        });
        if (!raw.startsWith('data:image/')) continue;
        const compressed = await compressImageDataUrl(raw, 1280, 0.82);
        next.push(compressed);
        if (next.length >= 4) break;
      }
      setImages(next.slice(0, 4));
      setSource('upload');
      if (!name.trim() && files[0]?.name) {
        setName(files[0].name.replace(/\.[^.]+$/, '').slice(0, 48));
      }
    } catch (e: any) {
      setLocalError(e?.message || '上传失败');
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSubmit = () => {
    const productName = name.trim();
    if (!productName) {
      setLocalError(
        source === 'catalog'
          ? '请先从产品库选择 SKU，或填写新品名称'
          : '请填写新品名称'
      );
      return;
    }
    if (source === 'catalog' && !skuCode.trim() && !pickedSkuId) {
      setLocalError('请从下方产品库点选一个 SKU');
      return;
    }
    if (source === 'upload' && !images.length) {
      setLocalError('请先上传至少一张产品图');
      return;
    }
    if (source === 'design' && !images.length && !skuCode.trim()) {
      setLocalError('请从设计模块选用出图，或填写货号');
      return;
    }
    setLocalError(null);
    const picked = pickedSkuId ? skus.find((s) => s.id === pickedSkuId) : undefined;
    const ids =
      categoryIds.length
        ? categoryIds
        : picked?.categoryIds?.length
          ? picked.categoryIds
          : ([picked?.categoryL1Id, picked?.categoryL2Id].filter(Boolean) as string[]);
    onSubmit({
      productName,
      category: category.trim(),
      categoryIds: ids.length ? ids : undefined,
      priceBand: priceBand.trim(),
      skuCode: skuCode.trim(),
      notes: notes.trim(),
      imageUrls: images,
      source,
    });
  };

  const loadConstraint = () => {
    const key = category.trim() || name.trim();
    if (!key) {
      setLocalError('请先填写品类或新品名称，再查看适市约束');
      return;
    }
    setLocalError(null);
    setConstraintKey(key.slice(0, 80));
    setConstraintPrice(priceBand.trim());
    setConstraintSku(skuCode.trim());
  };

  const err = localError || error;
  const tabBtn = (id: MatchProductSource, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setSource(id)}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-black border transition ${
        source === id
          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
          : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-slate-900 font-black text-xl">
            <Target className="text-emerald-600" size={22} />
            市调 · 匹配 · 开发信
          </div>
          <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
            先选好要推的产品，再让两位专家出国家、客户与开发信。可选：产品库 SKU、本地上传图+资料，或平面/包装等设计模块出图。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-black">
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 text-cyan-800 px-2.5 py-1 border border-cyan-100">
            <Compass size={12} /> 市调专家
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-800 px-2.5 py-1 border border-violet-100">
            <Briefcase size={12} /> 产品经理
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {tabBtn('catalog', '产品库选品', <Package size={14} />)}
        {tabBtn('upload', '上传图 + 填资料', <Upload size={14} />)}
        {tabBtn('design', '设计模块出图', <ImagePlus size={14} />)}
      </div>

      {source === 'catalog' && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-slate-400" />
            <input
              value={skuQuery}
              onChange={(e) => setSkuQuery(e.target.value)}
              placeholder="搜索货号 / 品名 / 品类"
              className="flex-1 bg-white rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
            />
            <span className="text-[10px] font-black text-slate-400">{skus.length} SKU</span>
          </div>
          {filteredSkus.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-medium py-4 text-center">
              产品库暂无匹配项。请先到「产品库」导入或录入带图 SKU。
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-52 overflow-y-auto custom-scrollbar">
              {filteredSkus.map((sku) => {
                const selected = pickedSkuId === sku.id || skuCode === sku.skuCode;
                const thumb = sku.images?.[0];
                return (
                  <button
                    key={sku.id}
                    type="button"
                    onClick={() => pickCatalogSku(sku)}
                    className={`text-left rounded-xl border bg-white p-2 space-y-1.5 transition ${
                      selected
                        ? 'border-emerald-400 ring-1 ring-emerald-200'
                        : 'border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="aspect-square rounded-lg bg-slate-50 overflow-hidden border border-slate-100">
                      {thumb ? (
                        <VaultImg src={thumb} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-300 font-bold">
                          无图
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] font-black text-emerald-700 truncate">{sku.skuCode}</div>
                    <div className="text-[11px] font-bold text-slate-800 line-clamp-2 leading-snug">
                      {sku.name}
                    </div>
                    {sku.category ? (
                      <div className="text-[9px] font-bold text-slate-400 truncate">{sku.category}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {source === 'upload' && (
        <div className="mb-4 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void onUploadFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={uploadBusy}
            onClick={() => fileRef.current?.click()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-emerald-200 hover:bg-emerald-50 text-emerald-800 text-sm font-black py-3 disabled:opacity-60"
          >
            {uploadBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploadBusy ? '处理图片中…' : '选择产品图片（最多 4 张）'}
          </button>
          <SelectedRefsStrip urls={images} onChange={setImages} label="已上传产品图" />
          <p className="text-[11px] text-emerald-900/70 font-medium">
            上传后请补全下方名称、品类、价格带与卖点，再点匹配。
          </p>
        </div>
      )}

      {source === 'design' && (
        <div className="mb-4 space-y-2">
          <CreativeRefPicker
            value={images}
            onChange={(urls) => {
              setImages(urls);
              setSource('design');
            }}
            multiple
            max={4}
            accent="violet"
            title="从平面设计 / 产品库选用出图"
            onSkuMeta={(meta) => {
              if (!meta) return;
              if (meta.skuName && !name.trim()) setName(meta.skuName);
              if (meta.skuCode) {
                setSkuCode(meta.skuCode);
                const hit = skus.find(
                  (s) => s.skuCode === meta.skuCode || s.id === meta.skuCode
                );
                if (hit) pickCatalogSku(hit);
              }
            }}
          />
          <p className="text-[11px] text-slate-500 font-medium px-0.5">
            也可在「产品设计 · 平面图」勾选出图后点「→ 产品匹配」自动带入。
          </p>
        </div>
      )}

      {images.length > 0 && source !== 'design' && source !== 'upload' ? (
        <div className="mb-4">
          <SelectedRefsStrip urls={images} onChange={setImages} label="当前产品图" />
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <label className="block sm:col-span-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            新品名称 *
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：1:64 合金回力消防车"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            货号 SKU
          </span>
          <input
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
            placeholder="可选"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">品类</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="合金/回力车玩具"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            价格带
          </span>
          <input
            value={priceBand}
            onChange={(e) => setPriceBand(e.target.value)}
            placeholder="例如 FOB $1.2–2.5"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            卖点 / 设计备注
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="开窗礼盒、可充电、适合会展…"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={handleSubmit}
          className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-bold text-sm"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? progress || '专家工作中…' : '双专家分析并匹配'}
        </button>
        {busy && progress ? (
          <span className="text-[11px] font-bold text-emerald-700 max-w-xs leading-snug">
            {progress}
          </span>
        ) : null}
        <button
          type="button"
          onClick={loadConstraint}
          className="text-xs font-bold text-violet-700 hover:underline"
        >
          查看适市约束
        </button>
        {onGoCrm && (
          <button
            type="button"
            onClick={onGoCrm}
            className="text-xs font-bold text-emerald-700 hover:underline"
          >
            去客户库补充线索
          </button>
        )}
        <span className="text-[11px] text-slate-400 font-medium">
          CRM {crmCount} 家 · 背调历史 {historyCount} 条
        </span>
      </div>

      {constraintKey ? (
        <div className="mt-4">
          <DesignConstraintCardPanel
            categoryOrName={constraintKey}
            priceBandText={constraintPrice}
            skuCode={constraintSku}
          />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-400 font-medium">
          适市约束不会随输入自动刷新；选好产品后点「查看适市约束」即可。
        </p>
      )}

      <p className="mt-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 font-medium leading-relaxed">
        匹配依据：库内在售/采购品类、SKU、标签，以及包装/配色/价带重叠；完成后会给出定价参考与置信度。
      </p>
      {err && (
        <p className="mt-3 text-sm font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
          {err}
        </p>
      )}
    </div>
  );
};

export const MatchInputForm = memo(MatchInputFormInner);
