
import React, { useState } from 'react';
import { User } from '../types';
import { User as UserIcon, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { authenticateUser } from '../services/auth';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const user = await authenticateUser(username, password);
      if (!user) {
        setError('用户名或密码错误');
        return;
      }
      onLogin(user);
    } catch (err) {
      console.error('Login failed', err);
      setError('登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col items-center justify-center bg-[#F4F7FA] p-4 sm:p-6">
      <div className="text-center mb-8 sm:mb-12 px-2">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-800 tracking-tight mb-3 sm:mb-4">
          楠哥的小助理 <span className="text-blue-600">Pro</span>
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-slate-500 font-medium tracking-wide">企业级外贸情报平台</p>
      </div>

      <div className="bg-white p-6 sm:p-8 md:p-12 rounded-3xl sm:rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] w-full max-w-lg border border-white">
        <div className="flex items-center gap-3 mb-8 sm:mb-10">
          <div className="text-blue-600">
            <UserIcon size={28} strokeWidth={2.5} className="sm:w-8 sm:h-8" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800">登录系统</h2>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-bold border border-red-100">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {error}
          </div>
        )}
        
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
                onChange={e => setUsername(e.target.value)} 
                className="w-full pl-12 sm:pl-14 pr-4 sm:pr-6 py-4 sm:py-5 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 focus:outline-none font-bold text-base sm:text-lg transition-all placeholder:text-slate-300"
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
                onChange={e => setPassword(e.target.value)} 
                className="w-full pl-12 sm:pl-14 pr-4 sm:pr-6 py-4 sm:py-5 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 focus:outline-none font-bold text-base sm:text-lg transition-all placeholder:text-slate-300"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 sm:py-6 rounded-2xl font-black text-lg sm:text-xl shadow-[0_10px_30px_rgba(37,99,235,0.3)] transition-all flex items-center justify-center gap-3 disabled:opacity-70 touch-manipulation"
          >
            {loading ? <Loader2 className="animate-spin" size={24} /> : '进入平台'}
          </button>
        </form>
      </div>
    </div>
  );
};
