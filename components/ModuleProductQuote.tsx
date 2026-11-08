import React, { useMemo, useState } from 'react';
import { ChevronRight, FileSpreadsheet, Plus, Trash2, Download } from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus, type CatalogSku } from '../services/productCatalogTypes';
import { type QuoteDoc, type QuoteLine, loadQuotes, saveQuotes } from '../services/quoteTypes';
import { filterOwnedRecords } from '../services/permissions';
import { loadUsersFromStorage } from '../services/auth';
import { loadDepartmentsFromStorage } from '../services/orgStore';
import {
  formatTaxonomyLabel,
  PRODUCT_TAXONOMY_BY_ID,
} from '../data/productTaxonomy';

type Props = {
  currentUser: User;
};

const newId = () => `qt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const UNCATEGORIZED = '__uncategorized__';

type CatOpt = { id: string; label: string; count: number };

const skuRootId = (s: CatalogSku) => {
  if (s.categoryRootId) return s.categoryRootId;
  const l1 = s.categoryL1Id ? PRODUCT_TAXONOMY_BY_ID[s.categoryL1Id] : undefined;
  return l1?.parentId || l1?.rootId || '';
};
const skuL1Id = (s: CatalogSku) => s.categoryL1Id || '';
const skuL2Id = (s: CatalogSku) => s.categoryL2Id || '';

const labelOf = (id: string) => {
  if (id === UNCATEGORIZED) return '未分类';
  return formatTaxonomyLabel(id) || PRODUCT_TAXONOMY_BY_ID[id]?.nameZh || id;
};

const tally = (ids: string[]): CatOpt[] => {
  const map = new Map<string, number>();
  for (const id of ids) map.set(id, (map.get(id) || 0) + 1);
  return [...map.entries()]
    .map(([id, count]) => ({ id, label: labelOf(id), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh'));
};

/** 报价 / 选品单：只读写独立 quote 存储 + 读取产品库，不改 CRM */
export const ModuleProductQuote: React.FC<Props> = ({ currentUser }) => {
  const [quotes, setQuotes] = useState<QuoteDoc[]>(() => loadQuotes());
  /** 报价选品不做全量类目重算，避免打开本页卡顿 */
  const [skus] = useState(() => loadCatalogSkus({ ensureTaxonomy: false }));
  const [title, setTitle] = useState('选品报价单');
  const [clientName, setClientName] = useState('');
  const [markup, setMarkup] = useState('20');
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [pickSku, setPickSku] = useState('');
  const [pickRoot, setPickRoot] = useState('');
  const [pickL1, setPickL1] = useState('');
  const [pickL2, setPickL2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const visibleSkus = useMemo(() => {
    const users = loadUsersFromStorage();
    const depts = loadDepartmentsFromStorage();
    const owned = filterOwnedRecords(currentUser, skus, users, depts);
    // 旧数据无归属时与产品库一致：仍可选用本机 SKU
    return owned.length > 0 ? owned : skus;
  }, [skus, currentUser]);

  const rootOpts = useMemo(
    () =>
      tally(
        visibleSkus.map((s) => {
          const r = skuRootId(s);
          if (r) return r;
          if (skuL1Id(s) || skuL2Id(s)) return UNCATEGORIZED;
          return UNCATEGORIZED;
        })
      ),
    [visibleSkus]
  );

  const afterRoot = useMemo(() => {
    if (!pickRoot) return [] as CatalogSku[];
    if (pickRoot === UNCATEGORIZED) {
      return visibleSkus.filter((s) => !skuRootId(s));
    }
    return visibleSkus.filter((s) => skuRootId(s) === pickRoot);
  }, [visibleSkus, pickRoot]);

  const l1Opts = useMemo(() => {
    if (!pickRoot || pickRoot === UNCATEGORIZED) return [] as CatOpt[];
    return tally(afterRoot.map((s) => skuL1Id(s) || UNCATEGORIZED));
  }, [afterRoot, pickRoot]);

  const afterL1 = useMemo(() => {
    if (!pickL1) return [] as CatalogSku[];
    if (pickL1 === UNCATEGORIZED) return afterRoot.filter((s) => !skuL1Id(s));
    return afterRoot.filter((s) => skuL1Id(s) === pickL1);
  }, [afterRoot, pickL1]);

  const l2Opts = useMemo(() => {
    if (!pickL1) return [] as CatOpt[];
    const ids = afterL1.map((s) => skuL2Id(s) || UNCATEGORIZED);
    // 若全部无二级且只有「未分类」一项，则跳过二级直接出产品
    const opts = tally(ids);
    if (opts.length === 1 && opts[0].id === UNCATEGORIZED) return [] as CatOpt[];
    return opts;
  }, [afterL1, pickL1]);

  const productOpts = useMemo(() => {
    if (pickRoot === UNCATEGORIZED) return afterRoot;
    if (!pickL1) return [] as CatalogSku[];
    if (l2Opts.length === 0) return afterL1;
    if (!pickL2) return [] as CatalogSku[];
    if (pickL2 === UNCATEGORIZED) return afterL1.filter((s) => !skuL2Id(s));
    return afterL1.filter((s) => skuL2Id(s) === pickL2);
  }, [pickRoot, pickL1, pickL2, afterRoot, afterL1, l2Opts.length]);

  const persist = (next: QuoteDoc[]) => {
    setQuotes(next);
    saveQuotes(next);
  };

  const addLine = () => {
    const sku = visibleSkus.find((s) => s.id === pickSku || s.skuCode === pickSku);
    if (!sku) {
      setMsg('请先按类目选出产品，再加入报价行');
      return;
    }
    const unit = sku.factoryPrice != null ? Number(sku.factoryPrice) : 0;
    setLines((prev) => [
      ...prev,
      {
        skuId: sku.id,
        skuCode: sku.skuCode,
        name: sku.name,
        qty: sku.moq || 1,
        unitPrice: unit,
        currency: sku.currency || currency,
      },
    ]);
    setPickSku('');
    setMsg(null);
  };

  const m = Number(markup) || 0;
  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unitPrice * (1 + m / 100), 0),
    [lines, m]
  );

  const saveDraft = () => {
    if (!lines.length) {
      setMsg('请至少添加一行产品');
      return;
    }
    const now = Date.now();
    const doc: QuoteDoc = {
      id: newId(),
      title: title.trim() || '报价单',
      clientName: clientName.trim() || undefined,
      markupPercent: m,
      currency,
      lines,
      status: 'draft',
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
      createdAt: now,
      updatedAt: now,
    };
    persist([doc, ...quotes]);
    setMsg(`已保存草稿「${doc.title}」（独立存储，未改 CRM）`);
    setLines([]);
  };

  const removeQuote = (id: string) => {
    if (!confirm('删除该报价草稿？不影响产品库与 CRM。')) return;
    persist(quotes.filter((q) => q.id !== id));
  };

  const exportTxt = (doc: QuoteDoc) => {
    const factor = 1 + (doc.markupPercent || 0) / 100;
    const body = [
      doc.title,
      `客户: ${doc.clientName || '-'}`,
      `加点: ${doc.markupPercent}%`,
      '',
      ...doc.lines.map(
        (l) =>
          `${l.skuCode}\t${l.name}\t×${l.qty}\t${l.currency} ${(l.unitPrice * factor).toFixed(2)}`
      ),
      '',
      `合计约: ${doc.currency} ${doc.lines
        .reduce((s, l) => s + l.qty * l.unitPrice * factor, 0)
        .toFixed(2)}`,
    ].join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.title.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const selectCls =
    'w-full max-w-full min-w-0 box-border rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white';

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 animate-fade-in px-0 sm:px-1 overflow-x-hidden">
      <div className="rounded-3xl border border-emerald-200/70 bg-white/95 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-emerald-700 font-black text-xs uppercase tracking-widest">
          <FileSpreadsheet size={14} /> Quote
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">报价 / 选品单</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          按您产品库里已有类目层层挑选，再生成报价 / 选品单草稿。
        </p>
        {msg && (
          <p className="mt-3 text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
            {msg}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 min-w-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 min-w-0 overflow-hidden">
          <input
            className="w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="报价单标题"
          />
          <input
            className="w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="客户名称（可选，仅写在报价单上）"
          />
          <div className="flex flex-wrap gap-2">
            <input
              className="w-24 shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              placeholder="加点%"
            />
            <input
              className="w-24 shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </div>

          {/* 类目层层选：每级单独一行，宽度不超出卡片 */}
          <div className="space-y-2 min-w-0 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1 flex-wrap">
              <span>按类目选品</span>
              <span className="text-slate-400">（仅您权限内已有产品的类目 · {visibleSkus.length}）</span>
              {pickRoot ? (
                <>
                  <ChevronRight size={12} className="text-slate-300" />
                  <span className="text-slate-700">{labelOf(pickRoot)}</span>
                </>
              ) : null}
              {pickL1 ? (
                <>
                  <ChevronRight size={12} className="text-slate-300" />
                  <span className="text-slate-700">{labelOf(pickL1)}</span>
                </>
              ) : null}
              {pickL2 ? (
                <>
                  <ChevronRight size={12} className="text-slate-300" />
                  <span className="text-slate-700">{labelOf(pickL2)}</span>
                </>
              ) : null}
            </div>

            <select
              className={selectCls}
              value={pickRoot}
              onChange={(e) => {
                setPickRoot(e.target.value);
                setPickL1('');
                setPickL2('');
                setPickSku('');
              }}
            >
              <option value="">① 选择大类…</option>
              {rootOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}（{o.count}）
                </option>
              ))}
            </select>

            {pickRoot && pickRoot !== UNCATEGORIZED && l1Opts.length > 0 ? (
              <select
                className={selectCls}
                value={pickL1}
                onChange={(e) => {
                  setPickL1(e.target.value);
                  setPickL2('');
                  setPickSku('');
                }}
              >
                <option value="">② 选择一级类目…</option>
                {l1Opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}（{o.count}）
                  </option>
                ))}
              </select>
            ) : null}

            {pickL1 && l2Opts.length > 0 ? (
              <select
                className={selectCls}
                value={pickL2}
                onChange={(e) => {
                  setPickL2(e.target.value);
                  setPickSku('');
                }}
              >
                <option value="">③ 选择二级小类…</option>
                {l2Opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}（{o.count}）
                  </option>
                ))}
              </select>
            ) : null}

            {productOpts.length > 0 ? (
              <div className="flex gap-2 min-w-0 items-stretch">
                <select
                  className={`${selectCls} flex-1`}
                  value={pickSku}
                  onChange={(e) => setPickSku(e.target.value)}
                >
                  <option value="">
                    {pickRoot === UNCATEGORIZED || l2Opts.length === 0 ? '选择产品' : '④ 选择产品'}
                    …（{productOpts.length}）
                  </option>
                  {productOpts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.skuCode} · {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addLine}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-black"
                >
                  <Plus size={14} /> 行
                </button>
              </div>
            ) : pickRoot && pickRoot !== UNCATEGORIZED && !pickL1 && l1Opts.length === 0 ? (
              <p className="text-xs text-slate-400 font-bold">该类目下暂无产品。</p>
            ) : null}
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto min-w-0">
            {lines.length === 0 ? (
              <p className="text-sm text-slate-400 font-bold py-6 text-center">暂无行项目</p>
            ) : (
              lines.map((l, idx) => (
                <div
                  key={`${l.skuId}_${idx}`}
                  className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm min-w-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">
                      {l.skuCode} · {l.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      出厂 {l.currency} {l.unitPrice} → 报价约{' '}
                      {(l.unitPrice * (1 + m / 100)).toFixed(2)}
                    </div>
                  </div>
                  <input
                    type="number"
                    className="w-16 shrink-0 rounded-lg border px-2 py-1 text-xs"
                    value={l.qty}
                    onChange={(e) => {
                      const qty = Number(e.target.value) || 1;
                      setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, qty } : x)));
                    }}
                  />
                  <button
                    type="button"
                    className="text-rose-500 p-1 shrink-0"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t gap-2 min-w-0">
            <div className="font-black text-slate-800 truncate">
              合计约 {currency} {total.toFixed(2)}
            </div>
            <button
              type="button"
              onClick={saveDraft}
              className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black px-4 py-2.5"
            >
              保存草稿
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 min-w-0">
          <div className="font-black text-sm text-slate-800 mb-3">已存报价（{quotes.length}）</div>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {quotes.length === 0 ? (
              <p className="text-sm text-slate-400 font-bold py-8 text-center">尚无草稿</p>
            ) : (
              quotes.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-xl border border-slate-100 px-3 py-3 flex items-start gap-2 min-w-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 truncate">{doc.title}</div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      {doc.clientName || '未填客户'} · {doc.lines.length} 行 · 加点 {doc.markupPercent}% ·{' '}
                      {doc.status}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-600 shrink-0"
                    title="导出文本"
                    onClick={() => exportTxt(doc)}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 shrink-0"
                    onClick={() => removeQuote(doc.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
