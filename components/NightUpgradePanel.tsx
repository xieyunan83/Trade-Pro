import React, { useEffect, useState } from 'react';
import { Moon, Loader2 } from 'lucide-react';
import {
  getNightUpgradeStatus,
  setNightSilentUpgradeEnabled,
  subscribeNightUpgrade,
  type NightUpgradeStatus,
} from '../services/nightSilentUpgrade';

/** 左下角弱提示：仅夜间有任务时显示，不打断操作 */
export const NightUpgradePanel: React.FC = () => {
  const [status, setStatus] = useState<NightUpgradeStatus>(() => getNightUpgradeStatus());

  useEffect(() => subscribeNightUpgrade(setStatus), []);

  if (!status.enabled) return null;
  const busy =
    status.inWindow && (status.queued > 0 || status.running > 0 || status.completedTonight > 0);
  if (!busy && !status.inWindow) return null;
  if (!status.inWindow && status.completedTonight === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-900/95 text-slate-100 shadow-xl overflow-hidden">
      <div className="px-3 py-2 flex items-start gap-2">
        <Moon size={14} className="text-indigo-300 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black truncate">
            {status.inWindow ? '夜间静默升级中' : '昨夜静默升级'}
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5 leading-snug">
            {status.inWindow
              ? `队列 ${status.queued} · 完成 ${status.completedTonight}${
                  status.failedTonight ? ` · 失败 ${status.failedTonight}` : ''
                }`
              : `完成 ${status.completedTonight} 家旧客户补齐`}
            {status.current ? ` · ${status.current.clientName}` : ''}
          </div>
          {status.running > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-200 font-bold">
              <Loader2 size={10} className="animate-spin" /> 后台补全中，可继续操作
            </div>
          )}
        </div>
        {status.inWindow && (
          <button
            type="button"
            className="text-[9px] font-bold text-slate-400 hover:text-white shrink-0"
            onClick={() => setNightSilentUpgradeEnabled(false)}
            title="今晚暂停（下次登录可在设置中重新开启）"
          >
            暂停
          </button>
        )}
      </div>
    </div>
  );
};
