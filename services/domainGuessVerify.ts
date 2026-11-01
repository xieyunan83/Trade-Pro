/**
 * Excel 缺官网时：用邮箱 @ 后缀 / 公司名猜测域名，
 * 后台探测可打开且与表格字段挂勾后才采纳。
 */
import type { DecisionMaker } from '../types';
import { normalizeCrmHost } from '../utils/crmHistory';

/** 个人/公共邮箱后缀：不能当作公司官网 */
const FREE_MAIL_HOSTS = new Set(
  [
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'yahoo.co.jp',
    'yahoo.co.uk',
    'hotmail.com',
    'outlook.com',
    'outlook.jp',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
    'yandex.com',
    'yandex.ru',
    'mail.ru',
    'qq.com',
    '163.com',
    '126.com',
    'sina.com',
    'sohu.com',
    'foxmail.com',
    'yeah.net',
    'gmx.com',
    'gmx.de',
    'web.de',
    'mail.com',
    'zoho.com',
    'yopmail.com',
    'fastmail.com',
    'hey.com',
    'tutanota.com',
  ].map((h) => h.toLowerCase())
);

const PROXY_LADDER = [
  '',
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

const LEGAL_SUFFIX_RE =
  /\b(inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|gmbh|ag|bv|nv|sa|sas|srl|s\.p\.a|spa|pty|plc|kg|kgaa|oy|ab|as|aps|group|holding|holdings|trading|international|intl|import|exports?|wholesale|retail|company|companies)\b/gi;

const LEGAL_CN_RE = /有限责任公司|股份有限公司|有限公司|集团有限公司|集团|国际贸易|进出口|贸易|公司/g;

export type DomainGuessInput = {
  companyName?: string;
  website?: string;
  country?: string;
  address?: string;
  contacts?: DecisionMaker[];
};

export type DomainGuessResult = {
  website: string;
  host: string;
  source: 'email' | 'company_name';
  confidence: number;
  evidence: string[];
};

export const isFreeMailHost = (host: string): boolean => {
  const h = normalizeCrmHost(host);
  if (!h) return false;
  if (FREE_MAIL_HOSTS.has(h)) return true;
  // *.mail.yahoo.com 等
  const parts = h.split('.');
  if (parts.length >= 3) {
    const base = parts.slice(-2).join('.');
    if (FREE_MAIL_HOSTS.has(base)) return true;
  }
  return false;
};

/** 从邮箱取出可作为官网候选的域名 */
export const emailToCorporateHost = (email?: string | null): string => {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return '';
  const host = e
    .slice(at + 1)
    .replace(/^www\./, '')
    .split(/[/>\s]/)[0]
    .replace(/\.$/, '');
  if (!host || !host.includes('.') || isFreeMailHost(host)) return '';
  // 排除明显非官网的邮件子域
  if (/^(mail|email|smtp|mx|webmail)\./i.test(host)) {
    const rest = host.replace(/^(mail|email|smtp|mx|webmail)\./i, '');
    if (rest.includes('.') && !isFreeMailHost(rest)) return rest;
  }
  return host;
};

const stripLegalNoise = (name: string): string =>
  name
    .replace(LEGAL_CN_RE, ' ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^\p{L}\p{N}\s&.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 公司名 → 域名标签候选（不含 TLD） */
export const companyNameToSlugs = (companyName: string): string[] => {
  const cleaned = stripLegalNoise(companyName || '');
  if (!cleaned || cleaned.length < 2) return [];
  const words = cleaned
    .split(/[\s&.]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 2 && !/^(the|and|of|for|und|der|die|das|la|le|el)$/i.test(w));
  if (!words.length) return [];

  const joined = words.join('');
  const dashed = words.join('-');
  const firstTwo = words.slice(0, 2).join('');
  const first = words[0];
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.replace(/[^a-z0-9-]/gi, '').replace(/^-+|-+$/g, '');
    if (v.length >= 3 && v.length <= 48 && !out.includes(v)) out.push(v);
  };
  push(joined);
  if (dashed !== joined) push(dashed);
  if (firstTwo && firstTwo !== joined) push(firstTwo);
  if (first && first.length >= 4) push(first);
  return out.slice(0, 4);
};

const countryTlds = (country?: string): string[] => {
  const c = (country || '').toLowerCase();
  if (/德国|germany|deutschland/.test(c)) return ['.de', '.com', '.eu'];
  if (/英国|uk|united kingdom|england|britain/.test(c)) return ['.co.uk', '.com', '.uk'];
  if (/法国|france/.test(c)) return ['.fr', '.com', '.eu'];
  if (/荷兰|netherlands|holland/.test(c)) return ['.nl', '.com', '.eu'];
  if (/意大利|italy|italia/.test(c)) return ['.it', '.com', '.eu'];
  if (/西班牙|spain|españa|espana/.test(c)) return ['.es', '.com', '.eu'];
  if (/波兰|poland/.test(c)) return ['.pl', '.com', '.eu'];
  if (/澳大利亚|australia/.test(c)) return ['.com.au', '.com', '.au'];
  if (/加拿大|canada/.test(c)) return ['.ca', '.com'];
  if (/日本|japan/.test(c)) return ['.co.jp', '.jp', '.com'];
  if (/韩国|korea/.test(c)) return ['.co.kr', '.kr', '.com'];
  if (/巴西|brazil/.test(c)) return ['.com.br', '.br', '.com'];
  if (/墨西哥|mexico/.test(c)) return ['.com.mx', '.mx', '.com'];
  if (/印度|india/.test(c)) return ['.in', '.co.in', '.com'];
  if (/美国|usa|united states|america/.test(c)) return ['.com', '.net', '.us'];
  return ['.com', '.net', '.co', '.eu', '.biz'];
};

export const buildDomainCandidates = (input: DomainGuessInput): Array<{ host: string; source: 'email' | 'company_name' }> => {
  const out: Array<{ host: string; source: 'email' | 'company_name' }> = [];
  const seen = new Set<string>();
  const add = (host: string, source: 'email' | 'company_name') => {
    const h = normalizeCrmHost(host);
    if (!h || seen.has(h) || isFreeMailHost(h)) return;
    seen.add(h);
    out.push({ host: h, source });
  };

  for (const c of input.contacts || []) {
    const h = emailToCorporateHost(c.emailGuess);
    if (h) add(h, 'email');
  }

  const slugs = companyNameToSlugs(input.companyName || '');
  const tlds = countryTlds(input.country);
  for (const slug of slugs) {
    for (const tld of tlds.slice(0, 3)) {
      add(`${slug}${tld}`, 'company_name');
    }
  }
  return out.slice(0, 10);
};

const digitsOnly = (s: string) => s.replace(/\D/g, '');

const normalizeText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const extractTitle = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m?.[1] || '').replace(/\s+/g, ' ').trim().toLowerCase();
};

type ProbeResult = { ok: boolean; text: string; title: string };

const probeUrl = async (url: string, timeoutMs = 9000): Promise<ProbeResult> => {
  for (const proxy of PROXY_LADDER) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const target = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
      const res = await fetch(target, {
        method: 'GET',
        signal: ctrl.signal,
        // no-cors 拿不到正文；走代理时用 cors
        mode: proxy ? 'cors' : 'cors',
        credentials: 'omit',
      });
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const buf = await res.text();
      if (!buf || buf.length < 40) continue;
      // 明显非网页
      if (ct.includes('json') && buf.trim().startsWith('{') && !/<html/i.test(buf)) continue;
      if (/domain for sale|buy this domain|parked domain|coming soon/i.test(buf) && buf.length < 2500) {
        continue;
      }
      return { ok: true, text: normalizeText(buf.slice(0, 120_000)), title: extractTitle(buf) };
    } catch {
      /* try next proxy */
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, text: '', title: '' };
};

const scorePageAgainstImport = (
  page: ProbeResult,
  host: string,
  input: DomainGuessInput,
  source: 'email' | 'company_name'
): { score: number; evidence: string[] } => {
  if (!page.ok) return { score: 0, evidence: [] };
  const evidence: string[] = ['页面可打开'];
  let score = source === 'email' ? 12 : 0;
  const blob = `${page.title} ${page.text}`;
  const brand = host.split('.')[0] || '';

  const company = stripLegalNoise(input.companyName || '').toLowerCase();
  if (company) {
    if (blob.includes(company)) {
      score += 40;
      evidence.push('正文含完整公司名');
    } else {
      const tokens = company
        .split(/[\s&.-]+/)
        .filter((t) => t.length >= 3)
        .slice(0, 6);
      let hit = 0;
      for (const t of tokens) {
        if (blob.includes(t)) hit += 1;
      }
      if (tokens.length && hit / tokens.length >= 0.5) {
        score += 18 + hit * 6;
        evidence.push(`公司名关键词命中 ${hit}/${tokens.length}`);
      }
      if (page.title && tokens.some((t) => page.title.includes(t))) {
        score += 16;
        evidence.push('标题含公司名关键词');
      }
    }
  }

  if (brand.length >= 3 && (blob.includes(brand) || page.title.includes(brand))) {
    score += 10;
    evidence.push('页面含域名品牌段');
  }

  const phones = new Set<string>();
  for (const c of input.contacts || []) {
    for (const p of [c.phone, c.whatsapp]) {
      const d = digitsOnly(p || '');
      if (d.length >= 7) phones.add(d);
    }
  }
  const pageDigits = digitsOnly(blob);
  for (const d of phones) {
    // 后 7–10 位匹配，兼容国家码差异
    const tail = d.slice(-8);
    if (tail.length >= 7 && pageDigits.includes(tail)) {
      score += 28;
      evidence.push('电话可对应');
      break;
    }
  }

  for (const c of input.contacts || []) {
    const email = (c.emailGuess || '').trim().toLowerCase();
    if (email.includes('@') && blob.includes(email)) {
      score += 32;
      evidence.push('页面含该邮箱');
      break;
    }
    const name = (c.name || '').trim().toLowerCase();
    if (name.length >= 4 && !/联系人|未知|待确认/.test(name) && blob.includes(name)) {
      score += 18;
      evidence.push('页面含联系人姓名');
      break;
    }
  }

  const addr = (input.address || '').trim().toLowerCase();
  if (addr.length >= 6) {
    const bits = addr
      .split(/[\s,，、]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 4)
      .slice(0, 4);
    const hits = bits.filter((b) => blob.includes(b)).length;
    if (hits >= 1) {
      score += 10 + hits * 6;
      evidence.push('地址片段可对应');
    }
  }

  return { score, evidence };
};

const candidateUrls = (host: string): string[] => [
  `https://www.${host}/`,
  `https://${host}/`,
  `http://www.${host}/`,
  `http://${host}/`,
];

/**
 * 缺官网时猜测并核验域名。成功则返回可写入的 website。
 */
export const resolveMissingDomainFromImport = async (
  input: DomainGuessInput
): Promise<DomainGuessResult | null> => {
  const existing = normalizeCrmHost(input.website);
  if (existing) return null;

  const hasName = !!(input.companyName || '').trim();
  const hasEmail = (input.contacts || []).some((c) => emailToCorporateHost(c.emailGuess));
  if (!hasName && !hasEmail) return null;

  const candidates = buildDomainCandidates(input);
  if (!candidates.length) return null;

  // 邮箱域名优先探测
  const ordered = [
    ...candidates.filter((c) => c.source === 'email'),
    ...candidates.filter((c) => c.source === 'company_name'),
  ];

  for (const cand of ordered) {
    let best: DomainGuessResult | null = null;
    for (const url of candidateUrls(cand.host)) {
      const page = await probeUrl(url);
      if (!page.ok) continue;
      const { score, evidence } = scorePageAgainstImport(page, cand.host, input, cand.source);
      const need = cand.source === 'email' ? 28 : 46;
      if (score >= need) {
        const hit: DomainGuessResult = {
          website: `https://${cand.host}`,
          host: cand.host,
          source: cand.source,
          confidence: Math.min(99, score),
          evidence,
        };
        if (!best || hit.confidence > best.confidence) best = hit;
        // 邮箱来源一旦达标即可采用
        if (cand.source === 'email') return hit;
      }
    }
    if (best) return best;
  }
  return null;
};

/** 仅用邮箱后缀软推断域名（不开网页；大批量导入秒级完成，避免挂死） */
export const softGuessDomainFromEmail = (
  input: DomainGuessInput
): DomainGuessResult | null => {
  if (normalizeCrmHost(input.website)) return null;
  for (const c of input.contacts || []) {
    const host = emailToCorporateHost(c.emailGuess);
    if (!host) continue;
    return {
      website: `https://${host}`,
      host,
      source: 'email',
      confidence: 42,
      evidence: ['邮箱@后缀软推断（未开网页核验）'],
    };
  }
  return null;
};

/** 缺网址行数超过该阈值时自动改用软推断，避免上千次开网页卡死客户端 */
export const DOMAIN_VERIFY_AUTO_SOFT_THRESHOLD = 60;

/** 批量：仅为缺网址的行猜测；大批量默认软推断（可 mode:'verify' 强制开网页） */
export const enrichImportRowsWithGuessedDomains = async <
  T extends {
    companyName: string;
    website: string;
    country?: string;
    address?: string;
    contacts?: DecisionMaker[];
  },
>(
  rows: T[],
  opts?: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    /** soft=仅邮箱后缀；verify=开网页核验；auto=超量自动 soft */
    mode?: 'auto' | 'soft' | 'verify';
  }
): Promise<{ rows: T[]; guessed: number; modeUsed: 'soft' | 'verify' }> => {
  const needIdx = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !normalizeCrmHost(r.website));
  if (!needIdx.length) return { rows, guessed: 0, modeUsed: 'soft' };

  const modeOpt = opts?.mode || 'auto';
  const useSoft =
    modeOpt === 'soft' ||
    (modeOpt === 'auto' && needIdx.length >= DOMAIN_VERIFY_AUTO_SOFT_THRESHOLD);

  const next = [...rows];
  let guessed = 0;
  let done = 0;

  if (useSoft) {
    for (const { r, i: idx } of needIdx) {
      try {
        const hit = softGuessDomainFromEmail({
          companyName: r.companyName,
          website: r.website,
          country: r.country,
          address: r.address,
          contacts: r.contacts,
        });
        if (hit) {
          next[idx] = { ...next[idx], website: hit.website };
          guessed += 1;
          const noteBit = `[域名推断:${hit.host}·软推断]`;
          const prevNote = (next[idx] as any).note || '';
          if (typeof (next[idx] as any).note === 'string' && !prevNote.includes('[域名推断:')) {
            (next[idx] as any).note = prevNote ? `${prevNote} ${noteBit}` : noteBit;
          }
        }
      } catch {
        /* ignore */
      }
      done += 1;
      if (done % 200 === 0 || done === needIdx.length) {
        opts?.onProgress?.(done, needIdx.length);
        // 让出主线程，避免 UI 假死
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    opts?.onProgress?.(needIdx.length, needIdx.length);
    return { rows: next, guessed, modeUsed: 'soft' };
  }

  const concurrency = Math.max(1, Math.min(opts?.concurrency || 2, 3));
  for (let i = 0; i < needIdx.length; i += concurrency) {
    const slice = needIdx.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async ({ r, i: idx }) => {
        try {
          const hit = await resolveMissingDomainFromImport({
            companyName: r.companyName,
            website: r.website,
            country: r.country,
            address: r.address,
            contacts: r.contacts,
          });
          if (hit) {
            next[idx] = {
              ...next[idx],
              website: hit.website,
            };
            guessed += 1;
            const noteBit = `[域名推断:${hit.host}·${hit.source}·${hit.evidence.slice(0, 2).join('/')}]`;
            const prevNote = (next[idx] as any).note || '';
            if (typeof (next[idx] as any).note === 'string' && !prevNote.includes('[域名推断:')) {
              (next[idx] as any).note = prevNote ? `${prevNote} ${noteBit}` : noteBit;
            }
          }
        } catch {
          /* ignore single row */
        } finally {
          done += 1;
          opts?.onProgress?.(done, needIdx.length);
        }
      })
    );
  }

  return { rows: next, guessed, modeUsed: 'verify' };
};
