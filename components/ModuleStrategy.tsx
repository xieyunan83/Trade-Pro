
import React, { useState, useRef, useEffect } from 'react';
import { AnalysisResult, ChatMessage, KnowledgeFile } from '../types';
import { streamStrategyChat } from '../services/geminiService';
import { getAllFilesFromDB } from '../services/db';
import { 
    Send, Paperclip, Loader2, Bot, User, FileText, 
    X, File, Sparkles, Eraser, FileType 
} from 'lucide-react';

interface Props {
  data?: AnalysisResult | null;
}

export const ModuleStrategy: React.FC<Props> = ({ data }) => {
  // --- State: Knowledge Base ---
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeFile[]>([]);
  
  // --- State: Chat ---
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
      // Lazy init based on whether we have data or not
      if (data) {
        return [{
            id: 'init',
            role: 'model',
            text: `**Strategy Context Loaded** ✅\n\nI have fully analyzed **${data.companyInfo.name}**. \n\n**Data Points Available:**\n- Revenue & Trends: ${data.financials.revenueEstimate}\n- Decision Makers: ${data.decisionMakers.length} contacts\n- Core Products: ${data.businessScope.coreProducts.join(', ')}\n\n**How I will write your Development Email:**\n1. I will read your request.\n2. I will scan your uploaded Knowledge Base (Catalog/Price List) found in the History/System.\n3. I will cross-reference the ${data.companyInfo.name} deep investigation report.\n4. I will generate a highly personalized email/proposal.\n\nPlease tell me your goal (e.g., "Write a cold email pitching our new plush toys").`,
            timestamp: Date.now()
        }];
      } else {
          return [{
            id: 'init',
            role: 'model',
            text: `**Strategy Assistant Ready** 🚀\n\nI am your independent trade strategy consultant. I can help with:\n- Drafting cold emails\n- Negotiation scripts\n- Market analysis\n\nSystem Knowledge Base is active (managed by Admin). Ask me anything!`,
            timestamp: Date.now()
        }];
      }
  });
  
  const [inputValue, setInputValue] = useState('');
  const [currentAttachments, setCurrentAttachments] = useState<KnowledgeFile[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Load KB from IndexedDB on mount ---
  useEffect(() => {
      const loadFiles = async () => {
          try {
              const files = await getAllFilesFromDB();
              setKnowledgeBase(files);
          } catch (e) {
              console.error("Failed to load KB from DB", e);
          }
      };
      loadFiles();
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- File Handling Helper ---
  const processFiles = async (files: FileList | null): Promise<KnowledgeFile[]> => {
      if (!files) return [];
      const processed: KnowledgeFile[] = [];
      setIsProcessingFile(true);
      
      try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            let fileType = file.type;
            const fileName = file.name.toLowerCase();

            // Fallback for missing MIME types
            if (!fileType) {
                if (fileName.endsWith('.pdf')) fileType = 'application/pdf';
                else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) fileType = 'image/jpeg';
                else if (fileName.endsWith('.png')) fileType = 'image/png';
                else if (fileName.endsWith('.txt')) fileType = 'text/plain';
            }

            const isImage = fileType.startsWith('image/');
            const isPdf = fileType === 'application/pdf';
            const isText = fileType === 'text/plain';
            const isWord = fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx');
            const isAudio = fileType.startsWith('audio/') || fileName.endsWith('.mp3') || fileName.endsWith('.wav');
            const isVideo = fileType.startsWith('video/') || fileName.endsWith('.mp4') || fileName.endsWith('.mov');

            if (!isImage && !isPdf && !isText && !isWord && !isAudio && !isVideo) {
                alert(`Unsupported file type: ${file.name}. Please upload PDF, Word, Image, Audio, Video or Text.`);
                continue;
            }

            if (file.size > 10 * 1024 * 1024) { // Increased to 10MB for media
                alert(`Chat Attachment ${file.name} is too large (Max 10MB).`);
                continue;
            }

            // Word Doc Processing
            if (isWord) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    // @ts-expect-error - Mammoth is loaded via script tag
                    const result = await window.mammoth.extractRawText({ arrayBuffer });
                    const text = result.value;
                    processed.push({
                        id: Date.now() + '-' + i + Math.random().toString(36).substr(2, 9),
                        name: file.name + " (Converted)",
                        type: 'txt',
                        mimeType: 'text/plain',
                        data: btoa(unescape(encodeURIComponent(text))),
                        size: file.size
                    });
                } catch (err) {
                    console.error("Word conversion failed", err);
                }
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
                size: file.size
            });
        }
      } catch (error) {
          console.error("File processing error", error);
      } finally {
          setIsProcessingFile(false);
      }
      return processed;
  };

  // --- Handlers: Chat ---
  const handleChatUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      // Chat attachments are temporary
      const newFiles = await processFiles(e.target.files);
      setCurrentAttachments(prev => [...prev, ...newFiles]);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeChatAttachment = (id: string) => {
      setCurrentAttachments(prev => prev.filter(f => f.id !== id));
  };

  const clearHistory = () => {
      if (confirm("Clear conversation history?")) {
          const initMsg = messages[0];
          setMessages([{ ...initMsg, timestamp: Date.now() }]);
      }
  };

  const handleSendMessage = async () => {
      if ((!inputValue.trim() && currentAttachments.length === 0) || isStreaming) return;

      const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          text: inputValue,
          attachments: currentAttachments,
          timestamp: Date.now()
      };

      setMessages(prev => [...prev, userMsg]);
      setInputValue('');
      setCurrentAttachments([]);
      setIsStreaming(true);

      try {
          const history = messages.filter(m => m.id !== 'init'); 
          let fullResponse = "";
          const stream = streamStrategyChat(history, knowledgeBase, userMsg.text, userMsg.attachments || [], data);
          
          const botMsgId = (Date.now() + 1).toString();
          setMessages(prev => [...prev, { id: botMsgId, role: 'model', text: 'Thinking & Analyzing...', timestamp: Date.now() }]);

          for await (const chunk of stream) {
              fullResponse += chunk;
              setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: fullResponse } : m));
          }
      } catch (e: any) {
          console.error(e);
          const errorText = e.message || "Unknown error";
          setMessages(prev => [...prev, { 
              id: Date.now().toString(), 
              role: 'model', 
              text: `⚠️ **Error**: ${errorText}`, 
              timestamp: Date.now() 
          }]);
      } finally {
          setIsStreaming(false);
      }
  };

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col gap-6 max-w-7xl mx-auto animate-fade-in overflow-hidden">
        {/* MAIN CHAT INTERFACE - NOW FULL WIDTH */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-xl flex flex-col overflow-hidden relative">
            {/* Chat Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-md shadow-indigo-100">
                        <Bot size={20} />
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800">Strategy Assistant</h3>
                        <p className="text-xs text-slate-500">Context: {data ? data.companyInfo.name : "General Mode"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={clearHistory}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                        title="Clear History"
                    >
                        <Eraser size={20} />
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/50">
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
                                        <div key={i} className="bg-white border border-slate-200 p-2 rounded-lg flex items-center gap-2 text-xs text-slate-600 shadow-sm">
                                            <File size={12} /> {att.name}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${
                                msg.role === 'user' 
                                ? 'bg-slate-900 text-white rounded-tr-none' 
                                : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                            }`}>
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

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-slate-100">
                {currentAttachments.length > 0 && (
                    <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
                        {currentAttachments.map(att => (
                            <div key={att.id} className="relative bg-slate-100 px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-bold text-slate-700 border border-slate-200 flex-shrink-0">
                                {att.type.includes('word') || att.name.endsWith('doc') ? <FileType size={14} className="text-blue-600" /> : <File size={14} className="text-blue-500" />}
                                <span className="max-w-[100px] truncate">{att.name}</span>
                                <button onClick={() => removeChatAttachment(att.id)} className="ml-1 hover:text-red-500"><X size={14} /></button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all shadow-inner">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                        title="Upload file for THIS chat only"
                    >
                        <Paperclip size={20} />
                    </button>
                    <input 
                        type="file" 
                        multiple 
                        className="hidden" 
                        ref={fileInputRef} 
                        onChange={handleChatUpload}
                        accept="image/*,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    />
                    
                    <textarea 
                        className="flex-1 bg-transparent border-none focus:ring-0 text-slate-800 text-sm font-medium max-h-32 py-3 resize-none custom-scrollbar"
                        placeholder="Ask me anything..."
                        rows={1}
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => {
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
            </div>
        </div>
    </div>
  );
};
