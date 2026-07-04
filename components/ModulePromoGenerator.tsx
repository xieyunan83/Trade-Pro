
import React, { useState } from 'react';
import { AutomationResult } from '../types';
import { Ruler, PlayCircle, StopCircle, Trash2, CheckCircle2, Loader2, AlertTriangle, Clock, Hourglass, Mail, FileText, ChevronRight } from 'lucide-react';

interface ModulePromoGeneratorProps {
  onStartAutomation: (keyword: string, productContext: string, countries: string[], productImages: string[], clientType: string) => void;
  automationResults: AutomationResult[];
  isAutomating: boolean;
  onRunPending: () => void;
  onRunSingle: (id: string) => void;
  onDelete: (id: string) => void;
}

export const ModulePromoGenerator: React.FC<ModulePromoGeneratorProps> = ({ 
  onStartAutomation, 
  automationResults, 
  isAutomating, 
  onRunPending, 
  onRunSingle, 
  onDelete 
}) => {
  const [keyword, setKeyword] = useState('');
  const [productContext, setProductContext] = useState('');
  const [countries, setCountries] = useState('USA, UK, Germany');
  const [clientType, setClientType] = useState('Importer');

  const handleStart = () => {
    const countryList = countries.split(',').map(c => c.trim()).filter(c => c.length > 0);
    onStartAutomation(keyword, productContext, countryList, [], clientType);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-4 sm:mb-6 flex items-center gap-2">
          <Ruler className="text-blue-600" /> 自动化获客工作流
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">搜索关键词</label>
              <input 
                type="text" 
                value={keyword} 
                onChange={e => setKeyword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                placeholder="例如: Silicone Baby Products"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">目标国家 (逗号分隔)</label>
              <input 
                type="text" 
                value={countries} 
                onChange={e => setCountries(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                placeholder="USA, UK, Canada"
              />
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">产品背景/卖点 (Context)</label>
              <textarea 
                value={productContext} 
                onChange={e => setProductContext(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold h-[116px] resize-none"
                placeholder="描述您的产品优势，用于生成开发信..."
              />
            </div>
          </div>
        </div>
        
        <button 
          onClick={handleStart}
          disabled={isAutomating || !keyword}
          className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2"
        >
          {isAutomating ? <Loader2 className="animate-spin" size={20} /> : <PlayCircle size={20} />}
          开始自动化任务 (Start Automation Task)
        </button>
      </div>

      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-slate-50/50">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Clock className="text-slate-400" /> 任务队列 ({automationResults.length})
          </h3>
          <button 
            onClick={onRunPending}
            disabled={isAutomating || automationResults.filter(r => r.status === 'pending' || r.status === 'failed').length === 0}
            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            继续待处理任务
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <th className="px-6 py-4">客户信息</th>
                <th className="px-6 py-4">状态</th>
                <th className="px-6 py-4">模式</th>
                <th className="px-6 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {automationResults.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-bold">暂无任务队列</td>
                </tr>
              ) : (
                automationResults.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-800">{task.clientName}</div>
                      <div className="text-[10px] text-slate-400 font-bold">{task.website} • {task.country}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                        task.status === 'completed' ? 'bg-green-100 text-green-600' :
                        task.status === 'failed' ? 'bg-red-100 text-red-600' :
                        task.status === 'pending' ? 'bg-slate-100 text-slate-400' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {task.status === 'analyzing' || task.status === 'generating_email' ? <Loader2 className="animate-spin" size={10}/> : null}
                        {task.status === 'completed' ? <CheckCircle2 size={10}/> : null}
                        {task.status === 'failed' ? <AlertTriangle size={10}/> : null}
                        {task.status === 'pending' ? <Hourglass size={10}/> : null}
                        {task.status.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] font-black text-slate-400 uppercase">{task.mode || 'economy'}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {task.status === 'completed' && (
                          <button className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="查看结果">
                            <FileText size={16} />
                          </button>
                        )}
                        {(task.status === 'pending' || task.status === 'failed') && (
                          <button 
                            onClick={() => onRunSingle(task.id)}
                            disabled={isAutomating}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50" 
                            title="运行"
                          >
                            <PlayCircle size={16} />
                          </button>
                        )}
                        <button 
                          onClick={() => onDelete(task.id)}
                          className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors" 
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
