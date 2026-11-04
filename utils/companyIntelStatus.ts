import { AnalysisResult, AutomationResult, Client, DecisionMaker, HistoryItem } from '../types';
import { hasRichProductCatalog } from '../services/productCatalog';
import {
  buildCrmLookupIndex,
  buildHistoryLookupIndex,
  clientHasBackgroundCheckIndexed,
  countAnalysisDecisionMakers,
  findCrmClientIndex,
  findCrmClientIndexFast,
  historyHasDmSearch,
  lookupHistoryForClient,
  resolveDmDigStatus,
  type CrmLookupIndex,
  type DmDigStatus,
  type HistoryLookupIndex,
} from './crmHistory';

export type CompanyIntelStatus = {
  hasBg: boolean;
  hasProduct: boolean;
  hasDm: boolean;
  dmStatus: DmDigStatus;
  dmContactCount: number;
  inCrm: boolean;
  historyItem?: HistoryItem;
  crmClient?: Client;
  /** 展示用：优先队列分析，其次历史，再 CRM 联系人 */
  bestAnalysis?: AnalysisResult | null;
  primaryContact?: DecisionMaker | null;
};

/** 在 CRM 中按官网 / 名称匹配客户（与导入去重同一套规则） */
export const findCrmClientMatch = (
  clients: Client[],
  website?: string | null,
  name?: string | null,
  crmIndex?: CrmLookupIndex
): Client | undefined => {
  const idx = crmIndex
    ? findCrmClientIndexFast(crmIndex, website, name)
    : findCrmClientIndex(clients, website, name);
  const list = crmIndex?.clients || clients;
  return idx >= 0 ? list[idx] : undefined;
};

const pickPrimaryContact = (
  analysis?: AnalysisResult | null,
  crm?: Client | null
): DecisionMaker | null => {
  const fromAnalysis = analysis?.decisionMakers || [];
  const fromCrm = crm?.contacts || [];
  const pool = [...fromAnalysis, ...fromCrm];
  const withEmail = pool.find((d) => d.emailGuess?.includes('@'));
  return withEmail || pool[0] || null;
};

const pickBestAnalysis = (
  taskAnalysis?: AnalysisResult | null,
  historyData?: AnalysisResult | null
): AnalysisResult | null | undefined => {
  if (taskAnalysis && historyData) {
    const tN = taskAnalysis.decisionMakers?.length || 0;
    const hN = historyData.decisionMakers?.length || 0;
    const tProduct = hasRichProductCatalog(taskAnalysis);
    const hProduct = hasRichProductCatalog(historyData);
    if (hN > tN) return historyData;
    if (tN > hN) return taskAnalysis;
    if (hProduct && !tProduct) return historyData;
    return taskAnalysis;
  }
  return taskAnalysis || historyData || null;
};

/** 统一三模块情报状态：队列任务 + CRM + 历史 */
export const resolveCompanyIntelStatus = (opts: {
  website?: string | null;
  name?: string | null;
  taskAnalysis?: AnalysisResult | null;
  taskCompleted?: boolean;
  crmClients?: Client[];
  crmIndex?: CrmLookupIndex;
  historyIndex?: HistoryLookupIndex;
  history?: HistoryItem[];
}): CompanyIntelStatus => {
  const clients = opts.crmClients || [];
  const index =
    opts.historyIndex ||
    (opts.history?.length ? buildHistoryLookupIndex(opts.history) : undefined);

  const crmClient = findCrmClientMatch(
    clients,
    opts.website,
    opts.name,
    opts.crmIndex
  );
  const historyItem = index
    ? lookupHistoryForClient(
        {
          id: crmClient?.id || '_',
          name: opts.name || crmClient?.name || '',
          website: opts.website || crmClient?.website || '',
          country: '',
          type: '进口商',
          status: '新建/潜在',
          productType: '',
          industry: '',
          priceRange: '',
          isSampleNeeded: false,
          lastOrderDate: '',
          lastContactSent: '',
          lastContactReceived: '',
          nextFollowUpDate: '',
          activityLog: '',
          contacts: [],
        } as Client,
        index
      )
    : undefined;

  const bestAnalysis = pickBestAnalysis(opts.taskAnalysis, historyItem?.data);
  const hasBg =
    !!opts.taskCompleted ||
    !!opts.taskAnalysis ||
    !!(crmClient && (crmClient.hasBackgroundCheck || crmClient.hasAnalyzed)) ||
    !!historyItem ||
    (crmClient && index ? clientHasBackgroundCheckIndexed(crmClient, index) : false);

  const hasProduct =
    hasRichProductCatalog(opts.taskAnalysis) || hasRichProductCatalog(historyItem?.data);

  const crmHasEmailContacts =
    Array.isArray(crmClient?.contacts) &&
    crmClient!.contacts!.some((d) => !!(d.emailGuess && String(d.emailGuess).includes('@')));

  const hasDm =
    !!opts.taskAnalysis?.decisionMakerEmailSearchAt ||
    (historyItem ? historyHasDmSearch(historyItem) : false) ||
    crmHasEmailContacts ||
    (Array.isArray(opts.taskAnalysis?.decisionMakers) &&
      opts.taskAnalysis!.decisionMakers!.some((d) => !!(d.emailGuess && String(d.emailGuess).includes('@'))));

  const dmContactCount = Math.max(
    opts.taskAnalysis?.decisionMakers?.length || 0,
    countAnalysisDecisionMakers(historyItem?.data),
    Array.isArray(crmClient?.contacts) ? crmClient!.contacts!.length : 0
  );

  const dmStatus = resolveDmDigStatus(hasDm, hasDm ? dmContactCount : 0);

  return {
    hasBg,
    hasProduct,
    hasDm,
    dmStatus,
    dmContactCount: hasDm ? dmContactCount : 0,
    inCrm: !!crmClient,
    historyItem,
    crmClient,
    bestAnalysis,
    primaryContact: pickPrimaryContact(bestAnalysis, crmClient),
  };
};

/** 自动化队列任务 → 统一情报状态 */
export const resolveAutomationTaskIntel = (
  task: AutomationResult,
  crmClients: Client[],
  historyIndex: HistoryLookupIndex,
  crmIndex?: CrmLookupIndex
): CompanyIntelStatus =>
  resolveCompanyIntelStatus({
    website: task.website || task.analysis?.companyInfo?.website,
    name: task.clientName || task.analysis?.companyInfo?.name,
    taskAnalysis: task.analysis,
    taskCompleted: task.status === 'completed' && !!task.analysis,
    crmClients,
    crmIndex,
    historyIndex,
  });

/** CRM 客户 → 统一情报状态（营销工具合并展示用） */
export const resolveCrmClientIntel = (
  client: Client,
  historyIndex: HistoryLookupIndex
): CompanyIntelStatus =>
  resolveCompanyIntelStatus({
    website: client.website,
    name: client.name,
    crmClients: [client],
    historyIndex,
  });
