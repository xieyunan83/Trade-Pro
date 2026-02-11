
import { Octokit } from "@octokit/rest";
import { GlobalConfig, KnowledgeFile, HistoryItem, User, Client, ApiConfig } from "../types";

// Keys for LocalStorage Fallback
const LS_TOKEN = "GH_TOKEN";
const LS_OWNER = "GH_OWNER";
const LS_REPO = "GH_REPO";
const LS_PATH = "GH_PATH"; // New: Folder path for KB

// Helper to get credentials
const getCredentials = () => {
    const envToken = process.env.VITE_GITHUB_TOKEN;
    const envOwner = process.env.VITE_GITHUB_OWNER;
    const envRepo = process.env.VITE_GITHUB_REPO;

    if (envToken && envToken.trim() !== '') {
        return { token: envToken, owner: envOwner, repo: envRepo, path: '', source: 'ENV' };
    }

    const lsToken = localStorage.getItem(LS_TOKEN);
    const lsOwner = localStorage.getItem(LS_OWNER);
    const lsRepo = localStorage.getItem(LS_REPO);
    const lsPath = localStorage.getItem(LS_PATH) || '';

    if (lsOwner && lsRepo) {
        return { token: lsToken || '', owner: lsOwner, repo: lsRepo, path: lsPath, source: 'LOCAL' };
    }

    return { token: '', owner: '', repo: '', path: '', source: 'NONE' };
};

// Paths for System Backup (Separate from KB Folder)
const PATH_CONFIG = "data/config.json";
const PATH_KB_BACKUP = "data/kb.json"; // Legacy backup path
const PATH_USERS = "data/users.json";
const PATH_API_KEYS = "data/api_keys.json";
const PATH_CRM = "data/crm.json";
const PATH_HISTORY_PREFIX = "data/history/";

const getOctokit = () => {
    const { token } = getCredentials();
    return new Octokit({ auth: token || undefined });
};

// --- CACHED TREE FETCH ---
// Prevents multiple 404s and rate limiting by fetching file list once.
let _treeCache: { timestamp: number, data: any } | null = null;
const TREE_CACHE_TTL = 10000; // 10 seconds

const getRepoTree = async () => {
    const { owner, repo } = getCredentials();
    const octokit = getOctokit();
    if (!owner || !repo) return null;

    const now = Date.now();
    if (_treeCache && (now - _treeCache.timestamp < TREE_CACHE_TTL)) {
        return _treeCache.data;
    }

    try {
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
        const defaultBranch = repoData.default_branch;

        const { data: treeData } = await octokit.rest.git.getTree({
            owner,
            repo,
            tree_sha: defaultBranch,
            recursive: 'true',
        });
        
        _treeCache = { timestamp: now, data: treeData };
        return treeData;
    } catch (e) {
        // If repo is empty or doesn't exist, suppress error and return null
        return null; 
    }
};

const getFileSha = async (path: string): Promise<string | undefined> => {
    const treeData = await getRepoTree();
    if (!treeData || !treeData.tree) return undefined;
    
    // @ts-ignore
    const fileNode = treeData.tree.find((node: any) => node.path === path);
    return fileNode?.sha;
};

// --- HELPER: Read File Content ---
const getFileContent = async (path: string): Promise<{ sha: string, content: any } | null> => {
    const { owner, repo } = getCredentials();
    const octokit = getOctokit();
    
    if (!owner || !repo) return null;

    // STEP 1: Check existence in Tree first (No 404s!)
    const sha = await getFileSha(path);
    if (!sha) return null; 

    // STEP 2: Fetch Blob using SHA (Efficient & Reliable)
    try {
        const { data } = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: sha
        });
        
        const cleanBase64 = data.content.replace(/\s/g, '');
        const decoded = new TextDecoder().decode(Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0)));
        return { sha, content: JSON.parse(decoded) };
    } catch (e: any) {
        console.error(`[GitHub] Blob Read Error [${path}]`, e);
    }
    return null;
};

// --- HELPER: Save File Content ---
const saveFileContent = async (path: string, content: any, message: string, sha?: string) => {
    const { token, owner, repo } = getCredentials();
    const octokit = getOctokit();

    if (!token) throw new Error("GitHub Token required for writing.");
    if (!owner || !repo) throw new Error("Repository info missing.");
    
    const contentString = JSON.stringify(content, null, 2);
    const contentEncoded = btoa(new TextEncoder().encode(contentString).reduce((data, byte) => data + String.fromCharCode(byte), ''));

    // @ts-ignore
    await octokit.rest.repos.createOrUpdateFileContents({
        owner: owner!,
        repo: repo!,
        path: path,
        message: message,
        content: contentEncoded,
        sha: sha 
    });
};

// --- PUBLIC METHODS ---

export const checkGitHubStatus = () => {
    const { token, owner, repo, path, source } = getCredentials();
    if (!owner) return { ok: false, msg: "Missing Owner", source };
    if (!repo) return { ok: false, msg: "Missing Repo", source };
    return { ok: true, msg: "Connected", source, path };
};

export const setManualGitHubConfig = (token: string, owner: string, repo: string, path: string = '') => {
    if(token) localStorage.setItem(LS_TOKEN, token);
    else localStorage.removeItem(LS_TOKEN);
    
    localStorage.setItem(LS_OWNER, owner);
    localStorage.setItem(LS_REPO, repo);
    localStorage.setItem(LS_PATH, path);
    
    // Clear cache to force refresh on new config
    _treeCache = null; 
};

export const clearManualGitHubConfig = () => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_OWNER);
    localStorage.removeItem(LS_REPO);
    localStorage.removeItem(LS_PATH);
    _treeCache = null;
};

// --- FETCH DOCUMENTS FROM REPO FOLDER ---
export const fetchDocumentsFromRepo = async (): Promise<KnowledgeFile[]> => {
    const { owner, repo, path } = getCredentials();
    const octokit = getOctokit();

    if (!owner || !repo) throw new Error("Repository not configured");

    try {
        // Use Tree instead of getContent to avoid folder 404s
        const treeData = await getRepoTree();
        if (!treeData || !treeData.tree) return [];

        const targetFolder = path ? path.replace(/\/$/, '') : '';

        // Filter files that are in the target folder (or root if empty)
        // @ts-ignore
        const filesToFetch = treeData.tree.filter((node: any) => {
            if (node.type !== 'blob') return false;
            
            // Check Path
            if (targetFolder) {
                if (!node.path.startsWith(targetFolder + '/')) return false;
            } else {
                // If looking for root, exclude items in subfolders (optional, but cleaner)
                if (node.path.includes('/')) return false; 
            }

            // Check Extension
            const supportedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.txt', '.md', '.json', '.docx'];
            return supportedExtensions.some(ext => node.path.toLowerCase().endsWith(ext));
        });

        console.log(`[GitHub KB] Found ${filesToFetch.length} files via Tree`);

        // Fetch content (Parallel)
        const knowledgeFiles: KnowledgeFile[] = await Promise.all(filesToFetch.map(async (file: any) => {
            try {
                // @ts-ignore
                const { data: blob } = await octokit.rest.git.getBlob({
                    owner,
                    repo,
                    file_sha: file.sha
                });

                const cleanBase64 = blob.content.replace(/\s/g, '');
                
                let mimeType = 'text/plain';
                const lowerName = file.path.toLowerCase();
                if (lowerName.endsWith('.pdf')) mimeType = 'application/pdf';
                else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) mimeType = 'image/jpeg';
                else if (lowerName.endsWith('.png')) mimeType = 'image/png';
                else if (lowerName.endsWith('.json')) mimeType = 'application/json';

                // Extract filename from path
                const fileName = file.path.split('/').pop();

                return {
                    id: file.sha, 
                    name: fileName,
                    type: mimeType,
                    data: cleanBase64,
                    size: blob.size
                };
            } catch (err) {
                return null;
            }
        }));

        return knowledgeFiles.filter((f): f is KnowledgeFile => f !== null);

    } catch (e: any) {
        console.error("[GitHub KB] Fetch Error", e);
        return [];
    }
};

// --- EXISTING CONFIG/BACKUP METHODS ---

export const fetchGlobalConfig = async (): Promise<GlobalConfig | null> => {
    const res = await getFileContent(PATH_CONFIG);
    return res ? res.content as GlobalConfig : null;
};
export const saveGlobalConfig = async (config: GlobalConfig) => {
    const sha = await getFileSha(PATH_CONFIG);
    await saveFileContent(PATH_CONFIG, config, "Update Admin Config", sha);
};

export const fetchSharedKnowledgeBase = async (): Promise<KnowledgeFile[]> => {
    const res = await getFileContent(PATH_KB_BACKUP);
    return res ? res.content as KnowledgeFile[] : [];
};
export const saveSharedKnowledgeBase = async (files: KnowledgeFile[]) => {
    const sha = await getFileSha(PATH_KB_BACKUP);
    await saveFileContent(PATH_KB_BACKUP, files, "Update Knowledge Base Backup", sha);
};

export const fetchUsersFromCloud = async (): Promise<User[]> => {
    const res = await getFileContent(PATH_USERS);
    return res ? res.content as User[] : [];
};
export const saveUsersToCloud = async (users: User[]) => {
    const sha = await getFileSha(PATH_USERS);
    await saveFileContent(PATH_USERS, users, "Update Users List", sha);
};

export const fetchApiConfigsFromCloud = async (): Promise<ApiConfig[]> => {
    const res = await getFileContent(PATH_API_KEYS);
    return res ? res.content as ApiConfig[] : [];
};
export const saveApiConfigsToCloud = async (configs: ApiConfig[]) => {
    const sha = await getFileSha(PATH_API_KEYS);
    await saveFileContent(PATH_API_KEYS, configs, "Update API Configurations", sha);
};

export const fetchCRMFromCloud = async (): Promise<Client[]> => {
    const res = await getFileContent(PATH_CRM);
    return res ? res.content as Client[] : [];
};
export const saveCRMToCloud = async (clients: Client[]) => {
    const sha = await getFileSha(PATH_CRM);
    await saveFileContent(PATH_CRM, clients, "Update CRM Clients", sha);
};

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

export const backupUserHistory = saveUserHistoryToCloud;
