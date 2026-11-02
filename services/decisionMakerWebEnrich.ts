/**
 * 背调后：对公司对齐的公开联系人（含个人主页占位）做全网补全——具体职位 + WhatsApp。
 * 对齐联系人时：缺 WhatsApp 必挖（公开网页 / wa.me / Contact 页）；不编造号码；不挖邮箱。
 * 不向前台暴露检索供应商与实现细节。
 */
import type { DecisionMaker } from '../types';
import { anysearchBatchSearch } from './anysearchService';
import { getAnysearchApiKey, isSupabaseConfigured } from './env';
import { hasTavilyKey, tavilySearch, formatTavilyEvidence } from './tavilyService';
import { callQwen } from './geminiService';
import { preferString } from './multiModelMerge';

const WEAK_TITLE_RE =
  /Company Contact|待补充|待确认|Domain Search|Employee|Professional|^Manager$|Staff|Unknown|N\/?A/i;

const isWeakTitle = (title?: string): boolean => !title?.trim() || WEAK_TITLE_RE.test(title.trim());

const hasPersonalProfile = (dm: DecisionMaker): boolean =>
  !!(dm.linkedin && /linkedin\.com\/in\//i.test(dm.linkedin));

const isCompanyAlignedContact = (dm: DecisionMaker): boolean =>
  dm.source === 'LinkedIn' || hasPersonalProfile(dm) || !!(dm.name && dm.name.trim().length >= 3);

/** 规范化为带 + 的国际号（仅数字与前导 +） */
export const normalizeWhatsAppNumber = (raw?: string): string => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
};

/** 从公开文本确定性提取 WhatsApp / wa.me 号码 */
export const extractPublicWhatsAppNumbers = (text: string): string[] => {
  const raw = text || '';
  const found: string[] = [];
  const push = (n?: string) => {
    const v = normalizeWhatsAppNumber(n);
    if (v && !found.includes(v)) found.push(v);
  };

  for (const m of raw.matchAll(
    /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\+?\d{8,15})/gi
  )) {
    push(m[1]);
  }
  for (const m of raw.matchAll(
    /(?:whatsapp|whats\s*app|w\.?\s*a\.?)\s*[:：]?\s*(\+?\d[\d\s\-().]{7,22}\d)/gi
  )) {
    push(m[1]);
  }
  // 页脚常见「Tel / Mobile」国际号，作候选（仍需人名上下文由调用方选用）
  for (const m of raw.matchAll(
    /(?:mobile|cell|whatsapp|tel|phone|手机|电话)\s*[:：]?\s*(\+\d[\d\s\-().]{8,20}\d)/gi
  )) {
    push(m[1]);
  }
  return found;
};

/**
 * 手机号可当 WhatsApp 候选：已是国际格式、位数够。
 * 座机/短号不提升。
 */
export const phoneAsWhatsAppCandidate = (phone?: string): string => {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  // 以 0 开头的本地号（无国家码）不提升
  if (/^0/.test(digits) && digits.length <= 11) return '';
  return `+${digits}`;
};

/** 缺具体职位或缺 WhatsApp 时需要全网补全（有 phone 仍要挖 WhatsApp） */
export const needsTitleOrWhatsAppEnrichment = (dm: DecisionMaker): boolean => {
  if (!isCompanyAlignedContact(dm)) return false;
  if (isWeakTitle(dm.title)) return true;
  if (!(dm.whatsapp || '').trim()) return true;
  return false;
};

const extractJsonArray = (text: string): any[] => {
  const raw = (text || '').trim();
  if (!raw) return [];
  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
  } catch {
    /* fall through */
  }
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const sliced = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(sliced)) return sliced;
    } catch {
      /* ignore */
    }
  }
  return [];
};

const classifyType = (title: string, fallback: DecisionMaker['type']): DecisionMaker['type'] => {
  const t = (title || '').toLowerCase();
  if (/\b(ceo|owner|founder|president|managing\s*director)\b/i.test(t) || /总经理|创始/.test(t)) {
    return 'CEO';
  }
  if (
    /\b(purchasing|procurement|buyer|import|sourcing|category)\b/i.test(t) ||
    /采购|买手|进口/.test(t)
  ) {
    return 'Buyer';
  }
  return fallback || 'Other';
};

const influenceFromTitle = (title: string, fallback?: number): number => {
  if (/\b(owner|ceo|founder|president)\b/i.test(title)) return 5;
  if (/\b(purchasing|procurement|buyer|import)\b/i.test(title)) return 4;
  if (/\b(director|vp|head)\b/i.test(title)) return 4;
  return fallback || 3;
};

const gatherEvidence = async (
  domain: string,
  companyName: string,
  targets: DecisionMaker[]
): Promise<string> => {
  const chunks: string[] = [];
  const name = companyName || domain;

  if (getAnysearchApiKey().trim() || isSupabaseConfigured()) {
    try {
      const queries = [
        {
          query: `"${name}" ${domain} (WhatsApp OR "wa.me" OR whatsapp OR mobile OR Tel OR phone)`,
          max_results: 6,
        },
        {
          query: `site:${domain} (contact OR team OR about OR WhatsApp OR "wa.me" OR tel: OR mobile)`,
          max_results: 5,
        },
        ...targets.slice(0, 6).map((c) => ({
          query: `"${c.name}" (WhatsApp OR "wa.me" OR whatsapp OR mobile OR phone) ${name} ${domain}`,
          max_results: 4,
        })),
      ].slice(0, 8);
      const batchText = await anysearchBatchSearch(queries);
      if (batchText?.trim()) chunks.push(batchText.trim().slice(0, 9_000));
    } catch (e) {
      console.warn('[dm-web-enrich] web batch search failed', e);
    }
  }

  if (hasTavilyKey()) {
    const queries = [
      `"${name}" ${domain} (WhatsApp OR "wa.me" OR whatsapp) (contact OR buyer OR purchasing)`,
      `site:${domain} (WhatsApp OR "wa.me" OR mobile OR Tel OR phone)`,
      ...targets.slice(0, 5).map(
        (c) =>
          `"${c.name}" (WhatsApp OR "wa.me" OR mobile OR phone) ${c.linkedin || name || domain}`
      ),
    ].filter(Boolean);
    for (const q of queries.slice(0, 6)) {
      try {
        const data = await tavilySearch(q, {
          maxResults: 6,
          searchDepth: 'basic',
          includeAnswer: false,
        });
        const formatted = formatTavilyEvidence(data, 'WEB');
        if (formatted?.trim()) chunks.push(formatted.trim().slice(0, 3_500));
      } catch {
        /* ignore single query */
      }
    }
  }

  return chunks.join('\n\n').slice(0, 14_000);
};

/** 证据里按人名邻近窗口优先匹配 WhatsApp */
const pickWhatsAppNearName = (
  evidence: string,
  personName: string,
  pool: string[]
): string => {
  if (!pool.length) return '';
  if (pool.length === 1) return pool[0];
  const name = (personName || '').trim();
  if (!name) return pool[0];
  const lower = evidence.toLowerCase();
  const idx = lower.indexOf(name.toLowerCase());
  if (idx < 0) {
    const first = name.split(/\s+/)[0] || '';
    const i2 = first.length >= 3 ? lower.indexOf(first.toLowerCase()) : -1;
    if (i2 < 0) return '';
    const window = evidence.slice(Math.max(0, i2 - 120), i2 + 220);
    const near = extractPublicWhatsAppNumbers(window);
    return near.find((n) => pool.includes(n)) || '';
  }
  const window = evidence.slice(Math.max(0, idx - 160), idx + 280);
  const near = extractPublicWhatsAppNumbers(window);
  return near.find((n) => pool.includes(n)) || '';
};

const applyDeterministicWhatsApp = (
  contacts: DecisionMaker[],
  evidence: string
): { list: DecisionMaker[]; filled: number } => {
  const pool = extractPublicWhatsAppNumbers(evidence);
  let filled = 0;
  const list = contacts.map((c) => {
    if ((c.whatsapp || '').trim()) return c;
    const fromPhone = phoneAsWhatsAppCandidate(c.phone);
    const fromEvidence = pickWhatsAppNearName(evidence, c.name || '', pool);
    // 单人场景：证据仅一个号且该人是唯一缺号联系人时可用
    const alone =
      !fromEvidence &&
      pool.length === 1 &&
      contacts.filter((x) => !(x.whatsapp || '').trim()).length === 1
        ? pool[0]
        : '';
    const wa = fromEvidence || alone || fromPhone;
    if (!wa) return c;
    filled += 1;
    return { ...c, whatsapp: wa, phone: c.phone || wa };
  });
  return { list, filled };
};

/**
 * 对公司对齐联系人全网补全：具体职位 + WhatsApp（公开信息）。
 * 缺 WhatsApp 的对齐联系人必挖；不猜测、不编造；查不到则保持原值。
 */
export const enrichDecisionMakersTitleAndWhatsApp = async (opts: {
  domain: string;
  companyName: string;
  decisionMakers: DecisionMaker[];
  /** 最多补全人数，默认 10 */
  limit?: number;
  /** 强制再挖 WhatsApp（即使已有弱职位） */
  requireWhatsApp?: boolean;
}): Promise<DecisionMaker[]> => {
  const domain = (opts.domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();
  const companyName = (opts.companyName || '').trim();
  let contacts = opts.decisionMakers || [];
  if (!contacts.length || (!domain && !companyName)) return contacts;

  // 先把明显国际手机提升为 WhatsApp 候选
  contacts = contacts.map((c) => {
    if ((c.whatsapp || '').trim()) return c;
    const wa = phoneAsWhatsAppCandidate(c.phone);
    return wa ? { ...c, whatsapp: wa } : c;
  });

  const targets = contacts
    .filter((c) =>
      opts.requireWhatsApp !== false
        ? needsTitleOrWhatsAppEnrichment(c) || !(c.whatsapp || '').trim()
        : needsTitleOrWhatsAppEnrichment(c)
    )
    .filter((c) => (c.name || '').trim().length >= 2)
    .slice(0, Math.max(1, Math.min(opts.limit ?? 10, 12)));
  if (!targets.length) return contacts;

  const evidence = await gatherEvidence(domain, companyName, targets);

  // 1) 确定性提取（不依赖模型）
  const det = applyDeterministicWhatsApp(contacts, evidence);
  contacts = det.list;
  if (det.filled > 0) {
    console.log(`[dm-web-enrich] deterministic WhatsApp +${det.filled}`);
  }

  const stillNeedWa = contacts.filter(
    (c) =>
      targets.some(
        (t) =>
          (t.linkedin && c.linkedin && t.linkedin === c.linkedin) ||
          (t.name && c.name && t.name.toLowerCase() === c.name.toLowerCase())
      ) && !(c.whatsapp || '').trim()
  );

  const roster = targets
    .map((c) => {
      const live = contacts.find(
        (x) =>
          (x.linkedin && c.linkedin && x.linkedin === c.linkedin) ||
          (x.name && c.name && x.name.toLowerCase() === c.name.toLowerCase())
      ) || c;
      return `${live.name}; title=${live.title || ''}; linkedin=${live.linkedin || ''}; phone=${live.phone || ''}; whatsapp=${live.whatsapp || ''}`;
    })
    .map((line, i) => `${i + 1}. ${line}`)
    .join('\n');

  const prompt = `你是外贸 B2B 情报分析师。任务：为下列「已与目标公司对齐」的联系人补全真实在职职位，并尽量挖出公开 WhatsApp 号码。

公司：${companyName || domain}
官网域名：${domain || '未知'}

公开网页检索证据（优先采信；含个人主页摘要、新闻、团队页、Contact、wa.me）：
${evidence || '（证据较少，请自行联网交叉验证；查不到必须留空）'}

待补全人员：
${roster}

硬性要求：
1. 只补全确属本公司的人员；别家公司任职则 title/whatsapp/linkedin 留空。
2. title：具体岗位（Purchasing Manager / Import Buyer / Owner 等）；禁止 Staff/Employee/待确认；禁止「Xxx at 其它公司」。
3. 【WhatsApp 必挖】对每人尽量从证据提取公开 WhatsApp / wa.me / 标注 WhatsApp 的国际手机号；有 phone 国际号可同步填入 whatsapp；查不到留空，严禁编造。
4. phone：公开固话/手机可另填；没有则留空。
5. linkedin：确认属于本公司才填 linkedin.com/in/...。
6. 采购/买手/进口 → Buyer；CEO/Founder/Owner → CEO；其它 Other。
7. 禁止输出邮箱。
8. 当前仍缺 WhatsApp 的人数：${stillNeedWa.length}——请优先为这些人找回号码。

严格返回 JSON 数组（与输入人数相同、顺序一致）：
[{"name":"...","title":"","phone":"","whatsapp":"","linkedin":"","type":"CEO|Buyer|Other","influenceScore":1-5}]
只输出 JSON，不要 markdown。`;

  try {
    const text = await callQwen(prompt, {
      jsonMode: true,
      enableSearch: true,
      forcedSearch: true,
      task: 'analysis',
      timeoutMs: 120_000,
    });
    const parsed = extractJsonArray(text);
    if (!parsed.length) {
      console.warn('[dm-web-enrich] empty AI result; keep deterministic fills');
      const { filterDecisionMakersForCompany } = await import('./linkedinEmployeeLocator');
      return filterDecisionMakersForCompany(contacts, { companyName, domain, mode: 'lenient' });
    }

    const byKey = new Map<string, any>();
    parsed.forEach((row, i) => {
      const name = String(row?.name || targets[i]?.name || '')
        .trim()
        .toLowerCase();
      const li = String(row?.linkedin || targets[i]?.linkedin || '')
        .trim()
        .toLowerCase();
      if (li && /linkedin\.com\/in\//i.test(li)) byKey.set(`l:${li}`, row);
      if (name) byKey.set(`n:${name}`, row);
      if (targets[i]) byKey.set(`i:${i}`, row);
    });

    let enriched = 0;
    let waFilled = 0;
    const next = contacts.map((c) => {
      const li = (c.linkedin || '').trim().toLowerCase();
      const name = (c.name || '').trim().toLowerCase();
      const idx = targets.findIndex(
        (t) =>
          (t.linkedin && c.linkedin && t.linkedin === c.linkedin) ||
          (t.name && c.name && t.name.toLowerCase() === c.name.toLowerCase())
      );
      const row =
        (li && byKey.get(`l:${li}`)) ||
        (name && byKey.get(`n:${name}`)) ||
        (idx >= 0 ? byKey.get(`i:${idx}`) : null);
      if (!row) return c;

      const title = String(row.title || '').trim();
      const phone = String(row.phone || '').trim();
      const whatsappRaw = String(row.whatsapp || '').trim();
      const whatsapp = normalizeWhatsAppNumber(whatsappRaw) || whatsappRaw;
      const linkedin = String(row.linkedin || '').trim();
      const typeRaw = String(row.type || '').trim();
      const type: DecisionMaker['type'] =
        typeRaw === 'CEO' || typeRaw === 'Buyer'
          ? typeRaw
          : title
            ? classifyType(title, c.type)
            : c.type;

      const nextTitle =
        title && !isWeakTitle(title)
          ? title
          : isWeakTitle(c.title)
            ? title || c.title
            : preferString(c.title, title) || c.title;
      const nextPhone = preferString(phone, c.phone) || c.phone;
      const fromPhoneWa = phoneAsWhatsAppCandidate(nextPhone);
      const nextWhatsapp =
        preferString(whatsapp, c.whatsapp) || c.whatsapp || fromPhoneWa || undefined;
      const nextLi =
        linkedin && /linkedin\.com\/in\//i.test(linkedin) ? linkedin : c.linkedin;

      if (
        (nextTitle && nextTitle !== c.title) ||
        (nextWhatsapp && nextWhatsapp !== c.whatsapp) ||
        (nextPhone && nextPhone !== c.phone)
      ) {
        enriched += 1;
      }
      if (nextWhatsapp && !c.whatsapp) waFilled += 1;

      return {
        ...c,
        title: nextTitle,
        phone: nextPhone,
        whatsapp: nextWhatsapp,
        linkedin: nextLi,
        type,
        influenceScore: Math.min(
          5,
          Math.max(
            1,
            Number(row.influenceScore) ||
              influenceFromTitle(nextTitle || '', c.influenceScore)
          )
        ),
      };
    });

    if (enriched > 0) {
      console.log(
        `[dm-web-enrich] enriched title/whatsapp for ${enriched} contact(s); WhatsApp +${waFilled}`
      );
    }
    const { filterDecisionMakersForCompany, extractEmployerFromText, companiesFuzzyMatch } =
      await import('./linkedinEmployeeLocator');
    const cleaned = next.map((c) => {
      const title = (c.title || '').trim();
      if (!title) return c;
      const emp = extractEmployerFromText(title);
      if (emp && companyName && !companiesFuzzyMatch(emp, companyName)) {
        return { ...c, title: title.replace(/\s+at\s+.+$/i, '').trim() };
      }
      return c;
    });
    return filterDecisionMakersForCompany(cleaned, { companyName, domain, mode: 'lenient' });
  } catch (e) {
    console.warn('[dm-web-enrich] failed', e);
    const { filterDecisionMakersForCompany } = await import('./linkedinEmployeeLocator');
    return filterDecisionMakersForCompany(contacts, { companyName, domain, mode: 'lenient' });
  }
};
