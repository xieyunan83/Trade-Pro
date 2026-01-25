import React, { useState } from 'react';
import { AnalysisResult } from '../types';
import { Globe, MapPin, Box, ExternalLink, ListPlus, Search, ArrowRight } from 'lucide-react';

interface Props {
  data: AnalysisResult;
  onAnalyze: (domain: string) => void;
}

export const ModuleSimilar: React.FC<Props> = ({ data, onAnalyze }) => {
  const [visibleCount, setVisibleCount] = useState(30); // Default to showing 30
  
  const showMore = () => {
    setVisibleCount(prev => prev + 30);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8 border-b border-slate-200 pb-4">
        <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Globe className="text-blue-500" />
                同类型潜在客户 (Similar Importers & Competitors)
            </h2>
            <p className="text-slate-500 text-sm mt-1 font-medium">
                AI 深度搜索：为您找出了该行业在目标地区的对口买家与品牌商
            </p>
        </div>
        <div className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-blue-100 flex items-center gap-2">
            发现数量: {data.similarCompanies.length}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {data.similarCompanies.slice(0, visibleCount).map((company, idx) => (
            <div key={idx} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-400 transition-all flex flex-col justify-between group h-full relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <Globe size={60} />
                </div>
                
                <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                        <h3 className="font-bold text-lg text-slate-900 leading-tight group-hover:text-blue-700 transition-colors" title={company.name}>{company.name}</h3>
                    </div>
                    
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-4 bg-blue-50 px-2 py-1 rounded w-fit">
                         <MapPin size={12} /> {company.country || "Global"}
                    </div>

                    <div className="text-sm text-slate-600 font-mono mb-4 break-all bg-slate-50 p-2 rounded border border-slate-100 flex items-center gap-2">
                         <Globe size={14} className="text-slate-400" />
                         <span className="truncate">{company.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                    </div>

                    <div className="text-sm text-slate-500 flex items-start gap-2 mb-6 min-h-[3em]">
                        <Box size={16} className="mt-1 flex-shrink-0 text-slate-400" />
                        <p className="line-clamp-3 italic leading-relaxed">
                            {company.mainProducts || "N/A"}
                        </p>
                    </div>
                </div>
                
                <div className="pt-4 border-t border-slate-100 flex gap-2">
                    <button 
                        onClick={() => onAnalyze(company.website)}
                        className="flex-1 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg active:scale-95"
                    >
                        <Search size={14} /> Analyze (调查)
                    </button>
                    <a 
                        href={company.website} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="p-2.5 bg-slate-50 text-slate-400 border border-slate-200 rounded-xl hover:bg-slate-100 hover:text-blue-600 transition-colors"
                        title="Visit Official Website"
                    >
                        <ExternalLink size={18} />
                    </a>
                </div>
            </div>
        ))}
      </div>

      {visibleCount < data.similarCompanies.length && (
        <div className="mt-12 text-center pb-10">
            <button 
                onClick={showMore}
                className="inline-flex items-center gap-2 px-10 py-4 bg-white border border-slate-300 text-slate-700 font-bold rounded-2xl hover:bg-slate-50 hover:border-blue-400 hover:text-blue-600 transition-all shadow-lg active:scale-95 group"
            >
                <ListPlus size={20} className="group-hover:rotate-180 transition-transform duration-500" />
                加载更多潜在客户 (Load More Results)
            </button>
        </div>
      )}

      {data.similarCompanies.length === 0 && (
          <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-slate-300">
              <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Search className="text-slate-300" size={40} />
              </div>
              <h3 className="text-slate-600 font-bold text-xl">未发现更多同类客户</h3>
              <p className="text-slate-400 mt-2 max-w-md mx-auto">AI 搜索引擎未能在当前上下文中找到更多具有独立官网的对口客户。</p>
          </div>
      )}

      <div className="mt-8 p-6 bg-blue-50 rounded-2xl text-center text-blue-700 text-sm border border-blue-100 shadow-inner">
        <p className="flex items-center justify-center gap-2 font-medium">
             <CheckCircle size={16} /> 已为您自动过滤 B2B 平台、社交媒体页面与中国出口商，专注于精准独立站买家。
        </p>
      </div>
    </div>
  );
};

const CheckCircle: React.FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);