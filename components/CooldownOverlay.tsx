import React, { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';
import { subscribeCooldown } from '../services/rateLimitGate';

/**
 * 冷却倒计时独立订阅：禁止在 App 根上 setState，
 * 否则每秒整树重渲染（含几千客户/作业）会把侧栏卡死。
 */
export const CooldownOverlay: React.FC = () => {
  const [cooldownTime, setCooldownTime] = useState(0);
  useEffect(() => subscribeCooldown((sec) => setCooldownTime(sec)), []);
  if (cooldownTime <= 0) return null;
  return (
    <div className="absolute inset-0 bg-mist-50/85 z-50 flex flex-col items-center justify-center backdrop-blur-md animate-fade-in cursor-wait">
      <div className="relative">
        <Hourglass size={64} className="text-signal-500 animate-pulse" />
        <div className="absolute -top-2 -right-2 bg-rose-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs">
          {cooldownTime}
        </div>
      </div>
      <h3 className="text-2xl font-extrabold text-ink-900 mt-6 tracking-tight">API 冷却中</h3>
      <p className="text-slate-500 mt-2 font-medium max-w-md text-center">
        服务额度恢复中，倒计时结束后会自动继续当前任务（无需反复点击）。可点左侧 STOP 暂停。
      </p>
    </div>
  );
};
