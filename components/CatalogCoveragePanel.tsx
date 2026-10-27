import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Database, AlertCircle, Sparkles } from 'lucide-react';
import type { Client, HistoryItem } from '../types';
import {
  backfillProductCatalogFromHistory,
  buildCatalogCoverageReport,
  listBlankCrmClientsForDesignFill,
  loadProductCatalog,
  type CatalogCoverageReport,
  type CatalogGapKind,
} from '../services/productCatalog';
import { clientPatchFromAnalysis, normalizeCrmHost } from '../utils/crmHistory';
import { isDesignSignalQueueBusy } from '../services/designSignalQueue';

type Props = {
  history: HistoryItem[];
  crmClients: Client[];
  onCrmPatched?: (clients: Client[]) => void;
  /** 阶段 C：对 CRM 空白客户启动轻量设计信号补全 */
  onStartDesignFill?: (blankClients: Client[]) => void;
  ownerUsername?: string;
  departmentId?: string;
};

const GAP_LABEL: Record<CatalogGapKind, string> = {
  tags: '标签',
  packaging: '包装',
  colors: '配色',
  price: '零售价',
  buyCost: '采购成本',
  cycle: '采购周期',
  volume: '销量线索',
};

/**
 * A：从历史重建画像 + 空白覆盖看板（零 Token）
 */
export const CatalogCoveragePanel: React.FC<Props> = ({
  history,
  crmClients,
  onCrmPatched,
  onStartDesignFill,
  ownerUsername,
  departmentId,
}) => {
  const [report, setReport] = useState<CatalogCoverageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [blankCount, setBlankCount] = useState(0);

  const refresh = useCallback(async () => {
    const profiles = await loadProductCatalog();
    setReport(buildCatalogCoverageReport(history, profiles, crmClients));
    setBlankCount(listBlankCrmClientsForDesignFill(crmClients, profiles).length);
  }, [history, crmClients]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const runBackfill = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { upserted, enriched, skipped } = await backfillProductCatalogFromHistory(history, {
        ownerUsername,
        departmentId,
      });

      // CRM 标签：用历史报告补空白（只合并 tags / productType / priceRange）
      let crmUpdated = 0;
      if (onCrmPatched) {
        const next = crmClients.map((c) => {
          const host = normalizeCrmHost(c.website);
          const nameKey = (c.name || '').trim().toLowerCase();
          const hist = history.find((h) => {
            if (!h?.data) return false;
            const hHost = normalizeCrmHost(h.data.companyInfo?.website || h.domain);
            if (host && hHost && host === hHost) return true;
            const hName = (h.data.companyInfo?.name || '').trim().toLowerCase();
            return !!(nameKey && hName && nameKey === hName);
          });
          if (!hist?.data) return c;
          const patch = clientPatchFromAnalysis(hist.data, hist.domain, hist.timestamp);
          const prevTags = c.tags || [];
          const mergedTags = [...new Set([...prevTags, ...(patch.tags || [])])].slice(0, 48);
          const tagsGrew = mergedTags.length > prevTags.length;
          const typeBlank = !c.productType || c.productType === 'N/A';
          if (!tagsGrew && !typeBlank) return c;
          crmUpdated += 1;
          return {
            ...c,
            tags: mergedTags,
            productType: typeBlank && patch.productType ? patch.productType : c.productType,
            priceRange:
              (!c.priceRange || c.priceRange === 'Medium' || c.priceRange === 'N/A') &&
              patch.priceRange
                ? patch.priceRange
                : c.priceRange,
          };
        });
        if (crmUpdated > 0) onCrmPatched(next);
      }

      await refresh();
      setMsg(
        `已同步：新建画像 ${upserted} · 补全信号 ${enriched} · 跳过 ${skipped}` +
          (crmUpdated ? ` · CRM 标签更新 ${crmUpdated}` : '')
      );
    } catch (e: any) {
      setMsg(e?.message || '同步失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const r = report;
  const gapCount = r?.gaps.length ?? 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-teal-600" />
          <div>
            <div className="text-sm font-black text-slate-800">客户画像覆盖</div>
            <div className="text-[10px] font-bold text-slate-400">
              从已有背调同步标签与包装/配色/价带（不消耗额度）
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !history.length}
            onClick={() => void runBackfill()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-[11px] font-black px-3 py-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            从历史同步补全
          </button>
          {onStartDesignFill && (
            <button
              type="button"
              disabled={busy || blankCount === 0 || isDesignSignalQueueBusy()}
              onClick={async () => {
                const profiles = await loadProductCatalog();
                const blanks = listBlankCrmClientsForDesignFill(crmClients, profiles);
                onStartDesignFill(blanks);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 disabled:opacity-50 text-white text-[11px] font-black px-3 py-2"
              title="仅 CRM 空白客户；通宵请保持本页打开、电脑勿睡眠。客户库页也有同名入口。"
            >
              <Sparkles size={14} />
              补全 CRM 空白 ({blankCount})
            </button>
          )}
        </div>
      </div>

      {onStartDesignFill && (
        <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
          「补全 CRM 空白」会联网轻量采集包装/配色/价带等（消耗额度）。客户库顶部也有同名入口。通宵请保持页面打开、关闭睡眠；刷新后队列会继续。
          {blankCount === 0
            ? ' 当前判定无空白客户（须有官网，且缺产品/设计标签）；可先点「从历史同步补全」。'
            : ''}
        </p>
      )}

      {msg && (
        <div className="text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
          {msg}
        </div>
      )}

      {r && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: '背调报告', value: r.historyWithReport },
              { label: '产品画像', value: r.profilesTotal },
              { label: '设计信号就绪', value: r.designReady },
              { label: 'CRM 标签空白', value: r.crmBlankProductTags },
            ].map((cell) => (
              <div
                key={cell.label}
                className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2"
              >
                <div className="text-[10px] font-bold text-slate-400">{cell.label}</div>
                <div className="text-lg font-black text-slate-800">{cell.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 text-[10px] font-bold text-slate-600">
            <span className="px-2 py-1 rounded-lg bg-slate-100">标签 {r.withTags}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">包装 {r.withPackaging}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">配色 {r.withColors}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">零售价 {r.withPrice}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">采购成本 {r.withBuyCost}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">周期 {r.withCycle}</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">销量线索 {r.withVolume}</span>
          </div>

          {gapCount > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-700">
                <AlertCircle size={14} />
                待补全 {gapCount} 家（报告里缺字段的需后续轻量补采，本步只同步已有数据）
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {r.gaps.slice(0, 20).map((g) => (
                  <div
                    key={`${g.id}-${g.historyId || ''}`}
                    className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-800 truncate">
                        {g.companyName}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{g.website || '—'}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[50%]">
                      {g.missing.map((m) => (
                        <span
                          key={m}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                        >
                          {GAP_LABEL[m]}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
              当前可同步的历史数据已覆盖设计匹配信号；若仍有空白客户，属报告本身缺字段。
            </div>
          )}
        </>
      )}
    </div>
  );
};
