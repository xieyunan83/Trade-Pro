import React, { useMemo, useState } from 'react';
import {
  Building2,
  Plus,
  Save,
  Shield,
  Trash2,
  UserCog,
  Cpu,
  Clock,
  Briefcase,
  Package,
  KeyRound,
} from 'lucide-react';
import type {
  AccessSchedule,
  Department,
  Enterprise,
  PermissionKey,
  User,
  UserPlan,
  UserRole,
} from '../types';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  defaultPermissionsForRole,
  effectivePermissions,
  isSuperAdmin,
  roleLabel,
} from '../services/permissions';
import {
  DEFAULT_ENTERPRISE_ID,
  createDepartment,
  createEnterprise,
  createUserPlan,
  loadEnterprisesFromStorage,
  loadPlansFromStorage,
} from '../services/orgStore';
import {
  findUserByName,
  hashPassword,
  persistDepartments,
  persistEnterprises,
  persistPlans,
  persistUsers,
  updateUserPassword,
} from '../services/auth';
import {
  clearUserDeviceBindings,
  defaultAccessSchedule,
  describeSchedule,
} from '../services/deviceBind';
import { describePlanUsage } from '../services/planQuotaGate';
import { AddUserModal } from './AddUserModal';

interface OrgPermissionPanelProps {
  currentUser: User;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  departments: Department[];
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>;
  enterprises?: Enterprise[];
  setEnterprises?: React.Dispatch<React.SetStateAction<Enterprise[]>>;
  plans?: UserPlan[];
  setPlans?: React.Dispatch<React.SetStateAction<UserPlan[]>>;
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
  enterprises: enterprisesProp,
  setEnterprises: setEnterprisesProp,
  plans: plansProp,
  setPlans: setPlansProp,
  mode = 'admin',
}) => {
  /** 超管：密钥级；总监：组织与用户业务管理 */
  const canManageOrg =
    mode === 'admin' &&
    (isSuperAdmin(currentUser) || currentUser.role === 'director');
  const superAdmin = mode === 'admin' && isSuperAdmin(currentUser);
  const isManagerMode = mode === 'manager';

  const [enterprisesLocal, setEnterprisesLocal] = useState(() => loadEnterprisesFromStorage());
  const [plansLocal, setPlansLocal] = useState(() => loadPlansFromStorage());
  const enterprises = enterprisesProp ?? enterprisesLocal;
  const setEnterprises = setEnterprisesProp ?? setEnterprisesLocal;
  const plans = plansProp ?? plansLocal;
  const setPlans = setPlansProp ?? setPlansLocal;

  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState(DEFAULT_ENTERPRISE_ID);
  const [filterDeptId, setFilterDeptId] = useState('');
  const [selectedUsername, setSelectedUsername] = useState('');
  const [draftPerms, setDraftPerms] = useState<PermissionKey[]>([]);
  const [draftRole, setDraftRole] = useState<UserRole>('user');
  const [draftDeptId, setDraftDeptId] = useState('');
  const [draftEnterpriseId, setDraftEnterpriseId] = useState(DEFAULT_ENTERPRISE_ID);
  const [draftPlanId, setDraftPlanId] = useState('');
  const [draftDisabled, setDraftDisabled] = useState(false);
  const [draftDeviceBindRequired, setDraftDeviceBindRequired] = useState(true);
  const [draftSchedule, setDraftSchedule] = useState<AccessSchedule>(defaultAccessSchedule());
  const [msg, setMsg] = useState('');
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [deptDraft, setDeptDraft] = useState<{
    mode: 'add' | 'rename' | 'manager';
    id?: string;
    value: string;
  } | null>(null);
  const [entDraft, setEntDraft] = useState<{ mode: 'add' | 'rename'; id?: string; value: string } | null>(
    null
  );
  const [planDraft, setPlanDraft] = useState<{
    mode: 'add' | 'edit';
    id?: string;
    name: string;
    search: string;
    dig: string;
    unlock: string;
  } | null>(null);

  const deptsInEnterprise = useMemo(
    () =>
      departments.filter(
        (d) => (d.enterpriseId || DEFAULT_ENTERPRISE_ID) === selectedEnterpriseId
      ),
    [departments, selectedEnterpriseId]
  );

  const manageableUsers = useMemo(() => {
    if (isManagerMode) {
      return users.filter(
        (u) =>
          u.role === 'user' &&
          u.departmentId &&
          u.departmentId === currentUser.departmentId &&
          u.username.toLowerCase() !== currentUser.username.toLowerCase()
      );
    }
    return users.filter((u) => {
      const dept = departments.find((d) => d.id === u.departmentId);
      const entId = u.enterpriseId || dept?.enterpriseId || DEFAULT_ENTERPRISE_ID;
      if (entId !== selectedEnterpriseId) return false;
      if (filterDeptId && u.departmentId !== filterDeptId) return false;
      return true;
    });
  }, [
    users,
    isManagerMode,
    currentUser,
    departments,
    selectedEnterpriseId,
    filterDeptId,
  ]);

  const selected = findUserByName(users, selectedUsername);

  const loadUser = (username: string) => {
    const u = findUserByName(users, username);
    if (!u) return;
    setSelectedUsername(u.username);
    setDraftRole(u.role);
    const dept = departments.find((d) => d.id === u.departmentId);
    const entId = u.enterpriseId || dept?.enterpriseId || DEFAULT_ENTERPRISE_ID;
    setDraftEnterpriseId(entId);
    setSelectedEnterpriseId(entId);
    setDraftDeptId(u.departmentId || '');
    setDraftPlanId(u.planId || '');
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
    setDraftSchedule(
      u.accessSchedule
        ? { ...defaultAccessSchedule(), ...u.accessSchedule }
        : defaultAccessSchedule()
    );
    setMsg('');
  };

  const togglePerm = (key: PermissionKey) => {
    if (!canManageOrg && key === 'feature.manage_team_users') return;
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
    if (draftRole === 'admin' && !superAdmin) {
      alert('仅超级管理员可授予系统管理员角色');
      return;
    }
    let nextPerms = [...draftPerms];
    if (!canManageOrg) {
      nextPerms = nextPerms.filter((k) => k !== 'feature.manage_team_users');
    }
    const next = users.map((u) => {
      if (u.username !== selected.username) return u;
      if (canManageOrg) {
        const role = draftRole;
        const dept = departments.find((d) => d.id === draftDeptId);
        return {
          ...u,
          role,
          enterpriseId:
            draftEnterpriseId || dept?.enterpriseId || DEFAULT_ENTERPRISE_ID,
          departmentId: draftDeptId || undefined,
          planId: draftPlanId || undefined,
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
    setMsg(`已保存「${selected.username}」`);
  };

  const handleResetDeviceBind = async () => {
    if (!selected) return;
    if (!confirm(`确认清除「${selected.username}」的设备绑定？下次登录需重新登记 MAC 并绑定本机。`))
      return;
    const next = users.map((u) =>
      u.username === selected.username ? clearUserDeviceBindings(u) : u
    );
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    setMsg(`已清除「${selected.username}」的设备绑定`);
  };

  const handleDeleteUser = async (username: string) => {
    if (!canManageOrg) return;
    if (username === 'admin') {
      alert('不能删除系统管理员');
      return;
    }
    if (!confirm(`确认删除用户「${username}」？`)) return;
    const next = users.filter((u) => u.username !== username);
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    if (selectedUsername === username) setSelectedUsername('');
    setMsg(`已删除「${username}」`);
  };

  const submitResetPassword = async () => {
    if (!resetPwdUser || !resetPwdValue.trim()) return;
    if (resetPwdValue.trim().length < 6) {
      setMsg('新密码至少 6 位');
      return;
    }
    const hashed = await hashPassword(resetPwdValue.trim());
    const next = updateUserPassword(users, resetPwdUser, hashed);
    setUsers(next);
    await persistUsers(next, Date.now(), departments);
    setResetPwdUser(null);
    setResetPwdValue('');
    setMsg(`已重置「${resetPwdUser}」的密码`);
  };

  const submitEntDraft = async () => {
    if (!entDraft || !canManageOrg) return;
    const value = entDraft.value.trim();
    if (!value) {
      setMsg('请输入企业名称');
      return;
    }
    if (entDraft.mode === 'add') {
      const ent = createEnterprise(value);
      const next = [...enterprises, ent];
      setEnterprises(next);
      await persistEnterprises(next);
      setSelectedEnterpriseId(ent.id);
      setMsg(`企业「${ent.name}」已创建`);
    } else if (entDraft.id) {
      const next = enterprises.map((e) =>
        e.id === entDraft.id ? { ...e, name: value, displayName: value } : e
      );
      setEnterprises(next);
      await persistEnterprises(next);
      setMsg('企业名称已更新');
    }
    setEntDraft(null);
  };

  const handleDeleteEnterprise = async (id: string) => {
    if (!canManageOrg) return;
    if (id === DEFAULT_ENTERPRISE_ID) {
      alert('不能删除默认企业');
      return;
    }
    const linked = departments.filter((d) => (d.enterpriseId || DEFAULT_ENTERPRISE_ID) === id);
    if (linked.length) {
      alert('请先将该企业下的部门迁走或删除，再删企业');
      return;
    }
    if (!confirm('确认删除该企业？')) return;
    const next = enterprises.filter((e) => e.id !== id);
    setEnterprises(next);
    await persistEnterprises(next);
    if (selectedEnterpriseId === id) setSelectedEnterpriseId(DEFAULT_ENTERPRISE_ID);
    setMsg('企业已删除');
  };

  const submitPlanDraft = async () => {
    if (!planDraft || !superAdmin) return;
    const name = planDraft.name.trim();
    if (!name) {
      setMsg('请输入套餐名称');
      return;
    }
    const toNum = (s: string, fallback: number) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : fallback;
    };
    if (planDraft.mode === 'add') {
      const plan = createUserPlan(name, {
        searchQuotaMonthly: toNum(planDraft.search, 100),
        digQuotaMonthly: toNum(planDraft.dig, 50),
        unlockQuotaMonthly: toNum(planDraft.unlock, 50),
      });
      const next = [...plans, plan];
      setPlans(next);
      await persistPlans(next);
      setMsg(`套餐「${plan.name}」已创建`);
    } else if (planDraft.id) {
      const next = plans.map((p) =>
        p.id === planDraft.id
          ? {
              ...p,
              name,
              searchQuotaMonthly: toNum(planDraft.search, p.searchQuotaMonthly),
              digQuotaMonthly: toNum(planDraft.dig, p.digQuotaMonthly),
              unlockQuotaMonthly: toNum(planDraft.unlock, p.unlockQuotaMonthly),
            }
          : p
      );
      setPlans(next);
      await persistPlans(next);
      setMsg('套餐已更新');
    }
    setPlanDraft(null);
  };

  const handleAddDepartment = () => setDeptDraft({ mode: 'add', value: '' });

  const handleRenameDepartment = (id: string) => {
    const dept = departments.find((d) => d.id === id);
    if (!dept) return;
    setDeptDraft({ mode: 'rename', id, value: dept.name });
  };

  const handleSetDeptManager = (id: string) => {
    const dept = departments.find((d) => d.id === id);
    if (!dept) return;
    setDeptDraft({ mode: 'manager', id, value: dept.managerUsername || '' });
  };

  const submitDeptDraft = async () => {
    if (!deptDraft) return;
    const value = deptDraft.value.trim();

    if (deptDraft.mode === 'add') {
      if (!value) {
        setMsg('请输入部门名称');
        return;
      }
      const dept = createDepartment(value, { enterpriseId: selectedEnterpriseId });
      const next = [...departments, dept];
      setDepartments(next);
      await persistDepartments(next);
      setMsg(`部门「${dept.name}」已创建`);
      setDeptDraft(null);
      return;
    }

    if (deptDraft.mode === 'rename' && deptDraft.id) {
      if (!value) {
        setMsg('请输入部门名称');
        return;
      }
      const next = departments.map((d) => (d.id === deptDraft.id ? { ...d, name: value } : d));
      setDepartments(next);
      await persistDepartments(next);
      setMsg('部门名称已更新');
      setDeptDraft(null);
      return;
    }

    if (deptDraft.mode === 'manager' && deptDraft.id) {
      const mgr = value ? findUserByName(users, value) : undefined;
      if (value && !mgr) {
        setMsg('找不到该用户');
        return;
      }
      const nextDepts = departments.map((d) =>
        d.id === deptDraft.id ? { ...d, managerUsername: mgr?.username } : d
      );
      setDepartments(nextDepts);
      let nextUsers = users;
      if (mgr) {
        nextUsers = users.map((u) =>
          u.username === mgr.username
            ? {
                ...u,
                role: u.role === 'admin' ? 'admin' : 'manager',
                enterpriseId: selectedEnterpriseId,
                departmentId: deptDraft.id,
                permissions: effectivePermissions({
                  ...u,
                  role: u.role === 'admin' ? 'admin' : 'manager',
                }),
              }
            : u
        );
        setUsers(nextUsers);
      }
      await persistUsers(nextUsers, Date.now(), nextDepts);
      setMsg('部门主管已更新');
      setDeptDraft(null);
    }
  };

  const handleDeleteDepartment = async (id: string) => {
    if (!confirm('删除该部门？部门内用户将变为未分配部门。')) return;
    const nextDepts = departments.filter((d) => d.id !== id);
    const nextUsers = users.map((u) =>
      u.departmentId === id ? { ...u, departmentId: undefined } : u
    );
    setDepartments(nextDepts);
    setUsers(nextUsers);
    await persistUsers(nextUsers, Date.now(), nextDepts);
  };

  const deptsForUserForm = useMemo(() => {
    const ent = draftEnterpriseId || selectedEnterpriseId;
    return departments.filter((d) => (d.enterpriseId || DEFAULT_ENTERPRISE_ID) === ent);
  }, [departments, draftEnterpriseId, selectedEnterpriseId]);

  return (
    <div className="space-y-6 animate-fade-in">
      {canManageOrg && (
        <>
          {/* 企业 */}
          <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Briefcase className="text-indigo-600" /> 企业
              </h3>
              <button
                type="button"
                onClick={() => setEntDraft({ mode: 'add', value: '' })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
              >
                <Plus size={16} /> 新建企业
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {enterprises.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setSelectedEnterpriseId(e.id);
                    setFilterDeptId('');
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-black border transition-all ${
                    selectedEnterpriseId === e.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-indigo-200'
                  }`}
                >
                  {e.displayName || e.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-white border text-[11px] font-black text-slate-600"
                onClick={() => {
                  const cur = enterprises.find((e) => e.id === selectedEnterpriseId);
                  if (cur) setEntDraft({ mode: 'rename', id: cur.id, value: cur.name });
                }}
              >
                改名当前企业
              </button>
              {selectedEnterpriseId !== DEFAULT_ENTERPRISE_ID && (
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-[11px] font-black"
                  onClick={() => void handleDeleteEnterprise(selectedEnterpriseId)}
                >
                  删除当前企业
                </button>
              )}
            </div>
          </div>

          {/* 部门（挂靠当前企业） */}
          <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Building2 className="text-blue-600" /> 部门
                <span className="text-xs font-bold text-slate-400">
                  （
                  {enterprises.find((e) => e.id === selectedEnterpriseId)?.name || '企业'}
                  ）
                </span>
              </h3>
              <button
                type="button"
                onClick={handleAddDepartment}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
              >
                <Plus size={16} /> 新建部门
              </button>
            </div>
            {deptsInEnterprise.length === 0 ? (
              <p className="text-sm text-slate-400 font-bold">
                该企业下尚无部门。请先建部门，再给用户分配。
              </p>
            ) : (
              <div className="space-y-2">
                {deptsInEnterprise.map((d) => (
                  <div
                    key={d.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border ${
                      filterDeptId === d.id
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <button
                      type="button"
                      className="text-left"
                      onClick={() =>
                        setFilterDeptId((prev) => (prev === d.id ? '' : d.id))
                      }
                    >
                      <div className="font-black text-slate-800">{d.name}</div>
                      <div className="text-[11px] font-bold text-slate-400">
                        主管：{d.managerUsername || '未指定'} · 成员{' '}
                        {users.filter((u) => u.departmentId === d.id).length} 人
                        {filterDeptId === d.id ? ' · 已筛选' : ' · 点击筛选用户'}
                      </div>
                    </button>
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

          {/* 套餐（仅超管可改定义；总监可查看并给用户绑定） */}
          <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Package className="text-amber-600" /> 套餐额度
              </h3>
              {superAdmin && (
                <button
                  type="button"
                  onClick={() =>
                    setPlanDraft({
                      mode: 'add',
                      name: '',
                      search: '100',
                      dig: '50',
                      unlock: '50',
                    })
                  }
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> 新建套餐
                </button>
              )}
            </div>
            <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
              搜索 / 背调 / 主库解锁按月计量；-1 表示不限。未绑定套餐的账号不计量。背调结果写入主库，解锁额度用于取完整资料。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1"
                >
                  <div className="font-black text-slate-800 text-sm">{p.name}</div>
                  <div className="text-[10px] font-bold text-slate-500">
                    搜索 {p.searchQuotaMonthly < 0 ? '不限' : p.searchQuotaMonthly} · 背调{' '}
                    {p.digQuotaMonthly < 0 ? '不限' : p.digQuotaMonthly} · 解锁{' '}
                    {p.unlockQuotaMonthly < 0 ? '不限' : p.unlockQuotaMonthly}
                  </div>
                  {superAdmin && (
                    <button
                      type="button"
                      className="text-[11px] font-black text-amber-700 hover:underline"
                      onClick={() =>
                        setPlanDraft({
                          mode: 'edit',
                          id: p.id,
                          name: p.name,
                          search: String(p.searchQuotaMonthly),
                          dig: String(p.digQuotaMonthly),
                          unlock: String(p.unlockQuotaMonthly),
                        })
                      }
                    >
                      编辑
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 用户与权限（合并原「用户列表」） */}
      <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <UserCog className="text-violet-600" />{' '}
            {canManageOrg ? '用户与权限' : '下属权限管理'}
          </h3>
          {canManageOrg && (
            <button
              type="button"
              onClick={() => setAddUserOpen(true)}
              className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2"
            >
              <Plus size={16} /> 添加用户
            </button>
          )}
        </div>

        <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
          {canManageOrg
            ? '层级：企业 → 部门 → 用户。可见性：总监/超管看全部业务数据；部门主管看本部门；员工只看自己的。超管可配密钥与删库级能力；总监管理组织与用户，不可改系统密钥。'
            : '你只能调整本部门普通员工的功能权限与设备绑定，不能查看或修改其它部门与主管账号。'}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {manageableUsers.length === 0 ? (
              <div className="text-sm text-slate-400 font-bold p-3">暂无可管理用户</div>
            ) : (
              manageableUsers.map((u) => {
                const dept = departments.find((d) => d.id === u.departmentId);
                const plan = plans.find((p) => p.id === u.planId);
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
                      {plan ? ` · ${plan.name}` : ''}
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
                请选择左侧用户以编辑
              </div>
            ) : (
              <>
                {canManageOrg && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">
                        角色
                      </label>
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
                        <option value="director">总监管理员（全量业务）</option>
                        {superAdmin && <option value="admin">超级管理员</option>}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">
                        企业
                      </label>
                      <select
                        value={draftEnterpriseId}
                        onChange={(e) => {
                          setDraftEnterpriseId(e.target.value);
                          setDraftDeptId('');
                        }}
                        className="w-full mt-1 border rounded-xl px-3 py-2 text-sm font-bold"
                      >
                        {enterprises.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.displayName || e.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">
                        部门
                      </label>
                      <select
                        value={draftDeptId}
                        onChange={(e) => setDraftDeptId(e.target.value)}
                        className="w-full mt-1 border rounded-xl px-3 py-2 text-sm font-bold"
                      >
                        <option value="">未分配</option>
                        {deptsForUserForm.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">
                        套餐
                      </label>
                      <select
                        value={draftPlanId}
                        onChange={(e) => setDraftPlanId(e.target.value)}
                        className="w-full mt-1 border rounded-xl px-3 py-2 text-sm font-bold"
                      >
                        <option value="">不绑定（不计量）</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1 text-[10px] font-bold text-slate-400">
                        {describePlanUsage(selected, plans)}
                      </div>
                    </div>
                    <div className="flex items-end sm:col-span-2">
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
                    <span className="text-xs font-black text-slate-600 uppercase tracking-widest">
                      权限勾选
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                    {PERMISSION_CATALOG.map((p) => {
                      const locked = !canManageOrg && p.key === 'feature.manage_team_users';
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
                            <span className="block text-[10px] font-bold text-slate-400">
                              {p.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-[11px] font-black text-blue-600"
                      onClick={() =>
                        setDraftPerms(
                          defaultPermissionsForRole(canManageOrg ? draftRole : 'user')
                        )
                      }
                    >
                      恢复角色默认
                    </button>
                    <button
                      type="button"
                      className="text-[11px] font-black text-slate-500"
                      onClick={() =>
                        setDraftPerms(
                          [...ALL_PERMISSION_KEYS].filter(
                            (k) => canManageOrg || k !== 'feature.manage_team_users'
                          )
                        )
                      }
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
                    可为任意账户单独开关。开启后须登记 MAC 并锁定本机设备指纹。
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
                        <div
                          key={d.deviceId}
                          className="bg-white rounded-xl border border-slate-100 px-3 py-2"
                        >
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
                      <span className="text-xs font-black text-slate-600 uppercase tracking-widest">
                        可用时段
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={!!draftSchedule.enabled}
                        onChange={(e) =>
                          setDraftSchedule((s) => ({ ...s, enabled: e.target.checked }))
                        }
                      />
                      启用可用时段限制
                    </label>
                    <div className="text-[11px] font-bold text-slate-500">
                      当前：{describeSchedule(draftSchedule)}
                    </div>
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
                          onChange={(e) =>
                            setDraftSchedule((s) => ({ ...s, startTime: e.target.value }))
                          }
                          className="mt-1 w-full border rounded-xl px-3 py-2 text-sm font-bold bg-white"
                        />
                      </label>
                      <label className="text-[10px] font-black text-slate-400 uppercase">
                        结束
                        <input
                          type="time"
                          value={draftSchedule.endTime || '18:00'}
                          onChange={(e) =>
                            setDraftSchedule((s) => ({ ...s, endTime: e.target.value }))
                          }
                          className="mt-1 w-full border rounded-xl px-3 py-2 text-sm font-bold bg-white"
                        />
                      </label>
                    </div>
                    <label className="text-[10px] font-black text-slate-400 uppercase block">
                      时区
                      <select
                        value={draftSchedule.timezone || 'Asia/Shanghai'}
                        onChange={(e) =>
                          setDraftSchedule((s) => ({ ...s, timezone: e.target.value }))
                        }
                        className="mt-1 w-full border rounded-xl px-3 py-2 text-sm font-bold bg-white"
                      >
                        <option value="Asia/Shanghai">Asia/Shanghai（中国）</option>
                        <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveUser}
                    className="bg-slate-900 hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2"
                  >
                    <Save size={16} /> 保存
                  </button>
                  {canManageOrg && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setResetPwdUser(selected.username);
                          setResetPwdValue('');
                        }}
                        className="bg-blue-50 text-blue-700 px-4 py-3 rounded-xl font-black flex items-center gap-2 text-sm"
                      >
                        <KeyRound size={16} /> 重置密码
                      </button>
                      {selected.username !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteUser(selected.username)}
                          className="bg-red-50 text-red-600 px-4 py-3 rounded-xl font-black flex items-center gap-2 text-sm"
                        >
                          <Trash2 size={16} /> 删除用户
                        </button>
                      )}
                    </>
                  )}
                </div>
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
        enterprises={enterprises}
        plans={plans}
        defaultEnterpriseId={selectedEnterpriseId}
        allowRolePick
        allowAdminRole={superAdmin}
        onCreated={({ users: next, created }) => {
          setUsers(next);
          setMsg(`用户「${created.username}」已创建`);
          loadUser(created.username);
        }}
      />

      {deptDraft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <h4 className="text-base font-black text-slate-800">
              {deptDraft.mode === 'add'
                ? '新增部门'
                : deptDraft.mode === 'rename'
                  ? '重命名部门'
                  : '指定部门主管'}
            </h4>
            <input
              type="text"
              value={deptDraft.value}
              onChange={(e) => setDeptDraft({ ...deptDraft, value: e.target.value })}
              placeholder={
                deptDraft.mode === 'manager' ? '主管用户名（留空则清除）' : '部门名称'
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitDeptDraft();
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeptDraft(null)}
                className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitDeptDraft()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {entDraft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <h4 className="text-base font-black text-slate-800">
              {entDraft.mode === 'add' ? '新建企业' : '重命名企业'}
            </h4>
            <input
              type="text"
              value={entDraft.value}
              onChange={(e) => setEntDraft({ ...entDraft, value: e.target.value })}
              placeholder="企业名称"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitEntDraft();
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEntDraft(null)}
                className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitEntDraft()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {planDraft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <h4 className="text-base font-black text-slate-800">
              {planDraft.mode === 'add' ? '新建套餐' : '编辑套餐'}
            </h4>
            <label className="block text-[10px] font-black text-slate-400 uppercase">
              名称
              <input
                type="text"
                value={planDraft.name}
                onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-bold"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['search', '搜索/月'],
                  ['dig', '背调/月'],
                  ['unlock', '解锁/月'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="block text-[10px] font-black text-slate-400 uppercase">
                  {label}
                  <input
                    type="number"
                    value={planDraft[k]}
                    onChange={(e) => setPlanDraft({ ...planDraft, [k]: e.target.value })}
                    className="mt-1 w-full rounded-xl border px-2 py-2 text-sm font-bold"
                    title="-1 表示不限"
                  />
                </label>
              ))}
            </div>
            <p className="text-[10px] font-bold text-slate-400">填 -1 表示该额度不限</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPlanDraft(null)}
                className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitPlanDraft()}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {resetPwdUser && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <h4 className="text-base font-black text-slate-800">
              重置密码 · {resetPwdUser}
            </h4>
            <input
              type="password"
              value={resetPwdValue}
              onChange={(e) => setResetPwdValue(e.target.value)}
              placeholder="新密码（至少 6 位）"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetPwdUser(null)}
                className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitResetPassword()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
