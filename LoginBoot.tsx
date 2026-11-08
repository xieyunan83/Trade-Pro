/**
 * 轻量启动门：登录页即出，主包背后预取；点登录直接进 App。
 * 同一次打开内的刷新/chunk 重载：有会话则静默回到工作台（不再整屏「打开工作台」）。
 * 桌面端冷启动（未 arm）：必须重新登录。
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
import { Login } from './components/Login';
import type { User } from './types';
import { loadUsersFromStorage } from './services/auth';
import {
  armDesktopSession,
  clearSession,
  isDesktopSessionArmed,
  restoreSessionUser,
  saveSession,
} from './services/sessionStore';
import { setUsageScope } from './services/limitService';
import { hydrateProductTaxonomy } from './data/productTaxonomy';

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

const QuietShell: React.FC = () => <div className="tp-login min-h-[100dvh] w-full" aria-busy="true" />;

const isDesktopUa = () =>
  typeof navigator !== 'undefined' &&
  /TradeCollabClient|BabyWorldClient/i.test(navigator.userAgent);

export const LoginBoot: React.FC = () => {
  const [bootUser, setBootUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const intentionalLogout = useRef(false);

  useEffect(() => {
    void loadAppModule().catch((e) => console.warn('[LoginBoot] prefetch App failed', e));
    void hydrateProductTaxonomy().catch((e) =>
      console.warn('[LoginBoot] taxonomy prefetch failed', e)
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      try {
        // 桌面冷启动：未 arm 则只出登录，且不清掉已存会话（避免误伤同会话内刷新）
        if (isDesktopUa() && !isDesktopSessionArmed()) {
          if (!cancelled) setReady(true);
          return;
        }
        const restored = restoreSessionUser(loadUsersFromStorage());
        if (!cancelled && restored && !intentionalLogout.current) {
          setUsageScope(restored.username);
          setBootUser(restored);
        }
      } catch (e) {
        console.warn('[LoginBoot] restore failed', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const handleLogin = useCallback((u: User) => {
    intentionalLogout.current = false;
    saveSession(u.username);
    armDesktopSession();
    setUsageScope(u.username);
    startTransition(() => setBootUser(u));
  }, []);

  const handleAppLogout = useCallback(() => {
    intentionalLogout.current = true;
    try {
      clearSession();
    } catch {
      /* ignore */
    }
    setUsageScope(null);
    setBootUser(null);
  }, []);

  if (!ready) {
    return <QuietShell />;
  }

  if (!bootUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Suspense fallback={<QuietShell />}>
      <AppErrorGate
        onBack={() => {
          intentionalLogout.current = true;
          setBootUser(null);
        }}
      >
        <AppLazy bootUser={bootUser} onBootLogout={handleAppLogout} />
      </AppErrorGate>
    </Suspense>
  );
};

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
