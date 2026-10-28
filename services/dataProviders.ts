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
  | 'marketplace_intel'
  | 'yellow_pages'
  | 'qwen_tripo'
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
    description:
      '澄海玩具选品 / 展厅货源。API Key 栏可粘贴登录后浏览器里的 Bearer 访问令牌，用于着陆页「行业资讯/新品」与产品库同步（正式数据分享协议前的过渡方案）',
    docsHint: 'https://www.toysbear.com/toyConsultation',
  },
  {
    id: 'skybird',
    label: '霄鸟云',
    description:
      '澄海玩具 B2B 产品库。同样可粘贴访问令牌；着陆页会优先用已启用源的令牌拉取优选新品（公开页作兜底）',
    docsHint: 'https://www.toysaas.com/new_arrivals',
  },
  {
    id: 'customs',
    label: '海关数据',
    description: 'ImportGenius / 国内海关数据商 API 或批量库（线下进口行为）',
    docsHint: 'Enterprise API / 年费合同',
  },
  {
    id: 'marketplace_intel',
    label: '线上货架情报',
    description:
      'Amazon / TikTok / Walmart 等品类趋势、价带、热度（可接选品类 API 或批量库）。与海关对齐后支撑生产/销售建议。',
    docsHint: '类目趋势 / ASIN·店铺情报 API 或年费数据合同',
  },
  {
    id: 'yellow_pages',
    label: '黄页 / 政府名录',
    description: '海外企业名录批量入库（买家库）',
  },
  {
    id: 'qwen_tripo',
    label: '千问通道 · Tripo 3D',
    description:
      '经千问 MaaS 调用 Tripo/Tripo-H3.1（文生/图生 3D，异步）。只需填写「按量付费」API Key（sk-…），默认网关 cn-beijing.maas.qianwenaiapi.com；启用后「产品设计 · 3D」优先走此通道。',
    docsHint: 'https://www.qianwenai.com/models/Tripo/Tripo-H3.1',
  },
  {
    id: 'tripo',
    label: '图生 3D API（官方直连）',
    description:
      '产品图/文 → 真实 GLB 网格。在 Tripo 控制台创建 API Key（tsk_…），启用后可作千问通道之外的直连路径。',
    docsHint: 'https://platform.tripo3d.ai/docs',
  },
  {
    id: 'hunyuan3d',
    label: '图生 3D（备选）',
    description:
      '备选图生 3D（TokenHub）。主路径额度不足或未配置时自动走此路；试用 Key 粘贴后打开开关即可。',
    docsHint: 'https://cloud.tencent.com/document/product/1823/137181',
  },
  {
    id: 'wan_video',
    label: '视频生成 API',
    description:
      '图生/文生视频（样片→正片，默认 wan3.0-video）。可填通义视频 Key；未单独配置时回退「万相图片」或「千问」同账号 Key。',
    docsHint: 'https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide',
  },
  {
    id: 'design_agent',
    label: '设计 Agent（平面 / 包装）',
    description:
      '产品设计 · 平面图 / 包装设计专用。可填独立图像 API Key；Base 填 Origin；备注里可写模型 ID。未配则回退「图片生成」Key 池。',
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
