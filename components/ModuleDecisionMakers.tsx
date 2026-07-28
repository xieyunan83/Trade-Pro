import React, { useEffect, useState } from 'react';
import { AnalysisResult, DecisionMaker } from '../types';
import { Users, Linkedin, Mail, Phone, ExternalLink, UserCheck, AlertTriangle, Download, Briefcase, ShieldCheck, ShieldAlert, RefreshCw, Loader2, Clock } from 'lucide-react';
import { exportContactsToExcel } from '../services/exportService';
import {
  enqueueDmEmailSearch,
  getActiveDmJobForDomain,
  subscribeDmEmailSearchJobs,
} from '../services/dmEmailSearchQueue';

interface ModuleDecisionMakersProps {
  data: AnalysisResult;
  historyId?: string | null;
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

export const ModuleDecisionMakers: React.FC<ModuleDecisionMakersProps> = ({
  data,
  historyId,
  onUpdate,
  onEnqueueEmailSearch,
}) => {
  const [decisionMakers, setDecisionMakers] = useState(data.decisionMakers || []);
  const [lastSearchAt, setLastSearchAt] = useState(data.decisionMakerEmailSearchAt);
  const [searchHistory, setSearchHistory] = useState<number[]>(
    data.decisionMakerEmailSearchHistory || (data.decisionMakerEmailSearchAt ? [data.decisionMakerEmailSearchAt] : [])
  );
  const [queueMsg, setQueueMsg] = useState('');
  const [jobActive, setJobActive] = useState(false);
  const lastAppliedJobIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    setDecisionMakers(data.decisionMakers || []);
    setLastSearchAt(data.decisionMakerEmailSearchAt);
    setSearchHistory(
      data.decisionMakerEmailSearchHistory ||
        (data.decisionMakerEmailSearchAt ? [data.decisionMakerEmailSearchAt] : [])
    );
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
      setQueueMsg(`邮箱搜索已完成，已更新 ${job.resultDecisionMakers.length} 位联系人`);
      // 持久化由 App enqueue onComplete 负责；此处仅刷新 UI
    });
  }, [data.companyInfo?.website, data.decisionMakerEmailSearchAt]);

  const commit = (next: DecisionMaker[]) => {
    setDecisionMakers(next);
    onUpdate?.(next);
  };

  const handleEmailChange = (index: number, newEmail: string) => {
    const next = [...decisionMakers];
    next[index] = {
      ...next[index],
      emailGuess: newEmail,
      source: 'Manual',
      emailSource: 'Manual',
      emailStatus: 'unverified',
      isVerified: false,
    };
    commit(next);
  };

  const handleEnqueueSearch = () => {
    setQueueMsg('');
    if (onEnqueueEmailSearch) {
      const res = onEnqueueEmailSearch();
      setQueueMsg(res.message);
      return;
    }
    // 兜底：无 App 注入时直接入队（不写历史）
    const domain = data.companyInfo?.website || '';
    const res = enqueueDmEmailSearch({
      domain,
      companyName: data.companyInfo?.name || domain,
      historyId,
      existingDecisionMakers: decisionMakers,
    });
    if (res.ok === false) setQueueMsg(res.reason);
    else setQueueMsg('已加入后台搜索队列，可继续浏览其它客户。');
  };

  const buyers = decisionMakers.filter(d => d.type === 'Buyer').length;
  const verified = decisionMakers.filter(d => d.isVerified).length;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
              <Users className="text-blue-600" /> 关键决策人挖掘
            </h3>
            <p className="text-sm text-slate-500 font-medium mt-1">
              背调不会自动扣 Anymail 积分。确认客户后点「后台搜索」：仅将报告中的公司名称 + 决策人姓名交给 Anymail Finder 查找邮箱；已有邮箱会先验证，无效则重新查找。
            </p>
            {lastSearchAt ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-1 text-violet-700">
                  <Clock size={12} /> 最近搜索：{formatSearchTime(lastSearchAt)}
                </span>
                {searchHistory.length > 1 && (
                  <span className="text-slate-400">累计搜索 {searchHistory.length} 次</span>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[11px] font-bold text-amber-600">尚未搜索决策人邮箱（背调阶段已跳过，需手动触发）。</div>
            )}
            {queueMsg && (
              <div className="mt-2 text-[11px] font-bold text-emerald-700">{queueMsg}</div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleEnqueueSearch}
              disabled={jobActive}
              className="inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-bold touch-manipulation"
            >
              {jobActive ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {jobActive ? '后台搜索中…' : '后台搜索决策人邮箱'}
            </button>
            <button
              type="button"
              onClick={() => exportContactsToExcel(decisionMakers, data.companyInfo.name)}
              className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold touch-manipulation"
            >
              <Download size={16} /> 导出 Excel
            </button>
          </div>
        </div>

        {jobActive && (
          <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs font-bold text-violet-800">
            已在后台搜索，可切换到其它客户继续浏览或再排队搜索。右下角可查看任务进度。
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-center">
            <div className="text-xl font-black text-slate-900">{decisionMakers.length}</div>
            <div className="text-[10px] font-black text-slate-400 uppercase">联系人</div>
          </div>
          <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100 text-center">
            <div className="text-xl font-black text-blue-700">{buyers}</div>
            <div className="text-[10px] font-black text-blue-400 uppercase">采购相关</div>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-3 border border-emerald-100 text-center">
            <div className="text-xl font-black text-emerald-700">{verified}</div>
            <div className="text-[10px] font-black text-emerald-500 uppercase">已验证邮箱</div>
          </div>
        </div>

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
          {decisionMakers.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-400 font-bold">
              暂无决策人线索。可先点「后台搜索决策人邮箱」，或确认公司网站有效。
            </div>
          ) : decisionMakers.map((dm, i) => (
            <DecisionMakerCard key={`${dm.emailGuess || dm.name}-${i}`} dm={dm} index={i} onEmailChange={handleEmailChange} />
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

const DecisionMakerCard: React.FC<{ dm: DecisionMaker; index: number; onEmailChange: (i: number, e: string) => void }> = ({ dm, index, onEmailChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState(dm.emailGuess || '');
  const emailPlatform = dm.emailSource || dm.source || '未知';
  const verify = statusLabel(dm);

  useEffect(() => { setEmail(dm.emailGuess || ''); }, [dm.emailGuess]);

  return (
    <div className="bg-slate-50 p-5 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-100 hover:border-blue-200 transition-all group">
      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg flex-shrink-0">
            {(dm.name || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <h4 className="text-base sm:text-lg font-black text-slate-800 group-hover:text-blue-600 transition-colors truncate">{dm.name}</h4>
            <div className="text-xs font-bold text-slate-500 truncate">{dm.title}</div>
            {dm.department && <div className="text-[10px] font-bold text-slate-400 mt-0.5">{dm.department}</div>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${typeBadge(dm.type)}`}>{dm.type}</span>
          {verify.ok ? (
            <div className="bg-green-100 text-green-600 p-1.5 rounded-lg" title="已验证"><UserCheck size={16} /></div>
          ) : (
            <div className="bg-yellow-100 text-yellow-600 p-1.5 rounded-lg" title="待验证"><AlertTriangle size={16} /></div>
          )}
        </div>
      </div>
      
      <div className="space-y-2.5 mt-4">
        <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 gap-2">
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            <Mail size={14} className="text-slate-400 shrink-0" />
            {isEditing ? (
              <input 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => { setIsEditing(false); onEmailChange(index, email); }}
                className="text-xs font-bold text-slate-600 w-full border-none focus:ring-0 p-0"
                autoFocus
              />
            ) : (
              <span className="text-xs font-bold text-slate-600 truncate">{email || '待补充（需后台搜索）'}</span>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setIsEditing(true)} className="text-[10px] font-black text-slate-400 hover:text-blue-600">编辑</button>
            <button 
              onClick={() => { navigator.clipboard.writeText(email || ''); alert('已复制'); }}
              className="text-[10px] font-black text-blue-600 hover:underline"
            >
              复制
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-100">
            <Mail size={12} className="text-violet-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] font-black text-violet-400 uppercase">邮箱来源平台</div>
              <div className="text-[11px] font-black text-violet-800 truncate">{email ? emailPlatform : '—'}</div>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${verify.ok ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
            {verify.ok ? <ShieldCheck size={12} className="text-emerald-600 flex-shrink-0" /> : <ShieldAlert size={12} className="text-amber-600 flex-shrink-0" />}
            <div className="min-w-0">
              <div className={`text-[9px] font-black uppercase ${verify.ok ? 'text-emerald-500' : 'text-amber-500'}`}>验证状态</div>
              <div className={`text-[11px] font-black truncate ${verify.ok ? 'text-emerald-800' : 'text-amber-800'}`}>{email ? verify.text : '—'}</div>
            </div>
          </div>
        </div>

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
        ) : (
          <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-dashed border-slate-200 text-xs font-bold text-slate-400">
            <Briefcase size={14} /> 未找到可靠 LinkedIn（已避免编造）
          </div>
        )}
      </div>
      
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter truncate">
          联系人来源: {dm.source}{dm.yearsActive ? ` · ${dm.yearsActive}` : ''}
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
    </div>
  );
};
