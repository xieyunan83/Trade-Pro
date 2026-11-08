import React, { useEffect, useState } from 'react';
import { AlertTriangle, LogOut, ShieldOff } from 'lucide-react';
import type { User } from '../types';
import {
  evaluateEmployeeAccess,
  needsAccessControl,
  type AccessCheckResult,
} from '../services/deviceBind';

interface AccessGateProps {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}

/**
 * 对开启了设备绑定或可用时段的账号持续门禁校验。
 */
export const AccessGate: React.FC<AccessGateProps> = ({ user, onLogout, children }) => {
  const [status, setStatus] = useState<AccessCheckResult | null>(
    needsAccessControl(user) ? null : { ok: true, reason: 'ok', message: '' }
  );
  /** 曾通过校验后，短暂失败不立刻整页封死（设备指纹异步抖动） */
  const lastOkRef = React.useRef(false);
  const failStreakRef = React.useRef(0);

  useEffect(() => {
    if (!needsAccessControl(user)) {
      lastOkRef.current = true;
      failStreakRef.current = 0;
      setStatus({ ok: true, reason: 'ok', message: '' });
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await evaluateEmployeeAccess(user);
        if (cancelled) return;
        if (res.ok) {
          lastOkRef.current = true;
          failStreakRef.current = 0;
          setStatus(res);
          return;
        }
        failStreakRef.current += 1;
        // 首次失败且此前已通过：再等下一轮确认，避免误踢回门禁/登录
        if (lastOkRef.current && failStreakRef.current < 2) {
          return;
        }
        setStatus(res);
      } catch (e) {
        console.warn('[AccessGate] evaluate failed', e);
        // 异常不当成永久封禁：已通过则保持工作台
        if (!lastOkRef.current && !cancelled) {
          setStatus({
            ok: false,
            reason: 'device_mismatch',
            message: '访问校验暂时失败，请稍后重试或退出后重新登录。',
          });
        }
      }
    };
    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    user.username,
    user.deviceBindRequired,
    user.accessSchedule?.enabled,
    user.accessSchedule?.timezone,
    (user.boundDevices || []).map((d) => `${d.deviceId}:${d.macAddress || ''}`).join('|'),
  ]);

  if (!needsAccessControl(user)) return <>{children}</>;

  // 校验中也先出工作台（含侧栏），禁止整页转圈导致「菜单点不动」
  if (!status || status.ok) return <>{children}</>;

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <div className="bg-white max-w-lg w-full rounded-3xl border border-red-100 shadow-xl p-8 space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
          <ShieldOff size={28} />
        </div>
        <h2 className="text-xl font-black text-slate-800">访问受限</h2>
        <p className="text-sm font-bold text-slate-500 leading-relaxed flex items-start gap-2 justify-center">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center justify-center gap-2 w-full bg-slate-900 hover:bg-blue-600 text-white font-black py-3 rounded-xl"
        >
          <LogOut size={16} /> 退出登录
        </button>
      </div>
    </div>
  );
};
