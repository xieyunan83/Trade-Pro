import type { DiscoveryState, IcpTemplate } from '../types';

const keyFor = (username: string) =>
  `trade_scout_icp_templates_v1_${(username || 'default').trim().toLowerCase()}`;

export const loadIcpTemplates = (username: string): IcpTemplate[] => {
  try {
    const raw = localStorage.getItem(keyFor(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t === 'object' && t.id && t.name)
      .map((t) => ({
        id: String(t.id),
        name: String(t.name || '').trim() || '未命名 ICP',
        product: String(t.product || ''),
        industry: String(t.industry || ''),
        countries: Array.isArray(t.countries) ? t.countries.map(String) : [],
        clientTypes: Array.isArray(t.clientTypes) ? t.clientTypes.map(String) : [],
        excludeNotes: t.excludeNotes ? String(t.excludeNotes) : undefined,
        createdAt: Number(t.createdAt) || Date.now(),
        updatedAt: Number(t.updatedAt) || Date.now(),
      }));
  } catch {
    return [];
  }
};

export const saveIcpTemplates = (username: string, list: IcpTemplate[]) => {
  try {
    localStorage.setItem(keyFor(username), JSON.stringify(list.slice(0, 40)));
  } catch {
    /* quota */
  }
};

export const upsertIcpTemplate = (
  username: string,
  input: Omit<IcpTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): IcpTemplate[] => {
  const list = loadIcpTemplates(username);
  const now = Date.now();
  if (input.id) {
    const next = list.map((t) =>
      t.id === input.id
        ? {
            ...t,
            name: input.name.trim() || t.name,
            product: input.product,
            industry: input.industry,
            countries: input.countries,
            clientTypes: input.clientTypes,
            excludeNotes: input.excludeNotes,
            updatedAt: now,
          }
        : t
    );
    saveIcpTemplates(username, next);
    return next;
  }
  const created: IcpTemplate = {
    id: crypto.randomUUID(),
    name: input.name.trim() || `ICP ${list.length + 1}`,
    product: input.product,
    industry: input.industry,
    countries: input.countries,
    clientTypes: input.clientTypes,
    excludeNotes: input.excludeNotes,
    createdAt: now,
    updatedAt: now,
  };
  const next = [created, ...list];
  saveIcpTemplates(username, next);
  return next;
};

export const deleteIcpTemplate = (username: string, id: string): IcpTemplate[] => {
  const next = loadIcpTemplates(username).filter((t) => t.id !== id);
  saveIcpTemplates(username, next);
  return next;
};

export const icpFromDiscoveryState = (
  state: DiscoveryState,
  name: string,
  excludeNotes?: string
): Omit<IcpTemplate, 'id' | 'createdAt' | 'updatedAt'> => ({
  name,
  product: state.product || '',
  industry: state.industry || '',
  countries: state.countries?.length
    ? state.countries
    : state.country
      ? state.country.split(/[,，;/|]+/).map((s) => s.trim()).filter(Boolean)
      : [],
  clientTypes: state.clientTypes?.length
    ? state.clientTypes
    : state.clientType
      ? state.clientType.split(/[,，;/|]+/).map((s) => s.trim()).filter(Boolean)
      : [],
  excludeNotes: excludeNotes?.trim() || undefined,
});

export const applyIcpToDiscoveryState = (
  state: DiscoveryState,
  icp: IcpTemplate
): DiscoveryState => ({
  ...state,
  product: icp.product,
  industry: icp.industry,
  countries: [...icp.countries],
  country: icp.countries[0] || '',
  clientTypes: [...icp.clientTypes],
  clientType: icp.clientTypes[0] || '',
  // 应用模板时清空旧结果，避免误以为已按新 ICP 搜过
  results: [],
  hasSearched: false,
});
