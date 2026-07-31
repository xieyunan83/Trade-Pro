
import React, { useState } from 'react';
import { User } from '../types';
import { User as UserIcon, Lock, Loader2, AlertTriangle, Cpu } from 'lucide-react';
import { authenticateUser } from '../services/auth';
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

  const finishLogin = (user: User) => {
    setPendingUser(null);
    setMacInput('');
    onLogin(user);
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
        finishLogin(user);
        return;
      }

      const access = await evaluateEmployeeAccess(user);
      if (access.ok) {
        finishLogin(user);
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
        finishLogin(pendingUser);
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
      finishLogin(res.user);
    } catch (err) {
      console.error('device bind failed', err);
      setError('设备绑定失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tp-login min-h-screen min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{
        backgroundImage: 'linear-gradient(rgba(34,211,238,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.08) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
      }} />
      <div className="text-center mb-8 sm:mb-12 px-2 relative z-10 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">
          Trade Intelligence OS
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-3 sm:mb-4">
          楠哥的小助理 <span className="text-cyan-300">Pro</span>
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-slate-400 font-medium tracking-wide">企业级外贸情报平台</p>
      </div>

      <div className="relative z-10 bg-white/95 backdrop-blur-xl p-6 sm:p-8 md:p-12 rounded-3xl sm:rounded-[2rem] shadow-signal w-full max-w-lg border border-white/20 animate-fade-in">
        <div className="flex items-center gap-3 mb-8 sm:mb-10">
          <div className="text-cyan-600 bg-cyan-50 p-2.5 rounded-xl">
            {pendingUser ? <Cpu size={28} strokeWidth={2.5} /> : <UserIcon size={28} strokeWidth={2.5} className="sm:w-8 sm:h-8" />}
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {pendingUser ? (bindMode === 'remac' ? '确认网卡地址' : '绑定本机设备') : '登录系统'}
          </h2>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-bold border border-red-100">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {pendingUser ? (
          <form onSubmit={handleBindDevice} className="space-y-6">
            <p className="text-sm font-medium text-slate-600 leading-relaxed">
              {bindMode === 'remac' ? (
                <>
                  账号 <span className="font-black text-slate-900">{pendingUser.username}</span> 已绑定本机，请再次输入登记过的网卡物理地址以确认。
                </>
              ) : (
                <>
                  账号 <span className="font-black text-slate-900">{pendingUser.username}</span> 为普通员工，首次登录需绑定本机。
                  请填写本机网卡物理地址（MAC）；系统会同时锁定当前浏览器设备指纹，其它电脑将无法使用。
                </>
              )}
            </p>
            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-400 uppercase tracking-widest mb-2">
                网卡物理地址 (MAC)
              </label>
              <input
                type="text"
                value={macInput}
                onChange={(e) => setMacInput(e.target.value)}
                className="w-full px-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:outline-none font-bold text-base"
                placeholder="A1:B2:C3:D4:E5:F6"
                required
              />
              <p className="mt-2 text-[11px] font-bold text-slate-400">{formatMacInputHint()}</p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-cyan-600 to-sky-600 hover:brightness-105 text-white py-4 rounded-2xl font-extrabold text-lg shadow-signal disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin mx-auto" size={22} /> : bindMode === 'remac' ? '确认并进入' : '绑定并进入'}
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
          <form onSubmit={handleLogin} className="space-y-6 sm:space-y-8">
            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-400 uppercase tracking-widest mb-2 sm:mb-3">用户名</label>
              <div className="relative">
                <div className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-300">
                  <UserIcon size={20} className="sm:w-[22px] sm:h-[22px]" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 sm:pl-14 pr-4 sm:pr-6 py-4 sm:py-5 rounded-2xl border-2 border-slate-100 focus:border-cyan-500 focus:ring-0 focus:outline-none font-semibold text-base sm:text-lg text-slate-950 transition-all placeholder:text-slate-500"
                  placeholder="输入用户名"
                  required
                  autoComplete="username"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-400 uppercase tracking-widest mb-2 sm:mb-3">密码</label>
              <div className="relative">
                <div className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-300">
                  <Lock size={20} className="sm:w-[22px] sm:h-[22px]" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 sm:pl-14 pr-4 sm:pr-6 py-4 sm:py-5 rounded-2xl border-2 border-slate-100 focus:border-cyan-500 focus:ring-0 focus:outline-none font-semibold text-base sm:text-lg text-slate-950 transition-all placeholder:text-slate-500"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-cyan-600 to-sky-600 hover:brightness-105 text-white py-4 sm:py-6 rounded-2xl font-extrabold text-lg sm:text-xl shadow-signal transition-all flex items-center justify-center gap-3 disabled:opacity-70 touch-manipulation"
            >
              {loading ? <Loader2 className="animate-spin" size={24} /> : '进入平台'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
