import React, { useEffect, useRef, useState } from 'react';
import { resolveMediaUrl } from '../services/creativeAssetVault';

type ImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string;
  /** 进入视口再解析 vault / 解码，避免画布一次拖几十张大图卡死 */
  lazyResolve?: boolean;
};

/** 自动把 vault: / 临时链解析为可显示地址 */
export const VaultImg: React.FC<ImgProps> = ({
  src,
  alt = '',
  lazyResolve = true,
  className = '',
  ...rest
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(!lazyResolve);
  const [resolved, setResolved] = useState(() => {
    const u = src || '';
    if (!u || u.startsWith('vault:')) return '';
    return u;
  });

  useEffect(() => {
    if (!lazyResolve) {
      setInView(true);
      return;
    }
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '160px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazyResolve, src]);

  useEffect(() => {
    let cancelled = false;
    const u = src || '';
    if (!u) {
      setResolved('');
      return;
    }
    if (!inView) return;
    if (!u.startsWith('vault:') && !u.startsWith('blob:')) {
      setResolved(u);
      return;
    }
    setResolved('');
    void resolveMediaUrl(u).then((r) => {
      if (!cancelled) setResolved(r && !r.startsWith('vault:') ? r : '');
    });
    return () => {
      cancelled = true;
    };
  }, [src, inView]);

  if (!src) {
    return (
      <div
        className={`bg-slate-100 flex items-center justify-center text-[10px] text-slate-400 font-bold ${className}`}
      >
        无图
      </div>
    );
  }

  if (!resolved) {
    return (
      <div
        ref={hostRef}
        className={`bg-slate-100/80 animate-pulse ${className}`}
        aria-hidden
      />
    );
  }

  return (
    <div ref={hostRef} className={className || undefined}>
      <img
        src={resolved}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain"
        {...rest}
      />
    </div>
  );
};

type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement> & {
  src?: string;
};

export const VaultVideo: React.FC<VideoProps> = ({ src, ...rest }) => {
  const [resolved, setResolved] = useState('');
  useEffect(() => {
    let cancelled = false;
    const u = src || '';
    if (!u) {
      setResolved('');
      return;
    }
    void resolveMediaUrl(u).then((r) => {
      if (!cancelled) setResolved(r && !r.startsWith('vault:') ? r : '');
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (!resolved) return null;
  return <video src={resolved} preload="metadata" {...rest} />;
};

/** 给 model-viewer / 下载链接用；vault: 会解成 blob:，不会把 vault: 塞进 <a href> */
export const useVaultUrl = (src?: string): string => {
  const [resolved, setResolved] = useState(() => {
    const u = (src || '').trim();
    if (!u || u.startsWith('vault:')) return '';
    return u;
  });
  useEffect(() => {
    let cancelled = false;
    const u = (src || '').trim();
    if (!u) {
      setResolved('');
      return;
    }
    if (u.startsWith('vault:')) setResolved('');
    void resolveMediaUrl(u).then((r) => {
      if (cancelled) return;
      setResolved(r && !r.startsWith('vault:') ? r : '');
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  return resolved;
};
