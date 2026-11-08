/**
 * 轻量启动门：先画登录页，再懒加载巨型 App 包。
 * 避免解析类目 JSON / 主包同步依赖把登录卡在空白或「进入工作台」转圈。
 */
import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  startTransition,
} from 'react';
import { Loader2 } from 'lucide-react';
import { Login } from './components/Login';
import type { User } from './types';
import { loadUsersFromStorage } from './services/auth';
import {
  armDesktopSession,
  clearSession,
  restoreSessionUser,
  saveSession,
} from './services/sessionStore';
import { setUsageScope } from './services/limitService';

/** 预取主包；解析极重，务必在登录页可见后再触发 */
const loadAppModule = () => import('./App');

const AppLazy = lazy(loadAppModule);

const BrandHead: React.FC = () => (
  <div className="text-center mb-8">
    <div className="inline-block px-3.5 py-1.5 rounded-full border border-teal-300/35 bg-teal-400/10 text-teal-100 text-xs font-bold tracking-[0.2em] mb-4">
      澄海 · 智造出海
    </div>
    <h1 className="text-white text-4xl sm:text-5xl font-extrabold tracking-tight">外贸智慧协同</h1>
    <p className="mt-3 text-slate-300/90 text-base font-medium">赋能澄海玩具产业升级</p>
  </div>
);

const LoadingCard: React.FC<{ tip?: string; onCancel?: () => void }> = ({
  tip = '正在进入工作台…',
  onCancel,
}) => (
  <div className="tp-login min-h-[100dvh] flex flex-col items-center justify-center px-6">
    <BrandHead />
    <div className="tp-login-card w-full max-w-md rounded-[1.35rem] px-8 py-10 flex flex-col items-center gap-3 bg-white">
      <Loader2 className="animate-spin text-teal-600" size={28} />
      <p className="text-sm font-bold text-slate-600">{tip}</p>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 text-xs font-semibold text-slate-500 hover:text-teal-700 underline underline-offset-2"
        >
          返回登录
        </button>
      ) : null}
    </div>
  </div>
);

export const LoginBoot: React.FC = () => {
  const [bootUser, setBootUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [enterStuck, setEnterStuck] = useState(false);
  const prefetchStarted = useRef(false);

  /** 登录页已出后空闲预取主包，避免点登录才开始下大包 */
  useEffect(() => {
    if (bootUser || restoring) return;
    if (prefetchStarted.current) return;
    prefetchStarted.current = true;
    const kick = () => {
      void loadAppModule().catch((e) => console.warn('[LoginBoot] prefetch App failed', e));
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(kick, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(kick, 400);
    return () => window.clearTimeout(t);
  }, [bootUser, restoring]);

  useEffect(() => {
    let cancelled = false;
    // 下一帧再读会话，先让出一帧给启动壳/登录绘制
    const t = window.setTimeout(() => {
      try {
        const local = loadUsersFromStorage();
        const restored = restoreSessionUser(local);
        // 有会话也不立刻挂载 App：先出登录页，避免「进入工作台」卡死无出口
        if (!cancelled && restored) {
          // 仅预填用途：不自动进入；会话仍保留，用户点登录或「继续」再进
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

  /** 进入工作台超过 25s 仍未就绪 → 允许回登录 */
  useEffect(() => {
    if (!bootUser) {
      setEnterStuck(false);
      return;
    }
    setEnterStuck(false);
    const t = window.setTimeout(() => setEnterStuck(true), 25_000);
    return () => window.clearTimeout(t);
  }, [bootUser]);

  const handleLogin = useCallback((u: User) => {
    saveSession(u.username);
    armDesktopSession();
    setUsageScope(u.username);
    startTransition(() => setBootUser(u));
  }, []);

  const backToLogin = useCallback(() => {
    try {
      clearSession();
    } catch {
      /* ignore */
    }
    setUsageScope(null);
    setBootUser(null);
    setEnterStuck(false);
    prefetchStarted.current = false;
  }, []);

  if (restoring && !bootUser) {
    return <LoadingCard tip="正在准备登录…" />;
  }

  if (!bootUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Suspense
      fallback={
        <LoadingCard
          tip={enterStuck ? '加载较慢，可返回登录后重试' : '正在进入工作台…'}
          onCancel={enterStuck ? backToLogin : undefined}
        />
      }
    >
      <AppLazy bootUser={bootUser} />
    </Suspense>
  );
};

export default LoginBoot;
