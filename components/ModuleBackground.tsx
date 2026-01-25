import React from 'react';
import { AnalysisResult } from '../types';
import { Building2, Globe, TrendingUp, Share2, Info, Activity, Truck, Target, Plus, BrainCircuit, Box, Layers } from 'lucide-react';

interface Props {
  data: AnalysisResult;
  onAddToCRM?: () => void;
  onOpenStrategy?: () => void;
}

const CardHeader: React.FC<{ title: string; icon: React.ElementType; action?: React.ReactNode }> = ({ title, icon: Icon, action }) => (
    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
        <div className="flex items-center gap-3">
            <div className="bg-white p-1.5 rounded-lg shadow-sm border border-slate-200">
                <Icon className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
        </div>
        {action}
    </div>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow duration-300 ${className}`}>
    {children}
  </div>
);

const Field: React.FC<{ label: string; value: string | boolean | undefined; full?: boolean }> = ({ label, value, full }) => {
  if (value === undefined || value === null || value === '') return null;
  const displayValue = typeof value === 'boolean' ? (value ? 'Yes / 是' : 'No / 否') : value;
  
  return (
    <div className={`flex flex-col gap-1 mb-4 ${full ? 'col-span-full' : ''}`}>
      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-slate-800 font-medium text-sm leading-relaxed break-words whitespace-pre-wrap">{displayValue}</span>
    </div>
  );
};

const TagSection: React.FC<{ label: string; tags: string[]; color?: string }> = ({ label, tags, color = 'blue' }) => {
    if(!tags || tags.length === 0) return null;
    
    const styles: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100',
        green: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100',
        purple: 'bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100',
        orange: 'bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100',
    };

    return (
        <div className="mb-5 last:mb-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">{label}</span>
            <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                    <span key={i} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-default leading-normal max-w-full truncate ${styles[color] || styles.blue}`}>
                        {tag}
                    </span>
                ))}
            </div>
        </div>
    );
};

// SWOT Item Component
const SwotSection: React.FC<{ title: string; items: string[]; bg: string; text: string }> = ({ title, items, bg, text }) => (
    <div className={`p-5 rounded-xl border ${bg} h-full`}>
        <h4 className={`font-bold text-base mb-3 ${text}`}>{title}</h4>
        <ul className="space-y-2">
            {items.map((item, i) => (
                <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${text.replace('text-', 'bg-')}`}></span>
                    <span className="leading-relaxed">{item}</span>
                </li>
            ))}
        </ul>
    </div>
);

export const ModuleBackground: React.FC<Props> = ({ data, onAddToCRM, onOpenStrategy }) => {
  const { companyInfo, businessScope, businessModel, supplyChain, targetAudience, financials, socials, swot, trafficAnalysis, websiteCategories } = data;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      
      {/* Section 1: Top Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-8">
             <CardHeader 
                title="企业概况 (Company Profile)" 
                icon={Building2} 
                action={
                    <div className="flex items-center gap-2">
                        {onOpenStrategy && (
                            <button onClick={onOpenStrategy} className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-purple-700 flex items-center gap-1 transition-colors shadow-sm">
                                <BrainCircuit size={14} /> Plan Strategy (AI 攻略)
                            </button>
                        )}
                        {onAddToCRM && (
                            <button onClick={onAddToCRM} className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-100 flex items-center gap-1 transition-colors">
                                <Plus size={14} /> Save to CRM
                            </button>
                        )}
                    </div>
                }
             />
             <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                <Field label="Company Name / 全称" value={companyInfo?.name} full />
                <Field label="Headquarters / 总部" value={companyInfo?.headquarters} />
                <Field label="Founded / 成立时间" value={companyInfo?.foundedYear} />
                <Field label="Business Nature / 性质" value={companyInfo?.nature} />
                <Field label="Scale / 规模" value={companyInfo?.scale} />
             </div>
             <div className="px-6 pb-6 pt-2 border-t border-slate-50 mx-6 -mt-2">
                 <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 mt-4">
                    <div className="flex gap-2 mb-2 text-slate-400 text-xs font-bold uppercase tracking-wider">
                        <Info size={14} /> Company Description
                    </div>
                    <p className="text-slate-700 text-sm leading-7 whitespace-pre-wrap">
                        {companyInfo?.description}
                    </p>
                 </div>
             </div>
        </Card>

        <Card className="lg:col-span-4 flex flex-col">
            <CardHeader title="财务与社媒 (Stats)" icon={Activity} />
            <div className="p-6 flex-1 flex flex-col gap-6">
                <div>
                    <Field label="Annual Revenue / 营收" value={financials?.revenueEstimate} full />
                    <Field label="Payment Terms / 付款" value={financials?.paymentTerms} full />
                </div>
                
                <div className="mt-auto pt-6 border-t border-slate-100">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Online Presence</span>
                    <div className="flex flex-col gap-2">
                        {socials?.linkedin && (
                            <a href={socials.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-2.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-medium border border-blue-100">
                                <Share2 size={16}/> LinkedIn Official
                            </a>
                        )}
                        {socials?.facebook && (
                            <a href={socials.facebook} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-2.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors text-sm font-medium border border-indigo-100">
                                <Share2 size={16}/> Facebook Page
                            </a>
                        )}
                        {(!socials || (!socials.linkedin && !socials.facebook)) && (
                            <span className="text-slate-400 text-sm italic px-2">暂无公开社媒链接</span>
                        )}
                    </div>
                    {socials?.similarWebTraffic && (
                        <div className="mt-4 text-xs text-slate-500 bg-slate-50 p-3 rounded border border-slate-100">
                            <span className="font-bold">SimilarWeb Traffic:</span> {socials.similarWebTraffic}
                        </div>
                    )}
                </div>
            </div>
        </Card>
      </div>

      {/* NEW: Website Product Catalog */}
      {websiteCategories && websiteCategories.length > 0 && (
          <Card>
              <CardHeader title="官网产品目录 (Website Product Catalog)" icon={Layers} />
              <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {websiteCategories.map((cat, i) => (
                          <div key={i} className="bg-slate-50 rounded-xl p-4 border border-slate-100 hover:border-blue-200 transition-colors">
                              <div className="flex items-center gap-2 mb-3">
                                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-blue-600 shadow-sm border border-slate-100">
                                      <Box size={16} />
                                  </div>
                                  <h4 className="font-bold text-slate-800 text-sm truncate" title={cat.categoryName}>{cat.categoryName}</h4>
                              </div>
                              <ul className="space-y-1.5 pl-2">
                                  {cat.items && cat.items.slice(0, 5).map((item, j) => (
                                      <li key={j} className="text-xs text-slate-600 flex items-start gap-2">
                                          <span className="w-1 h-1 rounded-full bg-slate-400 mt-1.5 shrink-0"></span>
                                          <span className="line-clamp-1">{item}</span>
                                      </li>
                                  ))}
                                  {(cat.items?.length || 0) > 5 && (
                                      <li className="text-[10px] text-blue-500 font-bold pl-3 pt-1">
                                          + {(cat.items.length - 5)} more items...
                                      </li>
                                  )}
                              </ul>
                          </div>
                      ))}
                  </div>
              </div>
          </Card>
      )}

      {/* Section: SWOT Analysis */}
      {swot && (
          <Card>
              <CardHeader title="SWOT Analysis (企业态势分析)" icon={Target} />
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <SwotSection title="Strengths (优势)" items={swot.strengths} bg="bg-emerald-50 border-emerald-100" text="text-emerald-700" />
                  <SwotSection title="Weaknesses (劣势)" items={swot.weaknesses} bg="bg-red-50 border-red-100" text="text-red-700" />
                  <SwotSection title="Opportunities (机会)" items={swot.opportunities} bg="bg-blue-50 border-blue-100" text="text-blue-700" />
                  <SwotSection title="Threats (威胁)" items={swot.threats} bg="bg-amber-50 border-amber-100" text="text-amber-700" />
              </div>
          </Card>
      )}

      {/* Section: Traffic Intelligence */}
      {trafficAnalysis && trafficAnalysis.length > 0 && (
          <Card>
              <CardHeader title="流量与关键词情报 (Traffic Intelligence)" icon={Globe} />
              <div className="p-6 overflow-x-auto">
                  <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                          <tr>
                              <th className="px-4 py-3">Category</th>
                              <th className="px-4 py-3">Traffic Type</th>
                              <th className="px-4 py-3">Top Keywords</th>
                              <th className="px-4 py-3">Volume Est.</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {trafficAnalysis.map((item, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-bold text-slate-800">{item.category}</td>
                                  <td className="px-4 py-3">
                                      <span className={`px-2 py-1 rounded text-xs font-bold ${item.trafficType?.includes('Paid') ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                          {item.trafficType}
                                      </span>
                                  </td>
                                  <td className="px-4 py-3 text-slate-600">{item.topKeywords}</td>
                                  <td className="px-4 py-3 font-medium text-slate-800">{item.volumeEst}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </Card>
      )}

      {/* Section 2: Business & Operations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="flex flex-col">
            <CardHeader title="业务范围 (Business Scope)" icon={TrendingUp} />
            <div className="p-6 space-y-6 flex-1">
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                     <Field label="Brand Positioning" value={businessScope?.brandPositioning} />
                     <Field label="Consumer Group" value={businessScope?.consumerGroup} />
                     <Field label="Product Variety" value={businessScope?.productVariety} />
                     <Field label="Price Sensitivity" value={businessScope?.priceSensitivity} />
                </div>
                
                <TagSection label="Core Products (主营)" tags={businessScope?.coreProducts || []} color="blue" />
                <TagSection label="Relevant to Us (对口)" tags={businessScope?.relevantProducts || []} color="green" />
            </div>
        </Card>

        <Card className="flex flex-col">
            <CardHeader title="运营模式 (Business Model)" icon={Globe} />
            <div className="p-6 space-y-6 flex-1">
                <div className="flex gap-4 mb-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${businessModel?.hasDistributors ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {businessModel?.hasDistributors ? 'Has Distributors' : 'No Distributors Found'}
                    </span>
                    {(businessModel?.exhibitionHistory?.length || 0) > 0 && (
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">
                            Exhibitor
                        </span>
                    )}
                </div>

                <TagSection label="Sales Channels" tags={businessModel?.channels || []} color="purple" />
                <TagSection label="E-commerce Platforms" tags={businessModel?.ecommercePresence || []} color="orange" />

                <div className="mt-4">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Procurement / Customs Data</span>
                    <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 text-amber-900 text-sm leading-relaxed">
                        {businessModel?.procurementInfo || "未查询到公开海关采购记录"}
                    </div>
                </div>
            </div>
        </Card>
      </div>

      {/* Section 3: Supply Chain */}
      <Card>
         <CardHeader title="供应链深度分析 (Supply Chain)" icon={Truck} />
         <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-1">
                <Field label="Role in Chain / 角色" value={supplyChain?.role} full />
                <div className="h-4"></div>
                <Field label="Service Type / 服务" value={supplyChain?.serviceType} full />
            </div>
            <div className="md:col-span-2 border-t md:border-t-0 md:border-l border-slate-100 pt-6 md:pt-0 md:pl-8">
                 <TagSection label="Target Audience (目标客户)" tags={targetAudience || []} color="green" />
                 <div className="mt-6 pt-6 border-t border-slate-100">
                     <Field label="Intellectual Property / 知识产权" value={financials?.ipInfo} full />
                 </div>
            </div>
         </div>
      </Card>

    </div>
  );
};
