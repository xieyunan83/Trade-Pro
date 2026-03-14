
import React from 'react';
import { AnalysisResult } from '../types';
import { Users, Linkedin, Mail, ShieldCheck, ExternalLink, UserCheck, AlertTriangle } from 'lucide-react';

interface ModuleDecisionMakersProps {
  data: AnalysisResult;
}

export const ModuleDecisionMakers: React.FC<ModuleDecisionMakersProps> = ({ data }) => {
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
          <Users className="text-blue-600" /> 关键决策人挖掘 (Decision Makers)
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.decisionMakers.map((dm, i) => (
            <div key={i} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 hover:border-blue-200 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg">
                    {dm.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-lg font-black text-slate-800 group-hover:text-blue-600 transition-colors">{dm.name}</h4>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{dm.title}</div>
                  </div>
                </div>
                {dm.isVerified ? (
                  <div className="bg-green-100 text-green-600 p-1.5 rounded-lg" title="已验证 (Verified)"><UserCheck size={16} /></div>
                ) : (
                  <div className="bg-yellow-100 text-yellow-600 p-1.5 rounded-lg" title="AI 推测 (AI Guessed)"><AlertTriangle size={16} /></div>
                )}
              </div>
              
              <div className="space-y-3 mt-6">
                {dm.emailGuess && (
                  <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Mail size={14} className="text-slate-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-600 truncate">{dm.emailGuess}</span>
                    </div>
                    <button 
                      onClick={(e) => {
                        navigator.clipboard.writeText(dm.emailGuess || '');
                        const btn = e.currentTarget as HTMLButtonElement;
                        const originalText = btn.innerText;
                        btn.innerText = '已复制';
                        btn.classList.add('text-green-600');
                        setTimeout(() => {
                          btn.innerText = originalText;
                          btn.classList.remove('text-green-600');
                        }, 2000);
                      }}
                      className="text-[10px] font-black text-blue-600 hover:underline shrink-0 ml-2"
                    >
                      复制
                    </button>
                  </div>
                )}
                {dm.linkedin && (
                  <a 
                    href={dm.linkedin} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Linkedin size={14} className="text-blue-600" />
                      <span className="text-xs font-bold text-blue-700">LinkedIn Profile</span>
                    </div>
                    <ExternalLink size={12} className="text-blue-400" />
                  </a>
                )}
              </div>
              
              <div className="mt-4 flex items-center justify-between">
                <div className="text-[10px] font-black text-slate-300 uppercase tracking-tighter">来源: {dm.source}</div>
                {dm.confidence && (
                  <div className="flex items-center gap-1">
                    <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${dm.confidence * 100}%` }}></div>
                    </div>
                    <span className="text-[10px] font-black text-slate-400">{Math.round(dm.confidence * 100)}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
