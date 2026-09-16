import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Shield, Building2 } from 'lucide-react';
import type { Department, User } from '../types';
import { OrgPermissionPanel } from './OrgPermissionPanel';
import { ApiKeyPoolEditor } from './ApiKeyPoolEditor';
import {
  DEPT_KEY_PROVIDER_LABELS,
  DeptKeyProvider,
  getDeptApiKeysBundle,
  getDeptPoolMeta,
  setDeptPoolKeys,
} from '../services/deptApiKeys';

type Tab = 'team' | 'keys';

interface ManagerSystemPanelProps {
  currentUser: User;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  departments: Department[];
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>;
  onClose: () => void;
}

export const ManagerSystemPanel: React.FC<ManagerSystemPanelProps> = ({
  currentUser,
  users,
  setUsers,
  departments,
  setDepartments,
  onClose,
}) => {
  const [tab, setTab] = useState<Tab>('team');
  const deptId = (currentUser.departmentId || '').trim();
  const deptName =
    departments.find((d) => d.id === deptId)?.name || (deptId ? '本部门' : '未分配部门');

  const [qwenKeys, setQwenKeys] = useState<string[]>([]);
  const [tavilyKeys, setTavilyKeys] = useState<string[]>([]);
  const [anymailKeys, setAnymailKeys] = useState<string[]>([]);
  const [qwenBaseUrl, setQwenBaseUrl] = useState('');
  const [qwenModelId, setQwenModelId] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!deptId) return;
    const bundle = getDeptApiKeysBundle(deptId);
    setQwenKeys(bundle.qwen?.keys || []);
    setTavilyKeys(bundle.tavily?.keys || []);
    setAnymailKeys(bundle.anymailfinder?.keys || []);
    setQwenBaseUrl(bundle.qwen?.baseUrl || '');
    setQwenModelId(bundle.qwen?.modelId || '');
  }, [deptId]);

  const saveProvider = (provider: DeptKeyProvider, keys: string[]) => {
    if (!deptId) {
      setMsg('你的账号未分配部门，无法保存部门 Key。请联系管理员绑定部门。');
      return;
    }
    const meta =
      provider === 'qwen'
        ? { baseUrl: qwenBaseUrl.trim(), modelId: qwenModelId.trim(), updatedBy: currentUser.username }
        : { updatedBy: currentUser.username };
    setDeptPoolKeys(deptId, provider, keys, meta);
    if (provider === 'qwen') setQwenKeys(keys);
    if (provider === 'tavily') setTavilyKeys(keys);
    if (provider === 'anymailfinder') setAnymailKeys(keys);
    setMsg(`${DEPT_KEY_PROVIDER_LABELS[provider].title} 已保存（本部门用户将优先使用）`);
  };

  const stats = useMemo(() => {
    if (!deptId) return null;
    return {
      qwen: getDeptPoolMeta('qwen', deptId)?.keys.length || 0,
      tavily: getDeptPoolMeta('tavily', deptId)?.keys.length || 0,
      anymail: getDeptPoolMeta('anymailfinder', deptId)?.keys.length || 0,
    };
  }, [deptId, qwenKeys, tavilyKeys, anymailKeys]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50">
      <div className="bg-[#F0F2F5] w-full sm:max-w-5xl sm:rounded-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-black text-slate-800">系统管理</div>
            <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Building2 size={12} />
              {deptName} · 主管可管理下属权限与本部门 API Key
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 font-black px-3 py-2 flex-shrink-0"
          >
            关闭
          </button>
        </div>

        <div className="px-4 pt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTab('team')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black ${
              tab === 'team' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            <Shield size={16} /> 团队权限
          </button>
          <button
            type="button"
            onClick={() => setTab('keys')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black ${
              tab === 'keys' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            <KeyRound size={16} /> API Key
            {stats ? (
              <span className="text-[10px] font-bold opacity-80">
                Q{stats.qwen}/T{stats.tavily}/A{stats.anymail}
              </span>
            ) : null}
          </button>
        </div>

        <div className="p-4">
          {tab === 'team' ? (
            <OrgPermissionPanel
              currentUser={currentUser}
              users={users}
              setUsers={setUsers}
              departments={departments}
              setDepartments={setDepartments}
              mode="manager"
            />
          ) : (
            <div className="space-y-4">
              {!deptId && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                  当前主管账号未绑定部门，无法配置部门 Key。请管理员在后台为你分配部门后再试。
                </div>
              )}
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4 text-xs font-bold text-cyan-900 leading-relaxed">
                本部门员工执行背调（Qwen）、客户搜索（Tavily）、决策人挖掘（Anymail）时，会
                <strong>优先调用你在此添加的 Key</strong>
                ；耗尽后再回退到系统全局 Key / 环境变量。
              </div>
              {msg && <p className="text-xs font-bold text-emerald-700">{msg}</p>}

              <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <h3 className="text-sm font-black text-slate-800">{DEPT_KEY_PROVIDER_LABELS.qwen.title}</h3>
                <p className="text-[11px] text-slate-500 font-bold">{DEPT_KEY_PROVIDER_LABELS.qwen.hint}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={qwenBaseUrl}
                    onChange={(e) => setQwenBaseUrl(e.target.value)}
                    placeholder="Base URL（可选，如 Token Plan 地址）"
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                    disabled={!deptId}
                  />
                  <input
                    value={qwenModelId}
                    onChange={(e) => setQwenModelId(e.target.value)}
                    placeholder="Model ID（可选，如 qwen-plus）"
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold"
                    disabled={!deptId}
                  />
                </div>
                <ApiKeyPoolEditor
                  provider="qwen"
                  keys={qwenKeys}
                  onChange={(keys) => saveProvider('qwen', keys)}
                  placeholder="粘贴 Qwen API Key 后点添加"
                />
              </section>

              <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <h3 className="text-sm font-black text-slate-800">{DEPT_KEY_PROVIDER_LABELS.tavily.title}</h3>
                <p className="text-[11px] text-slate-500 font-bold">{DEPT_KEY_PROVIDER_LABELS.tavily.hint}</p>
                <ApiKeyPoolEditor
                  provider="tavily"
                  keys={tavilyKeys}
                  onChange={(keys) => saveProvider('tavily', keys)}
                  placeholder="粘贴 tvly-… Key 后点添加"
                />
              </section>

              <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <h3 className="text-sm font-black text-slate-800">
                  {DEPT_KEY_PROVIDER_LABELS.anymailfinder.title}
                </h3>
                <p className="text-[11px] text-slate-500 font-bold">
                  {DEPT_KEY_PROVIDER_LABELS.anymailfinder.hint}
                </p>
                <ApiKeyPoolEditor
                  provider="anymailfinder"
                  keys={anymailKeys}
                  onChange={(keys) => saveProvider('anymailfinder', keys)}
                  placeholder="粘贴 Anymail Finder API Key 后点添加"
                />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
