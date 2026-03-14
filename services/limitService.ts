
import { GlobalConfig, DailyUsage, TaskType } from '../types';

let currentConfig: GlobalConfig = {
  lastUpdated: Date.now(),
  dailyLimits: {
    search: 50,
    analysis: 20
  },
  systemNotice: ''
};

export const updateLocalConfig = (config: GlobalConfig) => {
  currentConfig = config;
};

export const checkLimit = (type: TaskType | 'analysis' | 'search') => {
  const usage = getDailyUsage();
  const limit = type === 'search' ? currentConfig.dailyLimits.search : currentConfig.dailyLimits.analysis;
  const current = type === 'search' ? usage.searchCount : usage.analysisCount;
  
  return {
    allowed: current < limit,
    current,
    max: limit
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

const getDailyUsage = (): DailyUsage => {
  const today = new Date().toISOString().split('T')[0];
  const saved = localStorage.getItem('trade_scout_usage');
  if (saved) {
    const parsed = JSON.parse(saved) as DailyUsage;
    if (parsed.date === today) return parsed;
  }
  return { date: today, searchCount: 0, analysisCount: 0 };
};

const saveDailyUsage = (usage: DailyUsage) => {
  localStorage.setItem('trade_scout_usage', JSON.stringify(usage));
};
