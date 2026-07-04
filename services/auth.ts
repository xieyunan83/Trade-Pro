import { User } from '../types';

export async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) return false;
  return (await hashPassword(password)) === storedHash;
}

/** 为旧数据中没有 password 的默认账号补哈希（仅 admin / user） */
export async function ensureUserPasswords(users: User[]): Promise<User[]> {
  const legacy: Record<string, string> = { admin: 'admin123', user: 'user123' };
  return Promise.all(
    users.map(async (u) => {
      if (u.password?.trim()) return u;
      const pwd = legacy[u.username];
      if (!pwd) return u;
      return { ...u, password: await hashPassword(pwd), isFirstLogin: true };
    })
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
