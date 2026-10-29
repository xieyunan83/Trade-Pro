import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import {
  askXiaoYuan,
  XIAOYUAN_AVATAR,
  XIAOYUAN_NAME,
  XIAOYUAN_QUICK_PROMPTS,
  type XiaoYuanMsg,
} from '../services/xiaoyuanAssistant';
import { newCreativeId } from '../services/creativeStudioStore';

type Props = {
  /** 登录后才显示；未登录不挂载 */
  visible?: boolean;
};

const WELCOME: XiaoYuanMsg = {
  id: 'welcome',
  role: 'assistant',
  text: `你好，我是${XIAOYUAN_NAME}，平台操作助手。你可以问我：功能入口在哪、演示怎么走、平面/3D/视频/建站怎么用。技术实现细节我不会讲，但操作步骤我可以一步步带你。`,
  at: Date.now(),
};

/**
 * 右下角浮动助手：ChatGPT 式对话，严格不泄密。
 */
export const XiaoYuanAssistant: React.FC<Props> = ({ visible = true }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<XiaoYuanMsg[]>([WELCOME]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open, messages, busy]);

  if (!visible) return null;

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    const userMsg: XiaoYuanMsg = {
      id: newCreativeId('xy'),
      role: 'user',
      text,
      at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const reply = await askXiaoYuan(text, [...messages, userMsg]);
      setMessages((prev) => [
        ...prev,
        {
          id: newCreativeId('xy'),
          role: 'assistant',
          text: reply,
          at: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed z-[70] bottom-5 right-5 sm:bottom-6 sm:right-6 group flex items-center gap-2 rounded-full shadow-2xl shadow-teal-900/30 ring-2 ring-white/80 hover:scale-[1.03] active:scale-[0.98] transition-transform"
        aria-label={`打开${XIAOYUAN_NAME}助手`}
        title={`${XIAOYUAN_NAME} · 操作助手`}
      >
        <span className="relative w-14 h-14 rounded-full overflow-hidden bg-slate-900">
          <img
            src={XIAOYUAN_AVATAR}
            alt={XIAOYUAN_NAME}
            className="w-full h-full object-cover object-top"
            draggable={false}
          />
          <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
        </span>
        <span className="hidden sm:flex items-center gap-1.5 pr-4 pl-1 py-2 rounded-full bg-slate-900 text-white text-xs font-black tracking-wide">
          <Sparkles size={12} className="text-teal-300" />
          {XIAOYUAN_NAME}
        </span>
      </button>

      {open && (
        <div
          className="fixed z-[71] bottom-[5.5rem] right-3 sm:right-6 w-[min(100vw-1.5rem,24rem)] h-[min(72vh,34rem)] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
          role="dialog"
          aria-label={`${XIAOYUAN_NAME}对话`}
        >
          <header className="shrink-0 flex items-center gap-3 px-3.5 py-3 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
            <img
              src={XIAOYUAN_AVATAR}
              alt=""
              className="w-10 h-10 rounded-full object-cover object-top ring-2 ring-teal-400/50"
              draggable={false}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black flex items-center gap-1.5">
                {XIAOYUAN_NAME}
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-200 border border-teal-400/30">
                  平台助手
                </span>
              </div>
              <p className="text-[10px] text-slate-300 truncate">操作答疑 · 功能指路 · 不涉及内部实现</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'assistant' && (
                  <img
                    src={XIAOYUAN_AVATAR}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover object-top shrink-0 mt-0.5"
                    draggable={false}
                  />
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-slate-900 text-white rounded-br-md'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-bl-md shadow-sm'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-400 pl-9">
                <Loader2 size={12} className="animate-spin" /> 小媛正在想…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {messages.length <= 2 && (
            <div className="shrink-0 px-3 pb-2 flex flex-wrap gap-1.5 bg-slate-50 border-t border-slate-100 pt-2">
              {XIAOYUAN_QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(q)}
                  className="text-[10px] font-bold px-2 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="shrink-0 p-2.5 border-t border-slate-100 bg-white flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="问小媛：入口在哪、怎么操作…"
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
              className="shrink-0 h-10 w-10 rounded-xl bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center disabled:opacity-40"
              aria-label="发送"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="shrink-0 text-[9px] text-center text-slate-400 pb-2 px-3 flex items-center justify-center gap-1">
            <MessageCircle size={9} /> 仅解答使用方式，不提供平台内部技术细节
          </p>
        </div>
      )}
    </>
  );
};

export default XiaoYuanAssistant;
