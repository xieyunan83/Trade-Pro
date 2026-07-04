
import React, { useState } from 'react';
import { User } from '../types';
import { User as UserIcon, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { verifyPassword } from '../services/auth';

interface LoginProps {
  onLogin: (user: User) => void;
  users: User[];
}

export const Login: React.FC<LoginProps> = ({ onLogin, users }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const trimmed = username.trim();
    const foundUser = users.find(u => u.username === trimmed);

    if (!foundUser || !foundUser.password) {
      setError('用户名或密码错误');
      setLoading(false);
      return;
    }

    const ok = await verifyPassword(password, foundUser.password);
    if (!ok) {
      setError('用户名或密码错误');
      setLoading(false);
      return;
    }

    onLogin(foundUser);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F7FA] p-4">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-black text-slate-800 tracking-tight mb-4">
          楠哥的小助理 <span className="text-blue-600">Pro</span>
        </h1>
        <p className="text-xl text-slate-500 font-medium tracking-wide">企业级外贸情报平台</p>
      </div>

      <div className="bg-white p-12 rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] w-full max-w-lg border border-white">
        <div className="flex items-center gap-3 mb-10">
          <div className="text-blue-600">
            <UserIcon size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-3xl font-black text-slate-800">登录系统</h2>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-bold border border-red-100">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-8">
          <div>
            <label className="block text-sm font-black text-slate-400 uppercase tracking-widest mb-3">用户名 (USERNAME)</label>
            <div className="relative">
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300">
                <UserIcon size={22} />
              </div>
              <input 
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                className="w-full pl-14 pr-6 py-5 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 focus:outline-none font-bold text-lg transition-all placeholder:text-slate-300"
                placeholder="输入用户名"
                required
                autoComplete="username"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-black text-slate-400 uppercase tracking-widest mb-3">密码 (PASSWORD)</label>
            <div className="relative">
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300">
                <Lock size={22} />
              </div>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full pl-14 pr-6 py-5 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 focus:outline-none font-bold text-lg transition-all placeholder:text-slate-300"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 rounded-2xl font-black text-xl shadow-[0_10px_30px_rgba(37,99,235,0.3)] transition-all flex items-center justify-center gap-3 disabled:opacity-70"
          >
            {loading ? <Loader2 className="animate-spin" size={24} /> : '进入平台'}
          </button>
        </form>
      </div>
    </div>
  );
};
