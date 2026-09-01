import React, { useEffect, useState } from 'react';
import { AnalysisResult, DecisionMaker } from '../types';
import { Users, Linkedin, Mail, Phone, ExternalLink, UserCheck, AlertTriangle, Download, Briefcase, ShieldCheck, ShieldAlert, RefreshCw, Loader2, Clock, Plus, Trash2, Save } from 'lucide-react';
import { exportContactsToExcel } from '../services/exportService';
import {
  getActiveDmJobForDomain,
  subscribeDmEmailSearchJobs,
} from '../services/dmEmailSearchQueue';
import { maskEmailAddress, abbreviateEmailPlatform } from '../services/permissions';

interface ModuleDecisionMakersProps {
  data: AnalysisResult;
  historyId?: string | null;
  canDmEmailSearch?: boolean;
  canExportExcel?: boolean;
  /** 是否可查看完整邮箱（管理员/主管）；普通员工显示 * */
  canViewEmails?: boolean;
  /** 邮箱手工编辑 / 后台搜索完成写回 */
  onUpdate?: (
    decisionMakers: DecisionMaker[],
    meta?: {
      decisionMakerEmailSearchAt?: number;
      decisionMakerEmailSearchHistory?: number[];
    }
  ) => void;
  /** 入队后台搜索；由 App 注入写回逻辑 */
  onEnqueueEmailSearch?: () => { ok: boolean; message: string };
  onAddToCRM?: () => void;
}

const formatSearchTime = (ts?: number) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const emptyDecisionMaker = (): DecisionMaker => ({
  name: '',
  firstName: '',
  lastName: '',
  title: '',
  department: '',
  yearsActive: '',
  emailGuess: '',
  phone: '',
  whatsapp: '',
  linkedin: '',
  type: 'Buyer',
  source: 'Manual',
  emailSource: 'Manual',
  emailStatus: 'unverified',
  isVerified: false,
  confidence: undefined,
  influenceScore: 3,
});

export const ModuleDecisionMakers: React.FC<ModuleDecisionMakersProps> = ({
  data,
  historyId,
  canDmEmailSearch = false,
  canExportExcel = false,
  canViewEmails = true,
  onUpdate,
  onEnqueueEmailSearch,
  onAddToCRM,
}) => {
  const [decisionMakers, setDecisionMakers] = useState(() =>
    (data.decisionMakers || []).filter(
      (d) => !!(d.phone || '').trim() || !!(d.whatsapp || '').trim() || !!(d.emailGuess || '').includes('@')
    )
  );
  const [lastSearchAt, setLastSearchAt] = useState(data.decisionMakerEmailSearchAt);
  const [searchHistory, setSearchHistory] = useState<number[]>(
    data.decisionMakerEmailSearchHistory || (data.decisionMakerEmailSearchAt ? [data.decisionMakerEmailSearchAt] : [])
  );
  const [queueMsg, setQueueMsg] = useState('');
  const [jobActive, setJobActive] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [listFilter, setListFilter] = useState<'all' | 'buyer' | 'verified'>('all');
  const lastAppliedJobIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    setDecisionMakers(
      (data.decisionMakers || []).filter(
        (d) =>
          !!(d.phone || '').trim() ||
          !!(d.whatsapp || '').trim() ||
          !!(d.emailGuess || '').includes('@')
      )
    );
    setLastSearchAt(data.decisionMakerEmailSearchAt);
    setSearchHistory(
      data.decisionMakerEmailSearchHistory ||
        (data.decisionMakerEmailSearchAt ? [data.decisionMakerEmailSearchAt] : [])
    );
    setSelectedIndices(new Set());
  }, [data.decisionMakers, data.decisionMakerEmailSearchAt, data.decisionMakerEmailSearchHistory]);

  useEffect(() => {
    const domain = (data.companyInfo?.website || '').replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].toLowerCase();
    return subscribeDmEmailSearchJobs((jobs) => {
      setJobActive(!!getActiveDmJobForDomain(data.companyInfo?.website || ''));
      const job = jobs.find(
        (j) =>
          j.status === 'completed' &&
          j.resultDecisionMakers &&
          j.searchedAt &&
          j.id !== lastAppliedJobIdRef.current &&
          j.domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].toLowerCase() === domain &&
          (!data.decisionMakerEmailSearchAt || j.searchedAt > data.decisionMakerEmailSearchAt)
      );
      if (!job?.resultDecisionMakers || !job.searchedAt) return;
      lastAppliedJobIdRef.current = job.id;
      setDecisionMakers(job.resultDecisionMakers);
      setLastSearchAt(job.searchedAt);
      if (job.searchedAt) {
        setSearchHistory((prev) => [...prev, job.searchedAt!].slice(-30));
      }
      const upgraded = job.stats?.upgraded || 0;
      const added = job.stats?.added || 0;
      const verified = job.stats?.verified || 0;
      if (upgraded + added + verified === 0) {
        setQueueMsg('邮箱搜索已完成：未新增联系人（可能是重复搜索或暂无结果）。可先「清空全部」后重试，或点「再次深挖」。');
      } else {
        setQueueMsg(`邮箱搜索已完成：新增 ${added}，更新 ${upgraded}，验证 ${verified}`);
      }
      // 持久化由 App enqueue onComplete 负责；此处仅刷新 UI
    });
  }, [data.companyInfo?.website, data.decisionMakerEmailSearchAt]);

  const commit = (next: DecisionMaker[]) => {
    setDecisionMakers(next);
    setSelectedIndices(new Set());
    onUpdate?.(next);
  };

  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleDecisionMakerChange = (
    index: number,
    patch: Partial<DecisionMaker>,
    options?: { resetEmailVerification?: boolean }
  ) => {
    const next = [...decisionMakers];
    next[index] = {
      ...next[index],
      ...patch,
      source: 'Manual',
      ...(options?.resetEmailVerification
        ? {
            emailSource: 'Manual',
            emailStatus: 'unverified',
            isVerified: false,
          }
        : {}),
    };
    commit(next);
  };

  const handleAddDecisionMaker = () => {
    const next = [emptyDecisionMaker(), ...decisionMakers];
    commit(next);
  };

  const handleDeleteDecisionMaker = (index: number) => {
    const target = decisionMakers[index];
    const label = target?.name || target?.emailGuess || `第 ${index + 1} 位联系人`;
    if (!window.confirm(`确定删除决策人「${label}」吗？删除后不可恢复（可再搜索或手动新增）。`)) {
      return;
    }
    const next = decisionMakers.filter((_, i) => i !== index);
    commit(next);
    setQueueMsg(`已删除：${label}`);
  };

  const handleClearAllDecisionMakers = () => {
    if (!decisionMakers.length) return;
    if (
      !window.confirm(
        `确定清空当前全部 ${decisionMakers.length} 位决策人吗？\n清空后可重新点「后台搜索」按公司域名拉取邮箱，避免旧的无用信息干扰。`
      )
    ) {
      return;
    }
    commit([]);
    setQueueMsg('已清空全部决策人，可重新发起后台搜索。');
  };

  const handleBatchDelete = () => {
    const count = selectedIndices.size;
    if (!count) {
      alert('请先勾选要删除的决策人');
      return;
    }
    if (!window.confirm(`确定删除已选中的 ${count} 位决策人吗？删除后不可恢复。`)) {
      return;
    }
    const next = decisionMakers.filter((_, i) => !selectedIndices.has(i));
    commit(next);
    setQueueMsg(`已批量删除 ${count} 位决策人`);
  };

  const handleEnqueueSearch = () => {
    setQueueMsg('');
    if (!canDmEmailSearch) {
      setQueueMsg('你没有「决策人邮箱搜索」权限，请联系管理员或部门主管开通。');
      return;
    }
    if (decisionMakers.length > 0) {
      const junk = decisionMakers.filter(
        (d) =>
          !d.emailGuess &&
          (d.source === 'AI' || d.source === 'AI (Pattern Guess)' || /Company Contact|公开信息未找到|待补充/i.test(`${d.name} ${d.title}`))
      ).length;
      if (junk > 0 || decisionMakers.length > 8) {
        const ok = window.confirm(
          `当前已有 ${decisionMakers.length} 位决策人（其中约 ${junk} 位疑似无用占位）。\n建议先「清空全部」再搜索，避免旧数据干扰。\n\n仍要在现有列表上继续搜索吗？`
        );
        if (!ok) {
          setQueueMsg('已取消搜索。可先删除或清空无用决策人后再试。');
          return;
        }
      }
    }
    if (onEnqueueEmailSearch) {
      const res = onEnqueueEmailSearch();
      setQueueMsg(res.message);
      return;
    }
    setQueueMsg('无法发起搜索，请联系管理员。');
  };

  const buyers = decisionMakers.filter(d => d.type === 'Buyer').length;
  const verified = decisionMakers.filter(d => d.isVerified).length;

  const matchesFilter = (dm: DecisionMaker) => {
    if (listFilter === 'buyer') return dm.type === 'Buyer';
    if (listFilter === 'verified') return !!dm.isVerified && !!dm.emailGuess;
    return true;
  };

  const filteredEntries = decisionMakers
    .map((dm, index) => ({ dm, index }))
    .filter(({ dm }) => matchesFilter(dm));

  const filteredIndices = filteredEntries.map((e) => e.index);
  const allFilteredSelected =
    filteredIndices.length > 0 && filteredIndices.every((i) => selectedIndices.has(i));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        filteredIndices.forEach((i) => next.delete(i));
        return next;
      });
    } else {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        filteredIndices.forEach((i) => next.add(i));
        return next;
      });
    }
  };

  const filterLabel =
    listFilter === 'buyer' ? '采购相关' : listFilter === 'verified' ? '已验证邮箱' : '全部联系人';

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-panel">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-600 mb-1">Intelligence · Contacts</div>
            <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <Users className="text-cyan-600" /> 关键决策人挖掘
            </h3>
            <p className="text-sm text-slate-500 font-medium mt-1 leading-relaxed">
              背调不会自动扣 Anymail 积分。点「后台搜索」优先 Anymail 公司域名搜索；若 Anymail 未找到任何联系人，再自动用 Hunter.io。Hunter 额度用尽时静默跳过不报错。「再次深挖」才会额外按采购等角色补充（Anymail，成功约 2 积分/人）。
            </p>
            {lastSearchAt ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1 text-cyan-700">
                  <Clock size={12} /> 最近搜索：{formatSearchTime(lastSearchAt)}
                </span>
                {searchHistory.length > 1 && (
                  <span className="text-slate-400">累计搜索 {searchHistory.length} 次</span>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[11px] font-semibold text-amber-600">尚未搜索决策人邮箱（背调阶段已跳过，需手动触发）。</div>
            )}
            {queueMsg && (
              <div className="mt-2 text-[11px] font-semibold text-emerald-700">{queueMsg}</div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
            {onAddToCRM && (
              <button
                type="button"
                onClick={onAddToCRM}
                className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold touch-manipulation shadow-sm"
              >
                <ShieldCheck size={16} /> 导入 CRM
              </button>
            )}
            <button
              type="button"
              onClick={handleAddDecisionMaker}
              className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold touch-manipulation shadow-sm"
            >
              <Plus size={16} /> 手动新增决策人
            </button>
            {decisionMakers.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllDecisionMakers}
                className="inline-flex items-center justify-center gap-2 bg-white border border-rose-300 hover:bg-rose-50 text-rose-600 px-4 py-2.5 rounded-xl text-sm font-semibold touch-manipulation"
              >
                <Trash2 size={16} /> 清空全部
              </button>
            )}
            {selectedIndices.size > 0 && (
              <button
                type="button"
                onClick={handleBatchDelete}
                className="inline-flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold touch-manipulation"
              >
                <Trash2 size={16} /> 批量删除 ({selectedIndices.size})
              </button>
            )}
            {canDmEmailSearch && (
              <button
                type="button"
                onClick={handleEnqueueSearch}
                disabled={jobActive}
                className="inline-flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-semibold touch-manipulation shadow-sm"
              >
                {jobActive ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {jobActive ? '后台搜索中…' : lastSearchAt ? '再次深挖决策人邮箱' : '后台搜索决策人邮箱'}
              </button>
            )}
            {canExportExcel && (
              <button
                type="button"
                onClick={() =>
                  exportContactsToExcel(
                    canViewEmails
                      ? decisionMakers
                      : decisionMakers.map((d) => ({
                          ...d,
                          emailGuess: d.emailGuess ? maskEmailAddress(d.emailGuess) : d.emailGuess,
                        })),
                    data.companyInfo?.name || 'contacts'
                  )
                }
                className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold touch-manipulation"
              >
                <Download size={16} /> 导出 Excel
              </button>
            )}
          </div>
        </div>

        {jobActive && canDmEmailSearch && (
          <div className="mb-4 rounded-2xl border border-cyan-200/80 bg-cyan-50/80 px-4 py-3 text-xs font-semibold text-cyan-900">
            已在后台按「公司域名 → 补职位/领英」搜索，可切换其它客户继续浏览；完成后可点「再次深挖」按角色补充更多决策人。
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          <button
            type="button"
            onClick={() => { setListFilter('all'); setSelectedIndices(new Set()); }}
            className={`rounded-2xl p-3 border text-center transition-all touch-manipulation ${
              listFilter === 'all'
                ? 'bg-ink-900 text-white border-ink-900 shadow-signal'
                : 'bg-slate-50/80 border-slate-200/80 hover:border-cyan-300 hover:bg-white'
            }`}
          >
            <div className={`text-xl font-extrabold tracking-tight ${listFilter === 'all' ? 'text-white' : 'text-slate-900'}`}>{decisionMakers.length}</div>
            <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${listFilter === 'all' ? 'text-slate-300' : 'text-slate-400'}`}>联系人</div>
          </button>
          <button
            type="button"
            onClick={() => { setListFilter('buyer'); setSelectedIndices(new Set()); }}
            className={`rounded-2xl p-3 border text-center transition-all touch-manipulation ${
              listFilter === 'buyer'
                ? 'bg-cyan-600 text-white border-cyan-600 shadow-signal'
                : 'bg-cyan-50/70 border-cyan-100 hover:border-cyan-300 hover:bg-cyan-50'
            }`}
          >
            <div className={`text-xl font-extrabold tracking-tight ${listFilter === 'buyer' ? 'text-white' : 'text-cyan-700'}`}>{buyers}</div>
            <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${listFilter === 'buyer' ? 'text-cyan-100' : 'text-cyan-500'}`}>采购相关</div>
          </button>
          <button
            type="button"
            onClick={() => { setListFilter('verified'); setSelectedIndices(new Set()); }}
            className={`rounded-2xl p-3 border text-center transition-all touch-manipulation ${
              listFilter === 'verified'
                ? 'bg-teal-600 text-white border-teal-600 shadow-signal'
                : 'bg-teal-50/70 border-teal-100 hover:border-teal-300 hover:bg-teal-50'
            }`}
          >
            <div className={`text-xl font-extrabold tracking-tight ${listFilter === 'verified' ? 'text-white' : 'text-teal-700'}`}>{verified}</div>
            <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${listFilter === 'verified' ? 'text-teal-100' : 'text-teal-500'}`}>已验证邮箱</div>
          </button>
        </div>
        {listFilter !== 'all' && (
          <p className="mb-3 text-[11px] font-bold text-slate-500">
            当前筛选：{filterLabel}（{filteredEntries.length} 人）· 可勾选后批量删除
          </p>
        )}

        {filteredEntries.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <label className="inline-flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
                className="w-4 h-4 rounded border-slate-300"
              />
              全选当前筛选
            </label>
            <span className="text-[11px] font-bold text-slate-500">
              已选 {selectedIndices.size} / 当前 {filteredEntries.length}
            </span>
            <button
              type="button"
              onClick={handleBatchDelete}
              disabled={!selectedIndices.size}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-3 py-2 text-xs font-black"
            >
              <Trash2 size={14} /> 批量删除选中
            </button>
          </div>
        )}

        {searchHistory.length > 1 && (
          <details className="mb-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-black text-slate-500">查看历次搜索时间</summary>
            <ul className="mt-2 space-y-1 text-[11px] font-bold text-slate-600">
              {[...searchHistory].reverse().map((t) => (
                <li key={t}>{formatSearchTime(t)}</li>
              ))}
            </ul>
          </details>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {filteredEntries.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-400 font-bold">
              {decisionMakers.length === 0
                ? '暂无决策人线索。点「后台搜索决策人邮箱」会先按公司域名拉取最多 20 个已验证邮箱（约 1 积分），也可手动新增。'
                : `当前筛选「${filterLabel}」下没有联系人，可点上方方块切换。`}
            </div>
          ) : filteredEntries.map(({ dm, index: i }) => (
            <DecisionMakerCard
              key={`${dm.emailGuess || dm.name || 'manual'}-${i}`}
              dm={dm}
              index={i}
              selected={selectedIndices.has(i)}
              canViewEmails={canViewEmails}
              onToggleSelect={toggleSelect}
              onChange={handleDecisionMakerChange}
              onDelete={handleDeleteDecisionMaker}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const typeBadge = (type: DecisionMaker['type']) => {
  if (type === 'Buyer') return 'bg-blue-600 text-white';
  if (type === 'CEO') return 'bg-violet-600 text-white';
  return 'bg-slate-200 text-slate-600';
};

const statusLabel = (dm: DecisionMaker) => {
  const s = (dm.emailStatus || (dm.isVerified ? 'valid' : 'unverified')).toLowerCase();
  if (s === 'valid' || dm.isVerified) return { text: '已验证 · valid', ok: true };
  if (s === 'risky') return { text: '风险 · risky（未完全确认）', ok: false };
  if (s === 'invalid') return { text: '无效 · invalid', ok: false };
  if (s === 'not_found') return { text: '未找到', ok: false };
  return { text: '未验证', ok: false };
};

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className = '',
}) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
      {label}
    </span>
    {children}
  </label>
);

const DecisionMakerCard: React.FC<{
  dm: DecisionMaker;
  index: number;
  selected: boolean;
  canViewEmails: boolean;
  onToggleSelect: (index: number) => void;
  onChange: (index: number, patch: Partial<DecisionMaker>, options?: { resetEmailVerification?: boolean }) => void;
  onDelete: (index: number) => void;
}> = ({ dm, index, selected, canViewEmails, onToggleSelect, onChange, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DecisionMaker>(dm);
  const emailPlatform = abbreviateEmailPlatform(dm.emailSource || dm.source);
  const verify = statusLabel(dm);

  useEffect(() => { setDraft(dm); }, [dm]);

  const updateDraft = <K extends keyof DecisionMaker>(key: K, value: DecisionMaker[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const saveDraft = () => {
    const trimmedName = (draft.name || '').trim();
    const normalized: Partial<DecisionMaker> = {
      ...draft,
      name: trimmedName || '手动联系人',
      firstName: (draft.firstName || '').trim() || undefined,
      lastName: (draft.lastName || '').trim() || undefined,
      title: (draft.title || '').trim() || '待补充',
      department: (draft.department || '').trim() || undefined,
      yearsActive: (draft.yearsActive || '').trim() || undefined,
      emailGuess: (draft.emailGuess || '').trim() || undefined,
      phone: (draft.phone || '').trim() || undefined,
      whatsapp: (draft.whatsapp || '').trim() || undefined,
      linkedin: (draft.linkedin || '').trim() || undefined,
      source: 'Manual',
      emailSource: draft.emailGuess?.trim() ? 'Manual' : undefined,
      emailStatus: draft.emailGuess?.trim() ? (draft.emailStatus || 'unverified') : undefined,
      isVerified: !!draft.isVerified && !!draft.emailGuess?.trim(),
      confidence: typeof draft.confidence === 'number' ? draft.confidence : undefined,
      influenceScore: draft.influenceScore || undefined,
    };
    onChange(index, normalized, { resetEmailVerification: draft.emailGuess !== dm.emailGuess });
    setIsEditing(false);
  };

  return (
    <div className={`bg-gradient-to-br from-slate-50 to-white p-5 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all group ${selected ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200/80 hover:border-cyan-300 hover:shadow-panel'}`}>
      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(index)}
            className="w-5 h-5 rounded border-slate-300 flex-shrink-0 cursor-pointer"
            title="勾选以便批量删除"
          />
          <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-sky-600 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-signal flex-shrink-0">
            {(dm.name || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <h4 className="text-base sm:text-lg font-black text-slate-800 group-hover:text-blue-600 transition-colors truncate">{dm.name || '未命名联系人'}</h4>
            <div className="text-xs font-bold text-slate-500 truncate">{dm.title || '待补充职位'}</div>
            {dm.department && <div className="text-[10px] font-bold text-slate-400 mt-0.5">{dm.department}</div>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${typeBadge(dm.type)}`}>{dm.type}</span>
          {dm.emailGuess ? (
            verify.ok ? (
              <div className="bg-green-100 text-green-600 p-1.5 rounded-lg" title="已验证"><UserCheck size={16} /></div>
            ) : (
              <div className="bg-yellow-100 text-yellow-600 p-1.5 rounded-lg" title="待验证"><AlertTriangle size={16} /></div>
            )
          ) : null}
        </div>
      </div>
      
      <div className="space-y-2.5 mt-4">
        {!isEditing ? (
          dm.emailGuess || canViewEmails ? (
          <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 gap-2">
            <div className="flex items-center gap-2 overflow-hidden min-w-0">
              <Mail size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs font-bold text-slate-600 truncate">
                {dm.emailGuess
                  ? canViewEmails
                    ? dm.emailGuess
                    : maskEmailAddress(dm.emailGuess)
                  : '待补充（可手动填写）'}
              </span>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setIsEditing(true)} className="text-[10px] font-black text-slate-400 hover:text-blue-600">编辑全部</button>
              {canViewEmails && dm.emailGuess && (
                <button 
                  onClick={() => { navigator.clipboard.writeText(dm.emailGuess || ''); alert('已复制'); }}
                  className="text-[10px] font-black text-blue-600 hover:underline"
                >
                  复制
                </button>
              )}
            </div>
          </div>
          ) : (
            <div className="flex justify-end">
              <button onClick={() => setIsEditing(true)} className="text-[10px] font-black text-slate-400 hover:text-blue-600">编辑全部</button>
            </div>
          )
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="姓名">
                <input value={draft.name || ''} onChange={(e) => updateDraft('name', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="职位">
                <input value={draft.title || ''} onChange={(e) => updateDraft('title', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="First Name">
                <input value={draft.firstName || ''} onChange={(e) => updateDraft('firstName', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="Last Name">
                <input value={draft.lastName || ''} onChange={(e) => updateDraft('lastName', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="部门">
                <input value={draft.department || ''} onChange={(e) => updateDraft('department', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="任职/活跃时间">
                <input value={draft.yearsActive || ''} onChange={(e) => updateDraft('yearsActive', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="邮箱" className="sm:col-span-2">
                <input
                  value={draft.emailGuess || ''}
                  onChange={(e) => updateDraft('emailGuess', e.target.value)}
                  disabled={!canViewEmails}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder={canViewEmails ? '' : '普通员工不可查看/编辑完整邮箱'}
                />
              </Field>
              <Field label="电话">
                <input value={draft.phone || ''} onChange={(e) => updateDraft('phone', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="WhatsApp">
                <input value={draft.whatsapp || ''} onChange={(e) => updateDraft('whatsapp', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" placeholder="+49... 或号码" />
              </Field>
              <Field label="LinkedIn">
                <input value={draft.linkedin || ''} onChange={(e) => updateDraft('linkedin', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
              </Field>
              <Field label="角色类型">
                <select value={draft.type} onChange={(e) => updateDraft('type', e.target.value as DecisionMaker['type'])} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium bg-white">
                  <option value="Buyer">Buyer</option>
                  <option value="CEO">CEO</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="影响力 1-5">
                <select value={String(draft.influenceScore || 3)} onChange={(e) => updateDraft('influenceScore', Number(e.target.value))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium bg-white">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => onDelete(index)}
                className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-100"
              >
                <Trash2 size={14} /> 删除此人
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setDraft(dm); setIsEditing(false); }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Save size={14} /> 保存
                </button>
              </div>
            </div>
          </div>
        )}

        {dm.emailGuess ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-100">
            <Mail size={12} className="text-violet-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] font-black text-violet-400 uppercase">邮箱来源</div>
              <div className="text-[11px] font-black text-violet-800 truncate" title={dm.emailSource || dm.source || ''}>
                {emailPlatform}
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${verify.ok ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
            {verify.ok ? <ShieldCheck size={12} className="text-emerald-600 flex-shrink-0" /> : <ShieldAlert size={12} className="text-amber-600 flex-shrink-0" />}
            <div className="min-w-0">
              <div className={`text-[9px] font-black uppercase ${verify.ok ? 'text-emerald-500' : 'text-amber-500'}`}>验证状态</div>
              <div className={`text-[11px] font-black truncate ${verify.ok ? 'text-emerald-800' : 'text-amber-800'}`}>{verify.text}</div>
            </div>
          </div>
        </div>
        ) : null}

        {dm.lastEmailCheckedAt ? (
          <div className="text-[10px] font-bold text-slate-400 px-1">
            本条最近处理：{formatSearchTime(dm.lastEmailCheckedAt)}
          </div>
        ) : null}

        {dm.phone && (
          <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-slate-100 text-xs font-bold text-slate-600">
            <Phone size={14} className="text-slate-400" /> {dm.phone}
          </div>
        )}

        {dm.whatsapp && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-xs font-bold text-emerald-800">
            <Phone size={14} className="text-emerald-600" /> WhatsApp: {dm.whatsapp}
          </div>
        )}

        {dm.linkedin ? (
          <a 
            href={dm.linkedin.startsWith('http') ? dm.linkedin : `https://${dm.linkedin}`}
            target="_blank" 
            rel="noreferrer" 
            className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Linkedin size={14} className="text-blue-600 flex-shrink-0" />
              <span className="text-xs font-bold text-blue-700 truncate">LinkedIn 主页</span>
            </div>
            <ExternalLink size={12} className="text-blue-400 flex-shrink-0" />
          </a>
        ) : null}
      </div>
      
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter truncate">
          联系人来源: {abbreviateEmailPlatform(dm.source)}
          {dm.yearsActive ? ` · ${dm.yearsActive}` : ''}
          {dm.influenceScore ? ` · 影响力 ${dm.influenceScore}/5` : ''}
        </div>
        {typeof dm.confidence === 'number' && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, Math.round(dm.confidence * 100))}%` }} />
            </div>
            <span className="text-[10px] font-black text-slate-400">{Math.round(dm.confidence * 100)}%</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDelete(index)}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 text-red-600 py-2.5 text-sm font-black"
      >
        <Trash2 size={16} /> 删除此人
      </button>
    </div>
  );
};
