
import React from 'react';
import { AnalysisResult, DecisionMaker } from '../types';
import { exportContactsToExcel } from '../services/exportService';
import { UserCheck, Mail, Linkedin, ShieldAlert, Search, BadgeCheck, AlertCircle, Download } from 'lucide-react';

interface Props {
  data: AnalysisResult;
}

const ensureAbsoluteUrl = (url: string | undefined): string => {
    if (!url || url === 'N/A' || url === '#') return '#';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('www.')) return `https://${trimmed}`;
    return `https://${trimmed}`;
};

export const ModuleDecisionMakers: React.FC<Props> = ({ data }) => {
  const sortedPeople = [...(data?.decisionMakers || [])].sort((a, b) => {
      const rank = (p: DecisionMaker) => {
          let r = 0;
          if (p.type === 'CEO') r += 10;
          if (p.type === 'Buyer') r += 5;
          if (p.isVerified) r += 20;
          return r;
      };
      return rank(b) - rank(a);
  });

  const handleExport = () => {
      exportContactsToExcel(sortedPeople, data.companyInfo.name);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-6 items-center">
            <div className="bg-blue-600 p-4 rounded-2xl text-white shadow-lg shadow-blue-100">
                 <ShieldAlert size={32} />
            </div>
            <div className="flex-1">
                <h3 className="text-xl font-extrabold text-gray-900">全能决策人挖掘引擎 (Person Intelligence Engine)</h3>
                <p className="text-gray-600 text-sm mt-1 leading-relaxed">
                    集成了 <strong>Hunter.io</strong>, <strong>Findymail</strong> 与 <strong>Anymail Finder</strong>。
                    系统已为您挖掘高管、采购决策人及品类买家，并自动验证邮箱真实性。
                </p>
            </div>
            <div className="flex flex-col items-end gap-2">
                <div className="text-center">
                    <span className="block text-2xl font-black text-blue-600">{(data?.decisionMakers || []).length}</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Found</span>
                </div>
                <button 
                    onClick={handleExport}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm"
                >
                    <Download size={14} /> 导出 Excel (Export)
                </button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedPeople.map((person, idx) => (
                <div key={idx} className={`relative p-6 rounded-2xl border transition-all duration-300 bg-white ${
                    person.isVerified ? 'border-green-200 shadow-md hover:border-green-400' : 'border-slate-200 shadow-sm hover:border-blue-400'
                }`}>
                    
                    <div className="absolute top-4 right-4 flex gap-1.5 z-10">
                        {person.isVerified ? (
                            <span className="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1">
                                <BadgeCheck size={12} /> VERIFIED
                            </span>
                        ) : (
                            <span className="bg-slate-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1">
                                <Search size={12} /> AI FOUND
                            </span>
                        )}
                    </div>

                    <div className="flex items-start gap-4 mb-6 relative">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                            person.type === 'CEO' ? 'bg-purple-100 text-purple-700' :
                            person.type === 'Buyer' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-gray-500'
                        }`}>
                            <UserCheck size={28} />
                        </div>
                        <div className="overflow-hidden">
                            <h3 className="font-black text-gray-900 text-lg truncate mb-1">{person.name}</h3>
                            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide truncate">
                                {person.title || 'Professional'}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3 relative">
                        <div className={`p-3 rounded-xl border flex items-center justify-between ${
                            person.isVerified ? 'bg-green-50/50 border-green-100' : 'bg-slate-50 border-slate-100'
                        }`}>
                            <div className="flex items-center gap-2 overflow-hidden w-full">
                                <Mail size={16} className={person.isVerified ? 'text-green-600' : 'text-gray-400'} />
                                <span className="font-mono text-sm truncate text-gray-800 w-full block">
                                    {person.emailGuess || 'Email not publicly listed'}
                                </span>
                            </div>
                        </div>

                        {person.linkedin ? (
                            <a 
                                href={ensureAbsoluteUrl(person.linkedin)} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="flex items-center gap-2 p-3 rounded-xl border border-blue-100 bg-blue-50/30 text-blue-700 hover:bg-blue-100 transition-all text-sm font-bold"
                            >
                                <Linkedin size={16} /> LinkedIn Profile
                            </a>
                        ) : (
                            <a 
                                href={`https://www.google.com/search?q=${encodeURIComponent(person.name + ' ' + (data?.companyInfo?.name || '') + ' linkedin')}`}
                                target="_blank" 
                                rel="noreferrer" 
                                className="flex items-center gap-2 p-3 rounded-xl border border-dashed border-slate-200 text-gray-400 hover:text-blue-600 hover:bg-white transition-all text-xs"
                            >
                                <Search size={14} /> Manually find on LinkedIn
                            </a>
                        )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase">Source:</span>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                            person.source === 'Hunter.io' ? 'text-orange-700 bg-orange-50' :
                            person.source === 'Findymail' ? 'text-indigo-700 bg-indigo-50' :
                            person.source === 'AnymailFinder' ? 'text-teal-700 bg-teal-50' : 'text-gray-500 bg-slate-100'
                        }`}>
                            {person.source}
                        </span>
                    </div>
                </div>
            ))}
        </div>

        {(!data?.decisionMakers || data.decisionMakers.length === 0) && (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                <AlertCircle size={48} className="text-slate-300 mx-auto mb-4" />
                <h3 className="text-xl font-black text-gray-800">未发现公开联系人</h3>
                <p className="text-gray-500 mt-2 max-w-md mx-auto">AI 建议您尝试在该公司 LinkedIn 官方页面的 "People" 选项卡中手动查找。</p>
            </div>
        )}
    </div>
  );
};
