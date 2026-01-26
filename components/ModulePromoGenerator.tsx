
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { extractKeywordsFromMedia } from '../services/geminiService';
import { exportKeywordsToExcel, exportAutomationReportToPPT, exportBatchAutomationReportsToPPT } from '../services/exportService';
import { KeywordExtractionResult, KnowledgeFile, AutomationResult } from '../types';
import { 
    ImagePlus, Download, FileText, Settings2, Box, Layers, 
    UploadCloud, Loader2, FileSpreadsheet, Sparkles, Zap, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Globe, X, File, Image as ImageIcon, Tag, PlayCircle, Trash2, Type, Package, Move, Maximize
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

// Updated Interfaces for Dual Units & Canvas Objects
interface DualUnitDim {
    cm: string;
    in: string;
}

interface Dimensions {
  l: DualUnitDim;
  w: DualUnitDim;
  h: DualUnitDim;
}

interface FontSettings {
  title: number;
  sub: number;
  footer: number;
}

interface CanvasObject {
    id: string;
    img: HTMLImageElement;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    type: 'package' | 'product';
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

const INITIAL_DIMS: Dimensions = {
    l: { cm: '0', in: '0' },
    w: { cm: '0', in: '0' },
    h: { cm: '0', in: '0' }
};

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
  
  // Image Objects (Interactive)
  const [canvasObjects, setCanvasObjects] = useState<CanvasObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Dimensions State (Dual Unit)
  const [packageDims, setPackageDims] = useState<Dimensions>({ 
      l: { cm: '10', in: '3.94' }, w: { cm: '5', in: '1.97' }, h: { cm: '15', in: '5.91' } 
  });
  const [productDims, setProductDims] = useState<Dimensions>({ 
      l: { cm: '8', in: '3.15' }, w: { cm: '4', in: '1.57' }, h: { cm: '10', in: '3.94' } 
  });

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

  // --- COMPOSER HELPERS ---

  const convertAndSetDim = (
      setDims: React.Dispatch<React.SetStateAction<Dimensions>>,
      dimKey: keyof Dimensions,
      unit: 'cm' | 'in',
      value: string
  ) => {
      setDims(prev => {
          const valNum = parseFloat(value);
          if (isNaN(valNum)) {
              return { ...prev, [dimKey]: { ...prev[dimKey], [unit]: value } }; // allow typing
          }
          
          let cmVal = '';
          let inVal = '';

          if (unit === 'cm') {
              cmVal = value;
              inVal = (valNum / 2.54).toFixed(2);
              if (inVal.endsWith('.00')) inVal = inVal.slice(0, -3);
          } else {
              inVal = value;
              cmVal = (valNum * 2.54).toFixed(2);
              if (cmVal.endsWith('.00')) cmVal = cmVal.slice(0, -3);
          }

          return { ...prev, [dimKey]: { cm: cmVal, in: inVal } };
      });
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

  // --- CANVAS DRAWING ---

  const draw3DDimensions = (ctx: CanvasRenderingContext2D, startX: number, startY: number, dims: Dimensions) => {
      const hVal = parseFloat(dims.h.cm) || 0;
      const wVal = parseFloat(dims.w.cm) || 0;
      const lVal = parseFloat(dims.l.cm) || 0;

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
          ctx.fillText(`H: ${dims.h.cm}cm`, originX - 15, originY - axisLength / 2 - 20);
          ctx.fillText(`${dims.h.in}"`, originX - 15, originY - axisLength / 2 + 20);
      }

      // 2. Length
      if (lVal > 0) {
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.lineTo(originX + axisLength, originY);
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`L: ${dims.l.cm}cm / ${dims.l.in}"`, originX + axisLength / 2, originY + 20);
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
          ctx.fillText(`W: ${dims.w.cm}cm`, originX + dx + 10, originY - dy);
          ctx.fillText(`${dims.w.in}"`, originX + dx + 10, originY - dy + 35);
      }
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.textBaseline = 'alphabetic'; 
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 1500, 1500);

    // Text Header
    ctx.fillStyle = '#1e3a8a';
    ctx.textAlign = 'left';
    ctx.font = `bold ${fonts.title}px Arial`;
    ctx.fillText(productName, 80, 100); 
    
    ctx.fillStyle = '#2563eb';
    ctx.font = `bold ${fonts.sub}px Arial`;
    ctx.fillText(functionText, 80, 100 + fonts.title + 20);
    ctx.fillText(materialsText, 80, 100 + fonts.title + fonts.sub + 40);

    // Zone Labels
    const headerHeight = 350;
    const leftX = 80; 
    const rightX = 780;
    const topY = headerHeight;

    ctx.textBaseline = 'alphabetic'; 
    ctx.font = 'bold 30px Arial';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText("Packaging", leftX, topY - 20);
    ctx.fillText("Product", rightX, topY - 20);

    // Draw Images
    canvasObjects.forEach(obj => {
        ctx.save();
        ctx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2);
        ctx.rotate(obj.rotation * Math.PI / 180);
        ctx.drawImage(obj.img, -obj.width / 2, -obj.height / 2, obj.width, obj.height);
        
        // Highlight Selected
        if (obj.id === selectedObjectId) {
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 4;
            ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
            
            // Corner indicators
            ctx.fillStyle = '#2563eb';
            const size = 10;
            ctx.fillRect(-obj.width/2 - size, -obj.height/2 - size, size*2, size*2);
            ctx.fillRect(obj.width/2 - size, -obj.height/2 - size, size*2, size*2);
            ctx.fillRect(obj.width/2 - size, obj.height/2 - size, size*2, size*2);
            ctx.fillRect(-obj.width/2 - size, obj.height/2 - size, size*2, size*2);
        }
        ctx.restore();
    });

    // Draw Dimension Widgets (Static Anchors for now, as requested logic implies standard layout)
    const pkgAnchorX = leftX + 180; 
    const pkgAnchorY = 1320; 
    draw3DDimensions(ctx, pkgAnchorX, pkgAnchorY, packageDims);

    const prodAnchorX = rightX + 180;
    const prodAnchorY = 1320;
    draw3DDimensions(ctx, prodAnchorX, prodAnchorY, productDims);

    // Footer
    if (contactInfo) {
        ctx.font = `bold ${fonts.footer}px Arial`;
        ctx.fillStyle = '#1e3a8a';
        ctx.textAlign = 'center';
        ctx.fillText(contactInfo, 750, 1460);
    }
  }, [productName, functionText, materialsText, contactInfo, fonts, canvasObjects, selectedObjectId, packageDims, productDims]);

  useEffect(() => {
    if (activeTab === 'composer') {
        requestAnimationFrame(drawCanvas);
    }
  }, [activeTab, drawCanvas]);

  // --- CANVAS INTERACTION HANDLERS ---

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Calculate mouse position relative to canvas coordinate system (1500x1500)
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      // Find clicked object (iterate reverse to pick top-most)
      let clickedId: string | null = null;
      for (let i = canvasObjects.length - 1; i >= 0; i--) {
          const obj = canvasObjects[i];
          if (
              mouseX >= obj.x && 
              mouseX <= obj.x + obj.width && 
              mouseY >= obj.y && 
              mouseY <= obj.y + obj.height
          ) {
              clickedId = obj.id;
              setDragOffset({ x: mouseX - obj.x, y: mouseY - obj.y });
              break;
          }
      }

      setSelectedObjectId(clickedId);
      if (clickedId) setIsDragging(true);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging || !selectedObjectId) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      setCanvasObjects(prev => prev.map(obj => {
          if (obj.id === selectedObjectId) {
              return { ...obj, x: mouseX - dragOffset.x, y: mouseY - dragOffset.y };
          }
          return obj;
      }));
  };

  const handleCanvasMouseUp = () => {
      setIsDragging(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'package' | 'product') => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const result = ev.target?.result as string;
            const img = await loadImage(result);
            
            // Initial positioning logic
            const headerHeight = 350;
            const targetWidth = 400; // default width
            const scale = targetWidth / img.width;
            const height = img.height * scale;
            
            // Zones: Left (Packaging) center ~320+80=400, Right (Product) center ~780+320=1100
            const startX = type === 'package' ? 200 : 900;
            const startY = headerHeight + 50;

            const newObj: CanvasObject = {
                id: Date.now().toString(),
                img,
                x: startX,
                y: startY,
                width: targetWidth,
                height: height,
                rotation: 0,
                type
            };
            setCanvasObjects(prev => [...prev, newObj]);
            setSelectedObjectId(newObj.id);
        };
        reader.readAsDataURL(file);
    }
  };

  const updateSelectedObject = (key: keyof CanvasObject, val: number) => {
      if (!selectedObjectId) return;
      setCanvasObjects(prev => prev.map(obj => {
          if (obj.id === selectedObjectId) {
              return { ...obj, [key]: val };
          }
          return obj;
      }));
  };

  const deleteSelected = () => {
      if(selectedObjectId) {
          setCanvasObjects(prev => prev.filter(o => o.id !== selectedObjectId));
          setSelectedObjectId(null);
      }
  };

  const downloadImage = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `SpecSheet_${Date.now()}.jpg`;
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

                {/* Selected Image Controls */}
                {selectedObjectId && (
                    <div className="bg-blue-50 p-5 rounded-xl border border-blue-200 animate-fade-in">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-blue-800 flex gap-2"><Move size={18}/> Image Adjustment</h3>
                            <button onClick={() => { if(selectedObjectId) { setCanvasObjects(prev => prev.filter(o => o.id !== selectedObjectId)); setSelectedObjectId(null); } }} className="text-red-500 hover:text-red-700 bg-white p-1.5 rounded-lg shadow-sm border border-red-100"><Trash2 size={16}/></button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between text-xs text-blue-700 font-bold mb-1">
                                    <span>Scale / Size</span>
                                    <span>{canvasObjects.find(o => o.id === selectedObjectId)?.width.toFixed(0)}px</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="50" 
                                    max="800" 
                                    value={canvasObjects.find(o => o.id === selectedObjectId)?.width || 100} 
                                    onChange={(e) => {
                                        const newW = parseInt(e.target.value);
                                        const obj = canvasObjects.find(o => o.id === selectedObjectId);
                                        if (obj) {
                                            const ratio = obj.height / obj.width;
                                            updateSelectedObject('width', newW);
                                            updateSelectedObject('height', newW * ratio);
                                        }
                                    }}
                                    className="w-full accent-blue-600"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Package Upload & Dims */}
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-800 mb-3 flex gap-2"><Package size={18}/> Packaging (Free Drag)</h3>
                    <label className="block w-full text-center p-2 bg-orange-50 text-orange-700 border border-orange-200 rounded cursor-pointer mb-3 hover:bg-orange-100 transition-colors">
                        <ImagePlus size={16} className="inline mr-2"/> Add Package Image
                        <input type="file" className="hidden" accept="image/*" onChange={e => handleImageUpload(e, 'package')} />
                    </label>
                    <div className="grid grid-cols-1 gap-3">
                        {(['l', 'w', 'h'] as const).map(d => (
                            <div key={d} className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 w-4 uppercase">{d}</span>
                                <div className="flex gap-1 flex-1">
                                    <div className="relative flex-1">
                                        <input 
                                            type="text" 
                                            className="w-full p-1.5 pl-1 border rounded text-xs" 
                                            placeholder="cm"
                                            value={packageDims[d].cm}
                                            onChange={e => convertAndSetDim(setPackageDims, d, 'cm', e.target.value)}
                                        />
                                        <span className="absolute right-1 top-1.5 text-[10px] text-slate-400">cm</span>
                                    </div>
                                    <div className="relative flex-1">
                                        <input 
                                            type="text" 
                                            className="w-full p-1.5 pl-1 border rounded text-xs bg-slate-50" 
                                            placeholder="in"
                                            value={packageDims[d].in}
                                            onChange={e => convertAndSetDim(setPackageDims, d, 'in', e.target.value)}
                                        />
                                        <span className="absolute right-1 top-1.5 text-[10px] text-slate-400">in</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Product Upload & Dims */}
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="font-bold text-slate-800 mb-3 flex gap-2"><Box size={18}/> Product (Free Drag)</h3>
                    <label className="block w-full text-center p-2 bg-green-50 text-green-700 border border-green-200 rounded cursor-pointer mb-3 hover:bg-green-100 transition-colors">
                        <ImagePlus size={16} className="inline mr-2"/> Add Product Image
                        <input type="file" className="hidden" accept="image/*" onChange={e => handleImageUpload(e, 'product')} />
                    </label>
                    <div className="grid grid-cols-1 gap-3">
                        {(['l', 'w', 'h'] as const).map(d => (
                            <div key={d} className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 w-4 uppercase">{d}</span>
                                <div className="flex gap-1 flex-1">
                                    <div className="relative flex-1">
                                        <input 
                                            type="text" 
                                            className="w-full p-1.5 pl-1 border rounded text-xs" 
                                            placeholder="cm"
                                            value={productDims[d].cm}
                                            onChange={e => convertAndSetDim(setProductDims, d, 'cm', e.target.value)}
                                        />
                                        <span className="absolute right-1 top-1.5 text-[10px] text-slate-400">cm</span>
                                    </div>
                                    <div className="relative flex-1">
                                        <input 
                                            type="text" 
                                            className="w-full p-1.5 pl-1 border rounded text-xs bg-slate-50" 
                                            placeholder="in"
                                            value={productDims[d].in}
                                            onChange={e => convertAndSetDim(setProductDims, d, 'in', e.target.value)}
                                        />
                                        <span className="absolute right-1 top-1.5 text-[10px] text-slate-400">in</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <button onClick={downloadImage} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors">
                    <Download size={20} /> Download High-Res JPG
                </button>
              </div>

              {/* Canvas Preview */}
              <div className="lg:col-span-8 bg-slate-200 rounded-xl p-4 flex items-center justify-center min-h-[600px] relative overflow-hidden">
                 <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-md z-10">v3.5 Interactive</div>
                 <div className="absolute top-4 right-4 text-slate-500 text-xs font-bold z-10 flex items-center gap-1"><Maximize size={12}/> Click Image to Drag & Resize</div>
                 <div className="shadow-2xl bg-white w-full max-w-[600px] aspect-square cursor-crosshair">
                    <canvas 
                        ref={canvasRef} 
                        width={1500} 
                        height={1500} 
                        className="w-full h-full"
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                    />
                 </div>
              </div>
            </div>
        )}
    </div>
  );
};
