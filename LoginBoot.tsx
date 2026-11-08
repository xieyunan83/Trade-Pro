/**
 * 轻量启动门：先画登录页，主包就绪即进站。
 * 类目 2MB 与进站并行，不阻塞挂载 App（否则「进入工作台」又卡死）。
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
import { hydrateProductTaxonomy } from './data/productTaxonomy';

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
      <p className="text-sm font-bold text-slate-600 text-center">{tip}</p>
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

type Phase = 'boot' | 'login' | 'warming' | 'ready' | 'failed';

export const LoginBoot: React.FC = () => {
  const [bootUser, setBootUser] = useState<User | null>(null);
  const [phase, setPhase] = useState<Phase>('boot');
  const [warmTip, setWarmTip] = useState('正在进入工作台…');
  const [enterStuck, setEnterStuck] = useState(false);
  const prefetchStarted = useRef(false);
  const warmGen = useRef(0);

  useEffect(() => {
    if (phase !== 'login') return;
    if (prefetchStarted.current) return;
    prefetchStarted.current = true;
    const kick = () => {
      void loadAppModule().catch((e) => console.warn('[LoginBoot] prefetch App failed', e));
      // 类目预热不挡登录/进站
      void hydrateProductTaxonomy().catch((e) =>
        console.warn('[LoginBoot] taxonomy prefetch failed', e)
      );
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(kick, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(kick, 400);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      try {
        restoreSessionUser(loadUsersFromStorage());
      } catch (e) {
        console.warn('[LoginBoot] restore failed', e);
      } finally {
        if (!cancelled) setPhase('login');
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const warmAndEnter = useCallback(async (u: User) => {
    const gen = ++warmGen.current;
    setBootUser(u);
    setPhase('warming');
    setEnterStuck(false);
    setWarmTip('正在打开工作台…');
    try {
      // 只等主包；类目并行，不阻塞挂载（挂载后侧栏才能点）
      void hydrateProductTaxonomy().catch(() => undefined);
      await loadAppModule();
      if (warmGen.current !== gen) return;
      startTransition(() => setPhase('ready'));
    } catch (e) {
      console.error('[LoginBoot] warm failed', e);
      if (warmGen.current !== gen) return;
      setPhase('failed');
      setWarmTip('工作台加载失败，请返回登录后重试');
    }
  }, []);

  useEffect(() => {
    if (phase !== 'warming' && phase !== 'ready') {
      setEnterStuck(false);
      return;
    }
    const t = window.setTimeout(() => setEnterStuck(true), 35_000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const handleLogin = useCallback(
    (u: User) => {
      saveSession(u.username);
      armDesktopSession();
      setUsageScope(u.username);
      void warmAndEnter(u);
    },
    [warmAndEnter]
  );

  const backToLogin = useCallback(() => {
    warmGen.current += 1;
    try {
      clearSession();
    } catch {
      /* ignore */
    }
    setUsageScope(null);
    setBootUser(null);
    setEnterStuck(false);
    setPhase('login');
    prefetchStarted.current = false;
  }, []);

  if (phase === 'boot') {
    return <LoadingCard tip="正在准备登录…" />;
  }

  if (phase === 'login' || !bootUser) {
    return <Login onLogin={handleLogin} />;
  }

  if (phase === 'warming' || phase === 'failed') {
    return (
      <LoadingCard
        tip={warmTip}
        onCancel={enterStuck || phase === 'failed' ? backToLogin : undefined}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <LoadingCard
          tip={enterStuck ? '加载较慢，可返回登录后重试' : '正在打开工作台…'}
          onCancel={enterStuck ? backToLogin : undefined}
        />
      }
    >
      <AppLazy bootUser={bootUser} />
    </Suspense>
  );
};

export default LoginBoot;
