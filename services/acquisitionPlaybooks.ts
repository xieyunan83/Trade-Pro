/**
 * 澄海玩具出口 · 自动化获客剧本（一键填入流水线配置）
 * 前台中性文案，不暴露数据源与供应商名。
 */
import type { AutomationPipelineConfig } from '../types';

export type AcquisitionPlaybook = {
  id: string;
  title: string;
  blurb: string;
  /** 面向市场标签 */
  marketTag: string;
  config: Omit<AutomationPipelineConfig, never>;
};

export const ACQUISITION_PLAYBOOKS: AcquisitionPlaybook[] = [
  {
    id: 'eu-wholesale-toys',
    title: '欧盟玩具批发',
    blurb: '德国 / 荷兰 / 波兰进口商与分销商，适合磁力片、遥控、泡泡等益智与户外款。',
    marketTag: '欧盟批发',
    config: {
      keyword: 'magnetic tiles educational toys',
      industry: 'toys wholesale',
      clientTypes: ['Importer', 'Distributor', 'Wholesaler'],
      countries: ['Germany', 'Netherlands', 'Poland'],
      perCountryLimit: 6,
      productContext: '澄海源头：磁力积木 / 益智拼搭 / 户外泡泡，支持 CE、混装箱、OEM。',
      doBackgroundCheck: true,
      doDmMine: true,
      doCrmImport: true,
    },
  },
  {
    id: 'us-party-ecommerce',
    title: '北美派对 / 电商',
    blurb: '美国派对礼品与电商零售买家，适合泡泡枪、水枪、小玩具、季节性主题。',
    marketTag: '北美电商',
    config: {
      keyword: 'party favor bubble toys',
      industry: 'party supplies toys',
      clientTypes: ['Retailer', 'E-commerce', 'Importer'],
      countries: ['United States', 'Canada'],
      perCountryLimit: 8,
      productContext: '派对礼品装、泡泡系列、季节主题玩具；支持小批量试单与彩盒定制。',
      doBackgroundCheck: true,
      doDmMine: true,
      doCrmImport: true,
    },
  },
  {
    id: 'me-gulf-importer',
    title: '中东海湾进口',
    blurb: '阿联酋 / 沙特玩具进口商，适合遥控车、合金车、大型户外与礼品组合。',
    marketTag: '中东进口',
    config: {
      keyword: 'remote control car toys importer',
      industry: 'toys import',
      clientTypes: ['Importer', 'Distributor', 'Wholesaler'],
      countries: ['United Arab Emirates', 'Saudi Arabia'],
      perCountryLimit: 6,
      productContext: '遥控车 / 合金车 / 户外电动；支持混柜与海湾认证咨询指引。',
      doBackgroundCheck: true,
      doDmMine: true,
      doCrmImport: true,
    },
  },
  {
    id: 'latam-retail-chain',
    title: '拉美连锁零售',
    blurb: '墨西哥 / 巴西 / 智利玩具与母婴渠道，适合益智、过家家、低价引流款。',
    marketTag: '拉美零售',
    config: {
      keyword: 'juguetes educativos mayoreo',
      industry: 'juguetes',
      clientTypes: ['Retailer', 'Importer', 'Distributor'],
      countries: ['Mexico', 'Brazil', 'Chile'],
      perCountryLimit: 5,
      productContext: '益智早教、过家家、低价引流 SKU；可提供西班牙语包装建议。',
      doBackgroundCheck: true,
      doDmMine: false,
      doCrmImport: true,
    },
  },
  {
    id: 'uk-specialty-toys',
    title: '英国精品玩具店',
    blurb: '英国独立玩具店与精品买手，适合设计感强、安全合规清晰的益智与创意款。',
    marketTag: '英国精品',
    config: {
      keyword: 'independent toy shop educational',
      industry: 'specialty toys',
      clientTypes: ['Retailer', 'Distributor'],
      countries: ['United Kingdom', 'Ireland'],
      perCountryLimit: 6,
      productContext: '精品益智、创意拼搭；强调安全标准与可持续包装选项。',
      doBackgroundCheck: true,
      doDmMine: true,
      doCrmImport: true,
    },
  },
];

export const applyPlaybook = (
  pb: AcquisitionPlaybook,
  overrides?: Partial<AutomationPipelineConfig>
): AutomationPipelineConfig => ({
  ...pb.config,
  ...overrides,
});
