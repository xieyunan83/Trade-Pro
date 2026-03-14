
import { Octokit } from '@octokit/rest';
import { GlobalConfig, Client, HistoryItem, KnowledgeFile, ApiConfig, User } from '../types';

let octokit: Octokit | null = null;
let repoConfig = { owner: '', repo: '' };

export const setManualGitHubConfig = (token: string, owner: string, repo: string) => {
  octokit = new Octokit({ auth: token });
  repoConfig = { owner, repo };
  localStorage.setItem('trade_scout_gh_token', token);
  localStorage.setItem('trade_scout_gh_owner', owner);
  localStorage.setItem('trade_scout_gh_repo', repo);
};

export const checkGitHubStatus = () => {
  const token = localStorage.getItem('trade_scout_gh_token');
  const owner = localStorage.getItem('trade_scout_gh_owner');
  const repo = localStorage.getItem('trade_scout_gh_repo');
  
  if (token && owner && repo) {
    if (!octokit) octokit = new Octokit({ auth: token });
    repoConfig = { owner, repo };
    return { ok: true };
  }
  return { ok: false };
};

const toBase64 = (str: string) => btoa(unescape(encodeURIComponent(str)));
const fromBase64 = (str: string) => decodeURIComponent(escape(atob(str)));

export const fetchGlobalConfig = async (): Promise<GlobalConfig | null> => {
  if (!octokit) return null;
  try {
    const { data } = await octokit.repos.getContent({
      ...repoConfig,
      path: 'config.json',
    });
    if ('content' in data) {
      return JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    }
  } catch (e) {
    console.warn("Failed to fetch global config", e);
  }
  return null;
};

export const fetchDocumentsFromRepo = async (): Promise<KnowledgeFile[]> => {
  if (!octokit) return [];
  try {
    const { data } = await octokit.repos.getContent({
      ...repoConfig,
      path: 'knowledge',
    });
    if (Array.isArray(data)) {
      const files: KnowledgeFile[] = [];
      for (const item of data) {
        if (item.type === 'file') {
          try {
            const { data: fileData } = await octokit.repos.getContent({
              ...repoConfig,
              path: item.path,
            });
            if ('content' in fileData) {
              files.push({
                id: item.sha,
                name: item.name,
                type: item.name.split('.').pop() || 'txt',
                data: fromBase64(fileData.content.replace(/\n/g, '')),
                size: item.size
              });
            }
          } catch (err) {
            console.error(`Failed to fetch file ${item.path}`, err);
          }
        }
      }
      return files;
    }
  } catch (e) {
    console.warn("Failed to fetch documents", e);
  }
  return [];
};

export const backupUserHistory = async (username: string, history: HistoryItem[]) => {
  if (!octokit) return;
  const content = toBase64(JSON.stringify(history));
  try {
    let sha;
    try {
      const { data } = await octokit.repos.getContent({ ...repoConfig, path: `history/${username}.json` });
      if ('sha' in data) sha = data.sha;
    } catch (e) {
      // File might not exist yet
    }

    await octokit.repos.createOrUpdateFileContents({
      ...repoConfig,
      path: `history/${username}.json`,
      message: `Backup history for ${username}`,
      content,
      sha
    });
  } catch (e) {
    console.error("Failed to backup history", e);
  }
};

export const fetchUserHistoryFromCloud = async (username: string): Promise<HistoryItem[]> => {
  if (!octokit) return [];
  try {
    const { data } = await octokit.repos.getContent({ ...repoConfig, path: `history/${username}.json` });
    if ('content' in data) {
      return JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    }
  } catch (e) {
    console.warn("No cloud history found for user", username);
  }
  return [];
};

export const saveCRMToCloud = async (clients: Client[]) => {
  if (!octokit) return;
  const content = toBase64(JSON.stringify(clients));
  try {
    let sha;
    try {
      const { data } = await octokit.repos.getContent({ ...repoConfig, path: 'crm.json' });
      if ('sha' in data) sha = data.sha;
    } catch (e) {
      // File might not exist
    }

    await octokit.repos.createOrUpdateFileContents({
      ...repoConfig,
      path: 'crm.json',
      message: 'Sync CRM data',
      content,
      sha
    });
  } catch (e) {
    console.error("Failed to save CRM to cloud", e);
  }
};

export const fetchCRMFromCloud = async (): Promise<Client[]> => {
  if (!octokit) return [];
  try {
    const { data } = await octokit.repos.getContent({ ...repoConfig, path: 'crm.json' });
    if ('content' in data) {
      return JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    }
  } catch (e) {
    console.warn("No cloud CRM found");
  }
  return [];
};

export const fetchApiConfigsFromCloud = async (): Promise<ApiConfig[]> => {
  if (!octokit) return [];
  try {
    const { data } = await octokit.repos.getContent({ ...repoConfig, path: 'api_configs.json' });
    if ('content' in data) {
      return JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    }
  } catch (e) {
    console.warn("No cloud API configs found");
  }
  return [];
};

export const saveUsersToCloud = async (users: User[]) => {
  if (!octokit) return;
  const content = toBase64(JSON.stringify(users));
  try {
    let sha;
    try {
      const { data } = await octokit.repos.getContent({ ...repoConfig, path: 'users.json' });
      if ('sha' in data) sha = data.sha;
    } catch (e) {
      // File might not exist
    }

    await octokit.repos.createOrUpdateFileContents({
      ...repoConfig,
      path: 'users.json',
      message: 'Sync Users data',
      content,
      sha
    });
  } catch (e) {
    console.error("Failed to save users to cloud", e);
  }
};

export const fetchUsersFromCloud = async (): Promise<User[]> => {
  if (!octokit) return [];
  try {
    const { data } = await octokit.repos.getContent({ ...repoConfig, path: 'users.json' });
    if ('content' in data) {
      return JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    }
  } catch (e) {
    console.warn("No cloud users found");
  }
  return [];
};
