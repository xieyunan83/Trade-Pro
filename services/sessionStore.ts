/**
 * 登录会话持久化：刷新 / 发版热重载 / chunk 自动 reload 后恢复账号，避免突然掉回登录页。
 */
import type { User } from '../types';
import { findUserByName, loadUsersFromStorage, normalizeUser } from './auth';

const SESSION_KEY = 'trade_scout_session_v1';
/** 30 天未活动则需重新登录 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type PersistedSession = {
  username: string;
  savedAt: number;
};

export const saveSession = (username: string): void => {
  try {
    const payload: PersistedSession = {
      username: (username || '').trim(),
      savedAt: Date.now(),
    };
    if (!payload.username) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
};

export const clearSession = (): void => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
};

export const loadSession = (): PersistedSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    const username = (parsed?.username || '').trim();
    if (!username) {
      clearSession();
      return null;
    }
    const savedAt = Number(parsed.savedAt) || 0;
    if (savedAt > 0 && Date.now() - savedAt > SESSION_TTL_MS) {
      clearSession();
      return null;
    }
    return { username, savedAt: savedAt || Date.now() };
  } catch {
    return null;
  }
};

/** 根据本机会员表恢复会话用户；账号已删/停用则清会话 */
export const restoreSessionUser = (users?: User[]): User | null => {
  const sess = loadSession();
  if (!sess) return null;
  const roster = users?.length ? users : loadUsersFromStorage();
  const hit = findUserByName(roster, sess.username);
  if (!hit || hit.disabled) {
    clearSession();
    return null;
  }
  // 续期，避免长期在线用户被 TTL 踢掉
  saveSession(hit.username);
  return normalizeUser(hit);
};
