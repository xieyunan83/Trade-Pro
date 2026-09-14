/**
 * 从 App 抽出的导航元数据
 */
import {
  Globe,
  LayoutDashboard,
  PackageSearch,
  Users,
  PenTool,
  Network,
  Target,
  Briefcase,
  Mail,
  Image,
  Ruler,
} from 'lucide-react';
import { ModuleType } from '../types';

export const ALWAYS_ACTIVE_MODULES: ModuleType[] = [
  ModuleType.DISCOVERY,
  ModuleType.PROMO_GENERATOR,
  ModuleType.CLIENT_CRM,
  ModuleType.PRODUCT_MATCH,
  ModuleType.STRATEGY,
  ModuleType.EMAIL_CAMPAIGN,
  ModuleType.IMAGE_GENERATOR,
];

export const NAV_MODULE_DEFS: Array<{
  id: ModuleType;
  label: string;
  sub: string;
  icon: typeof Globe;
}> = [
  { id: ModuleType.DISCOVERY, label: '客户搜索', sub: 'Discovery', icon: Globe },
  { id: ModuleType.BACKGROUND, label: '背景调查', sub: 'Background', icon: LayoutDashboard },
  { id: ModuleType.PRODUCTS, label: '产品分析', sub: 'Products', icon: PackageSearch },
  { id: ModuleType.DECISION_MAKERS, label: '决策人挖掘', sub: 'Contacts', icon: Users },
  { id: ModuleType.STRATEGY, label: '开发策略', sub: 'Strategy', icon: PenTool },
  { id: ModuleType.SIMILAR, label: '同类推荐', sub: 'Similar', icon: Network },
  { id: ModuleType.PRODUCT_MATCH, label: '新品匹配', sub: 'Match', icon: Target },
  { id: ModuleType.CLIENT_CRM, label: '客户管理', sub: 'CRM', icon: Briefcase },
  { id: ModuleType.EMAIL_CAMPAIGN, label: '邮件营销', sub: 'DirectMail', icon: Mail },
  { id: ModuleType.IMAGE_GENERATOR, label: '海报/生图', sub: 'Poster', icon: Image },
  { id: ModuleType.PROMO_GENERATOR, label: '营销工具', sub: 'Tools', icon: Ruler },
];
