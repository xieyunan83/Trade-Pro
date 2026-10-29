/**
 * 建站技术选型 + 部署目标目录（含利弊说明）
 * 部署选项覆盖：本机、国内云、以及本平台常见上线链路（GitHub / Vercel / Supabase 等）
 */

export type StackOption = {
  id: string;
  label: string;
  blurb: string;
  pros: string[];
  cons: string[];
  bestFor: string;
};

export type DeployOption = StackOption & {
  region: 'local' | 'cn' | 'global';
  /** 推送上线分步指引 */
  steps: string[];
  /** 是否适合纯静态 HTML 导出 */
  staticFriendly: boolean;
};

export const FRONTEND_OPTIONS: StackOption[] = [
  {
    id: 'static_html',
    label: '静态 HTML / CSS',
    blurb: '单页或少量页面，导出即可上线，本工作室默认产出。',
    pros: ['零构建、上手快', '任意主机都能挂', '成本低、便于展会临时页'],
    cons: ['复杂交互与多角色后台需另接', '大型站点后期维护成本上升'],
    bestFor: '货源展厅、询盘落地页、品牌一页通',
  },
  {
    id: 'react_vite',
    label: 'React + Vite',
    blurb: '组件化前端，适合后续扩展产品筛选、多语言路由。',
    pros: ['生态成熟、易招人维护', '可逐步加复杂交互', '与现代部署平台契合'],
    cons: ['需要构建流水线', '比纯 HTML 学习成本高'],
    bestFor: '要迭代成正式品牌站 / 选品目录站',
  },
  {
    id: 'next_ssr',
    label: 'Next.js（SSR / SSG）',
    blurb: '兼顾 SEO 与动态能力，适合内容与产品页较多的站点。',
    pros: ['SEO 友好', '可同仓做接口路由', '国际部署体验好'],
    cons: ['运维与构建更重', '国内托管需注意合规与节点'],
    bestFor: '内容站 + 产品库 + 博客合一',
  },
];

export const BACKEND_OPTIONS: StackOption[] = [
  {
    id: 'none_static',
    label: '无后台（纯静态）',
    blurb: '表单可用第三方或 mailto；最快上线。',
    pros: ['最简单、最稳', '几乎无服务器费用', '安全面小'],
    cons: ['无法自建会员/库存同步', '复杂业务需另接服务'],
    bestFor: '展示 + 询盘引流',
  },
  {
    id: 'serverless_fn',
    label: 'Serverless 函数',
    blurb: '按需接口（表单、报价通知），挂在 Vercel / 云函数等。',
    pros: ['按量计费', '与前端同仓部署方便', '扩展询盘 webhook 容易'],
    cons: ['冷启动与调试门槛', '国内云函数配置略繁'],
    bestFor: '要接表单通知 / 轻量 API',
  },
  {
    id: 'node_api',
    label: '自建 Node / Java API',
    blurb: '本地或云主机常驻服务，适合对接 ERP / CRM。',
    pros: ['掌控力强', '易对接内网系统', '适合长期正式站'],
    cons: ['要自己管服务器与安全', '成本与人力更高'],
    bestFor: '工厂信息化、要连内部系统',
  },
];

export const DATABASE_OPTIONS: StackOption[] = [
  {
    id: 'none',
    label: '暂不需要数据库',
    blurb: '内容写在页面里或本地配置即可。',
    pros: ['零运维', '不会因库挂站'],
    cons: ['动态内容难管理', '多语言/SKU 多时吃力'],
    bestFor: '一页通、展会页',
  },
  {
    id: 'supabase_pg',
    label: 'Supabase（Postgres）',
    blurb: '本平台数据层同类方案：托管 Postgres + 鉴权 + 存储。',
    pros: ['开箱鉴权与表结构', '前后端协作快', '有实时能力'],
    cons: ['海外节点访问国内偶发慢', '免费额度有限', '需遵守数据合规'],
    bestFor: '要登录、询盘落库、轻量后台',
  },
  {
    id: 'cn_rds',
    label: '国内云数据库（RDS / TDSQL 等）',
    blurb: '阿里云 / 腾讯云 / 华为云托管库，数据留在国内。',
    pros: ['国内延迟低', '合规与备案路径清晰', '企业采购方便'],
    cons: ['要自行建模与备份策略', '费用按规格计'],
    bestFor: '正式外贸站 + 国内主体备案',
  },
  {
    id: 'sqlite_local',
    label: '本机 SQLite / 文件库',
    blurb: '本地服务器小站或内网展示用。',
    pros: ['零外部依赖', '备份就是拷文件'],
    cons: ['不适合高并发公网', '多机同步难'],
    bestFor: '展厅本机演示、内网资料站',
  },
];

export const DEPLOY_OPTIONS: DeployOption[] = [
  {
    id: 'local_server',
    label: '本地 / 自有服务器',
    region: 'local',
    blurb: '用本机、公司机房或已有虚拟主机直接挂载。',
    pros: ['数据完全自控', '可内网演示', '无平台锁定'],
    cons: ['要自己管域名证书与备份', '公网暴露需安全加固'],
    bestFor: '已有 IT / 展会本机演示',
    staticFriendly: true,
    steps: [
      '点击「推送上线」导出 index.html（已自动本机双备份）。',
      '将文件放到网站根目录（Nginx/IIS/Apache 或面板「网站目录」）。',
      '配置域名解析与 HTTPS（可用面板一键证书）。',
      '用手机与电脑各打开一次确认预览一致。',
    ],
  },
  {
    id: 'aliyun_oss',
    label: '阿里云 OSS 静态网站',
    region: 'cn',
    blurb: '对象存储开启静态托管，国内访问快，适合备案域名。',
    pros: ['国内延迟低', '费用可控', '可绑 CDN'],
    cons: ['需实名与常要备案', '控制台步骤略多'],
    bestFor: '国内公司主体正式站',
    staticFriendly: true,
    steps: [
      '导出 index.html，上传到 Bucket 根目录。',
      '开启「静态网站」：默认首页 index.html。',
      '绑定自定义域名，按指引完成备案（若要求）。',
      '开启 HTTPS / CDN，完成推送验收。',
    ],
  },
  {
    id: 'tencent_cos',
    label: '腾讯云 COS / 静态网站',
    region: 'cn',
    blurb: '与阿里云类似的对象存储静态托管路径。',
    pros: ['国内网络友好', '可接 EdgeOne', '企业账号体系成熟'],
    cons: ['同样涉及实名/备案', '控制台概念需适应'],
    bestFor: '已有腾讯云账号的团队',
    staticFriendly: true,
    steps: [
      '创建存储桶并上传 index.html。',
      '开启静态网站配置。',
      '绑定域名与 HTTPS。',
      '可选接入 EdgeOne 加速海外买家访问。',
    ],
  },
  {
    id: 'huawei_obs',
    label: '华为云 OBS 静态网站',
    region: 'cn',
    blurb: '华为云对象存储静态托管，适合已采购华为云的企业。',
    pros: ['国产化采购路径清晰', '可配 CDN'],
    cons: ['文档与生态相对另两家略分散', '备案流程仍需走'],
    bestFor: '华为云存量客户',
    staticFriendly: true,
    steps: [
      '创建 OBS 桶，上传站点文件。',
      '配置静态网站托管与默认首页。',
      '绑定域名、证书。',
      '验收首页与询盘按钮。',
    ],
  },
  {
    id: 'github_pages',
    label: 'GitHub Pages',
    region: 'global',
    blurb: '本平台源码协作常用 GitHub；Pages 可免费托管静态站。',
    pros: ['免费、与版本管理一体', '回滚方便', '适合公开展示页'],
    cons: ['国内访问偶发慢', '私有站能力有限', '不适合重后台'],
    bestFor: '开源/作品集/快速国际演示',
    staticFriendly: true,
    steps: [
      '新建仓库，将导出的 index.html 提交为根目录或 /docs。',
      '仓库 Settings → Pages 启用分支发布。',
      '等待 HTTPS 生效，复制站点地址验收。',
      '以后每次「推送上线」可覆盖同文件再 commit。',
    ],
  },
  {
    id: 'vercel',
    label: 'Vercel',
    region: 'global',
    blurb: '本平台前端常见上线方式之一：连接仓库即持续部署。',
    pros: ['部署极快', '预览环境完善', '静态与框架站都合适'],
    cons: ['国内直连偶发不稳定', '企业合规需评估数据出境'],
    bestFor: '国际买家向、快速迭代',
    staticFriendly: true,
    steps: [
      '将站点放入 Git 仓库（或 Vercel 直接上传静态）。',
      'Import Project，框架选 Other / 静态。',
      '部署完成后绑定自定义域名。',
      '后续对话改版 → 再推送覆盖发布。',
    ],
  },
  {
    id: 'supabase_host',
    label: 'Supabase（库 + 存储 / Edge）',
    region: 'global',
    blurb: '本平台业务数据常用 Supabase；站点可用 Storage 或搭配前端托管。',
    pros: ['库表、鉴权、文件一体', '与动态询盘落库顺畅'],
    cons: ['纯静态托管不是它的主场景', '需另配前端托管或 Storage 公开桶'],
    bestFor: '要询盘入库、会员、附件的站点',
    staticFriendly: false,
    steps: [
      '在 Supabase 建表（如 inquiries）与 Storage 桶。',
      '静态页仍建议挂 Vercel/Pages；表单提交打到 Supabase API。',
      '配置 RLS，避免公开写爆。',
      '本工作室会保留站点快照，接口密钥请放服务端。',
    ],
  },
  {
    id: 'cloudflare_pages',
    label: 'Cloudflare Pages',
    region: 'global',
    blurb: '全球 CDN 边缘托管，静态站友好。',
    pros: ['全球加速强', '免费额度实用', '拖拽或 Git 均可'],
    cons: ['控制台英文为主', '部分企业网络策略需放行'],
    bestFor: '海外流量为主的落地页',
    staticFriendly: true,
    steps: [
      '创建 Pages 项目，上传含 index.html 的目录或连 Git。',
      '等待构建/发布完成。',
      '绑定域名与 SSL。',
      '用多地网络抽查打开速度。',
    ],
  },
  {
    id: 'netlify',
    label: 'Netlify',
    region: 'global',
    blurb: '拖拽即上线，适合展会当天快速出链。',
    pros: ['Drop 极快', '表单插件丰富', '预览 URL 方便分享'],
    cons: ['国内访问一般', '免费站有流量限制'],
    bestFor: '展会临时页、客户快速预览',
    staticFriendly: true,
    steps: [
      '打开 Netlify Drop，拖入导出文件夹。',
      '得到临时 https 链接先给客户看。',
      '需要长期站再绑域名或迁 Git 持续部署。',
    ],
  },
];

export const getStackOption = (
  list: StackOption[],
  id?: string | null
): StackOption | undefined => list.find((x) => x.id === id);

export const getDeployOption = (id?: string | null): DeployOption | undefined =>
  DEPLOY_OPTIONS.find((x) => x.id === id);

export const DEFAULT_STACK = {
  frontendId: 'static_html' as const,
  backendId: 'none_static' as const,
  databaseId: 'none' as const,
  deployId: 'vercel' as const,
};
