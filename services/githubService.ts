
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

// --- HELPER: Get File SHA (Robust via Git Tree API) ---
// Gets SHA by reading the git tree, which works for large files and avoids download limits.
const getFileSha = async (path: string): Promise<string | undefined> => {
    const { token, owner, repo } = getCredentials();
    const octokit = getOctokit();
    if (!token || !owner || !repo || !octokit) return undefined;

    try {
        // 1. Get the default branch (main/master)
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
        const defaultBranch = repoData.default_branch;

        // 2. Get the tree of the default branch recursively
        // This is the most robust way to find a file's SHA without downloading it.
        const { data: treeData } = await octokit.rest.git.getTree({
            owner: owner!,
            repo: repo!,
            tree_sha: defaultBranch,
            recursive: 'true',
        });

        // 3. Find the file in the tree
        const fileNode = treeData.tree.find((node: any) => node.path === path);
        return fileNode?.sha;
    } catch (e) {
        console.warn(`[GitHub] Failed to get SHA for ${path}. It might not exist yet.`, e);
        return undefined;
    }
};

// --- HELPER: Read File Content (Large File Support) ---
const getFileContent = async (path: string): Promise<{ sha: string, content: any } | null> => {
    const { token, owner, repo } = getCredentials();
    const octokit = getOctokit();
    
    if (!token || !owner || !repo || !octokit) return null;

    try {
        // 1. Try standard get content (works for <1MB)
        // @ts-ignore
        const { data } = await octokit.rest.repos.getContent({
            owner: owner!,
            repo: repo!,
            path: path,
        });
        
        // Success with content
        if ('content' in data && !Array.isArray(data) && data.content) {
            // Handle encoding manually to prevent issues with special chars
            const decoded = new TextDecoder().decode(Uint8Array.from(atob(data.content), c => c.charCodeAt(0)));
            return { sha: data.sha, content: JSON.parse(decoded) };
        }
    } catch (e: any) {
        // 2. Fallback for Large Files (Blob API via Git Data)
        if (e.status === 403 || (e.message && e.message.includes('too large'))) {
            console.log(`[GitHub] File ${path} too large for standard API, switching to Blob API...`);
            try {
                const sha = await getFileSha(path);
                if (sha) {
                    // @ts-ignore
                    const blob = await octokit.rest.git.getBlob({
                        owner: owner!,
                        repo: repo!,
                        file_sha: sha
                    });
                    const decoded = new TextDecoder().decode(Uint8Array.from(atob(blob.data.content), c => c.charCodeAt(0)));
                    return { sha: sha, content: JSON.parse(decoded) };
                }
            } catch (blobError) {
                console.error(`[GitHub] Blob fetch failed for ${path}`, blobError);
            }
        } else if (e.status !== 404) {
            console.error(`[GitHub] Read Error [${path}]`, e);
        }
    }
    return null;
};

// --- HELPER: Save File Content ---
const saveFileContent = async (path: string, content: any, message: string, sha?: string) => {
    const { token, owner, repo } = getCredentials();
    const octokit = getOctokit();

    if (!token || !owner || !repo || !octokit) throw new Error("GitHub Integration not configured.");
    
    // Encode content to Base64 safely for UTF-8
    const contentString = JSON.stringify(content, null, 2);
    const contentEncoded = btoa(new TextEncoder().encode(contentString).reduce((data, byte) => data + String.fromCharCode(byte), ''));

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
    const sha = await getFileSha(PATH_CONFIG);
    await saveFileContent(PATH_CONFIG, config, "Update Admin Config", sha);
};

// 2. Knowledge Base
export const fetchSharedKnowledgeBase = async (): Promise<KnowledgeFile[]> => {
    const res = await getFileContent(PATH_KB);
    return res ? res.content as KnowledgeFile[] : [];
};
export const saveSharedKnowledgeBase = async (files: KnowledgeFile[]) => {
    const sha = await getFileSha(PATH_KB);
    await saveFileContent(PATH_KB, files, "Update Knowledge Base", sha);
};

// 3. Users
export const fetchUsersFromCloud = async (): Promise<User[]> => {
    const res = await getFileContent(PATH_USERS);
    return res ? res.content as User[] : [];
};
export const saveUsersToCloud = async (users: User[]) => {
    const sha = await getFileSha(PATH_USERS);
    await saveFileContent(PATH_USERS, users, "Update Users List", sha);
};

// 4. API Keys
export const fetchApiConfigsFromCloud = async (): Promise<ApiConfig[]> => {
    const res = await getFileContent(PATH_API_KEYS);
    return res ? res.content as ApiConfig[] : [];
};
export const saveApiConfigsToCloud = async (configs: ApiConfig[]) => {
    const sha = await getFileSha(PATH_API_KEYS);
    await saveFileContent(PATH_API_KEYS, configs, "Update API Configurations", sha);
};

// 5. CRM Clients
export const fetchCRMFromCloud = async (): Promise<Client[]> => {
    const res = await getFileContent(PATH_CRM);
    return res ? res.content as Client[] : [];
};
export const saveCRMToCloud = async (clients: Client[]) => {
    const sha = await getFileSha(PATH_CRM);
    await saveFileContent(PATH_CRM, clients, "Update CRM Clients", sha);
};

// 6. User History
export const fetchUserHistoryFromCloud = async (username: string): Promise<HistoryItem[]> => {
    const path = `${PATH_HISTORY_PREFIX}${username}_history.json`;
    const res = await getFileContent(path);
    return res ? res.content as HistoryItem[] : [];
};
export const saveUserHistoryToCloud = async (username: string, history: HistoryItem[]) => {
    const path = `${PATH_HISTORY_PREFIX}${username}_history.json`;
    const sha = await getFileSha(path);
    await saveFileContent(path, history, `Update history for ${username}`, sha);
};

// Export alias for compatibility
export const backupUserHistory = saveUserHistoryToCloud;
