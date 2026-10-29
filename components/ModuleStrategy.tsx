import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AnalysisResult,
  ChatMessage,
  KnowledgeFile,
  MailGroup,
  HistoryItem,
  DiscoveryArchiveItem,
  StrategyChatContext,
} from '../types';
import { streamStrategyChat, generateMailGroupStrategy } from '../services/geminiService';
import { getAllFilesFromDB } from '../services/db';
import { compressImageBase64, filterTextKnowledgeFiles } from '../utils/aiContextPack';
import { getCustomKeywords, getCustomCountries } from '../services/taxonomyStore';
import { formatBackgroundCheckTime } from '../utils/crmHistory';
import {
  getStrategyLlmStatus,
  listStrategyOfferAssets,
  pickDefaultStrategyOfferIds,
  buildCreativeOfferBrief,
  resolveOfferImagesForLlm,
  strategyOfferKindLabel,
  type StrategyOfferAsset,
} from '../services/strategyOfferBridge';
import { VaultImg } from './VaultMedia';
import {
  Send,
  Paperclip,
  Loader2,
  Bot,
  User,
  FileText,
  X,
  File,
  Sparkles,
  Eraser,
  FileType,
  Mail,
  Save,
  Building2,
  Tag,
  Globe,
  Check,
  ChevronDown,
  Search,
  ImagePlus,
} from 'lucide-react';

interface Props {
  data?: AnalysisResult | null;
  history?: HistoryItem[];
  discoveryArchives?: DiscoveryArchiveItem[];
  /** 生成开发信后保存到对应背调报告（可指定客户） */
  onSaveGeneratedEmails?: (
    emails: MailGroup,
    forCompany?: AnalysisResult | null
  ) => void | Promise<void>;
}

type PickerKind = 'company' | 'keyword' | 'country' | null;

const companyKey = (c: AnalysisResult) =>
  (c.companyInfo?.website || c.companyInfo?.name || '').toLowerCase().trim();

export const ModuleStrategy: React.FC<Props> = ({
  data,
  history = [],
  discoveryArchives = [],
  onSaveGeneratedEmails,
}) => {
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeFile[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'init',
      role: 'model',
      text: data
        ? `**Strategy Context Loaded** ✅\n\n已载入当前背调：**${data.companyInfo?.name || '该公司'}**。\n\n可引用平面产品图 / 包装图 / 发文素材，再叠加关键词与国家，由策略服务生成开发信组。`
        : `**Strategy Assistant Ready** 🚀\n\n我是外贸策略顾问。请组合：\n- 创作素材（产品图 / 包装 / 发文）\n- 背调客户（单客户）\n- 关键词与国家（整市场）\n\n点「生成开发信」或说「写一组开发信」——会真正调用策略服务，短、多角度、末封带钩子。`,
      timestamp: Date.now(),
    },
  ]);

  const [inputValue, setInputValue] = useState('');
  const [currentAttachments, setCurrentAttachments] = useState<KnowledgeFile[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isGeneratingEmails, setIsGeneratingEmails] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');

  const [selectedCompanies, setSelectedCompanies] = useState<AnalysisResult[]>(() =>
    data ? [data] : []
  );
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [pickerFilter, setPickerFilter] = useState('');
  const [offerAssets, setOfferAssets] = useState<StrategyOfferAsset[]>(() => listStrategyOfferAssets());
  const [selectedOfferIds, setSelectedOfferIds] = useState<string[]>(() =>
    pickDefaultStrategyOfferIds(listStrategyOfferAssets())
  );
  const [showOfferPicker, setShowOfferPicker] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Sync when App opens a different report into Strategy
  useEffect(() => {
    if (!data) return;
    const key = companyKey(data);
    if (!key) return;
    setSelectedCompanies((prev) => {
      if (prev.some((c) => companyKey(c) === key)) {
        return prev.map((c) => (companyKey(c) === key ? data : c));
      }
      return [data, ...prev].slice(0, 8);
    });
  }, [data?.companyInfo?.website, data?.companyInfo?.name]);

  useEffect(() => {
    const loadFiles = async () => {
      try {
        const files = await getAllFilesFromDB();
        // 只保留文本类进策略上下文，避免 70+ 大图/PDF 原件拖慢开发信并烧 Token
        setKnowledgeBase(filterTextKnowledgeFiles(files));
      } catch (e) {
        console.error('Failed to load KB from DB', e);
      }
    };
    loadFiles();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!picker) return;
    const onDoc = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPicker(null);
        setPickerFilter('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [picker]);

  const historyOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; label: string; sub: string; data: AnalysisResult; at?: number }[] = [];
    for (const h of history) {
      if (!h.data?.companyInfo) continue;
      const key = (h.domain || h.data.companyInfo.website || h.data.companyInfo.name || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: h.id,
        label: h.data.companyInfo.name || h.domain,
        sub: [h.domain || h.data.companyInfo.website, h.keyword || h.data.searchKeyword, h.country]
          .filter(Boolean)
          .join(' · '),
        data: h.data,
        at: h.timestamp,
      });
    }
    return list;
  }, [history]);

  const keywordOptions = useMemo(() => {
    const set = new Set<string>();
    for (const k of getCustomKeywords()) if (k.trim()) set.add(k.trim());
    for (const h of history) {
      const k = (h.keyword || h.data?.searchKeyword || '').trim();
      if (k) set.add(k);
    }
    for (const a of discoveryArchives) {
      const k = (a.product || '').trim();
      if (k) set.add(k);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [history, discoveryArchives]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of getCustomCountries()) if (c.trim()) set.add(c.trim());
    for (const h of history) {
      const c = (h.country || h.data?.searchCountry || '').trim();
      if (c && !/^(global|worldwide|国际|全球|不限)$/i.test(c)) set.add(c);
    }
    for (const a of discoveryArchives) {
      for (const c of a.countries || []) if (c?.trim()) set.add(c.trim());
      if (a.country?.trim()) set.add(a.country.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
  }, [history, discoveryArchives]);

  const marketLeads = useMemo(() => {
    if (!selectedKeywords.length && !selectedCountries.length) return [];
    const leads: StrategyChatContext['marketLeads'] = [];
    const seen = new Set<string>();
    for (const a of discoveryArchives) {
      const archKw = (a.product || '').trim();
      const kwHit =
        !selectedKeywords.length ||
        selectedKeywords.some((k) => archKw.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(archKw.toLowerCase()));
      if (!kwHit && selectedKeywords.length) continue;
      for (const r of a.results || []) {
        const country = (r.searchCountry || r.country || '').trim();
        const countryHit =
          !selectedCountries.length ||
          selectedCountries.some(
            (c) => country.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(country.toLowerCase())
          );
        if (!countryHit && selectedCountries.length) continue;
        const key = (r.website || r.name || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        leads!.push({
          name: r.name,
          website: r.website,
          country,
          clientType: r.clientType,
          keyword: r.searchKeyword || archKw,
        });
        if (leads!.length >= 25) return leads;
      }
    }
    return leads;
  }, [discoveryArchives, selectedKeywords, selectedCountries]);

  const creativeOfferBrief = useMemo(
    () => buildCreativeOfferBrief(offerAssets, selectedOfferIds),
    [offerAssets, selectedOfferIds]
  );

  const strategyContext: StrategyChatContext = useMemo(
    () => ({
      companies: selectedCompanies,
      keywords: selectedKeywords,
      countries: selectedCountries,
      marketLeads,
      creativeOfferBrief: creativeOfferBrief || undefined,
    }),
    [selectedCompanies, selectedKeywords, selectedCountries, marketLeads, creativeOfferBrief]
  );

  const primaryCompany = selectedCompanies[0] || data || null;
  const llmStatus = getStrategyLlmStatus();

  const refreshOfferAssets = () => {
    const next = listStrategyOfferAssets();
    setOfferAssets(next);
    setSelectedOfferIds((prev) => {
      const still = prev.filter((id) => next.some((a) => a.id === id));
      return still.length ? still : pickDefaultStrategyOfferIds(next);
    });
  };

  const toggleOfferAsset = (id: string) => {
    setSelectedOfferIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id].slice(0, 6);
    });
  };

  const contextLabel = useMemo(() => {
    const parts: string[] = [];
    if (selectedCompanies.length === 1) {
      parts.push(selectedCompanies[0].companyInfo?.name || '1 客户');
    } else if (selectedCompanies.length > 1) {
      parts.push(`${selectedCompanies.length} 个背调客户`);
    }
    if (selectedKeywords.length) parts.push(`关键词 ${selectedKeywords.length}`);
    if (selectedCountries.length) parts.push(`国家 ${selectedCountries.length}`);
    if (selectedOfferIds.length) parts.push(`素材 ${selectedOfferIds.length}`);
    return parts.length ? parts.join(' · ') : 'General Mode';
  }, [selectedCompanies, selectedKeywords, selectedCountries, selectedOfferIds]);

  const processFiles = async (files: FileList | null): Promise<KnowledgeFile[]> => {
    if (!files) return [];
    const processed: KnowledgeFile[] = [];
    setIsProcessingFile(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let fileType = file.type;
        const fileName = file.name.toLowerCase();

        if (!fileType) {
          if (fileName.endsWith('.pdf')) fileType = 'application/pdf';
          else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) fileType = 'image/jpeg';
          else if (fileName.endsWith('.png')) fileType = 'image/png';
          else if (fileName.endsWith('.txt')) fileType = 'text/plain';
        }

        const isImage = fileType.startsWith('image/');
        const isPdf = fileType === 'application/pdf';
        const isText = fileType === 'text/plain';
        const isWord =
          fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          fileName.endsWith('.docx');
        const isAudio = fileType.startsWith('audio/') || fileName.endsWith('.mp3') || fileName.endsWith('.wav');
        const isVideo = fileType.startsWith('video/') || fileName.endsWith('.mp4') || fileName.endsWith('.mov');

        if (!isImage && !isPdf && !isText && !isWord && !isAudio && !isVideo) {
          alert(`Unsupported file type: ${file.name}. Please upload PDF, Word, Image, Audio, Video or Text.`);
          continue;
        }

        if (file.size > 4 * 1024 * 1024) {
          alert(`Chat Attachment ${file.name} is too large (Max 4MB). Please compress the image.`);
          continue;
        }

        if (isWord) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const result = await window.mammoth!.extractRawText({ arrayBuffer });
            const text = result.value;
            processed.push({
              id: Date.now() + '-' + i + Math.random().toString(36).substr(2, 9),
              name: file.name + ' (Converted)',
              type: 'txt',
              mimeType: 'text/plain',
              data: text,
              size: text.length,
            });
          } catch (err) {
            console.error('Word conversion failed', err);
          }
          continue;
        }

        if (isImage) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(String(e.target?.result || ''));
            reader.onerror = () => reject(new Error('read failed'));
            reader.readAsDataURL(file);
          });
          const compressed = await compressImageBase64(dataUrl, fileType || 'image/jpeg', {
            maxSide: 1280,
            quality: 0.72,
          });
          processed.push({
            id: Date.now() + '-' + i + Math.random().toString(36).substr(2, 9),
            name: file.name,
            type: 'jpg',
            mimeType: compressed.mimeType,
            data: compressed.data,
            size: Math.ceil((compressed.data.length * 3) / 4),
          });
          continue;
        }

        if (isText) {
          const text = await file.text();
          processed.push({
            id: Date.now() + '-' + i + Math.random().toString(36).substr(2, 9),
            name: file.name,
            type: 'txt',
            mimeType: 'text/plain',
            data: text.slice(0, 20_000),
            size: Math.min(text.length, 20_000),
          });
          continue;
        }

        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const res = e.target?.result as string;
            const base64Raw = res.split(',')[1];
            resolve(base64Raw);
          };
          reader.readAsDataURL(file);
        });

        processed.push({
          id: Date.now() + '-' + i + Math.random().toString(36).substr(2, 9),
          name: file.name,
          type: file.name.split('.').pop() || 'txt',
          mimeType: fileType,
          data: base64,
          size: file.size,
        });
      }
    } catch (error) {
      console.error('File processing error', error);
    } finally {
      setIsProcessingFile(false);
    }
    return processed;
  };

  const handleChatUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = await processFiles(e.target.files);
    setCurrentAttachments((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeChatAttachment = (id: string) => {
    setCurrentAttachments((prev) => prev.filter((f) => f.id !== id));
  };

  const clearHistory = () => {
    if (confirm('Clear conversation history?')) {
      const initMsg = messages[0];
      setMessages([{ ...initMsg, timestamp: Date.now() }]);
    }
  };

  const toggleCompany = (item: AnalysisResult) => {
    const key = companyKey(item);
    setSelectedCompanies((prev) => {
      if (prev.some((c) => companyKey(c) === key)) {
        return prev.filter((c) => companyKey(c) !== key);
      }
      return [...prev, item].slice(0, 8);
    });
  };

  const toggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw].slice(0, 12)
    );
  };

  const toggleCountry = (c: string) => {
    setSelectedCountries((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c].slice(0, 12)
    );
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && currentAttachments.length === 0) || isStreaming) return;

    const status = getStrategyLlmStatus();
    if (!status.ready) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'model',
          text: status.detail,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: inputValue,
      attachments: currentAttachments,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setCurrentAttachments([]);
    setIsStreaming(true);
    setPicker(null);

    try {
      const chatHistory = messages.filter((m) => m.id !== 'init');
      let fullResponse = '';
      const stream = streamStrategyChat(
        chatHistory,
        knowledgeBase,
        userMsg.text,
        userMsg.attachments || [],
        primaryCompany,
        strategyContext
      );

      const botMsgId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: botMsgId,
          role: 'model',
          text: creativeOfferBrief
            ? '正在结合背调与创作素材分析…'
            : '正在调用策略服务…',
          timestamp: Date.now(),
        },
      ]);

      for await (const chunk of stream) {
        fullResponse += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? { ...m, text: fullResponse } : m))
        );
      }
      if (!fullResponse.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? { ...m, text: '策略服务未返回内容，请稍后重试或精简附件后再试。' }
              : m
          )
        );
      }
    } catch (e: unknown) {
      console.error(e);
      let errorText = e instanceof Error ? e.message : String(e);
      if (/413|FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(errorText)) {
        errorText =
          '请求体积过大（附件或系统知识库过多）。已自动压缩仍失败时，请：去掉大图/PDF、减少附件，或点右上角清空对话后再试。';
      } else {
        errorText = errorText
          .replace(/千问|通义|DashScope|Qwen|Gemini|Tavily/gi, '策略服务')
          .slice(0, 280);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'model',
          text: `⚠️ ${errorText}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleGenerateAndSaveEmails = async () => {
    if (!primaryCompany || !onSaveGeneratedEmails) {
      alert('请先选择或打开一个背调客户，再生成开发信。');
      return;
    }
    const status = getStrategyLlmStatus();
    if (!status.ready) {
      setGenerateMsg(status.detail);
      return;
    }
    setIsGeneratingEmails(true);
    setGenerateMsg('正在汇总创作素材并调用策略服务…');
    try {
      refreshOfferAssets();
      const assets = listStrategyOfferAssets();
      const ids =
        selectedOfferIds.length > 0 ? selectedOfferIds : pickDefaultStrategyOfferIds(assets);
      const brief = buildCreativeOfferBrief(assets, ids);
      setGenerateMsg('正在解析产品/包装配图…');
      const images = await resolveOfferImagesForLlm(assets, ids, 1);
      const kbFiles = filterTextKnowledgeFiles(await getAllFilesFromDB());
      const leadsSummary = marketLeads
        .slice(0, 8)
        .map((l) => `${l.name}${l.country ? ` (${l.country})` : ''}${l.keyword ? ` · ${l.keyword}` : ''}`)
        .join('; ');
      setGenerateMsg('正在生成 3 封开发信组…');
      const mailGroup = await generateMailGroupStrategy(primaryCompany, images, kbFiles, {
        creativeOfferBrief: brief || undefined,
        keywords: selectedKeywords,
        countries: selectedCountries,
        marketLeadsSummary: leadsSummary || undefined,
      });
      await onSaveGeneratedEmails(mailGroup, primaryCompany);
      setGenerateMsg(
        `开发信组已生成并保存${images.length ? '（已引用创作配图）' : ''}${
          brief ? ' · 已并入产品/包装/发文线索' : ''
        }。下载 PPT 时会自动包含。`
      );
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      setGenerateMsg(
        `生成失败：${raw
          .replace(/千问|通义|DashScope|Qwen|Gemini|Tavily/gi, '策略服务')
          .slice(0, 220)}`
      );
    } finally {
      setIsGeneratingEmails(false);
    }
  };

  const q = pickerFilter.trim().toLowerCase();
  const filteredCompanies = historyOptions.filter((o) => {
    if (!q) return true;
    return `${o.label} ${o.sub}`.toLowerCase().includes(q);
  });
  const filteredKeywords = keywordOptions.filter((k) => !q || k.toLowerCase().includes(q));
  const filteredCountries = countryOptions.filter((c) => !q || c.toLowerCase().includes(q));

  return (
    <div className="h-[calc(100dvh-120px)] sm:h-[calc(100vh-140px)] flex flex-col gap-4 sm:gap-6 max-w-7xl mx-auto animate-fade-in overflow-hidden px-0">
      {primaryCompany && (
        <div className="bg-white rounded-2xl border border-indigo-200 p-4 sm:p-5 shadow-sm flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-slate-800">开发信 · 保存到背调报告</div>
              <p className="text-xs text-slate-500 font-medium mt-1">
                针对「{primaryCompany.companyInfo?.name || '当前客户'}」+ 创作素材 / 关键词 / 国家，调用策略服务生成 3 封短开发信（匹配破冰 / 实力证明 / 钩子收口）。
              </p>
              <p
                className={`text-[11px] font-bold mt-2 px-2 py-1 rounded-lg inline-block ${
                  llmStatus.ready
                    ? 'text-emerald-800 bg-emerald-50 border border-emerald-100'
                    : 'text-amber-800 bg-amber-50 border border-amber-100'
                }`}
              >
                {llmStatus.detail}
              </p>
              {generateMsg && (
                <p
                  className={`text-[11px] font-bold mt-2 ${
                    /失败|未就绪/.test(generateMsg) ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {generateMsg}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateAndSaveEmails()}
              disabled={isGeneratingEmails || !onSaveGeneratedEmails || !llmStatus.ready}
              className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-3 rounded-xl font-bold text-sm shadow-lg shrink-0"
            >
              {isGeneratingEmails ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {isGeneratingEmails ? '生成中…' : '生成开发信'}
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-indigo-50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider inline-flex items-center gap-1">
                <ImagePlus size={11} /> 引用创作素材（产品图 / 包装 / 发文）
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={refreshOfferAssets}
                  className="text-[10px] font-black text-slate-400 hover:text-indigo-600"
                >
                  刷新
                </button>
                <button
                  type="button"
                  onClick={() => setShowOfferPicker((v) => !v)}
                  className="text-[10px] font-black text-indigo-600 hover:text-indigo-800"
                >
                  {showOfferPicker ? '收起' : '选择素材'}
                </button>
              </div>
            </div>
            {selectedOfferIds.length === 0 ? (
              <p className="text-[11px] text-slate-400 font-medium">
                暂无素材。请先在平面设计 / 包装 / 发文模块生成，或点「选择素材」。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {offerAssets
                  .filter((a) => selectedOfferIds.includes(a.id))
                  .map((a) => (
                    <div
                      key={a.id}
                      className="relative w-14 h-14 rounded-lg overflow-hidden border border-indigo-200 bg-slate-50 group"
                      title={`${strategyOfferKindLabel(a.kind)} · ${a.label}`}
                    >
                      {a.url ? (
                        <VaultImg src={a.url} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-[9px] font-black text-slate-500 px-1 text-center">
                          文案
                        </span>
                      )}
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/70 text-white text-[8px] font-black text-center py-0.5">
                        {strategyOfferKindLabel(a.kind)}
                      </span>
                      <button
                        type="button"
                        aria-label="移除"
                        onClick={() => toggleOfferAsset(a.id)}
                        className="absolute top-0.5 right-0.5 rounded-full bg-slate-900/85 text-white p-0.5 opacity-90"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {showOfferPicker && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2 max-h-48 overflow-y-auto">
                {offerAssets.length === 0 ? (
                  <p className="text-center text-slate-400 text-xs py-4 font-medium">
                    创作库为空，请先生成产品图、包装或发文素材
                  </p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {offerAssets.slice(0, 36).map((a) => {
                      const on = selectedOfferIds.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => toggleOfferAsset(a.id)}
                          className={`relative aspect-square rounded-lg overflow-hidden border bg-white ${
                            on ? 'border-indigo-500 ring-1 ring-indigo-200' : 'border-slate-200'
                          }`}
                          title={a.label}
                        >
                          {a.url ? (
                            <VaultImg src={a.url} alt="" className="w-full h-full object-contain" />
                          ) : (
                            <span className="flex h-full items-center justify-center text-[9px] font-bold text-slate-500 p-1">
                              {a.label.slice(0, 18)}
                            </span>
                          )}
                          {on && (
                            <span className="absolute top-0.5 left-0.5 rounded-full bg-indigo-600 text-white p-0.5">
                              <Check size={10} />
                            </span>
                          )}
                          <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[8px] font-black text-center truncate px-0.5">
                            {strategyOfferKindLabel(a.kind)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          {primaryCompany.generatedEmails && (
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              {primaryCompany.generatedEmails.analysis && (
                <p className="text-xs font-bold text-indigo-800 bg-indigo-50 p-3 rounded-xl">
                  {primaryCompany.generatedEmails.analysis}
                  {primaryCompany.generatedEmails.sendTip
                    ? ` · ${primaryCompany.generatedEmails.sendTip}`
                    : ''}
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    label: '匹配破冰',
                    subject: primaryCompany.generatedEmails.subject1,
                    body: primaryCompany.generatedEmails.email1,
                  },
                  {
                    label: '实力证明',
                    subject: primaryCompany.generatedEmails.subject2,
                    body: primaryCompany.generatedEmails.email2,
                  },
                  {
                    label: '钩子收口',
                    subject: primaryCompany.generatedEmails.subject3,
                    body: primaryCompany.generatedEmails.email3,
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="text-[10px] font-black text-indigo-600 uppercase mb-1 flex items-center gap-1">
                      <Mail size={12} /> {item.label}
                    </div>
                    {item.subject && (
                      <p className="text-[11px] font-bold text-slate-800 mb-1 line-clamp-2">
                        Subject: {item.subject}
                      </p>
                    )}
                    <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-6">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-xl flex flex-col overflow-hidden relative">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-md shadow-indigo-100 flex-shrink-0">
              <Bot size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-slate-800">Strategy Assistant</h3>
              <p className="text-xs text-slate-500 truncate">Context: {contextLabel}</p>
            </div>
          </div>
          <button
            onClick={clearHistory}
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            title="Clear History"
          >
            <Eraser size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 custom-scrollbar bg-slate-50/50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'model' && (
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0 mt-1">
                  <Sparkles size={14} />
                </div>
              )}

              <div className={`max-w-[85%] space-y-2 ${msg.role === 'user' ? 'items-end flex flex-col' : ''}`}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-1 justify-end">
                    {msg.attachments.map((att, i) => (
                      <div
                        key={i}
                        className="bg-white border border-slate-200 p-2 rounded-lg flex items-center gap-2 text-xs text-slate-600 shadow-sm"
                      >
                        <File size={12} /> {att.name}
                      </div>
                    ))}
                  </div>
                )}

                <div
                  className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white rounded-tr-none'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 flex-shrink-0 mt-1">
                  <User size={14} />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-slate-100" ref={pickerRef}>
          {(selectedCompanies.length > 0 ||
            selectedKeywords.length > 0 ||
            selectedCountries.length > 0 ||
            currentAttachments.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-3">
              {selectedCompanies.map((c) => (
                <span
                  key={companyKey(c)}
                  className="inline-flex items-center gap-1 bg-violet-50 text-violet-800 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-violet-100"
                >
                  <Building2 size={12} />
                  <span className="max-w-[140px] truncate">{c.companyInfo?.name || '客户'}</span>
                  <button type="button" onClick={() => toggleCompany(c)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {selectedKeywords.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-emerald-100"
                >
                  <Tag size={12} /> {k}
                  <button type="button" onClick={() => toggleKeyword(k)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {selectedCountries.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 bg-sky-50 text-sky-800 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-sky-100"
                >
                  <Globe size={12} /> {c}
                  <button type="button" onClick={() => toggleCountry(c)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {currentAttachments.map((att) => (
                <span
                  key={att.id}
                  className="relative inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200"
                >
                  {att.type.includes('word') || att.name.endsWith('doc') ? (
                    <FileType size={12} className="text-blue-600" />
                  ) : (
                    <File size={12} className="text-blue-500" />
                  )}
                  <span className="max-w-[100px] truncate">{att.name}</span>
                  <button type="button" onClick={() => removeChatAttachment(att.id)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {(selectedCompanies.length > 0 || selectedKeywords.length > 0 || selectedCountries.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCompanies(data ? [data] : []);
                    setSelectedKeywords([]);
                    setSelectedCountries([]);
                  }}
                  className="text-[11px] font-bold text-slate-400 hover:text-red-500 px-2"
                >
                  清空上下文
                </button>
              )}
            </div>
          )}

          {picker && (
            <div className="mb-3 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-64 flex flex-col">
              <div className="p-2 border-b border-slate-100 flex items-center gap-2">
                <Search size={14} className="text-slate-400" />
                <input
                  value={pickerFilter}
                  onChange={(e) => setPickerFilter(e.target.value)}
                  placeholder={
                    picker === 'company'
                      ? '搜索背调客户…'
                      : picker === 'keyword'
                        ? '搜索关键词…'
                        : '搜索国家…'
                  }
                  className="flex-1 text-sm font-medium outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    setPicker(null);
                    setPickerFilter('');
                  }}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-1">
                {picker === 'company' &&
                  (filteredCompanies.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-6 font-medium">暂无背调记录，请先完成客户背调</p>
                  ) : (
                    filteredCompanies.map((o) => {
                      const on = selectedCompanies.some((c) => companyKey(c) === companyKey(o.data));
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleCompany(o.data)}
                          className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-xl text-left ${
                            on ? 'bg-violet-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              on ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300'
                            }`}
                          >
                            {on && <Check size={10} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-800 truncate">{o.label}</span>
                            <span className="block text-[10px] text-slate-400 font-bold truncate">
                              {o.sub}
                              {o.at ? ` · ${formatBackgroundCheckTime(o.at)}` : ''}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  ))}
                {picker === 'keyword' &&
                  (filteredKeywords.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-6 font-medium">暂无关键词，可先在客户搜索中检索</p>
                  ) : (
                    filteredKeywords.map((k) => {
                      const on = selectedKeywords.includes(k);
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => toggleKeyword(k)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm font-bold ${
                            on ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              on ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                            }`}
                          >
                            {on && <Check size={10} />}
                          </span>
                          {k}
                        </button>
                      );
                    })
                  ))}
                {picker === 'country' &&
                  (filteredCountries.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-6 font-medium">暂无国家记录</p>
                  ) : (
                    filteredCountries.map((c) => {
                      const on = selectedCountries.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleCountry(c)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm font-bold ${
                            on ? 'bg-sky-50 text-sky-900' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              on ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300'
                            }`}
                          >
                            {on && <Check size={10} />}
                          </span>
                          {c}
                        </button>
                      );
                    })
                  ))}
              </div>
            </div>
          )}

          <div className="relative flex items-end gap-1 sm:gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all shadow-inner">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingFile}
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
              title="上传附件（产品/报价参考）"
            >
              {isProcessingFile ? <Loader2 size={20} className="animate-spin" /> : <Paperclip size={20} />}
            </button>
            <input
              type="file"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleChatUpload}
              accept="image/*,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            />

            <button
              type="button"
              onClick={() => {
                setPicker((p) => (p === 'company' ? null : 'company'));
                setPickerFilter('');
              }}
              className={`inline-flex items-center gap-1 px-2 py-2 rounded-xl text-[11px] font-black transition-colors ${
                picker === 'company' || selectedCompanies.length
                  ? 'bg-violet-100 text-violet-800'
                  : 'text-slate-500 hover:bg-violet-50 hover:text-violet-700'
              }`}
              title="选择背调客户"
            >
              <Building2 size={16} />
              <span className="hidden sm:inline">背调</span>
              {selectedCompanies.length > 0 && <span>{selectedCompanies.length}</span>}
              <ChevronDown size={12} className="opacity-60" />
            </button>

            <button
              type="button"
              onClick={() => {
                setPicker((p) => (p === 'keyword' ? null : 'keyword'));
                setPickerFilter('');
              }}
              className={`inline-flex items-center gap-1 px-2 py-2 rounded-xl text-[11px] font-black transition-colors ${
                picker === 'keyword' || selectedKeywords.length
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
              }`}
              title="选择搜索关键词（整市场）"
            >
              <Tag size={16} />
              <span className="hidden sm:inline">关键词</span>
              {selectedKeywords.length > 0 && <span>{selectedKeywords.length}</span>}
              <ChevronDown size={12} className="opacity-60" />
            </button>

            <button
              type="button"
              onClick={() => {
                setPicker((p) => (p === 'country' ? null : 'country'));
                setPickerFilter('');
              }}
              className={`inline-flex items-center gap-1 px-2 py-2 rounded-xl text-[11px] font-black transition-colors ${
                picker === 'country' || selectedCountries.length
                  ? 'bg-sky-100 text-sky-800'
                  : 'text-slate-500 hover:bg-sky-50 hover:text-sky-700'
              }`}
              title="选择目标国家（整市场）"
            >
              <Globe size={16} />
              <span className="hidden sm:inline">国家</span>
              {selectedCountries.length > 0 && <span>{selectedCountries.length}</span>}
              <ChevronDown size={12} className="opacity-60" />
            </button>

            <textarea
              className="flex-1 bg-transparent border-none focus:ring-0 text-slate-800 text-sm font-medium max-h-32 py-3 resize-none custom-scrollbar min-w-0"
              placeholder="Ask me anything..."
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />

            <button
              onClick={handleSendMessage}
              disabled={(!inputValue.trim() && currentAttachments.length === 0) || isStreaming}
              className="p-2 bg-indigo-600 text-white rounded-xl shadow-md hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95"
            >
              {isStreaming ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400 font-bold px-1">
            创作素材 + 附件 = 我方卖点 · 背调 = 单客户 · 关键词/国家 = 整市场（生成开发信会一并送入策略服务）
          </p>
        </div>
      </div>
    </div>
  );
};
