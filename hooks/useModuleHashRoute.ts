/**
 * Hash 深链：#/module/strategy 等，刷新可恢复模块；不影响未使用 hash 的用户。
 */
import { useEffect, useRef } from 'react';
import { ModuleType } from '../types';

const MODULE_ALIASES: Record<string, ModuleType> = {
  home: ModuleType.HOME,
  hub: ModuleType.HOME,
  landing: ModuleType.HOME,
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
  product_catalog: ModuleType.PRODUCT_CATALOG,
  catalog: ModuleType.PRODUCT_CATALOG,
  product_quote: ModuleType.PRODUCT_QUOTE,
  quote: ModuleType.PRODUCT_QUOTE,
  product_design_2d: ModuleType.PRODUCT_DESIGN_2D,
  product_design_3d: ModuleType.PRODUCT_DESIGN_3D,
  product_3d_print: ModuleType.PRODUCT_3D_PRINT,
  product_ai_video: ModuleType.PRODUCT_AI_VIDEO,
  product_packaging: ModuleType.PRODUCT_PACKAGING,
  packaging: ModuleType.PRODUCT_PACKAGING,
  site_builder: ModuleType.SITE_BUILDER,
  social_content: ModuleType.SOCIAL_CONTENT,
  whatsapp: ModuleType.WHATSAPP,
  contact_tools: ModuleType.WHATSAPP,
  contacts_im: ModuleType.WHATSAPP,
  /** 序列开发信已下线，深链转到开发策略 */
  email_sequence: ModuleType.STRATEGY,
  sequences: ModuleType.STRATEGY,
  eco_parts: ModuleType.ECO_PARTS,
  eco_merch: ModuleType.ECO_MERCH,
  eco_cert: ModuleType.ECO_CERT,
  eco_audit: ModuleType.ECO_AUDIT,
  eco_delivery: ModuleType.ECO_DELIVERY,
};

const moduleToSlug = (m: ModuleType): string => String(m);

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
