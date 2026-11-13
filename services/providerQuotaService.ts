/**
 * 管理后台 · 各外部服务剩余额度总览（为后续公司/部门/员工分配做数据底座）
 * Admin 可展示供应商名；业务员前台勿引用本模块文案。
 */
import {
  getPoolKeyStatuses,
  listPoolKeys,
  type ApiKeyPoolProvider,
} from './apiKeyPool';
import { getAnymailCreditBalance, testHunterApiKey } from './geminiService';
import { getDailyUsagePublic, getLimitConfig } from './limitService';
import { fetchAccountSummary, isDirectMailConfigured } from './directMailService';
import { loadEmailCampaignStoreForUser } from './emailCampaignStore';
import type { AliyunConfig, User } from '../types';

export type ProviderQuotaRow = {
  id: string;
  /** 管理后台展示名（可含供应商） */
  name: string;
  category: 'llm' | 'search' | 'email' | 'image' | 'app';
  status: 'ok' | 'warn' | 'error' | 'unknown';
  /** 主额度文案，如「剩余 120 积分」 */
  remainingLabel: string;
  detail: string;
  /** 结构化剩余（能解析到数字时） */
  remaining?: number;
  total?: number;
  keysTotal?: number;
  keysUsable?: number;
};

const poolSummary = (provider: ApiKeyPoolProvider, label: string): ProviderQuotaRow => {
  const statuses = getPoolKeyStatuses(provider);
  const total = statuses.length;
  const usable = statuses.filter((s) => !s.exhausted).length;
  const exhausted = total - usable;
  if (!total) {
    return {
      id: provider,
      name: label,
      category: provider === 'wan' ? 'image' : provider === 'tavily' || provider === 'anysearch' ? 'search' : 'llm',
      status: 'unknown',
      remainingLabel: '未配置 Key',
      detail: '请到「API 密钥配置」添加',
      keysTotal: 0,
      keysUsable: 0,
    };
  }
  return {
    id: provider,
    name: label,
    category:
      provider === 'wan'
        ? 'image'
        : provider === 'tavily' || provider === 'anysearch' || provider === 'hunter' || provider === 'findymail' || provider === 'anymailfinder'
          ? 'search'
          : 'llm',
    status: usable === 0 ? 'error' : exhausted > 0 ? 'warn' : 'ok',
    remainingLabel:
      usable === 0
        ? '本月可用 Key：0'
        : exhausted > 0
          ? `可用 Key ${usable}/${total}`
          : `Key 池 ${total} 把均可用`,
    detail:
      usable === 0
        ? '全部 Key 已标「本月额度耗尽」，请加购或换 Key'
        : '供应商未开放统一余额 API 时，以 Key 池可用数与连通测试为准',
    keysTotal: total,
    keysUsable: usable,
  };
};

const parseHunterQuota = (
  message: string
): { used?: number; available?: number } => {
  const m = message.match(/搜索额度\s*(\d+)\s*\/\s*(\d+)/);
  if (!m) return {};
  return { used: Number(m[1]), available: Number(m[2]) };
};

/** 拉取全平台额度快照（仅 Admin 调用） */
export const fetchProviderQuotaSnapshot = async (opts?: {
  currentUser?: User;
}): Promise<ProviderQuotaRow[]> => {
  const rows: ProviderQuotaRow[] = [];

  // —— 大模型 / 生图 ——
  rows.push(poolSummary('qwen', '千问 Token Plan（文本/工具）'));
  rows.push(poolSummary('gemini', 'Gemini（Google）'));
  rows.push(poolSummary('wan', '万相（生图）'));

  // —— 检索 / 邮箱 ——
  rows.push(poolSummary('tavily', 'Tavily（联网检索）'));
  rows.push(poolSummary('anysearch', 'AnySearch（身份补全）'));

  // Anymail：真实积分余额
  try {
    const keys = listPoolKeys('anymailfinder');
    if (!keys.length) {
      rows.push({
        id: 'anymailfinder',
        name: 'AnymailFinder',
        category: 'email',
        status: 'unknown',
        remainingLabel: '未配置 Key',
        detail: '请到 API 密钥配置添加',
        keysTotal: 0,
        keysUsable: 0,
      });
    } else {
      const bal = await getAnymailCreditBalance(keys[0]);
      const usable = getPoolKeyStatuses('anymailfinder').filter((s) => !s.exhausted).length;
      rows.push({
        id: 'anymailfinder',
        name: 'AnymailFinder',
        category: 'email',
        status: bal.ok ? (bal.creditsLeft === 0 ? 'error' : 'ok') : 'warn',
        remainingLabel: bal.ok
          ? `剩余 ${bal.creditsLeft ?? '—'} 积分`
          : bal.message.slice(0, 80),
        detail: `${bal.message} · Key 池可用 ${usable}/${keys.length}`,
        remaining: bal.creditsLeft,
        keysTotal: keys.length,
        keysUsable: usable,
      });
    }
  } catch (e: any) {
    rows.push({
      id: 'anymailfinder',
      name: 'AnymailFinder',
      category: 'email',
      status: 'error',
      remainingLabel: '查询失败',
      detail: e?.message || String(e),
    });
  }

  // Hunter：搜索 used/available
  try {
    const keys = listPoolKeys('hunter');
    if (!keys.length) {
      rows.push({
        id: 'hunter',
        name: 'Hunter.io',
        category: 'search',
        status: 'unknown',
        remainingLabel: '未配置 Key',
        detail: '请到 API 密钥配置添加',
        keysTotal: 0,
        keysUsable: 0,
      });
    } else {
      const r = await testHunterApiKey(keys[0]);
      const q = parseHunterQuota(r.message);
      const left =
        typeof q.used === 'number' && typeof q.available === 'number'
          ? Math.max(0, q.available - q.used)
          : undefined;
      rows.push({
        id: 'hunter',
        name: 'Hunter.io',
        category: 'search',
        status: r.success ? (left === 0 ? 'error' : 'ok') : 'warn',
        remainingLabel:
          left != null ? `剩余搜索 ${left}` : r.success ? '账户可读' : r.message.slice(0, 80),
        detail: r.message,
        remaining: left,
        total: q.available,
        keysTotal: keys.length,
        keysUsable: getPoolKeyStatuses('hunter').filter((s) => !s.exhausted).length,
      });
    }
  } catch (e: any) {
    rows.push({
      id: 'hunter',
      name: 'Hunter.io',
      category: 'search',
      status: 'error',
      remainingLabel: '查询失败',
      detail: e?.message || String(e),
    });
  }

  rows.push(poolSummary('findymail', 'Findymail'));

  // DirectMail 日/月额度
  try {
    let config: AliyunConfig | null = null;
    if (opts?.currentUser) {
      const store = loadEmailCampaignStoreForUser(opts.currentUser, [], []);
      config = store.config;
    }
    if (!isDirectMailConfigured(config)) {
      rows.push({
        id: 'directmail',
        name: '邮件推送（DirectMail）',
        category: 'email',
        status: 'unknown',
        remainingLabel: '未配置发信接口',
        detail: '请在邮件营销「接口配置」填写 AccessKey / 发信地址',
      });
    } else {
      const sum = await fetchAccountSummary(config!);
      if (sum.ok === false) {
        rows.push({
          id: 'directmail',
          name: '邮件推送（DirectMail）',
          category: 'email',
          status: 'error',
          remainingLabel: '查询失败',
          detail: sum.error || '无法读取账户摘要',
        });
      } else {
        const s = sum.summary;
        rows.push({
          id: 'directmail',
          name: '邮件推送（DirectMail）',
          category: 'email',
          status: s.userStatus === 0 ? 'ok' : 'warn',
          remainingLabel: `日额度 ${s.dailyQuota.toLocaleString()} · 免费余 ${s.remainFreeQuota.toLocaleString()}`,
          detail: `月额度 ${s.monthQuota.toLocaleString()} · 信誉 ${s.quotaLevel}/${s.maxQuotaLevel} · 状态码 ${s.userStatus}`,
          remaining: s.remainFreeQuota,
          total: s.dailyQuota,
        });
      }
    }
  } catch (e: any) {
    rows.push({
      id: 'directmail',
      name: '邮件推送（DirectMail）',
      category: 'email',
      status: 'error',
      remainingLabel: '查询失败',
      detail: e?.message || String(e),
    });
  }

  // 平台内部日限额（给员工分配的前置）
  const usage = getDailyUsagePublic();
  const limits = getLimitConfig();
  rows.push({
    id: 'app_search',
    name: '平台·客户搜索日限额',
    category: 'app',
    status:
      limits.search <= 0
        ? 'ok'
        : usage.searchCount >= limits.search
          ? 'error'
          : usage.searchCount / limits.search > 0.8
            ? 'warn'
            : 'ok',
    remainingLabel:
      limits.search <= 0
        ? '不限'
        : `剩余 ${Math.max(0, limits.search - usage.searchCount)}`,
    detail: `今日已用 ${usage.searchCount}${limits.search > 0 ? ` / ${limits.search}` : ''}`,
    remaining: limits.search <= 0 ? undefined : Math.max(0, limits.search - usage.searchCount),
    total: limits.search <= 0 ? undefined : limits.search,
  });
  rows.push({
    id: 'app_analysis',
    name: '平台·背调日限额',
    category: 'app',
    status:
      limits.analysis <= 0
        ? 'ok'
        : usage.analysisCount >= limits.analysis
          ? 'error'
          : usage.analysisCount / limits.analysis > 0.8
            ? 'warn'
            : 'ok',
    remainingLabel:
      limits.analysis <= 0
        ? '不限'
        : `剩余 ${Math.max(0, limits.analysis - usage.analysisCount)}`,
    detail: `今日已用 ${usage.analysisCount}${limits.analysis > 0 ? ` / ${limits.analysis}` : ''}`,
    remaining: limits.analysis <= 0 ? undefined : Math.max(0, limits.analysis - usage.analysisCount),
    total: limits.analysis <= 0 ? undefined : limits.analysis,
  });

  return rows;
};
