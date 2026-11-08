/**
 * 登录会话持久化：刷新 / 发版热重载 / chunk 自动 reload 后恢复账号，避免突然掉回登录页。
 * 桌面客户端：每次冷启动（新开应用）必须重新登录，避免「没看到登录页就进业务台」。
 */
import type { User } from '../types';
import { findUserByName, loadUsersFromStorage, normalizeUser } from './auth';

const SESSION_KEY = 'trade_scout_session_v1';
const DESKTOP_ARMED_KEY = 'trade_scout_desktop_session_armed';
/** 30 天未活动则需重新登录（仅浏览器；桌面端另受冷启动约束） */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const isDesktopClient = (): boolean => {
  try {
    if (typeof navigator !== 'undefined' && /TradeCollabClient|BabyWorldClient/i.test(navigator.userAgent)) {
      return true;
    }
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('trade_scout_desktop_client') === '1'
    );
  } catch {
    return false;
  }
};

/** 桌面端本次打开应用内是否已登录过（关应用后 sessionStorage 清空） */
export const isDesktopSessionArmed = (): boolean => {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DESKTOP_ARMED_KEY) === '1';
  } catch {
    return false;
  }
};

export const armDesktopSession = (): void => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DESKTOP_ARMED_KEY, '1');
    }
  } catch {
    /* ignore */
  }
};

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
  // 桌面冷启动：强制走登录页（不沿用上次关应用前的 localStorage 会话）
  if (isDesktopClient() && !isDesktopSessionArmed()) {
    clearSession();
    return null;
  }
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
  if (isDesktopClient()) armDesktopSession();
  return normalizeUser(hit);
};
