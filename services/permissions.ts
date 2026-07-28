/**
 * 模块 / 功能权限定义与校验
 */
import { ModuleType, type Department, type PermissionKey, type User, type UserRole } from '../types';

export const PERMISSION_CATALOG: Array<{
  key: PermissionKey;
  label: string;
  group: '模块' | '功能';
  description: string;
}> = [
  { key: 'module.discovery', label: '客户搜索', group: '模块', description: '发现潜在客户列表' },
  { key: 'module.background', label: '背景调查', group: '模块', description: '查看公司背调报告' },
  { key: 'module.products', label: '产品分析', group: '模块', description: '查看产品分析页' },
  { key: 'module.decision_makers', label: '决策人挖掘', group: '模块', description: '查看决策人与邮箱' },
  { key: 'module.strategy', label: '开发策略', group: '模块', description: '策略对话与开发信' },
  { key: 'module.similar', label: '同类推荐', group: '模块', description: '相似公司推荐' },
  { key: 'module.client_crm', label: '客户管理 CRM', group: '模块', description: 'CRM 客户列表' },
  { key: 'module.email_campaign', label: '邮件营销', group: '模块', description: '邮件群发/开发信' },
  { key: 'module.image_generator', label: '海报/生图', group: '模块', description: '海报与万相生图' },
  { key: 'module.promo_generator', label: '营销工具', group: '模块', description: '营销辅助工具' },
  { key: 'feature.search_clients', label: '执行客户搜索', group: '功能', description: '发起联网搜索客户' },
  { key: 'feature.analyze_company', label: '单次背调', group: '功能', description: '对单个公司做背调' },
  { key: 'feature.batch_analyze', label: '批量背调', group: '功能', description: '批量/队列背调任务' },
  { key: 'feature.dm_email_search', label: '决策人邮箱搜索', group: '功能', description: '后台 Anymail 搜索邮箱' },
  { key: 'feature.export_report', label: '导出 Excel', group: '功能', description: '导出联系人 Excel 等' },
  { key: 'feature.export_ppt', label: '下载 PPT 报告', group: '功能', description: '下载背调 PPT 报告' },
  { key: 'feature.crm_manage', label: 'CRM 编辑', group: '功能', description: '新增/修改 CRM 客户' },
  { key: 'feature.records_center', label: '记录中心', group: '功能', description: '查看历史搜索与背调记录' },
  { key: 'feature.manage_team_users', label: '管理下属权限', group: '功能', description: '部门主管调整下属功能权限' },
];

const MODULE_TO_PERM: Record<ModuleType, PermissionKey> = {
  [ModuleType.DISCOVERY]: 'module.discovery',
  [ModuleType.BACKGROUND]: 'module.background',
  [ModuleType.PRODUCTS]: 'module.products',
  [ModuleType.DECISION_MAKERS]: 'module.decision_makers',
  [ModuleType.STRATEGY]: 'module.strategy',
  [ModuleType.SIMILAR]: 'module.similar',
  [ModuleType.CLIENT_CRM]: 'module.client_crm',
  [ModuleType.EMAIL_CAMPAIGN]: 'module.email_campaign',
  [ModuleType.IMAGE_GENERATOR]: 'module.image_generator',
  [ModuleType.PROMO_GENERATOR]: 'module.promo_generator',
};

/** 新员工默认权限：不含邮箱搜索、PPT 下载等需管理员显式开通的功能 */
const USER_BASELINE: PermissionKey[] = [
  'module.discovery',
  'module.background',
  'module.products',
  'module.decision_makers',
  'module.strategy',
  'module.similar',
  'module.client_crm',
  'module.email_campaign',
  'module.image_generator',
  'module.promo_generator',
  'feature.search_clients',
  'feature.analyze_company',
  'feature.records_center',
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

export const defaultPermissionsForRole = (role: UserRole): PermissionKey[] => {
  if (role === 'admin') return [...ALL_PERMISSION_KEYS];
  if (role === 'manager') return [...ALL_PERMISSION_KEYS];
  return [...USER_BASELINE];
};

export const effectivePermissions = (user: User): PermissionKey[] => {
  if (user.role === 'admin') return [...ALL_PERMISSION_KEYS];
  if (user.permissions !== undefined && user.permissions !== null) {
    return [...new Set(user.permissions)];
  }
  return defaultPermissionsForRole(user.role);
};

export const hasPermission = (user: User | null | undefined, key: PermissionKey): boolean => {
  if (!user || user.disabled) return false;
  if (user.role === 'admin') return true;
  return effectivePermissions(user).includes(key);
};

export const canAccessModule = (user: User | null | undefined, mod: ModuleType): boolean => {
  const key = MODULE_TO_PERM[mod];
  return key ? hasPermission(user, key) : false;
};

export type OwnedRecordMeta = {
  ownerUsername?: string;
  departmentId?: string;
};

/** 部门下属（仅普通员工，不含主管本人与其它主管） */
export const getSubordinateUsernames = (
  manager: User,
  allUsers: User[],
  departments: Department[]
): string[] => {
  if (manager.role !== 'manager' || !manager.departmentId) return [];
  const dept = departments.find((d) => d.id === manager.departmentId);
  // 必须以该主管为部门主管，或同部门员工
  const isDeptManager =
    !dept?.managerUsername ||
    dept.managerUsername.trim().toLowerCase() === manager.username.trim().toLowerCase();
  if (!isDeptManager && dept?.managerUsername) {
    // 若部门指定了其它主管，当前人不能管人
  }
  return allUsers
    .filter((u) => {
      if (u.disabled) return false;
      if (u.username.trim().toLowerCase() === manager.username.trim().toLowerCase()) return false;
      if (u.departmentId !== manager.departmentId) return false;
      if (u.role !== 'user') return false; // 员工看不到/管不到主管；主管也不互看
      return true;
    })
    .map((u) => u.username);
};

/**
 * 记录可见性：
 * - admin：全部
 * - 本人：可见
 * - 部门主管：可见本部门普通员工记录（不可见其它主管/管理员记录）
 * - 普通员工：仅本人（不可见主管操作记录）
 * - 无归属的旧数据：仅 admin 可见（避免串部门）
 */
export const canViewOwnedRecord = (
  viewer: User,
  record: OwnedRecordMeta,
  allUsers: User[],
  departments: Department[] = []
): boolean => {
  if (!viewer || viewer.disabled) return false;
  if (viewer.role === 'admin') return true;

  const owner = (record.ownerUsername || '').trim();
  if (!owner) return false;

  if (owner.toLowerCase() === viewer.username.trim().toLowerCase()) return true;

  if (viewer.role === 'manager' && viewer.departmentId) {
    const subs = getSubordinateUsernames(viewer, allUsers, departments).map((s) => s.toLowerCase());
    return subs.includes(owner.toLowerCase());
  }

  return false;
};

export const filterOwnedRecords = <T extends OwnedRecordMeta>(
  viewer: User,
  records: T[],
  allUsers: User[],
  departments: Department[] = []
): T[] => records.filter((r) => canViewOwnedRecord(viewer, r, allUsers, departments));

export const roleLabel = (role: UserRole): string => {
  if (role === 'admin') return '系统管理员';
  if (role === 'manager') return '部门主管';
  return '部门员工';
};
