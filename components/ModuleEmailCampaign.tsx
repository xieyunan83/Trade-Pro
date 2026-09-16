import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Client, EmailTask, EmailTemplate, AliyunConfig, User, Department } from '../types';
import {
  Mail,
  Send,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Settings,
  FileText,
  Layout,
  Users,
  Clock,
  X,
  Briefcase,
} from 'lucide-react';
import {
  loadEmailCampaignStoreForUser,
  saveEmailCampaignStoreForUser,
} from '../services/emailCampaignStore';
import { isDirectMailConfigured, sendDirectMail } from '../services/directMailService';
import { filterOwnedRecords } from '../services/permissions';

interface ModuleEmailCampaignProps {
  crmClients: Client[];
  onAddClients: (newClients: Client[]) => void;
  /** 真实发送成功后回写 CRM lastContactSent + 活动日志 */
  onEmailsSent?: (payload: {
    companyName: string;
    clientId?: string;
    to: string;
    subject: string;
  }[]) => void;
  currentUser: User;
  users: User[];
  departments: Department[];
}

export const ModuleEmailCampaign: React.FC<ModuleEmailCampaignProps> = ({
  crmClients,
  onEmailsSent,
  currentUser,
  users,
  departments,
}) => {
  // CRM 再过滤一层，防止上游漏传未隔离数据
  const visibleCrmClients = useMemo(
    () => filterOwnedRecords(currentUser, crmClients, users, departments),
    [crmClients, currentUser, users, departments]
  );

  // 用完整 crmClients 做归属回填，再用权限过滤可见集
  const initial = useMemo(
    () => loadEmailCampaignStoreForUser(currentUser, users, departments, crmClients),
    // 仅登录用户变化时重载；避免 CRM 列表抖动清空编辑中任务
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser.username, currentUser.role, currentUser.departmentId]
  );

  const [tasks, setTasks] = useState<EmailTask[]>(initial.tasks);
  const [templates, setTemplates] = useState<EmailTemplate[]>(initial.templates);
  const [config, setConfig] = useState<AliyunConfig | null>(initial.config);
  const [activeTab, setActiveTab] = useState<'tasks' | 'templates' | 'config'>('tasks');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'Buyer' | 'CEO' | 'Other'>('all');
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState<EmailTemplate>({
    id: '',
    name: '',
    subject: '',
    body: '',
    lastUpdated: Date.now(),
  });
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [manualForm, setManualForm] = useState({
    recipientEmail: '',
    recipientName: '',
    recipientTitle: '',
    companyName: '',
    clientId: '',
  });
  const quillRef = useRef<ReactQuill>(null);
  /** 切换用户后跳过一次保存，避免用上一用户的 state 写穿 */
  const skipNextSaveRef = useRef(false);

  const macros = ['{{company_name}}', '{{contact_name}}'];
  const dmReady = isDirectMailConfigured(config);

  const stampOwnership = useCallback(
    <T extends { ownerUsername?: string; departmentId?: string }>(item: T): T => ({
      ...item,
      ownerUsername: (item.ownerUsername || '').trim() || currentUser.username,
      departmentId: (item.departmentId || '').trim() || currentUser.departmentId,
    }),
    [currentUser.username, currentUser.departmentId]
  );

  // 切换登录用户时重载可见数据
  useEffect(() => {
    skipNextSaveRef.current = true;
    const next = loadEmailCampaignStoreForUser(
      currentUser,
      users,
      departments,
      crmClients
    );
    setTasks(next.tasks);
    setTemplates(next.templates);
    setConfig(next.config);
    setSelectedTaskIds(new Set());
    setSendMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.username, currentUser.role, currentUser.departmentId]);

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    saveEmailCampaignStoreForUser(
      currentUser,
      users,
      departments,
      { tasks, templates, config },
      crmClients
    );
  }, [tasks, templates, config, currentUser, users, departments, crmClients]);

  const contactMatchesRole = (contact: { type?: string; title?: string; emailGuess?: string }) => {
    if (!contact.emailGuess?.includes('@')) return false;
    if (roleFilter === 'all') return true;
    if (roleFilter === 'Buyer') {
      return (
        contact.type === 'Buyer' ||
        /buyer|procurement|purchasing|sourcing|category|merchandis|采购|买手|供应链/i.test(
          contact.title || ''
        )
      );
    }
    if (roleFilter === 'CEO') {
      return contact.type === 'CEO' || /ceo|founder|owner|president|总经理|创始/i.test(contact.title || '');
    }
    return (
      contact.type === 'Other' ||
      (!contact.type && !/buyer|ceo|procurement|purchasing/i.test(contact.title || ''))
    );
  };

  const importableContacts = useMemo(() => {
    const rows: Array<{ client: Client; contact: NonNullable<Client['contacts']>[number] }> = [];
    for (const client of visibleCrmClients) {
      for (const contact of client.contacts || []) {
        if (contactMatchesRole(contact)) rows.push({ client, contact });
      }
    }
    return rows;
  }, [visibleCrmClients, roleFilter]);

  const importFromCrmByRole = () => {
    if (!importableContacts.length) {
      alert('当前岗位筛选下没有带邮箱的联系人，请先在决策人挖掘中搜索并保存到 CRM。');
      return;
    }
    const existing = new Set(tasks.map((t) => t.recipientEmail.toLowerCase()));
    const newTasks: EmailTask[] = [];
    for (const { client, contact } of importableContacts) {
      const email = (contact.emailGuess || '').trim();
      if (!email || existing.has(email.toLowerCase())) continue;
      existing.add(email.toLowerCase());
      newTasks.push(
        stampOwnership({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          recipientName:
            contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '',
          recipientEmail: email,
          recipientTitle: contact.title || contact.type || '',
          companyName: client.name || '',
          clientId: client.id,
          status: 'pending' as const,
          sentAt: undefined,
          // 任务归属跟 CRM 客户一致，便于主管看本部门
          ownerUsername: client.ownerUsername || currentUser.username,
          departmentId: client.departmentId || currentUser.departmentId,
        })
      );
    }
    if (!newTasks.length) {
      alert('没有新增收件人（可能已全部在列表中）');
      return;
    }
    setTasks((prev) => [...prev, ...newTasks]);
    alert(`已按岗位导入 ${newTasks.length} 位收件人`);
  };

  const addManualRecipient = () => {
    const email = manualForm.recipientEmail.trim();
    if (!email.includes('@')) {
      alert('请填写有效的收件人邮箱');
      return;
    }
    if (tasks.some((t) => t.recipientEmail.toLowerCase() === email.toLowerCase())) {
      alert('该邮箱已在待发送列表中');
      return;
    }
    const linked = manualForm.clientId
      ? visibleCrmClients.find((c) => c.id === manualForm.clientId)
      : undefined;
    const task = stampOwnership({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      recipientEmail: email,
      recipientName: manualForm.recipientName.trim() || email.split('@')[0],
      recipientTitle: manualForm.recipientTitle.trim() || '',
      companyName: manualForm.companyName.trim() || linked?.name || '',
      clientId: linked?.id || manualForm.clientId || undefined,
      status: 'pending' as const,
      ownerUsername: linked?.ownerUsername || currentUser.username,
      departmentId: linked?.departmentId || currentUser.departmentId,
    });
    setTasks((prev) => [task, ...prev]);
    setManualForm({
      recipientEmail: '',
      recipientName: '',
      recipientTitle: '',
      companyName: '',
      clientId: '',
    });
    setSendMsg(`已手动添加：${task.recipientEmail}`);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setSelectedTaskIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const insertMacroToSubject = (macro: string) => {
    setNewTemplate((prev) => ({ ...prev, subject: prev.subject + macro }));
  };

  const insertMacroToBody = (macro: string) => {
    const quill = quillRef.current?.getEditor();
    if (quill) {
      const range = quill.getSelection(true);
      quill.insertText(range.index, macro);
    }
  };

  const insertImageToBody = useCallback(() => {
    const url = prompt('请输入图片链接:');
    if (url) {
      const quill = quillRef.current?.getEditor();
      if (quill) {
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, 'image', url);
      }
    }
  }, []);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, false] }],
          ['bold', 'italic', 'underline', 'strike', 'blockquote'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
          ['link', 'image'],
          ['clean'],
        ],
        handlers: { image: insertImageToBody },
      },
    }),
    [insertImageToBody]
  );

  const [configInput, setConfigInput] = useState<AliyunConfig>({
    accessKeyId: config?.accessKeyId || '',
    accessKeySecret: config?.accessKeySecret || '',
    accountName: config?.accountName || '',
    fromAlias: config?.fromAlias || '',
    replyToAddress: config?.replyToAddress || false,
    addressType: config?.addressType || 1,
    tagName: config?.tagName || '',
    regionId: config?.regionId || 'cn-hangzhou',
  });

  const onSaveConfig = (newConfig: AliyunConfig) => {
    setConfig(newConfig);
    alert('配置已保存到本机（刷新不丢失）。生产环境建议改用服务端 ALIYUN_DM_* 环境变量。');
  };

  const onSaveTemplate = () => {
      setTemplates([
        ...templates,
        stampOwnership({
          ...newTemplate,
          id: Date.now().toString(),
          lastUpdated: Date.now(),
        }),
      ]);
      setIsCreatingTemplate(false);
      setNewTemplate({ id: '', name: '', subject: '', body: '', lastUpdated: Date.now() });
  };
  const onDeleteTemplate = (id: string) => setTemplates(templates.filter((t) => t.id !== id));

  const processTemplateForTask = (template: EmailTemplate, task: EmailTask) => {
    const replacements: Record<string, string> = {
      '{{company_name}}': task.companyName || '',
      '{{contact_name}}': task.recipientName || '',
    };
    let subject = template.subject;
    let body = template.body;
    Object.keys(replacements).forEach((key) => {
      subject = subject.replace(new RegExp(key, 'g'), replacements[key]);
      body = body.replace(new RegExp(key, 'g'), replacements[key]);
    });
    return { subject, body };
  };

  const onSendBatch = async (taskIds: string[], templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      alert('请选择模板');
      return;
    }
    if (!dmReady || !config) {
      alert('请先在「接口配置」填写完整的阿里云 DirectMail 参数后再发送。');
      setActiveTab('config');
      return;
    }

    const targets = tasks.filter((t) => taskIds.includes(t.id) && t.status !== 'success');
    if (!targets.length) {
      alert('没有可发送的任务（已成功的不会重复发送）');
      return;
    }

    if (
      !confirm(
        `将通过阿里云 DirectMail 真实发送 ${targets.length} 封邮件。\n仅成功投递后会回写 CRM「最近发信」。\n确认继续？`
      )
    ) {
      return;
    }

    setSending(true);
    setSendMsg('');
    const crmWrites: Array<{ companyName: string; clientId?: string; to: string; subject: string }> =
      [];
    let okCount = 0;
    let failCount = 0;

    for (const task of targets) {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'sending', error: undefined } : t))
      );
      const { subject, body } = processTemplateForTask(template, task);
      const result = await sendDirectMail({
        config,
        toAddress: task.recipientEmail,
        subject,
        htmlBody: body,
        fromAlias: template.senderName || config.fromAlias,
      });
      if (result.ok) {
        okCount += 1;
        crmWrites.push({
          companyName: task.companyName,
          clientId: task.clientId,
          to: task.recipientEmail,
          subject,
        });
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  status: 'success',
                  sentAt: Date.now(),
                  requestId: result.requestId,
                  error: undefined,
                }
              : t
          )
        );
      } else {
        failCount += 1;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, status: 'failed', error: result.error || '发送失败' }
              : t
          )
        );
      }
      // 轻微间隔，降低限流
      await new Promise((r) => setTimeout(r, 400));
    }

    if (crmWrites.length && onEmailsSent) onEmailsSent(crmWrites);
    setSendMsg(`完成：成功 ${okCount}，失败 ${failCount}`);
    setSending(false);
    setSelectedTaskIds(new Set());
  };

  const toggleTask = (id: string) => {
    const next = new Set(selectedTaskIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTaskIds(next);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
        数据隔离：员工仅见自己导入/添加的收件人；主管仅见本部门；跨部门不可见。CRM 导入范围与客户管理一致。
      </div>

      <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm w-full sm:w-fit overflow-x-auto">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 touch-manipulation ${activeTab === 'tasks' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Users size={16} /> 发送任务
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 touch-manipulation ${activeTab === 'templates' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Layout size={16} /> 邮件模板
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 touch-manipulation ${activeTab === 'config' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Settings size={16} /> 接口配置 {dmReady ? '✓' : ''}
        </button>
      </div>

      {activeTab === 'tasks' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 w-full lg:w-auto">
                <h3 className="text-base sm:text-lg font-black text-slate-800">
                  待发送列表 ({tasks.length})
                </h3>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">选择发送模板...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                disabled={
                  sending || selectedTaskIds.size === 0 || !selectedTemplateId || !dmReady
                }
                onClick={() => onSendBatch(Array.from(selectedTaskIds), selectedTemplateId)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 sm:px-8 py-3 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 w-full lg:w-auto touch-manipulation"
                title={!dmReady ? '请先完成接口配置' : undefined}
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                {sending ? '发送中…' : `真实群发 (${selectedTaskIds.size})`}
              </button>
            </div>
            {!dmReady && (
              <p className="text-xs font-bold text-rose-600">
                DirectMail 未配置：请到「接口配置」填写 AccessKey 与发信地址。未配置时不会发送任何邮件。
              </p>
            )}
            {sendMsg && <p className="text-xs font-bold text-emerald-700">{sendMsg}</p>}

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-800">
                <Plus size={16} /> 手动添加收件人
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <input
                  value={manualForm.recipientEmail}
                  onChange={(e) => setManualForm((f) => ({ ...f, recipientEmail: e.target.value }))}
                  placeholder="邮箱 *（必填）"
                  className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                />
                <input
                  value={manualForm.recipientName}
                  onChange={(e) => setManualForm((f) => ({ ...f, recipientName: e.target.value }))}
                  placeholder="姓名"
                  className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                />
                <input
                  value={manualForm.recipientTitle}
                  onChange={(e) => setManualForm((f) => ({ ...f, recipientTitle: e.target.value }))}
                  placeholder="岗位"
                  className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                />
                <input
                  value={manualForm.companyName}
                  onChange={(e) => setManualForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="公司名"
                  className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                />
                <select
                  value={manualForm.clientId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const c = visibleCrmClients.find((x) => x.id === id);
                    setManualForm((f) => ({
                      ...f,
                      clientId: id,
                      companyName: f.companyName || c?.name || '',
                    }));
                  }}
                  className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                >
                  <option value="">关联 CRM 客户（可选，仅你可见范围内）</option>
                  {visibleCrmClients.slice(0, 300).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addManualRecipient}
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-black"
                >
                  <Plus size={16} /> 加入待发送
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-black text-violet-800">
                <Briefcase size={16} /> 按岗位从 CRM 导入收件人
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
                  className="w-full sm:w-56 px-4 py-2.5 rounded-xl border border-violet-200 bg-white text-sm font-bold"
                >
                  <option value="all">全部岗位（有邮箱）</option>
                  <option value="Buyer">采购相关</option>
                  <option value="CEO">CEO / 老板</option>
                  <option value="Other">其他岗位</option>
                </select>
                <span className="text-xs font-bold text-violet-600">
                  可导入 {importableContacts.length} 人
                </span>
                <button
                  type="button"
                  onClick={importFromCrmByRole}
                  className="sm:ml-auto inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-xl text-sm font-black"
                >
                  <Plus size={16} /> 按岗位导入
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="px-6 py-4 w-12">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
                        else setSelectedTaskIds(new Set());
                      }}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-6 py-4">收件人信息</th>
                  <th className="px-6 py-4">岗位</th>
                  <th className="px-6 py-4">所属公司</th>
                  <th className="px-6 py-4">状态</th>
                  <th className="px-6 py-4">发送时间</th>
                  <th className="px-6 py-4 w-16">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400 font-bold">
                      暂无发送任务，可手动添加或从 CRM 导入
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => (
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
                        <div className="text-[10px] text-slate-400 font-bold">
                          {task.recipientEmail}
                        </div>
                        {task.error && (
                          <div className="text-[10px] text-rose-500 font-bold mt-1">{task.error}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold text-slate-600">
                          {task.recipientTitle || '—'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-600">{task.companyName}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                            task.status === 'success'
                              ? 'bg-green-100 text-green-600'
                              : task.status === 'failed'
                                ? 'bg-red-100 text-red-600'
                                : task.status === 'sending'
                                  ? 'bg-blue-100 text-blue-600'
                                  : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {task.status === 'sending' ? (
                            <Loader2 className="animate-spin" size={10} />
                          ) : null}
                          {task.status === 'success' ? <CheckCircle2 size={10} /> : null}
                          {task.status === 'failed' ? <AlertTriangle size={10} /> : null}
                          {task.status === 'pending' ? <Clock size={10} /> : null}
                          {task.status}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold text-slate-400">
                          {task.sentAt ? new Date(task.sentAt).toLocaleString() : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => removeTask(task.id)}
                          className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                          title="移除"
                        >
                          <Trash2 size={16} />
                        </button>
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
          <div
            onClick={() => {
              setNewTemplate({ id: '', name: '', subject: '', body: '', lastUpdated: Date.now() });
              setIsCreatingTemplate(true);
            }}
            className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center border-dashed cursor-pointer hover:bg-slate-50 transition-all min-h-[200px]"
          >
            <div className="bg-blue-50 p-4 rounded-2xl text-blue-600 mb-4">
              <Plus size={32} />
            </div>
            <h4 className="text-lg font-black text-slate-800">创建新模板</h4>
            <p className="text-slate-400 font-bold text-sm">手动编写，支持宏变量</p>
          </div>
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm hover:border-blue-200 transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-400">
                  <FileText size={24} />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"
                    onClick={() => {
                      setNewTemplate(template);
                      setIsCreatingTemplate(true);
                      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
                    }}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => onDeleteTemplate(template.id)}
                    className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <h4 className="text-xl font-black text-slate-800 mb-2">{template.name}</h4>
              <div className="text-xs font-bold text-slate-400 mb-4 truncate">
                主题: {template.subject}
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 h-32 overflow-hidden relative">
                <div
                  className="text-xs text-slate-500 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: template.body }}
                ></div>
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-slate-50 to-transparent"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isCreatingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl animate-fade-in p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-black text-slate-800">编辑邮件模板</h3>
              <button onClick={() => setIsCreatingTemplate(false)}>
                <X size={24} className="text-slate-400" />
              </button>
            </div>
            <div className="space-y-6">
              <input
                type="text"
                placeholder="模板名称"
                value={newTemplate.name || ''}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                className="w-full p-3 border rounded-xl font-bold"
              />

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  邮件主题
                </label>
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    placeholder="邮件主题"
                    value={newTemplate.subject || ''}
                    onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                    className="flex-1 min-w-[200px] p-3 border rounded-xl font-bold"
                  />
                  {macros.map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => insertMacroToSubject(m)}
                      className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold hover:bg-slate-200"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  邮件正文
                </label>
                <div className="flex gap-2 mb-2 flex-wrap">
                  {macros.map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => insertMacroToBody(m)}
                      className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold hover:bg-slate-200"
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <ReactQuill
                  ref={quillRef}
                  theme="snow"
                  modules={modules}
                  value={newTemplate.body || ''}
                  onChange={(body) => setNewTemplate({ ...newTemplate, body })}
                  className="h-64 mb-12"
                />
              </div>

              <button
                onClick={onSaveTemplate}
                className="w-full bg-blue-600 text-white py-4 rounded-xl font-black shadow-lg hover:bg-blue-700"
              >
                保存模板
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm max-w-2xl mx-auto">
          <h3 className="text-2xl font-black text-slate-800 mb-4 flex items-center gap-2">
            <Settings className="text-blue-600" /> 阿里云邮件推送配置
          </h3>
          <p className="text-xs text-slate-500 font-medium mb-6">
            已自动读取 <code className="bg-slate-100 px-1 rounded">.env.local</code> 中的
            REACT_APP_ALIYUN_EMAIL_*（若已填写）。本地开发经{' '}
            <code className="bg-slate-100 px-1 rounded">/api/directmail</code> 发送，无需再配 Vercel。
          </p>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                  AccessKey ID
                </label>
                <input
                  type="text"
                  value={configInput.accessKeyId}
                  onChange={(e) => setConfigInput({ ...configInput, accessKeyId: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                  AccessKey Secret
                </label>
                <input
                  type="password"
                  value={configInput.accessKeySecret}
                  onChange={(e) =>
                    setConfigInput({ ...configInput, accessKeySecret: e.target.value })
                  }
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                发信地址 (Account Name)
              </label>
              <input
                type="text"
                value={configInput.accountName}
                onChange={(e) => setConfigInput({ ...configInput, accountName: e.target.value })}
                placeholder="offer@service.example.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                发信人别名 (Sender Alias)
              </label>
              <input
                type="text"
                value={configInput.fromAlias}
                onChange={(e) => setConfigInput({ ...configInput, fromAlias: e.target.value })}
                placeholder="Kevin from TradeScout"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                  Region ID
                </label>
                <input
                  type="text"
                  value={configInput.regionId}
                  onChange={(e) => setConfigInput({ ...configInput, regionId: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                  Tag Name
                </label>
                <input
                  type="text"
                  value={configInput.tagName}
                  onChange={(e) => setConfigInput({ ...configInput, tagName: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>
            </div>
            <button
              onClick={() => onSaveConfig(configInput)}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-black shadow-lg hover:bg-blue-600 transition-all"
            >
              保存配置
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
