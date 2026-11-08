/**
 * 轻量启动门：先画登录页，再懒加载巨型 App 包。
 * 避免解析类目 JSON / gemini 等把登录卡在空白启动壳。
 */
import React, { Suspense, lazy, useCallback, useEffect, useState, startTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Login } from './components/Login';
import type { User } from './types';
import { loadUsersFromStorage } from './services/auth';
import {
  armDesktopSession,
  restoreSessionUser,
  saveSession,
} from './services/sessionStore';
import { setUsageScope } from './services/limitService';

const AppLazy = lazy(() => import('./App'));

const LoadingCard: React.FC<{ tip?: string }> = ({ tip = '正在进入工作台…' }) => (
  <div className="tp-login min-h-[100dvh] flex flex-col items-center justify-center px-6">
    <div className="text-center mb-8">
      <div className="inline-block px-3.5 py-1.5 rounded-full border border-teal-300/35 bg-teal-400/10 text-teal-100 text-xs font-bold tracking-[0.2em] mb-4">
        澄海 · 智造出海
      </div>
      <h1 className="text-white text-4xl sm:text-5xl font-extrabold tracking-tight">外贸智慧协同</h1>
      <p className="mt-3 text-slate-300/90 text-base font-medium">赋能澄海玩具产业升级</p>
    </div>
    <div className="tp-login-card w-full max-w-md rounded-[1.35rem] px-8 py-10 flex flex-col items-center gap-3 bg-white">
      <Loader2 className="animate-spin text-teal-600" size={28} />
      <p className="text-sm font-bold text-slate-600">{tip}</p>
    </div>
  </div>
);

export const LoginBoot: React.FC = () => {
  const [bootUser, setBootUser] = useState<User | null>(null);
  const [entering, setEntering] = useState(false);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 下一帧再读会话，先让出一帧给启动壳/浏览器绘制
    const t = window.setTimeout(() => {
      try {
        const local = loadUsersFromStorage();
        const restored = restoreSessionUser(local);
        if (!cancelled && restored) {
          setEntering(true);
          setBootUser(restored);
          setUsageScope(restored.username);
        }
      } catch (e) {
        console.warn('[LoginBoot] restore failed', e);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const handleLogin = useCallback((u: User) => {
    saveSession(u.username);
    armDesktopSession();
    setUsageScope(u.username);
    setEntering(true);
    startTransition(() => setBootUser(u));
  }, []);

  // 尚未恢复完：继续显示 HTML 启动壳即可（root 将被 Login 替换）
  if (restoring && !bootUser) {
    return <LoadingCard tip="正在准备登录…" />;
  }

  if (!bootUser) {
    return <Login onLogin={handleLogin} />;
  }

  if (entering || bootUser) {
    return (
      <Suspense fallback={<LoadingCard />}>
        <AppLazy bootUser={bootUser} />
      </Suspense>
    );
  }

  return <LoadingCard />;
};

export default LoginBoot;
