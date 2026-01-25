
import React, { useState, useRef, useEffect } from 'react';
import { extractKeywordsFromMedia } from '../services/geminiService';
import { exportKeywordsToExcel, exportAutomationReportToPPT, exportBatchAutomationReportsToPPT } from '../services/exportService';
import { KeywordExtractionResult, KnowledgeFile, AutomationResult } from '../types';
import { 
    ImagePlus, Download, FileText, Settings2, Box, Layers, 
    UploadCloud, Loader2, FileSpreadsheet, Sparkles, Zap, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Globe, X, File, Image as ImageIcon, Tag, PlayCircle, Trash2, Type, Package
} from 'lucide-react';

type Tab = 'keywords' | 'composer';

interface Props {
    onStartAutomation?: (keyword: string, context: string, countries: string[], productImages: string[], clientType: string) => void;
    automationResults?: AutomationResult[];
    isAutomating?: boolean;
    onRunPending?: () => void;
    onRunSingle?: (id: string) => void;
    onDelete?: (id: string) => void;
}

interface Dimensions {
  l: string;
  w: string;
  h: string;
}

interface FontSettings {
  title: number;
  sub: number;
  footer: number;
}

// Updated Comprehensive Regions List
const REGIONS = {
    "North America": ["USA", "Canada", "Mexico"],
    "Europe": ["Germany", "UK", "France", "Italy", "Spain", "Netherlands", "Poland", "Belgium", "Sweden", "Switzerland", "Austria", "Norway", "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Czech Republic", "Hungary", "Romania", "Turkey", "Russia", "Ukraine"],
    "Asia": ["China", "Japan", "South Korea", "India", "Singapore", "Vietnam", "Thailand", "Malaysia", "Indonesia", "Philippines", "Pakistan", "Bangladesh", "Sri Lanka", "Taiwan", "Hong Kong", "Kazakhstan"],
    "Middle East": ["UAE", "Saudi Arabia", "Israel", "Qatar", "Kuwait", "Bahrain", "Oman", "Jordan", "Lebanon"],
    "South America": ["Brazil", "Argentina", "Chile", "Colombia", "Peru", "Venezuela", "Ecuador", "Uruguay"],
    "Oceania": ["Australia", "New Zealand", "Fiji"],
    "Africa": ["South Africa", "Nigeria", "Kenya", "Egypt", "Morocco", "Algeria", "Ghana", "Ethiopia"]
};

const CLIENT_TYPES = [
    { value: '', label: 'All Types (所有类型)' },
    { value: 'Brand/Importer', label: 'Brand/Importer (品牌商/进口商)' },
    { value: 'Wholesaler/Distributor', label: 'Wholesaler/Distributor (批发/分销商)' },
    { value: 'Retailer/Supermarket', label: 'Retailer/Supermarket (零售/商超)' },
    { value: 'Promo/Premium Agency', label: 'Promo/Premium (促销/礼品公司)' }
];

export const ModulePromoGenerator: React.FC<Props> = ({ 
    onStartAutomation, 
    automationResults = [], 
    isAutomating = false,
    onRunPending,
    onRunSingle,
    onDelete
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('keywords');

  // --- KEYWORD & AUTOMATION STATE ---
  const [keywordFile, setKeywordFile] = useState<KnowledgeFile | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [keywordResult, setKeywordResult] = useState<KeywordExtractionResult | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [expandedContinents, setExpandedContinents] = useState<string[]>(['North America', 'Europe']);
  const [selectedClientType, setSelectedClientType] = useState<string>('');

  // --- COMPOSER STATE ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Text State
  const [productName, setProductName] = useState('Product Name: X\'mas PVC Figurine with Key Ring 2CT');
  const [functionText, setFunctionText] = useState('Function: Wear');
  const [materialsText, setMaterialsText] = useState('Materials: PVC');
  const [contactInfo, setContactInfo] = useState('Contact: www.yourcompany.com | sales@yourcompany.com');
  
  // Font State
  const [fonts, setFonts] = useState<FontSettings>({ title: 60, sub: 50, footer: 40 });
  
  // Image & Dims State
  const [packageImg, setPackageImg] = useState<string | null>(null);
  const [packageDims, setPackageDims] = useState<Dimensions>({ l: '10', w: '5', h: '15' });
  
  const [productImgs, setProductImgs] = useState<string[]>([]);
  const [productDims, setProductDims] = useState<Dimensions>({ l: '8', w: '4', h: '10' });

  // --- AUTOMATION HANDLERS ---

  const handleKeywordFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          if (file.size > 3 * 1024 * 1024) {
              alert("File too large. Please upload an image smaller than 3MB.");
              return;
          }
          if (file.type.startsWith('image/')) {
              const url = URL.createObjectURL(file);
              setFilePreview(url);
          } else {
              setFilePreview(null);
          }
          const reader = new FileReader();
          reader.onload = async (ev) => {
              const base64Raw = (ev.target?.result as string).split(',')[1];
              setKeywordFile({
                  id: Date.now().toString(),
                  name: file.name,
                  type: file.type,
                  data: base64Raw,
                  size: file.size
              });
              setKeywordResult(null);
              setSelectedKeyword(null);
          };
          reader.readAsDataURL(file);
      }
  };

  const removeFile = () => {
      setKeywordFile(null);
      setFilePreview(null);
      setKeywordResult(null);
      if (filePreview) URL.revokeObjectURL(filePreview);
  };

  const startExtraction = async () => {
      if (!keywordFile) return;
      setIsExtracting(true);
      try {
          const result = await extractKeywordsFromMedia(keywordFile);
          setKeywordResult(result);
      } catch (e: any) {
          console.error(e);
          let msg = "Extraction failed. Please try again.";
          if (e.message.includes('400') || e.message.includes('large')) {
              msg = "Image too large for API. Please use a compressed JPG under 3MB.";
          } else if (e.message.includes('quota')) {
              msg = "API Quota Exceeded. Please wait 60 seconds.";
          }
          alert(msg);
      } finally {
          setIsExtracting(false);
      }
  };

  const toggleCountry = (country: string) => {
      setSelectedCountries(prev => prev.includes(country) ? prev.filter(c => c !== country) : [...prev, country]);
  };

  const toggleContinent = (continent: string) => {
      setExpandedContinents(prev => prev.includes(continent) ? prev.filter(c => c !== continent) : [...prev, continent]);
  };

  const toggleAllInContinent = (continent: string) => {
      // @ts-ignore
      const countries: string[] = REGIONS[continent];
      const allSelected = countries.every(c => selectedCountries.includes(c));
      if (allSelected) setSelectedCountries(prev => prev.filter(c => !countries.includes(c)));
      else setSelectedCountries(prev => [...new Set([...prev, ...countries])]);
  };

  const handleStartAutomation = () => {
      if (!selectedKeyword || !onStartAutomation) return;
      if (selectedCountries.length === 0) { alert("Please select at least one country."); return; }
      const context = `Product uploaded: ${keywordFile?.name || 'Unknown'}. Please analyze for highlights.`;
      const productImages = keywordFile ? [keywordFile.data] : [];
      onStartAutomation(selectedKeyword, context, selectedCountries, productImages, selectedClientType);
  };

  // --- COMPOSER HELPERS & LOGIC ---

  const toInch = (cmStr: string) => {
    const cm = parseFloat(cmStr);
    if (isNaN(cm) || cm === 0) return "0";
    return (cm / 2.54).toFixed(2);
  };

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const draw3DDimensions = (ctx: CanvasRenderingContext2D, startX: number, startY: number, dims: Dimensions) => {
      const hVal = parseFloat(dims.h) || 0;
      const wVal = parseFloat(dims.w) || 0;
      const lVal = parseFloat(dims.l) || 0;

      if (hVal === 0 && wVal === 0 && lVal === 0) return;

      ctx.lineWidth = 6;
      ctx.strokeStyle = '#dc2626';
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'bold 32px Arial';
      
      const originX = startX;
      const originY = startY;
      const axisLength = 140;

      // 1. Height
      if (hVal > 0) {
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.lineTo(originX, originY - axisLength);
          ctx.stroke();
          
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(`H: ${dims.h}cm`, originX - 15, originY - axisLength / 2 - 20);
          ctx.fillText(`${toInch(dims.h)}"`, originX - 15, originY - axisLength / 2 + 20);
      }

      // 2. Length
      if (lVal > 0) {
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.lineTo(originX + axisLength, originY);
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`L: ${dims.l}cm / ${toInch(dims.l)}"`, originX + axisLength / 2, originY + 20);
      }

      // 3. Width (Diagonal)
      if (wVal > 0) {
          const diagLen = 100;
          const dx = diagLen * 0.707;
          const dy = diagLen * 0.707;
          
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.lineTo(originX + dx, originY - dy);
          ctx.stroke();

          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`W: ${dims.w}cm`, originX + dx + 10, originY - dy);
          ctx.fillText(`${toInch(dims.w)}"`, originX + dx + 10, originY - dy + 35);
      }
  };

  const drawCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.textBaseline = 'alphabetic'; 
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 1500, 1500);

    // Header Text
    ctx.fillStyle = '#1e3a8a';
    ctx.textAlign = 'left';
    ctx.font = `bold ${fonts.title}px Arial`;
    ctx.fillText(productName, 80, 100); 
    
    ctx.fillStyle = '#2563eb';
    ctx.font = `bold ${fonts.sub}px Arial`;
    ctx.fillText(functionText, 80, 100 + fonts.title + 20);
    ctx.fillText(materialsText, 80, 100 + fonts.title + fonts.sub + 40);

    const headerHeight = 350;
    const leftX = 80; 
    const rightX = 780;
    const topY = headerHeight;
    const sectionWidth = 640; 
    const imgAreaHeight = 800;

    // Left Section: Package
    if (packageImg) {
        try {
            const img = await loadImage(packageImg);
            const scale = Math.min(sectionWidth / img.width, imgAreaHeight / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = leftX + (sectionWidth - w) / 2;
            const y = topY + (imgAreaHeight - h) / 2;
            ctx.drawImage(img, x, y, w, h);
        } catch (e) {}
    }

    const pkgAnchorX = leftX + 180; 
    const pkgAnchorY = 1320; 
    draw3DDimensions(ctx, pkgAnchorX, pkgAnchorY, packageDims);

    // Right Section: Product Images
    const count = productImgs.length;
    if (count > 0) {
        let cols = 1; let rows = 1;
        if (count === 2) { cols = 1; rows = 2; }
        else if (count >= 3) { cols = 2; rows = Math.ceil(count/2); }

        const cellW = (sectionWidth - (cols - 1) * 20) / cols;
        const cellH = (imgAreaHeight - (rows - 1) * 20) / rows;

        for (let i = 0; i < Math.min(count, 6); i++) {
            try {
                const img = await loadImage(productImgs[i]);
                const col = i % cols;
                const row = Math.floor(i / cols);
                let cx = rightX + col * (cellW + 20);
                if (count === 3 && i === 2) cx = rightX + (sectionWidth - cellW) / 2; 

                const cy = topY + row * (cellH + 20);
                const scale = Math.min(cellW / img.width, cellH / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                const x = cx + (cellW - w) / 2;
                const y = cy + (cellH - h) / 2;
                ctx.drawImage(img, x, y, w, h);
            } catch (e) {}
        }
    }

    const prodAnchorX = rightX + 180;
    const prodAnchorY = 1320;
    draw3DDimensions(ctx, prodAnchorX, prodAnchorY, productDims);

    // Labels
    ctx.textBaseline = 'alphabetic'; 
    ctx.font = 'bold 30px Arial';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText("Packaging", leftX, topY - 20);
    ctx.fillText("Product", rightX, topY - 20);

    // Footer
    if (contactInfo) {
        ctx.font = `bold ${fonts.footer}px Arial`;
        ctx.fillStyle = '#1e3a8a';
        ctx.textAlign = 'center';
        ctx.fillText(contactInfo, 750, 1460);
    }
  };

  useEffect(() => {
    if (activeTab === 'composer') {
        const timer = setTimeout(() => drawCanvas(), 500);
        return () => clearTimeout(timer);
    }
  }, [activeTab, productName, functionText, materialsText, contactInfo, packageImg, productImgs, packageDims, productDims, fonts]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'package' | 'product') => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
            const result = ev.target?.result as string;
            if (type === 'package') setPackageImg(result);
            else {
                if (productImgs.length < 6) setProductImgs([...productImgs, result]);
                else alert("Max 6 product images allowed");
            }
        };
        reader.readAsDataURL(file);
    }
  };

  const downloadImage = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `Promo_${Date.now()}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.9);
      link.click();
  };

  // Counts
  const pendingCount = automationResults.filter(r => r.status === 'pending' || r.status === 'failed').length;

  return (
    <div className="max-w-7xl mx-auto animate-fade-in pb-12">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2 flex mb-8">
            <button onClick={() => setActiveTab('keywords')} className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'keywords' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                <FileSpreadsheet size={20} /> 智能关键词提取 (Keyword Extractor)
            </button>
            <button onClick={() => setActiveTab('composer')} className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'composer' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                <Layers size={20} /> 产品规格图合成 (Spec Sheet Composer)
            </button>
        </div>

        {activeTab === 'keywords' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Panel: Upload, Region Select, Automation Trigger */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-black">1</div>
                            <h3 className="font-bold text-slate-800 text-lg">Upload Product (PDF/Img)</h3>
                        </div>
                        
                        {!keywordFile ? (
                            <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-blue-400 group relative cursor-pointer bg-slate-50 hover:bg-blue-50 transition-colors">
                                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleKeywordFileUpload} accept="image/*,application/pdf" />
                                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-2 text-slate-400 group-hover:text-blue-500 shadow-sm"><UploadCloud size={24} /></div>
                                <p className="font-bold text-slate-700 text-sm">Click to Upload</p>
                                <p className="text-xs text-slate-400 mt-1">Supports JPG, PNG, PDF (Max 3MB)</p>
                            </div>
                        ) : (
                            <div className="border border-blue-100 bg-blue-50/50 rounded-2xl p-4 relative">
                                <button onClick={removeFile} className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm text-slate-400 hover:text-red-500"><X size={14}/></button>
                                <div className="flex items-center gap-4">
                                    {filePreview ? (
                                        <div className="w-16 h-16 bg-white rounded-lg border border-slate-200 overflow-hidden flex-shrink-0">
                                            <img src={filePreview} alt="Preview" className="w-full h-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="w-16 h-16 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-red-500 flex-shrink-0">
                                            <FileText size={32} />
                                        </div>
                                    )}
                                    <div className="overflow-hidden">
                                        <p className="font-bold text-sm text-slate-800 truncate">{keywordFile.name}</p>
                                        <p className="text-xs text-slate-500">{(keywordFile.size / 1024).toFixed(1)} KB</p>
                                        <div className="flex items-center gap-1 mt-1 text-green-600 text-[10px] font-bold">
                                            <CheckCircle2 size={12} /> Ready to Analyze
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button onClick={startExtraction} disabled={!keywordFile || isExtracting} className="w-full mt-4 bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50">
                            {isExtracting ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                            Analyze Product
                        </button>

                        {/* Region & Client Type Selector */}
                        {keywordResult && (
                            <div className="mt-8 pt-6 border-t border-slate-100">
                                <div className="mb-4">
                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                        <Tag size={14} className="text-purple-600" /> Client Type Target
                                    </label>
                                    <select 
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none text-slate-800 font-bold text-sm"
                                        value={selectedClientType}
                                        onChange={(e) => setSelectedClientType(e.target.value)}
                                    >
                                        {CLIENT_TYPES.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-center gap-2 mb-4">
                                    <Globe size={18} className="text-purple-600" />
                                    <h3 className="font-bold text-slate-800">Target Markets</h3>
                                </div>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                    {Object.entries(REGIONS).map(([continent, countries]) => (
                                        <div key={continent} className="border border-slate-100 rounded-xl overflow-hidden">
                                            <div className="flex items-center justify-between p-3 bg-slate-50 cursor-pointer hover:bg-slate-100" onClick={() => toggleContinent(continent)}>
                                                <div className="flex items-center gap-2">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={(countries as string[]).every(c => selectedCountries.includes(c))}
                                                        onChange={(e) => { e.stopPropagation(); toggleAllInContinent(continent); }}
                                                        className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                    />
                                                    <span className="font-bold text-sm text-slate-700">{continent}</span>
                                                </div>
                                                {expandedContinents.includes(continent) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                            </div>
                                            {expandedContinents.includes(continent) && (
                                                <div className="p-3 bg-white grid grid-cols-2 gap-2">
                                                    {(countries as string[]).map(country => (
                                                        <label key={country} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer hover:bg-purple-50 p-1 rounded">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={selectedCountries.includes(country)}
                                                                onChange={() => toggleCountry(country)}
                                                                className="w-3.5 h-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                            />
                                                            {country}
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 text-xs font-bold text-purple-600 text-right">
                                    Selected: {selectedCountries.length} countries
                                </div>
                            </div>
                        )}

                        {/* Automation Trigger */}
                        <div className={`mt-6 pt-6 border-t border-slate-100 transition-all ${keywordResult ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                            <button onClick={handleStartAutomation} disabled={!selectedKeyword || isAutomating || selectedCountries.length === 0} className="w-full bg-purple-600 text-white py-4 rounded-xl font-bold hover:bg-purple-700 transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50">
                                {isAutomating ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                                {isAutomating ? 'Searching Clients...' : 'Search & Add to Queue'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Panel: Results */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Keywords */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-slate-800 text-lg">Analysis Results</h3>
                            {keywordResult && <button onClick={() => exportKeywordsToExcel(keywordResult)} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg font-bold flex items-center gap-1"><Download size={14}/> Excel</button>}
                        </div>
                        {keywordResult ? (
                            <div className="space-y-4">
                                <div><h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Industry Terms</h4><div className="flex flex-wrap gap-2">{keywordResult.industryTerms.map((k,i) => <span key={i} className="px-2 py-1 bg-slate-100 rounded text-xs">{k}</span>)}</div></div>
                                <div>
                                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Select Target Keyword for Automation</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {keywordResult.tier1Keywords.map((k,i) => (
                                            <button key={i} onClick={() => setSelectedKeyword(k)} className={`px-3 py-1 rounded-lg text-sm font-bold border transition-all ${selectedKeyword===k ? 'bg-purple-600 text-white border-purple-600' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>{k}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : <div className="text-center text-slate-300 py-10">Upload file to analyze...</div>}
                    </div>

                    {/* Results Table */}
                    {automationResults.length > 0 && (
                        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm animate-fade-in">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2"><Zap size={20} className="text-purple-600" /> Automation Queue</h3>
                                <div className="flex gap-2">
                                    {pendingCount > 0 && onRunPending && (
                                        <button 
                                            onClick={onRunPending}
                                            disabled={isAutomating}
                                            className="bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-purple-700 transition-colors flex items-center gap-2 shadow-lg disabled:opacity-50"
                                        >
                                            {isAutomating ? <Loader2 size={16} className="animate-spin"/> : <PlayCircle size={16} />} 
                                            Run All Pending ({pendingCount})
                                        </button>
                                    )}
                                    <button 
                                        onClick={() => exportBatchAutomationReportsToPPT(automationResults)}
                                        className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-600 transition-colors flex items-center gap-2 shadow-lg"
                                    >
                                        <FileSpreadsheet size={16} /> Batch Report
                                    </button>
                                </div>
                            </div>
                            
                            <div className="overflow-hidden border border-slate-200 rounded-xl max-h-[500px] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs sticky top-0">
                                        <tr>
                                            <th className="px-4 py-3">Client</th>
                                            <th className="px-4 py-3">Country</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {automationResults.map((item) => (
                                            <tr key={item.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-3 font-bold text-slate-800">{item.clientName}<div className="text-xs text-slate-400 font-normal">{item.website}</div></td>
                                                <td className="px-4 py-3 text-slate-600">{item.country}</td>
                                                <td className="px-4 py-3">
                                                    {item.status === 'pending' && <span className="text-slate-400 flex items-center gap-1"><Loader2 size={12}/> Pending</span>}
                                                    {item.status === 'analyzing' && <span className="text-blue-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Analyzing</span>}
                                                    {item.status === 'generating_email' && <span className="text-purple-500 flex items-center gap-1"><Sparkles size={12} className="animate-pulse"/> Writing</span>}
                                                    {item.status === 'completed' && <span className="text-green-600 flex items-center gap-1 font-bold"><CheckCircle2 size={12}/> DONE</span>}
                                                    {item.status === 'failed' && <span className="text-red-500 flex items-center gap-1"><AlertTriangle size={12}/> Failed</span>}
                                                </td>
                                                <td className="px-4 py-3 text-right flex justify-end gap-2">
                                                    {(item.status === 'pending' || item.status === 'failed') && onRunSingle && (
                                                        <button 
                                                            disabled={isAutomating}
                                                            onClick={() => onRunSingle(item.id)}
                                                            className="text-purple-600 hover:text-purple-800 disabled:opacity-30 transition-colors p-1"
                                                            title="Run This Task"
                                                        >
                                                            <PlayCircle size={18} />
                                                        </button>
                                                    )}
                                                    <button 
                                                        disabled={item.status !== 'completed'}
                                                        onClick={() => exportAutomationReportToPPT(item)}
                                                        className="text-blue-600 hover:text-blue-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
                                                        title="Download Report"
                                                    >
                                                        <Download size={18} />
                                                    </button>
                                                    {onDelete && (
                                                        <button 
                                                            onClick={() => onDelete(item.id)}
                                                            className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                                            title="Delete Task"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}
        
        {activeTab === 'composer' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Controls */}
              <div className="lg:col-span-4 space-y-6 overflow-y-auto max-h-[calc(100vh-200px)] pr-2 custom-scrollbar">
                {/* Font Controls */}
                <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                     <div className="flex items-center gap-2 mb-2 text-yellow-800 font-bold border-b border-yellow-100 pb-2">
                        <Settings2 size={18}/> Font Sizes (字体大小)
                    </div>
                    <div className="space-y-3 text-xs">
                        {Object.entries(fonts).map(([key, val]) => (
                            <div key={key}>
                                <div className="flex justify-between mb-1"><span className="capitalize">{key} Size</span><span className="font-bold">{val}px</span></div>
                                <input type="range" min="20" max="120" value={val} onChange={e => setFonts({...fonts, [key]: parseInt(e.target.value)})} className="w-full accent-yellow-600"/>
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Text Inputs */}
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-800 mb-3 flex gap-2"><Type size={18}/> Text Info</h3>
                    <div className="space-y-3">
                        {[
                            {v: productName, s: setProductName}, {v: functionText, s: setFunctionText}, 
                            {v: materialsText, s: setMaterialsText}, {v: contactInfo, s: setContactInfo}
                        ].map((item, i) => <input key={i} type="text" className="w-full p-2 border rounded text-sm" value={item.v} onChange={e => item.s(e.target.value)} />)}
                    </div>
                </div>

                {/* Package Upload & Dims */}
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-800 mb-3 flex gap-2"><Package size={18}/> Packaging</h3>
                    <label className="block w-full text-center p-2 bg-orange-50 text-orange-700 border border-orange-200 rounded cursor-pointer mb-3">
                        <ImagePlus size={16} className="inline mr-2"/> Upload Package
                        <input type="file" className="hidden" accept="image/*" onChange={e => handleImageUpload(e, 'package')} />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                        {['h', 'l', 'w'].map(d => (
                            <div key={d}><span className="text-[10px] text-slate-400 uppercase">{d.toUpperCase()} (cm)</span><input type="number" className="w-full p-1 border rounded" value={(packageDims as any)[d]} onChange={e => setPackageDims({...packageDims, [d]: e.target.value})}/></div>
                        ))}
                    </div>
                </div>

                {/* Product Upload & Dims */}
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-800 mb-3 flex gap-2"><Box size={18}/> Product (Max 6)</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                        {productImgs.map((src, i) => <img key={i} src={src} className="w-10 h-10 object-cover rounded border"/>)}
                        <label className="w-10 h-10 flex items-center justify-center bg-green-50 border border-green-200 rounded cursor-pointer"><ImagePlus size={16}/><input type="file" className="hidden" accept="image/*" onChange={e => handleImageUpload(e, 'product')} /></label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {['h', 'l', 'w'].map(d => (
                             <div key={d}><span className="text-[10px] text-slate-400 uppercase">{d.toUpperCase()} (cm)</span><input type="number" className="w-full p-1 border rounded" value={(productDims as any)[d]} onChange={e => setProductDims({...productDims, [d]: e.target.value})}/></div>
                        ))}
                    </div>
                </div>

                <button onClick={downloadImage} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2">
                    <Download size={20} /> Download High-Res JPG
                </button>
              </div>

              {/* Canvas Preview */}
              <div className="lg:col-span-8 bg-slate-200 rounded-xl p-4 flex items-center justify-center min-h-[600px] relative">
                 <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-md">v3.4 Safe Layout</div>
                 <div className="shadow-2xl bg-white w-full max-w-[600px] aspect-square">
                    <canvas ref={canvasRef} width={1500} height={1500} className="w-full h-full"/>
                 </div>
              </div>
            </div>
        )}
    </div>
  );
};
