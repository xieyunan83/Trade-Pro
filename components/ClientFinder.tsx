
import React, { useState, useRef, useEffect } from 'react';
import { ClientSearchResult, DiscoveryState } from '../types';
import { searchPotentialClients } from '../services/geminiService';
import { Search, Globe, Loader2, UserPlus, FilterX, Briefcase, Target, MapPin, Tag, Plus, CheckSquare, Square, PlayCircle, Archive, ChevronDown, ChevronRight, X } from 'lucide-react';

interface Props {
  onSelect: (domain: string) => void;
  state: DiscoveryState;
  onStateChange: (newState: DiscoveryState) => void;
  onBatchAddToCRM: (results: ClientSearchResult[]) => void;
  onBatchAnalyze: (results: ClientSearchResult[]) => void;
}

const ensureAbsoluteUrl = (url: string | undefined): string => {
    if (!url || url === 'N/A' || url === '#') return '#';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('www.')) return `https://${trimmed}`;
    return `https://${trimmed}`;
};

const INDUSTRIES = [
    { value: '', label: 'All Industries (所有行业)' },
    { value: 'Toys & Hobbies', label: 'Toys & Hobbies (玩具礼品)' },
    { value: 'Home & Kitchen', label: 'Home & Kitchen (家居厨房)' },
    { value: 'Office & Stationery', label: 'Office & Stationery (办公文具)' },
    { value: 'Consumer Electronics', label: 'Consumer Electronics (消费电子)' },
    { value: 'Fashion & Apparel', label: 'Fashion & Apparel (服装服饰)' },
    { value: 'Pet Supplies', label: 'Pet Supplies (宠物用品)' },
    { value: 'Outdoor & Sports', label: 'Outdoor & Sports (户外运动)' },
    { value: 'Beauty & Personal Care', label: 'Beauty & Personal Care (美妆个护)' }
];

const CLIENT_TYPES = [
    { value: 'Brand/Importer', label: 'Brand/Importer (品牌商/进口商)' },
    { value: 'Wholesaler/Distributor', label: 'Wholesaler/Distributor (批发/分销商)' },
    { value: 'Retailer/Supermarket', label: 'Retailer/Supermarket (零售/商超)' },
    { value: 'Promo/Premium Agency', label: 'Promo/Premium (促销/礼品公司)' }
];

export const WORLD_REGIONS: Record<string, string[]> = {
    "North America": ["USA", "Canada", "Mexico"],
    "Europe": ["Germany", "UK", "France", "Italy", "Spain", "Netherlands", "Poland", "Belgium", "Sweden", "Switzerland", "Austria", "Norway", "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Czech Republic", "Hungary", "Romania", "Turkey", "Russia", "Ukraine"],
    "Asia": ["China", "Japan", "South Korea", "India", "Singapore", "Vietnam", "Thailand", "Malaysia", "Indonesia", "Philippines", "Pakistan", "Bangladesh", "Sri Lanka", "Taiwan", "Hong Kong", "Kazakhstan"],
    "Middle East": ["UAE", "Saudi Arabia", "Israel", "Qatar", "Kuwait", "Bahrain", "Oman", "Jordan", "Lebanon"],
    "South America": ["Brazil", "Argentina", "Chile", "Colombia", "Peru", "Venezuela", "Ecuador", "Uruguay"],
    "Oceania": ["Australia", "New Zealand", "Fiji"],
    "Africa": ["South Africa", "Nigeria", "Kenya", "Egypt", "Morocco", "Algeria", "Ghana", "Ethiopia"]
};

export const ClientFinder: React.FC<Props> = ({ onSelect, state, onStateChange, onBatchAddToCRM, onBatchAnalyze }) => {
  const [loading, setLoading] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  
  // Country Selector State
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [hoveredContinent, setHoveredContinent] = useState<string>('North America');
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(
    new Set((state.country ? state.country.split(', ') : []).filter(Boolean) as string[])
  );
  const countryDropdownRef = useRef<HTMLDivElement>(null);

  // Client Type Selector State (Multi-Select)
  const [isClientTypeDropdownOpen, setIsClientTypeDropdownOpen] = useState(false);
  const [selectedClientTypes, setSelectedClientTypes] = useState<Set<string>>(
      new Set((state.clientType ? state.clientType.split(', ') : []).filter(Boolean) as string[])
  );
  const clientTypeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      // Close dropdowns when clicking outside
      const handleClickOutside = (event: MouseEvent) => {
          if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
              setIsCountryDropdownOpen(false);
          }
          if (clientTypeDropdownRef.current && !clientTypeDropdownRef.current.contains(event.target as Node)) {
              setIsClientTypeDropdownOpen(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateState = (key: keyof DiscoveryState, value: any) => {
    onStateChange({ ...state, [key]: value });
  };

  const handleSearch = async () => {
    if (!state.product) return;
    setLoading(true);
    updateState('hasSearched', true);
    updateState('results', []);
    setSelectedUrls(new Set()); // Clear selection on new search
    
    // Convert selections to string for API
    const countryString = selectedCountries.size > 0 
        ? Array.from(selectedCountries).join(', ') 
        : 'Global';
    
    const typeString = selectedClientTypes.size > 0 
        ? Array.from(selectedClientTypes).join(', ') 
        : 'All B2B Types';

    try {
      // Limit set to 200
      const data = await searchPotentialClients(
          state.product, 
          countryString, 
          state.industry, 
          typeString,
          200 
      );
      if (data && data.length > 0) {
        updateState('results', data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // --- CLIENT TYPE SELECTION LOGIC ---
  const toggleClientType = (typeValue: string) => {
      const newSet = new Set(selectedClientTypes);
      if (newSet.has(typeValue)) newSet.delete(typeValue);
      else newSet.add(typeValue);
      
      setSelectedClientTypes(newSet);
      updateState('clientType', Array.from(newSet).join(', '));
  };

  const removeClientTypeTag = (typeValue: string) => {
      const newSet = new Set(selectedClientTypes);
      newSet.delete(typeValue);
      setSelectedClientTypes(newSet);
      updateState('clientType', Array.from(newSet).join(', '));
  };

  // --- COUNTRY SELECTION LOGIC ---
  const toggleCountry = (country: string) => {
      const newSet = new Set(selectedCountries);
      if (newSet.has(country)) newSet.delete(country);
      else newSet.add(country);
      
      setSelectedCountries(newSet);
      updateState('country', Array.from(newSet).join(', '));
  };

  const toggleContinent = (continent: string) => {
      const countries = WORLD_REGIONS[continent] || [];
      const allSelected = countries.length > 0 && countries.every(c => selectedCountries.has(c));
      const newSet = new Set(selectedCountries);
      
      if (allSelected) {
          countries.forEach(c => newSet.delete(c));
      } else {
          countries.forEach(c => newSet.add(c));
      }
      setSelectedCountries(newSet);
      updateState('country', Array.from(newSet).join(', '));
  };

  const removeCountryTag = (country: string) => {
      const newSet = new Set(selectedCountries);
      newSet.delete(country);
      setSelectedCountries(newSet);
      updateState('country', Array.from(newSet).join(', '));
  };

  // --- SELECTION LOGIC ---
  const toggleSelection = (url: string) => {
      const newSet = new Set(selectedUrls);
      if (newSet.has(url)) newSet.delete(url);
      else newSet.add(url);
      setSelectedUrls(newSet);
  };

  const toggleSelectAll = () => {
      if (selectedUrls.size === state.results.length) {
          setSelectedUrls(new Set());
      } else {
          setSelectedUrls(new Set(state.results.map(r => r.website)));
      }
  };

  // --- BATCH HANDLERS ---
  const handleBatchCRM = () => {
      const selected = state.results.filter(r => selectedUrls.has(r.website));
      if (selected.length === 0) return;
      onBatchAddToCRM(selected);
      setSelectedUrls(new Set()); 
  };

  const handleBatchAnalyze = () => {
      const selected = state.results.filter(r => selectedUrls.has(r.website));
      if (selected.length === 0) return;
      onBatchAnalyze(selected);
      setSelectedUrls(new Set()); 
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-4 mb-8">
            <div className="bg-blue-600 p-3 rounded-2xl text-white shadow-lg shadow-blue-100">
                <UserPlus size={28} />
            </div>
            <div>
                <h2 className="text-2xl font-black text-slate-800 tracking-tight">Client Discovery / 客户发现</h2>
                <p className="text-slate-500 font-medium">AI 精准挖掘全球独立站买家，深度搜索 (Limit: 200)</p>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
            {/* 1. KEYWORDS */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                    <Target size={14} className="text-blue-500" /> Product Keywords (产品关键词)
                </label>
                <input 
                    type="text" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 font-bold placeholder:text-slate-300 transition-all" 
                    placeholder="e.g. Plush Toys / RC Car" 
                    value={state.product} 
                    onChange={(e) => updateState('product', e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()} 
                />
            </div>
            
            {/* 2. COUNTRY (MULTI-SELECT) */}
            <div className="space-y-2 relative" ref={countryDropdownRef}>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                    <MapPin size={14} className="text-blue-500" /> Target Country (目标国家)
                </label>
                <div 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 cursor-pointer flex items-center justify-between hover:border-blue-300 transition-colors"
                    onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                >
                    <div className="flex flex-wrap gap-2 overflow-hidden h-6">
                        {selectedCountries.size > 0 ? (
                            (Array.from(selectedCountries) as string[]).map(c => (
                                <span key={c} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap">{c}</span>
                            ))
                        ) : (
                            <span className="text-slate-400 font-medium">Select Target Markets...</span>
                        )}
                    </div>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${isCountryDropdownOpen ? 'rotate-180' : ''}`} />
                </div>

                {isCountryDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 flex overflow-hidden animate-fade-in h-[400px]">
                        <div className="w-1/3 bg-slate-50 border-r border-slate-100 overflow-y-auto custom-scrollbar">
                            {Object.keys(WORLD_REGIONS).map((continent: string) => {
                                const countries = WORLD_REGIONS[continent] || [];
                                return (
                                <div 
                                    key={continent}
                                    className={`p-4 cursor-pointer flex items-center justify-between transition-colors ${hoveredContinent === continent ? 'bg-white border-l-4 border-blue-500 text-blue-700' : 'text-slate-600 hover:bg-slate-100 border-l-4 border-transparent'}`}
                                    onMouseEnter={() => setHoveredContinent(continent)}
                                >
                                    <span className="font-bold text-sm">{continent}</span>
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        checked={countries.length > 0 && countries.every((c: string) => selectedCountries.has(c))}
                                        onChange={(e) => { e.stopPropagation(); toggleContinent(continent); }}
                                    />
                                </div>
                            )})}
                        </div>
                        <div className="w-2/3 p-4 overflow-y-auto custom-scrollbar bg-white">
                            <h4 className="font-black text-slate-800 mb-3 text-sm flex items-center gap-2">
                                <Globe size={14} className="text-blue-500"/> {hoveredContinent} Countries
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                                {(WORLD_REGIONS[hoveredContinent] || []).map((country: string) => (
                                    <label key={country} className="flex items-center gap-2 p-2 rounded-lg hover:bg-blue-50 cursor-pointer transition-colors group">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            checked={selectedCountries.has(country)}
                                            onChange={() => toggleCountry(country)}
                                        />
                                        <span className={`text-sm font-medium group-hover:text-blue-700 ${selectedCountries.has(country) ? 'text-blue-700 font-bold' : 'text-slate-600'}`}>{country}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 3. INDUSTRY */}
            <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                    <Briefcase size={14} className="text-blue-500" /> Industry (所属行业)
                </label>
                <div className="relative">
                    <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 font-bold appearance-none cursor-pointer transition-all"
                        value={state.industry}
                        onChange={(e) => updateState('industry', e.target.value as string)}
                    >
                        {INDUSTRIES.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 4. CLIENT TYPE (MULTI-SELECT) */}
            <div className="space-y-2 relative" ref={clientTypeDropdownRef}>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">
                    <Tag size={14} className="text-blue-500" /> Client Type (买家类型 - 多选)
                </label>
                <div 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 cursor-pointer flex items-center justify-between hover:border-blue-300 transition-colors"
                    onClick={() => setIsClientTypeDropdownOpen(!isClientTypeDropdownOpen)}
                >
                    <div className="flex flex-wrap gap-2 overflow-hidden h-6">
                        {selectedClientTypes.size > 0 ? (
                            (Array.from(selectedClientTypes) as string[]).map(t => (
                                <span key={t} className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap">{t}</span>
                            ))
                        ) : (
                            <span className="text-slate-400 font-medium">Select Client Types (Multi)...</span>
                        )}
                    </div>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${isClientTypeDropdownOpen ? 'rotate-180' : ''}`} />
                </div>

                {isClientTypeDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 p-4 animate-fade-in">
                        <div className="space-y-2">
                            {CLIENT_TYPES.map(type => (
                                <label key={type.value} className="flex items-center gap-3 p-3 rounded-lg hover:bg-purple-50 cursor-pointer transition-colors group">
                                    <input 
                                        type="checkbox" 
                                        className="w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                        checked={selectedClientTypes.has(type.value)}
                                        onChange={() => toggleClientType(type.value)}
                                    />
                                    <div>
                                        <div className={`text-sm font-bold group-hover:text-purple-700 ${selectedClientTypes.has(type.value) ? 'text-purple-700' : 'text-slate-800'}`}>
                                            {type.value}
                                        </div>
                                        <div className="text-xs text-slate-400">{type.label}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
        
        {/* Selected Tags Display */}
        {(selectedCountries.size > 0 || selectedClientTypes.size > 0) && (
            <div className="flex flex-wrap gap-2 mt-4 px-1">
                {(Array.from(selectedCountries) as string[]).map((c) => (
                    <span key={c} className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-slate-200">
                        {c}
                        <button onClick={() => removeCountryTag(c)} className="hover:text-red-500 rounded-full p-0.5"><X size={10} /></button>
                    </span>
                ))}
                {(Array.from(selectedClientTypes) as string[]).map((t) => (
                    <span key={t} className="bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-purple-100">
                        {t}
                        <button onClick={() => removeClientTypeTag(t)} className="hover:text-red-500 rounded-full p-0.5"><X size={10} /></button>
                    </span>
                ))}
                <button onClick={() => { setSelectedCountries(new Set()); setSelectedClientTypes(new Set()); updateState('country', ''); updateState('clientType', ''); }} className="text-xs text-red-500 font-bold hover:underline px-2">Clear All</button>
            </div>
        )}

        <button 
            onClick={handleSearch} 
            disabled={loading || !state.product} 
            className="w-full mt-8 h-[64px] bg-slate-900 hover:bg-blue-600 text-white text-lg font-black rounded-2xl shadow-xl transition-all flex items-center justify-center gap-3 disabled:opacity-30 group"
        >
            {loading ? <Loader2 className="animate-spin" size={24} /> : <Search className="group-hover:scale-125 transition-transform" size={24} />}
            {loading ? 'AI Intelligence Discovering (Max 200)...' : 'Start Discovery / 开始发现客户'}
        </button>
      </div>

      {state.hasSearched && !loading && state.results.length === 0 && (
          <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-slate-300">
              <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FilterX className="text-slate-300" size={40} />
              </div>
              <h3 className="text-slate-700 font-black text-xl">未发现符合条件的买家</h3>
              <p className="text-slate-400 mt-2 font-medium">请尝试简化产品关键词，或更换目标市场/客户类型。</p>
          </div>
      )}

      {/* TABLE VIEW */}
      {state.results.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Target size={18} className="text-blue-600"/> Found {state.results.length} Potential Clients
                  </h3>
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                          <tr>
                              <th className="px-6 py-4 w-12">
                                  <button onClick={toggleSelectAll} className="text-slate-400 hover:text-blue-600">
                                      {selectedUrls.size === state.results.length && state.results.length > 0 
                                          ? <CheckSquare size={20} className="text-blue-600" /> 
                                          : <Square size={20} />
                                      }
                                  </button>
                              </th>
                              <th className="px-6 py-4">Client Name</th>
                              <th className="px-6 py-4">Website</th>
                              <th className="px-6 py-4">Country</th>
                              <th className="px-6 py-4 w-[40%]">Description</th>
                              <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {state.results.map((client, idx) => (
                              <tr key={idx} className={`hover:bg-blue-50/30 transition-colors ${selectedUrls.has(client.website) ? 'bg-blue-50/50' : ''}`}>
                                  <td className="px-6 py-4">
                                      <button onClick={() => toggleSelection(client.website)} className="text-slate-400 hover:text-blue-600">
                                          {selectedUrls.has(client.website) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>}
                                      </button>
                                  </td>
                                  <td className="px-6 py-4 font-black text-slate-800 text-base">{client.name}</td>
                                  <td className="px-6 py-4">
                                      <a 
                                        href={ensureAbsoluteUrl(client.website)} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="text-blue-600 hover:underline flex items-center gap-1 font-bold"
                                      >
                                          <Globe size={14} /> {client.website.replace(/^https?:\/\//, '')}
                                      </a>
                                  </td>
                                  <td className="px-6 py-4">
                                      <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold border border-slate-200">
                                          {client.country}
                                      </span>
                                  </td>
                                  <td className="px-6 py-4">
                                      <p className="text-slate-500 text-xs leading-relaxed line-clamp-2" title={client.description}>
                                          {client.description}
                                      </p>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                      <div className="flex justify-end gap-2">
                                          <button 
                                            onClick={() => onSelect(client.website)} 
                                            className="text-slate-900 hover:text-blue-600 font-bold text-xs border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-all shadow-sm flex items-center gap-1"
                                          >
                                              <Search size={14} /> Detailed
                                          </button>
                                          <button 
                                            onClick={() => onBatchAddToCRM([client])}
                                            className="text-slate-500 hover:text-green-600 border border-slate-200 hover:border-green-300 px-2 py-1.5 rounded-lg transition-all shadow-sm"
                                            title="Add to CRM"
                                          >
                                              <Archive size={16} />
                                          </button>
                                      </div>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* BATCH ACTION BAR (Sticky Bottom) */}
      {selectedUrls.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-6 animate-fade-in border border-slate-700">
              <div className="font-bold text-sm pl-2">
                  <span className="text-blue-400 text-lg mr-1">{selectedUrls.size}</span> Selected
              </div>
              <div className="h-8 w-px bg-slate-700"></div>
              <div className="flex gap-3">
                  <button 
                      onClick={handleBatchAnalyze}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors shadow-lg"
                  >
                      <PlayCircle size={16} /> Batch Analysis (Queue)
                  </button>
                  <button 
                      onClick={handleBatchCRM}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors"
                  >
                      <Archive size={16} /> Add to CRM
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};
