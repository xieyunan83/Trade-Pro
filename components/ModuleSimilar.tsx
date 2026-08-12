import React from 'react';
import { AnalysisResult, SimilarCompany } from '../types';
import { Network } from 'lucide-react';
import { SimilarCompaniesPanel } from './SimilarCompaniesPanel';

interface ModuleSimilarProps {
  data: AnalysisResult;
  onAnalyze: (domain: string) => void;
  onBatchAnalyze?: (companies: SimilarCompany[]) => void;
}

export const ModuleSimilar: React.FC<ModuleSimilarProps> = ({
  data,
  onAnalyze,
  onBatchAnalyze,
}) => {
  const companies = data.similarCompanies || [];

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-800 mb-2 flex items-center gap-2 flex-wrap">
          <Network className="text-blue-600" /> 同类公司推荐 (Similar Companies)
          {companies.length > 0 && (
            <span className="text-sm font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
              {companies.length} 家
            </span>
          )}
        </h3>
        <SimilarCompaniesPanel
          companies={companies}
          onAnalyze={onAnalyze}
          onBatchAnalyze={onBatchAnalyze}
          description="基于当前公司的业务模式、产品线和市场定位推荐。列表已保存在本背调报告中；可多选后批量加入背调队列。"
        />
      </div>
    </div>
  );
};
