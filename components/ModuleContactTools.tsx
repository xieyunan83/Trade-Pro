import React, { useMemo, useState } from 'react';
import {
  MessageCircle,
  ExternalLink,
  LogIn,
  Phone,
  Users,
  Shield,
  Loader2,
} from 'lucide-react';
import type { Client, User } from '../types';
import {
  CONTACT_TOOLS,
  type ContactToolId,
  type RecentContactLaunch,
  loadPreferredTool,
  savePreferredTool,
  loadRecentLaunches,
  pushRecentLaunch,
  openOfficialLogin,
  openChatDeepLink,
  digitsOnlyPhone,
} from '../services/contactTools';

type Props = {
  currentUser: User;
  crmClients?: Client[];
};

/**
 * 联系工具：打开 WhatsApp / Skype / 微信等官方网页端，由使用者扫码或账号真实登录。
 * 本平台不代持密码；官方站点通常禁止 iframe，故以独立窗口登录为主。
 */
export const ModuleContactTools: React.FC<Props> = ({ currentUser, crmClients = [] }) => {
  const [activeId, setActiveId] = useState<ContactToolId>(() => loadPreferredTool());
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentContactLaunch[]>(() => loadRecentLaunches());
  const [loginOpenedAt, setLoginOpenedAt] = useState<number | null>(null);

  const tool = CONTACT_TOOLS.find((t) => t.id === activeId) || CONTACT_TOOLS[0];

  const crmHits = useMemo(() => {
    const rows: Array<{ name: string; company: string; phone: string; whatsapp: string }> = [];
    for (const c of crmClients.slice(0, 200)) {
      for (const d of c.contacts || []) {
        const phone = (d.phone || '').trim();
        const wa = (d.whatsapp || '').trim();
        if (!phone && !wa) continue;
        rows.push({
          name: d.name || d.firstName || '联系人',
          company: c.name || '',
          phone,
          whatsapp: wa,
        });
      }
    }
    return rows.slice(0, 40);
  }, [crmClients]);

  const selectTool = (id: ContactToolId) => {
    setActiveId(id);
    savePreferredTool(id);
    setMsg(null);
  };

  const handleLogin = () => {
    setBusy(true);
    setMsg(null);
    const win = openOfficialLogin(tool);
    setLoginOpenedAt(Date.now());
    if (!win) {
      setMsg('弹窗被拦截。请允许本站弹窗后重试，或点击下方链接在新标签打开。');
    } else {
      setMsg(`已打开「${tool.label}」官方网页。请在该窗口完成登录（扫码/账号），登录态由官方保存。`);
      setRecent(
        pushRecentLaunch({
          toolId: tool.id,
          label: `${tool.label} 登录`,
          target: tool.webLoginUrl,
        })
      );
    }
    setBusy(false);
  };

  const handleStartChat = () => {
    if (!target.trim()) {
      setMsg('请填写对方号码或账号');
      return;
    }
    const ok = openChatDeepLink(tool.id, target.trim(), message.trim() || undefined);
    if (!ok) {
      setMsg('无法生成会话链接，请检查号码格式（WhatsApp 需含国家区号数字）');
      return;
    }
    // WhatsApp 等：若未登录会先要求登录
    if (tool.id === 'whatsapp' || tool.id === 'wechat' || tool.id === 'skype') {
      openOfficialLogin(tool);
    }
    setRecent(
      pushRecentLaunch({
        toolId: tool.id,
        label: target.trim(),
        target: target.trim(),
      })
    );
    setMsg(`已发起「${tool.label}」会话。若尚未登录，请先在弹出的官方窗口登录。`);
  };

  return (
    <div className="max-w-[90rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 via-white to-cyan-50/40 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-emerald-700 font-black text-xs uppercase tracking-widest">
              <MessageCircle size={14} /> Contact Tools
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">联系工具</h2>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
              登录你自己的 WhatsApp、Skype、微信等官方网页端，与客户即时沟通。账号在官方窗口登录，本平台不保存密码。
            </p>
          </div>
          <div className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2 inline-flex items-center gap-1.5">
            <Shield size={12} className="text-emerald-600" /> 官方登录 · 本地不存密
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 space-y-2">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            选择工具
          </div>
          {CONTACT_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTool(t.id)}
              className={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${
                activeId === t.id
                  ? 'border-emerald-400 bg-emerald-50/80 ring-2 ring-emerald-100'
                  : 'border-slate-200 bg-white hover:border-emerald-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0"
                  style={{ background: t.accent }}
                >
                  {t.label.slice(0, 2)}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800">{t.label}</div>
                  <div className="text-[11px] text-slate-500 font-medium truncate">{t.tip}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black"
              style={{ background: tool.accent }}
            >
              {tool.label.slice(0, 2)}
            </span>
            <div>
              <div className="text-lg font-extrabold text-slate-900">{tool.label}</div>
              <div className="text-xs text-slate-500 font-medium">官方 {tool.sub} · {currentUser.username}</div>
            </div>
          </div>

          <p className="text-xs text-slate-600 font-medium leading-relaxed bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
            {tool.tip}
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={handleLogin}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black py-3 disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />}
            打开并登录 {tool.label}
          </button>

          <a
            href={tool.webLoginUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-black py-2.5 hover:bg-slate-50"
          >
            <ExternalLink size={14} /> 在新标签打开官方页面
          </a>

          {loginOpenedAt && (
            <p className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
              已于 {new Date(loginOpenedAt).toLocaleTimeString('zh-CN')} 打开登录窗口。扫码成功后可保持登录，下次直接点「打开并登录」即可进入会话。
            </p>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <Phone size={10} /> 发起对话（可选）
            </div>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={
                tool.id === 'whatsapp'
                  ? '对方手机号（含国家区号，如 8613800138000）'
                  : tool.id === 'skype'
                    ? 'Skype 用户名或电话'
                    : tool.id === 'telegram'
                      ? 'Telegram 用户名（不含 @）'
                      : '号码 / 账号'
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
            {(tool.id === 'whatsapp' || tool.id === 'telegram') && (
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder="开场白（可选）"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
              />
            )}
            <button
              type="button"
              onClick={handleStartChat}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-black py-2.5"
            >
              打开与对方的会话
            </button>
          </div>

          {msg && (
            <p className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              {msg}
            </p>
          )}
        </div>

        <div className="lg:col-span-3 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col max-h-[22rem]">
            <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700 flex items-center gap-1.5">
              <Users size={12} /> CRM 有电话的联系人
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {crmHits.map((h, i) => {
                const num = h.whatsapp || h.phone;
                return (
                  <button
                    key={`${h.name}-${num}-${i}`}
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-emerald-50/60"
                    onClick={() => {
                      setTarget(digitsOnlyPhone(num) || num);
                      selectTool('whatsapp');
                      setMsg(`已填入 ${h.name}，可点「打开与对方的会话」或先登录 WhatsApp`);
                    }}
                  >
                    <div className="text-xs font-black text-slate-800 truncate">{h.name}</div>
                    <div className="text-[10px] text-slate-400 font-bold truncate">
                      {h.company} · {num}
                    </div>
                  </button>
                );
              })}
              {!crmHits.length && (
                <p className="text-center text-xs text-slate-400 py-8 font-medium px-3">
                  CRM 暂无带电话/WhatsApp 的联系人。可先背调或手工填写号码。
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden max-h-40 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 text-[10px] font-black text-slate-500 uppercase">
              最近操作
            </div>
            <div className="overflow-y-auto divide-y divide-slate-50 text-[11px]">
              {recent.slice(0, 8).map((r, i) => (
                <div key={`${r.at}-${i}`} className="px-3 py-1.5 flex justify-between gap-2">
                  <span className="font-bold text-slate-700 truncate">
                    {CONTACT_TOOLS.find((t) => t.id === r.toolId)?.label} · {r.label}
                  </span>
                  <span className="text-slate-400 shrink-0">
                    {new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              {!recent.length && (
                <p className="text-center text-slate-400 py-4">暂无记录</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
