
import React, { useState } from 'react';
import { DiscoveryState, ClientSearchResult } from '../types';
import { Search, Globe, MapPin, Briefcase, Loader2, Plus, Layers } from 'lucide-react';
import { searchPotentialClients } from '../services/geminiService';

interface ClientFinderProps {
  state: DiscoveryState;
  onStateChange: (state: DiscoveryState) => void;
  onSelect: (domain: string) => void;
  onBatchAddToCRM: (results: ClientSearchResult[]) => void;
  onBatchAnalyze: (results: ClientSearchResult[]) => void;
}

export const ClientFinder: React.FC<ClientFinderProps> = ({ state, onStateChange, onSelect, onBatchAddToCRM, onBatchAnalyze }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const handleSearch = async () => {
    if (!state.product) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const results = await searchPotentialClients(state.product, state.country, state.industry, state.clientType);
      onStateChange({ ...state, results, hasSearched: true });
      setSelectedIndices(new Set());
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || '搜索失败，请稍后重试');
      onStateChange({ ...state, results: [], hasSearched: true });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIndices(next);
  };

  const selectedResults = state.results.filter((_, i) => selectedIndices.has(i));

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in px-0 sm:px-0">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-4 sm:mb-6 flex items-center gap-2">
          <Globe className="text-blue-600 flex-shrink-0" /> 全球客户精准搜索
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">产品关键词 (Product)</label>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
              <input 
                type="text" 
                value={state.product} 
                onChange={e => onStateChange({ ...state, product: e.target.value })}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                placeholder="例如: Silicone Baby Bibs"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">目标国家 (Country)</label>
            <div className="relative">
              <MapPin className="absolute left-4 top-3.5 text-slate-400" size={18} />
              <input 
                type="text" 
                value={state.country} 
                onChange={e => onStateChange({ ...state, country: e.target.value })}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                placeholder="例如: USA"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">客户类型</label>
            <select 
              value={state.clientType} 
              onChange={e => onStateChange({ ...state, clientType: e.target.value })}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold appearance-none bg-white"
            >
              <option value="">全部类型</option>
              <option value="Importer">进口商 (Importer)</option>
              <option value="Wholesaler">批发商 (Wholesaler)</option>
              <option value="Retailer">零售商 (Retailer)</option>
              <option value="Distributor">分销商 (Distributor)</option>
            </select>
          </div>
        </div>
        
        <button 
          onClick={handleSearch}
          disabled={loading || !state.product}
          className="w-full mt-4 sm:mt-6 bg-slate-900 hover:bg-blue-600 text-white py-3 sm:py-4 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2 touch-manipulation"
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : '开始搜索'}
        </button>
        {errorMsg && (
          <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl text-sm font-bold text-red-600">
            {errorMsg}
          </div>
        )}
      </div>

      {state.hasSearched && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <h3 className="text-base sm:text-lg font-black text-slate-800">搜索结果 ({state.results.length})</h3>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <button 
                disabled={selectedIndices.size === 0}
                onClick={() => onBatchAddToCRM(selectedResults)}
                className="flex items-center justify-center gap-2 bg-white border border-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 touch-manipulation"
              >
                <Plus size={16} /> 导入 CRM ({selectedIndices.size})
              </button>
              <button 
                disabled={selectedIndices.size === 0}
                onClick={() => onBatchAnalyze(selectedResults)}
                className="flex items-center justify-center gap-2 bg-blue-600 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
              >
                <Layers size={16} /> 批量分析 ({selectedIndices.size})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {state.results.map((res, idx) => (
              <div 
                key={idx} 
                className={`bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all cursor-pointer touch-manipulation ${selectedIndices.has(idx) ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}
                onClick={() => toggleSelect(idx)}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-slate-50 p-3 rounded-2xl text-slate-400">
                    <Briefcase size={24} />
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onSelect(res.website); }}
                    className="text-xs font-black text-blue-600 hover:underline"
                  >
                    深度分析 →
                  </button>
                </div>
                <h4 className="text-lg font-black text-slate-800 mb-1">{res.name}</h4>
                <div className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1">
                  <Globe size={12} /> {res.website} • {res.country}
                </div>
                <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">{res.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
