import React, { useMemo, useRef, useState } from 'react';
import {
  Share2,
  Sparkles,
  Copy,
  Trash2,
  Package,
  Check,
  Hash,
  Megaphone,
  Send,
  Link2,
  Unplug,
  Loader2,
  ExternalLink,
  ImagePlus,
  LayoutTemplate,
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
import {
  type PublishablePlatform,
  PLATFORM_CONNECT_HINT,
  isPublishablePlatform,
  getConnection,
  upsertConnection,
  disconnectPlatform,
  openOfficialCompose,
  publishWithToken,
  loadSocialConnections,
} from '../services/socialPublishService';

type Props = { currentUser: User };

const PUBLISH_IDS: PublishablePlatform[] = ['linkedin', 'instagram', 'facebook', 'x'];

/**
 * 发文素材加工：生成文案 + 四平台官方发帖窗 / Token 直发
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
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  /** 参考图 = 成稿形态/版式；产品图 = 实拍主图 */
  const [referenceImage, setReferenceImage] = useState<string>('');
  const [productImage, setProductImage] = useState<string>('');
  const refInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [accountIdDraft, setAccountIdDraft] = useState('');
  const [connTick, setConnTick] = useState(0);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const meta = SOCIAL_PLATFORM_META.find((p) => p.id === platform) || SOCIAL_PLATFORM_META[0];
  const active = pieces.find((p) => p.id === activeId) || null;

  const connections = useMemo(() => {
    void connTick;
    return loadSocialConnections();
  }, [connTick]);

  const activePublishPlatform: PublishablePlatform | null =
    active && isPublishablePlatform(active.platform) ? active.platform : null;
  const connected = activePublishPlatform ? !!getConnection(activePublishPlatform) : false;

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
      const img = s.images?.[0];
      if (img && (img.startsWith('http') || img.startsWith('data:') || img.startsWith('blob:'))) {
        if (!/toysbear\.net/i.test(img)) {
          setImageUrl(img);
          setProductImage(img);
        }
      }
    }
  };

  const readImageFile = (file: File, kind: 'ref' | 'product') => {
    if (!file.type.startsWith('image/')) {
      setMsg('请上传图片文件');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMsg('单张图片请小于 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      if (kind === 'ref') setReferenceImage(url);
      else {
        setProductImage(url);
        setImageUrl(url);
      }
    };
    reader.readAsDataURL(file);
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
      imageHint: referenceImage
        ? `${meta.size} · 已含参考形态图`
        : `${meta.size} 配图位 · 可上传参考图 / 产品图`,
      referenceImageDataUrl: referenceImage || undefined,
      productImageDataUrl: productImage || undefined,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([piece, ...pieces]);
    setActiveId(piece.id);
    setMsg(`已生成 ${meta.label} 素材${productImage || referenceImage ? '（已附带上传图片）' : ''}`);
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

  const saveConnection = () => {
    if (!activePublishPlatform) return;
    if (!tokenDraft.trim()) {
      setMsg('请填写 Access Token');
      return;
    }
    upsertConnection({
      platform: activePublishPlatform,
      accessToken: tokenDraft.trim(),
      accountId: accountIdDraft.trim() || undefined,
      connectedAt: Date.now(),
    });
    setTokenDraft('');
    setAccountIdDraft('');
    setShowConnect(false);
    setConnTick((n) => n + 1);
    setMsg(`${SOCIAL_PLATFORM_META.find((p) => p.id === activePublishPlatform)?.label} 已连接`);
  };

  const handleOfficialPublish = async () => {
    if (!active || !activePublishPlatform) {
      setMsg('请先生成 LinkedIn / Instagram / Facebook / X 素材');
      return;
    }
    setBusy(true);
    try {
      const tip = await openOfficialCompose({
        platform: activePublishPlatform,
        caption: active.caption,
        hashtags: active.hashtags,
        cta: active.cta,
        linkUrl: linkUrl.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
      });
      setMsg(tip);
    } finally {
      setBusy(false);
    }
  };

  const handleApiPublish = async () => {
    if (!active || !activePublishPlatform) return;
    setBusy(true);
    setMsg(null);
    try {
      const result = await publishWithToken({
        platform: activePublishPlatform,
        caption: active.caption,
        hashtags: active.hashtags,
        cta: active.cta,
        linkUrl: linkUrl.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
      });
      setMsg(result.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[96rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50/70 via-white to-violet-50/50 p-5 sm:p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 text-fuchsia-700 font-black text-xs uppercase tracking-widest">
          <Share2 size={14} /> Social Studio
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">发文素材加工</h2>
        <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
          按渠道生成文案后，可一键打开 LinkedIn / Instagram / Facebook / X
          官方发帖窗；配置 Access Token 后可在本平台直接发布（账号在各平台官方授权）。
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="text-xs font-black text-slate-700">选择渠道</div>
            <div className="grid grid-cols-2 gap-1.5">
              {SOCIAL_PLATFORM_META.map((p) => {
                const canPub = isPublishablePlatform(p.id);
                const isOn = connections.some((c) => c.platform === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={`rounded-xl border px-2.5 py-2 text-left relative ${
                      platform === p.id
                        ? 'border-fuchsia-500 bg-fuchsia-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-[11px] font-black text-slate-800">{p.label}</div>
                    <div className="text-[9px] text-slate-400 font-bold mt-0.5">{p.size}</div>
                    {canPub && (
                      <span
                        className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                          isOn ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                        title={isOn ? '已连接' : '可发布'}
                      />
                    )}
                  </button>
                );
              })}
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                  <LayoutTemplate size={10} /> 参考图片
                </label>
                <p className="text-[9px] text-slate-400 font-medium mt-0.5 mb-1 leading-snug">
                  最终成稿形态 / 版式风格参考
                </p>
                <input
                  ref={refInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readImageFile(f, 'ref');
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => refInputRef.current?.click()}
                  className="w-full rounded-xl border border-dashed border-slate-300 hover:border-fuchsia-400 bg-slate-50 hover:bg-fuchsia-50/50 min-h-[5.5rem] flex flex-col items-center justify-center gap-1 overflow-hidden"
                >
                  {referenceImage ? (
                    <img src={referenceImage} alt="参考" className="max-h-20 object-contain" />
                  ) : (
                    <>
                      <ImagePlus size={16} className="text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-500">上传参考图</span>
                    </>
                  )}
                </button>
                {referenceImage ? (
                  <button
                    type="button"
                    onClick={() => setReferenceImage('')}
                    className="mt-1 text-[9px] font-bold text-rose-500"
                  >
                    清除参考图
                  </button>
                ) : null}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                  <Package size={10} /> 产品图片
                </label>
                <p className="text-[9px] text-slate-400 font-medium mt-0.5 mb-1 leading-snug">
                  产品实拍 / 主图（与参考图不同）
                </p>
                <input
                  ref={productInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readImageFile(f, 'product');
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => productInputRef.current?.click()}
                  className="w-full rounded-xl border border-dashed border-slate-300 hover:border-fuchsia-400 bg-slate-50 hover:bg-fuchsia-50/50 min-h-[5.5rem] flex flex-col items-center justify-center gap-1 overflow-hidden"
                >
                  {productImage ? (
                    <img src={productImage} alt="产品" className="max-h-20 object-contain" />
                  ) : (
                    <>
                      <ImagePlus size={16} className="text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-500">上传产品图</span>
                    </>
                  )}
                </button>
                {productImage ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProductImage('');
                      setImageUrl('');
                    }}
                    className="mt-1 text-[9px] font-bold text-rose-500"
                  >
                    清除产品图
                  </button>
                ) : null}
              </div>
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
            <p className="m-auto text-sm text-slate-400 font-medium">生成后在此编辑并发布</p>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-slate-800">{active.title}</div>
                  <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {SOCIAL_PLATFORM_META.find((p) => p.id === active.platform)?.label} · {active.size}
                    {activePublishPlatform && connected ? ' · 已连接可直发' : ''}
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 aspect-video max-h-36 flex flex-col items-center justify-center overflow-hidden">
                    {active.referenceImageDataUrl ? (
                      <img
                        src={active.referenceImageDataUrl}
                        alt="参考"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 px-2 text-center">参考形态图</span>
                    )}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 aspect-video max-h-36 flex flex-col items-center justify-center overflow-hidden">
                    {active.productImageDataUrl ? (
                      <img
                        src={active.productImageDataUrl}
                        alt="产品"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 px-2 text-center">
                        {active.imageHint || '产品主图'}
                      </span>
                    )}
                  </div>
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

                {activePublishPlatform && (
                  <div className="rounded-2xl border border-fuchsia-100 bg-fuchsia-50/40 p-3 space-y-2">
                    <div className="text-xs font-black text-fuchsia-900">发布到平台</div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase">
                        附带链接（可选）
                      </label>
                      <input
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="https:// 产品页 / 目录"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                    {activePublishPlatform === 'instagram' && (
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase">
                          公开图片 URL（API 直发必填）
                        </label>
                        <input
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="https://...jpg"
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleOfficialPublish()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black px-3 py-2.5 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="animate-spin" size={14} /> : <ExternalLink size={14} />}
                        打开官方发帖窗
                      </button>
                      <button
                        type="button"
                        disabled={busy || !connected}
                        onClick={() => void handleApiPublish()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-black px-3 py-2.5 disabled:opacity-50"
                        title={connected ? '使用已保存 Token 直发' : '请先连接账号'}
                      >
                        <Send size={14} /> 直接发布
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowConnect((v) => !v);
                          const c = getConnection(activePublishPlatform);
                          setTokenDraft(c?.accessToken || '');
                          setAccountIdDraft(c?.accountId || '');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 text-xs font-black px-3 py-2.5 hover:bg-white"
                      >
                        <Link2 size={14} /> {connected ? '管理连接' : '连接账号'}
                      </button>
                      {connected && (
                        <button
                          type="button"
                          onClick={() => {
                            disconnectPlatform(activePublishPlatform);
                            setConnTick((n) => n + 1);
                            setMsg('已断开连接');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 text-rose-600 text-xs font-black px-3 py-2.5 hover:bg-rose-50"
                        >
                          <Unplug size={14} /> 断开
                        </button>
                      )}
                    </div>
                    {showConnect && (
                      <div className="space-y-2 pt-1 border-t border-fuchsia-100">
                        <p className="text-[10px] text-slate-600 font-medium leading-relaxed">
                          {PLATFORM_CONNECT_HINT[activePublishPlatform]}
                        </p>
                        <input
                          type="password"
                          autoComplete="off"
                          value={tokenDraft}
                          onChange={(e) => setTokenDraft(e.target.value)}
                          placeholder="Access Token"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                        />
                        <input
                          value={accountIdDraft}
                          onChange={(e) => setAccountIdDraft(e.target.value)}
                          placeholder={
                            activePublishPlatform === 'linkedin'
                              ? 'Person ID（必填）'
                              : activePublishPlatform === 'instagram'
                                ? 'IG User ID（必填）'
                                : activePublishPlatform === 'facebook'
                                  ? 'Page ID（发主页时填写，可选）'
                                  : 'Account ID（可选）'
                          }
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                        />
                        <button
                          type="button"
                          onClick={saveConnection}
                          className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black py-2.5"
                        >
                          保存连接
                        </button>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-500 font-medium">
                      支持直发的渠道：{PUBLISH_IDS.map((id) => SOCIAL_PLATFORM_META.find((p) => p.id === id)?.label).join(' · ')}
                      。官方不允许嵌套登录页，Token 请在各平台开发者后台授权后粘贴。
                    </p>
                  </div>
                )}
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
