import React, { useEffect, useState } from 'react';
import { AnalysisResult } from '../types';
import {
  LayoutDashboard, Globe, MapPin, Calendar, Users, Briefcase, TrendingUp, ShieldCheck,
  Lightbulb, Target, Ship, Award, AlertTriangle, Store, Network, Linkedin, Package, Building2, RefreshCw, Loader2
} from 'lucide-react';
import { getActiveDmJobForDomain, subscribeDmEmailSearchJobs } from '../services/dmEmailSearchQueue';

interface ModuleBackgroundProps {
  data: AnalysisResult;
  onAddToCRM: () => void;
  onEnqueueDmEmailSearch?: () => { ok: boolean; message: string };
  /** 是否已搜索过邮箱（用于按钮文案） */
  hasPriorDmSearch?: boolean;
}

const Pill: React.FC<{ children: React.ReactNode; tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' }> = ({ children, tone = 'slate' }) => {
  const map = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${map[tone]}`}>{children}</span>;
};

const SectionCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, icon, children, className = '' }) => (
  <div className={`bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm ${className}`}>
    <h3 className="text-lg sm:text-xl font-black text-slate-800 mb-4 sm:mb-6 flex items-center gap-2">
      {icon} {title}
    </h3>
    {children}
  </div>
);

export const ModuleBackground: React.FC<ModuleBackgroundProps> = ({ data, onAddToCRM, onEnqueueDmEmailSearch, hasPriorDmSearch }) => {
  const trade = data.tradeIntelligence;
  const riskTone = trade?.riskLevel === '低' ? 'green' : trade?.riskLevel === '高' ? 'red' : trade?.riskLevel === '中' ? 'amber' : 'slate';
  const [jobActive, setJobActive] = useState(false);
  const [queueMsg, setQueueMsg] = useState('');

  useEffect(() => {
    const domain = data.companyInfo?.website || '';
    return subscribeDmEmailSearchJobs(() => {
      setJobActive(!!getActiveDmJobForDomain(domain));
    });
  }, [data.companyInfo?.website]);

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Hero profile */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-40 h-40 bg-blue-50 rounded-full blur-2xl pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-5">
            <div>
              <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Company Profile</div>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
                <LayoutDashboard className="text-blue-600 flex-shrink-0" /> {data.companyInfo.name}
              </h3>
              <a
                href={data.companyInfo.website?.startsWith('http') ? data.companyInfo.website : `https://${data.companyInfo.website}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-bold text-blue-600 hover:underline break-all"
              >
                {data.companyInfo.website}
              </a>
              {queueMsg && <div className="mt-2 text-[11px] font-bold text-emerald-700">{queueMsg}</div>}
            </div>
            <div className="flex flex-col gap-2 w-full sm:w-auto flex-shrink-0">
              {onEnqueueDmEmailSearch && (
                <button
                  type="button"
                  disabled={jobActive}
                  onClick={() => {
                    const res = onEnqueueDmEmailSearch();
                    setQueueMsg(res.message);
                  }}
                  className="bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg flex items-center justify-center gap-2 touch-manipulation"
                >
                  {jobActive ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {jobActive ? '决策人邮箱搜索中…' : hasPriorDmSearch ? '再次深挖决策人邮箱' : '后台搜索决策人邮箱'}
                </button>
              )}
              <button onClick={onAddToCRM} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg flex items-center justify-center gap-2 touch-manipulation">
                <ShieldCheck size={14} /> 导入 CRM
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { icon: <MapPin size={16} />, label: '总部', value: data.companyInfo.headquarters },
              { icon: <Building2 size={16} />, label: '城市', value: data.companyInfo.city || '—' },
              { icon: <Calendar size={16} />, label: '成立', value: data.companyInfo.foundedYear },
              { icon: <Users size={16} />, label: '规模', value: data.companyInfo.scale },
            ].map((item, i) => (
              <div key={i} className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-slate-400 mb-1">{item.icon}</div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{item.label}</div>
                <div className="text-sm font-bold text-slate-800 mt-0.5 line-clamp-2">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <Pill tone="blue">{data.companyInfo.nature}</Pill>
            {data.companyInfo.employeeRange && <Pill>{data.companyInfo.employeeRange}</Pill>}
            {data.supplyChain.role && <Pill tone="violet">{data.supplyChain.role}</Pill>}
          </div>

          <p className="text-sm text-slate-600 leading-relaxed font-medium">{data.companyInfo.description}</p>
        </div>

        <div className="bg-slate-900 p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-800 text-white shadow-xl">
          <h3 className="text-lg font-black mb-5 flex items-center gap-2">
            <TrendingUp className="text-emerald-400" /> 财务与结算
          </h3>
          <div className="space-y-3">
            <div className="bg-slate-800/70 p-4 rounded-2xl border border-slate-700">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">年营收估算</div>
              <div className="text-xl sm:text-2xl font-black text-emerald-400">{data.financials.revenueEstimate}</div>
            </div>
            <div className="bg-slate-800/70 p-4 rounded-2xl border border-slate-700">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">付款偏好</div>
              <div className="text-sm font-bold text-slate-200">{data.financials.paymentTerms}</div>
            </div>
            <div className="bg-slate-800/70 p-4 rounded-2xl border border-slate-700">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">品牌 / IP</div>
              <div className="text-sm font-bold text-slate-200">{data.financials.ipInfo}</div>
            </div>
            {trade?.estimatedAnnualImport && trade.estimatedAnnualImport !== '公开信息未找到' && (
              <div className="bg-slate-800/70 p-4 rounded-2xl border border-slate-700">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">预估年进口额</div>
                <div className="text-sm font-bold text-blue-300">{trade.estimatedAnnualImport}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trade intelligence */}
      <SectionCard title="贸易情报与合规 (Trade Intelligence)" icon={<Ship className="text-cyan-600" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">海关 / 进口线索摘要</div>
              <p className="text-sm font-medium text-slate-700 leading-relaxed bg-cyan-50/60 border border-cyan-100 rounded-2xl p-4">
                {trade?.customsSummary || data.businessModel.procurementInfo || '公开信息未找到'}
              </p>
            </div>
            {!!trade?.recentShipments?.length && (
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">近期公开进口线索</div>
                <ul className="space-y-2">
                  {trade.recentShipments.map((s, i) => (
                    <li key={i} className="text-sm font-bold text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">• {s}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">风险等级</span>
              <Pill tone={riskTone as any}>{trade?.riskLevel || '未知'}</Pill>
              {trade?.riskNotes && <span className="text-xs text-slate-500 font-medium">{trade.riskNotes}</span>}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1"><Award size={12} /> 认证与合规</div>
              <div className="flex flex-wrap gap-2">
                {(trade?.certifications?.length ? trade.certifications : ['公开信息未找到']).map((c, i) => (
                  <Pill key={i} tone="green">{c}</Pill>
                ))}
              </div>
              {trade?.complianceNotes && <p className="text-xs text-slate-500 font-medium mt-2">{trade.complianceNotes}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase">Incoterms</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{trade?.preferredIncoterms || '—'}</div>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase">典型 MOQ</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{trade?.typicalMoq || '—'}</div>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase">采购季</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{trade?.buyingSeasons || '—'}</div>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase">采购办公室</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{data.strategy.buyingOfficeLocation || '—'}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">HS / 进口品类 / 来源国</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {(trade?.hsCodes || []).map((h, i) => <Pill key={i} tone="blue">{h}</Pill>)}
                {(trade?.importCategories || []).map((h, i) => <Pill key={`c${i}`} tone="violet">{h}</Pill>)}
              </div>
              <div className="flex flex-wrap gap-2">
                {(trade?.topSourceCountries || []).map((c, i) => <Pill key={i}>{c}</Pill>)}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <SectionCard title="SWOT 分析" icon={<ShieldCheck className="text-blue-600" />}>
          <div className="grid grid-cols-2 gap-3">
            {[
              { title: '优势', items: data.swot.strengths, bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-800', label: 'text-emerald-700' },
              { title: '劣势', items: data.swot.weaknesses, bg: 'bg-red-50 border-red-100', text: 'text-red-800', label: 'text-red-700' },
              { title: '机会', items: data.swot.opportunities, bg: 'bg-blue-50 border-blue-100', text: 'text-blue-800', label: 'text-blue-700' },
              { title: '威胁', items: data.swot.threats, bg: 'bg-amber-50 border-amber-100', text: 'text-amber-900', label: 'text-amber-800' },
            ].map((q, i) => (
              <div key={i} className={`${q.bg} border p-3 sm:p-4 rounded-2xl`}>
                <div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${q.label}`}>{q.title}</div>
                <ul className={`text-xs font-bold space-y-1 ${q.text}`}>
                  {(q.items?.length ? q.items : ['暂无']).map((s, j) => <li key={j}>• {s}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="业务模式与渠道" icon={<Target className="text-blue-600" />}>
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">核心产品</div>
              <div className="flex flex-wrap gap-2">
                {data.businessScope.coreProducts.map((c, i) => <Pill key={i} tone="blue">{c}</Pill>)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">销售渠道</div>
              <div className="flex flex-wrap gap-2">
                {data.businessModel.channels.map((c, i) => <Pill key={i}>{c}</Pill>)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1"><Store size={12} /> 电商布局</div>
              <div className="flex flex-wrap gap-2">
                {(data.businessModel.ecommercePresence?.length ? data.businessModel.ecommercePresence : ['未发现']).map((c, i) => <Pill key={i} tone="violet">{c}</Pill>)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">展会足迹</div>
              <div className="flex flex-wrap gap-2">
                {(data.businessModel.exhibitionHistory?.length ? data.businessModel.exhibitionHistory : ['公开信息未找到']).map((c, i) => <Pill key={i} tone="amber">{c}</Pill>)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="bg-slate-50 p-3 rounded-2xl text-slate-400"><Lightbulb size={18} /></div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">品牌定位</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{data.businessScope.brandPositioning}</div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <SectionCard title="供应链与采购习惯" icon={<Network className="text-indigo-600" />}>
          <div className="space-y-3 text-sm font-medium text-slate-700">
            <div><span className="font-black text-slate-400 text-[10px] uppercase tracking-widest block mb-1">角色</span>{data.supplyChain.role}</div>
            <div><span className="font-black text-slate-400 text-[10px] uppercase tracking-widest block mb-1">服务模式</span>{data.supplyChain.serviceType}</div>
            <div><span className="font-black text-slate-400 text-[10px] uppercase tracking-widest block mb-1">采购习惯</span>{data.businessModel.procurementInfo}</div>
            <div>
              <span className="font-black text-slate-400 text-[10px] uppercase tracking-widest block mb-2">目标客群</span>
              <div className="flex flex-wrap gap-2">
                {data.targetAudience.map((a, i) => <Pill key={i} tone="blue">{a}</Pill>)}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="官网品类与社交" icon={<Package className="text-pink-600" />}>
          <div className="space-y-4">
            {data.websiteCategories?.slice(0, 6).map((cat, i) => (
              <div key={i}>
                <div className="text-xs font-black text-slate-800 mb-1">{cat.categoryName}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(cat.items || []).slice(0, 8).map((it, j) => <Pill key={j}>{it}</Pill>)}
                </div>
              </div>
            ))}
            {!data.websiteCategories?.length && <p className="text-sm text-slate-400 font-bold">暂无官网品类拆解</p>}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-3">
              {(trade?.companyLinkedin || data.socials.linkedin) && (
                <a href={trade?.companyLinkedin || data.socials.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline">
                  <Linkedin size={14} /> 公司 LinkedIn
                </a>
              )}
              {data.socials.facebook && <span className="text-xs font-bold text-slate-500">FB: {data.socials.facebook}</span>}
            </div>
          </div>
        </SectionCard>
      </div>

      {!!data.strategy.actionPlan?.length && (
        <SectionCard title="建议行动计划" icon={<Briefcase className="text-slate-800" />}>
          <ol className="space-y-3">
            {data.strategy.actionPlan.map((step, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="w-7 h-7 rounded-xl bg-slate-900 text-white text-xs font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <span className="text-sm font-bold text-slate-700 pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      {data.marketTrends && data.marketTrends !== 'N/A' && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1"><AlertTriangle size={12} /> 市场趋势</div>
          <p className="text-sm font-medium leading-relaxed text-slate-100">{data.marketTrends}</p>
        </div>
      )}
    </div>
  );
};
