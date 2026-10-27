/**
 * 千问对话模型优惠时段调度（Asia/Shanghai）：
 * 22:00–次日 08:00 → qwen3.8-max；其余时间 → qwen3.7-plus。
 * 仅接管「白天默认 / 夜间优惠」这对模型；其它型号（flash、max 旧版等）原样返回。
 */

export const QWEN_CHAT_DAY_MODEL = 'qwen3.7-plus';
export const QWEN_CHAT_NIGHT_MODEL = 'qwen3.8-max';

/** 上海时区当前小时 0–23 */
export const getShanghaiHour = (now = new Date()): number => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const h = Number(raw);
    if (!Number.isFinite(h)) return now.getHours();
    // 部分环境午夜为 24
    return h === 24 ? 0 : h;
  } catch {
    return now.getHours();
  }
};

/** 每晚 22:00（含）— 次日 08:00（不含） */
export const isQwenNightPromoWindow = (now = new Date()): boolean => {
  const h = getShanghaiHour(now);
  return h >= 22 || h < 8;
};

/** 纳入自动切换的配置名（含历史别名 qwen-plus） */
const SCHEDULED_ALIASES = new Set([
  QWEN_CHAT_DAY_MODEL,
  QWEN_CHAT_NIGHT_MODEL,
  'qwen-plus',
]);

export const isScheduledQwenChatModel = (modelId?: string | null): boolean => {
  const id = (modelId || '').trim();
  return !id || SCHEDULED_ALIASES.has(id);
};

/**
 * 解析最终调用的千问对话模型。
 * 配置为空 / qwen3.7-plus / qwen3.8-max 时按优惠时段自动切换；其它配置不改动。
 */
export const resolveScheduledQwenChatModel = (
  configured?: string | null,
  now = new Date()
): string => {
  const id = (configured || '').trim();
  if (!isScheduledQwenChatModel(id)) return id;
  return isQwenNightPromoWindow(now) ? QWEN_CHAT_NIGHT_MODEL : QWEN_CHAT_DAY_MODEL;
};

export const describeQwenChatSchedule = (now = new Date()): string => {
  const active = resolveScheduledQwenChatModel(QWEN_CHAT_DAY_MODEL, now);
  const window = isQwenNightPromoWindow(now) ? '夜间优惠时段（22:00–08:00）' : '日间时段（08:00–22:00）';
  return `${window} · 当前 ${active}`;
};

/** 模型未开通 / 名称错误（夜间自动切到 3.8-max 时最常见） */
export const isQwenModelUnavailableError = (err: unknown): boolean => {
  const msg = String((err as { message?: string })?.message || err || '');
  return /model_not_found|ModelNotFound|Model\.NotExist|InvalidParameter.*[Mm]odel|Unknown model|does not exist|not.?support(ed)?.?model|模型不存在|不支持该模型|无权访问.*模型|AccessDenied.*model|invalid.?model|model.?unavailable|404.*model/i.test(
    msg
  );
};
