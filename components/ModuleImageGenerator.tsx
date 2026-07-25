import React, { useState } from 'react';
import { Image, Loader2, Download, Sparkles, AlertTriangle } from 'lucide-react';
import { generateWanImage } from '../services/wanImageService';

export const ModuleImageGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<'1K' | '2K' | '4K'>('2K');
  const [count, setCount] = useState(1);
  const [thinkingMode, setThinkingMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await generateWanImage({
        prompt: prompt.trim(),
        size,
        n: count,
        thinkingMode,
        watermark: false,
      });
      setImages(result.images);
    } catch (e: any) {
      setError(e?.message || '生成失败');
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (url: string, idx: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wan-image-${idx + 1}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-2 flex items-center gap-2">
          <Image className="text-pink-600 flex-shrink-0" /> AI 图片生成
        </h2>
        <p className="text-sm text-slate-500 font-medium mb-4 sm:mb-6">
          使用阿里云万相 <span className="font-bold text-slate-700">wan2.7-image</span>，适合产品图、场景图、营销视觉等。
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">提示词 Prompt</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-pink-500 font-bold text-sm sm:text-base resize-y"
              placeholder="例如：高清产品棚拍，硅胶婴儿围兜，白色背景，柔光，电商主图风格"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">分辨率</label>
              <select
                value={size}
                onChange={e => setSize(e.target.value as '1K' | '2K' | '4K')}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold appearance-none bg-white"
              >
                <option value="1K">1K（更快）</option>
                <option value="2K">2K（推荐）</option>
                <option value="4K">4K（需 Pro 模型）</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">生成数量</label>
              <select
                value={count}
                onChange={e => setCount(Number(e.target.value))}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold appearance-none bg-white"
              >
                {[1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>{n} 张</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 font-bold text-sm text-slate-700 pb-3">
                <input
                  type="checkbox"
                  checked={thinkingMode}
                  onChange={e => setThinkingMode(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                />
                思考模式（质量更高，更慢）
              </label>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full bg-pink-600 hover:bg-pink-700 text-white py-3 sm:py-4 rounded-xl font-black shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
            {loading ? '生成中，请稍候…' : '开始生成'}
          </button>

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-sm font-bold text-red-600 flex items-start gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {images.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-base sm:text-lg font-black text-slate-800">生成结果 ({images.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {images.map((url, idx) => (
              <div key={idx} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <img src={url} alt={`generated-${idx}`} className="w-full aspect-square object-contain bg-slate-50" />
                <div className="p-3 flex justify-end">
                  <button
                    onClick={() => handleDownload(url, idx)}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-pink-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors touch-manipulation"
                  >
                    <Download size={16} /> 下载
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
