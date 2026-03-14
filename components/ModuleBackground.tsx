
import React from 'react';
import { AnalysisResult } from '../types';
import { LayoutDashboard, Globe, MapPin, Calendar, Users, Briefcase, TrendingUp, ShieldCheck, AlertTriangle, Lightbulb, Target } from 'lucide-react';

interface ModuleBackgroundProps {
  data: AnalysisResult;
  onAddToCRM: () => void;
}

export const ModuleBackground: React.FC<ModuleBackgroundProps> = ({ data, onAddToCRM }) => {
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <LayoutDashboard className="text-blue-600" /> 公司基本面 (Company Profile)
            </h3>
            <button onClick={onAddToCRM} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-2">
              <ShieldCheck size={14} /> 导入 CRM
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-400"><Globe size={20} /></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">总部地点</div>
                  <div className="text-sm font-bold text-slate-800">{data.companyInfo.headquarters}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-400"><Calendar size={20} /></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">成立年份</div>
                  <div className="text-sm font-bold text-slate-800">{data.companyInfo.foundedYear}</div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-400"><Users size={20} /></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">公司规模</div>
                  <div className="text-sm font-bold text-slate-800">{data.companyInfo.scale}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-400"><Briefcase size={20} /></div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">企业性质</div>
                  <div className="text-sm font-bold text-slate-800">{data.companyInfo.nature}</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-8">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">公司简介</div>
            <p className="text-sm text-slate-600 leading-relaxed font-medium">{data.companyInfo.description}</p>
          </div>
        </div>
        
        <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-2xl text-white">
          <h3 className="text-xl font-black mb-6 flex items-center gap-2">
            <TrendingUp className="text-green-400" /> 财务与规模估算
          </h3>
          <div className="space-y-6">
            <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">年营收估算 (Revenue)</div>
              <div className="text-2xl font-black text-green-400">{data.financials.revenueEstimate}</div>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">付款方式偏好</div>
              <div className="text-sm font-bold text-slate-300">{data.financials.paymentTerms}</div>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">知识产权/品牌信息</div>
              <div className="text-sm font-bold text-slate-300">{data.financials.ipInfo}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
            <ShieldCheck className="text-blue-600" /> SWOT 分析
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
              <div className="text-[10px] font-black text-green-700 uppercase tracking-widest mb-2">优势 (Strengths)</div>
              <ul className="text-xs font-bold text-green-800 space-y-1">
                {data.swot.strengths.map((s, i) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
            <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
              <div className="text-[10px] font-black text-red-700 uppercase tracking-widest mb-2">劣势 (Weaknesses)</div>
              <ul className="text-xs font-bold text-red-800 space-y-1">
                {data.swot.weaknesses.map((s, i) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
              <div className="text-[10px] font-black text-blue-700 uppercase tracking-widest mb-2">机会 (Opportunities)</div>
              <ul className="text-xs font-bold text-blue-800 space-y-1">
                {data.swot.opportunities.map((s, i) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
            <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100">
              <div className="text-[10px] font-black text-yellow-700 uppercase tracking-widest mb-2">威胁 (Threats)</div>
              <ul className="text-xs font-bold text-yellow-800 space-y-1">
                {data.swot.threats.map((s, i) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
            <Target className="text-blue-600" /> 业务模式与定位
          </h3>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="bg-slate-50 p-3 rounded-2xl text-slate-400 mt-1"><Briefcase size={18} /></div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">核心业务渠道</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {data.businessModel.channels.map((c, i) => <span key={i} className="bg-slate-100 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-bold">{c}</span>)}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="bg-slate-50 p-3 rounded-2xl text-slate-400 mt-1"><Users size={18} /></div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">目标消费群体</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {data.targetAudience.map((a, i) => <span key={i} className="bg-blue-50 text-blue-600 px-2 py-1 rounded-lg text-[10px] font-bold">{a}</span>)}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="bg-slate-50 p-3 rounded-2xl text-slate-400 mt-1"><Lightbulb size={18} /></div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">品牌定位</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{data.businessScope.brandPositioning}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
