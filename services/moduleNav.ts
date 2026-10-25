/**
 * 导航元数据（兼容旧引用；权威结构见 platformSections）
 */
import { ModuleType } from '../types';
import { ALL_PLATFORM_NAV_ITEMS, PLATFORM_SECTIONS } from './platformSections';

export { PLATFORM_SECTIONS, ALL_PLATFORM_NAV_ITEMS };

/** 无需先做背调即可进入的模块 */
export const ALWAYS_ACTIVE_MODULES: ModuleType[] = [
  ModuleType.DISCOVERY,
  ModuleType.PROMO_GENERATOR,
  ModuleType.CLIENT_CRM,
  ModuleType.PRODUCT_MATCH,
  ModuleType.STRATEGY,
  ModuleType.EMAIL_CAMPAIGN,
  ModuleType.IMAGE_GENERATOR,
  ModuleType.PRODUCT_CATALOG,
  ModuleType.PRODUCT_QUOTE,
  ModuleType.PRODUCT_DESIGN_2D,
  ModuleType.PRODUCT_DESIGN_3D,
  ModuleType.PRODUCT_3D_PRINT,
  ModuleType.PRODUCT_AI_VIDEO,
  ModuleType.SITE_BUILDER,
  ModuleType.SOCIAL_CONTENT,
  ModuleType.WHATSAPP,
  ModuleType.ECO_PARTS,
  ModuleType.ECO_MERCH,
  ModuleType.ECO_CERT,
  ModuleType.ECO_AUDIT,
  ModuleType.ECO_DELIVERY,
];

export const NAV_MODULE_DEFS = ALL_PLATFORM_NAV_ITEMS.map((item) => ({
  id: item.id,
  label: item.label,
  sub: item.sub,
  icon: item.icon,
}));
