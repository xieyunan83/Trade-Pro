/**
 * 轻量启动门：登录页即出，主包在背后预取；点登录后直接挂 App，不再出「打开工作台」整屏。
 */
import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  startTransition,
} from 'react';
import { Login } from './components/Login';
import type { User } from './types';
import {
  armDesktopSession,
  clearSession,
  saveSession,
} from './services/sessionStore';
import { setUsageScope } from './services/limitService';
import { hydrateProductTaxonomy } from './data/productTaxonomy';

/** 单例 Promise：登录页预取与进站共用，避免重复拉包 */
let appImportPromise: Promise<typeof import('./App')> | null = null;
const loadAppModule = () => {
  if (!appImportPromise) {
    appImportPromise = import('./App').catch((e) => {
      appImportPromise = null;
      throw e;
    });
  }
  return appImportPromise;
};

const AppLazy = lazy(() => loadAppModule());

/** Suspense 极短闪白时只留登录同款底，不出白卡转圈文案 */
const QuietShell: React.FC = () => <div className="tp-login min-h-[100dvh] w-full" aria-busy="true" />;

export const LoginBoot: React.FC = () => {
  const [bootUser, setBootUser] = useState<User | null>(null);

  // 登录页一出来就抢先拉主包 + 类目，力争点登录时已在缓存里 → 秒进
  useEffect(() => {
    void loadAppModule().catch((e) => console.warn('[LoginBoot] prefetch App failed', e));
    void hydrateProductTaxonomy().catch((e) =>
      console.warn('[LoginBoot] taxonomy prefetch failed', e)
    );
  }, []);

  const handleLogin = useCallback((u: User) => {
    saveSession(u.username);
    armDesktopSession();
    setUsageScope(u.username);
    // 不再 await / 不再切「正在打开工作台」；直接挂 App（预取命中则几乎无等待）
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
  }, []);

  if (!bootUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Suspense fallback={<QuietShell />}>
      <AppErrorGate onBack={backToLogin}>
        <AppLazy bootUser={bootUser} />
      </AppErrorGate>
    </Suspense>
  );
};

/** 主包加载失败时回登录，仍不展示「打开工作台」文案 */
class AppErrorGate extends React.Component<
  { onBack: () => void; children: React.ReactNode },
  { err: boolean }
> {
  state = { err: false };

  static getDerivedStateFromError() {
    return { err: true };
  }

  componentDidCatch(err: unknown) {
    console.error('[LoginBoot] App mount failed', err);
  }

  render() {
    if (this.state.err) {
      return (
        <div className="tp-login min-h-[100dvh] flex flex-col items-center justify-center px-6">
          <div className="tp-login-card w-full max-w-md rounded-[1.35rem] px-8 py-10 bg-white text-center space-y-3">
            <p className="text-sm font-bold text-slate-700">工作台加载失败</p>
            <button
              type="button"
              className="text-xs font-semibold text-teal-700 underline"
              onClick={() => {
                this.setState({ err: false });
                this.props.onBack();
              }}
            >
              返回登录重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default LoginBoot;
