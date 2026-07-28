import React, { useMemo, useState } from 'react';
import { Building2, Plus, Save, Shield, Trash2, UserCog } from 'lucide-react';
import type { Department, PermissionKey, User, UserRole } from '../types';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  defaultPermissionsForRole,
  effectivePermissions,
  roleLabel,
} from '../services/permissions';
import { createDepartment } from '../services/orgStore';
import { findUserByName, hashPassword, persistDepartments, persistUsers } from '../services/auth';

interface OrgPermissionPanelProps {
  currentUser: User;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  departments: Department[];
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>;
  /** manager 模式：只能改本部门下属 */
  mode?: 'admin' | 'manager';
}

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
  const [msg, setMsg] = useState('');

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
    setMsg('');
  };

  const togglePerm = (key: PermissionKey) => {
    if (!isAdmin && key === 'feature.manage_team_users') return;
    setDraftPerms((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
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
        return {
          ...u,
          role: draftRole,
          departmentId: draftDeptId || undefined,
          disabled: draftDisabled,
          permissions: nextPerms,
        };
      }
      return {
        ...u,
        permissions: nextPerms,
      };
    });
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    setMsg(`已保存「${selected.username}」的权限设置`);
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

  const handleAddUserAdmin = async () => {
    if (!isAdmin) return;
    const username = prompt('请输入新用户名:');
    if (!username?.trim()) return;
    const trimmed = username.trim();
    if (findUserByName(users, trimmed)) {
      alert('该用户名已存在');
      return;
    }
    const pwd = prompt('请设置登录密码（至少 6 位）:');
    if (!pwd || pwd.length < 6) {
      alert('密码至少需要 6 位');
      return;
    }
    const roleRaw = prompt('角色：user（员工） / manager（主管），默认 user：', 'user') || 'user';
    const role: UserRole = roleRaw.trim() === 'manager' ? 'manager' : 'user';
    const deptName = departments.length
      ? prompt(`分配部门 ID（可选）:\n${departments.map((d) => `${d.id} = ${d.name}`).join('\n')}`)
      : '';
    const newUser: User = {
      username: trimmed,
      role,
      password: await hashPassword(pwd),
      isFirstLogin: true,
      createdAt: Date.now(),
      departmentId: deptName?.trim() || undefined,
      permissions: defaultPermissionsForRole(role),
    };
    const next = [...users, newUser];
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    alert(`用户 ${trimmed} 已创建`);
    loadUser(trimmed);
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
            ? '可为每个用户勾选模块与功能权限；部门主管可查看本部门员工的背调/决策人等记录，员工看不到主管自己的操作记录。'
            : '你只能调整本部门普通员工的功能权限，不能查看或修改其它部门与主管账号。'}
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
    </div>
  );
};
