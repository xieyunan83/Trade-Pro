import { User } from '../types';

const USERS_KEY = 'trade_scout_users';

export async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) return false;
  return (await hashPassword(password)) === storedHash;
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

export function saveUsersToStorage(users: User[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
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

export async function loadUsersWithMigration(): Promise<User[]> {
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

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const trimmedUser = username.trim();
  const trimmedPwd = password.trim();
  if (!trimmedUser || !trimmedPwd) return null;

  const users = loadUsersFromStorage();
  let user = findUserByName(users, trimmedUser);

  if (!user) {
    const migrated = await loadUsersWithMigration();
    user = findUserByName(migrated, trimmedUser);
  }

  if (!user?.password?.trim()) return null;
  const ok = await verifyPassword(trimmedPwd, user.password);
  return ok ? user : null;
}

export function updateUserPassword(users: User[], username: string, hashedPassword: string): User[] {
  const key = username.trim().toLowerCase();
  return users.map(u =>
    u.username.trim().toLowerCase() === key ? { ...u, password: hashedPassword } : u
  );
}

export async function createDefaultUsers(): Promise<User[]> {
  const now = Date.now();
  return [
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
  ];
}
