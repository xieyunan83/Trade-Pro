/**
 * 外部数据 / 模型提供商配置（后台可填，功能实现前仅持久化）。
 * 云端：saveApiConfig({ provider, apiKey: JSON.stringify(meta) })
 * 本地：localStorage trade_scout_data_provider_<id>
 */
import { getApiConfig, isSupabaseConfigured, saveApiConfig } from './supabase';

export type DataProviderId =
  | 'toysbear'
  | 'skybird'
  | 'customs'
  | 'yellow_pages'
  | 'tripo'
  | 'hunyuan3d'
  | 'wan_video'
  | 'design_agent';

export type DataProviderMeta = {
  enabled: boolean;
  apiKey?: string;
  apiBase?: string;
  /** 备注：合同号、账号、国家覆盖等 */
  note?: string;
  /** 扩展字段（同步频率、国家等） */
  extra?: Record<string, string>;
  updatedAt?: number;
};

export type DataProviderDef = {
  id: DataProviderId;
  label: string;
  description: string;
  docsHint?: string;
};

export const DATA_PROVIDER_DEFS: DataProviderDef[] = [
  {
    id: 'toysbear',
    label: '小竹熊',
    description: '澄海玩具选品 / 展厅货源；产品库同步与报价协同',
    docsHint: 'https://www.toysbear.com/',
  },
  {
    id: 'skybird',
    label: '霄鸟云',
    description: '澄海玩具 B2B 产品库；线上展厅与一键报价数据源',
    docsHint: 'https://www.toysaas.com/',
  },
  {
    id: 'customs',
    label: '海关数据',
    description: 'ImportGenius / 国内海关数据商 API 或批量库',
    docsHint: 'Enterprise API / 年费合同',
  },
  {
    id: 'yellow_pages',
    label: '黄页 / 政府名录',
    description: '海外企业名录批量入库（买家库）',
  },
  {
    id: 'tripo',
    label: '图生 3D API',
    description: '产品图/文 → 3D 网格（GLB 等），按供应商 credits 计费',
  },
  {
    id: 'hunyuan3d',
    label: '混元 3D',
    description: '腾讯混元图生 3D（备选 / 可本地）',
  },
  {
    id: 'wan_video',
    label: '万相视频',
    description: '图生视频 i2v / flash（样片→正片）',
  },
  {
    id: 'design_agent',
    label: '设计 Agent（平面）',
    description:
      '产品设计 · 平面图专用。可填独立万相/兼容图像 API Key；Base 填 Origin；备注里可写模型 ID。未配则回退「万相图片生成」Key 池。',
    docsHint: 'https://www.lovart.ai/',
  },
];

const lsKey = (id: DataProviderId) => `trade_scout_data_provider_${id}`;

const emptyMeta = (): DataProviderMeta => ({
  enabled: false,
  apiKey: '',
  apiBase: '',
  note: '',
  extra: {},
});

export const loadDataProviderLocal = (id: DataProviderId): DataProviderMeta => {
  try {
    const raw = localStorage.getItem(lsKey(id));
    if (!raw) return emptyMeta();
    const parsed = JSON.parse(raw) as DataProviderMeta;
    return { ...emptyMeta(), ...parsed };
  } catch {
    return emptyMeta();
  }
};

export const saveDataProviderLocal = (id: DataProviderId, meta: DataProviderMeta) => {
  const next: DataProviderMeta = { ...meta, updatedAt: Date.now() };
  localStorage.setItem(lsKey(id), JSON.stringify(next));
  return next;
};

export const loadDataProvider = async (id: DataProviderId): Promise<DataProviderMeta> => {
  const local = loadDataProviderLocal(id);
  if (!isSupabaseConfigured()) return local;
  try {
    const cloud = await getApiConfig(id);
    if (!cloud?.apiKey) return local;
    try {
      const parsed = JSON.parse(cloud.apiKey) as DataProviderMeta;
      const merged = { ...emptyMeta(), ...parsed, apiBase: cloud.baseUrl || parsed.apiBase };
      saveDataProviderLocal(id, merged);
      return merged;
    } catch {
      return {
        ...local,
        apiKey: cloud.apiKey,
        apiBase: cloud.baseUrl || local.apiBase,
        enabled: true,
      };
    }
  } catch {
    return local;
  }
};

export const saveDataProvider = async (
  id: DataProviderId,
  meta: DataProviderMeta
): Promise<boolean> => {
  const next = saveDataProviderLocal(id, meta);
  if (!isSupabaseConfigured()) return true;
  try {
    return await saveApiConfig({
      provider: id,
      apiKey: JSON.stringify(next),
      baseUrl: next.apiBase || '',
      modelId: '',
    });
  } catch {
    return false;
  }
};

export const loadAllDataProviders = async (): Promise<Record<DataProviderId, DataProviderMeta>> => {
  const out = {} as Record<DataProviderId, DataProviderMeta>;
  await Promise.all(
    DATA_PROVIDER_DEFS.map(async (d) => {
      out[d.id] = await loadDataProvider(d.id);
    })
  );
  return out;
};
