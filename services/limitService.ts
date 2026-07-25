
import { GlobalConfig, DailyUsage, TaskType } from '../types';

/** 默认额度放宽：额度由用户自己的 API 承担，20 次/天会误伤批量背调 */
let currentConfig: GlobalConfig = {
  lastUpdated: Date.now(),
  dailyLimits: {
    search: 500,
    analysis: 500,
  },
  systemNotice: ''
};

export const updateLocalConfig = (config: GlobalConfig) => {
  // 兼容旧云端配置 analysis:20 —— 过低会误停批量背调
  let search = config.dailyLimits?.search ?? 500;
  let analysis = config.dailyLimits?.analysis ?? 500;
  if (analysis > 0 && analysis < 100) analysis = 500;
  if (search > 0 && search < 100) search = 500;

  currentConfig = {
    ...config,
    dailyLimits: {
      search: Math.max(0, search),
      analysis: Math.max(0, analysis),
    },
  };
};

export const getLimitConfig = () => currentConfig.dailyLimits;

export const checkLimit = (type: TaskType | 'analysis' | 'search') => {
  const usage = getDailyUsage();
  const configured = type === 'search' ? currentConfig.dailyLimits.search : currentConfig.dailyLimits.analysis;
  // 0 或负数 = 不限制
  const limit = configured <= 0 ? Number.MAX_SAFE_INTEGER : configured;
  const current = type === 'search' ? usage.searchCount : usage.analysisCount;

  return {
    allowed: current < limit,
    current,
    max: configured <= 0 ? 0 : configured,
    unlimited: configured <= 0,
  };
};

export const incrementUsage = (type: TaskType | 'analysis' | 'search') => {
  const usage = getDailyUsage();
  if (type === 'search') {
    usage.searchCount++;
  } else {
    usage.analysisCount++;
  }
  saveDailyUsage(usage);
};

/** 重置今日用量（批量误触限额后可恢复） */
export const resetDailyUsage = () => {
  const today = new Date().toISOString().split('T')[0];
  saveDailyUsage({ date: today, searchCount: 0, analysisCount: 0 });
};

export const getDailyUsagePublic = (): DailyUsage => getDailyUsage();

const getDailyUsage = (): DailyUsage => {
  const today = new Date().toISOString().split('T')[0];
  const saved = localStorage.getItem('trade_scout_usage');
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as DailyUsage;
      if (parsed.date === today) return parsed;
    } catch {
      /* ignore */
    }
  }
  return { date: today, searchCount: 0, analysisCount: 0 };
};

const saveDailyUsage = (usage: DailyUsage) => {
  localStorage.setItem('trade_scout_usage', JSON.stringify(usage));
};

// 启动时：若仍是旧默认 analysis:20 且今日已用满，自动抬高配置并清零，避免批量莫名停住
(() => {
  try {
    const usage = getDailyUsage();
    if (usage.analysisCount >= 20 && currentConfig.dailyLimits.analysis <= 20) {
      currentConfig.dailyLimits = { search: 500, analysis: 500 };
    }
  } catch {
    /* ignore */
  }
})();
