
import React from 'react';
import { AnalysisResult } from '../types';
import { PackageSearch, DollarSign, Tag, Info, ShoppingCart, BarChart3, PieChart } from 'lucide-react';

interface ModuleProductsProps {
  data: AnalysisResult;
}

export const ModuleProducts: React.FC<ModuleProductsProps> = ({ data }) => {
  return (
    <div className="space-y-8 animate-fade-in">
      {data.productSummary && (
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
            <PieChart className="text-blue-600" /> 市场喜好与产品策略 (Product Strategy)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                <div className="text-[10px] font-black text-blue-700 uppercase tracking-widest mb-2 flex items-center gap-1"><ShoppingCart size={12}/> 终端市场喜好 (Market Preference)</div>
                <p className="text-sm font-bold text-blue-900 leading-relaxed">{data.productSummary.marketPreference}</p>
              </div>
              <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100">
                <div className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-2 flex items-center gap-1"><Tag size={12}/> 推荐开发产品 (Recommended Products)</div>
                <p className="text-sm font-bold text-purple-900 leading-relaxed">{data.productSummary.recommendedProducts}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="bg-white p-3 rounded-xl text-blue-600 shadow-sm"><PackageSearch size={20}/></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">包装偏好分析</div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{data.productSummary.packagingAnalysis}</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="bg-white p-3 rounded-xl text-pink-600 shadow-sm"><Tag size={20}/></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">颜色偏好分析</div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{data.productSummary.colorPreference}</div>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="bg-white p-3 rounded-xl text-green-600 shadow-sm"><BarChart3 size={20}/></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">功能点/卖点分析</div>
                  <div className="text-sm font-bold text-slate-800 mt-1">{data.productSummary.featureAnalysis}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
          <PackageSearch className="text-blue-600" /> 核心产品线分析 (Core Product Lines)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.products.map((p, i) => (
            <div key={i} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 hover:border-blue-200 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <h4 className="text-lg font-black text-slate-800 group-hover:text-blue-600 transition-colors">{p.name}</h4>
                <div className="bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-black shadow-md">{p.retailPrice}</div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-white p-3 rounded-xl border border-slate-100">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">建议 FOB 价</div>
                  <div className="text-sm font-black text-slate-800">¥{p.estimatedFOBPriceCNY}</div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-100">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">利润空间</div>
                  <div className={`text-sm font-black ${p.marginSpace === 'High' ? 'text-green-600' : p.marginSpace === 'Medium' ? 'text-blue-600' : 'text-yellow-600'}`}>{p.marginSpace}</div>
                </div>
              </div>

              <div className="space-y-3">
                {p.features && (
                  <div className="flex items-start gap-2">
                    <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs font-bold text-slate-600"><span className="text-slate-400 uppercase tracking-tighter mr-1">功能:</span> {p.features}</div>
                  </div>
                )}
                {p.colors && (
                  <div className="flex items-start gap-2">
                    <Tag size={14} className="text-pink-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs font-bold text-slate-600"><span className="text-slate-400 uppercase tracking-tighter mr-1">颜色:</span> {p.colors}</div>
                  </div>
                )}
                {p.packaging && (
                  <div className="flex items-start gap-2">
                    <PackageSearch size={14} className="text-purple-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs font-bold text-slate-600"><span className="text-slate-400 uppercase tracking-tighter mr-1">包装:</span> {p.packaging}</div>
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
