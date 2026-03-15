
import React, { useState } from 'react';
import { Client, HistoryItem } from '../types';
import { Users, Globe, MapPin, Briefcase, Calendar, Search, Filter, Plus, Trash2, Edit2, CheckCircle2, AlertTriangle, MoreVertical, ExternalLink } from 'lucide-react';

interface ModuleClientCRMProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onBatchAnalyze: (clients: Client[]) => Promise<void>;
  history: HistoryItem[];
}

export const ModuleClientCRM: React.FC<ModuleClientCRMProps> = ({ clients, setClients, onBatchAnalyze, history }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBackgroundCheck, setFilterBackgroundCheck] = useState<boolean>(false);

  const onDeleteClient = (id: string) => {
    setClients(prev => prev.filter(c => c.id !== id));
  };

  const onAnalyze = (domain: string) => {
    console.log("Analyzing", domain);
  };

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (c.website || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
    const matchesBackgroundCheck = !filterBackgroundCheck || c.hasBackgroundCheck;
    return matchesSearch && matchesStatus && matchesBackgroundCheck;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case '新建/潜在': return 'bg-slate-100 text-slate-600';
      case '已寄样': return 'bg-blue-100 text-blue-600';
      case '谈判中': return 'bg-yellow-100 text-yellow-600';
      case '已成交': return 'bg-green-100 text-green-600';
      case '流失/搁置': return 'bg-red-100 text-red-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input 
              type="text" 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
              placeholder="搜索客户名称或网址..."
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <select 
              value={filterStatus} 
              onChange={e => setFilterStatus(e.target.value)}
              className="pl-12 pr-8 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold appearance-none bg-white"
            >
              <option value="all">全部状态</option>
              <option value="新建/潜在">新建/潜在</option>
              <option value="已寄样">已寄样</option>
              <option value="谈判中">谈判中</option>
              <option value="已成交">已成交</option>
              <option value="流失/搁置">流失/搁置</option>
            </select>
          </div>
          <label className="flex items-center gap-2 font-bold text-sm text-slate-700">
            <input 
              type="checkbox" 
              checked={filterBackgroundCheck}
              onChange={e => setFilterBackgroundCheck(e.target.checked)}
              className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            仅显示已做过背调
          </label>
        </div>
        <button className="bg-slate-900 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-blue-600 transition-all flex items-center gap-2 w-full md:w-auto justify-center">
          <Plus size={20} /> 新增客户
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClients.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
            <div className="bg-slate-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-300">
              <Users size={32} />
            </div>
            <h3 className="text-lg font-black text-slate-800">暂无客户数据</h3>
            <p className="text-slate-400 font-bold text-sm mt-1">开始搜索并导入您的第一批客户吧</p>
          </div>
        ) : (
          filteredClients.map(client => (
            <div key={client.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:border-blue-200 transition-all group overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${getStatusColor(client.status)}`}>
                    {client.status}
                  </div>
                  <div className="flex gap-1">
                    <button className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"><Edit2 size={14} /></button>
                    <button onClick={() => onDeleteClient(client.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
                
                <h4 className="text-xl font-black text-slate-800 mb-1 group-hover:text-blue-600 transition-colors">{client.name}</h4>
                <div className="flex items-center gap-1 text-xs font-bold text-slate-400 mb-4">
                  <Globe size={12} /> {client.website} • {client.country}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">产品类型</div>
                    <div className="text-xs font-bold text-slate-700 truncate">{client.productType}</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">价格区间</div>
                    <div className="text-xs font-bold text-slate-700">{client.priceRange}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {(client.contacts || []).slice(0, 3).map((c, i) => (
                      <div key={i} className="w-8 h-8 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center text-[10px] font-black text-white" title={c.name}>
                        {c.name.charAt(0)}
                      </div>
                    ))}
                    {(client.contacts || []).length > 3 && (
                      <div className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-[10px] font-black text-slate-500">
                        +{(client.contacts || []).length - 3}
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => client.website && onAnalyze(client.website)}
                    className="text-xs font-black text-blue-600 hover:underline flex items-center gap-1"
                  >
                    深度调查 <ExternalLink size={12} />
                  </button>
                </div>
              </div>
              
              <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <Calendar size={12} /> 下次跟进: {client.nextFollowUpDate || '未设置'}
                </div>
                {client.hasAnalyzed && <CheckCircle2 size={16} className="text-green-500" />}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
