import { User, Department } from '../types';
import { isSupabaseConfigured, fetchAppUsersFromCloud, saveAppUsersToCloud } from './supabase';
import { fetchUsersFromCloud, saveUsersToCloud } from './githubService';
import { loadDepartmentsFromStorage, saveDepartmentsToStorage, getDepartmentsUpdatedAt } from './orgStore';
import { defaultPermissionsForRole } from './permissions';

const USERS_KEY = 'trade_scout_users';
const USERS_UPDATED_KEY = 'trade_scout_users_updated_at';

const PBKDF2_PREFIX = 'pbkdf2$';
const PBKDF2_ITERATIONS = 120_000;

const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** 旧版无盐 SHA-256（仅用于校验兼容） */
async function hashPasswordLegacySha256(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return toHex(buf);
}

/** 新密码：PBKDF2-SHA256 + 随机盐（格式 pbkdf2$iter$saltHex$hashHex） */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

async function verifyPbkdf2(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]) || PBKDF2_ITERATIONS;
  const salt = fromHex(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits) === expected;
}

export async function verifyPassword(password: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) return false;
  if (storedHash.startsWith(PBKDF2_PREFIX)) return verifyPbkdf2(password, storedHash);
  // 兼容旧 SHA-256
  return (await hashPasswordLegacySha256(password)) === storedHash;
}

/** 是否仍为常见默认口令（兼容新旧哈希） */
export async function isPasswordDefault(passwordHash: string | undefined, plain: string): Promise<boolean> {
  if (!passwordHash) return true;
  return verifyPassword(plain, passwordHash);
}

/** 登录成功后若仍是旧哈希，透明升级为 PBKDF2 */
export async function upgradePasswordHashIfNeeded(
  users: User[],
  username: string,
  plainPassword: string
): Promise<User[]> {
  const user = findUserByName(users, username);
  if (!user?.password || user.password.startsWith(PBKDF2_PREFIX)) return users;
  const ok = await verifyPassword(plainPassword, user.password);
  if (!ok) return users;
  const next = updateUserPassword(users, username, await hashPassword(plainPassword));
  await persistUsers(next);
  return next;
}

export function loadUsersFromStorage(): User[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getUsersUpdatedAt(): number {
  const n = Number(localStorage.getItem(USERS_UPDATED_KEY) || 0);
  return Number.isFinite(n) ? n : 0;
}

export function saveUsersToStorage(users: User[], updatedAt: number = Date.now()): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  localStorage.setItem(USERS_UPDATED_KEY, String(updatedAt));
}

/** 规范化旧用户结构 */
export function normalizeUser(u: User): User {
  const role: User['role'] =
    u.role === 'admin' || u.role === 'director' || u.role === 'manager' ? u.role : 'user';
  const deviceBindRequired =
    u.deviceBindRequired === true
      ? true
      : u.deviceBindRequired === false
        ? false
        : role === 'user';
  return {
    ...u,
    role,
    permissions:
      u.permissions !== undefined && u.permissions !== null
        ? u.permissions
        : defaultPermissionsForRole(role),
    departmentId: u.departmentId || undefined,
    disabled: !!u.disabled,
    deviceBindRequired,
    boundDevices: Array.isArray(u.boundDevices) ? u.boundDevices : [],
    accessSchedule: u.accessSchedule || undefined,
  };
}

export function normalizeUsers(users: User[]): User[] {
  return users.map(normalizeUser);
}

const withTimeout = async <T,>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T | null> => {
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        setTimeout(() => {
          console.warn(`${label} timed out after ${ms}ms`);
          resolve(null);
        }, ms);
      }),
    ]);
  } catch (e) {
    console.warn(label, e);
    return null;
  }
};

/** 本地立刻落盘；云端后台限时同步，避免后台「添加用户」假死 */
const syncUsersToCloudBackground = (
  normalized: User[],
  updatedAt: number,
  depts: Department[]
) => {
  void (async () => {
    if (isSupabaseConfigured()) {
      await withTimeout(
        saveAppUsersToCloud(normalized, updatedAt, depts),
        8_000,
        'Supabase 用户同步'
      );
    }
    await withTimeout(saveUsersToCloud(normalized), 8_000, 'GitHub 用户同步');
  })();
};

/** 本地 + 云端（Supabase / GitHub）持久化。本地同步完成即返回，不阻塞 UI。 */
export async function persistUsers(
  users: User[],
  updatedAt: number = Date.now(),
  departments?: Department[]
): Promise<User[]> {
  const normalized = normalizeUsers(users);
  saveUsersToStorage(normalized, updatedAt);
  const depts = departments ?? loadDepartmentsFromStorage();
  saveDepartmentsToStorage(depts, updatedAt);
  syncUsersToCloudBackground(normalized, updatedAt, depts);
  return normalized;
}

export async function persistDepartments(departments: Department[], updatedAt: number = Date.now()): Promise<Department[]> {
  saveDepartmentsToStorage(departments, updatedAt);
  const users = loadUsersFromStorage();
  await persistUsers(users, updatedAt, departments);
  return departments;
}

export function findUserByName(users: User[], username: string): User | undefined {
  const key = username.trim().toLowerCase();
  return users.find(u => u.username.trim().toLowerCase() === key);
}

/** 为旧数据中没有 password 的默认账号补哈希（仅 admin / user） */
export async function ensureUserPasswords(users: User[]): Promise<User[]> {
  const legacy: Record<string, string> = { admin: 'admin123', user: 'user123' };
  return Promise.all(
    users.map(async (u) => {
      if (u.password?.trim()) return u;
      const pwd = legacy[u.username.trim().toLowerCase()];
      if (!pwd) return u;
      return { ...u, password: await hashPassword(pwd), isFirstLogin: true };
    })
  );
}

async function fetchGitHubUsersBundle(): Promise<{ users: User[]; updatedAt: number } | null> {
  try {
    const users = await fetchUsersFromCloud();
    if (!users?.length) return null;
    // GitHub 无独立时间戳时用用户 createdAt 最大值近似
    const updatedAt = Math.max(0, ...users.map((u) => u.createdAt || 0));
    return { users, updatedAt };
  } catch {
    return null;
  }
}

async function isStillDefaultPasswords(users: User[]): Promise<boolean> {
  const admin = findUserByName(users, 'admin');
  if (!admin?.password) return true;
  // 只要 admin 仍是默认密码，视为「未定制」
  if (!(await isPasswordDefault(admin.password, 'admin123'))) return false;
  if (users.some((u) => u.username.trim().toLowerCase() !== 'admin' && u.username.trim().toLowerCase() !== 'user')) {
    return false;
  }
  const user = findUserByName(users, 'user');
  if (user?.password && !(await isPasswordDefault(user.password, 'user123'))) return false;
  return true;
}

/**
 * 合并本地与云端用户：以「更新时间更新」的一方为准。
 * 解决手机/电脑各自 localStorage 导致账号密码不一致。
 */
export async function syncUsersAcrossDevices(): Promise<User[]> {
  let local = loadUsersFromStorage();
  let localAt = getUsersUpdatedAt();
  let localDepts = loadDepartmentsFromStorage();

  if (local.length === 0) {
    local = await createDefaultUsers();
    localAt = Date.now();
    saveUsersToStorage(local, localAt);
  } else {
    const migrated = normalizeUsers(await ensureUserPasswords(local));
    if (JSON.stringify(migrated) !== JSON.stringify(local)) {
      local = migrated;
      localAt = Date.now();
      saveUsersToStorage(local, localAt);
    }
  }

  let cloud: { users: User[]; departments?: Department[]; updatedAt: number } | null = null;
  if (isSupabaseConfigured()) {
    cloud = await fetchAppUsersFromCloud();
  }
  if (!cloud?.users?.length) {
    cloud = await fetchGitHubUsersBundle();
  }

  if (cloud?.users?.length) {
    const cloudUsers = normalizeUsers(await ensureUserPasswords(cloud.users));
    const cloudDepts = Array.isArray(cloud.departments) ? cloud.departments : [];
    const localDefault = await isStillDefaultPasswords(local);
    const cloudDefault = await isStillDefaultPasswords(cloudUsers);

    if (!localDefault && cloudDefault) {
      await persistUsers(local, Date.now(), localDepts);
      return local;
    }
    if (localDefault && !cloudDefault) {
      saveUsersToStorage(cloudUsers, cloud.updatedAt || Date.now());
      if (cloudDepts.length) saveDepartmentsToStorage(cloudDepts, cloud.updatedAt || Date.now());
      return cloudUsers;
    }

    if (cloud.updatedAt >= localAt) {
      saveUsersToStorage(cloudUsers, cloud.updatedAt || Date.now());
      if (cloudDepts.length || getDepartmentsUpdatedAt() <= (cloud.updatedAt || 0)) {
        saveDepartmentsToStorage(cloudDepts, cloud.updatedAt || Date.now());
      }
      return cloudUsers;
    }
  }

  if (local.length) {
    await persistUsers(local, localAt || Date.now(), localDepts);
  }
  return local;
}

export async function loadUsersWithMigration(): Promise<User[]> {
  try {
    return await syncUsersAcrossDevices();
  } catch (e) {
    console.error('用户同步失败，回退本地', e);
    const stored = loadUsersFromStorage();
    if (stored.length === 0) {
      const defaults = await createDefaultUsers();
      saveUsersToStorage(defaults);
      return defaults;
    }
    const migrated = await ensureUserPasswords(stored);
    if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
      saveUsersToStorage(migrated);
    }
    return migrated;
  }
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const trimmedUser = username.trim();
  const trimmedPwd = password.trim();
  if (!trimmedUser || !trimmedPwd) return null;

  // 登录前先拉云端，避免手机/电脑仍用各自旧密码
  let users = loadUsersFromStorage();
  try {
    users = await syncUsersAcrossDevices();
  } catch (e) {
    console.warn('登录前同步用户失败，使用本地账号', e);
    if (!users.length) users = await loadUsersWithMigration();
  }

  const user = findUserByName(users, trimmedUser);
  if (!user?.password?.trim()) return null;
  if (user.disabled) return null;
  const ok = await verifyPassword(trimmedPwd, user.password);
  if (!ok) return null;

  let nextUsers = users;
  if (!user.password.startsWith(PBKDF2_PREFIX)) {
    nextUsers = await upgradePasswordHashIfNeeded(users, trimmedUser, trimmedPwd);
  }

  const fresh = findUserByName(nextUsers, trimmedUser) || user;
  // 默认口令强制提示改密（不阻断登录，由 UI 引导）
  const mustChangePassword =
    fresh.isFirstLogin ||
    (await isPasswordDefault(fresh.password, 'admin123')) ||
    (await isPasswordDefault(fresh.password, 'user123'));

  return normalizeUser({ ...fresh, isFirstLogin: mustChangePassword ? true : fresh.isFirstLogin });
}

export function updateUserPassword(users: User[], username: string, hashedPassword: string): User[] {
  const key = username.trim().toLowerCase();
  return users.map(u =>
    u.username.trim().toLowerCase() === key
      ? { ...u, password: hashedPassword, isFirstLogin: false }
      : u
  );
}

/** 用户主动改密 */
export async function changeUserPassword(
  username: string,
  oldPassword: string,
  newPassword: string
): Promise<{ ok: boolean; message: string; users?: User[] }> {
  const users = loadUsersFromStorage();
  const user = findUserByName(users, username);
  if (!user?.password) return { ok: false, message: '用户不存在' };
  if (!(await verifyPassword(oldPassword, user.password))) {
    return { ok: false, message: '原密码不正确' };
  }
  if (!newPassword || newPassword.trim().length < 8) {
    return { ok: false, message: '新密码至少 8 位' };
  }
  if (['admin123', 'user123'].includes(newPassword.trim())) {
    return { ok: false, message: '请勿使用系统默认密码' };
  }
  const next = updateUserPassword(users, username, await hashPassword(newPassword.trim()));
  await persistUsers(next);
  return { ok: true, message: '密码已更新', users: next };
}

export async function createDefaultUsers(): Promise<User[]> {
  const now = Date.now();
  return normalizeUsers([
    {
      username: 'admin',
      role: 'admin',
      password: await hashPassword('admin123'),
      isFirstLogin: true,
      createdAt: now,
    },
    {
      username: 'user',
      role: 'user',
      password: await hashPassword('user123'),
      isFirstLogin: true,
      createdAt: now,
    },
  ]);
}
