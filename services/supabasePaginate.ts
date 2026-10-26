/**
 * Supabase 默认单次最多返回 1000 行；分页拉全表，避免作业/CRM 被截断。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message?: string } | null };

/**
 * 按 range 分页拉取，直到不足一页。
 * @param fetchPage (from, to) => supabase query 结果（含 data/error）
 */
export async function fetchAllSupabasePages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      return { rows, error: error.message || String(error) };
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
    // 安全上限：防止死循环
    if (from > 500_000) break;
  }
  return { rows, error: null };
}

/** 便捷：对某表 select + order + 全部分页 */
export async function selectAllRows<T = Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  columns: string,
  opts?: { orderCol?: string; ascending?: boolean; eq?: Record<string, string> }
): Promise<{ rows: T[]; error: string | null }> {
  return fetchAllSupabasePages<T>(async (from, to) => {
    let q = client.from(table).select(columns);
    if (opts?.eq) {
      for (const [k, v] of Object.entries(opts.eq)) {
        q = q.eq(k, v);
      }
    }
    if (opts?.orderCol) {
      q = q.order(opts.orderCol, { ascending: opts.ascending ?? false });
    }
    return q.range(from, to) as PromiseLike<PageResult<T>>;
  });
}
