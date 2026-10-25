/**
 * 联系工具：唤起官方网页端 / 深链，由用户在官方页面真实登录。
 * 本平台不代持账号密码（各 IM 也不允许第三方嵌套代登）。
 */

export type ContactToolId = 'whatsapp' | 'skype' | 'wechat' | 'telegram' | 'line';

export type ContactToolDef = {
  id: ContactToolId;
  label: string;
  sub: string;
  /** 官方网页客户端（登录入口） */
  webLoginUrl: string;
  /** 内嵌常被 X-Frame 拦截，仅作可选尝试 */
  embeddable: boolean;
  tip: string;
  accent: string;
};

export const CONTACT_TOOLS: ContactToolDef[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    sub: 'Web',
    webLoginUrl: 'https://web.whatsapp.com/',
    embeddable: false,
    tip: '打开后用手机 WhatsApp 扫码登录，会话保存在官方网页。',
    accent: '#25D366',
  },
  {
    id: 'skype',
    label: 'Skype',
    sub: 'Web',
    webLoginUrl: 'https://web.skype.com/',
    embeddable: false,
    tip: '使用微软账号登录 Skype 网页版。',
    accent: '#00AFF0',
  },
  {
    id: 'wechat',
    label: '微信',
    sub: 'Web',
    webLoginUrl: 'https://wx.qq.com/',
    embeddable: false,
    tip: '打开微信网页版并用手机微信扫码登录（部分账号需在手机端确认）。',
    accent: '#07C160',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    sub: 'Web',
    webLoginUrl: 'https://web.telegram.org/k/',
    embeddable: false,
    tip: '用手机 Telegram 扫码或登录码登录网页版。',
    accent: '#229ED9',
  },
  {
    id: 'line',
    label: 'LINE',
    sub: 'Chat',
    webLoginUrl: 'https://chat.line.biz/',
    embeddable: false,
    tip: 'LINE 商务聊天网页；个人用户也可从官方入口登录。',
    accent: '#06C755',
  },
];

const LS_RECENT = 'trade_scout_contact_tools_recent_v1';
const LS_PREF = 'trade_scout_contact_tools_pref_v1';

export const loadPreferredTool = (): ContactToolId => {
  try {
    const v = localStorage.getItem(LS_PREF) as ContactToolId | null;
    if (v && CONTACT_TOOLS.some((t) => t.id === v)) return v;
  } catch {
    /* ignore */
  }
  return 'whatsapp';
};

export const savePreferredTool = (id: ContactToolId) => {
  try {
    localStorage.setItem(LS_PREF, id);
  } catch {
    /* ignore */
  }
};

export type RecentContactLaunch = {
  toolId: ContactToolId;
  label: string;
  target: string;
  at: number;
};

export const loadRecentLaunches = (): RecentContactLaunch[] => {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.slice(0, 20) : [];
  } catch {
    return [];
  }
};

export const pushRecentLaunch = (row: Omit<RecentContactLaunch, 'at'>) => {
  const next = [{ ...row, at: Date.now() }, ...loadRecentLaunches().filter((r) => !(r.toolId === row.toolId && r.target === row.target))].slice(
    0,
    20
  );
  try {
    localStorage.setItem(LS_RECENT, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
};

/** 规范化电话为 wa.me 可用数字 */
export const digitsOnlyPhone = (raw: string): string =>
  String(raw || '').replace(/[^\d]/g, '');

/** 打开官方网页登录窗（真实登录发生在官方站点） */
export const openOfficialLogin = (tool: ContactToolDef): Window | null => {
  const w = 1180;
  const h = 800;
  const left = Math.max(0, Math.round((window.screen.width - w) / 2));
  const top = Math.max(0, Math.round((window.screen.height - h) / 2));
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener,noreferrer`;
  return window.open(tool.webLoginUrl, `contact_tool_${tool.id}`, features);
};

/** 针对具体号码/账号发起会话（登录后或已登录时跳转） */
export const buildChatDeepLink = (
  toolId: ContactToolId,
  target: string,
  message?: string
): string | null => {
  const t = (target || '').trim();
  if (!t) return null;
  const msg = (message || '').trim();
  switch (toolId) {
    case 'whatsapp': {
      const phone = digitsOnlyPhone(t);
      if (!phone) return null;
      const q = msg ? `?text=${encodeURIComponent(msg)}` : '';
      return `https://wa.me/${phone}${q}`;
    }
    case 'skype': {
      // skype:username?chat 或 skype:+phone?chat
      const id = t.replace(/^skype:/i, '');
      const q = msg ? `&topic=${encodeURIComponent(msg.slice(0, 40))}` : '';
      return `skype:${encodeURIComponent(id)}?chat${q}`;
    }
    case 'telegram': {
      const user = t.replace(/^@/, '');
      if (/^\+?\d+$/.test(user.replace(/\s/g, ''))) {
        // 无法对任意手机号直接 web 深链，回退网页
        return 'https://web.telegram.org/k/';
      }
      return `https://t.me/${encodeURIComponent(user)}`;
    }
    case 'wechat':
      // 微信无稳定公开深链，打开网页版让用户自行搜索
      return 'https://wx.qq.com/';
    case 'line':
      return 'https://chat.line.biz/';
    default:
      return null;
  }
};

export const openChatDeepLink = (toolId: ContactToolId, target: string, message?: string) => {
  const url = buildChatDeepLink(toolId, target, message);
  if (!url) return false;
  if (url.startsWith('skype:')) {
    window.location.href = url;
    // 同时打开网页版，方便未装客户端时登录
    window.open('https://web.skype.com/', '_blank', 'noopener,noreferrer');
    return true;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
};
