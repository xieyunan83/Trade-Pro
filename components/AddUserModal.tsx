import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';
import type { Department, Enterprise, User, UserPlan, UserRole } from '../types';
import { defaultPermissionsForRole } from '../services/permissions';
import { defaultAccessSchedule } from '../services/deviceBind';
import { findUserByName, hashPassword, normalizeUser, persistUsers } from '../services/auth';
import { sanitizeUsernameInput } from '../services/appFirewall';
import { DEFAULT_ENTERPRISE_ID } from '../services/orgStore';

export type AddUserFormResult = {
  users: User[];
  created: User;
};

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  users: User[];
  departments: Department[];
  enterprises?: Enterprise[];
  plans?: UserPlan[];
  defaultEnterpriseId?: string;
  /** 组织权限页：可选角色与部门 */
  allowRolePick?: boolean;
  /** 仅超管可创建系统管理员 */
  allowAdminRole?: boolean;
  onCreated: (result: AddUserFormResult) => void;
}

export const AddUserModal: React.FC<AddUserModalProps> = ({
  open,
  onClose,
  users,
  departments,
  enterprises = [],
  plans = [],
  defaultEnterpriseId = DEFAULT_ENTERPRISE_ID,
  allowRolePick = true,
  allowAdminRole = false,
  onCreated,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [enterpriseId, setEnterpriseId] = useState(defaultEnterpriseId);
  const [departmentId, setDepartmentId] = useState('');
  const [planId, setPlanId] = useState('');
  const [deviceBindRequired, setDeviceBindRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const deptsInEnterprise = useMemo(
    () =>
      departments.filter(
        (d) => (d.enterpriseId || DEFAULT_ENTERPRISE_ID) === enterpriseId
      ),
    [departments, enterpriseId]
  );

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setRole('user');
    setEnterpriseId(defaultEnterpriseId);
    setDepartmentId('');
    setPlanId('');
    setDeviceBindRequired(false);
    setSaving(false);
    setError('');
  }, [open, defaultEnterpriseId]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');

    const nameCheck = sanitizeUsernameInput(username);
    if (!nameCheck.ok) {
      setError(nameCheck.message || '用户名无效');
      return;
    }
    if (findUserByName(users, nameCheck.value)) {
      setError('该用户名已存在');
      return;
    }
    if (!password || password.length < 6) {
      setError('密码至少需要 6 位');
      return;
    }
    if (role === 'admin' && !allowAdminRole) {
      setError('无权创建系统管理员');
      return;
    }

    setSaving(true);
    try {
      const newUser = normalizeUser({
        username: nameCheck.value,
        role: allowRolePick ? role : 'user',
        password: await hashPassword(password.trim()),
        isFirstLogin: true,
        createdAt: Date.now(),
        enterpriseId: enterpriseId || DEFAULT_ENTERPRISE_ID,
        departmentId: departmentId || undefined,
        planId: planId || undefined,
        permissions: defaultPermissionsForRole(allowRolePick ? role : 'user'),
        deviceBindRequired,
        boundDevices: [],
        accessSchedule: defaultAccessSchedule(),
      });
      const next = [...users, newUser];
      const saved = await persistUsers(next, Date.now(), departments);
      onCreated({ users: saved, created: newUser });
      onClose();
    } catch (err: any) {
      console.error('create user failed', err);
      setError(err?.message || '创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50">
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-user-title"
      >
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
          <div id="add-user-title" className="font-black text-slate-800 flex items-center gap-2">
            <UserPlus size={18} className="text-blue-600" /> 添加用户
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 text-slate-400 hover:text-slate-700 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          <label className="block space-y-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              用户名
            </span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold"
              placeholder="例如：zhangsan"
              disabled={saving}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              登录密码
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold"
              placeholder="至少 6 位"
              disabled={saving}
            />
          </label>

          {allowRolePick && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  角色
                </span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white"
                  disabled={saving}
                >
                  <option value="user">部门员工</option>
                  <option value="manager">部门主管</option>
                  <option value="director">总监管理员</option>
                  {allowAdminRole && <option value="admin">超级管理员</option>}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  企业
                </span>
                <select
                  value={enterpriseId}
                  onChange={(e) => {
                    setEnterpriseId(e.target.value);
                    setDepartmentId('');
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white"
                  disabled={saving || enterprises.length === 0}
                >
                  {(enterprises.length ? enterprises : [{ id: DEFAULT_ENTERPRISE_ID, name: '默认企业', createdAt: 0 }]).map(
                    (e) => (
                      <option key={e.id} value={e.id}>
                        {e.displayName || e.name}
                      </option>
                    )
                  )}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  部门
                </span>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white"
                  disabled={saving}
                >
                  <option value="">未分配</option>
                  {deptsInEnterprise.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  套餐
                </span>
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold bg-white"
                  disabled={saving}
                >
                  <option value="">不绑定</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={deviceBindRequired}
              onChange={(e) => setDeviceBindRequired(e.target.checked)}
              disabled={saving}
            />
            <span>
              启用电脑端设备绑定
              <span className="block text-[11px] font-medium text-slate-400 mt-0.5">
                仅限制电脑浏览器；手机端始终可用原账号登录，不受此开关影响。
              </span>
            </span>
          </label>

          {error && (
            <div className="text-xs font-bold text-red-600 bg-red-50 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-3 rounded-xl border border-slate-200 font-black text-slate-600 disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              {saving ? '创建中…' : '创建'}
            </button>
          </div>
          <p className="text-[10px] font-bold text-slate-400 text-center">
            先保存到本机，云端在后台同步，不会卡住页面
          </p>
        </form>
      </div>
    </div>
  );
};
