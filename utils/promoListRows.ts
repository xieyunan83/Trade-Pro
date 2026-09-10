import { AutomationResult, Client, DecisionMaker, HistoryItem } from '../types';
import {
  buildHistoryLookupIndex,
  normalizeCrmHost,
} from './crmHistory';
import {
  CompanyIntelStatus,
  resolveAutomationTaskIntel,
  resolveCrmClientIntel,
} from './companyIntelStatus';

export type PromoListRow = {
  id: string;
  source: 'queue' | 'crm';
  task?: AutomationResult;
  client?: Client;
  intel: CompanyIntelStatus;
  clientName: string;
  website: string;
  country: string;
  owner: string;
  keywords: string[];
  industry: string;
  contact: DecisionMaker | null;
  status: AutomationResult['status'] | 'crm';
  mode?: 'detailed' | 'economy';
};

const taskKeywords = (task: AutomationResult): string[] => {
  const tags = (task.analysis?.searchTags || [])
    .filter((t) => t.startsWith('关键词:'))
    .map((t) => t.replace(/^关键词:/, '').trim());
  return Array.from(
    new Set([task.keyword, task.analysis?.searchKeyword, ...tags].filter(Boolean) as string[])
  );
};

/** 营销工具列表：自动化队列 ∪ CRM（去重），状态与客户管理/记录中心一致 */
export const buildPromoListRows = (
  automationResults: AutomationResult[],
  crmClients: Client[],
  history: HistoryItem[]
): PromoListRow[] => {
  const historyIndex = buildHistoryLookupIndex(history);
  const coveredHosts = new Set<string>();
  const coveredNames = new Set<string>();
  const rows: PromoListRow[] = [];

  for (const task of automationResults) {
    const intel = resolveAutomationTaskIntel(task, crmClients, historyIndex);
    const website = task.website || task.analysis?.companyInfo?.website || intel.crmClient?.website || '';
    const name = task.analysis?.companyInfo?.name || task.clientName || intel.crmClient?.name || '';
    const host = normalizeCrmHost(website);
    if (host) coveredHosts.add(host);
    const nk = name.trim().toLowerCase();
    if (nk) coveredNames.add(nk);

    const analysis = intel.bestAnalysis || task.analysis;
    rows.push({
      id: task.id,
      source: 'queue',
      task,
      client: intel.crmClient,
      intel,
      clientName: name || '—',
      website: website || '—',
      country: (task.country || analysis?.searchCountry || intel.crmClient?.country || '').trim(),
      owner: (task.ownerUsername || intel.crmClient?.ownerUsername || '').trim(),
      keywords: taskKeywords(task).length
        ? taskKeywords(task)
        : [intel.crmClient?.searchKeyword].filter(Boolean) as string[],
      industry: (analysis?.companyInfo?.nature || intel.crmClient?.industry || '').trim(),
      contact: intel.primaryContact || null,
      status: task.status,
      mode: task.mode,
    });
  }

  for (const client of crmClients) {
    const host = normalizeCrmHost(client.website);
    const nk = (client.name || '').trim().toLowerCase();
    if (host && coveredHosts.has(host)) continue;
    if (nk && coveredNames.has(nk)) continue;

    const intel = resolveCrmClientIntel(client, historyIndex);
    const analysis = intel.bestAnalysis;
    const kws = Array.from(
      new Set(
        [client.searchKeyword, ...(client.searchedKeywords || []), analysis?.searchKeyword]
          .filter(Boolean) as string[]
      )
    );

    rows.push({
      id: `crm:${client.id}`,
      source: 'crm',
      client,
      intel,
      clientName: client.name || '—',
      website: client.website || analysis?.companyInfo?.website || '—',
      country: (client.country || analysis?.searchCountry || '').trim(),
      owner: (client.ownerUsername || '').trim(),
      keywords: kws,
      industry: (client.industry || analysis?.companyInfo?.nature || '').trim(),
      contact: intel.primaryContact || null,
      status: 'crm',
      mode: undefined,
    });
  }

  return rows;
};
