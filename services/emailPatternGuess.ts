/**
 * 邮箱「猜测 + 校验」：
 * - 千问 / 规则只负责生成候选（不可当验证）
 * - 必须经专业校验接口（Anymail verify）确认后才写入
 *
 * 业界实测：纯 LLM 猜邮箱大量无效；本模块严禁未校验入库。
 */
import type { DecisionMaker } from '../types';
import { getEmailSearchKeys } from './env';
import { buildAnymailFetchHeaders, resolveAnymailUrl } from './qwenProxy';

const cleanDomain = (d: string) =>
  (d || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

const normalizeToken = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();

const splitPerson = (
  name: string,
  firstName?: string,
  lastName?: string
): { first: string; last: string } => {
  const f = normalizeToken(firstName || '');
  const l = normalizeToken(lastName || '');
  if (f && l) return { first: f, last: l };
  const parts = (name || '')
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  if (parts.length >= 2) return { first: parts[0], last: parts[parts.length - 1] };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: '', last: '' };
};

export type EmailLocalPattern =
  | 'first.last'
  | 'firstlast'
  | 'flast'
  | 'firstl'
  | 'first_last'
  | 'last.first'
  | 'first'
  | 'last';

const applyLocalPattern = (
  kind: EmailLocalPattern,
  first: string,
  last: string
): string => {
  const fi = first.charAt(0);
  const li = last.charAt(0);
  switch (kind) {
    case 'first.last':
      return last ? `${first}.${last}` : first;
    case 'firstlast':
      return last ? `${first}${last}` : first;
    case 'flast':
      return last ? `${fi}${last}` : first;
    case 'firstl':
      return last ? `${first}${li}` : first;
    case 'first_last':
      return last ? `${first}_${last}` : first;
    case 'last.first':
      return last ? `${last}.${first}` : first;
    case 'first':
      return first;
    case 'last':
      return last || first;
    default:
      return first;
  }
};

/**
 * 从「已验证」公司邮箱反推本地格式（如 okoziorowska@ / p+lastname@）。
 * 再次背调对齐领英职员时，优先按此规则猜邮箱再校验。
 */
export const inferEmailPatternsFromVerified = (
  people: DecisionMaker[],
  domain: string
): EmailLocalPattern[] => {
  const host = cleanDomain(domain);
  if (!host) return [];
  const score = new Map<EmailLocalPattern, number>();
  const kinds: EmailLocalPattern[] = [
    'first.last',
    'firstlast',
    'flast',
    'firstl',
    'first_last',
    'last.first',
    'first',
    'last',
  ];
  for (const p of people || []) {
    const email = String(p.emailGuess || '').trim().toLowerCase();
    if (!email.endsWith(`@${host}`)) continue;
    const verified =
      !!p.isVerified || String(p.emailStatus || '').toLowerCase() === 'valid';
    if (!verified) continue;
    const local = email.split('@')[0].replace(/[^a-z0-9._-]/g, '');
    if (!local) continue;
    const { first, last } = splitPerson(p.name || '', p.firstName, p.lastName);
    // 单名邮箱联系人：把 name 同时当 first/last 试匹配
    const firstAlt = first || normalizeToken(p.name || '');
    const lastAlt = last || firstAlt;
    for (const kind of kinds) {
      const expected = applyLocalPattern(kind, firstAlt, lastAlt);
      if (expected && expected === local) {
        score.set(kind, (score.get(kind) || 0) + (verified ? 2 : 1));
      }
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
};

/** 规则候选：覆盖常见企业邮箱格式；knownPatterns 优先排前 */
export const buildHeuristicEmailCandidates = (
  name: string,
  domain: string,
  firstName?: string,
  lastName?: string,
  knownPatterns?: EmailLocalPattern[]
): string[] => {
  const host = cleanDomain(domain);
  if (!host || !host.includes('.')) return [];
  const { first, last } = splitPerson(name, firstName, lastName);
  if (!first) return [];
  const fi = first.charAt(0);
  const li = last.charAt(0);
  const prioritized = (knownPatterns || [])
    .map((k) => applyLocalPattern(k, first, last || first))
    .filter(Boolean)
    .map((local) => `${local}@${host}`);
  const raw = [
    ...prioritized,
    last ? `${first}.${last}@${host}` : '',
    last ? `${first}${last}@${host}` : '',
    last ? `${fi}${last}@${host}` : '',
    last ? `${first}${li}@${host}` : '',
    last ? `${first}_${last}@${host}` : '',
    last ? `${last}.${first}@${host}` : '',
    `${first}@${host}`,
    last ? `${last}@${host}` : '',
  ];
  return [...new Set(raw.filter(Boolean).map((e) => e.toLowerCase()))].slice(0, 10);
};

const verifyEmailViaAnymail = async (
  email: string
): Promise<{ ok: boolean; status: string } | null> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  if (!apiKey || !email.includes('@')) return null;
  try {
    const { url } = resolveAnymailUrl('/v5.1/verify-email');
    const res = await fetch(url, {
      method: 'POST',
      headers: buildAnymailFetchHeaders(apiKey, url),
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const status = String(data.email_status || 'unverified').toLowerCase();
    return { ok: status === 'valid', status };
  } catch {
    return null;
  }
};

/** 千问仅生成候选列表；失败则返回空，由规则候选兜底 */
export const askQwenEmailCandidates = async (opts: {
  name: string;
  domain: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  title?: string;
}): Promise<string[]> => {
  const host = cleanDomain(opts.domain);
  if (!host) return [];
  const prompt = `你是 B2B 邮箱格式顾问。根据姓名与公司域名，列出最多 5 个「最可能」的企业邮箱候选。
只输出 JSON 数组，例如 ["a.b@domain.com"]。不要解释。不要编造不存在的域名。
姓名: ${opts.name}
名: ${opts.firstName || ''}
姓: ${opts.lastName || ''}
职位: ${opts.title || ''}
公司: ${opts.companyName || ''}
域名: ${host}
规则：本地部分只用英文小写字母/点/下划线；必须 @${host}`;

  try {
    const { callQwen } = await import('./geminiService');
    const text = await callQwen(prompt, {
      jsonMode: true,
      enableSearch: false,
      maxTokens: 256,
      timeoutMs: 45_000,
    });
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((e) => e.endsWith(`@${host}`) && e.includes('@'))
      .slice(0, 5);
  } catch (e) {
    console.warn('[email-pattern] qwen candidates failed', e);
    return [];
  }
};

export type GuessVerifyResult = {
  email: string;
  emailStatus: string;
  isVerified: boolean;
  source: 'AI (Pattern Guess)';
  tried: number;
};

/**
 * 猜测 + 校验：千问/规则候选 → Anymail verify，仅 valid 才返回。
 * 无校验 Key 时不返回结果（避免把猜测当事实）。
 */
export const guessAndVerifyPersonEmail = async (opts: {
  name: string;
  domain: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  title?: string;
  useQwen?: boolean;
  maxVerify?: number;
  knownPatterns?: EmailLocalPattern[];
  /** 已占用邮箱，避免重复猜到同一人 */
  occupiedEmails?: Set<string> | string[];
}): Promise<GuessVerifyResult | null> => {
  if (!getEmailSearchKeys().anymailFinder) return null;
  const host = cleanDomain(opts.domain);
  if (!host || !opts.name?.trim()) return null;

  const occupied = new Set(
    [...(opts.occupiedEmails || [])].map((e) => String(e || '').toLowerCase()).filter((e) => e.includes('@'))
  );
  const heuristic = buildHeuristicEmailCandidates(
    opts.name,
    host,
    opts.firstName,
    opts.lastName,
    opts.knownPatterns
  );
  let qwen: string[] = [];
  if (opts.useQwen !== false) {
    qwen = await askQwenEmailCandidates(opts);
  }
  // 公司已验证规则优先于模型瞎猜
  const candidates = [...new Set([...heuristic, ...qwen])]
    .filter((e) => !occupied.has(e))
    .slice(0, Math.max(1, Math.min(opts.maxVerify ?? 6, 8)));
  if (!candidates.length) return null;

  for (let i = 0; i < candidates.length; i++) {
    const email = candidates[i];
    const verified = await verifyEmailViaAnymail(email);
    if (verified?.ok) {
      return {
        email,
        emailStatus: 'valid',
        isVerified: true,
        source: 'AI (Pattern Guess)',
        tried: i + 1,
      };
    }
  }
  return null;
};

/** 对缺邮箱的真实人名批量猜验（有上限，供夜间/深挖调用） */
export const fillMissingEmailsByPatternGuess = async (
  people: DecisionMaker[],
  opts: {
    domain: string;
    companyName?: string;
    maxPeople?: number;
    useQwen?: boolean;
    /** 不传则从已验证联系人自动推断 */
    knownPatterns?: EmailLocalPattern[];
  }
): Promise<{ decisionMakers: DecisionMaker[]; filled: number; tried: number }> => {
  const domain = cleanDomain(opts.domain);
  let filled = 0;
  let tried = 0;
  const maxPeople = Math.max(1, Math.min(opts.maxPeople ?? 5, 8));
  const next = people.map((d) => ({ ...d }));
  const knownPatterns =
    opts.knownPatterns?.length
      ? opts.knownPatterns
      : inferEmailPatternsFromVerified(next, domain);
  const occupied = new Set(
    next
      .map((d) => String(d.emailGuess || '').toLowerCase())
      .filter((e) => e.includes('@'))
  );

  const targets = next
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => {
      if (d.emailGuess?.includes('@')) return false;
      const name = d.name || [d.firstName, d.lastName].filter(Boolean).join(' ');
      if (!name || /公开信息未找到|未知|待补充|Company Contact/i.test(name)) return false;
      return !!(d.firstName || d.lastName || name.split(/\s+/).length >= 2 || d.linkedin);
    })
    .slice(0, maxPeople);

  for (const { d, i } of targets) {
    tried += 1;
    const name = d.name || [d.firstName, d.lastName].filter(Boolean).join(' ');
    const hit = await guessAndVerifyPersonEmail({
      name,
      domain,
      firstName: d.firstName,
      lastName: d.lastName,
      companyName: opts.companyName,
      title: d.title,
      useQwen: opts.useQwen,
      maxVerify: knownPatterns.length ? 6 : 5,
      knownPatterns,
      occupiedEmails: occupied,
    });
    if (!hit) continue;
    occupied.add(hit.email.toLowerCase());
    next[i] = {
      ...d,
      emailGuess: hit.email,
      emailSource: hit.source,
      source: d.source === 'LinkedIn' ? 'LinkedIn' : hit.source,
      emailStatus: hit.emailStatus,
      isVerified: hit.isVerified,
      lastEmailCheckedAt: Date.now(),
    };
    filled += 1;
  }

  return { decisionMakers: next, filled, tried };
};
