
import { Octokit } from "@octokit/rest";
import { GlobalConfig, KnowledgeFile, HistoryItem } from "../types";

// Keys for LocalStorage Fallback
const LS_TOKEN = "GH_TOKEN";
const LS_OWNER = "GH_OWNER";
const LS_REPO = "GH_REPO";

// Helper to get credentials (Env Vars take priority, then LocalStorage)
const getCredentials = () => {
    // 1. Try Environment Variables
    const envToken = process.env.VITE_GITHUB_TOKEN;
    const envOwner = process.env.VITE_GITHUB_OWNER;
    const envRepo = process.env.VITE_GITHUB_REPO;

    if (envToken && envToken.trim() !== '') {
        return { token: envToken, owner: envOwner, repo: envRepo, source: 'ENV' };
    }

    // 2. Try LocalStorage (Manual Input)
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

export const fetchGlobalConfig = async (): Promise<GlobalConfig | null> => {
    const res = await getFileContent(PATH_CONFIG);
    return res ? res.content as GlobalConfig : null;
};

export const saveGlobalConfig = async (config: GlobalConfig) => {
    const existing = await getFileContent(PATH_CONFIG);
    await saveFileContent(PATH_CONFIG, config, "Update Admin Config", existing?.sha);
};

export const fetchSharedKnowledgeBase = async (): Promise<KnowledgeFile[]> => {
    const res = await getFileContent(PATH_KB);
    return res ? res.content as KnowledgeFile[] : [];
};

export const saveSharedKnowledgeBase = async (files: KnowledgeFile[]) => {
    const existing = await getFileContent(PATH_KB);
    await saveFileContent(PATH_KB, files, "Update Knowledge Base", existing?.sha);
};

export const backupUserHistory = async (username: string, history: HistoryItem[]) => {
    const path = `${PATH_HISTORY_PREFIX}${username}_history.json`;
    const existing = await getFileContent(path);
    await saveFileContent(path, history, `Backup history for ${username}`, existing?.sha);
};

export const checkGitHubStatus = () => {
    const { token, owner, repo, source } = getCredentials();
    if (!token) return { ok: false, msg: "Missing Token", source };
    if (!owner) return { ok: false, msg: "Missing Owner", source };
    if (!repo) return { ok: false, msg: "Missing Repo", source };
    return { ok: true, msg: "Connected", source };
};

// NEW: Manual Configuration (Saved to LocalStorage)
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
