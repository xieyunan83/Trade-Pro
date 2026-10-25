import React, { useMemo, useState } from 'react';
import {
  Share2,
  Sparkles,
  Copy,
  Trash2,
  Package,
  Check,
  Hash,
  Megaphone,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type SocialPiece,
  type SocialPlatform,
  SOCIAL_PLATFORM_META,
  loadSocialPieces,
  saveSocialPieces,
  newCreativeId,
  draftSocialCopy,
} from '../services/creativeStudioStore';

type Props = { currentUser: User };

/**
 * 发文素材加工：按平台尺寸生成文案 / 话题 / CTA，挂接产品库，素材库沉淀。
 */
export const ModuleSocialContent: React.FC<Props> = ({ currentUser }) => {
  const [pieces, setPieces] = useState<SocialPiece[]>(() => loadSocialPieces());
  const [platform, setPlatform] = useState<SocialPlatform>('linkedin');
  const [locale, setLocale] = useState<'zh' | 'en'>('en');
  const [skuPick, setSkuPick] = useState('');
  const [productName, setProductName] = useState('');
  const [highlight, setHighlight] = useState('');
  const [activeId, setActiveId] = useState<string | null>(pieces[0]?.id || null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const meta = SOCIAL_PLATFORM_META.find((p) => p.id === platform) || SOCIAL_PLATFORM_META[0];
  const active = pieces.find((p) => p.id === activeId) || null;

  const persist = (next: SocialPiece[]) => {
    setPieces(next);
    saveSocialPieces(next);
  };

  const onSkuChange = (id: string) => {
    setSkuPick(id);
    const s = skus.find((x) => x.id === id);
    if (s) {
      setProductName(s.nameEn || s.name);
      if (s.specs) setHighlight(s.specs.slice(0, 80));
    }
  };

  const generate = () => {
    const sku = skus.find((s) => s.id === skuPick);
    const name = productName.trim() || sku?.name || '';
    if (!name) {
      setMsg('请填写品名或选择产品库 SKU');
      return;
    }
    const draft = draftSocialCopy({
      platform,
      productName: name,
      highlight: highlight.trim(),
      locale,
    });
    const now = Date.now();
    const piece: SocialPiece = {
      id: newCreativeId('soc'),
      platform,
      title: `${meta.label} · ${name.slice(0, 28)}`,
      caption: draft.caption,
      hashtags: draft.hashtags,
      cta: draft.cta,
      size: meta.size,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      imageHint: `${meta.size} 配图位 · 可从平面设计模块下载后替换`,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([piece, ...pieces]);
    setActiveId(piece.id);
    setMsg(`已生成 ${meta.label} 素材`);
  };

  const updateActive = (patch: Partial<SocialPiece>) => {
    if (!active) return;
    const next = { ...active, ...patch, updatedAt: Date.now() };
    persist(pieces.map((p) => (p.id === active.id ? next : p)));
  };

  const copyAll = async () => {
    if (!active) return;
    const text = `${active.caption}\n\n${active.hashtags.join(' ')}\n\n${active.cta}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMsg('复制失败，请手动选择文本');
    }
  };

  const remove = (id: string) => {
    if (!confirm('删除该素材？')) return;
    const next = pieces.filter((p) => p.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  return (
    <div className="max-w-[96rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50/70 via-white to-violet-50/50 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-fuchsia-700 font-black text-xs uppercase tracking-widest">
          <Share2 size={14} /> Social Studio
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">发文素材加工</h2>
        <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
          按渠道尺寸一键生成文案、话题标签与 CTA；可挂产品库，编辑后复制发布。配图可与「产品设计 · 平面图」联动使用。
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="text-xs font-black text-slate-700">选择渠道</div>
            <div className="grid grid-cols-2 gap-1.5">
              {SOCIAL_PLATFORM_META.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`rounded-xl border px-2.5 py-2 text-left ${
                    platform === p.id
                      ? 'border-fuchsia-500 bg-fuchsia-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-[11px] font-black text-slate-800">{p.label}</div>
                  <div className="text-[9px] text-slate-400 font-bold mt-0.5">{p.size}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 font-medium">{meta.tip}</p>

            <div className="flex gap-2">
              {(['en', 'zh'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={`flex-1 rounded-xl text-xs font-black py-2 border ${
                    locale === l ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200'
                  }`}
                >
                  {l === 'en' ? 'English' : '中文'}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                <Package size={10} /> 产品库
              </label>
              <select
                value={skuPick}
                onChange={(e) => onSkuChange(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">手工填写品名</option>
                {skus.slice(0, 80).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.skuCode} · {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">品名</label>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="产品英文/中文名"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase">卖点亮点</label>
              <input
                value={highlight}
                onChange={(e) => setHighlight(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="如 CE certified · MOQ 500 · OEM"
              />
            </div>

            <button
              type="button"
              onClick={generate}
              className="w-full rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm font-black py-3 inline-flex items-center justify-center gap-2"
            >
              <Sparkles size={16} /> 生成素材
            </button>
            {msg && (
              <p className="text-xs font-bold text-fuchsia-900 bg-fuchsia-50 border border-fuchsia-100 rounded-xl px-3 py-2">
                {msg}
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-[360px]">
          {!active ? (
            <p className="m-auto text-sm text-slate-400 font-medium">生成后在此编辑</p>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-slate-800">{active.title}</div>
                  <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {SOCIAL_PLATFORM_META.find((p) => p.id === active.platform)?.label} · {active.size}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyAll()}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 text-xs font-black px-3 py-2 hover:bg-slate-50"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制全文'}
                </button>
              </div>

              <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-fuchsia-900/80 aspect-video max-h-40 flex items-center justify-center text-white/80 text-xs font-bold px-4 text-center">
                  {active.imageHint}
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase">正文</label>
                  <textarea
                    value={active.caption}
                    onChange={(e) => updateActive({ caption: e.target.value })}
                    rows={6}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y leading-relaxed"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase inline-flex items-center gap-1">
                    <Hash size={10} /> 话题
                  </label>
                  <input
                    value={active.hashtags.join(' ')}
                    onChange={(e) =>
                      updateActive({
                        hashtags: e.target.value
                          .split(/\s+/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase inline-flex items-center gap-1">
                    <Megaphone size={10} /> CTA
                  </label>
                  <input
                    value={active.cta}
                    onChange={(e) => updateActive({ cta: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden max-h-[32rem] flex flex-col">
          <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700">
            素材库 ({pieces.length})
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {pieces.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveId(p.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${
                  activeId === p.id ? 'bg-fuchsia-50' : ''
                }`}
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 truncate">{p.title}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {SOCIAL_PLATFORM_META.find((x) => x.id === p.platform)?.label} · {p.size}
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(p.id);
                    }}
                    className="text-slate-300 hover:text-rose-500"
                  >
                    <Trash2 size={12} />
                  </span>
                </div>
              </button>
            ))}
            {!pieces.length && <p className="text-center text-xs text-slate-400 py-8">暂无素材</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
