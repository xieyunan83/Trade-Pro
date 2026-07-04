import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { KnowledgeFile, HistoryItem, DiscoveryState, Client } from '../types'
import { getRuntimeConfig, isSupabaseConfigured, clearSupabaseConfigCache } from './runtimeConfig'

export { isSupabaseConfigured, clearSupabaseConfigCache }

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
    const cfg = getRuntimeConfig();
    supabaseClient = createClient(
      cfg.supabaseUrl || 'https://placeholder.supabase.co',
      cfg.supabaseAnonKey || 'placeholder'
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

export const getAllApiConfigs = async (): Promise<ApiConfig[]> => {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('api_configs')
      .select('*')
    
    if (error || !data) return []
    
    return data.map(d => ({
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
    return []
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

export const saveKnowledgeFile = async (file: KnowledgeFile): Promise<boolean> => {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase 未配置，跳过知识库云端保存')
    return false
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

    if (error) throw error
    console.log('✅ 知识库文件已保存到 Supabase:', file.name)
    return true
  } catch (error) {
    console.error('保存知识库文件失败:', error)
    return false
  }
}

export const getKnowledgeFiles = async (): Promise<KnowledgeFile[]> => {
  const rows = await getKnowledgeList()
  return rows.filter(r => r.id).map(toKnowledgeFile)
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
    const { error } = await supabase
      .from('discovery_searches')
      .insert({
        user_id: 'default',
        product: state.product,
        country: state.country,
        industry: state.industry,
        client_type: state.clientType,
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

    return {
      product: data.product || '',
      country: data.country || '',
      industry: data.industry || '',
      clientType: data.client_type || '',
      results: data.results || [],
      hasSearched: data.has_searched ?? true,
    }
  } catch (error) {
    console.error('获取搜索记录失败:', error)
    return null
  }
}

// ==================== CRM 客户（JSON 完整存储） ====================

export const saveCrmClientsBulk = async (clients: Client[]): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    if (clients.length === 0) {
      const { error } = await supabase.from('crm_clients').delete().eq('user_id', 'default')
      if (error) throw error
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

/** 全量同步 CRM：删除云端多余项并 upsert 当前列表 */
export const syncCrmClients = async (clients: Client[]): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false
  try {
    const { data: existing, error: readErr } = await supabase
      .from('crm_clients')
      .select('local_id')
      .eq('user_id', 'default')

    if (readErr) throw readErr

    const localIds = new Set(clients.map(c => c.id))
    const toDelete = (existing || [])
      .map(r => r.local_id)
      .filter(id => !localIds.has(id))

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('crm_clients')
        .delete()
        .in('local_id', toDelete)
      if (delErr) throw delErr
    }

    return await saveCrmClientsBulk(clients)
  } catch (error) {
    console.error('同步 CRM 失败:', error)
    return false
  }
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