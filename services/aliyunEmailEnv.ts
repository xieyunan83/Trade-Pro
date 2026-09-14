/**
 * 从 .env / Vite define 读取阿里云邮件推送配置（本地自动接入，无需手填）
 */
import type { AliyunConfig } from '../types';

const read = (...keys: string[]): string => {
  for (const k of keys) {
    try {
      const v = String((process.env as any)?.[k] || '').trim();
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return '';
};

/** 环境变量中的 DirectMail 配置（可能为空） */
export const getAliyunEmailConfigFromEnv = (): Partial<AliyunConfig> | null => {
  const accessKeyId = read(
    'REACT_APP_ALIYUN_EMAIL_ACCESS_KEY_ID',
    'ALIYUN_DM_ACCESS_KEY_ID',
    'REACT_APP_ALIYUN_DM_ACCESS_KEY_ID'
  );
  const accessKeySecret = read(
    'REACT_APP_ALIYUN_EMAIL_ACCESS_KEY_SECRET',
    'ALIYUN_DM_ACCESS_KEY_SECRET',
    'REACT_APP_ALIYUN_DM_ACCESS_KEY_SECRET'
  );
  const accountName = read(
    'REACT_APP_ALIYUN_EMAIL_FROM',
    'ALIYUN_DM_ACCOUNT_NAME',
    'REACT_APP_ALIYUN_DM_ACCOUNT_NAME'
  );
  if (!accessKeyId && !accessKeySecret && !accountName) return null;
  return {
    accessKeyId,
    accessKeySecret,
    accountName,
    fromAlias: read('REACT_APP_ALIYUN_EMAIL_FROM_ALIAS', 'ALIYUN_DM_FROM_ALIAS') || '',
    replyToAddress: false,
    addressType: 1,
    tagName: read('REACT_APP_ALIYUN_EMAIL_TAG', 'ALIYUN_DM_TAG') || 'trade-pro',
    regionId: read('REACT_APP_ALIYUN_EMAIL_REGION', 'ALIYUN_DM_REGION') || 'cn-hangzhou',
  };
};

export const mergeAliyunConfigWithEnv = (saved: AliyunConfig | null): AliyunConfig | null => {
  const fromEnv = getAliyunEmailConfigFromEnv();
  if (!fromEnv && !saved) return null;
  const merged: AliyunConfig = {
    accessKeyId: saved?.accessKeyId || fromEnv?.accessKeyId || '',
    accessKeySecret: saved?.accessKeySecret || fromEnv?.accessKeySecret || '',
    accountName: saved?.accountName || fromEnv?.accountName || '',
    fromAlias: saved?.fromAlias || fromEnv?.fromAlias || '',
    replyToAddress: saved?.replyToAddress ?? fromEnv?.replyToAddress ?? false,
    addressType: saved?.addressType ?? fromEnv?.addressType ?? 1,
    tagName: saved?.tagName || fromEnv?.tagName || '',
    regionId: saved?.regionId || fromEnv?.regionId || 'cn-hangzhou',
  };
  if (!merged.accessKeyId && !merged.accessKeySecret && !merged.accountName) return null;
  return merged;
};
