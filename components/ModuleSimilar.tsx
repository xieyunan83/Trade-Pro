
import React from 'react';
import { AnalysisResult } from '../types';
import { Network, Search, Globe, Briefcase, ChevronRight } from 'lucide-react';

interface ModuleSimilarProps {
  data: AnalysisResult;
  onAnalyze: (domain: string) => void;
}

export const ModuleSimilar: React.FC<ModuleSimilarProps> = ({ data, onAnalyze }) => {
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
          <Network className="text-blue-600" /> 同类公司推荐 (Similar Companies)
        </h3>
        <p className="text-slate-500 font-medium mb-8">基于当前公司的业务模式、产品线和市场定位，为您推荐以下相似的目标客户。</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.similarCompanies.map((comp, i) => (
            <div key={i} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 hover:border-blue-200 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div className="bg-white p-3 rounded-2xl text-blue-600 shadow-sm">
                  <Briefcase size={24} />
                </div>
                <button 
                  onClick={() => onAnalyze(comp.website)}
                  className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-600 transition-colors flex items-center gap-1"
                >
                  <Search size={12} /> 深度调查
                </button>
              </div>
              <h4 className="text-lg font-black text-slate-800 mb-1">{comp.name}</h4>
              <div className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1">
                <Globe size={12} /> {comp.website} • {comp.country}
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">主营产品</div>
                <div className="text-xs font-bold text-slate-600 leading-relaxed">{comp.mainProducts}</div>
              </div>
              <div className="mt-4 flex items-center justify-end text-blue-600 group-hover:translate-x-1 transition-transform">
                <ChevronRight size={16} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
