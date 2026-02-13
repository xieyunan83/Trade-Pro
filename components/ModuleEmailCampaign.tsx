
import React, { useState, useEffect, useRef } from 'react';
import { AliyunConfig, EmailTemplate, EmailTask, Client } from '../types';
import { getAliyunConfig, saveAliyunConfig, loadEmailTemplates, saveEmailTemplate, deleteEmailTemplate, sendSingleMail } from '../services/aliyunService';
import { Mail, Settings, Layout, Send, Save, Plus, Trash2, PlayCircle, AlertTriangle, CheckCircle2, Loader2, X, Users, RefreshCw, Bold, Italic, Underline, List, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight, Image as ImageIcon, Upload, Download, FileSpreadsheet, ChevronDown, ChevronRight, User, Filter, Paperclip, Table, Type, GripVertical, Reply, Smile, MoreHorizontal, Baseline } from 'lucide-react';

// Use global XLSX if available
declare const XLSX: any;

interface Props {
    crmClients: Client[];
    onAddClients?: (clients: Client[]) => void;
}

interface Recipient {
    id: string; 
    clientId: string;
    contactIndex?: number;
    name: string;
    email: string;
    role: string;
    companyName: string;
}

// --- Enhanced Rich Text Toolbar ---
const RichTextToolbar: React.FC<{ onCommand: (cmd: string, val?: string) => void }> = ({ onCommand }) => {
    
    const handleAction = (e: React.MouseEvent, cmd: string, promptText?: string) => {
        e.preventDefault(); 
        e.stopPropagation();

        if (promptText) {
            setTimeout(() => {
                const val = prompt(promptText);
                if (val) onCommand(cmd, val);
            }, 10);
        } else {
            onCommand(cmd);
        }
    };

    const handleVariable = (e: React.ChangeEvent<HTMLSelectElement>) => {
        e.preventDefault();
        const val = e.target.value;
        if(val) onCommand('insertText', val);
        e.target.value = ''; // Reset
    };

    const handleTable = (e: React.MouseEvent) => {
        e.preventDefault();
        const tableHtml = `
            <table style="border-collapse: collapse; width: 100%; border: 1px solid #ddd;">
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">Cell 1</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">Cell 2</td>
                </tr>
                <tr>
                    <td style="border: 1px solid #ddd; padding: 8px;">Cell 3</td>
                    <td style="border: 1px solid #ddd; padding: 8px;">Cell 4</td>
                </tr>
            </table><br/>
        `;
        onCommand('insertHTML', tableHtml);
    };

    return (
        <div className="flex items-center gap-1 p-2 border-b border-slate-200 bg-slate-100 rounded-t-xl flex-wrap">
            {/* History */}
            <div className="flex gap-1 mr-2">
                <button type="button" onMouseDown={(e) => handleAction(e, 'undo')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Undo"><Reply size={16} className="scale-x-[-1]"/></button>
                <button type="button" onMouseDown={(e) => handleAction(e, 'redo')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Redo"><Reply size={16}/></button>
            </div>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>

            {/* Font Control */}
            <select onChange={(e) => onCommand('fontName', e.target.value)} className="h-7 text-xs border border-slate-300 rounded px-1 bg-white focus:outline-none w-24">
                <option value="Arial">Arial</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Verdana">Verdana</option>
                <option value="Tahoma">Tahoma</option>
                <option value="Georgia">Georgia</option>
            </select>
            <select onChange={(e) => onCommand('fontSize', e.target.value)} className="h-7 text-xs border border-slate-300 rounded px-1 bg-white focus:outline-none w-14">
                <option value="3">12px</option>
                <option value="1">10px</option>
                <option value="2">11px</option>
                <option value="4">14px</option>
                <option value="5">18px</option>
                <option value="6">24px</option>
                <option value="7">36px</option>
            </select>
            
            <div className="w-px h-5 bg-slate-300 mx-1"></div>

            {/* Formatting */}
            <button type="button" onMouseDown={(e) => handleAction(e, 'bold')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600 font-bold" title="Bold"><Bold size={16}/></button>
            <button type="button" onMouseDown={(e) => handleAction(e, 'italic')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600 italic" title="Italic"><Italic size={16}/></button>
            <button type="button" onMouseDown={(e) => handleAction(e, 'underline')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600 underline" title="Underline"><Underline size={16}/></button>
            
            {/* Color Picker (NEW) */}
            <div className="relative group p-1.5 hover:bg-slate-200 rounded cursor-pointer flex items-center justify-center" title="Text Color">
                <Baseline size={16} className="text-slate-700"/>
                <input 
                    type="color" 
                    onChange={(e) => onCommand('foreColor', e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
            </div>

            <div className="w-px h-5 bg-slate-300 mx-1"></div>

            {/* Alignment */}
            <button type="button" onMouseDown={(e) => handleAction(e, 'justifyLeft')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Align Left"><AlignLeft size={16}/></button>
            <button type="button" onMouseDown={(e) => handleAction(e, 'justifyCenter')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Align Center"><AlignCenter size={16}/></button>
            <button type="button" onMouseDown={(e) => handleAction(e, 'justifyRight')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Align Right"><AlignRight size={16}/></button>
            
            <div className="w-px h-5 bg-slate-300 mx-1"></div>

            {/* Insertions */}
            <button type="button" onMouseDown={(e) => handleAction(e, 'insertUnorderedList')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="List"><List size={16}/></button>
            <button type="button" onMouseDown={(e) => handleAction(e, 'createLink', 'Enter URL:')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Link"><LinkIcon size={16}/></button>
            <button type="button" onMouseDown={(e) => handleAction(e, 'insertImage', 'Enter Image URL:')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Insert Image"><ImageIcon size={16}/></button>
            <button type="button" onMouseDown={handleTable} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Insert Table"><Table size={16}/></button>
            
            <div className="flex-1"></div>

            {/* Variables */}
            <div className="relative group">
                <select onChange={handleVariable} className="h-7 text-xs border border-blue-300 bg-blue-50 text-blue-700 rounded px-2 focus:outline-none font-bold cursor-pointer">
                    <option value="">+ 插入变量 (Insert Variable)</option>
                    <option value="{Name}">联系人姓名 (Contact Name)</option>
                    <option value="{Company}">公司名称 (Company Name)</option>
                    <option value="{Title}">职位 (Job Title)</option>
                </select>
            </div>
        </div>
    );
};

export const ModuleEmailCampaign: React.FC<Props> = ({ crmClients, onAddClients }) => {
    const [activeTab, setActiveTab] = useState<'settings' | 'templates' | 'campaign'>('campaign');
    const [config, setConfig] = useState<AliyunConfig>(getAliyunConfig());
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    
    // Campaign State
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
    const [expandedClientIds, setExpandedClientIds] = useState<Set<string>>(new Set());
    const [roleFilter, setRoleFilter] = useState<string>('All'); 

    const [tasks, setTasks] = useState<EmailTask[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [sendProgress, setSendProgress] = useState(0);

    // Template Edit State
    const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null); // New for attachment UI
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');

    useEffect(() => {
        setTemplates(loadEmailTemplates());
    }, []);

    useEffect(() => {
        if (editingTemplate && editorRef.current) {
            editorRef.current.innerHTML = editingTemplate.body || '';
        }
    }, [editingTemplate?.id]); 

    // --- Helpers ---
    const getAllPotentialRecipients = (): Recipient[] => {
        const recipients: Recipient[] = [];
        crmClients.forEach(client => {
            if (client.contacts && client.contacts.length > 0) {
                client.contacts.forEach((contact, idx) => {
                    if (contact.emailGuess && contact.emailGuess.includes('@')) {
                        recipients.push({
                            id: `${client.id}_c_${idx}`,
                            clientId: client.id,
                            contactIndex: idx,
                            name: contact.name,
                            email: contact.emailGuess,
                            role: contact.type,
                            companyName: client.name
                        });
                    }
                });
            } else {
                const genericEmail = (client.website && client.website.includes('@')) ? client.website : (client.activityLog.match(/Email: ([^\s,]+)/)?.[1]);
                if (genericEmail && genericEmail.includes('@')) {
                    recipients.push({
                        id: `${client.id}_generic`,
                        clientId: client.id,
                        name: "Sir/Madam",
                        email: genericEmail,
                        role: "General",
                        companyName: client.name
                    });
                }
            }
        });
        return recipients;
    };

    const getFilteredRecipients = () => {
        const all = getAllPotentialRecipients();
        if (roleFilter === 'All') return all;
        return all.filter(r => r.role === roleFilter);
    };

    // --- Actions ---
    const handleSaveConfig = () => {
        setSaveStatus('saving');
        saveAliyunConfig(config);
        setTimeout(() => {
            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }, 800);
    };

    const handleSaveTemplate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTemplate) return;
        const bodyContent = editorRef.current?.innerHTML || '';
        const toSave = { ...editingTemplate, body: bodyContent, lastUpdated: Date.now() };
        saveEmailTemplate(toSave);
        setTemplates(loadEmailTemplates());
        setEditingTemplate(null);
    };

    const handleDeleteTemplate = (id: string) => { if(confirm("Delete this template?")) { deleteEmailTemplate(id); setTemplates(loadEmailTemplates()); } };
    
    const execCmd = (cmd: string, val?: string) => { 
        if (editorRef.current) editorRef.current.focus(); 
        document.execCommand(cmd, false, val); 
        if (editorRef.current && editingTemplate) setEditingTemplate({ ...editingTemplate, body: editorRef.current.innerHTML }); 
    };

    // Attachments UI Handler
    const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && editingTemplate) {
            const newFiles: string[] = [];
            for(let i = 0; i < e.target.files.length; i++) {
                const file = e.target.files.item(i);
                if (file) newFiles.push(file.name);
            }
            const updatedList = [...(editingTemplate.attachments || []), ...newFiles];
            setEditingTemplate({...editingTemplate, attachments: updatedList});
        }
        if(attachmentInputRef.current) attachmentInputRef.current.value = '';
    };

    const removeAttachment = (fileName: string) => {
        if(editingTemplate) {
            const updated = (editingTemplate.attachments || []).filter(f => f !== fileName);
            setEditingTemplate({...editingTemplate, attachments: updated});
        }
    };

    // Insert Variable into Subject
    const insertVariableIntoSubject = (variable: string) => {
        if(!editingTemplate) return;
        setEditingTemplate({...editingTemplate, subject: (editingTemplate.subject || '') + variable});
    };

    // --- Campaign Logic ---
    const toggleRecipient = (id: string) => { const newSet = new Set(selectedRecipientIds); if (newSet.has(id)) newSet.delete(id); else newSet.add(id); setSelectedRecipientIds(newSet); };
    const toggleSelectAllVisible = () => { const visible = getFilteredRecipients(); const allSelected = visible.every(r => selectedRecipientIds.has(r.id)); const newSet = new Set(selectedRecipientIds); if (allSelected) { visible.forEach(r => newSet.delete(r.id)); } else { visible.forEach(r => newSet.add(r.id)); } setSelectedRecipientIds(newSet); };
    const toggleClientExpand = (clientId: string) => { const newSet = new Set(expandedClientIds); if (newSet.has(clientId)) newSet.delete(clientId); else newSet.add(clientId); setExpandedClientIds(newSet); };

    const prepareCampaign = () => {
        if (!selectedTemplateId) { alert("Please select a template."); return; }
        if (selectedRecipientIds.size === 0) { alert("Please select at least one recipient."); return; }
        const template = templates.find(t => t.id === selectedTemplateId);
        if(!template) return;
        const allRecipients = getAllPotentialRecipients(); 
        const selectedRecipients = allRecipients.filter(r => selectedRecipientIds.has(r.id));
        const newTasks: EmailTask[] = selectedRecipients.map(r => ({ id: Math.random().toString(36).substr(2, 9), recipientEmail: r.email, recipientName: r.name, companyName: r.companyName, status: 'pending' }));
        setTasks(newTasks);
        setSendProgress(0);
    };

    const startSending = async () => {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) return;
        setIsSending(true);
        let completed = 0;
        const activeConfig = { ...config, fromAlias: template.senderName || config.fromAlias };

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            if (task.status === 'success') { completed++; continue; }
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'sending' } : t));

            // CRITICAL: Variable Replacement for both Subject and Body
            // This ensures One-to-One personalization
            const subject = template.subject
                .replace(/{Name}/g, task.recipientName)
                .replace(/{Company}/g, task.companyName)
                .replace(/{Title}/g, "Manager"); 
            
            const body = template.body
                .replace(/{Name}/g, task.recipientName)
                .replace(/{Company}/g, task.companyName)
                .replace(/{Title}/g, "Manager");

            await new Promise(r => setTimeout(r, 500)); 
            const res = await sendSingleMail(activeConfig, task.recipientEmail, subject, body);
            
            setTasks(prev => prev.map(t => t.id === task.id ? { 
                ...t, status: res.success ? 'success' : 'failed', error: res.message, sentAt: Date.now()
            } : t));
            completed++;
            setSendProgress(Math.round((completed / tasks.length) * 100));
        }
        setIsSending(false);
        alert("Campaign Completed!");
    };

    // --- Render ---
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

            {/* Settings Tab */}
            {activeTab === 'settings' && (
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm max-w-2xl mx-auto">
                    <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"><Settings size={20}/> Aliyun Configuration</h3>
                    <div className="space-y-4">
                        <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl text-xs text-orange-800 mb-4 flex gap-2"><AlertTriangle size={16} className="shrink-0"/><div><strong>Important:</strong> Ensure 'Allow CORS' extension is ON.</div></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">AccessKey ID</label><input type="password" value={config.accessKeyId} onChange={e => setConfig({...config, accessKeyId: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="LTAI..." /></div>
                            <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">AccessKey Secret</label><input type="password" value={config.accessKeySecret} onChange={e => setConfig({...config, accessKeySecret: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="..." /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Sender Address</label><input type="text" value={config.accountName} onChange={e => setConfig({...config, accountName: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="sales@yourdomain.com" /></div>
                            <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Default Alias</label><input type="text" value={config.fromAlias} onChange={e => setConfig({...config, fromAlias: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="My Company" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Tag Name</label><input type="text" value={config.tagName} onChange={e => setConfig({...config, tagName: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="promo_2024" /></div>
                            <div><label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Region ID</label><select value={config.regionId} onChange={e => setConfig({...config, regionId: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 outline-none"><option value="cn-hangzhou">China East 1 (Hangzhou/Global)</option><option value="ap-southeast-1">Singapore</option><option value="ap-southeast-2">Sydney</option></select></div>
                        </div>
                        <div className="flex items-center gap-2 pt-2"><input type="checkbox" checked={config.replyToAddress} onChange={e => setConfig({...config, replyToAddress: e.target.checked})} className="w-5 h-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"/><label className="text-sm font-bold text-slate-700">Enable Reply-To Address</label></div>
                        <button onClick={handleSaveConfig} disabled={saveStatus === 'saving'} className={`w-full py-4 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 mt-4 text-white ${saveStatus === 'success' ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-900 hover:bg-slate-800'}`}>{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'success' ? 'Configuration Saved!' : 'Save Configuration'}</button>
                    </div>
                </div>
            )}

            {/* Templates Tab (REVAMPED EDITOR) */}
            {activeTab === 'templates' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[750px]">
                    {/* Sidebar List */}
                    <div className="md:col-span-3 flex flex-col gap-4 h-full">
                        <button onClick={() => { setEditingTemplate({ id: Date.now().toString(), name: 'New Template', subject: '', senderName: config.fromAlias, body: '<p>Dear {Name},</p><p><br/></p>', lastUpdated: Date.now() }); }} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-md"> <Plus size={18} /> Create New Template </button>
                        <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar pr-1"> 
                            {templates.map(t => ( 
                                <div key={t.id} onClick={() => setEditingTemplate(t)} className={`p-4 rounded-xl border cursor-pointer transition-all ${editingTemplate?.id === t.id ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:border-blue-300'}`}> 
                                    <h4 className="font-bold text-slate-800 text-sm truncate">{t.name}</h4> 
                                    <p className="text-xs text-slate-500 truncate mt-1">{t.subject}</p> 
                                </div> 
                            ))} 
                        </div>
                    </div>
                    
                    {/* Main Editor */}
                    <div className="md:col-span-9 h-full">
                        {editingTemplate ? (
                            <form onSubmit={handleSaveTemplate} className="bg-white rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col overflow-hidden">
                                {/* Header / Toolbar Area */}
                                <div className="bg-slate-50 border-b border-slate-200 p-4 space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="font-bold text-slate-700 flex items-center gap-2"><Layout size={18}/> 编辑模式 (Editor)</h3>
                                        <div className="flex gap-2"> 
                                            <button type="button" onClick={() => handleDeleteTemplate(editingTemplate.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg" title="Delete"><Trash2 size={18}/></button> 
                                            <button type="button" onClick={() => setEditingTemplate(null)} className="text-slate-400 hover:bg-slate-100 p-2 rounded-lg" title="Close"><X size={18}/></button> 
                                        </div>
                                    </div>

                                    {/* Email Header Fields (Like Outlook) */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-400 w-16 text-right uppercase">Template:</span>
                                            <input value={editingTemplate.name} onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})} className="flex-1 text-sm border-b border-slate-300 bg-transparent focus:border-blue-500 focus:outline-none px-2 py-1" placeholder="Template Name (Internal Use)" required />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-400 w-16 text-right uppercase">Sender:</span>
                                            <input value={editingTemplate.senderName || ''} onChange={e => setEditingTemplate({...editingTemplate, senderName: e.target.value})} className="flex-1 text-sm border-b border-slate-300 bg-transparent focus:border-blue-500 focus:outline-none px-2 py-1" placeholder={`Default: ${config.fromAlias}`} />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-400 w-16 text-right uppercase">Subject:</span>
                                            <div className="flex-1 flex gap-2 relative">
                                                <input value={editingTemplate.subject} onChange={e => setEditingTemplate({...editingTemplate, subject: e.target.value})} className="flex-1 text-sm font-bold border-b border-slate-300 bg-transparent focus:border-blue-500 focus:outline-none px-2 py-1" placeholder="Email Subject" required />
                                                <div className="absolute right-0 top-0">
                                                    <select onChange={(e) => { insertVariableIntoSubject(e.target.value); e.target.value=''; }} className="text-xs border border-blue-200 bg-blue-50 text-blue-600 rounded px-1 py-0.5 cursor-pointer outline-none">
                                                        <option value="">+ Variable</option>
                                                        <option value="{Company}">Company</option>
                                                        <option value="{Name}">Name</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        {/* Attachments Section */}
                                        <div className="flex items-start gap-2 pt-1">
                                            <div className="w-16 flex justify-end pt-1">
                                                <button type="button" onClick={() => attachmentInputRef.current?.click()} className="text-slate-400 hover:text-blue-600 transition-colors" title="Add Attachment">
                                                    <Paperclip size={16} />
                                                </button>
                                            </div>
                                            <div className="flex-1 flex flex-wrap gap-2">
                                                {(editingTemplate.attachments || []).map((file, idx) => (
                                                    <div key={idx} className="bg-slate-200 text-slate-700 text-xs px-2 py-1 rounded flex items-center gap-1 border border-slate-300">
                                                        <span className="max-w-[150px] truncate">{file}</span>
                                                        <button onClick={() => removeAttachment(file)} className="hover:text-red-500"><X size={12}/></button>
                                                    </div>
                                                ))}
                                                <span className="text-xs text-slate-400 italic py-1">
                                                    {(editingTemplate.attachments?.length || 0) === 0 ? "No attachments (Click paperclip to add)" : ""}
                                                </span>
                                                <input type="file" ref={attachmentInputRef} className="hidden" multiple onChange={handleAttachmentUpload} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Rich Text Editor Area */}
                                <div className="flex-1 flex flex-col overflow-hidden bg-white">
                                    <RichTextToolbar onCommand={execCmd} />
                                    <div 
                                        ref={editorRef} 
                                        contentEditable 
                                        className="flex-1 p-6 outline-none overflow-y-auto text-sm text-slate-800 leading-relaxed" 
                                        style={{ fontFamily: 'Arial, sans-serif' }}
                                    />
                                </div>

                                {/* Footer Actions */}
                                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">
                                        Use <strong>{'{Name}'}, {'{Company}'}</strong> for dynamic replacement.
                                    </span>
                                    <div className="flex gap-3">
                                        <button type="button" onClick={() => setEditingTemplate(null)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100">Cancel</button> 
                                        <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow-md flex items-center gap-2"><Save size={16}/> Save Template</button> 
                                    </div>
                                </div>
                            </form>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50"> <Layout size={48} className="mb-4 text-slate-300" /> <p className="font-medium">Select a template to edit or create a new one.</p> </div>
                        )}
                    </div>
                </div>
            )}

            {/* Campaign Tab (No Changes needed here, kept for context) */}
            {activeTab === 'campaign' && (
                <div className="space-y-6">
                    {/* ... (Campaign selection Logic remains same) ... */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[600px] flex flex-col">
                             <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                                 <div><h3 className="font-bold text-slate-800 flex items-center gap-2"><Users size={18}/> 1. Select Recipients</h3><p className="text-xs text-slate-400">Total: {crmClients.length}</p></div>
                                 <div className="flex gap-2 items-center">
                                     <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="text-xs border border-slate-200 rounded p-1 font-bold outline-none"><option value="All">All Roles</option><option value="CEO">CEOs Only</option><option value="Buyer">Buyers Only</option></select>
                                     <button onClick={toggleSelectAllVisible} className="text-xs bg-slate-100 px-2 py-1 rounded">Toggle All</button>
                                     <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded-lg">{selectedRecipientIds.size}</span>
                                 </div>
                             </div>
                             <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-100 rounded-xl bg-slate-50/50">
                                 {crmClients.length === 0 ? <div className="p-10 text-center text-slate-400">No clients.</div> : 
                                     <div className="p-2 space-y-1">
                                         {crmClients.map(client => {
                                             let contactsToShow = client.contacts || [];
                                             if (roleFilter !== 'All') contactsToShow = contactsToShow.filter(c => c.type === roleFilter);
                                             const hasGeneric = (client.website?.includes('@')) || (client.activityLog?.includes('Email:'));
                                             const showGeneric = roleFilter === 'All' && (!client.contacts?.length) && hasGeneric;
                                             if (!contactsToShow.length && !showGeneric) return null;
                                             return (
                                                 <div key={client.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                                     <div className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 cursor-pointer" onClick={() => toggleClientExpand(client.id)}>
                                                         <div className="flex items-center gap-2">{expandedClientIds.has(client.id) ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}<span className="font-bold text-sm text-slate-800">{client.name}</span></div>
                                                     </div>
                                                     {expandedClientIds.has(client.id) && (
                                                         <div className="p-2 space-y-1 bg-white border-t border-slate-100">
                                                             {contactsToShow.map((c, idx) => (
                                                                 <div key={idx} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-blue-50 ${selectedRecipientIds.has(`${client.id}_c_${idx}`) ? 'bg-blue-50 border border-blue-100' : ''}`} onClick={() => toggleRecipient(`${client.id}_c_${idx}`)}>
                                                                     <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selectedRecipientIds.has(`${client.id}_c_${idx}`) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>{selectedRecipientIds.has(`${client.id}_c_${idx}`) && <CheckCircle2 size={12}/>}</div>
                                                                     <div className="overflow-hidden"><div className="flex items-center gap-2"><span className="text-sm font-bold text-slate-700">{c.name}</span><span className="text-[10px] px-1 bg-slate-100 rounded">{c.type}</span></div><div className="text-xs text-slate-400">{c.emailGuess}</div></div>
                                                                 </div>
                                                             ))}
                                                             {showGeneric && <div className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-blue-50 ${selectedRecipientIds.has(`${client.id}_generic`) ? 'bg-blue-50 border border-blue-100' : ''}`} onClick={() => toggleRecipient(`${client.id}_generic`)}><div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selectedRecipientIds.has(`${client.id}_generic`) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>{selectedRecipientIds.has(`${client.id}_generic`) && <CheckCircle2 size={12}/>}</div><div><div className="text-sm font-bold text-slate-600 italic">Generic Info</div><div className="text-xs text-slate-400">{client.website}</div></div></div>}
                                                         </div>
                                                     )}
                                                 </div>
                                             );
                                         })}
                                     </div>
                                 }
                             </div>
                         </div>
                         <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[600px] flex flex-col">
                             <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><Layout size={18}/> 2. Select Template</h3>
                             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                                 {templates.map(t => (
                                     <div key={t.id} onClick={() => setSelectedTemplateId(t.id)} className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedTemplateId === t.id ? 'bg-orange-50 border-orange-500 ring-1 ring-orange-500' : 'bg-slate-50 border-slate-200 hover:border-orange-300'}`}>
                                         <div className="flex justify-between"><h4 className="font-bold text-slate-800 text-sm truncate">{t.name}</h4>{selectedTemplateId === t.id && <CheckCircle2 size={16} className="text-orange-500"/>}</div>
                                         <p className="text-xs text-slate-500 truncate mt-1">{t.subject}</p>
                                     </div>
                                 ))}
                             </div>
                         </div>
                    </div>
                    <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl flex items-center justify-between">
                        <div><h3 className="text-lg font-bold">Ready to Launch?</h3><p className="text-slate-400 text-sm">Selected {selectedRecipientIds.size} recipients.</p></div>
                        <button onClick={prepareCampaign} className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-colors"><RefreshCw size={18}/> Generate Send List</button>
                    </div>
                    {tasks.length > 0 && (
                        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm animate-fade-in">
                            <div className="flex justify-between items-center mb-6"><h3 className="font-bold text-slate-800 text-lg flex items-center gap-2"><Send size={20}/> Sending Queue</h3><div className="flex items-center gap-4">{isSending && <div className="flex items-center gap-2 text-sm font-bold text-orange-600"><Loader2 className="animate-spin" size={16}/> Sending... {sendProgress}%</div>}<button onClick={startSending} disabled={isSending} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 shadow-md disabled:opacity-50"><PlayCircle size={18}/> Start Campaign</button></div></div>
                            <div className="overflow-hidden border border-slate-200 rounded-xl max-h-[400px] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs sticky top-0"><tr><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Info</th></tr></thead>
                                    <tbody className="divide-y divide-slate-100">{tasks.map(t => (<tr key={t.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-bold text-slate-800">{t.companyName}<div className="text-xs text-slate-400 font-normal">{t.recipientName}</div></td><td className="px-4 py-3 text-slate-600 font-mono text-xs">{t.recipientEmail}</td><td className="px-4 py-3">{t.status === 'pending' && <span className="text-slate-400">Waiting</span>}{t.status === 'sending' && <span className="text-orange-500 font-bold">Sending...</span>}{t.status === 'success' && <span className="text-green-600 font-bold flex items-center gap-1"><CheckCircle2 size={12}/> Sent</span>}{t.status === 'failed' && <span className="text-red-500 font-bold flex items-center gap-1"><AlertTriangle size={12}/> Failed</span>}</td><td className="px-4 py-3 text-right text-xs text-slate-400">{t.error ? <span className="text-red-500 max-w-[200px] truncate block ml-auto" title={t.error}>{t.error}</span> : '-'}</td></tr>))}</tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
