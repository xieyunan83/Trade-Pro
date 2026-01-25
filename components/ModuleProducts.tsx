
import React from 'react';
import { AnalysisResult } from '../types';
import { ShoppingBag, TrendingUp, ImageOff, Search, ExternalLink, Lightbulb, MessageCircle } from 'lucide-react';

interface Props {
  data: AnalysisResult;
}

export const ModuleProducts: React.FC<Props> = ({ data }) => {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Market Trends Overview */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4">
        <div className="bg-white p-2 rounded-xl shadow-sm text-blue-600">
            <TrendingUp size={24} />
        </div>
        <div>
            <h3 className="font-bold text-slate-800 text-lg mb-2">市场趋势与推荐 (Market Trends)</h3>
            <p className="text-slate-700 text-sm leading-relaxed">{data.marketTrends}</p>
        </div>
      </div>

      {/* Product List */}
      <div className="space-y-6">
          <h3 className="font-black text-2xl text-slate-800 flex items-center gap-2">
              <ShoppingBag className="text-purple-600" />
              产品深度分析 (Product Deep Dive)
          </h3>
          
          <div className="grid grid-cols-1 gap-6">
              {data.products.map((product, idx) => (
                  <div key={idx} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                      <div className="grid grid-cols-1 md:grid-cols-12">
                          {/* Image Section - 3 Cols */}
                          <div className="md:col-span-3 bg-slate-50 border-r border-slate-100 p-6 flex flex-col items-center justify-center relative min-h-[200px]">
                                {product.imageUrl ? (
                                    <img src={product.imageUrl} alt={product.name} className="w-full h-auto object-contain max-h-[180px] rounded-lg shadow-sm bg-white" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-slate-300">
                                        <ImageOff size={32} className="mb-2" />
                                        <span className="text-xs">No Image</span>
                                    </div>
                                )}
                                <div className="mt-4 w-full">
                                    {product.competitorLink ? (
                                        <a href={product.competitorLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full text-xs font-bold text-blue-600 bg-blue-50 py-2 rounded-lg hover:bg-blue-100 transition-colors">
                                            <ExternalLink size={12} /> Product Page
                                        </a>
                                    ) : (
                                        <a href={`https://www.google.com/search?q=${encodeURIComponent(product.name)}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full text-xs font-bold text-slate-500 bg-slate-100 py-2 rounded-lg hover:bg-slate-200 transition-colors">
                                            <Search size={12} /> Search
                                        </a>
                                    )}
                                </div>
                          </div>

                          {/* Details Section - 9 Cols */}
                          <div className="md:col-span-9 p-6">
                              <div className="flex justify-between items-start mb-4">
                                  <h4 className="text-xl font-bold text-slate-900">{product.name}</h4>
                                  <span className="bg-yellow-50 text-yellow-800 text-xs font-bold px-3 py-1 rounded-full border border-yellow-200">
                                      Margin: {product.marginSpace || 'High'}
                                  </span>
                              </div>

                              <div className="grid grid-cols-3 gap-6 mb-6">
                                  <div>
                                      <span className="text-xs font-bold text-slate-400 uppercase block mb-1">Retail Price</span>
                                      <span className="text-lg font-mono font-bold text-slate-800">{product.retailPrice}</span>
                                  </div>
                                  <div>
                                      <span className="text-xs font-bold text-slate-400 uppercase block mb-1">Est. FOB (CNY)</span>
                                      <span className="text-lg font-mono font-bold text-green-600">¥{product.estimatedFOBPriceCNY || '-'}</span>
                                  </div>
                                  <div>
                                      <span className="text-xs font-bold text-slate-400 uppercase block mb-1">Target Retail (CNY)</span>
                                      <span className="text-lg font-mono font-bold text-slate-500">¥{product.retailPriceCNY || '-'}</span>
                                  </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                  <div>
                                      <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase mb-2">
                                          <Lightbulb size={14} /> Pricing Strategy
                                      </div>
                                      <p className="text-sm text-slate-700 leading-relaxed">
                                          {product.pricingStrategy || "No specific strategy generated."}
                                      </p>
                                  </div>
                                  <div>
                                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase mb-2">
                                          <MessageCircle size={14} /> Pitch Point
                                      </div>
                                      <p className="text-sm text-slate-700 leading-relaxed">
                                          {product.pitchPoint || "No pitch point generated."}
                                      </p>
                                  </div>
                              </div>

                              {product.techSpecs && (
                                  <div className="mt-4 pt-4 border-t border-slate-100">
                                      <span className="text-xs font-bold text-slate-400 uppercase">Tech Specs: </span>
                                      <span className="text-xs text-slate-600">{product.techSpecs}</span>
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
              ))}
          </div>
      </div>
    </div>
  );
};
