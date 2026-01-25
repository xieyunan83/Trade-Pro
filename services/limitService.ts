
import { DailyUsage, GlobalConfig } from "../types";

const STORAGE_KEY_USAGE = "trade_scout_daily_usage";
const STORAGE_KEY_CONFIG = "trade_scout_remote_config";

// Default limits if offline
const DEFAULT_LIMITS = {
    search: 5,
    analysis: 2
};

export const getLocalUsage = (): DailyUsage => {
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem(STORAGE_KEY_USAGE);
    
    if (stored) {
        const usage: DailyUsage = JSON.parse(stored);
        if (usage.date === today) return usage;
    }
    
    // Reset for new day
    return { date: today, searchCount: 0, analysisCount: 0 };
};

const saveUsage = (usage: DailyUsage) => {
    localStorage.setItem(STORAGE_KEY_USAGE, JSON.stringify(usage));
};

export const getLimits = (): GlobalConfig['dailyLimits'] => {
    const storedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (storedConfig) {
        try {
            const config: GlobalConfig = JSON.parse(storedConfig);
            return config.dailyLimits;
        } catch(e) {}
    }
    return DEFAULT_LIMITS;
};

export const checkLimit = (type: 'search' | 'analysis'): { allowed: boolean, remaining: number, max: number } => {
    const usage = getLocalUsage();
    const limits = getLimits();
    
    const count = type === 'search' ? usage.searchCount : usage.analysisCount;
    const max = type === 'search' ? limits.search : limits.analysis;
    
    return {
        allowed: count < max,
        remaining: max - count,
        max: max
    };
};

export const incrementUsage = (type: 'search' | 'analysis') => {
    const usage = getLocalUsage();
    if (type === 'search') usage.searchCount++;
    else usage.analysisCount++;
    saveUsage(usage);
};

export const updateLocalConfig = (config: GlobalConfig) => {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
};
