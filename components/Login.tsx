
import React, { useState } from 'react';
import { User } from '../types';
import { getUser, saveUser } from '../services/db';
import { Lock, User as UserIcon, Loader2, LogIn, ShieldAlert } from 'lucide-react';

interface Props {
    onLogin: (user: User) => void;
}

export const Login: React.FC<Props> = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    
    // Change Password State
    const [showChangePwd, setShowChangePwd] = useState(false);
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [tempUser, setTempUser] = useState<User | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const user = await getUser(username);
            if (!user || user.password !== password) {
                setError("Invalid username or password");
                setLoading(false);
                return;
            }

            if (user.isFirstLogin) {
                setTempUser(user);
                setShowChangePwd(true);
                setLoading(false);
                return;
            }

            onLogin(user);
        } catch (err) {
            console.error(err);
            setError("Database error");
        } finally {
            setLoading(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPwd !== confirmPwd) {
            setError("Passwords do not match");
            return;
        }
        if (newPwd.length < 6) {
            setError("Password must be at least 6 characters");
            return;
        }
        if (!tempUser) return;

        setLoading(true);
        const updatedUser = { ...tempUser, password: newPwd, isFirstLogin: false };
        await saveUser(updatedUser);
        
        onLogin(updatedUser);
        setLoading(false);
    };

    if (showChangePwd) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-100">
                <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-red-100">
                    <div className="text-center mb-6">
                        <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                            <ShieldAlert size={32} />
                        </div>
                        <h2 className="text-2xl font-black text-slate-800">Change Password</h2>
                        <p className="text-slate-500 text-sm mt-2">First-time login requires a password change.</p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold text-center mb-4">{error}</div>}
                    <form onSubmit={handleChangePassword} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">New Password</label>
                            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900" required />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Confirm Password</label>
                            <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl bg-white text-slate-900" required />
                        </div>
                        <button type="submit" className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 flex justify-center gap-2">
                            {loading ? <Loader2 className="animate-spin" /> : 'Update & Login'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 p-6">
            <div className="text-center mb-8">
                <h1 className="text-4xl font-black text-slate-800 tracking-tight mb-2">楠哥的小助理 <span className="text-blue-600">Pro</span></h1>
                <p className="text-slate-500 font-medium">企业级外贸情报平台</p>
            </div>

            <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md">
                <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <LogIn size={24} className="text-blue-600"/> 登录系统
                </h2>
                
                {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-bold text-center mb-6 border border-red-100">{error}</div>}

                <form onSubmit={handleLogin} className="space-y-5">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">用户名 (Username)</label>
                        <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10">
                                <UserIcon size={18} />
                            </div>
                            <input 
                                type="text" 
                                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 bg-white placeholder:text-slate-400"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="输入用户名"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">密码 (Password)</label>
                        <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10">
                                <Lock size={18} />
                            </div>
                            <input 
                                type="password" 
                                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 bg-white placeholder:text-slate-400"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        disabled={loading}
                        className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : '进入平台'}
                    </button>
                </form>
            </div>
        </div>
    );
};
