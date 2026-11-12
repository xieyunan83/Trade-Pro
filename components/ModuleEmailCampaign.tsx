import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  Suspense,
  lazy,
} from 'react';
import { Client, EmailTask, EmailTemplate, AliyunConfig, User, Department } from '../types';

/** 编辑器 JS 按需加载：打开邮件营销主界面不再等 quill 大包（样式随编辑器一并注入） */
const ReactQuill = lazy(async () => {
  // @ts-expect-error Vite 动态 CSS，无专用类型声明
  await import('react-quill/dist/quill.snow.css');
  const mod = await import('react-quill');
  return { default: mod.default };
});
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
import {
  loadStrategyMailDraft,
  loadStrategyMailDraftHistory,
} from '../services/strategyMailDraftStore';
import {
  consumeGtmOutreachHandoff,
  emailTasksFromGtmOutreach,
  GTM_OUTREACH_EVENT,
  templatesFromGtmOutreach,
  type GtmOutreachHandoff,
} from '../services/gtmOutreachBridge';
import { useCrmClients } from '../services/crmStoreHooks';

interface ModuleEmailCampaignProps {
  /** @deprecated 改订 crmStore */
  crmClients?: Client[];
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
  crmClients: _crmProp,
  onEmailsSent,
  currentUser,
  users,
  departments,
}) => {
  const crmClients = useCrmClients();
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
  /** 任务列表状态筛选，方便看见「待发送」并操作 */
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('pending');
  const [taskPage, setTaskPage] = useState(0);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [trialForm, setTrialForm] = useState({
    recipientEmail: '',
    recipientName: '',
    companyName: '',
  });
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
  const quillRef = useRef<{ getEditor: () => { getSelection: (b?: boolean) => { index: number }; insertText: (i: number, t: string) => void; insertEmbed: (i: number, t: string, v: string) => void } } | null>(null);
  /** 切换用户后跳过一次保存，避免用上一用户的 state 写穿 */
  const skipNextSaveRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crmClientsRef = useRef(crmClients);
  const usersRef = useRef(users);
  const departmentsRef = useRef(departments);
  const visibleCrmRef = useRef(visibleCrmClients);
  crmClientsRef.current = crmClients;
  usersRef.current = users;
  departmentsRef.current = departments;
  visibleCrmRef.current = visibleCrmClients;

  const macros = ['{{company_name}}', '{{contact_name}}'];
  const dmReady = isDirectMailConfigured(config);
  const [gtmImportHint, setGtmImportHint] = useState('');

  const stampOwnership = useCallback(
    <T extends { ownerUsername?: string; departmentId?: string }>(item: T): T => ({
      ...item,
      ownerUsername: (item.ownerUsername || '').trim() || currentUser.username,
      departmentId: (item.departmentId || '').trim() || currentUser.departmentId,
    }),
    [currentUser.username, currentUser.departmentId]
  );

  /** 从产品匹配 / 开发策略导入：开发信模板 + 可选收件人 */
  const ingestGtmHandoff = useCallback(
    (handoff: GtmOutreachHandoff) => {
      const owner = { username: currentUser.username, departmentId: currentUser.departmentId };
      const tpl = templatesFromGtmOutreach(handoff, owner).map(stampOwnership);
      const fromStrategy = String(handoff.packId || '').startsWith('strategy_mail_');
      setTasks((prevTasks) => {
        const existing = new Set(prevTasks.map((t) => t.recipientEmail.toLowerCase()));
        const newTasks = emailTasksFromGtmOutreach(
          handoff,
          visibleCrmRef.current,
          owner,
          existing
        ).map(stampOwnership);
        if (newTasks.length) {
          if (!fromStrategy) setActiveTab('tasks');
          setGtmImportHint(
            [
              fromStrategy
                ? `已从开发策略导入「${handoff.productName}」`
                : `已从「${handoff.productName}」匹配导入`,
              tpl.length ? `${tpl.length} 套模板` : '',
              `${newTasks.length} 位收件人`,
            ]
              .filter(Boolean)
              .join(' · ')
          );
          return [...newTasks, ...prevTasks];
        }
        setGtmImportHint(
          [
            fromStrategy
              ? `已从开发策略导入「${handoff.productName}」`
              : `已从「${handoff.productName}」匹配导入`,
            tpl.length ? `${tpl.length} 套模板，可直接编辑` : '',
            !fromStrategy && !tpl.length
              ? '（匹配客户在 CRM 尚无邮箱时，请先补决策人邮箱或手动添加）'
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
        );
        return prevTasks;
      });
      if (tpl.length) {
        const [first, ...rest] = tpl;
        setTemplates((prev) => {
          const names = new Set(prev.map((t) => t.name));
          const add = rest.filter((t) => !names.has(t.name));
          return add.length ? [...add, ...prev] : prev;
        });
        setActiveTab('templates');
        setNewTemplate(first);
        setIsCreatingTemplate(true);
        setSelectedTemplateId(first.id);
      }
    },
    [currentUser.username, currentUser.departmentId, stampOwnership]
  );

  const ingestRef = useRef(ingestGtmHandoff);
  ingestRef.current = ingestGtmHandoff;

  useEffect(() => {
    const handoff = consumeGtmOutreachHandoff('email_campaign');
    if (handoff) ingestRef.current(handoff);
  }, [currentUser.username]);

  useEffect(() => {
    const onHandoff = () => {
      const handoff = consumeGtmOutreachHandoff('email_campaign');
      if (handoff) ingestRef.current(handoff);
    };
    window.addEventListener(GTM_OUTREACH_EVENT, onHandoff as EventListener);
    return () => window.removeEventListener(GTM_OUTREACH_EVENT, onHandoff as EventListener);
  }, []);

  // 切换登录用户时重载可见数据
  useEffect(() => {
    skipNextSaveRef.current = true;
    const next = loadEmailCampaignStoreForUser(
      currentUser,
      usersRef.current,
      departmentsRef.current,
      crmClientsRef.current
    );
    setTasks(next.tasks);
    setTemplates(next.templates);
    setConfig(next.config);
    setSelectedTaskIds(new Set());
    setSendMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.username, currentUser.role, currentUser.departmentId]);

  // 仅在邮件数据变化时落盘；CRM 抖动不得触发 JSON 重写（保活面板也会跟着卡死整页）
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveEmailCampaignStoreForUser(
        currentUser,
        usersRef.current,
        departmentsRef.current,
        { tasks, templates, config },
        crmClientsRef.current
      );
    }, 400);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [tasks, templates, config, currentUser]);

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

  const statusLabel = (status: EmailTask['status']) => {
    if (status === 'success') return '已成功';
    if (status === 'failed') return '失败';
    if (status === 'sending') return '发送中';
    return '待发送';
  };

  const isSendableStatus = (status: EmailTask['status']) =>
    status === 'pending' || status === 'failed';

  const taskCounts = useMemo(() => {
    let pending = 0;
    let success = 0;
    let failed = 0;
    for (const t of tasks) {
      if (t.status === 'success') success += 1;
      else if (t.status === 'failed') failed += 1;
      else if (t.status === 'pending' || t.status === 'sending') pending += 1;
    }
    return { pending, success, failed, all: tasks.length };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (taskFilter === 'all') return tasks;
    if (taskFilter === 'pending') {
      return tasks.filter((t) => t.status === 'pending' || t.status === 'sending');
    }
    return tasks.filter((t) => t.status === taskFilter);
  }, [tasks, taskFilter]);

  const PAGE_SIZE = 40;
  const taskPageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const pagedTasks = useMemo(() => {
    const page = Math.min(taskPage, taskPageCount - 1);
    const start = page * PAGE_SIZE;
    return filteredTasks.slice(start, start + PAGE_SIZE);
  }, [filteredTasks, taskPage, taskPageCount]);

  useEffect(() => {
    setTaskPage(0);
  }, [taskFilter]);

  const selectedSendableCount = useMemo(() => {
    let n = 0;
    for (const t of tasks) {
      if (selectedTaskIds.has(t.id) && isSendableStatus(t.status)) n += 1;
    }
    return n;
  }, [tasks, selectedTaskIds]);

  const ensureTemplateOrGuide = (): EmailTemplate | null => {
    const template = templates.find((t) => t.id === selectedTemplateId);
    if (template) return template;
    if (!templates.length) {
      alert('还没有邮件模板。请先到上方「邮件模板」新建一套，或从开发信档案导入。');
      setActiveTab('templates');
      return null;
    }
    alert('请先选择一个发送模板。');
    return null;
  };

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
      const saved = stampOwnership({
        ...newTemplate,
        id: (newTemplate.id || '').trim() || `tpl_${Date.now()}`,
        lastUpdated: Date.now(),
      });
      setTemplates((prev) => {
        const without = prev.filter((t) => t.id !== saved.id && t.name !== saved.name);
        return [saved, ...without];
      });
      setIsCreatingTemplate(false);
      setSelectedTemplateId(saved.id);
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

  const onSendBatch = async (
    taskIds: string[],
    templateId: string,
    /** 刚写入尚未进 state 的任务快照（试发用） */
    taskSnapshot?: EmailTask[]
  ) => {
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

    const pool = taskSnapshot || tasks;
    const targets = pool.filter((t) => taskIds.includes(t.id) && isSendableStatus(t.status));
    if (!targets.length) {
      alert(
        '当前勾选里没有可发送任务。\n请勾选「待发送 / 失败」项，或点「全选可发」；已成功的不会重复发送。'
      );
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

  const selectAllSendable = () => {
    setSelectedTaskIds(new Set(tasks.filter((t) => isSendableStatus(t.status)).map((t) => t.id)));
  };

  const clearSelection = () => setSelectedTaskIds(new Set());

  /** 试发：一个邮箱 + 一个模板，加入任务列表并立即真实发送 */
  const onTrialSend = async () => {
    const template = ensureTemplateOrGuide();
    if (!template) return;
    if (!dmReady || !config) {
      alert('请先在「接口配置」填写完整的阿里云 DirectMail 参数后再试发。');
      setActiveTab('config');
      return;
    }
    const email = trialForm.recipientEmail.trim();
    if (!email.includes('@')) {
      alert('请填写有效的试发收件邮箱');
      return;
    }
    let snapshot = [...tasks];
    let task = snapshot.find((t) => t.recipientEmail.toLowerCase() === email.toLowerCase());
    if (task && task.status === 'success') {
      if (!confirm(`「${email}」已成功发送过。是否重置为待发送并再试一封？`)) {
        return;
      }
      task = {
        ...task,
        status: 'pending',
        error: undefined,
        sentAt: undefined,
        requestId: undefined,
      };
      snapshot = snapshot.map((t) => (t.id === task!.id ? task! : t));
    }
    if (!task) {
      task = stampOwnership({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        recipientEmail: email,
        recipientName: trialForm.recipientName.trim() || email.split('@')[0],
        recipientTitle: '',
        companyName: trialForm.companyName.trim() || '',
        status: 'pending' as const,
        ownerUsername: currentUser.username,
        departmentId: currentUser.departmentId,
      });
      snapshot = [task, ...snapshot];
    }
    setTasks(snapshot);
    setTaskFilter('pending');
    setSelectedTaskIds(new Set([task.id]));
    setSelectedTemplateId(template.id);
    setSendMsg(`试发准备：${email}`);
    await onSendBatch([task.id], template.id, snapshot);
  };

  const onSendOne = async (taskId: string) => {
    const template = ensureTemplateOrGuide();
    if (!template) return;
    await onSendBatch([taskId], template.id);
  };

  return (
    <div className="w-full space-y-4 sm:space-y-8 animate-fade-in">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600 space-y-1">
        <p>
          怎么用：①「邮件模板」准备内容 → ②「试发一封」填邮箱测通 → ③ 在任务列表勾选后群发。接口需先在「接口配置」填好。
        </p>
        <p className="text-slate-500">
          数据隔离：员工仅见自己的收件人；主管见本部门。产品匹配/开发策略生成的开发信会进入「邮件模板」。
        </p>
      </div>
      {gtmImportHint ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-900">
          {gtmImportHint}
        </div>
      ) : null}

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
          {/* ① 试发：一邮箱 + 一模板，最清晰的上手路径 */}
          <div className="rounded-2xl sm:rounded-3xl border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 to-white p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                  <Send size={18} className="text-cyan-600" /> 试发一封（推荐先走这里）
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  填写一个收件邮箱、选一套模板，点「试发」即可真实发出。成功后会出现在下方任务列表。
                </p>
              </div>
              {!templates.length ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('templates')}
                  className="text-xs font-black text-cyan-700 underline"
                >
                  还没有模板？去新建 →
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                value={trialForm.recipientEmail}
                onChange={(e) => setTrialForm((f) => ({ ...f, recipientEmail: e.target.value }))}
                placeholder="收件邮箱 *（必填）"
                className="px-3 py-2.5 rounded-xl border border-cyan-200 bg-white text-sm font-bold"
              />
              <input
                value={trialForm.recipientName}
                onChange={(e) => setTrialForm((f) => ({ ...f, recipientName: e.target.value }))}
                placeholder="收件人姓名（可选）"
                className="px-3 py-2.5 rounded-xl border border-cyan-200 bg-white text-sm font-bold"
              />
              <input
                value={trialForm.companyName}
                onChange={(e) => setTrialForm((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="公司名（可选）"
                className="px-3 py-2.5 rounded-xl border border-cyan-200 bg-white text-sm font-bold"
              />
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-cyan-200 bg-white text-sm font-bold"
              >
                <option value="">选择邮件模板 *</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={sending || !dmReady}
                onClick={() => void onTrialSend()}
                className="inline-flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-black shadow-md"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? '发送中…' : '试发一封'}
              </button>
              {!dmReady ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('config')}
                  className="text-xs font-bold text-rose-600 underline"
                >
                  接口未配置，先去填写 DirectMail →
                </button>
              ) : (
                <span className="text-[11px] font-bold text-slate-500">将真实发出，请先用自己的邮箱测试</span>
              )}
              {sendMsg ? <span className="text-xs font-bold text-emerald-700">{sendMsg}</span> : null}
            </div>
          </div>

          {/* ② 任务列表：可筛选、可勾选、可单发 */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-800">发送任务列表</h3>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  共 {taskCounts.all} 条 · 待发送 {taskCounts.pending} · 已成功 {taskCounts.success} ·
                  失败 {taskCounts.failed}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['pending', `待发送 ${taskCounts.pending}`],
                    ['failed', `失败 ${taskCounts.failed}`],
                    ['success', `已成功 ${taskCounts.success}`],
                    ['all', `全部 ${taskCounts.all}`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTaskFilter(key)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-black border transition-colors ${
                      taskFilter === key
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full lg:w-64 px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold"
              >
                <option value="">群发所用模板…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={selectAllSendable}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-700 hover:bg-slate-50"
              >
                全选可发
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-slate-50"
              >
                清空勾选
              </button>
              <button
                disabled={sending || selectedSendableCount === 0 || !selectedTemplateId || !dmReady}
                onClick={() => onSendBatch(Array.from(selectedTaskIds), selectedTemplateId)}
                className="lg:ml-auto bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                title={!dmReady ? '请先完成接口配置' : undefined}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? '发送中…' : `群发可发项 (${selectedSendableCount})`}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-100 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[720px]">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={
                          pagedTasks.filter((t) => isSendableStatus(t.status)).length > 0 &&
                          pagedTasks
                            .filter((t) => isSendableStatus(t.status))
                            .every((t) => selectedTaskIds.has(t.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const next = new Set(selectedTaskIds);
                            pagedTasks.forEach((t) => {
                              if (isSendableStatus(t.status)) next.add(t.id);
                            });
                            setSelectedTaskIds(next);
                          } else {
                            const drop = new Set(pagedTasks.map((t) => t.id));
                            setSelectedTaskIds(
                              new Set([...selectedTaskIds].filter((id) => !drop.has(id)))
                            );
                          }
                        }}
                        className="rounded border-slate-300 text-blue-600"
                      />
                    </th>
                    <th className="px-4 py-3">收件人</th>
                    <th className="px-4 py-3">岗位</th>
                    <th className="px-4 py-3">公司</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">发送时间</th>
                    <th className="px-4 py-3 w-28">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-14 text-center">
                        <p className="text-slate-500 font-bold text-sm">
                          {tasks.length === 0
                            ? '还没有发送任务。请用上方「试发一封」，或展开下方批量导入。'
                            : '当前筛选下没有任务，可切换「全部 / 待发送」。'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    pagedTasks.map((task) => (
                      <tr key={task.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.has(task.id)}
                            disabled={task.status === 'success' || task.status === 'sending'}
                            onChange={() => toggleTask(task.id)}
                            className="rounded border-slate-300 text-blue-600 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800 text-sm">{task.recipientName}</div>
                          <div className="text-[10px] text-slate-400 font-bold">{task.recipientEmail}</div>
                          {task.error ? (
                            <div className="text-[10px] text-rose-500 font-bold mt-1">{task.error}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-600">
                          {task.recipientTitle || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-600">
                          {task.companyName || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black ${
                              task.status === 'success'
                                ? 'bg-green-100 text-green-700'
                                : task.status === 'failed'
                                  ? 'bg-red-100 text-red-600'
                                  : task.status === 'sending'
                                    ? 'bg-blue-100 text-blue-600'
                                    : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {task.status === 'sending' ? (
                              <Loader2 className="animate-spin" size={10} />
                            ) : null}
                            {task.status === 'success' ? <CheckCircle2 size={10} /> : null}
                            {task.status === 'failed' ? <AlertTriangle size={10} /> : null}
                            {task.status === 'pending' ? <Clock size={10} /> : null}
                            {statusLabel(task.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-400">
                          {task.sentAt ? new Date(task.sentAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {isSendableStatus(task.status) ? (
                              <button
                                type="button"
                                disabled={sending || !dmReady || !selectedTemplateId}
                                onClick={() => void onSendOne(task.id)}
                                className="px-2 py-1 rounded-lg text-[10px] font-black text-cyan-700 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-40"
                                title={!selectedTemplateId ? '请先选择模板' : '单封发送'}
                              >
                                发送
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeTask(task.id)}
                              className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                              title="移除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filteredTasks.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
                <span>
                  第 {Math.min(taskPage, taskPageCount - 1) + 1} / {taskPageCount} 页（每页 {PAGE_SIZE}{' '}
                  条）
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={taskPage <= 0}
                    onClick={() => setTaskPage((p) => Math.max(0, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={taskPage >= taskPageCount - 1}
                    onClick={() => setTaskPage((p) => Math.min(taskPageCount - 1, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* ③ 批量加任务：默认收起，避免盖住试发与列表 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowBulkImport((v) => !v)}
              className="w-full flex items-center justify-between px-4 sm:px-6 py-3 text-left hover:bg-slate-50"
            >
              <span className="text-sm font-black text-slate-800 flex items-center gap-2">
                <Plus size={16} /> 批量添加任务（手动 / CRM 导入）
              </span>
              <span className="text-[11px] font-bold text-slate-400">
                {showBulkImport ? '收起' : '展开'}
              </span>
            </button>
            {showBulkImport ? (
              <div className="px-4 sm:px-6 pb-5 space-y-4 border-t border-slate-100 pt-4">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 space-y-3">
                  <div className="text-sm font-black text-emerald-800">手动加入待发送（不立刻发）</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <input
                      value={manualForm.recipientEmail}
                      onChange={(e) =>
                        setManualForm((f) => ({ ...f, recipientEmail: e.target.value }))
                      }
                      placeholder="邮箱 *（必填）"
                      className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                    />
                    <input
                      value={manualForm.recipientName}
                      onChange={(e) =>
                        setManualForm((f) => ({ ...f, recipientName: e.target.value }))
                      }
                      placeholder="姓名"
                      className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                    />
                    <input
                      value={manualForm.recipientTitle}
                      onChange={(e) =>
                        setManualForm((f) => ({ ...f, recipientTitle: e.target.value }))
                      }
                      placeholder="岗位"
                      className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-white text-sm font-bold"
                    />
                    <input
                      value={manualForm.companyName}
                      onChange={(e) =>
                        setManualForm((f) => ({ ...f, companyName: e.target.value }))
                      }
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
                      <option value="">关联 CRM 客户（可选）</option>
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
                      <Plus size={16} /> 加入列表
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-black text-violet-800">
                    <Briefcase size={16} /> 按岗位从 CRM 导入
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
            ) : null}
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
          {(() => {
            const latest = loadStrategyMailDraft();
            const history = loadStrategyMailDraftHistory();
            const drafts = [
              ...(latest ? [latest] : []),
              ...history.filter((d) => !latest || d.id !== latest.id || d.savedAt !== latest.savedAt),
            ].slice(0, 8);
            if (!drafts.length) return null;
            return (
              <div className="md:col-span-2 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-4">
                <div>
                  <div className="text-sm font-black text-indigo-950">从开发信档案导入</div>
                  <p className="text-[11px] font-bold text-indigo-800/80">
                    含产品匹配 / 开发策略已存档的开发信组，点选即可填入群发模板
                  </p>
                </div>
                {drafts.map((draft) => {
                  const g = draft.mailGroup;
                  const items = [
                    { label: '匹配破冰', subject: g.subject1, body: g.email1 },
                    { label: '实力证明', subject: g.subject2, body: g.email2 },
                    { label: '钩子收口', subject: g.subject3, body: g.email3 },
                  ].filter((x) => x.body || x.subject);
                  if (!items.length) return null;
                  return (
                    <div key={`${draft.id || draft.companyName}_${draft.savedAt}`} className="space-y-2">
                      <p className="text-[11px] font-black text-indigo-900">
                        {draft.productName ? `${draft.productName} · ` : ''}
                        {draft.companyName}
                        {draft.savedAt
                          ? ` · ${new Date(draft.savedAt).toLocaleString('zh-CN')}`
                          : ''}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {items.map((item) => (
                          <button
                            key={`${draft.companyName}_${item.label}`}
                            type="button"
                            onClick={() => {
                              setNewTemplate({
                                id: '',
                                name: `${draft.companyName} · ${item.label}`,
                                subject: item.subject || '',
                                body: (item.body || '').replace(/\n/g, '<br/>'),
                                lastUpdated: Date.now(),
                              });
                              setIsCreatingTemplate(true);
                            }}
                            className="text-left rounded-xl border border-indigo-100 bg-white px-3 py-2.5 hover:border-indigo-300 hover:shadow-sm transition-all"
                          >
                            <div className="text-[10px] font-black text-indigo-600 uppercase">
                              {item.label}
                            </div>
                            <div className="text-xs font-bold text-slate-800 mt-1 line-clamp-2">
                              {item.subject || '（无主题）'}
                            </div>
                            <div className="text-[10px] text-indigo-700 font-black mt-2">
                              填入编辑器 →
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
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
                <Suspense
                  fallback={
                    <div className="h-64 mb-12 flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 gap-2">
                      <Loader2 className="animate-spin text-blue-600" size={16} />
                      编辑器加载中…
                    </div>
                  }
                >
                  <ReactQuill
                    ref={quillRef as React.RefObject<any>}
                    theme="snow"
                    modules={modules}
                    value={newTemplate.body || ''}
                    onChange={(body: string) => setNewTemplate({ ...newTemplate, body })}
                    className="h-64 mb-12"
                  />
                </Suspense>
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
