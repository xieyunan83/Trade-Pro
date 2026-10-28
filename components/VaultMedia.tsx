import React, { useEffect, useState } from 'react';
import { resolveMediaUrl } from '../services/creativeAssetVault';

type ImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string;
};

/** 自动把 vault: / 临时链解析为可显示地址 */
export const VaultImg: React.FC<ImgProps> = ({ src, alt = '', ...rest }) => {
  const [resolved, setResolved] = useState(src || '');
  useEffect(() => {
    let cancelled = false;
    const u = src || '';
    if (!u) {
      setResolved('');
      return;
    }
    void resolveMediaUrl(u).then((r) => {
      if (!cancelled) setResolved(r || u);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (!resolved) {
    return (
      <div
        className={`bg-slate-100 flex items-center justify-center text-[10px] text-slate-400 font-bold ${rest.className || ''}`}
      >
        无图
      </div>
    );
  }
  return <img src={resolved} alt={alt} {...rest} />;
};

type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement> & {
  src?: string;
};

export const VaultVideo: React.FC<VideoProps> = ({ src, ...rest }) => {
  const [resolved, setResolved] = useState(src || '');
  useEffect(() => {
    let cancelled = false;
    const u = src || '';
    if (!u) {
      setResolved('');
      return;
    }
    void resolveMediaUrl(u).then((r) => {
      if (!cancelled) setResolved(r || u);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (!resolved) return null;
  return <video src={resolved} {...rest} />;
};

/** 给 model-viewer / 下载链接用 */
export const useVaultUrl = (src?: string): string => {
  const [resolved, setResolved] = useState(src || '');
  useEffect(() => {
    let cancelled = false;
    const u = src || '';
    if (!u) {
      setResolved('');
      return;
    }
    void resolveMediaUrl(u).then((r) => {
      if (!cancelled) setResolved(r || u);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  return resolved;
};
