
import { Octokit } from "@octokit/rest";
import { GlobalConfig, KnowledgeFile, HistoryItem } from "../types";

// These MUST be set in your Deployment Environment Variables
const GITHUB_TOKEN = process.env.VITE_GITHUB_TOKEN;
const OWNER = process.env.VITE_GITHUB_OWNER;
const REPO = process.env.VITE_GITHUB_REPO;

// Paths in the repo
const PATH_CONFIG = "data/config.json";
const PATH_KB = "data/kb.json";
const PATH_HISTORY_PREFIX = "data/history/";

const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : null;

const isConfigured = () => {
    return !!(octokit && OWNER && REPO);
};

// --- HELPER: Read/Write File ---

const getFileContent = async (path: string): Promise<{ sha: string, content: any } | null> => {
    if (!isConfigured()) return null;
    try {
        // @ts-ignore
        const { data } = await octokit.rest.repos.getContent({
            owner: OWNER!,
            repo: REPO!,
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
    if (!isConfigured()) throw new Error("GitHub Integration not configured (Missing Token/Repo).");
    
    const contentString = JSON.stringify(content, null, 2);
    const contentEncoded = btoa(unescape(encodeURIComponent(contentString)));

    // @ts-ignore
    await octokit.rest.repos.createOrUpdateFileContents({
        owner: OWNER!,
        repo: REPO!,
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
    // Files can be large, we strip the base64 data if it's too huge for a single JSON in future optimizations
    // For now, save as is.
    await saveFileContent(PATH_KB, files, "Update Knowledge Base", existing?.sha);
};

export const backupUserHistory = async (username: string, history: HistoryItem[]) => {
    const path = `${PATH_HISTORY_PREFIX}${username}_history.json`;
    const existing = await getFileContent(path);
    await saveFileContent(path, history, `Backup history for ${username}`, existing?.sha);
};

export const checkGitHubStatus = () => {
    if (!GITHUB_TOKEN) return { ok: false, msg: "Missing VITE_GITHUB_TOKEN" };
    if (!OWNER) return { ok: false, msg: "Missing VITE_GITHUB_OWNER" };
    if (!REPO) return { ok: false, msg: "Missing VITE_GITHUB_REPO" };
    return { ok: true, msg: "Connected" };
};
