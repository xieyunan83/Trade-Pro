import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  X,
  Loader2,
  Image as ImageIcon,
  Film,
  Box,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  defaultSiteBuildForm,
  enqueueSiteBuildJob,
  getSiteBuildCapabilityStatus,
  type SiteBuildConfirmForm,
} from '../services/siteBuildPipeline';
import {
  DIRECTION_CHARACTER_OPTS,
  DIRECTION_MOMENT_OPTS,
  DIRECTION_SIGNATURE_OPTS,
  DIRECTION_WORLD_OPTS,
  SITE_VISUAL_PROCESS_OPTS,
  needsDirectionFields,
  type SiteVisualProcessMode,
} from '../services/siteUnslopPass';

type Props = {
  open: boolean;
  onClose: () => void;
  ownerUsername?: string;
  initialBrief?: string;
  initialReferenceUrl?: string;
};

const STYLE_OPTS: Array<{ id: SiteBuildConfirmForm['visualStyle']; label: string; tip: string }> = [
  { id: 'cinematic', label: '电影感大片', tip: '视频背景 + 流畅过渡，适合品牌官网' },
  { id: 'corporate', label: '商务外贸', tip: '信任感强，询盘优先' },
  { id: 'playful', label: '潮玩活泼', tip: '气泡 / 玩具品类更吸睛' },
  { id: 'minimal', label: '极简高端', tip: '留白多、气质稳' },
  { id: 'tech', label: '科技深色', tip: '深色界面、现代动效' },
];

export const SiteOneClickForm: React.FC<Props> = ({
  open,
  onClose,
  ownerUsername,
  initialBrief,
  initialReferenceUrl,
}) => {
  const cap = useMemo(() => (open ? getSiteBuildCapabilityStatus() : null), [open]);
  const [form, setForm] = useState<SiteBuildConfirmForm>(() =>
    defaultSiteBuildForm({
      brief: initialBrief || '',
      referenceUrl: initialReferenceUrl || '',
      ownerUsername,
    })
  );
  const [submitting, setSubmitting] = useState(false);
  const [queuedHint, setQueuedHint] = useState('');
  const [shakeHint, setShakeHint] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(
      defaultSiteBuildForm({
        brief: initialBrief || '',
        referenceUrl: initialReferenceUrl || '',
        ownerUsername,
      })
    );
    setSubmitting(false);
    setQueuedHint('');
    setShakeHint('');
  }, [open, initialBrief, initialReferenceUrl, ownerUsername]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !cap) return null;

  const patch = <K extends keyof SiteBuildConfirmForm>(key: K, value: SiteBuildConfirmForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setShakeHint('');
  };

  const missingBrand = !form.brandName.trim();
  const missingBrief = !form.brief.trim() && !form.tagline.trim();
  const canSubmit = !missingBrand && !missingBrief && cap.llm && !submitting;

  const submitBlockReason = !cap.llm
    ? '写站服务未就绪，请联系管理员开通'
    : missingBrand
      ? '请先填写品牌 / 公司名'
      : missingBrief
        ? '请填写一句话定位或详细需求'
        : submitting
          ? '正在提交…'
          : '';

  const submit = () => {
    if (!canSubmit) {
      setShakeHint(submitBlockReason);
      return;
    }
    setSubmitting(true);
    try {
      const job = enqueueSiteBuildJob({ ...form, ownerUsername });
      setQueuedHint(
        `任务已提交（${job.id.slice(-6)}）。正在后台执行，请保持本客户端打开，可继续浏览其它模块。`
      );
      window.setTimeout(() => {
        setSubmitting(false);
        onClose();
        setQueuedHint('');
      }, 900);
    } catch (e: any) {
      setSubmitting(false);
      window.alert(e?.message || String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-sm p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="site-oneclick-title"
    >
      {/* 仅点遮罩空白处关闭；卡片内点击不冒泡 */}
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭表单"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-2xl max-h-[min(92vh,880px)] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-white">
          <div className="flex items-start gap-2 min-w-0">
            <div className="mt-0.5 rounded-xl bg-teal-50 text-teal-700 p-2">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <div id="site-oneclick-title" className="text-sm font-extrabold text-slate-900">
                一键建站 · 确认表单
              </div>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                确认后后台生成图片、视频
                {cap.model3d ? '、3D' : ''}
                并汇集成站。按 Esc 或点「取消」可关闭。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 shrink-0"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
          <div
            className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${
              cap.llm
                ? 'border-teal-100 bg-teal-50/80 text-teal-800'
                : 'border-rose-100 bg-rose-50 text-rose-700'
            }`}
          >
            {cap.detail}
            {!cap.llm ? ' — 请先开通写站服务' : null}
          </div>

          <section className="space-y-3">
            <h3 className="text-xs font-black text-slate-800">基础信息</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">品牌 / 公司名 *</span>
                <input
                  autoFocus
                  value={form.brandName}
                  onChange={(e) => patch('brandName', e.target.value)}
                  placeholder="例如：中创云海"
                  className={`w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none focus:border-teal-400 ${
                    missingBrand && shakeHint ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200'
                  }`}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">一句话定位</span>
                <input
                  value={form.tagline}
                  onChange={(e) => patch('tagline', e.target.value)}
                  placeholder="例如：澄海源头工厂 · 欧美合规玩具"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-slate-500">详细需求 *</span>
              <textarea
                value={form.brief}
                onChange={(e) => patch('brief', e.target.value)}
                rows={3}
                placeholder="描述官网用途、目标买家、要强调的卖点、语言偏好…"
                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal-400 resize-y min-h-[5rem] ${
                  missingBrief && shakeHint ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200'
                }`}
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">行业 / 品类</span>
                <input
                  value={form.industry}
                  onChange={(e) => patch('industry', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">参考站 URL（可选）</span>
                <input
                  value={form.referenceUrl || ''}
                  onChange={(e) => patch('referenceUrl', e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-slate-500">产品清单（每行一个，可选）</span>
              <textarea
                value={form.productsText}
                onChange={(e) => patch('productsText', e.target.value)}
                rows={2}
                placeholder={'泡泡枪套装\n软弹射击玩具\n发光飞盘'}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 resize-y"
              />
            </label>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">页面语言</span>
                <select
                  value={form.locale}
                  onChange={(e) => patch('locale', e.target.value as SiteBuildConfirmForm['locale'])}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                >
                  <option value="auto">自动判断</option>
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">询盘邮箱</span>
                <input
                  value={form.contactEmail || ''}
                  onChange={(e) => patch('contactEmail', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500">WhatsApp</span>
                <input
                  value={form.contactWhatsapp || ''}
                  onChange={(e) => patch('contactWhatsapp', e.target.value)}
                  placeholder="+86…"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                />
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-black text-slate-800">视觉处理（任选其一）</h3>
            <p className="text-[10px] text-slate-500 leading-snug">
              默认「先出站再专业润色」。需要一次定调可选「先定风格」；赶时间选「快速出站」。
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {SITE_VISUAL_PROCESS_OPTS.map((opt) => {
                const active = (form.visualProcessMode || 'polish') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => patch('visualProcessMode', opt.id as SiteVisualProcessMode)}
                    className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
                      active
                        ? 'border-teal-500 ring-2 ring-teal-100 bg-teal-50/50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="text-xs font-black text-slate-900">{opt.label}</div>
                      {opt.badge ? (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-teal-600 text-white">
                          {opt.badge}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{opt.tip}</p>
                  </button>
                );
              })}
            </div>

            {needsDirectionFields(form.visualProcessMode || 'polish') ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 space-y-3">
                <div className="text-[11px] font-black text-slate-700">高级 · 视觉方向（点选即可）</div>
                <ChipGroup
                  label="性格"
                  value={form.directionCharacter || ''}
                  options={[...DIRECTION_CHARACTER_OPTS]}
                  onChange={(v) => patch('directionCharacter', v)}
                />
                <ChipGroup
                  label="场景世界"
                  value={form.directionWorld || ''}
                  options={[...DIRECTION_WORLD_OPTS]}
                  onChange={(v) => patch('directionWorld', v)}
                />
                <ChipGroup
                  label="视觉高潮"
                  value={form.directionMoment || ''}
                  options={[...DIRECTION_MOMENT_OPTS]}
                  onChange={(v) => patch('directionMoment', v)}
                />
                <ChipGroup
                  label="签名细节"
                  value={form.directionSignature || ''}
                  options={[...DIRECTION_SIGNATURE_OPTS]}
                  onChange={(v) => patch('directionSignature', v)}
                />
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-black text-slate-800">版式气质</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {STYLE_OPTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => patch('visualStyle', s.id)}
                  className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
                    form.visualStyle === s.id
                      ? 'border-teal-500 ring-2 ring-teal-100 bg-teal-50/50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-black text-slate-900">{s.label}</div>
                  <p className="text-[10px] text-slate-500 mt-0.5">{s.tip}</p>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
              主色
              <input
                type="color"
                value={form.primaryColor || '#0f766e'}
                onChange={(e) => patch('primaryColor', e.target.value)}
                className="h-8 w-10 rounded border border-slate-200 cursor-pointer"
              />
              <span className="font-mono text-slate-400">{form.primaryColor}</span>
            </label>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-black text-slate-800">自动生成素材</h3>
            <p className="text-[10px] text-slate-500">
              勾选后由平台在后台调用对应生成能力；未开通的能力会在提交时拦截。
            </p>
            <div className="space-y-2">
              <ToggleRow
                icon={<ImageIcon size={14} />}
                label="首屏主视觉图"
                checked={form.wantHeroImage}
                disabled={!cap.image}
                onChange={(v) => patch('wantHeroImage', v)}
              />
              <div className="rounded-xl border border-slate-200 px-3 py-2 space-y-2">
                <ToggleRow
                  icon={<ImageIcon size={14} />}
                  label="产品展示图"
                  checked={form.wantProductImages}
                  disabled={!cap.image}
                  onChange={(v) => patch('wantProductImages', v)}
                  bare
                />
                {form.wantProductImages ? (
                  <label className="flex items-center gap-2 text-[11px] text-slate-600 pl-6">
                    数量
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={form.productImageCount}
                      onChange={(e) =>
                        patch('productImageCount', Math.min(6, Math.max(1, Number(e.target.value) || 1)))
                      }
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    />
                  </label>
                ) : null}
              </div>
              <ToggleRow
                icon={<Film size={14} />}
                label="背景氛围视频"
                tip="类似品牌站首屏循环视频"
                checked={form.wantBgVideo}
                disabled={!cap.video}
                onChange={(v) => patch('wantBgVideo', v)}
              />
              <ToggleRow
                icon={<Film size={14} />}
                label="区块过渡视频"
                tip="产品区与优势区之间的短过渡"
                checked={form.wantTransitionVideo}
                disabled={!cap.video}
                onChange={(v) => patch('wantTransitionVideo', v)}
              />
              <ToggleRow
                icon={<Box size={14} />}
                label="产品 3D 模型"
                tip="可选；耗时更长"
                checked={form.wantModel3d}
                disabled={!cap.model3d}
                onChange={(v) => patch('wantModel3d', v)}
              />
            </div>
          </section>

          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 flex gap-2 text-[11px] text-amber-900">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
            <div>
              <div className="font-black">后台执行提醒</div>
              <p className="mt-0.5 leading-snug">
                提交后任务在本客户端后台运行（含视频时可能数分钟）。请勿关闭或刷新页面；可切换到其它模块，左下角查看进度。
              </p>
            </div>
          </div>

          {queuedHint ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={14} />
              {queuedHint}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 space-y-2">
          {shakeHint || submitBlockReason ? (
            <p className="text-[11px] font-bold text-amber-700 text-right">
              {shakeHint || (canSubmit ? '' : submitBlockReason)}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              className={`inline-flex items-center gap-1.5 rounded-xl text-white text-xs font-black px-4 py-2.5 ${
                canSubmit
                  ? 'bg-teal-600 hover:bg-teal-500'
                  : 'bg-slate-400 cursor-not-allowed'
              }`}
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {submitting ? '已提交后台…' : '确认并开始生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ChipGroup: React.FC<{
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="space-y-1.5">
    <div className="text-[10px] font-bold text-slate-500">{label}</div>
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-lg px-2.5 py-1 text-[10px] font-bold border transition-colors ${
              on
                ? 'border-teal-500 bg-teal-50 text-teal-900'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  </div>
);

const ToggleRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  tip?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  bare?: boolean;
}> = ({ icon, label, tip, checked, disabled, onChange, bare }) => {
  const inner = (
    <label
      className={`flex items-start gap-2 cursor-pointer ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
    >
      <input
        type="checkbox"
        className="mt-1 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-teal-700 mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="text-xs font-black text-slate-800 block">{label}</span>
        {tip ? <span className="text-[10px] text-slate-500">{tip}</span> : null}
        {disabled ? (
          <span className="block text-[10px] text-rose-500 font-bold">服务未就绪</span>
        ) : null}
      </span>
    </label>
  );
  if (bare) return inner;
  return <div className="rounded-xl border border-slate-200 px-3 py-2">{inner}</div>;
};
