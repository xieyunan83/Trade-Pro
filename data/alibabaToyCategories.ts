/**
 * 兼容层：玩具/母婴相关一级·二级（来自全站类目「母婴与玩具」大类）
 * 新代码请用 data/productTaxonomy.ts / services/categoryTaxonomy.ts
 */
import { getToyAlibabaL1Compat } from './productTaxonomy';

export type AlibabaToyL1 = {
  id: string;
  nameEn: string;
  children: string[];
};

const compat = getToyAlibabaL1Compat();

export const ALIBABA_TOY_CATEGORIES: AlibabaToyL1[] = compat.map((c) => ({
  id: c.id,
  nameEn: c.nameEn,
  children: c.children,
}));

export const ALIBABA_TOY_L1_NAMES = ALIBABA_TOY_CATEGORIES.map((c) => c.nameEn);

export const getAlibabaToyL2 = (l1NameOrId: string): string[] => {
  const key = (l1NameOrId || '').trim().toLowerCase();
  if (!key) return [];
  const hit = ALIBABA_TOY_CATEGORIES.find(
    (c) => c.nameEn.toLowerCase() === key || c.id === l1NameOrId || c.id.toLowerCase() === key
  );
  return hit?.children || [];
};
