import { useMemo, useSyncExternalStore } from 'react';
import type { HistoryItem } from '../types';
import {
  getHistorySnapshot,
  getHistoryVersion,
  subscribeHistory,
} from './historyStore';

/** 订阅背调历史；仅本组件重绘 */
export const useHistoryItems = (): HistoryItem[] => {
  const version = useSyncExternalStore(
    subscribeHistory,
    getHistoryVersion,
    getHistoryVersion
  );
  return useMemo(() => getHistorySnapshot(), [version]);
};
