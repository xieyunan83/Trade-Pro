/**
 * 人物身份对齐 + 字段证据（Phase A）
 * 前台展示请用 labelEvidenceSource，勿直接暴露供应商商品名。
 */
import type { DecisionMaker, FieldEvidence, FieldEvidenceField } from '../types';

const MAX_EVIDENCE_PER_FIELD = 5;
const MAX_EVIDENCE_TOTAL = 24;

const asStr = (v: unknown): string => (v == null ? '' : String(v).trim());

/** 轻量稳定哈希（非加密），用于无邮箱/无领英时的 personId */
const hashShort = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const normalizeEmail = (email?: string | null): string => {
  const e = asStr(email).toLowerCase();
  if (!e.includes('@')) return '';
  return e;
};

/** 归一化领英个人主页路径：linkedin.com/in/xxx */
export const normalizeLinkedinPath = (url?: string | null): string => {
  const raw = asStr(url).toLowerCase();
  if (!raw) return '';
  const m = raw.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (m?.[1]) return `linkedin.com/in/${m[1].replace(/\/+$/, '')}`;
  if (/^in\/[^/?#\s]+/i.test(raw)) return `linkedin.com/${raw.replace(/\/+$/, '')}`;
  return '';
};

export const normalizeCompanyDomain = (domain?: string | null): string =>
  asStr(domain)
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

/**
 * 稳定 personId：邮箱优先 → 领英路径 → 域名+姓名哈希 → 姓名|职位兜底
 */
export const buildPersonId = (
  dm: Pick<DecisionMaker, 'emailGuess' | 'linkedin' | 'name' | 'firstName' | 'lastName' | 'title' | 'personId'>,
  opts?: { companyDomain?: string | null }
): string => {
  const email = normalizeEmail(dm.emailGuess);
  if (email) return `e:${email}`;

  const li = normalizeLinkedinPath(dm.linkedin);
  if (li) return `l:${li}`;

  const domain = normalizeCompanyDomain(opts?.companyDomain);
  const fullName = asStr(dm.name) || [asStr(dm.firstName), asStr(dm.lastName)].filter(Boolean).join(' ');
  const nameKey = fullName.toLowerCase().replace(/\s+/g, ' ').trim();
  if (domain && nameKey) return `h:${hashShort(`${domain}|${nameKey}`)}`;

  if (dm.personId && /^[elh]:/.test(dm.personId)) return dm.personId;

  const title = asStr(dm.title).toLowerCase();
  if (nameKey) return `n:${nameKey}|${title}`;
  return `n:unknown|${hashShort(JSON.stringify(dm)).slice(0, 8)}`;
};

/** 前台中性来源文案（遵守 ui-no-vendor-leak） */
export const labelEvidenceSource = (source?: string | null): string => {
  const s = asStr(source);
  if (!s) return '线索库';
  const lower = s.toLowerCase();
  if (lower.includes('anymail') || lower.includes('verify') || lower.includes('校验')) return '邮箱校验';
  if (lower.includes('hunter') || lower.includes('findy') || lower.includes('domain-search')) return '优选线索';
  if (lower.includes('pattern') || lower === 'ai' || lower.startsWith('ai ') || lower.includes('guess'))
    return '模式推断';
  if (lower.includes('linkedin') || lower.includes('领英') || lower.includes('公开')) return '公开页';
  if (lower === 'manual' || lower.includes('手动')) return '手动录入';
  if (lower.includes('web') || lower.includes('search') || lower.includes('检索')) return '公开页';
  return '线索库';
};

const statusFromEmail = (dm: DecisionMaker): FieldEvidence['status'] => {
  const s = asStr(dm.emailStatus).toLowerCase();
  if (s === 'valid' || dm.isVerified) return 'found';
  if (s === 'not_found') return 'not_found';
  return 'unverified';
};

const confidenceFromDm = (dm: DecisionMaker, field: FieldEvidenceField): number => {
  if (typeof dm.confidence === 'number' && Number.isFinite(dm.confidence)) {
    return Math.max(0, Math.min(1, dm.confidence));
  }
  if (field === 'email') {
    if (dm.isVerified || asStr(dm.emailStatus).toLowerCase() === 'valid') return 0.9;
    if (asStr(dm.emailStatus).toLowerCase() === 'risky') return 0.55;
    if (asStr(dm.emailStatus).toLowerCase() === 'invalid') return 0.15;
    return 0.45;
  }
  if (field === 'linkedin') return normalizeLinkedinPath(dm.linkedin) ? 0.75 : 0.4;
  return 0.5;
};

export const mergeEvidenceLists = (
  a?: FieldEvidence[] | null,
  b?: FieldEvidence[] | null,
  opts?: { maxPerField?: number; maxTotal?: number }
): FieldEvidence[] => {
  const maxPerField = opts?.maxPerField ?? MAX_EVIDENCE_PER_FIELD;
  const maxTotal = opts?.maxTotal ?? MAX_EVIDENCE_TOTAL;
  const all = [...(a || []), ...(b || [])].filter(
    (e) => e && asStr(e.field) && asStr(e.value)
  );

  const dedupeKey = (e: FieldEvidence) =>
    `${e.field}|${asStr(e.value).toLowerCase()}|${asStr(e.source).toLowerCase()}`;

  const byKey = new Map<string, FieldEvidence>();
  for (const e of all) {
    const k = dedupeKey(e);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...e, confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0)) });
      continue;
    }
    const better =
      (Number(e.confidence) || 0) > (Number(prev.confidence) || 0) ||
      (Number(e.observedAt) || 0) > (Number(prev.observedAt) || 0);
    byKey.set(k, better ? { ...prev, ...e, confidence: Math.max(Number(prev.confidence) || 0, Number(e.confidence) || 0) } : prev);
  }

  const sorted = [...byKey.values()].sort(
    (x, y) =>
      (Number(y.confidence) || 0) - (Number(x.confidence) || 0) ||
      (Number(y.observedAt) || 0) - (Number(x.observedAt) || 0)
  );

  const perField = new Map<string, number>();
  const out: FieldEvidence[] = [];
  for (const e of sorted) {
    const n = perField.get(e.field) || 0;
    if (n >= maxPerField) continue;
    perField.set(e.field, n + 1);
    out.push(e);
    if (out.length >= maxTotal) break;
  }
  return out;
};

export const attachFieldEvidence = (
  dm: DecisionMaker,
  evidence: Omit<FieldEvidence, 'confidence'> & { confidence?: number },
  opts?: { companyDomain?: string | null }
): DecisionMaker => {
  const entry: FieldEvidence = {
    ...evidence,
    value: asStr(evidence.value),
    source: asStr(evidence.source) || '线索库',
    confidence: Math.max(0, Math.min(1, Number(evidence.confidence) ?? 0.5)),
    observedAt: evidence.observedAt || Date.now(),
  };
  if (!entry.value) return ensurePersonIdentity(dm, opts);

  const next: DecisionMaker = {
    ...dm,
    evidence: mergeEvidenceLists(dm.evidence, [entry]),
  };

  if (entry.field === 'email' && entry.value.includes('@') && !normalizeEmail(dm.emailGuess)) {
    next.emailGuess = entry.value;
  }
  if (entry.field === 'linkedin' && entry.value && !asStr(dm.linkedin)) {
    next.linkedin = entry.value;
  }

  return ensurePersonIdentity(next, opts);
};

/** 旧数据无 evidence 时，从 emailSource / linkedin 合成一条，便于 UI 展开 */
export const hydrateEvidenceFromLegacy = (dm: DecisionMaker): DecisionMaker => {
  const existing = dm.evidence || [];
  const extras: FieldEvidence[] = [];
  const email = normalizeEmail(dm.emailGuess);
  const hasEmailEv = existing.some((e) => e.field === 'email' && normalizeEmail(e.value) === email);
  if (email && !hasEmailEv) {
    extras.push({
      field: 'email',
      value: email,
      source: asStr(dm.emailSource) || asStr(dm.source) || '线索库',
      confidence: confidenceFromDm(dm, 'email'),
      observedAt: dm.lastEmailCheckedAt || Date.now(),
      status: statusFromEmail(dm),
    });
  }
  const li = normalizeLinkedinPath(dm.linkedin) || asStr(dm.linkedin);
  const hasLiEv = existing.some(
    (e) => e.field === 'linkedin' && (normalizeLinkedinPath(e.value) || asStr(e.value)) === li
  );
  if (li && !hasLiEv) {
    extras.push({
      field: 'linkedin',
      value: asStr(dm.linkedin),
      source: dm.source === 'LinkedIn' ? 'LinkedIn' : '公开页',
      sourceUrl: asStr(dm.linkedin).startsWith('http') ? asStr(dm.linkedin) : undefined,
      confidence: confidenceFromDm(dm, 'linkedin'),
      observedAt: dm.lastEmailCheckedAt || Date.now(),
      status: 'found',
    });
  }
  if (!extras.length) return dm;
  return { ...dm, evidence: mergeEvidenceLists(existing, extras) };
};

export const ensurePersonIdentity = (
  dm: DecisionMaker,
  opts?: { companyDomain?: string | null }
): DecisionMaker => {
  if (!dm) return dm;
  const hydrated = hydrateEvidenceFromLegacy(dm);
  const personId = buildPersonId(hydrated, opts);
  if (hydrated.personId === personId && hydrated.evidence === dm.evidence) {
    return hydrated.personId ? hydrated : { ...hydrated, personId };
  }
  return { ...hydrated, personId };
};

export const bestEvidenceForField = (
  dm: DecisionMaker,
  field: FieldEvidenceField
): FieldEvidence | undefined => {
  const list = (dm.evidence || []).filter((e) => e.field === field);
  if (!list.length) return undefined;
  return list.slice().sort(
    (a, b) =>
      (Number(b.confidence) || 0) - (Number(a.confidence) || 0) ||
      (Number(b.observedAt) || 0) - (Number(a.observedAt) || 0)
  )[0];
};

export const fieldConfidencePercent = (
  dm: DecisionMaker,
  field: FieldEvidenceField
): number | undefined => {
  const ev = bestEvidenceForField(dm, field);
  if (ev && typeof ev.confidence === 'number') return Math.round(Math.max(0, Math.min(1, ev.confidence)) * 100);
  if (field === 'email' && dm.emailGuess?.includes('@')) {
    return Math.round(confidenceFromDm(dm, 'email') * 100);
  }
  if (field === 'linkedin' && dm.linkedin) {
    return Math.round(confidenceFromDm(dm, 'linkedin') * 100);
  }
  if (typeof dm.confidence === 'number') return Math.round(Math.max(0, Math.min(1, dm.confidence)) * 100);
  return undefined;
};

export const confidenceBadgeLabel = (pct?: number): { text: string; className: string } => {
  if (pct == null) return { text: '待评估', className: 'bg-slate-100 text-slate-500 border-slate-200' };
  if (pct >= 80) return { text: `可信 ${pct}%`, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (pct >= 50) return { text: `参考 ${pct}%`, className: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { text: `待核 ${pct}%`, className: 'bg-slate-100 text-slate-600 border-slate-200' };
};

export const formatEvidenceTime = (ms?: number): string => {
  if (!ms || !Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};
