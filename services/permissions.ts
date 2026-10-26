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
  { key: 'module.home', label: '今日看板', group: '模块', description: '登录落地：任务流 + 行业新闻 / 新品 / 汇率' },
  { key: 'module.discovery', label: '客户搜索', group: '模块', description: '发现潜在客户列表' },
  { key: 'module.background', label: '背景调查', group: '模块', description: '查看公司背调报告' },
  { key: 'module.products', label: '产品分析', group: '模块', description: '查看产品分析页' },
  { key: 'module.decision_makers', label: '决策人挖掘', group: '模块', description: '查看决策人；普通员工邮箱脱敏为 *，仅主管/总管/管理员可见完整邮箱' },
  { key: 'module.strategy', label: '开发策略', group: '模块', description: '策略对话与开发信' },
  { key: 'module.similar', label: '同类推荐', group: '模块', description: '相似公司推荐' },
  { key: 'module.client_crm', label: '客户管理 CRM', group: '模块', description: 'CRM 客户列表' },
  { key: 'module.email_campaign', label: '邮件营销', group: '模块', description: '邮件群发/开发信' },
  { key: 'module.image_generator', label: '海报/生图', group: '模块', description: '海报与万相生图' },
  { key: 'module.promo_generator', label: '营销工具', group: '模块', description: '营销辅助工具' },
  { key: 'module.product_match', label: '新品匹配', group: '模块', description: '用我方新品匹配已背调客户产品库' },
  { key: 'module.buyer_library', label: '自有买家库（后台）', group: '模块', description: '后台数据库；客户搜索命中时优先调用，前台无独立入口' },
  { key: 'module.customs_intel', label: '海关情报（后台）', group: '模块', description: '后台海关/提单缓存；客户搜索命中时优先调用，前台无独立入口' },
  { key: 'module.product_catalog', label: '产品库', group: '模块', description: 'SKU 主数据；小竹熊/霄鸟云同步在管理后台' },
  { key: 'module.product_quote', label: '报价选品单', group: '模块', description: '从产品库生成报价/选品/PI 草稿' },
  { key: 'module.product_design_2d', label: '产品平面设计', group: '模块', description: '产品板块 · 平面图生成' },
  { key: 'module.product_design_3d', label: '产品 3D 设计', group: '模块', description: '产品板块 · 3D 图生成' },
  { key: 'module.product_3d_print', label: '3D 打印', group: '模块', description: '产品板块 · 3D 打印交付' },
  { key: 'module.product_ai_video', label: '产品 AI 视频', group: '模块', description: '产品板块 · 故事短剧视频' },
  { key: 'module.site_builder', label: '网站设计开发', group: '模块', description: '宣发板块 · 对话建站与模板预览' },
  { key: 'module.social_content', label: '发文素材', group: '模块', description: '宣发板块 · 社媒发文加工' },
  { key: 'module.whatsapp', label: '联系工具', group: '模块', description: '联动板块 · WhatsApp / Skype / 微信等官方登录' },
  { key: 'module.email_sequence', label: '序列开发信（已并入开发策略）', group: '模块', description: '已下线导航；请使用开发策略生成开发信' },
  { key: 'module.eco_parts', label: '产品配件', group: '模块', description: '生态板块 · 配件' },
  { key: 'module.eco_merch', label: '产品周边', group: '模块', description: '生态板块 · 周边' },
  { key: 'module.eco_cert', label: '产品认证', group: '模块', description: '生态板块 · 认证' },
  { key: 'module.eco_audit', label: '验厂机构', group: '模块', description: '生态板块 · 验厂' },
  { key: 'module.eco_delivery', label: '交付出货', group: '模块', description: '生态板块 · 出货' },
  { key: 'feature.search_clients', label: '执行客户搜索', group: '功能', description: '发起联网搜索客户' },
  { key: 'feature.product_redig', label: '产品品类补做', group: '功能', description: '仅对旧背调缺品类/价格的客户补采；新背调已自动含品类' },
  { key: 'feature.analyze_company', label: '单次背调', group: '功能', description: '对单个公司做背调' },
  { key: 'feature.batch_analyze', label: '批量背调', group: '功能', description: '批量/队列背调任务' },
  { key: 'feature.dm_email_search', label: '决策人邮箱搜索', group: '功能', description: '后台搜索邮箱（员工可搜索但只能看 *；完整邮箱仅本部门主管及以上可见）' },
  { key: 'feature.export_report', label: '导出 Excel', group: '功能', description: '导出联系人 Excel 等' },
  { key: 'feature.export_ppt', label: '下载 PPT 报告', group: '功能', description: '下载背调 PPT 报告' },
  { key: 'feature.crm_manage', label: 'CRM 编辑', group: '功能', description: '新增/修改 CRM 客户' },
  { key: 'feature.crm_pool', label: 'CRM 公海', group: '功能', description: '公海领取/回收（后续上线）' },
  { key: 'feature.crm_dedupe', label: 'CRM 查重', group: '功能', description: '客户智能查重（后续上线）' },
  { key: 'feature.product_catalog_sync', label: '产品库同步', group: '功能', description: '管理后台从小竹熊/霄鸟云同步 SKU（对接后上线）' },
  { key: 'feature.quote_manage', label: '报价单管理', group: '功能', description: '创建/导出报价与选品单（后续上线）' },
  { key: 'feature.records_center', label: '记录中心', group: '功能', description: '查看历史搜索与背调记录' },
  { key: 'feature.manage_team_users', label: '管理下属权限', group: '功能', description: '部门主管调整下属功能权限' },
];

const MODULE_TO_PERM: Record<ModuleType, PermissionKey> = {
  [ModuleType.HOME]: 'module.home',
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
  [ModuleType.PRODUCT_MATCH]: 'module.product_match',
  [ModuleType.BUYER_LIBRARY]: 'module.buyer_library',
  [ModuleType.CUSTOMS_INTEL]: 'module.customs_intel',
  [ModuleType.PRODUCT_CATALOG]: 'module.product_catalog',
  [ModuleType.PRODUCT_QUOTE]: 'module.product_quote',
  [ModuleType.PRODUCT_DESIGN_2D]: 'module.product_design_2d',
  [ModuleType.PRODUCT_DESIGN_3D]: 'module.product_design_3d',
  [ModuleType.PRODUCT_3D_PRINT]: 'module.product_3d_print',
  [ModuleType.PRODUCT_AI_VIDEO]: 'module.product_ai_video',
  [ModuleType.SITE_BUILDER]: 'module.site_builder',
  [ModuleType.SOCIAL_CONTENT]: 'module.social_content',
  [ModuleType.WHATSAPP]: 'module.whatsapp',
  [ModuleType.EMAIL_SEQUENCE]: 'module.email_sequence',
  [ModuleType.ECO_PARTS]: 'module.eco_parts',
  [ModuleType.ECO_MERCH]: 'module.eco_merch',
  [ModuleType.ECO_CERT]: 'module.eco_cert',
  [ModuleType.ECO_AUDIT]: 'module.eco_audit',
  [ModuleType.ECO_DELIVERY]: 'module.eco_delivery',
};

/** 新员工默认权限：不含邮箱搜索、PPT 下载等需管理员显式开通的功能 */
const USER_BASELINE: PermissionKey[] = [
  'module.home',
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
  'module.product_match',
  'module.buyer_library',
  'module.customs_intel',
  'module.product_catalog',
  'module.product_quote',
  'module.product_design_2d',
  'module.product_design_3d',
  'module.product_3d_print',
  'module.product_ai_video',
  'module.site_builder',
  'module.social_content',
  'module.whatsapp',
  'module.email_sequence',
  'module.eco_parts',
  'module.eco_merch',
  'module.eco_cert',
  'module.eco_audit',
  'module.eco_delivery',
  'feature.search_clients',
  'feature.analyze_company',
  'feature.product_redig',
  'feature.records_center',
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

/** 平台升级新增模块权限（旧账号本地 permissions 数组可能缺失，运行时软补齐） */
const PLATFORM_V2_MODULE_KEYS: PermissionKey[] = [
  'module.home',
  'module.buyer_library',
  'module.customs_intel',
  'module.product_catalog',
  'module.product_quote',
  'module.product_design_2d',
  'module.product_design_3d',
  'module.product_3d_print',
  'module.product_ai_video',
  'module.site_builder',
  'module.social_content',
  'module.whatsapp',
  'module.email_sequence',
  'module.eco_parts',
  'module.eco_merch',
  'module.eco_cert',
  'module.eco_audit',
  'module.eco_delivery',
];

/** 可浏览全部部门业务数据（系统管理员 / 总管） */
export const canBrowseAllDepartments = (user: User | null | undefined): boolean => {
  if (!user || user.disabled) return false;
  return user.role === 'admin' || user.role === 'director';
};

export const defaultPermissionsForRole = (role: UserRole): PermissionKey[] => {
  if (role === 'admin' || role === 'director' || role === 'manager') return [...ALL_PERMISSION_KEYS];
  return [...USER_BASELINE];
};

/** 旧权限列表软升级：已有核心模块的账号自动补齐新导航权限（不改存储，仅运行时） */
const withPlatformV2Modules = (perms: PermissionKey[]): PermissionKey[] => {
  const next = [...new Set(perms)];
  const hasCore =
    next.includes('module.discovery') ||
    next.includes('module.client_crm') ||
    next.includes('module.image_generator');
  if (!hasCore) return next;
  for (const k of PLATFORM_V2_MODULE_KEYS) {
    if (!next.includes(k)) next.push(k);
  }
  return next;
};

export const effectivePermissions = (user: User): PermissionKey[] => {
  if (user.role === 'admin') return [...ALL_PERMISSION_KEYS];
  if (user.permissions !== undefined && user.permissions !== null) {
    return withPlatformV2Modules([...user.permissions]);
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

const sameUser = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** 同部门用户名列表（含主管，不含停用账号与跨部门） */
export const getDepartmentMemberUsernames = (
  departmentId: string | undefined,
  allUsers: User[]
): string[] => {
  if (!departmentId) return [];
  return allUsers
    .filter((u) => !u.disabled && u.departmentId === departmentId)
    .map((u) => u.username);
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
    sameUser(dept.managerUsername, manager.username);
  if (!isDeptManager && dept?.managerUsername) {
    // 若部门指定了其它主管，当前人不能管人
  }
  return allUsers
    .filter((u) => {
      if (u.disabled) return false;
      if (sameUser(u.username, manager.username)) return false;
      if (u.departmentId !== manager.departmentId) return false;
      if (u.role !== 'user') return false; // 员工看不到/管不到主管；主管也不互管
      return true;
    })
    .map((u) => u.username);
};

/**
 * 记录可见性（按你规定的部门隔离）：
 * - admin / director（总管）：全部部门
 * - 本部门主管：本部门全部记录（含本部门员工的），其它部门不可见
 * - 部门员工：仅本人创建的记录；看不到主管及其它人的记录
 * - 无归属旧数据：仅 admin / director 可见（避免串部门）；加载时会尝试回填部门
 */
export const canViewOwnedRecord = (
  viewer: User,
  record: OwnedRecordMeta,
  allUsers: User[],
  departments: Department[] = []
): boolean => {
  if (!viewer || viewer.disabled) return false;
  if (canBrowseAllDepartments(viewer)) return true;

  const owner = (record.ownerUsername || '').trim();
  const recordDept = (record.departmentId || '').trim();

  // 无归属旧数据：普通员工/其它部门主管不可见（仅总管/管理员可见，见上方）
  if (!owner && !recordDept) return false;

  // 部门主管：本部门全部（含员工）。无 departmentId 时尝试用「部门主管」任命反查部门。
  if (viewer.role === 'manager') {
    const deptId =
      (viewer.departmentId || '').trim() ||
      departments.find((d) => sameUser(d.managerUsername, viewer.username))?.id ||
      '';
    if (!deptId) {
      return sameUser(owner, viewer.username);
    }
    if (recordDept && recordDept === deptId) return true;
    if (sameUser(owner, viewer.username)) return true;
    if (owner) {
      const ownerUser = allUsers.find((u) => sameUser(u.username, owner));
      if (ownerUser && !ownerUser.disabled && (ownerUser.departmentId || '') === deptId) {
        return true;
      }
      const members = getDepartmentMemberUsernames(deptId, allUsers).map((s) => s.toLowerCase());
      if (members.includes(owner.toLowerCase())) return true;
    }
    return false;
  }

  // 部门员工：只能看自己的
  if (viewer.role === 'user') {
    return sameUser(owner, viewer.username);
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
  if (role === 'director') return '总管';
  if (role === 'manager') return '部门主管';
  return '部门员工';
};

/** 管理员 / 总管 / 部门主管可查看完整决策人邮箱；普通员工一律脱敏为 * */
export const canViewFullDecisionMakerEmails = (user: User | null | undefined): boolean => {
  if (!user || user.disabled) return false;
  return user.role === 'admin' || user.role === 'director' || user.role === 'manager';
};

/**
 * 邮箱脱敏（普通员工）：用 * 表示，不暴露本地名与域名细节。
 * 例：john.doe@acme.com → ******
 */
export const maskEmailAddress = (email?: string): string => {
  const raw = (email || '').trim();
  if (!raw) return '';
  return '******';
};

/**
 * 邮箱来源平台缩写：AnymailFinder→A，Hunter→H，Findymail→F，Manual→M，AI→AI
 */
export const abbreviateEmailPlatform = (source?: string): string => {
  const s = (source || '').trim();
  if (!s) return '?';
  const lower = s.toLowerCase();
  if (lower.includes('anymail')) return 'A';
  if (lower.includes('hunter')) return 'H';
  if (lower.includes('findy')) return 'F';
  if (lower === 'manual' || lower.includes('手动')) return 'M';
  if (lower.includes('pattern') || lower === 'ai' || lower.startsWith('ai ')) return 'AI';
  // 其它来源：取首个字母/汉字
  const letter = s.replace(/[^A-Za-z\u4e00-\u9fa5]/g, '').charAt(0);
  return letter ? letter.toUpperCase() : '?';
};
