
import React, { useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Client, EmailTask, EmailTemplate, AliyunConfig } from '../types';
import { Mail, Send, Plus, Trash2, Edit2, CheckCircle2, AlertTriangle, Loader2, Settings, FileText, Layout, Users, Clock, X } from 'lucide-react';

interface ModuleEmailCampaignProps {
  crmClients: Client[];
  onAddClients: (newClients: Client[]) => void;
}

export const ModuleEmailCampaign: React.FC<ModuleEmailCampaignProps> = ({ 
  crmClients, 
  onAddClients
}) => {
  const [tasks, setTasks] = useState<EmailTask[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [config, setConfig] = useState<AliyunConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'tasks' | 'templates' | 'config'>('tasks');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState<EmailTemplate>({ id: '', name: '', subject: '', body: '', lastUpdated: Date.now() });
  
  const addClientsToTasks = (clients: Client[]) => {
    const newTasks: EmailTask[] = clients.map(client => ({
      id: Date.now().toString() + client.id,
      recipientName: client.contacts && client.contacts.length > 0 ? client.contacts[0].name : '',
      recipientEmail: client.contacts && client.contacts.length > 0 ? client.contacts[0].emailGuess || '' : '',
      companyName: client.name || '',
      status: 'pending',
      sentAt: null
    }));
    setTasks([...tasks, ...newTasks]);
  };

  const onSaveConfig = (config: AliyunConfig) => setConfig(config);
  const onSaveTemplate = () => {
      setTemplates([...templates, { ...newTemplate, id: Date.now().toString(), lastUpdated: Date.now() }]);
      setIsCreatingTemplate(false);
      setNewTemplate({ id: '', name: '', subject: '', body: '', lastUpdated: Date.now() });
  };
  const onDeleteTemplate = (id: string) => setTemplates(templates.filter(t => t.id !== id));
  const processTemplate = (template: EmailTemplate, client: Client) => {
    const contact = client.contacts && client.contacts.length > 0 ? client.contacts[0] : { name: '', emailGuess: '' };
    const replacements: { [key: string]: string } = {
      '{{company_name}}': client.name || '',
      '{{contact_name}}': contact.name || '',
    };
    
    let subject = template.subject;
    let body = template.body;
    
    Object.keys(replacements).forEach(key => {
      subject = subject.replace(new RegExp(key, 'g'), replacements[key]);
      body = body.replace(new RegExp(key, 'g'), replacements[key]);
    });
    
    return { subject, body };
  };

  const onSendBatch = (taskIds: string[], templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    
    const selectedClients = crmClients.filter(c => taskIds.includes(c.id));
    
    selectedClients.forEach(client => {
      const { subject, body } = processTemplate(template, client);
      const contact = client.contacts && client.contacts.length > 0 ? client.contacts[0] : { emailGuess: '' };
      console.log(`Sending email to ${contact.emailGuess}: ${subject}`);
      // Integrate AliCloud sending logic here
    });
    
    alert(`Sending batch to ${selectedClients.length} recipients using template ${template.name}`);
  };

  const toggleTask = (id: string) => {
    const next = new Set(selectedTaskIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTaskIds(next);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
      <div className="flex gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm w-fit">
        <button 
          onClick={() => setActiveTab('tasks')}
          className={`px-6 py-2 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${activeTab === 'tasks' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Users size={16} /> 发送任务
        </button>
        <button 
          onClick={() => setActiveTab('templates')}
          className={`px-6 py-2 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${activeTab === 'templates' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Layout size={16} /> 邮件模板
        </button>
        <button 
          onClick={() => setActiveTab('config')}
          className={`px-6 py-2 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${activeTab === 'config' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Settings size={16} /> 接口配置
        </button>
      </div>

      {activeTab === 'tasks' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-black text-slate-800">待发送列表 ({tasks.length})</h3>
              <select 
                value={selectedTemplateId} 
                onChange={e => setSelectedTemplateId(e.target.value)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">选择发送模板...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button 
              disabled={selectedTaskIds.size === 0 || !selectedTemplateId || !config}
              onClick={() => onSendBatch(Array.from(selectedTaskIds), selectedTemplateId)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-black shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Send size={18} /> 立即群发 ({selectedTaskIds.size})
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="px-6 py-4 w-12">
                    <input 
                      type="checkbox" 
                      onChange={e => {
                        if (e.target.checked) setSelectedTaskIds(new Set(tasks.map(t => t.id)));
                        else setSelectedTaskIds(new Set());
                      }}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-6 py-4">收件人信息</th>
                  <th className="px-6 py-4">所属公司</th>
                  <th className="px-6 py-4">状态</th>
                  <th className="px-6 py-4">发送时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-bold">暂无发送任务</td>
                  </tr>
                ) : (
                  tasks.map(task => (
                    <tr key={task.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <input 
                          type="checkbox" 
                          checked={selectedTaskIds.has(task.id)}
                          onChange={() => toggleTask(task.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-800">{task.recipientName}</div>
                        <div className="text-[10px] text-slate-400 font-bold">{task.recipientEmail}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-600">{task.companyName}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                          task.status === 'success' ? 'bg-green-100 text-green-600' :
                          task.status === 'failed' ? 'bg-red-100 text-red-600' :
                          task.status === 'sending' ? 'bg-blue-100 text-blue-600' :
                          'bg-slate-100 text-slate-400'
                        }`}>
                          {task.status === 'sending' ? <Loader2 className="animate-spin" size={10}/> : null}
                          {task.status === 'success' ? <CheckCircle2 size={10}/> : null}
                          {task.status === 'failed' ? <AlertTriangle size={10}/> : null}
                          {task.status === 'pending' ? <Clock size={10}/> : null}
                          {task.status}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold text-slate-400">
                          {task.sentAt ? new Date(task.sentAt).toLocaleString() : '-'}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div onClick={() => setIsCreatingTemplate(true)} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center border-dashed cursor-pointer hover:bg-slate-50 transition-all min-h-[200px]">
            <div className="bg-blue-50 p-4 rounded-2xl text-blue-600 mb-4">
              <Plus size={32} />
            </div>
            <h4 className="text-lg font-black text-slate-800">创建新模板</h4>
            <p className="text-slate-400 font-bold text-sm">使用 AI 或手动编写邮件模板</p>
          </div>
          {templates.map(template => (
            <div key={template.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm hover:border-blue-200 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-400">
                  <FileText size={24} />
                </div>
                <div className="flex gap-2">
                  <button className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"><Edit2 size={16} /></button>
                  <button onClick={() => onDeleteTemplate(template.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
                </div>
              </div>
              <h4 className="text-xl font-black text-slate-800 mb-2">{template.name}</h4>
              <div className="text-xs font-bold text-slate-400 mb-4 truncate">主题: {template.subject}</div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 h-32 overflow-hidden relative">
                <div className="text-xs text-slate-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: template.body }}></div>
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-slate-50 to-transparent"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isCreatingTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl animate-fade-in p-8">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-2xl font-black text-slate-800">创建邮件模板</h3>
                      <button onClick={() => setIsCreatingTemplate(false)}><X size={24} className="text-slate-400"/></button>
                  </div>
                  <div className="space-y-4">
                      <input type="text" placeholder="模板名称" value={newTemplate.name} onChange={e => setNewTemplate({...newTemplate, name: e.target.value})} className="w-full p-3 border rounded-xl font-bold" />
                      <input type="text" placeholder="邮件主题 (支持宏: {{company_name}}, {{contact_name}})" value={newTemplate.subject} onChange={e => setNewTemplate({...newTemplate, subject: e.target.value})} className="w-full p-3 border rounded-xl font-bold" />
                      <ReactQuill theme="snow" value={newTemplate.body} onChange={body => setNewTemplate({...newTemplate, body})} className="h-64 mb-12" />
                      <button onClick={onSaveTemplate} className="w-full bg-blue-600 text-white py-4 rounded-xl font-black shadow-lg hover:bg-blue-700">保存模板</button>
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'config' && (
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm max-w-2xl mx-auto">
          <h3 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-2">
            <Settings className="text-blue-600" /> 阿里云邮件推送配置
          </h3>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">AccessKey ID</label>
                <input 
                  type="text" 
                  defaultValue={config?.accessKeyId}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">AccessKey Secret</label>
                <input 
                  type="password" 
                  defaultValue={config?.accessKeySecret}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">发信地址 (Account Name)</label>
              <input 
                type="text" 
                defaultValue={config?.accountName}
                placeholder="offer@service.example.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">发信人别名 (Sender Alias)</label>
              <input 
                type="text" 
                defaultValue={config?.fromAlias}
                placeholder="Kevin from TradeScout"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
              />
            </div>
            <button className="w-full bg-slate-900 text-white py-4 rounded-xl font-black shadow-lg hover:bg-blue-600 transition-all">
              保存配置 (Save Configuration)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
