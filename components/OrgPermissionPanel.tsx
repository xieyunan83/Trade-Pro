import React, { useMemo, useState } from 'react';
import { Building2, Plus, Save, Shield, Trash2, UserCog, Cpu, Clock } from 'lucide-react';
import type { AccessSchedule, Department, PermissionKey, User, UserRole } from '../types';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  defaultPermissionsForRole,
  effectivePermissions,
  roleLabel,
} from '../services/permissions';
import { createDepartment } from '../services/orgStore';
import { findUserByName, hashPassword, persistDepartments, persistUsers } from '../services/auth';
import {
  clearUserDeviceBindings,
  defaultAccessSchedule,
  describeSchedule,
} from '../services/deviceBind';
import { AddUserModal } from './AddUserModal';

interface OrgPermissionPanelProps {
  currentUser: User;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  departments: Department[];
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>;
  /** manager 模式：只能改本部门下属 */
  mode?: 'admin' | 'manager';
}

const WEEK_OPTIONS = [
  { v: 1, label: '一' },
  { v: 2, label: '二' },
  { v: 3, label: '三' },
  { v: 4, label: '四' },
  { v: 5, label: '五' },
  { v: 6, label: '六' },
  { v: 0, label: '日' },
];

export const OrgPermissionPanel: React.FC<OrgPermissionPanelProps> = ({
  currentUser,
  users,
  setUsers,
  departments,
  setDepartments,
  mode = 'admin',
}) => {
  const isAdmin = mode === 'admin' && currentUser.role === 'admin';
  const [selectedUsername, setSelectedUsername] = useState('');
  const [draftPerms, setDraftPerms] = useState<PermissionKey[]>([]);
  const [draftRole, setDraftRole] = useState<UserRole>('user');
  const [draftDeptId, setDraftDeptId] = useState('');
  const [draftDisabled, setDraftDisabled] = useState(false);
  const [draftDeviceBindRequired, setDraftDeviceBindRequired] = useState(true);
  const [draftSchedule, setDraftSchedule] = useState<AccessSchedule>(defaultAccessSchedule());
  const [msg, setMsg] = useState('');
  const [addUserOpen, setAddUserOpen] = useState(false);

  const manageableUsers = useMemo(() => {
    if (isAdmin) return users;
    // 主管：仅本部门普通员工
    return users.filter(
      (u) =>
        u.role === 'user' &&
        u.departmentId &&
        u.departmentId === currentUser.departmentId &&
        u.username.toLowerCase() !== currentUser.username.toLowerCase()
    );
  }, [users, isAdmin, currentUser]);

  const selected = findUserByName(users, selectedUsername);

  const loadUser = (username: string) => {
    const u = findUserByName(users, username);
    if (!u) return;
    setSelectedUsername(u.username);
    setDraftRole(u.role);
    setDraftDeptId(u.departmentId || '');
    setDraftDisabled(!!u.disabled);
    setDraftPerms(
      u.permissions !== undefined && u.permissions !== null
        ? u.permissions
        : defaultPermissionsForRole(u.role)
    );
    setDraftDeviceBindRequired(
      u.deviceBindRequired === true
        ? true
        : u.deviceBindRequired === false
          ? false
          : u.role === 'user'
    );
    setDraftSchedule(u.accessSchedule ? { ...defaultAccessSchedule(), ...u.accessSchedule } : defaultAccessSchedule());
    setMsg('');
  };

  const togglePerm = (key: PermissionKey) => {
    if (!isAdmin && key === 'feature.manage_team_users') return;
    setDraftPerms((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const toggleDay = (day: number) => {
    setDraftSchedule((prev) => {
      const cur = prev.daysOfWeek || [];
      const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort();
      return { ...prev, daysOfWeek: next };
    });
  };

  const handleSaveUser = async () => {
    if (!selected) return;
    if (selected.username === 'admin' && draftRole !== 'admin') {
      alert('不能降级系统管理员 admin');
      return;
    }
    let nextPerms = [...draftPerms];
    if (!isAdmin) {
      // 主管不能授予「管理下属」以外的管理权，也不能改角色为 admin/manager
      nextPerms = nextPerms.filter((k) => k !== 'feature.manage_team_users');
    }
    const next = users.map((u) => {
      if (u.username !== selected.username) return u;
      if (isAdmin) {
        const role = draftRole;
        return {
          ...u,
          role,
          departmentId: draftDeptId || undefined,
          disabled: draftDisabled,
          permissions: nextPerms,
          deviceBindRequired: draftDeviceBindRequired,
          accessSchedule: draftSchedule,
          boundDevices: u.boundDevices || [],
        };
      }
      return {
        ...u,
        permissions: nextPerms,
        deviceBindRequired: draftDeviceBindRequired,
        accessSchedule: draftSchedule,
      };
    });
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    setMsg(`已保存「${selected.username}」的权限与设备/时段设置`);
  };

  const handleResetDeviceBind = async () => {
    if (!selected) return;
    if (!confirm(`确认清除「${selected.username}」的设备绑定？下次登录需重新登记 MAC 并绑定本机。`)) return;
    const next = users.map((u) =>
      u.username === selected.username ? clearUserDeviceBindings(u) : u
    );
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    setMsg(`已清除「${selected.username}」的设备绑定`);
  };

  const handleAddDepartment = async () => {
    const name = prompt('请输入新部门名称：');
    if (!name?.trim()) return;
    const dept = createDepartment(name.trim());
    const next = [...departments, dept];
    setDepartments(next);
    await persistDepartments(next);
    setMsg(`部门「${dept.name}」已创建`);
  };

  const handleRenameDepartment = async (id: string) => {
    const dept = departments.find((d) => d.id === id);
    if (!dept) return;
    const name = prompt('修改部门名称：', dept.name);
    if (!name?.trim()) return;
    const next = departments.map((d) => (d.id === id ? { ...d, name: name.trim() } : d));
    setDepartments(next);
    await persistDepartments(next);
  };

  const handleSetDeptManager = async (id: string) => {
    const dept = departments.find((d) => d.id === id);
    if (!dept) return;
    const name = prompt('指定部门主管用户名（需已存在）：', dept.managerUsername || '');
    if (name === null) return;
    const mgr = name.trim() ? findUserByName(users, name.trim()) : undefined;
    if (name.trim() && !mgr) {
      alert('找不到该用户');
      return;
    }
    const nextDepts = departments.map((d) =>
      d.id === id ? { ...d, managerUsername: mgr?.username } : d
    );
    setDepartments(nextDepts);
    let nextUsers = users;
    if (mgr) {
      nextUsers = users.map((u) =>
        u.username === mgr.username
          ? {
              ...u,
              role: u.role === 'admin' ? 'admin' : 'manager',
              departmentId: id,
              permissions: effectivePermissions({ ...u, role: u.role === 'admin' ? 'admin' : 'manager' }),
            }
          : u
      );
      setUsers(nextUsers);
    }
    await persistUsers(nextUsers, Date.now(), nextDepts);
    setMsg('部门主管已更新');
  };

  const handleDeleteDepartment = async (id: string) => {
    if (!confirm('删除该部门？部门内用户将变为未分配部门。')) return;
    const nextDepts = departments.filter((d) => d.id !== id);
    const nextUsers = users.map((u) => (u.departmentId === id ? { ...u, departmentId: undefined } : u));
    setDepartments(nextDepts);
    setUsers(nextUsers);
    await persistUsers(nextUsers, Date.now(), nextDepts);
  };

  const handleAddUserAdmin = () => {
    if (!isAdmin) return;
    setAddUserOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {isAdmin && (
        <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <Building2 className="text-blue-600" /> 部门管理
            </h3>
            <button
              type="button"
              onClick={handleAddDepartment}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
            >
              <Plus size={16} /> 新建部门
            </button>
          </div>
          {departments.length === 0 ? (
            <p className="text-sm text-slate-400 font-bold">尚未创建部门。请先建部门，再给用户分配部门与主管。</p>
          ) : (
            <div className="space-y-2">
              {departments.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100"
                >
                  <div>
                    <div className="font-black text-slate-800">{d.name}</div>
                    <div className="text-[11px] font-bold text-slate-400">
                      主管：{d.managerUsername || '未指定'} · 成员{' '}
                      {users.filter((u) => u.departmentId === d.id).length} 人
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleRenameDepartment(d.id)}
                      className="px-3 py-1.5 rounded-lg bg-white border text-[11px] font-black text-slate-600"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetDeptManager(d.id)}
                      className="px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-[11px] font-black"
                    >
                      指定主管
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDepartment(d.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-[11px] font-black"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <UserCog className="text-violet-600" /> {isAdmin ? '用户与权限' : '下属权限管理'}
          </h3>
          {isAdmin && (
            <button
              type="button"
              onClick={handleAddUserAdmin}
              className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
            >
              <Plus size={16} /> 添加用户
            </button>
          )}
        </div>

        <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
          {isAdmin
            ? '各部门搜索/背调/CRM 数据互不共享。部门主管仅看本部门；总管可浏览全部部门；系统管理员可配置组织与密钥。可为任意账户单独开关网卡绑定。'
            : '你只能调整本部门普通员工的功能权限与设备绑定，不能查看或修改其它部门与主管账号。'}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {manageableUsers.length === 0 ? (
              <div className="text-sm text-slate-400 font-bold p-3">暂无可管理用户</div>
            ) : (
              manageableUsers.map((u) => {
                const dept = departments.find((d) => d.id === u.departmentId);
                return (
                  <button
                    key={u.username}
                    type="button"
                    onClick={() => loadUser(u.username)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedUsername === u.username
                        ? 'border-violet-400 bg-violet-50'
                        : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="font-black text-slate-800">{u.username}</div>
                    <div className="text-[10px] font-bold text-slate-400">
                      {roleLabel(u.role)} · {dept?.name || '未分配部门'}
                      {u.disabled ? ' · 已停用' : ''}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            {!selected ? (
              <div className="text-sm text-slate-400 font-bold p-6 text-center border border-dashed rounded-2xl">
                请选择左侧用户以编辑权限
              </div>
            ) : (
              <>
                {isAdmin && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">角色</label>
                      <select
                        value={draftRole}
                        onChange={(e) => {
                          const role = e.target.value as UserRole;
                          setDraftRole(role);
                          setDraftPerms(defaultPermissionsForRole(role));
                        }}
                        className="w-full mt-1 border rounded-xl px-3 py-2 text-sm font-bold"
                        disabled={selected.username === 'admin'}
                      >
                        <option value="user">部门员工</option>
                        <option value="manager">部门主管</option>
                        <option value="director">总管（全部门数据）</option>
                        <option value="admin">系统管理员</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">部门</label>
                      <select
                        value={draftDeptId}
                        onChange={(e) => setDraftDeptId(e.target.value)}
                        className="w-full mt-1 border rounded-xl px-3 py-2 text-sm font-bold"
                      >
                        <option value="">未分配</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={draftDisabled}
                          onChange={(e) => setDraftDisabled(e.target.checked)}
                          disabled={selected.username === 'admin'}
                        />
                        停用账号
                      </label>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Shield size={14} className="text-violet-600" />
                    <span className="text-xs font-black text-slate-600 uppercase tracking-widest">权限勾选</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                    {PERMISSION_CATALOG.map((p) => {
                      const locked = !isAdmin && p.key === 'feature.manage_team_users';
                      return (
                        <label
                          key={p.key}
                          className={`flex items-start gap-2 p-2.5 rounded-xl border text-left ${
                            locked ? 'opacity-40' : 'bg-slate-50 border-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={draftPerms.includes(p.key)}
                            disabled={locked}
                            onChange={() => togglePerm(p.key)}
                          />
                          <span>
                            <span className="block text-xs font-black text-slate-800">
                              [{p.group}] {p.label}
                            </span>
                            <span className="block text-[10px] font-bold text-slate-400">{p.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-[11px] font-black text-blue-600"
                      onClick={() => setDraftPerms(defaultPermissionsForRole(isAdmin ? draftRole : 'user'))}
                    >
                      恢复角色默认
                    </button>
                    <button
                      type="button"
                      className="text-[11px] font-black text-slate-500"
                      onClick={() => setDraftPerms([...ALL_PERMISSION_KEYS].filter((k) => isAdmin || k !== 'feature.manage_team_users'))}
                    >
                      全选可用
                    </button>
                    <button
                      type="button"
                      className="text-[11px] font-black text-slate-500"
                      onClick={() => setDraftPerms([])}
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                      <Cpu size={14} className="text-emerald-600" />
                      <span className="text-xs font-black text-slate-600 uppercase tracking-widest">
                        设备 / 网卡绑定
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
                      可为任意账户单独开关。浏览器无法直接读取网卡 MAC：开启后须登记 MAC 并锁定本机设备指纹，换电脑/浏览器将无法登录，除非管理员清除绑定。
                    </p>
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={draftDeviceBindRequired}
                        onChange={(e) => setDraftDeviceBindRequired(e.target.checked)}
                      />
                      启用本机设备绑定（网卡 MAC）
                    </label>
                    <div className="text-[11px] font-bold text-slate-600 space-y-1">
                      {(selected.boundDevices || []).length === 0 ? (
                        <div className="text-amber-600">尚未绑定设备</div>
                      ) : (
                        selected.boundDevices!.map((d) => (
                          <div key={d.deviceId} className="bg-white rounded-xl border border-slate-100 px-3 py-2">
                            <div>MAC：{d.macAddress || '—'}</div>
                            <div className="truncate">指纹：{d.deviceId.slice(0, 16)}…</div>
                            <div className="text-slate-400">
                              {d.label || '本机'} · {new Date(d.boundAt).toLocaleString('zh-CN')}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleResetDeviceBind}
                      className="text-[11px] font-black text-red-600 hover:underline"
                    >
                      清除设备绑定（允许换机重绑）
                    </button>

                    <div className="border-t border-slate-200 pt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-blue-600" />
                        <span className="text-xs font-black text-slate-600 uppercase tracking-widest">可用时段</span>
                      </div>
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!draftSchedule.enabled}
                          onChange={(e) => setDraftSchedule((s) => ({ ...s, enabled: e.target.checked }))}
                        />
                        启用可用时段限制
                      </label>
                      <div className="text-[11px] font-bold text-slate-500">当前：{describeSchedule(draftSchedule)}</div>
                      <div className="flex flex-wrap gap-2">
                        {WEEK_OPTIONS.map((d) => (
                          <button
                            key={d.v}
                            type="button"
                            onClick={() => toggleDay(d.v)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-black border ${
                              (draftSchedule.daysOfWeek || []).includes(d.v)
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-500 border-slate-200'
                            }`}
                          >
                            周{d.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase">
                          开始
                          <input
                            type="time"
                            value={draftSchedule.startTime || '09:00'}
                            onChange={(e) => setDraftSchedule((s) => ({ ...s, startTime: e.target.value }))}
                            className="mt-1 w-full border rounded-xl px-3 py-2 text-sm font-bold bg-white"
                          />
                        </label>
                        <label className="text-[10px] font-black text-slate-400 uppercase">
                          结束
                          <input
                            type="time"
                            value={draftSchedule.endTime || '18:00'}
                            onChange={(e) => setDraftSchedule((s) => ({ ...s, endTime: e.target.value }))}
                            className="mt-1 w-full border rounded-xl px-3 py-2 text-sm font-bold bg-white"
                          />
                        </label>
                      </div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block">
                        时区
                        <select
                          value={draftSchedule.timezone || 'Asia/Shanghai'}
                          onChange={(e) => setDraftSchedule((s) => ({ ...s, timezone: e.target.value }))}
                          className="mt-1 w-full border rounded-xl px-3 py-2 text-sm font-bold bg-white"
                        >
                          <option value="Asia/Shanghai">Asia/Shanghai（中国）</option>
                          <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                          <option value="UTC">UTC</option>
                        </select>
                      </label>
                    </div>
                  </div>

                <button
                  type="button"
                  onClick={handleSaveUser}
                  className="w-full sm:w-auto bg-slate-900 hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2"
                >
                  <Save size={16} /> 保存权限
                </button>
                {msg && <div className="text-xs font-bold text-emerald-600">{msg}</div>}
              </>
            )}
          </div>
        </div>
      </div>

      <AddUserModal
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        users={users}
        departments={departments}
        allowRolePick
        onCreated={({ users: next, created }) => {
          setUsers(next);
          setMsg(`用户「${created.username}」已创建`);
          loadUser(created.username);
        }}
      />
    </div>
  );
};
