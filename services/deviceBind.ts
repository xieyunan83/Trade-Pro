/**
 * 员工设备绑定 + 可用时段校验。
 * 说明：浏览器无法读取真实网卡 MAC；以稳定设备指纹强制绑定，
 * 同时要求登记 MAC 并本地核验，管理员可重置绑定。
 */
import type { AccessSchedule, BoundDevice, User } from '../types';
import { findUserByName, loadUsersFromStorage, persistUsers } from './auth';
import { loadDepartmentsFromStorage } from './orgStore';

const DEVICE_SECRET_KEY = 'trade_scout_device_secret_v1';
const LOCAL_MAC_KEY = 'trade_scout_local_mac_v1';

export type AccessBlockReason =
  | 'device_unbound_need_bind'
  | 'device_mismatch'
  | 'mac_mismatch'
  | 'schedule_blocked'
  | 'ok';

export type AccessCheckResult = {
  ok: boolean;
  reason: AccessBlockReason;
  message: string;
  needBind?: boolean;
  deviceId?: string;
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export const isEmployeeRole = (user: User | null | undefined): boolean =>
  !!user && user.role === 'user';

/** 该账号是否强制设备/网卡绑定（按账户设置；员工默认开启） */
export const isDeviceBindRequired = (user: User): boolean => {
  if (user.deviceBindRequired === true) return true;
  if (user.deviceBindRequired === false) return false;
  return user.role === 'user';
};

/** 需要持续门禁校验（绑定或可用时段） */
export const needsAccessControl = (user: User): boolean =>
  isDeviceBindRequired(user) || !!user.accessSchedule?.enabled;

export const normalizeMacAddress = (raw: string): string | null => {
  const hex = (raw || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length !== 12) return null;
  return hex.match(/.{1,2}/g)!.join(':');
};

export const formatMacInputHint = () =>
  '格式示例：A1:B2:C3:D4:E5:F6（可在 Windows 运行 getmac，或 macOS 运行 ifconfig）';

const ensureLocalDeviceSecret = (): string => {
  try {
    const existing = localStorage.getItem(DEVICE_SECRET_KEY);
    if (existing && existing.length >= 16) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(DEVICE_SECRET_KEY, secret);
    return secret;
  } catch {
    return 'fallback-device-secret';
  }
};

export const getLocalRegisteredMac = (): string | null => {
  try {
    return localStorage.getItem(LOCAL_MAC_KEY);
  } catch {
    return null;
  }
};

export const setLocalRegisteredMac = (mac: string) => {
  try {
    localStorage.setItem(LOCAL_MAC_KEY, mac);
  } catch {
    /* ignore */
  }
};

export const clearLocalRegisteredMac = () => {
  try {
    localStorage.removeItem(LOCAL_MAC_KEY);
  } catch {
    /* ignore */
  }
};

/** 生成当前浏览器/本机稳定设备指纹 */
export const getDeviceFingerprint = async (): Promise<string> => {
  const secret = ensureLocalDeviceSecret();
  const parts = [
    secret,
    navigator.userAgent || '',
    navigator.language || '',
    navigator.platform || '',
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth || ''),
    String(window.devicePixelRatio || ''),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(navigator.hardwareConcurrency || ''),
    String((navigator as any).deviceMemory || ''),
    String((navigator as any).maxTouchPoints || ''),
  ];

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(0, 0, 220, 40);
      ctx.fillStyle = '#fff';
      ctx.fillText('TradePro-Device-Bind', 8, 12);
      parts.push(canvas.toDataURL());
    }
  } catch {
    /* ignore canvas fp */
  }

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const parseHm = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

/** 在指定时区取当前星期与分钟数 */
export const getZonedNowParts = (
  timeZone = 'Asia/Shanghai'
): { day: number; minutes: number; label: string } => {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const day = map[weekday] ?? new Date().getDay();
    const h = hour === 24 ? 0 : hour;
    return {
      day,
      minutes: h * 60 + minute,
      label: `${WEEKDAY_LABELS[day]} ${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  } catch {
    const now = new Date();
    return {
      day: now.getDay(),
      minutes: now.getHours() * 60 + now.getMinutes(),
      label: now.toLocaleString('zh-CN'),
    };
  }
};

export const checkAccessSchedule = (
  schedule?: AccessSchedule | null
): { ok: boolean; message: string } => {
  if (!schedule?.enabled) return { ok: true, message: '' };
  const tz = schedule.timezone || 'Asia/Shanghai';
  const { day, minutes, label } = getZonedNowParts(tz);
  const days = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(day)) {
    const allow = days.map((d) => `周${WEEKDAY_LABELS[d]}`).join('、');
    return {
      ok: false,
      message: `当前不在可用工作日（允许：${allow}）。现在是 ${tz} ${label}`,
    };
  }
  const start = parseHm(schedule.startTime || '00:00');
  const end = parseHm(schedule.endTime || '23:59');
  if (start == null || end == null) return { ok: true, message: '' };
  // 支持跨夜：如 22:00-06:00
  const inWindow =
    start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
  if (!inWindow) {
    return {
      ok: false,
      message: `当前不在可用时段 ${schedule.startTime}-${schedule.endTime}（${tz}）。现在是 ${label}`,
    };
  }
  return { ok: true, message: '' };
};

export const checkDeviceAccess = async (user: User): Promise<AccessCheckResult> => {
  if (!isDeviceBindRequired(user)) {
    return { ok: true, reason: 'ok', message: '' };
  }
  const deviceId = await getDeviceFingerprint();
  const bound = user.boundDevices || [];
  if (bound.length === 0) {
    return {
      ok: false,
      reason: 'device_unbound_need_bind',
      message: '本账号尚未绑定本机设备，请登记网卡物理地址完成首次绑定。',
      needBind: true,
      deviceId,
    };
  }
  const matched = bound.find((d) => d.deviceId === deviceId);
  if (!matched) {
    return {
      ok: false,
      reason: 'device_mismatch',
      message:
        '当前设备不是该账号已绑定的电脑/浏览器。请使用首次绑定的本机登录，或联系管理员重置设备绑定。',
      deviceId,
    };
  }
  if (matched.macAddress) {
    const localMac = getLocalRegisteredMac();
    if (!localMac || localMac !== matched.macAddress) {
      return {
        ok: false,
        reason: 'mac_mismatch',
        message: `网卡物理地址不匹配（绑定 MAC：${matched.macAddress}）。请在本机重新确认 MAC，或联系管理员重置绑定。`,
        deviceId,
      };
    }
  }
  return { ok: true, reason: 'ok', message: '', deviceId };
};

export const evaluateEmployeeAccess = async (user: User): Promise<AccessCheckResult> => {
  if (isDeviceBindRequired(user)) {
    const device = await checkDeviceAccess(user);
    if (!device.ok) return device;
  }
  if (user.accessSchedule?.enabled) {
    const schedule = checkAccessSchedule(user.accessSchedule);
    if (!schedule.ok) {
      return { ok: false, reason: 'schedule_blocked', message: schedule.message };
    }
  }
  return { ok: true, reason: 'ok', message: '' };
};

export const bindCurrentDevice = async (
  username: string,
  macRaw: string,
  label = '本机'
): Promise<{ ok: true; user: User; users: User[] } | { ok: false; message: string }> => {
  const mac = normalizeMacAddress(macRaw);
  if (!mac) {
    return { ok: false, message: `网卡物理地址无效。${formatMacInputHint()}` };
  }
  const deviceId = await getDeviceFingerprint();
  const users = loadUsersFromStorage();
  const target = findUserByName(users, username);
  if (!target) return { ok: false, message: '用户不存在' };

  const device: BoundDevice = {
    deviceId,
    macAddress: mac,
    label,
    boundAt: Date.now(),
  };
  const nextUsers = users.map((u) =>
    u.username === target.username
      ? {
          ...u,
          deviceBindRequired: true,
          boundDevices: [device],
        }
      : u
  );
  const saved = await persistUsers(nextUsers, Date.now(), loadDepartmentsFromStorage());
  setLocalRegisteredMac(mac);
  const updated = findUserByName(saved, username)!;
  return { ok: true, user: updated, users: saved };
};

export const confirmLocalMacForBoundDevice = async (
  user: User,
  macRaw: string
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const mac = normalizeMacAddress(macRaw);
  if (!mac) return { ok: false, message: `网卡物理地址无效。${formatMacInputHint()}` };
  const deviceId = await getDeviceFingerprint();
  const matched = (user.boundDevices || []).find((d) => d.deviceId === deviceId);
  if (!matched) {
    return { ok: false, message: '当前设备指纹未绑定，无法仅确认 MAC。请联系管理员重置后重新绑定。' };
  }
  if (matched.macAddress && matched.macAddress !== mac) {
    return { ok: false, message: `MAC 与绑定记录不一致（应为 ${matched.macAddress}）` };
  }
  setLocalRegisteredMac(mac);
  return { ok: true };
};

export const clearUserDeviceBindings = (user: User): User => ({
  ...user,
  boundDevices: [],
});

export const defaultAccessSchedule = (): AccessSchedule => ({
  enabled: false,
  timezone: 'Asia/Shanghai',
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: '09:00',
  endTime: '18:00',
});

export const describeSchedule = (schedule?: AccessSchedule | null): string => {
  if (!schedule?.enabled) return '不限时段';
  const days = (schedule.daysOfWeek?.length ? schedule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6])
    .map((d) => `周${WEEKDAY_LABELS[d]}`)
    .join('');
  return `${days} ${schedule.startTime || '00:00'}-${schedule.endTime || '23:59'}（${schedule.timezone || 'Asia/Shanghai'}）`;
};
