import { useMemo, useSyncExternalStore } from 'react';
import type { Client } from '../types';
import {
  getCrmClientsSnapshot,
  getCrmClientsVersion,
  subscribeCrmClients,
} from './crmStore';

/** 订阅 CRM；仅本组件重绘，不牵动 App 根 */
export const useCrmClients = (): Client[] => {
  const version = useSyncExternalStore(
    subscribeCrmClients,
    getCrmClientsVersion,
    getCrmClientsVersion
  );
  return useMemo(() => getCrmClientsSnapshot(), [version]);
};
