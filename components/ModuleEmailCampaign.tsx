
import React, { useState, useEffect, useRef } from 'react';
import { AliyunConfig, EmailTemplate, EmailTask, Client } from '../types';
import { getAliyunConfig, saveAliyunConfig, loadEmailTemplates, saveEmailTemplate, deleteEmailTemplate, sendSingleMail } from '../services/aliyunService';
import { Mail, Settings, Layout, Send, Save, Plus, Trash2, PlayCircle, AlertTriangle, CheckCircle2, Loader2, X, Users, RefreshCw, Bold, Italic, Underline, List, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight, Type } from 'lucide-react';

interface Props {
    crmClients: Client[];
}

// Simple Rich Text Toolbar Component
const RichTextToolbar: React.FC<{ onCommand: (cmd: string, val?: string) => void }> = ({ onCommand }) => (
    <div className="flex items-center gap-1 p-2 border-b border-slate-200 bg-slate-50 rounded-t-xl overflow-x-auto">
        <button type="button" onClick={() => onCommand('bold')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Bold"><Bold size={16}/></button>
        <button type="button" onClick={() => onCommand('italic')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Italic"><Italic size={16}/></button>
        <button type="button" onClick={() => onCommand('underline')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Underline"><Underline size={16}/></button>
        <div className="w-px h-6 bg-slate-300 mx-1"></div>
        <button type="button" onClick={() => onCommand('justifyLeft')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Align Left"><AlignLeft size={16}/></button>
        <button type="button" onClick={() => onCommand('justifyCenter')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Align Center"><AlignCenter size={16}/></button>
        <button type="button" onClick={() => onCommand('justifyRight')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Align Right"><AlignRight size={16}/></button>
        <div className="w-px h-6 bg-slate-300 mx-1"></div>
        <button type="button" onClick={() => onCommand('insertUnorderedList')} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="List"><List size={16}/></button>
        <button type="button" onClick={() => {
            const url = prompt('Enter URL:');
            if(url) onCommand('createLink', url);
        }} className="p-2 hover:bg-slate-200 rounded text-slate-600" title="Link"><LinkIcon size={16}/></button>
        <div className="w-px h-6 bg-slate-300 mx-1"></div>
        <select onChange={(e) => onCommand('fontSize', e.target.value)} className="text-xs border rounded p-1 bg-white">
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="7">Huge</option>
        </select>
    </div>
);

export const ModuleEmailCampaign: React.FC<Props> = ({ crmClients }) => {
    const [activeTab, setActiveTab] = useState<'settings' | 'templates' | 'campaign'>('campaign');
    const [config, setConfig] = useState<AliyunConfig>(getAliyunConfig());
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    
    // Campaign State
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
    const [tasks, setTasks] = useState<EmailTask[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [sendProgress, setSendProgress] = useState(0);

    // Template Edit State
    const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    
    // UI State
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');

    useEffect(() => {
        setTemplates(loadEmailTemplates());
    }, []);

    // Sync HTML content from div to state on change
    useEffect(() => {
        if (editingTemplate && editorRef.current) {
            editorRef.current.innerHTML = editingTemplate.body || '';
        }
    }, [editingTemplate?.id]); 

    const handleSaveConfig = () => {
        setSaveStatus('saving');
        saveAliyunConfig(config);
        // Simulate delay for feedback
        setTimeout(() => {
            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }, 800);
    };

    // --- TEMPLATE HANDLERS ---
    const handleSaveTemplate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTemplate) return;
        
        // Get HTML from contentEditable div
        const bodyContent = editorRef.current?.innerHTML || '';
        
        const toSave = { 
            ...editingTemplate, 
            body: bodyContent,
            lastUpdated: Date.now() 
        };
        saveEmailTemplate(toSave);
        setTemplates(loadEmailTemplates());
        setEditingTemplate(null);
    };

    const handleDeleteTemplate = (id: string) => {
        if(confirm("Delete this template?")) {
            deleteEmailTemplate(id);
            setTemplates(loadEmailTemplates());
        }
    };

    const execCmd = (cmd: string, val?: string) => {
        document.execCommand(cmd, false, val);
        if (editorRef.current && editingTemplate) {
            setEditingTemplate({ ...editingTemplate, body: editorRef.current.innerHTML });
        }
    };

    // --- CAMPAIGN HANDLERS ---
    const prepareCampaign = () => {
        if (!selectedTemplateId) { alert("Please select a template."); return; }
        if (selectedClientIds.size === 0) { alert("Please select at least one client."); return; }
        
        const template = templates.find(t => t.id === selectedTemplateId);
        if(!template) return;

        const newTasks: EmailTask[] = crmClients
            .filter(c => selectedClientIds.has(c.id))
            .map(c => ({
                id: Math.random().toString(36).substr(2, 9),
                recipientEmail: (c.website && c.website.includes('@')) ? c.website : `info@${c.website || 'example.com'}`, 
                recipientName: "Sir/Madam", 
                companyName: c.name,
                status: 'pending'
            }));
        
        setTasks(newTasks);
        setSendProgress(0);
    };

    const startSending = async () => {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) return;

        setIsSending(true);
        let completed = 0;

        // Use template sender alias if present, else fallback to global config
        const activeConfig = {
            ...config,
            fromAlias: template.senderName || config.fromAlias
        };

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            if (task.status === 'success') { completed++; continue; }

            // 1. Update Status to Sending
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'sending' } : t));

            // 2. Replace Variables
            const subject = template.subject
                .replace(/{Name}/g, task.recipientName)
                .replace(/{Company}/g, task.companyName);
            
            const body = template.body
                .replace(/{Name}/g, task.recipientName)
                .replace(/{Company}/g, task.companyName);

            // 3. Send via Aliyun
            await new Promise(r => setTimeout(r, 500)); 

            const res = await sendSingleMail(activeConfig, task.recipientEmail, subject, body);

            // 4. Update Status
            setTasks(prev => prev.map(t => t.id === task.id ? { 
                ...t, 
                status: res.success ? 'success' : 'failed', 
                error: res.message,
                sentAt: Date.now()
            } : t));

            completed++;
            setSendProgress(Math.round((completed / tasks.length) * 100));
        }
        setIsSending(false);
        alert("Campaign Completed!");
    };

    const toggleSelectClient = (id: string) => {
        const newSet = new Set(selectedClientIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedClientIds(newSet);
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-20">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="bg-orange-600 p-3 rounded-2xl text-white shadow-lg shadow-orange-100">
                        <Mail size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Email Campaign / 邮件营销</h2>
                        <p className="text-slate-500 font-medium">Aliyun DirectMail Integration (无缝对接阿里云)</p>
                    </div>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setActiveTab('campaign')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${activeTab === 'campaign' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <Send size={16}/> Campaign
                    </button>
                    <button onClick={() => setActiveTab('templates')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${activeTab === 'templates' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <Layout size={16}/> Templates
                    </button>
                    <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${activeTab === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <Settings size={16}/> Settings
                    </button>
                </div>
            </div>

            {/* Content Areas */}
            {activeTab === 'settings' && (
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm max-w-2xl mx-auto">
                    <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"><Settings size={20}/> Aliyun Configuration</h3>
                    <div className="space-y-4">
                        <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl text-xs text-orange-800 mb-4 flex gap-2">
                             <AlertTriangle size={16} className="shrink-0"/>
                             <div>
                                 <strong>Important:</strong> Browser CORS restrictions prevent direct calls to Aliyun. 
                                 Please install a browser extension like <u>Allow CORS</u> to use this feature from GitHub Pages.
                             </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">AccessKey ID</label>
                                <input 
                                    type="password" 
                                    value={config.accessKeyId} 
                                    onChange={e => setConfig({...config, accessKeyId: e.target.value})} 
                                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                                    placeholder="LTAI..." 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">AccessKey Secret</label>
                                <input 
                                    type="password" 
                                    value={config.accessKeySecret} 
                                    onChange={e => setConfig({...config, accessKeySecret: e.target.value})} 
                                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                                    placeholder="..." 
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Sender Address (AccountName)</label>
                                <input 
                                    type="text" 
                                    value={config.accountName} 
                                    onChange={e => setConfig({...config, accountName: e.target.value})} 
                                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                                    placeholder="sales@notify.yourdomain.com" 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Default From Alias</label>
                                <input 
                                    type="text" 
                                    value={config.fromAlias} 
                                    onChange={e => setConfig({...config, fromAlias: e.target.value})} 
                                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                                    placeholder="Company Name" 
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Tag Name (Opt)</label>
                                <input 
                                    type="text" 
                                    value={config.tagName} 
                                    onChange={e => setConfig({...config, tagName: e.target.value})} 
                                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                                    placeholder="promo_2024" 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Region ID</label>
                                <select 
                                    value={config.regionId} 
                                    onChange={e => setConfig({...config, regionId: e.target.value})} 
                                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="dm.aliyuncs.com">China East 1 (Hangzhou/Global)</option>
                                    <option value="ap-southeast-1">Singapore (ap-southeast-1)</option>
                                    <option value="ap-southeast-2">Sydney (ap-southeast-2)</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 pt-2">
                             <input type="checkbox" checked={config.replyToAddress} onChange={e => setConfig({...config, replyToAddress: e.target.checked})} className="w-5 h-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"/>
                             <label className="text-sm font-bold text-slate-700">Enable Reply-To Address</label>
                        </div>
                        
                        <button 
                            onClick={handleSaveConfig} 
                            disabled={saveStatus === 'saving'}
                            className={`w-full py-4 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 mt-4 text-white
                                ${saveStatus === 'success' ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-900 hover:bg-slate-800'}`}
                        >
                            {saveStatus === 'saving' && <Loader2 className="animate-spin" size={18} />}
                            {saveStatus === 'success' && <CheckCircle2 size={18} />}
                            {saveStatus === 'idle' && <Save size={18} />}
                            
                            {saveStatus === 'saving' ? 'Saving...' : 
                             saveStatus === 'success' ? 'Configuration Saved!' : 'Save Configuration'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'templates' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    <div className="md:col-span-3 space-y-4">
                        <button 
                            onClick={() => {
                                setEditingTemplate({ 
                                    id: Date.now().toString(), 
                                    name: 'New Template', 
                                    subject: '', 
                                    senderName: config.fromAlias, // Default to global
                                    body: '<p>Dear {Name},</p><p><br/></p><p>Best Regards,</p>', 
                                    lastUpdated: Date.now() 
                                });
                            }}
                            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-md"
                        >
                            <Plus size={18} /> Create New Template
                        </button>
                        <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                            {templates.map(t => (
                                <div key={t.id} onClick={() => setEditingTemplate(t)} className={`p-4 rounded-xl border cursor-pointer transition-all ${editingTemplate?.id === t.id ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:border-blue-300'}`}>
                                    <h4 className="font-bold text-slate-800 text-sm truncate">{t.name}</h4>
                                    <p className="text-xs text-slate-500 truncate mt-1">{t.subject}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    <div className="md:col-span-9">
                        {editingTemplate ? (
                            <form onSubmit={handleSaveTemplate} className="bg-white rounded-3xl border border-slate-200 shadow-sm h-full flex flex-col overflow-hidden">
                                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><Layout size={18}/> 创建模板 (Create Template)</h3>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => handleDeleteTemplate(editingTemplate.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={18}/></button>
                                        <button type="button" onClick={() => setEditingTemplate(null)} className="text-slate-400 hover:bg-slate-50 p-2 rounded-lg"><X size={18}/></button>
                                    </div>
                                </div>
                                
                                <div className="p-8 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
                                    {/* Row 1: Template Name */}
                                    <div className="grid grid-cols-12 gap-4 items-center">
                                        <label className="col-span-2 text-right text-sm font-bold text-slate-600">
                                            <span className="text-red-500 mr-1">*</span>模板名称:
                                        </label>
                                        <div className="col-span-10">
                                            <input 
                                                value={editingTemplate.name} 
                                                onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})} 
                                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" 
                                                placeholder="长度为1-30个字符。" 
                                                required 
                                            />
                                        </div>
                                    </div>

                                    {/* Row 2: Subject */}
                                    <div className="grid grid-cols-12 gap-4 items-center">
                                        <label className="col-span-2 text-right text-sm font-bold text-slate-600">
                                            <span className="text-red-500 mr-1">*</span>邮件标题:
                                        </label>
                                        <div className="col-span-10">
                                            <input 
                                                value={editingTemplate.subject} 
                                                onChange={e => setEditingTemplate({...editingTemplate, subject: e.target.value})} 
                                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" 
                                                placeholder="长度为1-256个字符" 
                                                required 
                                            />
                                        </div>
                                    </div>

                                    {/* Row 3: Sender Name */}
                                    <div className="grid grid-cols-12 gap-4 items-center">
                                        <label className="col-span-2 text-right text-sm font-bold text-slate-600">
                                            <span className="text-red-500 mr-1">*</span>发送人名称:
                                        </label>
                                        <div className="col-span-10">
                                            <input 
                                                value={editingTemplate.senderName || ''} 
                                                onChange={e => setEditingTemplate({...editingTemplate, senderName: e.target.value})} 
                                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" 
                                                placeholder="长度为1-30个字符。" 
                                            />
                                        </div>
                                    </div>

                                    {/* Row 4: Variable Info */}
                                    <div className="grid grid-cols-12 gap-4">
                                        <label className="col-span-2 text-right text-sm font-bold text-slate-600 mt-1">
                                            变量说明:
                                        </label>
                                        <div className="col-span-10 text-xs text-slate-500 leading-relaxed">
                                            请用{`{变量名称}`}为邮件正文中需要替换的变量内容占位。例如，{`{Name}`}替换收件人真实姓名、{`{Company}`}替换公司名。变量名可使用英文大小写字母。
                                        </div>
                                    </div>

                                    {/* Row 5: Body Editor */}
                                    <div className="grid grid-cols-12 gap-4">
                                        <label className="col-span-2 text-right text-sm font-bold text-slate-600 mt-2">
                                            <span className="text-red-500 mr-1">*</span>邮件正文:
                                        </label>
                                        <div className="col-span-10">
                                            <div className="border border-slate-300 rounded-xl bg-white shadow-sm overflow-hidden flex flex-col h-[400px]">
                                                <RichTextToolbar onCommand={execCmd} />
                                                <div 
                                                    ref={editorRef}
                                                    contentEditable
                                                    className="flex-1 p-4 outline-none overflow-y-auto text-sm"
                                                    style={{ minHeight: '200px' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="px-8 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                                    <button type="button" onClick={() => setEditingTemplate(null)} className="px-6 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50">取消</button>
                                    <button type="submit" className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 shadow-md">保存</button>
                                </div>
                            </form>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                                <Layout size={48} className="mb-4 text-slate-300" />
                                <p className="font-medium">Select a template to edit or create a new one.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Campaign Tab Content (No Changes needed for this request, reusing existing logic) */}
            {activeTab === 'campaign' && (
                <div className="space-y-6">
                    {/* Step 1: Selection */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px] flex flex-col">
                             <div className="flex justify-between items-center mb-4">
                                 <h3 className="font-bold text-slate-800 flex items-center gap-2"><Users size={18}/> 1. Select Clients</h3>
                                 <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded-lg">{selectedClientIds.size} Selected</span>
                             </div>
                             <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-100 rounded-xl">
                                 {crmClients.map(c => (
                                     <div key={c.id} onClick={() => toggleSelectClient(c.id)} className={`p-3 border-b flex items-center gap-3 cursor-pointer hover:bg-slate-50 ${selectedClientIds.has(c.id) ? 'bg-blue-50/50' : ''}`}>
                                         <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedClientIds.has(c.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                                             {selectedClientIds.has(c.id) && <CheckCircle2 size={12}/>}
                                         </div>
                                         <div className="overflow-hidden">
                                             <div className="text-sm font-bold text-slate-800 truncate">{c.name}</div>
                                             <div className="text-xs text-slate-400 truncate">{c.website}</div>
                                         </div>
                                     </div>
                                 ))}
                                 {crmClients.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">No clients in CRM.</div>}
                             </div>
                         </div>

                         <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px] flex flex-col">
                             <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><Layout size={18}/> 2. Select Template</h3>
                             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                                 {templates.map(t => (
                                     <div key={t.id} onClick={() => setSelectedTemplateId(t.id)} className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedTemplateId === t.id ? 'bg-orange-50 border-orange-500 ring-1 ring-orange-500' : 'bg-slate-50 border-slate-200 hover:border-orange-300'}`}>
                                         <div className="flex justify-between">
                                            <h4 className="font-bold text-slate-800 text-sm truncate">{t.name}</h4>
                                            {selectedTemplateId === t.id && <CheckCircle2 size={16} className="text-orange-500"/>}
                                         </div>
                                         <p className="text-xs text-slate-500 truncate mt-1">{t.subject}</p>
                                         <p className="text-[10px] text-slate-400 mt-1">From: {t.senderName || config.fromAlias || 'Default'}</p>
                                     </div>
                                 ))}
                                 {templates.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">No templates. Go to Templates tab.</div>}
                             </div>
                         </div>
                    </div>

                    {/* Step 3: Action */}
                    <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold">Ready to Launch?</h3>
                            <p className="text-slate-400 text-sm">Selected {selectedClientIds.size} recipients using template.</p>
                        </div>
                        <button onClick={prepareCampaign} className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-colors">
                            <RefreshCw size={18}/> Generate Send List
                        </button>
                    </div>

                    {/* Step 4: Execution */}
                    {tasks.length > 0 && (
                        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm animate-fade-in">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2"><Send size={20}/> Sending Queue</h3>
                                <div className="flex items-center gap-4">
                                     {isSending && (
                                         <div className="flex items-center gap-2 text-sm font-bold text-orange-600">
                                             <Loader2 className="animate-spin" size={16}/> Sending... {sendProgress}%
                                         </div>
                                     )}
                                     <button onClick={startSending} disabled={isSending} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 shadow-md disabled:opacity-50">
                                         <PlayCircle size={18}/> Start Campaign
                                     </button>
                                </div>
                            </div>
                            
                            <div className="overflow-hidden border border-slate-200 rounded-xl max-h-[400px] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs sticky top-0">
                                        <tr>
                                            <th className="px-4 py-3">Recipient</th>
                                            <th className="px-4 py-3">Email</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-right">Info</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {tasks.map(t => (
                                            <tr key={t.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-3 font-bold text-slate-800">{t.companyName}</td>
                                                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{t.recipientEmail}</td>
                                                <td className="px-4 py-3">
                                                    {t.status === 'pending' && <span className="text-slate-400">Waiting</span>}
                                                    {t.status === 'sending' && <span className="text-orange-500 font-bold">Sending...</span>}
                                                    {t.status === 'success' && <span className="text-green-600 font-bold flex items-center gap-1"><CheckCircle2 size={12}/> Sent</span>}
                                                    {t.status === 'failed' && <span className="text-red-500 font-bold flex items-center gap-1"><AlertTriangle size={12}/> Failed</span>}
                                                </td>
                                                <td className="px-4 py-3 text-right text-xs text-slate-400">
                                                    {t.error ? <span className="text-red-500 max-w-[200px] truncate block ml-auto" title={t.error}>{t.error}</span> : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
