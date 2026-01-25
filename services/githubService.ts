

import { Octokit } from "@octokit/rest";
import { GlobalConfig, KnowledgeFile, HistoryItem, User, Client, ApiConfig } from "../types";

// Keys for LocalStorage Fallback
const LS_TOKEN = "GH_TOKEN";
const LS_OWNER = "GH_OWNER";
const LS_REPO = "GH_REPO";

// Helper to get credentials
const getCredentials = () => {
    const envToken = process.env.VITE_GITHUB_TOKEN;
    const envOwner = process.env.VITE_GITHUB_OWNER;
    const envRepo = process.env.VITE_GITHUB_REPO;

    if (envToken && envToken.trim() !== '') {
        return { token: envToken, owner: envOwner, repo: envRepo, source: 'ENV' };
    }

    const lsToken = localStorage.getItem(LS_TOKEN);
    const lsOwner = localStorage.getItem(LS_OWNER);
    const lsRepo = localStorage.getItem(LS_REPO);

    if (lsToken && lsToken.trim() !== '') {
        return { token: lsToken, owner: lsOwner, repo: lsRepo, source: 'LOCAL' };
    }

    return { token: '', owner: '', repo: '', source: 'NONE' };
};

// Paths in the repo
const PATH_CONFIG = "data/config.json";
const PATH_KB = "data/kb.json";
const PATH_USERS = "data/users.json";
const PATH_API_KEYS = "data/api_keys.json";
const PATH_CRM = "data/crm.json";
const PATH_HISTORY_PREFIX = "data/history/";

const getOctokit = () => {
    const { token } = getCredentials();
    return token ? new Octokit({ auth: token }) : null;
};

// --- HELPER: Read/Write File ---

const getFileContent = async (path: string): Promise<{ sha: string, content: any } | null> => {
    const { token, owner, repo } = getCredentials();
    const octokit = getOctokit();
    
    if (!token || !owner || !repo || !octokit) return null;

    try {
        // @ts-ignore
        const { data } = await octokit.rest.repos.getContent({
            owner: owner!,
            repo: repo!,
            path: path,
        });
        
        if ('content' in data && !Array.isArray(data)) {
            const decoded = decodeURIComponent(escape(atob(data.content)));
            return { sha: data.sha, content: JSON.parse(decoded) };
        }
    } catch (e: any) {
        if (e.status !== 404) console.error(`GitHub Read Error [${path}]`, e);
    }
    return null;
};

const saveFileContent = async (path: string, content: any, message: string, sha?: string) => {
    const { token, owner, repo } = getCredentials();
    const octokit = getOctokit();

    if (!token || !owner || !repo || !octokit) throw new Error("GitHub Integration not configured.");
    
    const contentString = JSON.stringify(content, null, 2);
    const contentEncoded = btoa(unescape(encodeURIComponent(contentString)));

    // @ts-ignore
    await octokit.rest.repos.createOrUpdateFileContents({
        owner: owner!,
        repo: repo!,
        path: path,
        message: message,
        content: contentEncoded,
        sha: sha // If undefined, creates new file. If defined, updates.
    });
};

// --- PUBLIC METHODS ---

export const checkGitHubStatus = () => {
    const { token, owner, repo, source } = getCredentials();
    if (!token) return { ok: false, msg: "Missing Token", source };
    if (!owner) return { ok: false, msg: "Missing Owner", source };
    if (!repo) return { ok: false, msg: "Missing Repo", source };
    return { ok: true, msg: "Connected", source };
};

export const setManualGitHubConfig = (token: string, owner: string, repo: string) => {
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_OWNER, owner);
    localStorage.setItem(LS_REPO, repo);
};

export const clearManualGitHubConfig = () => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_OWNER);
    localStorage.removeItem(LS_REPO);
};

// 1. Global Config
export const fetchGlobalConfig = async (): Promise<GlobalConfig | null> => {
    const res = await getFileContent(PATH_CONFIG);
    return res ? res.content as GlobalConfig : null;
};
export const saveGlobalConfig = async (config: GlobalConfig) => {
    const existing = await getFileContent(PATH_CONFIG);
    await saveFileContent(PATH_CONFIG, config, "Update Admin Config", existing?.sha);
};

// 2. Knowledge Base
export const fetchSharedKnowledgeBase = async (): Promise<KnowledgeFile[]> => {
    const res = await getFileContent(PATH_KB);
    return res ? res.content as KnowledgeFile[] : [];
};
export const saveSharedKnowledgeBase = async (files: KnowledgeFile[]) => {
    const existing = await getFileContent(PATH_KB);
    await saveFileContent(PATH_KB, files, "Update Knowledge Base", existing?.sha);
};

// 3. Users
export const fetchUsersFromCloud = async (): Promise<User[]> => {
    const res = await getFileContent(PATH_USERS);
    return res ? res.content as User[] : [];
};
export const saveUsersToCloud = async (users: User[]) => {
    const existing = await getFileContent(PATH_USERS);
    await saveFileContent(PATH_USERS, users, "Update Users List", existing?.sha);
};

// 4. API Keys
export const fetchApiConfigsFromCloud = async (): Promise<ApiConfig[]> => {
    const res = await getFileContent(PATH_API_KEYS);
    return res ? res.content as ApiConfig[] : [];
};
export const saveApiConfigsToCloud = async (configs: ApiConfig[]) => {
    const existing = await getFileContent(PATH_API_KEYS);
    await saveFileContent(PATH_API_KEYS, configs, "Update API Configurations", existing?.sha);
};

// 5. CRM Clients
export const fetchCRMFromCloud = async (): Promise<Client[]> => {
    const res = await getFileContent(PATH_CRM);
    return res ? res.content as Client[] : [];
};
export const saveCRMToCloud = async (clients: Client[]) => {
    const existing = await getFileContent(PATH_CRM);
    await saveFileContent(PATH_CRM, clients, "Update CRM Clients", existing?.sha);
};

// 6. User History
export const fetchUserHistoryFromCloud = async (username: string): Promise<HistoryItem[]> => {
    const path = `${PATH_HISTORY_PREFIX}${username}_history.json`;
    const res = await getFileContent(path);
    return res ? res.content as HistoryItem[] : [];
};
export const saveUserHistoryToCloud = async (username: string, history: HistoryItem[]) => {
    const path = `${PATH_HISTORY_PREFIX}${username}_history.json`;
    const existing = await getFileContent(path);
    await saveFileContent(path, history, `Update history for ${username}`, existing?.sha);
};

// Export alias for compatibility
export const backupUserHistory = saveUserHistoryToCloud;
