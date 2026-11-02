/**
 * 背调后：对公司对齐的公开联系人（含个人主页占位）做全网补全——具体职位 + WhatsApp。
 * 不挖邮箱；不向前台暴露检索供应商与实现细节。
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

/** 缺具体职位或缺 WhatsApp 时需要全网补全 */
export const needsTitleOrWhatsAppEnrichment = (dm: DecisionMaker): boolean => {
  if (!isCompanyAlignedContact(dm)) return false;
  if (isWeakTitle(dm.title)) return true;
  if (!(dm.whatsapp || '').trim() && !(dm.phone || '').trim()) return true;
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

  // AnySearch 批量（有 Key 时）
  if (getAnysearchApiKey().trim() || isSupabaseConfigured()) {
    try {
      const queries = [
        {
          query: `"${name}" ${domain} (team OR leadership OR procurement OR purchasing OR buyer) (WhatsApp OR phone OR mobile OR Tel)`,
          max_results: 5,
        },
        {
          query: `site:${domain} (contact OR team OR about OR WhatsApp OR "wa.me" OR tel:)`,
          max_results: 4,
        },
        ...targets.slice(0, 5).map((c) => ({
          query: `"${c.name}" ${name} ${domain} (title OR role OR LinkedIn OR WhatsApp OR phone OR mobile)`,
          max_results: 3,
        })),
      ].slice(0, 5);
      const batchText = await anysearchBatchSearch(queries);
      if (batchText?.trim()) chunks.push(batchText.trim().slice(0, 8_000));
    } catch (e) {
      console.warn('[dm-web-enrich] web batch search failed', e);
    }
  }

  // 公开网页检索补充（职位 / WhatsApp 线索）
  if (hasTavilyKey()) {
    const queries = [
      `"${name}" ${domain} WhatsApp OR "wa.me" OR "whatsapp" contact`,
      ...targets.slice(0, 4).map(
        (c) =>
          `"${c.name}" ${c.linkedin || name} (Purchasing OR Buyer OR Director OR Manager OR WhatsApp OR phone)`
      ),
    ].filter(Boolean);
    for (const q of queries.slice(0, 4)) {
      try {
        const data = await tavilySearch(q, {
          maxResults: 5,
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

  return chunks.join('\n\n').slice(0, 12_000);
};

/**
 * 对公司对齐联系人全网补全：具体职位 + WhatsApp（公开信息）。
 * 不猜测、不编造号码；查不到则保持原值。
 */
export const enrichDecisionMakersTitleAndWhatsApp = async (opts: {
  domain: string;
  companyName: string;
  decisionMakers: DecisionMaker[];
  /** 最多补全人数，默认 8 */
  limit?: number;
}): Promise<DecisionMaker[]> => {
  const domain = (opts.domain || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();
  const companyName = (opts.companyName || '').trim();
  const contacts = opts.decisionMakers || [];
  if (!contacts.length || (!domain && !companyName)) return contacts;

  const targets = contacts
    .filter(needsTitleOrWhatsAppEnrichment)
    .filter((c) => (c.name || '').trim().length >= 2)
    .slice(0, Math.max(1, Math.min(opts.limit ?? 8, 12)));
  if (!targets.length) return contacts;

  const evidence = await gatherEvidence(domain, companyName, targets);
  const roster = targets
    .map(
      (c, i) =>
        `${i + 1}. name=${c.name}; title=${c.title || ''}; linkedin=${c.linkedin || ''}; phone=${c.phone || ''}; whatsapp=${c.whatsapp || ''}`
    )
    .join('\n');

  const prompt = `你是外贸 B2B 情报分析师。请为下列「目标公司相关人员」补全：真实在职职位 + 公开 WhatsApp/手机号。

公司：${companyName || domain}
官网域名：${domain || '未知'}

公开网页检索证据（优先采信；可能含个人主页摘要、新闻、团队页、Contact、wa.me）：
${evidence || '（证据较少，请自行联网交叉验证；查不到必须留空）'}

待补全人员（已与该公司对齐；可能来自公开职业主页占位，暂无邮箱）：
${roster}

硬性要求：
1. 只补全「确属本公司」的真实在职人员；若证据显示此人在别的公司任职，title/whatsapp/linkedin 全部留空（不要把别家职位写进来）。
2. title 必须是具体岗位（如 Purchasing Manager / Import Buyer / Category Manager / Owner）；禁止写 Staff/Employee/待确认职位；禁止写成「Xxx at 其它公司名」。
3. whatsapp：仅提取公开可见的国际格式号码或 wa.me 链接中的号码；查不到留空，严禁编造。
4. phone：若证据里有固定电话/手机且与 WhatsApp 不同可另填；没有则留空。
5. linkedin：若证据能确认个人主页且属于本公司员工则填 linkedin.com/in/...，否则留空由调用方保留原值。
6. 采购/买手/品类/进口 → type=Buyer；CEO/Founder/Owner/President → CEO；其它 Other。
7. 禁止输出邮箱；本任务不挖邮箱。
8. 严禁把同行业其它公司（如其它玩具店/进口商）的采购经理塞进本公司花名册。

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
      console.warn('[dm-web-enrich] empty AI result');
      return contacts;
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
      const whatsapp = String(row.whatsapp || '').trim();
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
      const nextWhatsapp = preferString(whatsapp, c.whatsapp) || c.whatsapp;
      const nextPhone = preferString(phone, c.phone) || c.phone;
      const nextLi =
        linkedin && /linkedin\.com\/in\//i.test(linkedin)
          ? linkedin
          : c.linkedin;

      if (
        (nextTitle && nextTitle !== c.title) ||
        (nextWhatsapp && nextWhatsapp !== c.whatsapp) ||
        (nextPhone && nextPhone !== c.phone)
      ) {
        enriched += 1;
      }

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
      console.log(`[dm-web-enrich] enriched title/whatsapp for ${enriched} contact(s)`);
    }
    const { filterDecisionMakersForCompany, extractEmployerFromText, companiesFuzzyMatch } =
      await import('./linkedinEmployeeLocator');
    // 若模型把职位改成「at 别家公司」，丢掉污染职位；仍属本公司的人保留
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
    return contacts;
  }
};
