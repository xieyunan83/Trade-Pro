/**
 * 五板块信息架构：商机 / 产品 / 宣发 / 联动 / 生态
 * 仅导航元数据，不改业务数据存储。
 */
import {
  Globe,
  LayoutDashboard,
  PackageSearch,
  Users,
  Network,
  Target,
  PenTool,
  Briefcase,
  Mail,
  Image,
  Ruler,
  Box,
  Printer,
  Clapperboard,
  Sparkles,
  Code2,
  Share2,
  MessageCircle,
  Puzzle,
  Gift,
  BadgeCheck,
  Factory,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { ModuleType } from '../types';

export type PlatformSectionId = 'opportunity' | 'product' | 'promote' | 'connect' | 'ecosystem';

export type PlatformNavItem = {
  id: ModuleType;
  label: string;
  sub: string;
  icon: LucideIcon;
  /** 框架占位：功能尚未实现 */
  comingSoon?: boolean;
};

export type PlatformSection = {
  id: PlatformSectionId;
  label: string;
  sub: string;
  accent: string;
  icon: LucideIcon;
  items: PlatformNavItem[];
};

export const PLATFORM_SECTIONS: PlatformSection[] = [
  {
    id: 'opportunity',
    label: '商机',
    sub: 'Opportunity',
    accent: '#22d3ee',
    icon: Globe,
    items: [
      { id: ModuleType.DISCOVERY, label: '客户搜索', sub: 'Discovery', icon: Globe },
      { id: ModuleType.BACKGROUND, label: '背景调查', sub: 'Background', icon: LayoutDashboard },
      { id: ModuleType.PRODUCTS, label: '产品分析', sub: 'Products', icon: PackageSearch },
      { id: ModuleType.DECISION_MAKERS, label: '决策人挖掘', sub: 'Contacts', icon: Users },
      { id: ModuleType.SIMILAR, label: '同类推荐', sub: 'Similar', icon: Network },
      { id: ModuleType.PRODUCT_MATCH, label: '新品匹配', sub: 'Match', icon: Target },
    ],
  },
  {
    id: 'product',
    label: '产品',
    sub: 'Product',
    accent: '#a78bfa',
    icon: Box,
    items: [
      {
        id: ModuleType.PRODUCT_DESIGN_2D,
        label: '产品设计 · 平面图',
        sub: '2D Design',
        icon: Sparkles,
        comingSoon: true,
      },
      {
        id: ModuleType.PRODUCT_DESIGN_3D,
        label: '产品设计 · 3D 图',
        sub: '3D Model',
        icon: Box,
        comingSoon: true,
      },
      {
        id: ModuleType.IMAGE_GENERATOR,
        label: '详情图 / 海报',
        sub: 'Poster',
        icon: Image,
      },
      {
        id: ModuleType.PRODUCT_3D_PRINT,
        label: '3D 打印',
        sub: 'Print',
        icon: Printer,
        comingSoon: true,
      },
      {
        id: ModuleType.PRODUCT_AI_VIDEO,
        label: '产品 AI 视频',
        sub: 'Short Drama',
        icon: Clapperboard,
        comingSoon: true,
      },
    ],
  },
  {
    id: 'promote',
    label: '宣发',
    sub: 'Promote',
    accent: '#f472b6',
    icon: Share2,
    items: [
      {
        id: ModuleType.SITE_BUILDER,
        label: '独立站生成',
        sub: 'Vibe Site',
        icon: Code2,
        comingSoon: true,
      },
      {
        id: ModuleType.SOCIAL_CONTENT,
        label: '发文素材加工',
        sub: 'Social',
        icon: Share2,
        comingSoon: true,
      },
    ],
  },
  {
    id: 'connect',
    label: '联动',
    sub: 'Connect',
    accent: '#34d399',
    icon: MessageCircle,
    items: [
      { id: ModuleType.STRATEGY, label: '开发策略', sub: 'Strategy', icon: PenTool },
      { id: ModuleType.CLIENT_CRM, label: '客户管理', sub: 'CRM', icon: Briefcase },
      { id: ModuleType.EMAIL_CAMPAIGN, label: '邮件营销', sub: 'DirectMail', icon: Mail },
      {
        id: ModuleType.WHATSAPP,
        label: 'WhatsApp 联系',
        sub: 'WhatsApp',
        icon: MessageCircle,
        comingSoon: true,
      },
      { id: ModuleType.PROMO_GENERATOR, label: '营销工具', sub: 'Tools', icon: Ruler },
    ],
  },
  {
    id: 'ecosystem',
    label: '生态',
    sub: 'Ecosystem',
    accent: '#fbbf24',
    icon: Factory,
    items: [
      {
        id: ModuleType.ECO_PARTS,
        label: '产品配件',
        sub: 'Parts',
        icon: Puzzle,
        comingSoon: true,
      },
      {
        id: ModuleType.ECO_MERCH,
        label: '产品周边',
        sub: 'Merch',
        icon: Gift,
        comingSoon: true,
      },
      {
        id: ModuleType.ECO_CERT,
        label: '产品认证',
        sub: 'Cert',
        icon: BadgeCheck,
        comingSoon: true,
      },
      {
        id: ModuleType.ECO_AUDIT,
        label: '验厂机构',
        sub: 'Audit',
        icon: Factory,
        comingSoon: true,
      },
      {
        id: ModuleType.ECO_DELIVERY,
        label: '交付出货',
        sub: 'Delivery',
        icon: Truck,
        comingSoon: true,
      },
    ],
  },
];

export const findSectionByModule = (mod: ModuleType): PlatformSection | undefined =>
  PLATFORM_SECTIONS.find((s) => s.items.some((i) => i.id === mod));

export const findNavItem = (mod: ModuleType): PlatformNavItem | undefined => {
  for (const s of PLATFORM_SECTIONS) {
    const hit = s.items.find((i) => i.id === mod);
    if (hit) return hit;
  }
  return undefined;
};

/** 扁平列表（兼容旧 NAV_MODULE_DEFS 用法） */
export const ALL_PLATFORM_NAV_ITEMS: PlatformNavItem[] = PLATFORM_SECTIONS.flatMap((s) => s.items);
