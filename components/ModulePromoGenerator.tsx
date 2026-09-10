import React, { useEffect, useMemo, useState } from 'react';
import {
  AutomationPipelineConfig,
  AutomationResult,
  Client,
  CLIENT_TYPE_OPTIONS,
  HistoryItem,
} from '../types';
import {
  Ruler,
  PlayCircle,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Clock,
  Hourglass,
  FileText,
  Download,
  X,
  ListChecks,
  Search,
  Building2,
  Users,
  ShieldCheck,
  FileSpreadsheet,
  PackageSearch,
} from 'lucide-react';
import { ContinentCountryMultiSelect } from './ContinentCountryMultiSelect';
import { findCountryByEn } from '../data/countriesByContinent';
import { exportAutomationResultsToExcel } from '../services/exportService';
import { formatBackgroundCheckTime } from '../utils/crmHistory';
import { IndustryMultiSelect } from './IndustryMultiSelect';
import { PaginationBar } from './PaginationBar';
import { maskEmailAddress } from '../services/permissions';
import { DmStatusChip } from './DmStatusChip';
import { buildPromoListRows, type PromoListRow } from '../utils/promoListRows';

interface ModulePromoGeneratorProps {
  onStartAutomation: (config: AutomationPipelineConfig) => void;
  automationResults: AutomationResult[];
  /** 与客户管理同步：合并 CRM 客户并统一状态 */
  crmClients?: Client[];
  history?: HistoryItem[];
  isAutomating: boolean;
  onRunPending: () => void;
  onRunSingle: (id: string) => void;
  /** 对已完成任务再次背调 */
  onRerunCompleted?: (id: string) => void;
  onDelete: (id: string) => void;
  onViewResult: (task: AutomationResult) => void;
  onOpenClient?: (client: Client) => void;
  onOpenHistoryItem?: (item: HistoryItem) => void;
  onDownloadResult: (task: AutomationResult) => void;
  onDownloadAll: () => void;
  canExportPpt?: boolean;
  onClearCompleted: () => void;
  onClearAll: () => void;
  /** 从本机 IndexedDB 重新加载并修复队列 */
  onReloadQueue?: () => void;
  canDmMine?: boolean;
  canCrmImport?: boolean;
  canProductDig?: boolean;
  /** 批量决策人挖掘（队列任务 + CRM 行） */
  onBatchDmSearch?: (rows: PromoListRow[]) => void;
  /** 批量加入 CRM（仅队列已完成且未入 CRM） */
  onBatchAddToCrm?: (tasks: AutomationResult[]) => void;
  /** 批量补做品类 */
  onBatchProductDig?: (rows: PromoListRow[]) => void;
  /** 普通员工邮箱脱敏 */
  canViewEmails?: boolean;
}

const PER_COUNTRY_OPTIONS = [3, 5, 8, 10, 12, 15];

const emptyDraft = (): Omit<AutomationPipelineConfig, never> => ({
  keyword: '',
  industry: '',
  clientTypes: ['Importer'],
  countries: ['United States', 'United Kingdom', 'Germany'],
  perCountryLimit: 5,
  productContext: '',
  doBackgroundCheck: true,
  doDmMine: false,
  doCrmImport: false,
});

const StatusMini: React.FC<{ done: boolean; yes: string; no: string; tone: 'emerald' | 'teal' | 'violet' }> = ({
  done,
  yes,
  no,
  tone,
}) => {
  const on =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : tone === 'teal'
        ? 'bg-teal-50 text-teal-700 border-teal-100'
        : 'bg-violet-50 text-violet-700 border-violet-100';
  const off = 'bg-slate-100 text-slate-400 border-slate-200';
  return (
    <span className={`inline-flex text-[9px] font-black border px-1.5 py-0.5 rounded ${done ? on : off}`}>
      {done ? yes : no}
    </span>
  );
};

export const ModulePromoGenerator: React.FC<ModulePromoGeneratorProps> = ({
  onStartAutomation,
  automationResults,
  crmClients = [],
  history = [],
  isAutomating,
  onRunPending,
  onRunSingle,
  onRerunCompleted,
  onDelete,
  onViewResult,
  onOpenClient,
  onOpenHistoryItem,
  onDownloadResult,
  onDownloadAll,
  canExportPpt = false,
  onClearCompleted,
  onClearAll,
  onReloadQueue,
  canDmMine = false,
  canCrmImport = false,
  canProductDig = false,
  onBatchDmSearch,
  onBatchAddToCrm,
  onBatchProductDig,
  canViewEmails = false,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<AutomationPipelineConfig>(emptyDraft);
  const [confirming, setConfirming] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | AutomationResult['status'] | 'crm'>('all');
  const [filterCountry, setFilterCountry] = useState('all');
  const [filterKeyword, setFilterKeyword] = useState('all');
  const [filterMode, setFilterMode] = useState<'all' | 'detailed' | 'economy'>('all');
  const [filterIndustry, setFilterIndustry] = useState('all');
  const [filterBg, setFilterBg] = useState<'all' | 'yes' | 'no'>('all');
  const [filterProduct, setFilterProduct] = useState<'all' | 'yes' | 'no'>('all');
  const [filterDm, setFilterDm] = useState<'all' | 'yes' | 'found' | 'empty' | 'no'>('all');
  const [filterCrm, setFilterCrm] = useState<'all' | 'yes' | 'no'>('all');
  const [filterOwner, setFilterOwner] = useState('all');
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);
  const [page, setPage] = useState(1);

  const allRows = useMemo(
    () => buildPromoListRows(automationResults, crmClients, history),
    [automationResults, crmClients, history]
  );

  const completedCount = automationResults.filter((r) => r.status === 'completed' && r.analysis).length;
  const crmOnlyCount = allRows.filter((r) => r.source === 'crm').length;

  const countryOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.country).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allRows]
  );

  const keywordOptions = useMemo(
    () =>
      Array.from(new Set(allRows.flatMap((r) => r.keywords))).sort((a, b) => a.localeCompare(b)),
    [allRows]
  );

  const industryOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.industry).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'zh')
      ),
    [allRows]
  );

  const ownerOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.owner).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'zh-CN')
      ),
    [allRows]
  );

  const filteredResults = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return allRows.filter((row) => {
      if (filterStatus === 'crm') {
        if (row.source !== 'crm') return false;
      } else if (filterStatus !== 'all' && row.status !== filterStatus) {
        return false;
      }
      if (filterMode !== 'all' && (row.mode || 'economy') !== filterMode) return false;
      if (filterCountry !== 'all' && row.country !== filterCountry) return false;
      if (filterOwner !== 'all' && row.owner !== filterOwner) return false;
      if (filterKeyword !== 'all' && !row.keywords.includes(filterKeyword)) return false;
      if (filterIndustry !== 'all' && row.industry !== filterIndustry) return false;
      if (filterBg === 'yes' && !row.intel.hasBg) return false;
      if (filterBg === 'no' && row.intel.hasBg) return false;
      if (filterProduct === 'yes' && !row.intel.hasProduct) return false;
      if (filterProduct === 'no' && row.intel.hasProduct) return false;
      if (filterDm === 'yes' && !row.intel.hasDm) return false;
      if (filterDm === 'found' && row.intel.dmStatus !== 'found') return false;
      if (filterDm === 'empty' && row.intel.dmStatus !== 'empty') return false;
      if (filterDm === 'no' && row.intel.hasDm) return false;
      if (filterCrm === 'yes' && !row.intel.inCrm) return false;
      if (filterCrm === 'no' && row.intel.inCrm) return false;
      if (q) {
        const hay = [
          row.clientName,
          row.website,
          row.country,
          row.owner,
          ...row.keywords,
          row.industry,
          row.contact?.name,
          row.contact?.emailGuess,
          row.contact?.title,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    allRows,
    filterQuery,
    filterStatus,
    filterCountry,
    filterOwner,
    filterKeyword,
    filterMode,
    filterIndustry,
    filterBg,
    filterProduct,
    filterDm,
    filterCrm,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedResults = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredResults.slice(start, start + pageSize);
  }, [filteredResults, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [
    filterQuery,
    filterStatus,
    filterCountry,
    filterOwner,
    filterKeyword,
    filterMode,
    filterIndustry,
    filterBg,
    filterProduct,
    filterDm,
    filterCrm,
    pageSize,
  ]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectedRows = useMemo(
    () => filteredResults.filter((r) => selectedIds.has(r.id)),
    [filteredResults, selectedIds]
  );
  const selectedTasks = useMemo(
    () => selectedRows.map((r) => r.task).filter(Boolean) as AutomationResult[],
    [selectedRows]
  );

  const allPageSelected =
    pagedResults.length > 0 && pagedResults.every((t) => selectedIds.has(t.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const t of pagedResults) next.delete(t.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const t of pagedResults) next.add(t.id);
        return next;
      });
    }
  };

  const clearFilters = () => {
    setFilterQuery('');
    setFilterStatus('all');
    setFilterCountry('all');
    setFilterOwner('all');
    setFilterKeyword('all');
    setFilterMode('all');
    setFilterIndustry('all');
    setFilterBg('all');
    setFilterProduct('all');
    setFilterDm('all');
    setFilterCrm('all');
  };

  const hasActiveFilters =
    !!filterQuery.trim() ||
    filterStatus !== 'all' ||
    filterCountry !== 'all' ||
    filterOwner !== 'all' ||
    filterKeyword !== 'all' ||
    filterMode !== 'all' ||
    filterIndustry !== 'all' ||
    filterBg !== 'all' ||
    filterProduct !== 'all' ||
    filterDm !== 'all' ||
    filterCrm !== 'all';

  const openRow = (row: PromoListRow) => {
    if (row.source === 'queue' && row.task) {
      onViewResult(row.task);
      return;
    }
    if (row.intel.historyItem && onOpenHistoryItem) {
      onOpenHistoryItem(row.intel.historyItem);
      return;
    }
    if (row.client && onOpenClient) {
      onOpenClient(row.client);
      return;
    }
    alert('暂无完整报告可打开。可先对该客户再次背调。');
  };

  const handleBatchExport = () => {
    const list = selectedTasks.length
      ? selectedTasks
      : automationResults.filter((t) => t.status === 'completed');
    if (!list.length) {
      alert('没有可导出的已完成队列任务（CRM 同步行请从客户管理导出）');
      return;
    }
    exportAutomationResultsToExcel(list);
  };

  const handleBatchDelete = async () => {
    const queueSelected = selectedRows.filter((r) => r.source === 'queue' && r.task);
    if (!queueSelected.length) {
      alert('请选择队列中的任务删除（CRM 同步行请在客户管理中删除）');
      return;
    }
    if (!confirm(`删除选中的 ${queueSelected.length} 条队列任务？`)) return;
    for (const r of queueSelected) {
      if (r.task) await onDelete(r.task.id);
    }
    setSelectedIds(new Set());
  };

  const handleBatchRerun = async () => {
    if (!onRerunCompleted) return;
    const targets = selectedRows.filter((r) => r.source === 'queue' && r.task?.status === 'completed');
    if (!targets.length) {
      alert('请选择已完成的队列任务进行再次背调');
      return;
    }
    if (!confirm(`对选中的 ${targets.length} 条已完成任务再次背调？`)) return;
    for (const r of targets) {
      if (r.task) await onRerunCompleted(r.task.id);
    }
  };

  const handleBatchDownloadPpt = () => {
    const targets = selectedTasks.filter((t) => t.status === 'completed' && t.analysis);
    if (!targets.length) {
      alert('请选择已完成且有报告的队列任务');
      return;
    }
    for (const t of targets) onDownloadResult(t);
  };

  const handleBatchDm = () => {
    if (!onBatchDmSearch) return;
    if (!selectedRows.length) {
      alert('请先勾选客户');
      return;
    }
    onBatchDmSearch(selectedRows);
  };

  const handleBatchCrm = () => {
    if (!onBatchAddToCrm) return;
    const notInCrm = selectedRows
      .filter((r) => r.source === 'queue' && r.task?.status === 'completed' && r.task.analysis && !r.intel.inCrm)
      .map((r) => r.task!) as AutomationResult[];
    if (!notInCrm.length) {
      alert('没有可导入的队列任务（需已完成背调且尚未入 CRM）');
      return;
    }
    onBatchAddToCrm(notInCrm);
  };

  const handleBatchProduct = () => {
    if (!onBatchProductDig) return;
    if (!selectedRows.length) {
      alert('请先勾选客户');
      return;
    }
    onBatchProductDig(selectedRows);
  };

  const patchDraft = (partial: Partial<AutomationPipelineConfig>) => {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      // CRM 依赖决策人挖掘
      if (partial.doDmMine === false) next.doCrmImport = false;
      if (partial.doBackgroundCheck === false) {
        next.doDmMine = false;
        next.doCrmImport = false;
      }
      return next;
    });
  };

  const toggleClientType = (value: string) => {
    setDraft((prev) => {
      const has = prev.clientTypes.includes(value);
      const next = has
        ? prev.clientTypes.filter((t) => t !== value)
        : [...prev.clientTypes, value];
      return { ...prev, clientTypes: next.length ? next : prev.clientTypes };
    });
  };

  const estimatedLeads = draft.countries.length * draft.perCountryLimit;

  const validationError = useMemo(() => {
    if (!draft.keyword.trim()) return '请填写搜索关键词';
    if (!draft.countries.length) return '请至少选择一个目标国家';
    if (!draft.clientTypes.length) return '请至少选择一种客户类型';
    if (draft.perCountryLimit < 1) return '每个国家数量无效';
    return null;
  }, [draft]);

  const openDialog = () => {
    setConfirming(false);
    setDialogOpen(true);
  };

  const handleConfirmStart = () => {
    if (validationError) {
      alert(validationError);
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const config: AutomationPipelineConfig = {
      ...draft,
      keyword: draft.keyword.trim(),
      industry: draft.industry.trim(),
      productContext: draft.productContext.trim(),
      doDmMine: draft.doBackgroundCheck && draft.doDmMine && canDmMine,
      doCrmImport: draft.doBackgroundCheck && draft.doDmMine && draft.doCrmImport && canCrmImport,
    };
    setDialogOpen(false);
    setConfirming(false);
    onStartAutomation(config);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-2 flex items-center gap-2">
          <Ruler className="text-blue-600" /> 自动化获客工作流
        </h2>
        <p className="text-sm text-slate-500 font-medium mb-6 leading-relaxed">
          同一关键词按国家逐个搜索；一国搜完即并行背调 / 决策人挖掘 / 导入 CRM，无需等全部国家搜完。
        </p>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 sm:p-5 mb-6 space-y-2 text-sm text-slate-600 font-medium">
          <div className="flex items-start gap-2">
            <ListChecks size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <span>配置：关键词 · 行业词 · 客户类型 · 国家 · 每国数量 · 背调 / 决策人 / CRM 选项</span>
          </div>
          <div className="flex items-start gap-2">
            <Search size={16} className="text-cyan-600 mt-0.5 flex-shrink-0" />
            <span>执行：国家串行搜索 → 每国结果立即进入后续任务（可并行）</span>
          </div>
        </div>

        <button
          type="button"
          onClick={openDialog}
          disabled={isAutomating}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isAutomating ? <Loader2 className="animate-spin" size={20} /> : <PlayCircle size={20} />}
          {isAutomating ? '自动化执行中…' : '配置并启动自动化流程'}
        </button>
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <ListChecks className="text-blue-600" size={20} />
                  {confirming ? '确认自动化步骤' : '配置自动化流程'}
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                  {confirming ? '请核对下列步骤后开始执行' : '填写全部选项后进入确认'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  setConfirming(false);
                }}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5 custom-scrollbar">
              {!confirming ? (
                <>
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      1. 搜索关键词 *
                    </label>
                    <input
                      type="text"
                      value={draft.keyword}
                      onChange={(e) => patchDraft({ keyword: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                      placeholder="例如: Silicone Baby Products"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      2. 行业（可多选 / 可手动录入，可留空）
                    </label>
                    <IndustryMultiSelect
                      value={draft.industry}
                      onChange={(v) => patchDraft({ industry: v })}
                      placeholder="例如: Baby Products / Home Decor"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      3. 客户类型 *
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {CLIENT_TYPE_OPTIONS.map((opt) => {
                        const on = draft.clientTypes.includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => toggleClientType(opt.value)}
                            className={`px-3 py-2 rounded-xl text-xs font-black border transition-colors ${
                              on
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <ContinentCountryMultiSelect
                    value={draft.countries}
                    onChange={(countries) => patchDraft({ countries })}
                    label="4. 目标国家（一级大洲 / 二级国家多选）*"
                    defaultOpen
                  />

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      5. 每个国家找出客户数量 *
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {PER_COUNTRY_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => patchDraft({ perCountryLimit: n })}
                          className={`min-w-[3rem] px-3 py-2 rounded-xl text-sm font-black border ${
                            draft.perCountryLimit === n
                              ? 'bg-cyan-600 text-white border-cyan-600'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 font-bold mt-2">
                      预计最多约 {estimatedLeads} 家（{draft.countries.length} 国 × {draft.perCountryLimit}）
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                      产品背景 / 卖点（可选）
                    </label>
                    <textarea
                      value={draft.productContext}
                      onChange={(e) => patchDraft({ productContext: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold h-[100px] resize-none"
                      placeholder="描述您的产品优势，用于后续开发信…"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      6–8. 后续自动化动作
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-slate-300"
                        checked={draft.doBackgroundCheck}
                        onChange={(e) => patchDraft({ doBackgroundCheck: e.target.checked })}
                      />
                      <span className="text-sm font-bold text-slate-700">
                        <Building2 size={14} className="inline mr-1 text-violet-600" />
                        搜索完成后直接进行背调（一国搜完即开始，不等其它国家）
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-3 ${
                        draft.doBackgroundCheck && canDmMine ? 'cursor-pointer' : 'opacity-40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-slate-300"
                        disabled={!draft.doBackgroundCheck || !canDmMine}
                        checked={draft.doDmMine && canDmMine}
                        onChange={(e) => patchDraft({ doDmMine: e.target.checked })}
                      />
                      <span className="text-sm font-bold text-slate-700">
                        <Users size={14} className="inline mr-1 text-amber-600" />
                        背调后挖掘决策人邮箱
                        {!canDmMine && (
                          <span className="block text-[11px] text-slate-400 font-bold mt-0.5">
                            当前账号无决策人邮箱搜索权限
                          </span>
                        )}
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-3 ${
                        draft.doBackgroundCheck && draft.doDmMine && canCrmImport
                          ? 'cursor-pointer'
                          : 'opacity-40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-slate-300"
                        disabled={!draft.doBackgroundCheck || !draft.doDmMine || !canCrmImport}
                        checked={draft.doCrmImport && canCrmImport}
                        onChange={(e) => patchDraft({ doCrmImport: e.target.checked })}
                      />
                      <span className="text-sm font-bold text-slate-700">
                        <ShieldCheck size={14} className="inline mr-1 text-emerald-600" />
                        挖掘到有决策人的直接导入 CRM
                        {!canCrmImport && (
                          <span className="block text-[11px] text-slate-400 font-bold mt-0.5">
                            当前账号无 CRM 模块权限
                          </span>
                        )}
                      </span>
                    </label>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {[
                    { n: 1, t: '关键词', v: draft.keyword.trim() },
                    { n: 2, t: '行业词', v: draft.industry.trim() || '（空）' },
                    {
                      n: 3,
                      t: '客户类型',
                      v: draft.clientTypes
                        .map((c) => CLIENT_TYPE_OPTIONS.find((o) => o.value === c)?.label || c)
                        .join('、'),
                    },
                    {
                      n: 4,
                      t: '目标国家',
                      v: draft.countries
                        .map((c) => {
                          const item = findCountryByEn(c);
                          return item ? `${item.zh} (${item.en})` : c;
                        })
                        .join('、'),
                    },
                    {
                      n: 5,
                      t: '每国数量',
                      v: `${draft.perCountryLimit}（预计约 ${estimatedLeads} 家）`,
                    },
                    {
                      n: 6,
                      t: '搜索后背调',
                      v: draft.doBackgroundCheck ? '是 · 一国搜完即并行背调' : '否 · 仅入队待手动继续',
                    },
                    {
                      n: 7,
                      t: '背调后挖决策人',
                      v: draft.doBackgroundCheck && draft.doDmMine && canDmMine ? '是 · 后台并行' : '否',
                    },
                    {
                      n: 8,
                      t: '有决策人导入 CRM',
                      v:
                        draft.doBackgroundCheck && draft.doDmMine && draft.doCrmImport && canCrmImport
                          ? '是'
                          : '否',
                    },
                  ].map((row) => (
                    <div
                      key={row.n}
                      className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                    >
                      <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-blue-600 text-white text-[11px] font-black flex items-center justify-center">
                        {row.n}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          {row.t}
                        </div>
                        <div className="text-sm font-bold text-slate-800 break-words">{row.v}</div>
                      </div>
                    </div>
                  ))}
                  {draft.productContext.trim() && (
                    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-600 font-medium">
                      <span className="text-[10px] font-black text-slate-400 uppercase">卖点备注</span>
                      <p className="mt-1 whitespace-pre-wrap">{draft.productContext.trim()}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              {confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="sm:mr-auto px-4 py-3 rounded-xl border border-slate-200 text-sm font-black text-slate-600 hover:bg-slate-50"
                >
                  返回修改
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  setConfirming(false);
                }}
                className="px-4 py-3 rounded-xl border border-slate-200 text-sm font-black text-slate-500"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!!validationError || isAutomating}
                onClick={handleConfirmStart}
                className="flex-1 sm:flex-none sm:min-w-[12rem] px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-black disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {confirming ? (
                  <>
                    <PlayCircle size={16} /> 确认并开始执行
                  </>
                ) : (
                  <>
                    <ListChecks size={16} /> 下一步：确认步骤
                  </>
                )}
              </button>
            </div>
            {validationError && !confirming && (
              <div className="px-4 sm:px-6 pb-3 text-[11px] font-bold text-rose-500">{validationError}</div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 flex-wrap">
              <Clock className="text-slate-400" /> 客户列表 ({allRows.length})
              {automationResults.length > 0 && (
                <span className="text-xs font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                  队列 {automationResults.length}
                </span>
              )}
              {crmOnlyCount > 0 && (
                <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
                  CRM 同步 {crmOnlyCount}
                </span>
              )}
              {completedCount > 0 && (
                <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                  队列已完成 {completedCount}
                </span>
              )}
              {hasActiveFilters && (
                <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                  筛选后 {filteredResults.length}
                </span>
              )}
            </h3>
            <div className="flex flex-wrap gap-2">
              {(completedCount > 0 || selectedTasks.length > 0) && (
                <button
                  onClick={handleBatchExport}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700"
                >
                  <FileSpreadsheet size={14} />
                  {selectedTasks.length ? `导出选中 (${selectedTasks.length})` : '导出 Excel'}
                </button>
              )}
              {completedCount > 0 && canExportPpt && (
                <button
                  onClick={selectedTasks.length ? handleBatchDownloadPpt : onDownloadAll}
                  className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-50"
                >
                  <Download size={14} />
                  {selectedTasks.length ? `下载选中 PPT` : '批量下载 PPT'}
                </button>
              )}
              {completedCount > 0 && (
                <button
                  onClick={onClearCompleted}
                  disabled={isAutomating}
                  className="inline-flex items-center gap-1.5 bg-white border border-amber-200 text-amber-700 px-4 py-2 rounded-xl text-xs font-bold hover:bg-amber-50 disabled:opacity-50"
                >
                  <Trash2 size={14} /> 清除已完成
                </button>
              )}
              {automationResults.length > 0 && (
                <button
                  onClick={onClearAll}
                  disabled={isAutomating}
                  className="inline-flex items-center gap-1.5 bg-white border border-red-200 text-red-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={14} /> 清空列表
                </button>
              )}
              {onReloadQueue && (
                <button
                  type="button"
                  onClick={() => onReloadQueue()}
                  disabled={isAutomating}
                  className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                  title="从本机重新加载任务，修复短ID冲突与无归属导致的列表变少"
                >
                  <RefreshCw size={14} /> 重新加载队列
                </button>
              )}
              <button
                onClick={onRunPending}
                disabled={
                  isAutomating ||
                  automationResults.filter((r) => r.status === 'pending' || r.status === 'failed')
                    .length === 0
                }
                className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                继续待处理任务
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="relative col-span-2 sm:col-span-3 lg:col-span-2">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="搜索公司 / 网址 / 联系人 / 邮箱..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">所有状态</option>
              <option value="completed">已完成</option>
              <option value="pending">待处理</option>
              <option value="analyzing">分析中</option>
              <option value="failed">失败</option>
              <option value="generating_email">生成邮件中</option>
              <option value="crm">仅 CRM 同步</option>
            </select>
            <select
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">所有国家</option>
              {countryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
              title="按拥有人筛选"
            >
              <option value="all">所有拥有人</option>
              {ownerOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">所有关键词</option>
              {keywordOptions.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">所有模式</option>
              <option value="detailed">DETAILED</option>
              <option value="economy">ECONOMY</option>
            </select>
            <select
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white col-span-2 sm:col-span-1 lg:col-span-1"
            >
              <option value="all">所有行业</option>
              {industryOptions.map((i) => (
                <option key={i} value={i}>
                  {i.length > 40 ? `${i.slice(0, 40)}…` : i}
                </option>
              ))}
            </select>
            <select
              value={filterBg}
              onChange={(e) => setFilterBg(e.target.value as typeof filterBg)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">背调: 全部</option>
              <option value="yes">已背调</option>
              <option value="no">未背调</option>
            </select>
            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value as typeof filterProduct)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">品类: 全部</option>
              <option value="yes">已采品类</option>
              <option value="no">未采品类</option>
            </select>
            <select
              value={filterDm}
              onChange={(e) => setFilterDm(e.target.value as typeof filterDm)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">决策人: 全部</option>
              <option value="found">有联系人</option>
              <option value="empty">已挖无联系人</option>
              <option value="yes">已挖（含有/无）</option>
              <option value="no">未挖决策人</option>
            </select>
            <select
              value={filterCrm}
              onChange={(e) => setFilterCrm(e.target.value as typeof filterCrm)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
            >
              <option value="all">CRM: 全部</option>
              <option value="yes">已入 CRM</option>
              <option value="no">未入 CRM</option>
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-100 col-span-2 sm:col-span-1"
              >
                清空筛选
              </button>
            )}
          </div>

          {/* Batch selection actions */}
          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
              <span className="text-xs font-black text-blue-800">已选 {selectedRows.length} 条</span>
              <button
                type="button"
                onClick={handleBatchExport}
                className="text-xs font-bold text-emerald-700 hover:underline"
              >
                导出 Excel
              </button>
              {canExportPpt && (
                <button
                  type="button"
                  onClick={handleBatchDownloadPpt}
                  className="text-xs font-bold text-slate-700 hover:underline"
                >
                  下载 PPT
                </button>
              )}
              {canDmMine && onBatchDmSearch && (
                <button
                  type="button"
                  onClick={handleBatchDm}
                  disabled={isAutomating}
                  className="inline-flex items-center gap-1 text-xs font-bold text-violet-700 hover:underline disabled:opacity-50"
                  title="与客户管理相同的决策人挖掘队列"
                >
                  <Users size={12} /> 批量决策人挖掘
                </button>
              )}
              {canProductDig && onBatchProductDig && (
                <button
                  type="button"
                  onClick={handleBatchProduct}
                  disabled={isAutomating}
                  className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline disabled:opacity-50"
                  title="补做缺品类的背调"
                >
                  <PackageSearch size={12} /> 批量补做品类
                </button>
              )}
              {canCrmImport && onBatchAddToCrm && (
                <button
                  type="button"
                  onClick={handleBatchCrm}
                  disabled={isAutomating}
                  className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline disabled:opacity-50"
                  title="将已完成且未入 CRM 的队列任务加入客户管理"
                >
                  <Building2 size={12} /> 批量加入 CRM
                </button>
              )}
              {onRerunCompleted && (
                <button
                  type="button"
                  onClick={() => void handleBatchRerun()}
                  disabled={isAutomating}
                  className="text-xs font-bold text-amber-700 hover:underline disabled:opacity-50"
                >
                  批量再次背调
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleBatchDelete()}
                disabled={isAutomating}
                className="text-xs font-bold text-red-600 hover:underline disabled:opacity-50"
              >
                批量删除
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-bold text-slate-500 hover:underline ml-auto"
              >
                取消选择
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1180px]">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAllPage}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    title="全选本页"
                  />
                </th>
                <th className="px-3 py-3">客户信息</th>
                <th className="px-3 py-3">国家</th>
                <th className="px-3 py-3">拥有人</th>
                <th className="px-3 py-3">行业</th>
                <th className="px-3 py-3">关键词</th>
                <th className="px-3 py-3">联系人</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">背调时间</th>
                <th className="px-3 py-3">模式</th>
                <th className="px-3 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-slate-400 font-bold">
                    暂无客户：请启动自动化流水线，或在客户管理中添加客户后将自动同步到此列表
                  </td>
                </tr>
              ) : filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-slate-400 font-bold">
                    无匹配结果，请调整筛选条件
                  </td>
                </tr>
              ) : (
                pagedResults.map((row) => {
                  const kws = row.keywords;
                  const industry = row.industry;
                  const contact = row.contact;
                  const dmCount = row.intel.dmContactCount;
                  const owner = row.owner;
                  const task = row.task;
                  const bgAt =
                    task?.status === 'completed'
                      ? formatBackgroundCheckTime(task.completedAt || task.createdAt)
                      : row.intel.historyItem
                        ? formatBackgroundCheckTime(row.intel.historyItem.timestamp)
                        : '';
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50/50 transition-colors align-top ${
                        selectedIds.has(row.id) ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2.5 max-w-[220px]">
                        <div className="font-bold text-slate-800 truncate text-sm">{row.clientName}</div>
                        <div className="text-[10px] text-slate-400 font-bold truncate">{row.website}</div>
                        {(row.intel.bestAnalysis?.companyInfo?.scale ||
                          task?.analysis?.companyInfo?.scale) && (
                          <div className="text-[9px] text-slate-400 font-bold mt-0.5">
                            规模:{' '}
                            {row.intel.bestAnalysis?.companyInfo?.scale ||
                              task?.analysis?.companyInfo?.scale}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <StatusMini
                            done={row.intel.hasBg}
                            yes="已背调"
                            no="未背调"
                            tone="emerald"
                          />
                          <StatusMini
                            done={row.intel.hasProduct}
                            yes="已采品类"
                            no="未采品类"
                            tone="teal"
                          />
                          <DmStatusChip status={row.intel.dmStatus} contactCount={dmCount} />
                          {row.intel.inCrm && (
                            <span className="inline-flex text-[9px] font-black bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded">
                              已入CRM
                            </span>
                          )}
                          {row.source === 'crm' && (
                            <span className="inline-flex text-[9px] font-black bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded">
                              来自CRM
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap">
                        {row.country || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex max-w-[100px] truncate text-[11px] font-black px-2 py-0.5 rounded-md ${
                            owner
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                              : 'bg-slate-50 text-slate-400 border border-slate-100'
                          }`}
                          title={owner || '未标注'}
                        >
                          {owner || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold text-slate-600 max-w-[140px]">
                        <span className="line-clamp-2" title={industry || undefined}>
                          {industry || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1 max-w-[160px]">
                          {kws.length ? (
                            kws.slice(0, 3).map((k) => (
                              <span
                                key={k}
                                className="inline-flex bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-black"
                              >
                                {k}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                          {kws.length > 3 && (
                            <span className="text-[9px] font-bold text-slate-400">+{kws.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 max-w-[180px]">
                        {contact ? (
                          <div>
                            <div className="text-xs font-bold text-slate-800 truncate">
                              {contact.name || '—'}
                            </div>
                            <div className="text-[10px] text-slate-500 font-bold truncate">
                              {contact.title || '职位待补充'}
                            </div>
                            <div className="text-[10px] text-blue-600 font-bold truncate">
                              {contact.emailGuess
                                ? canViewEmails
                                  ? contact.emailGuess
                                  : maskEmailAddress(contact.emailGuess)
                                : '—'}
                            </div>
                            {dmCount > 1 && (
                              <div className="text-[9px] text-slate-400 font-bold mt-0.5">
                                +{dmCount - 1} 位联系人
                              </div>
                            )}
                          </div>
                        ) : row.intel.dmStatus === 'empty' ? (
                          <DmStatusChip status="empty" showIcon />
                        ) : (
                          <span className="text-slate-300 text-xs font-bold">暂无</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {row.source === 'crm' ? (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-indigo-100 text-indigo-700">
                            <Building2 size={10} /> CRM
                          </div>
                        ) : (
                          <div
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                              row.status === 'completed'
                                ? 'bg-green-100 text-green-600'
                                : row.status === 'failed'
                                  ? 'bg-red-100 text-red-600'
                                  : row.status === 'pending'
                                    ? 'bg-slate-100 text-slate-400'
                                    : 'bg-blue-100 text-blue-600'
                            }`}
                          >
                            {row.status === 'analyzing' || row.status === 'generating_email' ? (
                              <Loader2 className="animate-spin" size={10} />
                            ) : null}
                            {row.status === 'completed' ? <CheckCircle2 size={10} /> : null}
                            {row.status === 'failed' ? <AlertTriangle size={10} /> : null}
                            {row.status === 'pending' ? <Hourglass size={10} /> : null}
                            {String(row.status).replace('_', ' ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                          {bgAt || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[10px] font-black text-slate-400 uppercase">
                          {row.mode || (row.source === 'crm' ? '—' : 'economy')}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          {(row.intel.hasBg ||
                            (task?.status === 'completed' && task.analysis) ||
                            row.intel.historyItem) && (
                            <button
                              onClick={() => openRow(row)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="查看背调结果"
                            >
                              <FileText size={16} />
                            </button>
                          )}
                          {task?.status === 'completed' && task.analysis && canExportPpt && (
                            <button
                              onClick={() => onDownloadResult(task)}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="下载 PPT"
                            >
                              <Download size={16} />
                            </button>
                          )}
                          {task?.status === 'completed' && onRerunCompleted && (
                            <button
                              onClick={() => onRerunCompleted(task.id)}
                              disabled={isAutomating}
                              className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                              title="再次背调"
                            >
                              <RefreshCw size={16} />
                            </button>
                          )}
                          {task && (task.status === 'pending' || task.status === 'failed') && (
                            <button
                              onClick={() => onRunSingle(task.id)}
                              disabled={isAutomating}
                              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                              title="运行"
                            >
                              <PlayCircle size={16} />
                            </button>
                          )}
                          {task && (
                            <button
                              onClick={() => onDelete(task.id)}
                              className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除队列任务"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredResults.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/40">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
              <span>
                第 {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filteredResults.length)} 条 / 共 {filteredResults.length} 条
                {hasActiveFilters ? `（已筛选，列表总计 ${allRows.length}）` : ''}
              </span>
              <span className="text-slate-300">|</span>
              <label className="inline-flex items-center gap-1.5">
                每页
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 10 | 20 | 50)}
                  className="px-2 py-1 rounded-lg border border-slate-200 bg-white font-bold"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-blue-600 hover:underline font-black"
                >
                  清除筛选
                </button>
              )}
            </div>
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
};
