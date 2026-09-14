/**
 * Hash 深链：#/module/strategy 等，刷新可恢复模块；不影响未使用 hash 的用户。
 */
import { useEffect, useRef } from 'react';
import { ModuleType } from '../types';

const MODULE_ALIASES: Record<string, ModuleType> = {
  discovery: ModuleType.DISCOVERY,
  background: ModuleType.BACKGROUND,
  products: ModuleType.PRODUCTS,
  decision_makers: ModuleType.DECISION_MAKERS,
  decision: ModuleType.DECISION_MAKERS,
  strategy: ModuleType.STRATEGY,
  similar: ModuleType.SIMILAR,
  promo: ModuleType.PROMO_GENERATOR,
  promo_generator: ModuleType.PROMO_GENERATOR,
  crm: ModuleType.CLIENT_CRM,
  client_crm: ModuleType.CLIENT_CRM,
  email: ModuleType.EMAIL_CAMPAIGN,
  email_campaign: ModuleType.EMAIL_CAMPAIGN,
  image: ModuleType.IMAGE_GENERATOR,
  image_generator: ModuleType.IMAGE_GENERATOR,
  product_match: ModuleType.PRODUCT_MATCH,
  match: ModuleType.PRODUCT_MATCH,
};

const moduleToSlug = (m: ModuleType): string => {
  switch (m) {
    case ModuleType.DISCOVERY:
      return 'discovery';
    case ModuleType.BACKGROUND:
      return 'background';
    case ModuleType.PRODUCTS:
      return 'products';
    case ModuleType.DECISION_MAKERS:
      return 'decision_makers';
    case ModuleType.STRATEGY:
      return 'strategy';
    case ModuleType.SIMILAR:
      return 'similar';
    case ModuleType.PROMO_GENERATOR:
      return 'promo';
    case ModuleType.CLIENT_CRM:
      return 'crm';
    case ModuleType.EMAIL_CAMPAIGN:
      return 'email';
    case ModuleType.IMAGE_GENERATOR:
      return 'image';
    case ModuleType.PRODUCT_MATCH:
      return 'product_match';
    default:
      return 'discovery';
  }
};

export const parseModuleFromHash = (): ModuleType | null => {
  try {
    const hash = window.location.hash || '';
    const m = hash.match(/#\/?module\/([a-z0-9_]+)/i);
    if (!m) return null;
    return MODULE_ALIASES[m[1].toLowerCase()] || null;
  } catch {
    return null;
  }
};

export const writeModuleHash = (module: ModuleType) => {
  try {
    const next = `#/module/${moduleToSlug(module)}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
    }
  } catch {
    /* ignore */
  }
};

export function useModuleHashRoute(
  activeModule: ModuleType,
  setActiveModule: (m: ModuleType) => void
) {
  const skipWrite = useRef(false);

  useEffect(() => {
    const fromHash = parseModuleFromHash();
    if (fromHash) {
      skipWrite.current = true;
      setActiveModule(fromHash);
    }
    const onHash = () => {
      const m = parseModuleFromHash();
      if (m) {
        skipWrite.current = true;
        setActiveModule(m);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    writeModuleHash(activeModule);
  }, [activeModule]);
}
