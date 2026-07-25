import React, { useEffect, useState } from 'react';
import { AnalysisResult, DecisionMaker } from '../types';
import { Users, Linkedin, Mail, Phone, ExternalLink, UserCheck, AlertTriangle, Download, Briefcase } from 'lucide-react';
import { exportContactsToExcel } from '../services/exportService';

interface ModuleDecisionMakersProps {
  data: AnalysisResult;
  onUpdate?: (decisionMakers: DecisionMaker[]) => void;
}

export const ModuleDecisionMakers: React.FC<ModuleDecisionMakersProps> = ({ data, onUpdate }) => {
  const [decisionMakers, setDecisionMakers] = useState(data.decisionMakers || []);

  useEffect(() => {
    setDecisionMakers(data.decisionMakers || []);
  }, [data.decisionMakers]);

  const commit = (next: DecisionMaker[]) => {
    setDecisionMakers(next);
    onUpdate?.(next);
  };

  const handleEmailChange = (index: number, newEmail: string) => {
    const next = [...decisionMakers];
    next[index] = { ...next[index], emailGuess: newEmail, source: 'Manual', isVerified: true };
    commit(next);
  };

  const buyers = decisionMakers.filter(d => d.type === 'Buyer').length;
  const verified = decisionMakers.filter(d => d.isVerified).length;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
              <Users className="text-blue-600" /> 关键决策人挖掘
            </h3>
            <p className="text-sm text-slate-500 font-medium mt-1">
              优先展示采购 /  sourcing / 高管。邮箱经 Hunter / Findymail / Anymail 交叉验证时标记「已验证」。
            </p>
          </div>
          <button
            onClick={() => exportContactsToExcel(decisionMakers, data.companyInfo.name)}
            className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold touch-manipulation"
          >
            <Download size={16} /> 导出 Excel
          </button>
        </div>

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
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {decisionMakers.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-400 font-bold">未找到决策人，请确认目标网站有效或配置邮箱搜索 API</div>
          ) : decisionMakers.map((dm, i) => (
            <DecisionMakerCard key={`${dm.name}-${i}`} dm={dm} index={i} onEmailChange={handleEmailChange} />
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

const DecisionMakerCard: React.FC<{ dm: DecisionMaker; index: number; onEmailChange: (i: number, e: string) => void }> = ({ dm, index, onEmailChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState(dm.emailGuess || '');

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
          {dm.isVerified ? (
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
              <span className="text-xs font-bold text-slate-600 truncate">{email || '待补充'}</span>
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
          来源: {dm.source}{dm.yearsActive ? ` · ${dm.yearsActive}` : ''}
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
