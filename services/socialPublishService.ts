/**
 * 发文素材 · 四平台发布：
 * 1) 官方发帖窗（复制文案 + 打开平台，无需开发者应用即可用）
 * 2) Access Token 直发（需在各平台开发者后台授权，经同域代理绕过 CORS）
 *
 * 说明：Instagram 个人 Feed 无网页发帖 Intent；API 发帖需商务账号 + 公开图片 URL。
 */
import { isLocalDevHost } from './qwenProxy';
import type { SocialPlatform } from './creativeStudioStore';

export type PublishablePlatform = 'linkedin' | 'instagram' | 'facebook' | 'x';

export type SocialConnection = {
  platform: PublishablePlatform;
  /** OAuth / 长期 User 或 Page Access Token */
  accessToken: string;
  /** LinkedIn person URN 数字部分，或 Facebook Page ID / IG User ID */
  accountId?: string;
  accountName?: string;
  connectedAt: number;
};

export type SocialPublishPayload = {
  platform: PublishablePlatform;
  caption: string;
  hashtags: string[];
  cta?: string;
  /** 可选外链（Facebook / LinkedIn 分享用） */
  linkUrl?: string;
  /** 公开可访问的图片 URL（Instagram API 必需） */
  imageUrl?: string;
};

const LS = 'trade_scout_social_connections_v1';

const PUBLISH_PLATFORMS: PublishablePlatform[] = ['linkedin', 'instagram', 'facebook', 'x'];

export const isPublishablePlatform = (p: SocialPlatform): p is PublishablePlatform =>
  PUBLISH_PLATFORMS.includes(p as PublishablePlatform);

export const loadSocialConnections = (): SocialConnection[] => {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export const saveSocialConnections = (rows: SocialConnection[]) => {
  localStorage.setItem(LS, JSON.stringify(rows));
};

export const getConnection = (platform: PublishablePlatform): SocialConnection | undefined =>
  loadSocialConnections().find((c) => c.platform === platform && !!(c.accessToken || '').trim());

export const upsertConnection = (conn: SocialConnection) => {
  const prev = loadSocialConnections().filter((c) => c.platform !== conn.platform);
  saveSocialConnections([{ ...conn, accessToken: conn.accessToken.trim() }, ...prev]);
};

export const disconnectPlatform = (platform: PublishablePlatform) => {
  saveSocialConnections(loadSocialConnections().filter((c) => c.platform !== platform));
};

export const buildPostText = (p: SocialPublishPayload): string => {
  const tags = (p.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  return [p.caption.trim(), tags, (p.cta || '').trim()].filter(Boolean).join('\n\n');
};

/** 打开官方发帖/分享页，并复制全文到剪贴板 */
export const openOfficialCompose = async (payload: SocialPublishPayload): Promise<string> => {
  const text = buildPostText(payload);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }

  const encoded = encodeURIComponent(text.slice(0, 1400));
  const link = (payload.linkUrl || '').trim() || 'https://www.linkedin.com/';

  let url = '';
  switch (payload.platform) {
    case 'x':
      url = `https://twitter.com/intent/tweet?text=${encoded}`;
      break;
    case 'facebook':
      url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encoded}`;
      break;
    case 'linkedin':
      url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
      break;
    case 'instagram':
      url = 'https://www.instagram.com/';
      break;
    default:
      break;
  }
  if (url) window.open(url, '_blank', 'noopener,noreferrer');

  if (payload.platform === 'instagram') {
    return '文案已复制。Instagram 网页端不支持预填发帖，请在 App/网页粘贴发布。';
  }
  if (payload.platform === 'linkedin') {
    return '文案已复制并打开 LinkedIn 分享页。可将链接换成产品页；正文请粘贴剪贴板内容。';
  }
  return '已打开官方发帖窗，文案已复制到剪贴板。';
};

const socialProxyUrl = (origin: string, path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (isLocalDevHost()) {
    if (/linkedin\.com/i.test(origin)) return `/linkedin-api${p}`;
    if (/facebook\.com|instagram\.com/i.test(origin)) return `/meta-api${p}`;
    if (/twitter\.com|x\.com/i.test(origin)) return `/x-api${p}`;
  }
  return `/api/social?__origin=${encodeURIComponent(origin)}&__upstream=${encodeURIComponent(p)}`;
};

const parseJson = async (res: Response) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`发布接口返回非 JSON（HTTP ${res.status}）：${text.slice(0, 180)}`);
  }
};

/** LinkedIn：文本帖（需 w_member_social + person id） */
const publishLinkedIn = async (token: string, personId: string, text: string) => {
  const author = personId.startsWith('urn:') ? personId : `urn:li:person:${personId}`;
  const url = socialProxyUrl('https://api.linkedin.com', '/v2/ugcPosts');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    throw new Error(json.message || json.error_description || `LinkedIn 发布失败 HTTP ${res.status}`);
  }
  return '已发布到 LinkedIn';
};

/** Facebook：个人或主页 feed */
const publishFacebook = async (token: string, pageOrMe: string | undefined, text: string, link?: string) => {
  const target = (pageOrMe || 'me').trim() || 'me';
  const qs = new URLSearchParams({ message: text, access_token: token });
  if (link) qs.set('link', link);
  const path = `/v19.0/${encodeURIComponent(target)}/feed?${qs.toString()}`;
  const url = socialProxyUrl('https://graph.facebook.com', path);
  const res = await fetch(url, { method: 'POST' });
  const json = await parseJson(res);
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Facebook 发布失败 HTTP ${res.status}`);
  }
  return '已发布到 Facebook';
};

/** X / Twitter API v2 */
const publishX = async (token: string, text: string) => {
  const url = socialProxyUrl('https://api.x.com', '/2/tweets');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: text.slice(0, 280) }),
  });
  const json = await parseJson(res);
  if (!res.ok || json.errors) {
    throw new Error(
      json.detail || json.title || json.errors?.[0]?.message || `X 发布失败 HTTP ${res.status}`
    );
  }
  return '已发布到 X';
};

/**
 * Instagram Content Publishing（需 IG 商务账号 User ID + 公开图 URL）
 * 两步：创建 container → 发布
 */
const publishInstagram = async (
  token: string,
  igUserId: string,
  caption: string,
  imageUrl: string
) => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    throw new Error('Instagram API 发帖需要公开可访问的图片链接（http/https）。可先用官方发帖窗粘贴文案。');
  }
  const createQs = new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: token,
  });
  const createUrl = socialProxyUrl(
    'https://graph.facebook.com',
    `/v19.0/${encodeURIComponent(igUserId)}/media?${createQs.toString()}`
  );
  const createRes = await fetch(createUrl, { method: 'POST' });
  const created = await parseJson(createRes);
  if (!createRes.ok || created.error || !created.id) {
    throw new Error(created.error?.message || `Instagram 创建媒体失败 HTTP ${createRes.status}`);
  }
  const pubQs = new URLSearchParams({
    creation_id: String(created.id),
    access_token: token,
  });
  const pubUrl = socialProxyUrl(
    'https://graph.facebook.com',
    `/v19.0/${encodeURIComponent(igUserId)}/media_publish?${pubQs.toString()}`
  );
  const pubRes = await fetch(pubUrl, { method: 'POST' });
  const published = await parseJson(pubRes);
  if (!pubRes.ok || published.error) {
    throw new Error(published.error?.message || `Instagram 发布失败 HTTP ${pubRes.status}`);
  }
  return '已发布到 Instagram';
};

export type PublishResult = { ok: true; message: string } | { ok: false; message: string };

/** 已连接 Token 时 API 直发；否则请用 openOfficialCompose */
export const publishWithToken = async (payload: SocialPublishPayload): Promise<PublishResult> => {
  const conn = getConnection(payload.platform);
  if (!conn?.accessToken) {
    return { ok: false, message: '尚未连接该平台。请先保存 Access Token，或使用「打开官方发帖窗」。' };
  }
  const text = buildPostText(payload);
  try {
    let message = '';
    if (payload.platform === 'linkedin') {
      if (!conn.accountId?.trim()) {
        return {
          ok: false,
          message: 'LinkedIn 需填写 Person ID（开发者 Token 工具或 /v2/userinfo 返回的 sub）。',
        };
      }
      message = await publishLinkedIn(conn.accessToken, conn.accountId.trim(), text);
    } else if (payload.platform === 'facebook') {
      message = await publishFacebook(
        conn.accessToken,
        conn.accountId,
        text,
        payload.linkUrl
      );
    } else if (payload.platform === 'x') {
      message = await publishX(conn.accessToken, text);
    } else if (payload.platform === 'instagram') {
      if (!conn.accountId?.trim()) {
        return { ok: false, message: 'Instagram 需填写 IG 用户 ID（商务账号）。' };
      }
      message = await publishInstagram(
        conn.accessToken,
        conn.accountId.trim(),
        text,
        payload.imageUrl || ''
      );
    }
    return { ok: true, message };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
};

export const PLATFORM_CONNECT_HINT: Record<PublishablePlatform, string> = {
  linkedin:
    '开发者后台创建应用并开通 Share on LinkedIn，用 Token 生成器拿 User Token（含 w_member_social），填写 Person ID。',
  facebook:
    'Meta 开发者应用 → 获取 User/Page Token（pages_manage_posts）。发主页时 Account ID 填 Page ID。',
  instagram:
    '需 Instagram 专业账号并绑定 Facebook 主页；Token 与 IG User ID 来自 Graph API。发帖还需公开图片 URL。',
  x: 'X 开发者门户申请 User Access Token（tweet.write）。免费档有额度限制。',
};
