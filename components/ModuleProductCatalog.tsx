import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Warehouse, Upload, Download, Loader2, Image as ImageIcon, Sparkles } from 'lucide-react';
import type { User } from '../types';
import {
  type CatalogSku,
  loadCatalogSkus,
  saveCatalogSkus,
} from '../services/productCatalogTypes';
import {
  compressImageDataUrl,
  downloadCatalogExcelTemplate,
  mergeCatalogImports,
  parseCatalogExcelFile,
} from '../services/catalogExcelService';
import { buildMarketFitAdvice, MARKET_PICK_OPTIONS } from '../services/marketFitAdvice';
import { loadTradeJourney, patchTradeJourney, toggleJourneyStage } from '../services/tradeJourney';

type Props = {
  currentUser: User;
};

const newId = () => `sku_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** 产品库：手工录入 + Excel 导入（含产品图，供设计模块复用） */
export const ModuleProductCatalog: React.FC<Props> = ({ currentUser }) => {
  const [rows, setRows] = useState<CatalogSku[]>(() => loadCatalogSkus());
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const journey0 = loadTradeJourney();
  const [fitMarket, setFitMarket] = useState(
    () => journey0.targetMarket || MARKET_PICK_OPTIONS[0].label
  );
  const [fitCategory, setFitCategory] = useState(
    () => journey0.productFocus || ''
  );
  const [form, setForm] = useState({
    skuCode: '',
    name: '',
    nameEn: '',
    category: '',
    factoryPrice: '',
    moq: '',
    currency: 'USD',
    specs: '',
    supplierName: '',
    imageDataUrl: '' as string,
  });

  const fitAdvice = useMemo(
    () =>
      buildMarketFitAdvice({
        categoryOrName: fitCategory || form.category || form.name || '玩具',
        targetMarket: fitMarket,
      }),
    [fitCategory, fitMarket, form.category, form.name]
  );

  const persist = useCallback((next: CatalogSku[]) => {
    setRows(next);
    saveCatalogSkus(next);
    if (next.length > 0) toggleJourneyStage('select', true);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.skuCode.toLowerCase().includes(s) ||
        r.name.toLowerCase().includes(s) ||
        (r.nameEn || '').toLowerCase().includes(s) ||
        (r.category || '').toLowerCase().includes(s) ||
        (r.supplierName || '').toLowerCase().includes(s) ||
        (r.colors || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  const addSku = () => {
    if (!form.skuCode.trim() || !form.name.trim()) {
      setMsg('请填写货号与品名');
      return;
    }
    const now = Date.now();
    const sku: CatalogSku = {
      id: newId(),
      skuCode: form.skuCode.trim(),
      name: form.name.trim(),
      nameEn: form.nameEn.trim() || undefined,
      category: form.category.trim() || undefined,
      images: form.imageDataUrl ? [form.imageDataUrl] : [],
      specs: form.specs.trim() || undefined,
      moq: form.moq ? Number(form.moq) : undefined,
      currency: form.currency || 'USD',
      factoryPrice: form.factoryPrice ? Number(form.factoryPrice) : undefined,
      supplierName: form.supplierName.trim() || undefined,
      source: 'manual',
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
      createdAt: now,
      updatedAt: now,
    };
    persist(mergeCatalogImports(rows, [sku]));
    setForm({
      skuCode: '',
      name: '',
      nameEn: '',
      category: '',
      factoryPrice: '',
      moq: '',
      currency: 'USD',
      specs: '',
      supplierName: '',
      imageDataUrl: '',
    });
    setMsg(`已添加 ${sku.skuCode}（图片可在设计模块选用）`);
  };

  const removeSku = (id: string) => {
    if (!confirm('从产品库删除该 SKU？不会删除 CRM 或背调记录。')) return;
    persist(rows.filter((r) => r.id !== id));
  };

  const onManualImage = async (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = String(reader.result || '');
      const compressed = await compressImageDataUrl(raw);
      setForm((f) => ({ ...f, imageDataUrl: compressed }));
    };
    reader.readAsDataURL(file);
  };

  const importExcel = async (file: File) => {
    setBusy(true);
    setMsg('正在解析 Excel 与产品图…');
    try {
      const { skus, imageCount, skipped } = await parseCatalogExcelFile(file);
      const now = Date.now();
      const incoming: CatalogSku[] = skus.map((raw, i) => ({
        id: newId() + i,
        skuCode: raw.skuCode,
        name: raw.name,
        nameEn: raw.nameEn,
        category: raw.category,
        images: raw.images || [],
        specs: raw.specs,
        moq: raw.moq,
        currency: raw.currency || 'USD',
        factoryPrice: raw.factoryPrice,
        packing: raw.packing,
        certificates: raw.certificates,
        colors: raw.colors,
        cartonQty: raw.cartonQty,
        innerBox: raw.innerBox,
        cartonSpec: raw.cartonSpec,
        grossNetKg: raw.grossNetKg,
        supplierName: raw.supplierName,
        source: 'import',
        externalId: raw.externalId,
        ownerUsername: currentUser.username,
        departmentId: currentUser.departmentId,
        createdAt: now,
        updatedAt: now,
      }));
      persist(mergeCatalogImports(rows, incoming));
      setMsg(
        `已导入/合并 ${incoming.length} 款（含图 ${imageCount} 张${skipped ? `，跳过空行 ${skipped}` : ''}）。可在设计模块选用产品图二次创作。`
      );
    } catch (e: any) {
      setMsg(`导入失败：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[90rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-violet-200/70 bg-white/95 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-violet-700 font-black text-xs uppercase tracking-widest">
              <Warehouse size={14} /> Product Catalog
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">产品库</h2>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
              管理本司 SKU：货号、品名、规格、价格与产品图。先看适市建议，再导入/录入产品包，供报价与获客使用。
            </p>
          </div>
          <div className="text-right text-sm font-black text-slate-700">{rows.length} 款</div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-black text-slate-800">
            <Sparkles size={14} className="text-cyan-600" /> 适市顾问（包装 / 功能 / 合规提示）
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-slate-400">目标市场</label>
              <div className="flex flex-wrap gap-1 mt-1 mb-1.5">
                {MARKET_PICK_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setFitMarket(m.label);
                      patchTradeJourney({ targetMarket: m.label });
                    }}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      fitMarket === m.label
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <input
                value={fitMarket}
                onChange={(e) => {
                  setFitMarket(e.target.value);
                  patchTradeJourney({ targetMarket: e.target.value });
                }}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium"
                placeholder="市场或国家"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400">品类 / 关键词</label>
              <input
                value={fitCategory}
                onChange={(e) => {
                  setFitCategory(e.target.value);
                  patchTradeJourney({ productFocus: e.target.value });
                }}
                className="w-full mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium"
                placeholder="磁力片、泡泡枪、遥控车…"
              />
            </div>
          </div>
          <div
            className={`rounded-xl border px-3 py-2.5 text-[11px] font-medium ${
              fitAdvice.scoreTone === 'emerald'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : fitAdvice.scoreTone === 'rose'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-amber-200 bg-amber-50 text-amber-950'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-black">{fitAdvice.market}</span>
              <span className="font-black">{fitAdvice.scoreLabel}</span>
            </div>
            <p className="leading-snug mb-1.5">{fitAdvice.highlights[0]}</p>
            <p className="text-slate-700 leading-snug">
              <span className="font-black">包装：</span>
              {fitAdvice.packaging[0]}
            </p>
            <p className="text-slate-700 leading-snug mt-1">
              <span className="font-black">功能：</span>
              {fitAdvice.features[0]}
            </p>
            <p className="text-slate-700 leading-snug mt-1">
              <span className="font-black">合规：</span>
              {fitAdvice.compliance[0]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            onClick={() => {
              try {
                downloadCatalogExcelTemplate();
              } catch (e: any) {
                setMsg(e?.message || '下载失败');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black px-3 py-2.5"
          >
            <Download size={14} /> 下载 Excel 模板
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black px-3 py-2.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
            {busy ? '导入中…' : '导入 Excel'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importExcel(f);
              e.target.value = '';
            }}
          />
        </div>
        {msg && (
          <p className="mt-3 text-xs font-bold text-violet-800 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
            {msg}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="font-black text-sm text-slate-800 flex items-center gap-1.5">
            <Plus size={14} /> 手工录入
          </div>
          {(
            [
              ['skuCode', '货号 *'],
              ['name', '品名 *'],
              ['nameEn', '英文名'],
              ['category', '品类'],
              ['factoryPrice', '出厂价'],
              ['moq', 'MOQ'],
              ['currency', '币种'],
              ['specs', '规格'],
              ['supplierName', '供应商'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                {label}
              </label>
              <input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
              产品图（可选）
            </label>
            <button
              type="button"
              onClick={() => imgRef.current?.click()}
              className="w-full min-h-[72px] rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 flex flex-col items-center justify-center gap-1 text-violet-800 text-xs font-black"
            >
              {form.imageDataUrl ? (
                <img src={form.imageDataUrl} alt="" className="max-h-20 object-contain rounded-lg" />
              ) : (
                <>
                  <ImageIcon size={16} /> 上传产品图
                </>
              )}
            </button>
            <input
              ref={imgRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void onManualImage(e.target.files?.[0] || null);
                e.target.value = '';
              }}
            />
          </div>
          <button
            type="button"
            onClick={addSku}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black py-2.5 mt-1"
          >
            添加到产品库
          </button>
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-100 flex flex-wrap gap-2 items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索货号 / 品名 / 品类…"
              className="flex-1 min-w-[160px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <span className="text-[10px] font-bold text-slate-400">
              {filtered.length} / {rows.length}
            </span>
          </div>
          <div className="overflow-x-auto max-h-[32rem]">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-14">图</th>
                  <th className="px-3 py-2">货号</th>
                  <th className="px-3 py-2">品名</th>
                  <th className="px-3 py-2">品类</th>
                  <th className="px-3 py-2">价 / MOQ</th>
                  <th className="px-3 py-2">来源</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2">
                      {r.images?.[0] && !/toysbear\.net/i.test(r.images[0]) ? (
                        <img
                          src={r.images[0]}
                          alt=""
                          className="w-11 h-11 rounded-lg object-cover border border-slate-200 bg-white"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300">
                          <ImageIcon size={14} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-bold">{r.skuCode}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {r.nameEn ? (
                        <span className="block text-[10px] text-slate-400">{r.nameEn}</span>
                      ) : null}
                      {r.colors ? (
                        <span className="block text-[10px] text-slate-400 truncate max-w-[14rem]">
                          {r.colors}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-700">
                      {r.factoryPrice != null ? `${r.currency || ''} ${r.factoryPrice}` : '—'}
                      {r.moq != null ? (
                        <span className="text-slate-400 font-medium"> / MOQ {r.moq}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">
                      {r.source === 'import' ? 'Excel' : r.source}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeSku(r.id)}
                        className="text-slate-300 hover:text-rose-500"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-slate-400 text-sm font-medium">
                      暂无 SKU，请下载模板填写后导入，或手工录入
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
