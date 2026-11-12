import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus, type CatalogSku } from '../services/productCatalogTypes';
import {
  type QuoteDoc,
  type QuoteLine,
  type QuoteCompanyProfile,
  loadQuotes,
  saveQuotes,
  getCompanyProfileForUser,
  saveCompanyProfile,
  defaultCompanyProfile,
  createBlankQuote,
  quoteLineFromSku,
  applyLineLogistics,
  calcCbmCft,
  sumQuoteVolumeCbm,
  sumQuoteAmount,
  containerFillRatio,
  addDaysYmd,
  newLineId,
} from '../services/quoteTypes';
import { exportQuoteExcel } from '../services/quoteExcelExport';
import { trackOpsEvent } from '../services/userOpsLog';
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

type View = 'list' | 'edit' | 'profile';

const skuRootId = (s: CatalogSku) => {
  if (s.categoryRootId) return s.categoryRootId;
  const l1 = s.categoryL1Id ? PRODUCT_TAXONOMY_BY_ID[s.categoryL1Id] : undefined;
  return l1?.parentId || l1?.rootId || '';
};

const money = (n: number, currency: string) =>
  `${currency} ${(Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  })}`;

/** 外贸报价：列表 / 编辑 / 公司抬头；从产品库快速加货并导出英文 Excel */
export const ModuleProductQuote: React.FC<Props> = ({ currentUser }) => {
  const [view, setView] = useState<View>('list');
  const [quotes, setQuotes] = useState<QuoteDoc[]>(() => loadQuotes());
  const [skus, setSkus] = useState<CatalogSku[]>(() => loadCatalogSkus({ ensureTaxonomy: false }));
  const [draft, setDraft] = useState<QuoteDoc | null>(null);
  const [profile, setProfile] = useState<QuoteCompanyProfile>(() =>
    getCompanyProfileForUser(currentUser.username)
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [skuSearch, setSkuSearch] = useState('');
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
  const [listSearch, setListSearch] = useState('');

  useEffect(() => {
    setProfile(getCompanyProfileForUser(currentUser.username));
  }, [currentUser.username]);

  const visibleSkus = useMemo(() => {
    const users = loadUsersFromStorage();
    const depts = loadDepartmentsFromStorage();
    const owned = filterOwnedRecords(currentUser, skus, users, depts);
    return owned.length > 0 ? owned : skus;
  }, [skus, currentUser]);

  const myQuotes = useMemo(() => {
    const users = loadUsersFromStorage();
    const depts = loadDepartmentsFromStorage();
    return filterOwnedRecords(currentUser, quotes, users, depts);
  }, [quotes, currentUser]);

  const filteredQuotes = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return myQuotes;
    return myQuotes.filter(
      (d) =>
        d.quoteNo.toLowerCase().includes(q) ||
        (d.clientName || '').toLowerCase().includes(q) ||
        (d.attn || '').toLowerCase().includes(q) ||
        (d.title || '').toLowerCase().includes(q)
    );
  }, [myQuotes, listSearch]);

  const persistQuotes = (next: QuoteDoc[]) => {
    setQuotes(next);
    saveQuotes(next);
  };

  const refreshSkus = () => {
    setSkus(loadCatalogSkus({ ensureTaxonomy: false }));
    setMsg('已刷新产品库');
  };

  const openNew = () => {
    const doc = createBlankQuote(quotes, profile, {
      username: currentUser.username,
      departmentId: currentUser.departmentId,
    });
    setDraft(doc);
    setSelectedSkuIds(new Set());
    setSkuSearch('');
    setView('edit');
    setMsg(null);
  };

  const openEdit = (doc: QuoteDoc) => {
    setDraft({ ...doc, lines: doc.lines.map((l) => ({ ...l })) });
    setSelectedSkuIds(new Set());
    setSkuSearch('');
    setView('edit');
    setMsg(null);
  };

  const duplicateQuote = (doc: QuoteDoc) => {
    const blank = createBlankQuote(quotes, profile, {
      username: currentUser.username,
      departmentId: currentUser.departmentId,
    });
    const copy: QuoteDoc = {
      ...blank,
      title: `${doc.title || '报价单'}（副本）`,
      clientName: doc.clientName,
      attn: doc.attn,
      currency: doc.currency,
      exchangeRate: doc.exchangeRate,
      commissionPercent: doc.commissionPercent,
      priceType: doc.priceType,
      tradeTerm: doc.tradeTerm,
      portOfLoading: doc.portOfLoading,
      containerType: doc.containerType,
      paymentTerms: doc.paymentTerms,
      externalRemarks: doc.externalRemarks,
      priceBasisText: doc.priceBasisText,
      lines: doc.lines.map((l) => ({ ...l, id: newLineId() })),
    };
    setDraft(copy);
    setView('edit');
    setMsg('已复制为新单，请核对后保存');
  };

  const removeQuote = (id: string) => {
    if (!confirm('删除该报价单？不影响产品库。')) return;
    persistQuotes(quotes.filter((q) => q.id !== id));
    if (draft?.id === id) {
      setDraft(null);
      setView('list');
    }
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.lines.length) {
      setMsg('请至少加入一款产品');
      return;
    }
    if (!profile.companyName.trim()) {
      setMsg('请先在「公司抬头」填写公司名称（导出 Excel 会用到）');
      setView('profile');
      return;
    }
    const now = Date.now();
    const nextDoc: QuoteDoc = {
      ...draft,
      validUntil: addDaysYmd(draft.quoteDate, draft.validDays || 30),
      updatedAt: now,
      ownerUsername: draft.ownerUsername || currentUser.username,
      departmentId: draft.departmentId || currentUser.departmentId,
    };
    const exists = quotes.some((q) => q.id === nextDoc.id);
    const next = exists
      ? quotes.map((q) => (q.id === nextDoc.id ? nextDoc : q))
      : [nextDoc, ...quotes];
    persistQuotes(next);
    setDraft(nextDoc);
    trackOpsEvent(currentUser.username, 'quote', `保存报价 ${nextDoc.quoteNo}`, {
      meta: `${nextDoc.lines.length} 款`,
    });
    setMsg(`已保存 ${nextDoc.quoteNo}`);
  };

  const patchDraft = (patch: Partial<QuoteDoc>) => {
    setDraft((d) => (d ? { ...d, ...patch, updatedAt: Date.now() } : d));
  };

  const patchLine = (lineId: string, patch: Partial<QuoteLine>) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        lines: d.lines.map((l) => {
          if (l.id !== lineId) return l;
          const merged = { ...l, ...patch };
          if (
            patch.ctnL != null ||
            patch.ctnW != null ||
            patch.ctnH != null ||
            patch.ctnL === undefined
          ) {
            const { cbm, cft } = calcCbmCft(merged.ctnL, merged.ctnW, merged.ctnH);
            if (patch.cbm == null) merged.cbm = cbm;
            if (patch.cft == null) merged.cft = cft;
          }
          return applyLineLogistics(merged);
        }),
        updatedAt: Date.now(),
      };
    });
  };

  const removeLine = (lineId: string) => {
    setDraft((d) =>
      d ? { ...d, lines: d.lines.filter((l) => l.id !== lineId), updatedAt: Date.now() } : d
    );
  };

  const addSkusToDraft = (list: CatalogSku[]) => {
    if (!draft || !list.length) return;
    const existing = new Set(draft.lines.map((l) => l.skuId));
    const toAdd = list.filter((s) => !existing.has(s.id));
    if (!toAdd.length) {
      setMsg('所选产品已在报价明细中');
      return;
    }
    const lines = toAdd.map((s) =>
      quoteLineFromSku(s, {
        currency: draft.currency,
        commissionPercent: draft.commissionPercent,
      })
    );
    setDraft({ ...draft, lines: [...draft.lines, ...lines], updatedAt: Date.now() });
    setSelectedSkuIds(new Set());
    setMsg(`已加入 ${lines.length} 款产品`);
  };

  const searchedSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    let list = visibleSkus;
    if (q) {
      list = list.filter(
        (s) =>
          s.skuCode.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.nameEn || '').toLowerCase().includes(q) ||
          (s.supplierName || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 80);
  }, [visibleSkus, skuSearch]);

  const totalCbm = draft ? sumQuoteVolumeCbm(draft.lines) : 0;
  const totalAmt = draft ? sumQuoteAmount(draft.lines) : 0;
  const fill = draft ? containerFillRatio(totalCbm, draft.containerType) : null;

  const onExport = async (doc?: QuoteDoc | null) => {
    const target = doc || draft;
    if (!target?.lines.length) {
      setMsg('没有可导出的产品行');
      return;
    }
    if (!profile.companyName.trim()) {
      setMsg('请先填写公司抬头');
      setView('profile');
      return;
    }
    setExporting(true);
    try {
      await exportQuoteExcel(target, profile);
      setMsg(`已导出 Excel：${target.quoteNo}`);
    } catch (e: any) {
      setMsg(e?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const saveProfile = () => {
    const next = { ...profile, username: currentUser.username, updatedAt: Date.now() };
    saveCompanyProfile(next);
    setProfile(next);
    setMsg('公司抬头已保存（按当前登录账号区分）');
  };

  const repriceFromFactory = () => {
    if (!draft) return;
    const c = draft.commissionPercent || 0;
    setDraft({
      ...draft,
      lines: draft.lines.map((l) => {
        if (l.factoryPrice == null || !(l.factoryPrice > 0)) return l;
        return {
          ...l,
          unitPrice: Math.round(l.factoryPrice * (1 + c / 100) * 1000) / 1000,
        };
      }),
      updatedAt: Date.now(),
    });
    setMsg(`已按佣金 ${c}% 重算出厂加点价`);
  };

  return (
    <div className="w-full space-y-4 sm:space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600 space-y-1">
        <p>
          从产品库勾选货号 → 自动带出装箱/外箱/毛净重/图片 → 一键导出英文 FOB 报价 Excel（对齐公司现用样表）。
        </p>
        <p className="text-slate-500">
          公司名称、地址、电话、邮箱按登录账号保存；换业务员抬头自动切换。CBM/CFT
          由外箱尺寸自动计算，可手改。
        </p>
      </div>

      {msg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-900 flex items-start justify-between gap-3">
          <span>{msg}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-emerald-700">
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm w-full sm:w-fit">
        {(
          [
            ['list', '报价单'],
            ['edit', draft ? `编辑 ${draft.quoteNo}` : '新建/编辑'],
            ['profile', '公司抬头'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              if (key === 'edit' && !draft) openNew();
              else setView(key);
            }}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
              view === key ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'list' && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-900">外贸报价单</h3>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                共 {myQuotes.length} 单 · 产品库 {visibleSkus.length} SKU
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refreshSkus}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-600"
              >
                <RefreshCw size={14} /> 刷新产品库
              </button>
              <button
                type="button"
                onClick={openNew}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black"
              >
                <Plus size={14} /> 新建报价
              </button>
            </div>
          </div>

          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="搜索单号 / 客户 / Attn…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
            />
          </div>

          <div className="rounded-2xl border border-slate-100 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[780px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="px-4 py-3">报价单号</th>
                  <th className="px-4 py-3">客户</th>
                  <th className="px-4 py-3">日期</th>
                  <th className="px-4 py-3">币种</th>
                  <th className="px-4 py-3">款数</th>
                  <th className="px-4 py-3">CBM</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 w-40">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredQuotes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-14 text-center">
                      <p className="text-slate-500 font-bold text-sm">还没有报价单</p>
                      <button
                        type="button"
                        onClick={openNew}
                        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black"
                      >
                        <Plus size={14} /> 新建第一单
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredQuotes.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-sm font-black text-slate-900">{q.quoteNo}</td>
                      <td className="px-4 py-3 text-sm font-bold text-slate-700">
                        {q.clientName || '—'}
                        {q.attn ? (
                          <div className="text-[10px] text-slate-400 font-bold">Attn: {q.attn}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-500">{q.quoteDate}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-600">{q.currency}</td>
                      <td className="px-4 py-3 text-sm font-bold text-slate-700">{q.lines.length}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-600">
                        {sumQuoteVolumeCbm(q.lines).toFixed(3)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-700">
                          {q.status === 'draft'
                            ? '草稿'
                            : q.status === 'sent'
                              ? '已发送'
                              : q.status === 'accepted'
                                ? '已接受'
                                : '过期'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="编辑"
                            onClick={() => openEdit(q)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            title="复制"
                            onClick={() => duplicateQuote(q)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            title="导出 Excel"
                            onClick={() => void onExport(q)}
                            className="p-1.5 rounded-lg text-cyan-600 hover:bg-cyan-50"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            type="button"
                            title="删除"
                            onClick={() => removeQuote(q.id)}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'profile' && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-4 max-w-3xl">
          <div className="flex items-center gap-2">
            <Settings2 size={18} className="text-slate-700" />
            <h3 className="text-lg font-black text-slate-900">公司抬头（账号：{currentUser.username}）</h3>
          </div>
          <p className="text-[11px] font-bold text-slate-500">
            不同业务员可填各自公司/分公司信息；导出 Excel 抬头按当前登录用户读取。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                ['companyName', '公司英文名 *'],
                ['companyNameZh', '公司中文名'],
                ['address', '地址'],
                ['tel', '电话'],
                ['fax', '传真'],
                ['email', '邮箱'],
                ['website', '网站'],
                ['defaultPort', '默认起运港'],
                ['defaultTradeTerm', '默认价格条款'],
                ['defaultCurrency', '默认币种'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {label}
                </span>
                <input
                  value={(profile as any)[key] || ''}
                  onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                />
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                默认佣金 %
              </span>
              <input
                type="number"
                value={profile.defaultCommissionPercent}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    defaultCommissionPercent: Number(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              默认付款方式
            </span>
            <textarea
              value={profile.defaultPaymentTerms}
              onChange={(e) => setProfile({ ...profile, defaultPaymentTerms: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              默认价条款说明（英文）
            </span>
            <textarea
              value={profile.defaultPriceBasisText}
              onChange={(e) => setProfile({ ...profile, defaultPriceBasisText: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveProfile}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black"
            >
              <Save size={14} /> 保存抬头
            </button>
            <button
              type="button"
              onClick={() => setProfile(defaultCompanyProfile(currentUser.username))}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-black text-slate-600"
            >
              清空重填
            </button>
          </div>
        </div>
      )}

      {view === 'edit' && draft && (
        <div className="space-y-4">
          {/* 表头 */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-cyan-600" />
                  {draft.quoteNo}
                </h3>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  {profile.companyName || '（未设公司抬头）'} · {draft.tradeTerm}{' '}
                  {draft.portOfLoading}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveDraft}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black"
                >
                  <Save size={14} /> 保存
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void onExport()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 text-white text-xs font-black disabled:opacity-50"
                >
                  <Download size={14} /> {exporting ? '导出中…' : '导出 Excel'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="客户">
                <input
                  value={draft.clientName || ''}
                  onChange={(e) => patchDraft({ clientName: e.target.value })}
                  className="field"
                  placeholder="客户简称"
                />
              </Field>
              <Field label="Attn">
                <input
                  value={draft.attn || ''}
                  onChange={(e) => patchDraft({ attn: e.target.value })}
                  className="field"
                  placeholder="收件人"
                />
              </Field>
              <Field label="报价日期">
                <input
                  type="date"
                  value={draft.quoteDate}
                  onChange={(e) => {
                    const quoteDate = e.target.value;
                    patchDraft({
                      quoteDate,
                      validUntil: addDaysYmd(quoteDate, draft.validDays || 30),
                    });
                  }}
                  className="field"
                />
              </Field>
              <Field label="有效天数">
                <input
                  type="number"
                  value={draft.validDays}
                  onChange={(e) => {
                    const validDays = Number(e.target.value) || 30;
                    patchDraft({
                      validDays,
                      validUntil: addDaysYmd(draft.quoteDate, validDays),
                    });
                  }}
                  className="field"
                />
              </Field>
              <Field label="币种">
                <select
                  value={draft.currency}
                  onChange={(e) => patchDraft({ currency: e.target.value })}
                  className="field"
                >
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                  <option value="EUR">EUR</option>
                </select>
              </Field>
              <Field label="汇率">
                <input
                  type="number"
                  step="0.0001"
                  value={draft.exchangeRate}
                  onChange={(e) => patchDraft({ exchangeRate: Number(e.target.value) || 1 })}
                  className="field"
                />
              </Field>
              <Field label="佣金/加点 %">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={draft.commissionPercent}
                    onChange={(e) =>
                      patchDraft({ commissionPercent: Number(e.target.value) || 0 })
                    }
                    className="field"
                  />
                  <button
                    type="button"
                    onClick={repriceFromFactory}
                    className="shrink-0 px-2 rounded-xl border border-slate-200 text-[10px] font-black text-slate-600"
                    title="按出厂价×(1+佣金%)重算行单价"
                  >
                    重算
                  </button>
                </div>
              </Field>
              <Field label="价格条款">
                <input
                  value={draft.tradeTerm}
                  onChange={(e) => patchDraft({ tradeTerm: e.target.value })}
                  className="field"
                />
              </Field>
              <Field label="起运港">
                <input
                  value={draft.portOfLoading}
                  onChange={(e) => patchDraft({ portOfLoading: e.target.value })}
                  className="field"
                />
              </Field>
              <Field label="柜型">
                <select
                  value={draft.containerType}
                  onChange={(e) => patchDraft({ containerType: e.target.value })}
                  className="field"
                >
                  <option value="20GP">20GP</option>
                  <option value="40GP">40GP</option>
                  <option value="40HQ">40HQ</option>
                  <option value="LCL">LCL</option>
                </select>
              </Field>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                价条款说明（导出第 5 行）
              </span>
              <textarea
                value={draft.priceBasisText}
                onChange={(e) => patchDraft({ priceBasisText: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  付款方式
                </span>
                <textarea
                  value={draft.paymentTerms}
                  onChange={(e) => patchDraft({ paymentTerms: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  对外备注
                </span>
                <textarea
                  value={draft.externalRemarks}
                  onChange={(e) => patchDraft({ externalRemarks: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4 text-xs font-black text-slate-600 bg-slate-50 rounded-xl px-4 py-3">
              <span>
                款数 <b className="text-slate-900">{draft.lines.length}</b>
              </span>
              <span>
                合计 CBM <b className="text-slate-900">{totalCbm.toFixed(3)}</b>
              </span>
              <span>
                参考金额 <b className="text-slate-900">{money(totalAmt, draft.currency)}</b>
              </span>
              {fill != null ? (
                <span>
                  {draft.containerType} 装载约{' '}
                  <b className={fill > 100 ? 'text-rose-600' : 'text-emerald-700'}>{fill}%</b>
                </span>
              ) : null}
            </div>
          </div>

          {/* 快速选品 */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-cyan-200 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-black text-slate-900">快速选品（比逐级点选更快）</h4>
              <button
                type="button"
                disabled={!selectedSkuIds.size}
                onClick={() => {
                  const list = visibleSkus.filter((s) => selectedSkuIds.has(s.id));
                  addSkusToDraft(list);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-40"
              >
                <Plus size={14} /> 加入已勾选 ({selectedSkuIds.size})
              </button>
            </div>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchedSkus[0]) {
                    e.preventDefault();
                    addSkusToDraft([searchedSkus[0]]);
                  }
                }}
                placeholder="搜货号 / 中英文名 / 工厂，回车加入第一条…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
              {searchedSkus.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs font-bold text-slate-400">
                  无匹配产品。请先在「产品库」导入或录入。
                </p>
              ) : (
                searchedSkus.map((s) => {
                  const checked = selectedSkuIds.has(s.id);
                  const already = draft.lines.some((l) => l.skuId === s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 ${
                        already ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={already}
                        checked={checked}
                        onChange={() => {
                          setSelectedSkuIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          });
                        }}
                      />
                      {s.images?.[0] ? (
                        <img
                          src={s.images[0]}
                          alt=""
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-slate-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-black text-slate-800 truncate">
                          {s.skuCode} · {s.nameEn || s.name}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 truncate">
                          {[
                            s.factoryPrice != null && `出厂 ${s.factoryPrice}`,
                            s.cartonQty && `装 ${s.cartonQty}`,
                            s.cartonSpec,
                            formatTaxonomyLabel(skuRootId(s) || s.categoryL1Id || ''),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {already ? ' · 已在单内' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={already}
                        onClick={(e) => {
                          e.preventDefault();
                          addSkusToDraft([s]);
                        }}
                        className="text-[10px] font-black text-cyan-700 disabled:opacity-40"
                      >
                        加入 <ChevronRight size={12} className="inline" />
                      </button>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* 明细 */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-3">
            <h4 className="text-sm font-black text-slate-900">商品清单</h4>
            <div className="rounded-2xl border border-slate-100 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    <th className="px-3 py-2">图</th>
                    <th className="px-3 py-2">货号</th>
                    <th className="px-3 py-2">英文描述</th>
                    <th className="px-3 py-2">包装</th>
                    <th className="px-3 py-2">装量</th>
                    <th className="px-3 py-2">内盒</th>
                    <th className="px-3 py-2">单价</th>
                    <th className="px-3 py-2">外箱 L/W/H</th>
                    <th className="px-3 py-2">CBM</th>
                    <th className="px-3 py-2">G.W.</th>
                    <th className="px-3 py-2">N.W.</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {draft.lines.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-6 py-10 text-center text-sm font-bold text-slate-400">
                        从上方搜索加入产品
                      </td>
                    </tr>
                  ) : (
                    draft.lines.map((l) => (
                      <tr key={l.id} className="align-top">
                        <td className="px-3 py-2">
                          {l.imageDataUrl ? (
                            <img
                              src={l.imageDataUrl}
                              alt=""
                              className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-slate-100" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-black text-slate-800 whitespace-nowrap">
                          {l.skuCode}
                        </td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <input
                            value={l.nameEn}
                            onChange={(e) => patchLine(l.id, { nameEn: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={l.packing || ''}
                            onChange={(e) => patchLine(l.id, { packing: e.target.value })}
                            className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={l.cartonQty || ''}
                            onChange={(e) =>
                              patchLine(l.id, { cartonQty: Number(e.target.value) || 0 })
                            }
                            className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={l.innerBox || ''}
                            onChange={(e) =>
                              patchLine(l.id, { innerBox: Number(e.target.value) || 0 })
                            }
                            className="w-14 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.001"
                            value={l.unitPrice}
                            onChange={(e) =>
                              patchLine(l.id, { unitPrice: Number(e.target.value) || 0 })
                            }
                            className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-black text-rose-700"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {(['ctnL', 'ctnW', 'ctnH'] as const).map((k) => (
                              <input
                                key={k}
                                type="number"
                                step="0.1"
                                value={(l as any)[k] ?? ''}
                                onChange={(e) =>
                                  patchLine(l.id, {
                                    [k]: e.target.value === '' ? undefined : Number(e.target.value),
                                  })
                                }
                                className="w-14 px-1.5 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold"
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs font-bold text-slate-700">
                          {l.cbm?.toFixed?.(3) ?? l.cbm ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={l.gwKg ?? ''}
                            onChange={(e) =>
                              patchLine(l.id, {
                                gwKg: e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                            className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={l.nwKg ?? ''}
                            onChange={(e) =>
                              patchLine(l.id, {
                                nwKg: e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                            className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .field {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border-radius: 0.75rem;
          border: 1px solid #e2e8f0;
          font-size: 0.875rem;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
    {children}
  </label>
);
