/**
 * 轻量启动门：一挂载就出真实登录表单（禁止再卡在空白/「打开登录」壳）。
 * 主包与类目延后预取，避免和首屏抢带宽。
 */
import React, {
  Suspense,
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
import { installForegroundGuard } from './services/foregroundGuard';
import { lazyWithRetry } from './utils/lazyWithRetry';

/** 部署后旧 chunk 404 时自动强刷；避免登录后卡在「工作台加载失败」 */
const AppLazy = lazyWithRetry(
  () => import('./App').then((m) => ({ default: m.default })),
  'app-main'
);

const QuietShell: React.FC = () => <div className="tp-login min-h-[100dvh] w-full" aria-busy="true" />;

const isDesktopUa = () =>
  typeof navigator !== 'undefined' &&
  /TradeCollabClient|BabyWorldClient/i.test(navigator.userAgent);

export const LoginBoot: React.FC = () => {
  const [bootUser, setBootUser] = useState<User | null>(null);
  /** 先出登录，再异步恢复会话；禁止 ready=false 整页空白 */
  const intentionalLogout = useRef(false);

  useEffect(() => installForegroundGuard(), []);

  // 禁止登录页后台预取主包；点进应用后再加载
  useEffect(() => {
    if (!bootUser) return;
    void hydrateProductTaxonomy().catch((e) =>
      console.warn('[LoginBoot] taxonomy hydrate failed', e)
    );
  }, [bootUser]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      try {
        if (intentionalLogout.current) return;
        if (isDesktopUa() && !isDesktopSessionArmed()) return;
        const restored = restoreSessionUser(loadUsersFromStorage());
        if (!cancelled && restored) {
          setUsageScope(restored.username);
          startTransition(() => setBootUser(restored));
        }
      } catch (e) {
        console.warn('[LoginBoot] restore failed', e);
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
  { err: boolean; detail: string }
> {
  state = { err: false, detail: '' };

  static getDerivedStateFromError(err: unknown) {
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === 'string'
          ? err
          : '未知错误';
    return { err: true, detail: detail.slice(0, 280) };
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
            {this.state.detail ? (
              <p className="text-[11px] font-medium text-slate-500 break-words text-left bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                {this.state.detail}
              </p>
            ) : null}
            <div className="flex flex-col items-center gap-2 pt-1">
              <button
                type="button"
                className="text-xs font-semibold text-teal-700 underline"
                onClick={() => {
                  // 疑似旧资源/chunk 过期：强制换入口再进
                  try {
                    const u = new URL(window.location.href);
                    u.searchParams.set('_boot', String(Date.now()));
                    window.location.replace(u.toString());
                    return;
                  } catch {
                    window.location.reload();
                  }
                }}
              >
                强制刷新重试
              </button>
              <button
                type="button"
                className="text-[11px] font-semibold text-slate-500 underline"
                onClick={() => {
                  this.setState({ err: false, detail: '' });
                  this.props.onBack();
                }}
              >
                返回登录
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default LoginBoot;
