import React, { useMemo, useState } from 'react';
import { Client, DecisionMaker } from '../types';
import { Plus, Trash2, UserPlus, X, Mail, Phone } from 'lucide-react';

const emptyDm = (): DecisionMaker => ({
  name: '',
  title: '',
  emailGuess: '',
  phone: '',
  linkedin: '',
  type: 'Buyer',
  source: 'Manual',
  emailSource: 'Manual',
  emailStatus: 'unverified',
  isVerified: false,
  influenceScore: 3,
});

interface CrmContactsEditorProps {
  client: Client;
  onClose: () => void;
  onSaveContacts: (contacts: DecisionMaker[]) => void;
}

export const CrmContactsEditor: React.FC<CrmContactsEditorProps> = ({
  client,
  onClose,
  onSaveContacts,
}) => {
  const [contacts, setContacts] = useState<DecisionMaker[]>(() =>
    Array.isArray(client.contacts) ? [...client.contacts] : []
  );
  const [draft, setDraft] = useState<DecisionMaker>(emptyDm());
  const [msg, setMsg] = useState('');

  const count = useMemo(() => contacts.length, [contacts]);

  const addContact = () => {
    const name = (draft.name || '').trim();
    const email = (draft.emailGuess || '').trim();
    const phone = (draft.phone || '').trim();
    if (!name && !email && !phone) {
      setMsg('请至少填写姓名、邮箱或电话之一');
      return;
    }
    if (email && !email.includes('@')) {
      setMsg('邮箱格式不正确');
      return;
    }
    if (email) {
      const dup = contacts.some(
        (c) => (c.emailGuess || '').trim().toLowerCase() === email.toLowerCase()
      );
      if (dup) {
        setMsg('该邮箱已在联系人列表中');
        return;
      }
    }
    const next: DecisionMaker = {
      ...draft,
      name: name || (email ? email.split('@')[0] : '手动联系人'),
      title: (draft.title || '').trim() || '待补充',
      emailGuess: email || undefined,
      phone: phone || undefined,
      linkedin: (draft.linkedin || '').trim() || undefined,
      source: 'Manual',
      emailSource: email ? 'Manual' : undefined,
      emailStatus: email ? 'unverified' : undefined,
      isVerified: false,
      type: draft.type || 'Buyer',
    };
    const updated = [next, ...contacts];
    setContacts(updated);
    onSaveContacts(updated);
    setDraft(emptyDm());
    setMsg(`已添加：${next.name}`);
  };

  const removeAt = (index: number) => {
    const target = contacts[index];
    const label = target?.name || target?.emailGuess || `第 ${index + 1} 位`;
    if (!confirm(`删除联系人「${label}」？`)) return;
    const updated = contacts.filter((_, i) => i !== index);
    setContacts(updated);
    onSaveContacts(updated);
    setMsg(`已删除：${label}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col animate-fade-in">
        <div className="flex items-start justify-between gap-3 p-5 sm:p-6 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-900 font-black text-lg">
              <UserPlus className="text-indigo-600" size={20} />
              管理联系人
            </div>
            <p className="text-xs font-bold text-slate-500 mt-1 truncate">
              {client.name}
              {client.website ? ` · ${client.website}` : ''}
            </p>
            <p className="text-[11px] font-bold text-indigo-600 mt-1">共 {count} 位 · 支持手动添加决策人</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
            <div className="text-sm font-black text-indigo-900">手动添加联系人</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="姓名 *"
                className="px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm font-bold"
              />
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="职位（如 Purchasing Manager）"
                className="px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm font-bold"
              />
              <input
                value={draft.emailGuess || ''}
                onChange={(e) => setDraft((d) => ({ ...d, emailGuess: e.target.value }))}
                placeholder="邮箱"
                className="px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm font-bold"
              />
              <input
                value={draft.phone || ''}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="电话"
                className="px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm font-bold"
              />
              <select
                value={draft.type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: e.target.value as DecisionMaker['type'] }))
                }
                className="px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm font-bold"
              >
                <option value="Buyer">Buyer / 采购</option>
                <option value="CEO">CEO / 老板</option>
                <option value="Other">Other / 其他</option>
              </select>
              <input
                value={draft.linkedin || ''}
                onChange={(e) => setDraft((d) => ({ ...d, linkedin: e.target.value }))}
                placeholder="LinkedIn（可选）"
                className="px-3 py-2.5 rounded-xl border border-indigo-100 bg-white text-sm font-bold"
              />
            </div>
            <button
              type="button"
              onClick={addContact}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-black"
            >
              <Plus size={16} /> 添加联系人
            </button>
            {msg && <p className="text-xs font-bold text-emerald-700">{msg}</p>}
          </div>

          <div className="space-y-2">
            {contacts.length === 0 ? (
              <div className="text-center text-slate-400 font-bold text-sm py-8 border border-dashed border-slate-200 rounded-2xl">
                暂无联系人，请上方手动添加
              </div>
            ) : (
              contacts.map((c, i) => (
                <div
                  key={`${c.emailGuess || c.name}-${i}`}
                  className="flex items-start justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="font-black text-slate-800 text-sm truncate">
                      {c.name || '未命名'}
                      <span className="ml-2 text-[10px] font-black uppercase tracking-wide text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                        {c.type}
                      </span>
                      {c.source === 'Manual' && (
                        <span className="ml-1 text-[10px] font-bold text-slate-400">手动</span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-slate-500 mt-0.5">{c.title || '—'}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] font-bold text-slate-600">
                      {c.emailGuess && (
                        <span className="inline-flex items-center gap-1">
                          <Mail size={12} className="text-slate-400" />
                          {c.emailGuess}
                        </span>
                      )}
                      {c.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={12} className="text-slate-400" />
                          {c.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl flex-shrink-0"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
