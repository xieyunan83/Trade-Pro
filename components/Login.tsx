
import React, { useEffect, useState, startTransition } from 'react';
import { User } from '../types';
import { User as UserIcon, Lock, Loader2, AlertTriangle, Cpu, Sparkles } from 'lucide-react';
import { authenticateUser, changeUserPassword } from '../services/auth';
import {
  bindCurrentDevice,
  confirmLocalMacForBoundDevice,
  evaluateEmployeeAccess,
  formatMacInputHint,
  needsAccessControl,
} from '../services/deviceBind';
import {
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
  sanitizeUsernameInput,
} from '../services/appFirewall';
import { prefetchCoreModules } from '../services/modulePrefetch';

interface LoginProps {
  onLogin: (user: User) => void;
  onUsersChange?: (users: User[]) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin, onUsersChange }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [bindMode, setBindMode] = useState<'first' | 'remac'>('first');
  const [macInput, setMacInput] = useState('');
  const [forceChange, setForceChange] = useState<User | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');

  useEffect(() => {
    prefetchCoreModules();
  }, []);

  const finishLogin = (user: User) => {
    setPendingUser(null);
    setMacInput('');
    setForceChange(null);
    setNewPwd('');
    setNewPwd2('');
    prefetchCoreModules();
    startTransition(() => {
      onLogin(user);
    });
  };

  const maybeForcePasswordChange = (user: User) => {
    if (user.isFirstLogin) {
      try {
        const until = Number(localStorage.getItem('trade_scout_pwd_change_skip_until') || 0);
        if (until && Date.now() < until) {
          finishLogin({ ...user, isFirstLogin: false });
          return;
        }
      } catch {
        /* ignore */
      }
      setForceChange(user);
      setError('');
      return;
    }
    finishLogin(user);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setPendingUser(null);

    try {
      const nameCheck = sanitizeUsernameInput(username);
      if (!nameCheck.ok) {
        setError(nameCheck.message || '用户名无效');
        return;
      }
      const gate = checkLoginAllowed(nameCheck.value);
      if (!gate.ok) {
        setError(gate.message || '登录暂时受限');
        return;
      }

      const user = await authenticateUser(nameCheck.value, password);
      if (!user) {
        recordLoginFailure(nameCheck.value);
        setError('用户名或密码错误');
        return;
      }
      if (user.disabled) {
        setError('该账号已被停用，请联系管理员');
        return;
      }

      clearLoginFailures(nameCheck.value);

      if (!needsAccessControl(user)) {
        maybeForcePasswordChange(user);
        return;
      }

      const access = await evaluateEmployeeAccess(user);
      if (access.ok) {
        maybeForcePasswordChange(user);
        return;
      }

      if (access.needBind || access.reason === 'device_unbound_need_bind') {
        setPendingUser(user);
        setBindMode('first');
        setError('');
        return;
      }

      if (access.reason === 'mac_mismatch') {
        setPendingUser(user);
        setBindMode('remac');
        setError(access.message);
        return;
      }

      setError(access.message);
    } catch (err) {
      console.error('Login failed', err);
      setError('登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleBindDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUser) return;
    setLoading(true);
    setError('');
    try {
      if (bindMode === 'remac') {
        const conf = await confirmLocalMacForBoundDevice(pendingUser, macInput);
        if (conf.ok === false) {
          setError(conf.message);
          return;
        }
        const access = await evaluateEmployeeAccess(pendingUser);
        if (!access.ok) {
          setError(access.message);
          return;
        }
        maybeForcePasswordChange(pendingUser);
        return;
      }

      const res = await bindCurrentDevice(pendingUser.username, macInput, '首次绑定本机');
      if (res.ok === false) {
        setError(res.message);
        return;
      }
      onUsersChange?.(res.users);
      const access = await evaluateEmployeeAccess(res.user);
      if (!access.ok) {
        setError(access.message);
        return;
      }
      maybeForcePasswordChange(res.user);
    } catch (err) {
      console.error('device bind failed', err);
      setError('设备绑定失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleForceChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forceChange) return;
    setLoading(true);
    setError('');
    try {
      if (newPwd.trim() !== newPwd2.trim()) {
        setError('两次输入的新密码不一致');
        return;
      }
      const res = await changeUserPassword(forceChange.username, password, newPwd);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onUsersChange?.(res.users || []);
      finishLogin({ ...forceChange, isFirstLogin: false });
    } catch (err) {
      console.error(err);
      setError('改密失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  if (forceChange) {
    return (
      <div className="tp-login min-h-screen min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6">
        <form
          onSubmit={handleForceChangePassword}
          className="tp-login-card w-full max-w-md rounded-[1.35rem] p-6 sm:p-8 space-y-4"
        >
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">请修改默认密码</h2>
          <p className="text-sm text-slate-500 font-medium leading-relaxed">
            账号 <strong>{forceChange.username}</strong> 仍在使用默认或首次登录密码，须先设置新密码（至少 8 位）才能继续。
          </p>
          {error && <div className="text-sm font-bold text-rose-600">{error}</div>}
          <input
            type="password"
            placeholder="新密码"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
            required
            minLength={8}
          />
          <input
            type="password"
            placeholder="确认新密码"
            value={newPwd2}
            onChange={(e) => setNewPwd2(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
            required
            minLength={8}
          />
          <button
            type="submit"
            disabled={loading}
            className="tp-login-cta w-full text-white py-3 rounded-xl font-extrabold disabled:opacity-60"
          >
            {loading ? '保存中…' : '保存并进入系统'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              try {
                localStorage.setItem(
                  'trade_scout_pwd_change_skip_until',
                  String(Date.now() + 30 * 24 * 60 * 60 * 1000)
                );
              } catch {
                /* ignore */
              }
              finishLogin({ ...forceChange, isFirstLogin: false });
            }}
            className="w-full text-slate-500 text-sm font-bold py-2 hover:text-slate-800"
          >
            暂时跳过，先进入系统（30 天内不再强制）
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="tp-login min-h-screen min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(45,212,191,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(45,212,191,0.06) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage: 'radial-gradient(ellipse at center, black 18%, transparent 74%)',
        }}
      />
      <div className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 w-[44rem] h-[24rem] rounded-full bg-teal-400/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-4rem] right-[-2rem] w-[30rem] h-[20rem] rounded-full bg-amber-700/10 blur-3xl" />

      <div className="text-center mb-8 sm:mb-11 px-2 relative z-10 tp-login-hero">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-teal-300/30 bg-teal-400/10 text-teal-100 text-[11px] font-bold tracking-[0.22em] mb-5">
          <Sparkles size={12} className="text-teal-300" />
          澄海 · 智造出海
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-[3.35rem] font-extrabold text-white tracking-tight mb-3 sm:mb-4 drop-shadow-[0_2px_28px_rgba(0,0,0,0.4)]">
          外贸智慧协同
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-slate-300/85 font-medium tracking-wide">
          赋能澄海玩具产业升级
        </p>
      </div>

      <div className="relative z-10 p-6 sm:p-8 md:p-10 rounded-[1.35rem] sm:rounded-[1.5rem] w-full max-w-md tp-login-card">
        <div className="flex items-center gap-3 mb-7 sm:mb-8">
          <div className="text-teal-700 bg-gradient-to-br from-teal-50 to-stone-50 p-2.5 rounded-xl border border-teal-100/90">
            {pendingUser ? (
              <Cpu size={26} strokeWidth={2.25} />
            ) : (
              <UserIcon size={26} strokeWidth={2.25} />
            )}
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
              {pendingUser ? (bindMode === 'remac' ? '确认网卡地址' : '绑定本机设备') : '登录系统'}
            </h2>
            {!pendingUser && (
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5 tracking-wide">
                澄海玩具 · 数字化外贸工作台
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-5 flex items-center gap-2 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-bold border border-red-100">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {pendingUser ? (
          <form onSubmit={handleBindDevice} className="space-y-5">
            <p className="text-sm font-medium text-slate-600 leading-relaxed">
              {bindMode === 'remac' ? (
                <>
                  账号 <span className="font-black text-slate-900">{pendingUser.username}</span>{' '}
                  已绑定本机，请再次输入登记过的网卡物理地址以确认。
                </>
              ) : (
                <>
                  账号 <span className="font-black text-slate-900">{pendingUser.username}</span>{' '}
                  为普通员工，首次登录需绑定本机。
                  请填写本机网卡物理地址（MAC）；系统会同时锁定当前浏览器设备指纹，其它电脑将无法使用。
                </>
              )}
            </p>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                网卡物理地址 (MAC)
              </label>
              <input
                type="text"
                value={macInput}
                onChange={(e) => setMacInput(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-bold text-base"
                placeholder="A1:B2:C3:D4:E5:F6"
                required
              />
              <p className="mt-2 text-[11px] font-bold text-slate-400">{formatMacInputHint()}</p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="tp-login-cta w-full hover:brightness-105 text-white py-3.5 rounded-xl font-extrabold text-lg disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="animate-spin mx-auto" size={22} />
              ) : bindMode === 'remac' ? (
                '确认并进入'
              ) : (
                '绑定并进入'
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingUser(null);
                setMacInput('');
                setError('');
              }}
              className="w-full text-sm font-bold text-slate-500 hover:text-slate-700"
            >
              返回登录
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-5 sm:space-y-6">
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                用户名
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300">
                  <UserIcon size={18} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-semibold text-base text-slate-950 transition-colors placeholder:text-slate-400"
                  placeholder="输入用户名"
                  required
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                密码
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300">
                  <Lock size={18} />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-semibold text-base text-slate-950 transition-colors placeholder:text-slate-400"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="tp-login-cta w-full hover:brightness-105 active:scale-[0.99] text-white py-3.5 sm:py-4 rounded-xl font-extrabold text-lg transition-[filter,transform] flex items-center justify-center gap-2 disabled:opacity-70 touch-manipulation"
            >
              {loading ? <Loader2 className="animate-spin" size={22} /> : '进入平台'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
