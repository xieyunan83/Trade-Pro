import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { KnowledgeFile, HistoryItem, DiscoveryState, Client, DiscoveryArchiveItem } from '../types'
import { getSupabaseConfig, isSupabaseConfigured } from './env'

export { isSupabaseConfigured }

export interface ApiConfig {
  provider: string
  apiKey: string
  baseUrl?: string
  modelId?: string
}

export interface KnowledgeItem {
  id?: string
  title: string
  content: string
  category: string
  file_url?: string
  created_at?: string
}

export interface Customer {
  id?: string
  company_name: string
  domain?: string
  country?: string
  industry?: string
  website?: string
  contact_info?: any
  investigation_report?: any
  report_text?: string
  product_analysis?: any
  similar_companies?: any
  created_at?: string
}

// ==================== Supabase 客户端（运行时配置） ====================

let supabaseClient: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (!supabaseClient) {
    const { url, key } = getSupabaseConfig();
    supabaseClient = createClient(
      url || 'https://placeholder.supabase.co',
      key || 'placeholder'
    );
  }
  return supabaseClient;
};

export const resetSupabaseClient = (): void => {
  supabaseClient = null;
};

/** @deprecated 使用 getSupabaseClient() */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseClient() as any)[prop];
  },
});

// ==================== 工具函数 ====================

// 简单加密（Base64，生产环境建议用更强加密）
const encrypt = (text: string): string => {
  try {
    return btoa(text)
  } catch (e) {
    console.error('加密失败:', e)
    return text
  }
}

const decrypt = (encrypted: string): string => {
  try {
    return atob(encrypted)
  } catch (e) {
    console.error('解密失败:', e)
    return encrypted
  }
}

// ==================== API配置管理 ====================

export const saveApiConfig = async (config: ApiConfig): Promise<boolean> => {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase 未配置，跳过云端保存')
    return false
  }
  try {
    const { error } = await supabase
      .from('api_configs')
      .upsert({
        user_id: 'default',
        provider: config.provider,
        encrypted_key: encrypt(config.apiKey),
        base_url: config.baseUrl,
        model_id: config.modelId
      }, {
        onConflict: 'user_id,provider'
      })
    
    if (error) throw error
    
    console.log(`✅ API配置已保存: ${config.provider}`)
    return true
  } catch (error) {
    console.error('保存API配置失败:', error)
    return false
  }
}

export const getApiConfig = async (provider: string): Promise<ApiConfig | null> => {
  if (!isSupabaseConfigured()) return null
  try {
    const { data, error } = await supabase
      .from('api_configs')
      .select('*')
      .eq('provider', provider)
      .single()
    
    if (error || !data) {
      console.warn(`未找到${provider}配置`)
      return null
    }
    
    return {
      provider: data.provider,
      apiKey: decrypt(data.encrypted_key),
      baseUrl: data.base_url,
      modelId: data.model_id
    }
  } catch (error) {
    console.error('读取API配置失败:', error)
    return null
  }
}

/** 内部用：账号密码云端同步（勿当普通 API 展示） */
export const APP_USERS_PROVIDER = '__app_users__'
/** 内部用：已排除客户名单 */
export const EXCLUDED_COMPANIES_PROVIDER = '__excluded_companies__'

export const getAllApiConfigs = async (): Promise<ApiConfig[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('api_configs')
      .select('*')
    
    if (error || !data) return []
    
    return data
      .filter((d) => d.provider !== APP_USERS_PROVIDER && d.provider !== EXCLUDED_COMPANIES_PROVIDER)
      .map(d => ({
        provider: d.provider,
        apiKey: decrypt(d.encrypted_key),
        baseUrl: d.base_url,
        modelId: d.model_id
      }))
  } catch (error) {
    console.error('读取所有API配置失败:', error)
    return []
  }
}

export type CloudUsersBundle = {
  users: import('../types').User[];
  departments?: import('../types').Department[];
  updatedAt: number;
}

/** 拉取云端用户账号（手机/电脑共用同一份） */
export const fetchAppUsersFromCloud = async (): Promise<CloudUsersBundle | null> => {
  if (!isSupabaseConfigured()) return null
  try {
    const { data, error } = await supabase
      .from('api_configs')
      .select('*')
      .eq('user_id', 'default')
      .eq('provider', APP_USERS_PROVIDER)
      .maybeSingle()

    if (error || !data?.encrypted_key) return null
    const raw = decrypt(data.encrypted_key)
    const parsed = JSON.parse(raw)
    const users = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.users) ? parsed.users : null
    if (!users?.length) return null
    const departments = Array.isArray(parsed?.departments) ? parsed.departments : []
    const updatedAt = Number(data.model_id) || Number(parsed?.updatedAt) || 0
    return { users, departments, updatedAt }
  } catch (e) {
    console.warn('拉取云端用户失败', e)
    return null
  }
}

/** 保存用户账号到云端，使手机端与电脑端密码一致 */
export const saveAppUsersToCloud = async (
  users: import('../types').User[],
  updatedAt: number = Date.now(),
  departments: import('../types').Department[] = []
): Promise<boolean> => {
  if (!isSupabaseConfigured() || !users.length) return false
  try {
    const payload = JSON.stringify({ users, departments, updatedAt })
    const { error } = await supabase
      .from('api_configs')
      .upsert(
        {
          user_id: 'default',
          provider: APP_USERS_PROVIDER,
          encrypted_key: encrypt(payload),
          base_url: null,
          model_id: String(updatedAt),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      )
    if (error) throw error
    console.log('✅ 用户账号已同步到云端')
    return true
  } catch (e) {
    console.error('保存云端用户失败', e)
    return false
  }
}

// ==================== 知识库管理 ====================

export const saveKnowledge = async (item: {
  title: string
  content: string
  category: string
  file?: File
}): Promise<boolean> => {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase 未配置，跳过知识库保存')
    return false
  }
  try {
    let fileUrl = null
    
    // 上传文件（如果有）
    if (item.file) {
      const fileExt = item.file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      
      const { data: fileData, error: fileError } = await supabase.storage
        .from('knowledge-files')
        .upload(fileName, item.file)
      
      if (fileError) throw fileError
      
      // 获取公开URL
      const { data: { publicUrl } } = supabase.storage
        .from('knowledge-files')
        .getPublicUrl(fileName)
      
      fileUrl = publicUrl
    }
    
    // 保存到数据库
    const { error } = await supabase
      .from('knowledge_base')
      .insert({
        user_id: 'default',
        title: item.title,
        content: item.content,
        category: item.category,
        file_url: fileUrl
      })
    
    if (error) throw error
    
    console.log('✅ 知识库已保存')
    return true
  } catch (error) {
    console.error('保存知识库失败:', error)
    return false
  }
}

export const getKnowledgeList = async (category?: string): Promise<KnowledgeItem[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    let query = supabase
      .from('knowledge_base')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (category) {
      query = query.eq('category', category)
    }
    
    const { data, error } = await query
    
    if (error) throw error
    
    return data as KnowledgeItem[]
  } catch (error) {
    console.error('获取知识库失败:', error)
    throw error
  }
}

const KB_META_PREFIX = '__KB_META__';

const packKnowledgeContent = (file: KnowledgeFile): string => {
  const meta = JSON.stringify({ size: file.size, mimeType: file.mimeType || 'application/octet-stream' });
  return `${KB_META_PREFIX}${meta}\n${file.data}`;
};

const unpackKnowledgeContent = (raw: string): { data: string; size?: number; mimeType?: string } => {
  if (raw.startsWith(KB_META_PREFIX)) {
    const newline = raw.indexOf('\n');
    const meta = JSON.parse(raw.slice(KB_META_PREFIX.length, newline));
    return { data: raw.slice(newline + 1), size: meta.size, mimeType: meta.mimeType };
  }
  return { data: raw };
};

const toKnowledgeFile = (row: KnowledgeItem): KnowledgeFile => {
  const { data, size, mimeType } = unpackKnowledgeContent(row.content);
  return {
    id: row.id || '',
    name: row.title,
    type: row.category,
    data,
    size: size ?? data.length,
    mimeType: mimeType || (row.category === 'youtube' ? 'text/x-uri' : 'application/octet-stream'),
  };
};

export const saveKnowledgeFile = async (file: KnowledgeFile): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase 未配置' }
  }
  try {
    const { error } = await supabase
      .from('knowledge_base')
      .upsert({
        id: file.id,
        user_id: 'default',
        title: file.name,
        content: packKnowledgeContent(file),
        category: file.type,
      })

    if (error) {
      console.error('保存知识库文件失败:', error)
      return { ok: false, error: error.message }
    }
    console.log('✅ 知识库文件已保存到 Supabase:', file.name)
    return { ok: true }
  } catch (error: any) {
    console.error('保存知识库文件失败:', error)
    return { ok: false, error: error?.message || String(error) }
  }
}

export const getKnowledgeFiles = async (): Promise<{ files: KnowledgeFile[]; error?: string }> => {
  if (!isSupabaseConfigured()) return { files: [], error: 'Supabase 未配置' }
  try {
    const rows = await getKnowledgeList()
    return { files: rows.filter(r => r.id).map(toKnowledgeFile) }
  } catch (error: any) {
    return { files: [], error: error?.message || String(error) }
  }
}

/** 探测云端是否真的可达（不只是填了 URL） */
export const testSupabaseConnection = async (): Promise<{ ok: boolean; message: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: '未配置 Supabase URL / Anon Key' }
  }
  try {
    const { error } = await supabase
      .from('knowledge_base')
      .select('id', { count: 'exact', head: true })

    if (error) {
      const msg = error.message || ''
      if (/relation .*knowledge_base.* does not exist|Could not find the table/i.test(msg)) {
        return {
          ok: false,
          message: '已连上项目，但缺少 knowledge_base 表。请在 SQL Editor 执行 scripts/supabase-schema.sql',
        }
      }
      if (/Failed to fetch|NetworkError|fetch failed|ENOTFOUND|DNS/i.test(msg)) {
        return { ok: false, message: '无法访问 Supabase 域名（项目可能已暂停/删除，或网络不通）' }
      }
      return { ok: false, message: msg }
    }
    return { ok: true, message: 'Supabase 云端连接正常' }
  } catch (e: any) {
    const msg = e?.message || String(e)
    if (/Failed to fetch|NetworkError|fetch failed|ENOTFOUND/i.test(msg)) {
      return { ok: false, message: '无法访问 Supabase（DNS/网络失败，项目可能已暂停或 URL 错误）' }
    }
    return { ok: false, message: msg }
  }
}

export const deleteKnowledgeFile = async (id: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('id', id)

    if (error) throw error
    console.log('✅ 知识库文件已从 Supabase 删除:', id)
    return true
  } catch (error) {
    console.error('删除知识库文件失败:', error)
    return false
  }
}

// ==================== 客户管理 ====================

export const saveCustomer = async (customer: Customer): Promise<string | null> => {
  if (!isSupabaseConfigured()) return null
  try {
    const { data, error } = await supabase
      .from('customers')
      .insert(customer)
      .select('id')
      .single()
    
    if (error) throw error
    
    console.log('✅ 客户已保存:', data.id)
    return data.id
  } catch (error) {
    console.error('保存客户失败:', error)
    return null
  }
}

export const getCustomers = async (): Promise<Customer[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    return data as Customer[]
  } catch (error) {
    console.error('获取客户失败:', error)
    return []
  }
}

export const updateCustomer = async (id: string, updates: Partial<Customer>): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', id)
    
    if (error) throw error
    
    console.log('✅ 客户已更新:', id)
    return true
  } catch (error) {
    console.error('更新客户失败:', error)
    return false
  }
}

export const deleteCustomer = async (id: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    
    console.log('✅ 客户已删除:', id)
    return true
  } catch (error) {
    console.error('删除客户失败:', error)
    return false
  }
}

// ==================== 背调历史 ====================

export const saveInvestigationHistory = async (item: HistoryItem): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('investigation_history')
      .upsert({
        user_id: 'default',
        local_id: item.id,
        domain: item.domain,
        module_type: item.type,
        report_data: item,
      }, { onConflict: 'user_id,local_id' })

    if (error) throw error
    console.log('✅ 背调记录已保存到 Supabase:', item.domain)
    return true
  } catch (error) {
    console.error('保存背调历史失败:', error)
    return false
  }
}

export const getInvestigationHistory = async (): Promise<HistoryItem[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('investigation_history')
      .select('report_data, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []).map(row => row.report_data as HistoryItem)
  } catch (error) {
    console.error('获取背调历史失败:', error)
    return []
  }
}

export const deleteInvestigationHistory = async (localId: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('investigation_history')
      .delete()
      .eq('local_id', localId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('删除背调历史失败:', error)
    return false
  }
}

// ==================== 客户搜索记录 ====================

export const saveDiscoverySearch = async (state: DiscoveryState): Promise<boolean> => {
  if (!isSupabaseConfigured() || !state.hasSearched) return false
  try {
    const countryStr = (state.countries?.length ? state.countries.join(', ') : state.country) || ''
    const typeStr = (state.clientTypes?.length ? state.clientTypes.join(', ') : state.clientType) || ''
    const { error } = await supabase
      .from('discovery_searches')
      .insert({
        user_id: 'default',
        product: state.product,
        country: countryStr,
        industry: state.industry,
        client_type: typeStr,
        results: state.results,
        has_searched: state.hasSearched,
      })

    if (error) throw error
    console.log('✅ 搜索记录已保存到 Supabase')
    return true
  } catch (error) {
    console.error('保存搜索记录失败:', error)
    return false
  }
}

export const getLatestDiscoverySearch = async (): Promise<DiscoveryState | null> => {
  if (!isSupabaseConfigured()) return null
  try {
    const { data, error } = await supabase
      .from('discovery_searches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    const countryStr = data.country || ''
    const typeStr = data.client_type || ''
    const split = (s: string) => s.split(/[,，;/|]+/).map((x: string) => x.trim()).filter(Boolean)
    return {
      product: data.product || '',
      country: countryStr,
      countries: split(countryStr),
      industry: data.industry || '',
      clientType: typeStr,
      clientTypes: split(typeStr),
      results: data.results || [],
      hasSearched: data.has_searched ?? true,
    }
  } catch (error) {
    console.error('获取搜索记录失败:', error)
    return null
  }
}

export const deleteDiscoverySearchFromCloud = async (id: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('discovery_searches')
      .delete()
      .eq('id', id)

    if (error) throw error
    console.log('✅ 搜索记录已从 Supabase 删除:', id)
    return true
  } catch (error) {
    console.error('删除搜索记录失败:', error)
    return false
  }
}

/** 按关键词+国家删除（兼容无 UUID 的本地归档同步清云端） */
export const deleteDiscoverySearchesByMeta = async (product: string, country: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    let q = supabase.from('discovery_searches').delete().eq('product', product)
    if (country) q = q.eq('country', country)
    const { error } = await q
    if (error) throw error
    return true
  } catch (error) {
    console.error('按条件删除搜索记录失败:', error)
    return false
  }
}

/** 拉取多条搜索归档（用于记录面板归类） */
export const getDiscoverySearchArchives = async (): Promise<DiscoveryArchiveItem[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('discovery_searches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    const split = (s: string) => s.split(/[,，;/|]+/).map((x: string) => x.trim()).filter(Boolean)
    return (data || []).map((row: any) => {
      const countryStr = row.country || ''
      const typeStr = row.client_type || ''
      return {
        id: String(row.id),
        timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        product: row.product || '',
        countries: split(countryStr),
        country: countryStr,
        industry: row.industry || '',
        clientTypes: split(typeStr),
        clientType: typeStr,
        results: row.results || [],
      } as DiscoveryArchiveItem
    })
  } catch (error) {
    console.error('获取搜索归档失败:', error)
    return []
  }
}

// ==================== CRM 客户（JSON 完整存储） ====================

export const saveCrmClientsBulk = async (clients: Client[]): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    // 禁止用空列表清空云端：隔离过滤后的空视图不等于「用户删光了全部 CRM」
    if (clients.length === 0) {
      console.warn('跳过 CRM 空列表云端写入，避免误删')
      return true
    }

    const rows = clients.map(c => ({
      user_id: 'default',
      local_id: c.id,
      client_data: c,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('crm_clients')
      .upsert(rows, { onConflict: 'user_id,local_id' })

    if (error) throw error
    console.log(`✅ CRM 已同步到 Supabase (${clients.length} 条)`)
    return true
  } catch (error) {
    console.error('保存 CRM 失败:', error)
    return false
  }
}

/**
 * 安全同步 CRM：只 upsert 当前列表，不根据「缺失」删除云端其它记录。
 * 删除请走 deleteCrmClient；避免部门隔离后的局部视图把全库清空。
 */
export const syncCrmClients = async (clients: Client[]): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  if (clients.length === 0) return true
  return await saveCrmClientsBulk(clients)
}

export const getCrmClients = async (): Promise<Client[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('crm_clients')
      .select('client_data, updated_at')
      .order('updated_at', { ascending: false })

    if (error) throw error
    return (data || []).map(row => row.client_data as Client)
  } catch (error) {
    console.error('获取 CRM 失败:', error)
    return []
  }
}

export const deleteCrmClient = async (localId: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { error } = await supabase
      .from('crm_clients')
      .delete()
      .eq('local_id', localId)

    if (error) throw error
    return true
  } catch (error) {
    console.error('删除 CRM 客户失败:', error)
    return false
  }
}

// ==================== 导出 ====================
export default supabase