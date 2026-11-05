import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Send, X } from 'lucide-react';
import {
  askXiaoYuan,
  preloadXiaoYuanAvatar,
  XIAOYUAN_AVATAR,
  XIAOYUAN_NAME,
  XIAOYUAN_QUICK_PROMPTS,
  type XiaoYuanMsg,
} from '../services/xiaoyuanAssistant';
import { newCreativeId } from '../services/creativeStudioStore';

type Props = {
  /** 登录后才显示 */
  visible?: boolean;
};

/** 旧版可拖动 FAB 坐标键，挂载时清掉，避免残留定位逻辑 */
const LEGACY_FAB_POS_KEY = 'trade_scout_xiaoyuan_fab_pos_v1';

const WELCOME: XiaoYuanMsg = {
  id: 'welcome',
  role: 'assistant',
  text: `你好，我是${XIAOYUAN_NAME}。想找功能入口、不会操作某一步，直接问我就好——例如任务流下一步、平面设计、客户搜索、建站怎么用。`,
  at: Date.now(),
};

/** 共用头像 */
const XiaoYuanFace: React.FC<{
  sizeClass: string;
  ringClass?: string;
  className?: string;
  showOnlineDot?: boolean;
  compactDot?: boolean;
}> = ({ sizeClass, ringClass = '', className = '', showOnlineDot, compactDot }) => (
  <span
    className={`relative inline-block overflow-hidden rounded-full bg-slate-800 shrink-0 ${sizeClass} ${ringClass} ${className}`}
  >
    <img
      src={XIAOYUAN_AVATAR}
      alt=""
      width={128}
      height={128}
      decoding="async"
      loading="eager"
      fetchPriority="high"
      className="w-full h-full object-cover object-top pointer-events-none"
      draggable={false}
    />
    {showOnlineDot ? (
      <span
        className={`absolute rounded-full bg-emerald-400 ring-2 ring-slate-900 ${
          compactDot ? 'bottom-0.5 right-0.5 w-2 h-2' : 'bottom-1 right-1 w-3.5 h-3.5'
        }`}
      />
    ) : null}
  </span>
);

/**
 * 小媛：只出现在左侧导航栏底部，禁止满屏浮动。
 * 对话面板才 portal 到 body（贴着侧栏右侧弹出）。
 */
export const XiaoYuanAssistant: React.FC<Props> = ({ visible = true }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<XiaoYuanMsg[]>([WELCOME]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    preloadXiaoYuanAvatar();
    try {
      localStorage.removeItem(LEGACY_FAB_POS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

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

  const panelW = Math.min(
    typeof window !== 'undefined' ? window.innerWidth - 24 : 440,
    460
  );
  const panelH = Math.min(
    typeof window !== 'undefined' ? window.innerHeight * 0.78 : 580,
    640
  );
  // 从左侧菜单弹出：面板贴在侧栏右侧
  const panelLeft = typeof window !== 'undefined' ? Math.min(88, window.innerWidth - panelW - 12) : 88;
  const panelTop =
    typeof window !== 'undefined'
      ? Math.max(12, Math.min(window.innerHeight - panelH - 12, window.innerHeight * 0.12))
      : 80;

  const railBtn = (
    <button
      type="button"
      className="tp-xiaoyuan-rail w-full flex flex-col items-center gap-0.5 py-1.5 rounded-xl hover:bg-cyan-400/10 transition-colors"
      aria-label={`打开${XIAOYUAN_NAME}助手`}
      title={`${XIAOYUAN_NAME} · 点我提问`}
      onClick={() => {
        preloadXiaoYuanAvatar();
        setOpen((v) => !v);
      }}
    >
      <XiaoYuanFace
        sizeClass="w-9 h-9"
        ringClass="ring-2 ring-cyan-300/70 shadow-md shadow-cyan-900/20"
        showOnlineDot
        compactDot
      />
      <span className="text-[9px] font-black text-cyan-100/95 leading-none">{XIAOYUAN_NAME}</span>
    </button>
  );

  const dialog =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed z-[10000] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }}
            role="dialog"
            aria-label={`${XIAOYUAN_NAME}对话`}
          >
            <header className="shrink-0 flex items-center gap-3.5 px-4 py-3.5 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
              <XiaoYuanFace
                sizeClass="w-[4.25rem] h-[4.25rem] sm:w-[4.5rem] sm:h-[4.5rem]"
                ringClass="ring-2 ring-teal-400/70 shadow-lg"
                showOnlineDot
              />
              <div className="min-w-0 flex-1">
                <div className="text-base font-extrabold tracking-tight">{XIAOYUAN_NAME}</div>
                <div className="text-[11px] text-slate-300 font-medium">操作导引 · 随时问</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50 custom-scrollbar">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-teal-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-800'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-slate-400 text-sm font-bold px-1">
                  <Loader2 size={14} className="animate-spin" /> 思考中…
                </div>
              )}
              <div ref={endRef} />
            </div>
            <div className="shrink-0 px-3 pt-2 flex flex-wrap gap-1.5 border-t border-slate-100 bg-white">
              {XIAOYUAN_QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(q)}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="shrink-0 p-3 flex items-end gap-2 border-t border-slate-100 bg-white">
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
                className="flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] sm:text-base focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              />
              <button
                type="button"
                disabled={busy || !input.trim()}
                onClick={() => void send()}
                className="shrink-0 h-11 w-11 rounded-xl bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center disabled:opacity-40"
                aria-label="发送"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {railBtn}
      {dialog}
    </>
  );
};

export default XiaoYuanAssistant;
