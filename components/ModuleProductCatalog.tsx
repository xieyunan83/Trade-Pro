import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, Warehouse, Upload } from 'lucide-react';
import type { User } from '../types';
import {
  type CatalogSku,
  loadCatalogSkus,
  saveCatalogSkus,
} from '../services/productCatalogTypes';

type Props = {
  currentUser: User;
};

const newId = () => `sku_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** 产品库：本地 SKU 录入/导入（小竹熊/霄鸟云同步在管理后台） */
export const ModuleProductCatalog: React.FC<Props> = ({ currentUser }) => {
  const [rows, setRows] = useState<CatalogSku[]>(() => loadCatalogSkus());
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
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
  });

  const persist = useCallback((next: CatalogSku[]) => {
    setRows(next);
    saveCatalogSkus(next);
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
        (r.supplierName || '').toLowerCase().includes(s)
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
      images: [],
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
    persist([sku, ...rows]);
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
    });
    setMsg(`已添加 ${sku.skuCode}（仅写入产品库，不影响 CRM）`);
  };

  const removeSku = (id: string) => {
    if (!confirm('从产品库删除该 SKU？不会删除 CRM 或背调记录。')) return;
    persist(rows.filter((r) => r.id !== id));
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '[]'));
        const list = Array.isArray(parsed) ? parsed : parsed?.items;
        if (!Array.isArray(list) || !list.length) {
          setMsg('JSON 需为 SKU 数组或 { items: [] }');
          return;
        }
        const now = Date.now();
        const incoming: CatalogSku[] = list.map((raw: any, i: number) => ({
          id: String(raw.id || newId() + i),
          skuCode: String(raw.skuCode || raw.sku || `IMPORT-${i + 1}`),
          name: String(raw.name || raw.title || '未命名'),
          nameEn: raw.nameEn ? String(raw.nameEn) : undefined,
          category: raw.category ? String(raw.category) : undefined,
          images: Array.isArray(raw.images) ? raw.images.map(String) : [],
          specs: raw.specs ? String(raw.specs) : undefined,
          moq: raw.moq != null ? Number(raw.moq) : undefined,
          currency: String(raw.currency || 'USD'),
          factoryPrice: raw.factoryPrice != null ? Number(raw.factoryPrice) : undefined,
          packing: raw.packing ? String(raw.packing) : undefined,
          supplierName: raw.supplierName ? String(raw.supplierName) : undefined,
          source: 'import' as const,
          externalId: raw.externalId ? String(raw.externalId) : undefined,
          ownerUsername: currentUser.username,
          departmentId: currentUser.departmentId,
          createdAt: now,
          updatedAt: now,
        }));
        const byCode = new Map(rows.map((r) => [r.skuCode.toLowerCase(), r]));
        for (const s of incoming) byCode.set(s.skuCode.toLowerCase(), s);
        persist([...byCode.values()]);
        setMsg(`已导入/合并 ${incoming.length} 条到产品库（独立存储）`);
      } catch (e: any) {
        setMsg(`导入失败：${e?.message || e}`);
      }
    };
    reader.readAsText(file);
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
              SKU 存在独立键 <code className="text-xs bg-slate-100 px-1 rounded">trade_scout_product_catalog_v1</code>
              ，与 CRM / 背调历史隔离。小竹熊、霄鸟云同步由管理员在「系统管理 → 数据接入」配置与触发。
            </p>
          </div>
          <div className="text-right text-sm font-black text-slate-700">{rows.length} 款</div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black px-3 py-2.5 cursor-pointer">
            <Upload size={14} /> 导入 JSON
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {msg && <p className="mt-3 text-xs font-bold text-violet-800 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">{msg}</p>}
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
            <span className="text-[10px] font-bold text-slate-400">{filtered.length} / {rows.length}</span>
          </div>
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500 sticky top-0">
                <tr>
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
                    <td className="px-3 py-2 font-mono text-xs font-bold">{r.skuCode}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {r.nameEn ? <span className="block text-[10px] text-slate-400">{r.nameEn}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-xs font-bold text-slate-700">
                      {r.factoryPrice != null ? `${r.currency || ''} ${r.factoryPrice}` : '—'}
                      {r.moq != null ? <span className="text-slate-400 font-medium"> / MOQ {r.moq}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">{r.source}</td>
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
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-400 text-sm font-medium">
                      暂无 SKU，请手工录入或导入 JSON
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
