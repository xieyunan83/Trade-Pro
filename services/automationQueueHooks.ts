import { useMemo, useSyncExternalStore } from 'react';
import type { AutomationResult } from '../types';
import {
  getAutomationCountsSnapshot,
  getAutomationQueueUiSnapshot,
  getAutomationQueueVersion,
  subscribeAutomationCounts,
  subscribeAutomationQueue,
  type AutomationCounts,
} from './automationQueueStore';

/** 仅计数变化时重渲染（今日看板顶栏） */
export const useAutomationCounts = (): AutomationCounts =>
  useSyncExternalStore(
    subscribeAutomationCounts,
    getAutomationCountsSnapshot,
    getAutomationCountsSnapshot
  );

/** 营销工具列表：订阅瘦身队列；大列表请再配合分页/deferred */
export const useAutomationQueueUi = (): AutomationResult[] => {
  const version = useSyncExternalStore(
    subscribeAutomationQueue,
    getAutomationQueueVersion,
    getAutomationQueueVersion
  );
  return useMemo(() => getAutomationQueueUiSnapshot(), [version]);
};
