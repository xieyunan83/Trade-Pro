import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, LogOut, ShieldOff } from 'lucide-react';
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

  useEffect(() => {
    if (!needsAccessControl(user)) {
      setStatus({ ok: true, reason: 'ok', message: '' });
      return;
    }
    let cancelled = false;
    const run = async () => {
      const res = await evaluateEmployeeAccess(user);
      if (!cancelled) setStatus(res);
    };
    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  if (!needsAccessControl(user)) return <>{children}</>;

  if (!status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={36} />
      </div>
    );
  }

  if (status.ok) return <>{children}</>;

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
