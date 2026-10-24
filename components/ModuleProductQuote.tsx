import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Plus, Trash2, Download } from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { type QuoteDoc, type QuoteLine, loadQuotes, saveQuotes } from '../services/quoteTypes';

type Props = {
  currentUser: User;
};

const newId = () => `qt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** 报价 / 选品单：只读写独立 quote 存储 + 读取产品库，不改 CRM */
export const ModuleProductQuote: React.FC<Props> = ({ currentUser }) => {
  const [quotes, setQuotes] = useState<QuoteDoc[]>(() => loadQuotes());
  const [skus] = useState(() => loadCatalogSkus());
  const [title, setTitle] = useState('选品报价单');
  const [clientName, setClientName] = useState('');
  const [markup, setMarkup] = useState('20');
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [pickSku, setPickSku] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const persist = (next: QuoteDoc[]) => {
    setQuotes(next);
    saveQuotes(next);
  };

  const addLine = () => {
    const sku = skus.find((s) => s.id === pickSku || s.skuCode === pickSku);
    if (!sku) {
      setMsg('请先在产品库添加 SKU，再选择加入报价行');
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
    setMsg(null);
  };

  const m = Number(markup) || 0;
  const total = useMemo(
    () =>
      lines.reduce((sum, l) => sum + l.qty * l.unitPrice * (1 + m / 100), 0),
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

  return (
    <div className="max-w-[90rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-emerald-200/70 bg-white/95 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-emerald-700 font-black text-xs uppercase tracking-widest">
          <FileSpreadsheet size={14} /> Quote
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">报价 / 选品单</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          从「我方产品库」挑款生成报价草稿。存储键{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">trade_scout_quotes_v1</code>
          ，与客户 CRM 隔离。
        </p>
        {msg && (
          <p className="mt-3 text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
            {msg}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="报价单标题"
          />
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="客户名称（可选，仅写在报价单上）"
          />
          <div className="flex gap-2">
            <input
              className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              placeholder="加点%"
            />
            <input
              className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
            <select
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={pickSku}
              onChange={(e) => setPickSku(e.target.value)}
            >
              <option value="">从产品库选择…（{skus.length}）</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.skuCode} · {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-black"
            >
              <Plus size={14} /> 行
            </button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {lines.length === 0 ? (
              <p className="text-sm text-slate-400 font-bold py-6 text-center">暂无行项目</p>
            ) : (
              lines.map((l, idx) => (
                <div
                  key={`${l.skuId}_${idx}`}
                  className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
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
                    className="w-16 rounded-lg border px-2 py-1 text-xs"
                    value={l.qty}
                    onChange={(e) => {
                      const qty = Number(e.target.value) || 1;
                      setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, qty } : x)));
                    }}
                  />
                  <button
                    type="button"
                    className="text-rose-500 p-1"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="font-black text-slate-800">
              合计约 {currency} {total.toFixed(2)}
            </div>
            <button
              type="button"
              onClick={saveDraft}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black px-4 py-2.5"
            >
              保存草稿
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="font-black text-sm text-slate-800 mb-3">已存报价（{quotes.length}）</div>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {quotes.length === 0 ? (
              <p className="text-sm text-slate-400 font-bold py-8 text-center">尚无草稿</p>
            ) : (
              quotes.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-xl border border-slate-100 px-3 py-3 flex items-start gap-2"
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
                    className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-600"
                    title="导出文本"
                    onClick={() => exportTxt(doc)}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"
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
