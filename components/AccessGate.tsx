import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, LogOut, ShieldOff } from 'lucide-react';
import type { User } from '../types';
import {
  evaluateEmployeeAccess,
  isEmployeeRole,
  type AccessCheckResult,
} from '../services/deviceBind';

interface AccessGateProps {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}

/**
 * 普通员工：持续校验设备绑定与可用时段；不通过则锁定全部功能。
 */
export const AccessGate: React.FC<AccessGateProps> = ({ user, onLogout, children }) => {
  const [status, setStatus] = useState<AccessCheckResult | null>(
    isEmployeeRole(user) ? null : { ok: true, reason: 'ok', message: '' }
  );

  useEffect(() => {
    if (!isEmployeeRole(user)) {
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

  if (!isEmployeeRole(user)) return <>{children}</>;

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
        <h2 className="text-xl font-black text-slate-900">账号使用受限</h2>
        <p className="text-sm font-medium text-slate-600 leading-relaxed flex items-start gap-2 text-left">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <span>{status.message}</span>
        </p>
        <p className="text-xs font-bold text-slate-400">
          普通员工需在已绑定设备、且处于管理员设定的可用时段内才能使用系统功能。
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="w-full inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-blue-600 text-white py-3 rounded-xl font-black"
        >
          <LogOut size={16} /> 退出登录
        </button>
      </div>
    </div>
  );
};
