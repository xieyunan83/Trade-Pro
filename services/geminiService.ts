
import { GoogleGenAI, Type, Part } from "@google/genai";
import { AnalysisResult, ClientSearchResult, DecisionMaker, ChatMessage, KnowledgeFile, KeywordExtractionResult, MailGroup, EmailTemplateRequest, ApiConfig, TaskType } from "../types";
import { getAllFilesFromDB } from "./db";

// API Keys Configuration
const HUNTER_API_KEY = process.env.HUNTER_API_KEY || ''; 
const FINDYMAIL_API_KEY = process.env.FINDYMAIL_API_KEY || ''; 
const ANYMAIL_FINDER_API_KEY = process.env.ANYMAIL_FINDER_API_KEY || '';

const NATIVE_MODEL = 'gemini-3-pro-preview';

// CORS Proxy Fallbacks (Expanded for China/Firewall bypass)
// NOTE: Public proxies are unreliable. The best solution is always a paid Relay (HiAPI, OpenRouter, etc.)
const PROXY_LADDER = [
    '', // 1. Direct Connection (Best for Localhost/VPN)
    'https://corsproxy.io/?', // 2. Most stable public proxy
    'https://api.allorigins.win/raw?url=', // 3. Backup
    'https://thingproxy.freeboard.io/fetch/', // 4. Backup
];

const SYSTEM_INSTRUCTION = `
You are "楠哥的小助理" (Nan Ge's Assistant), an elite Foreign Trade Intelligence Agent.
Your goal is to provide deep, actionable insights for Chinese export suppliers.
You must use the googleSearch tool to find REAL, CURRENT information.
DO NOT hallucinate. If data is unavailable, say "公开信息未找到".

LANGUAGE REQUIREMENT:
All descriptive text MUST be in SIMPLIFIED CHINESE (简体中文). 
Do NOT use English for descriptions unless it is a proper noun (like a specific company name or product model).
Structure the report professionally in Chinese.
`;

export interface TaskTypeAssignment {
    task: TaskType;
}

const extractJson = (text: string, isArray: boolean = false): any => {
  if (!text) return isArray ? [] : {};
  try {
    const startChar = isArray ? '[' : '{';
    const endChar = isArray ? ']' : '}';
    const firstOpen = text.indexOf(startChar);
    const lastClose = text.lastIndexOf(endChar);
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      const jsonCandidate = text.substring(firstOpen, lastClose + 1);
      return JSON.parse(jsonCandidate);
    }
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("JSON Extraction Error:", e);
    return isArray ? [] : {};
  }
};

const cleanDomain = (domain: string) => domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];

// --- External APIs ---
const fetchHunterEmails = async (domain: string): Promise<{ people: DecisionMaker[], pattern: string | null }> => {
    if (!domain || !HUNTER_API_KEY) return { people: [], pattern: null };
    try {
        const url = `https://api.hunter.io/v2/domain-search?domain=${cleanDomain(domain)}&api_key=${HUNTER_API_KEY}&limit=20`;
        const response = await fetch(url);
        const data = await response.json();
        const pattern = data.data?.pattern || null;
        if (data.data && data.data.emails) {
            const people = data.data.emails.map((e: any) => ({
                name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Professional',
                firstName: e.first_name,
                lastName: e.last_name,
                title: e.position || 'Employee',
                emailGuess: e.value,
                linkedin: e.linkedin,
                type: (e.position?.toLowerCase().match(/ceo|founder|owner|president/) ? 'CEO' : e.position?.toLowerCase().match(/buyer|procurement|purchasing|sourcing|manager/) ? 'Buyer' : 'Other'),
                source: 'Hunter.io',
                isVerified: e.confidence > 85, // More strict
                confidence: e.confidence / 100
            }));
            return { people, pattern };
        }
    } catch (error) { console.error("Hunter API Error", error); }
    return { people: [], pattern: null };
};

const findEmailWithHunter = async (firstName: string, lastName: string, domain: string): Promise<{ email: string, confidence: number } | null> => {
    if (!HUNTER_API_KEY || !domain || !firstName) return null;
    try {
        const url = `https://api.hunter.io/v2/email-finder?domain=${cleanDomain(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName || '')}&api_key=${HUNTER_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.data && data.data.email) {
            return { email: data.data.email, confidence: data.data.score / 100 };
        }
    } catch (e) { console.error("Hunter Email Finder Error", e); }
    return null;
};

const findEmailWithFindymail = async (name: string, domain: string): Promise<{ email: string, isVerified: boolean } | null> => {
    if (!FINDYMAIL_API_KEY || !domain || !name) return null;
    try {
        const url = `https://app.findymail.com/api/search/name?domain=${cleanDomain(domain)}&name=${encodeURIComponent(name)}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${FINDYMAIL_API_KEY}` }
        });
        const data = await response.json();
        if (data.email) {
            return { email: data.email, isVerified: data.status === 'valid' };
        }
    } catch (e) { console.error("Findymail Search Error", e); }
    return null;
};

const fetchFindymail = async (domain: string): Promise<DecisionMaker[]> => {
    if (!domain || !FINDYMAIL_API_KEY) return [];
    try {
        const response = await fetch(`https://app.findymail.com/api/search/domain?domain=${cleanDomain(domain)}`, {
            headers: { 'Authorization': `Bearer ${FINDYMAIL_API_KEY}` }
        });
        const data = await response.json();
        if (data.emails && Array.isArray(data.emails)) {
            return data.emails.map((e: any) => ({
                name: e.name || 'Contact',
                title: e.job_title || 'Manager',
                emailGuess: e.email,
                linkedin: e.linkedin,
                type: (e.job_title?.toLowerCase().match(/ceo|founder|owner/) ? 'CEO' : e.job_title?.toLowerCase().match(/buyer|procurement|purchasing/) ? 'Buyer' : 'Other'),
                source: 'Findymail',
                isVerified: e.status === 'valid'
            }));
        }
    } catch (e) { console.error("Findymail Error", e); }
    return [];
};

const fetchAnymailFinder = async (domain: string): Promise<DecisionMaker[]> => {
    if (!domain || !ANYMAIL_FINDER_API_KEY) return [];
    try {
        const response = await fetch(`https://api.anymailfinder.com/v1.0/search/company.json`, {
            method: 'POST',
            headers: { 'X-Api-Key': ANYMAIL_FINDER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: cleanDomain(domain) })
        });
        await response.json();
        return []; 
    } catch (e) { console.error("Anymail Finder Error", e); }
    return [];
};

// --- API Configuration ---

export const getGeminiConfig = (): ApiConfig[] => {
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('trade_scout_api_configs');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Ensure valid configs
                return parsed.filter((c: ApiConfig) => c.apiKey && c.apiKey.trim() !== '');
            } catch (e) {
                console.error("Failed to parse stored API configs", e);
            }
        }
    }
    return [];
};

// --- OpenAI Adapter for Relay Services (hiapi, nvidia, deepseek, openrouter etc) ---
const callOpenAICompatible = async (config: ApiConfig, messages: any[], jsonMode: boolean = false): Promise<string> => {
    // Construct URL robustly
    let baseUrl = config.baseUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    
    // Auto-append chat/completions if not present (Standard OpenAI format)
    // EXCEPTION: Some proxies might not need this, but most do.
    if (!baseUrl.endsWith('/chat/completions') && !baseUrl.includes('generateContent')) {
        baseUrl += '/chat/completions';
    }

    // Model Mapping fallback
    const model = config.modelId?.trim() || 'gemini-1.5-pro';
    
    const payload: any = {
        model: model,
        messages: messages,
        temperature: 0.7,
        stream: false,
        max_tokens: 4096 
    };

    if (jsonMode) {
        payload.response_format = { type: "json_object" };
    }

    // Helper to execute fetch
    const doFetch = async (proxyPrefix: string, targetUrl: string) => {
        const finalUrl = proxyPrefix ? `${proxyPrefix}${encodeURIComponent(targetUrl)}` : targetUrl;
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey.trim()}`
        };

        // --- CRITICAL FIX FOR OPENROUTER ---
        // OpenRouter requires these headers to identify the app and prevent blocks
        if (targetUrl.includes('openrouter')) {
            headers['HTTP-Referer'] = window.location.href; // Site URL
            headers['X-Title'] = 'Trade Scout Pro'; // App Name
        }

        return fetch(finalUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
    };

    // Multi-Level Proxy Attempt Strategy
    let lastError: any = null;
    
    // Custom Proxy from LocalStorage
    const customProxy = typeof localStorage !== 'undefined' ? localStorage.getItem('trade_scout_custom_proxy') : '';
    
    // Logic: 
    // 1. If OpenRouter/HiAPI/SiliconFlow, try DIRECT first (they support CORS usually).
    // 2. If blocked, try Proxy.
    let attempts = PROXY_LADDER;
    if (customProxy) attempts = [customProxy, ...attempts];

    // Priority adjustment: Relay services often fail with public proxies due to header stripping.
    // So we ensure '' (Direct) is first for them.
    if (baseUrl.includes('openrouter') || baseUrl.includes('siliconflow') || baseUrl.includes('hiapi')) {
        attempts = ['', ...attempts.filter(p => p !== '')]; 
    }

    for (const proxy of attempts) {
        try {
            const response = await doFetch(proxy, baseUrl);

            if (!response.ok) {
                const errText = await response.text();
                
                // If 401, key is wrong. STOP.
                if (response.status === 401) {
                    throw new Error(`API Key Rejected (401). Please check your Key.`);
                }
                
                // If 402, Quota exceeded. STOP.
                if (response.status === 402 || response.status === 429) {
                    throw new Error(`Rate Limit or Quota Exceeded (${response.status}).`);
                }

                // If 403/404/5xx, it might be network/proxy issue. Continue to next proxy.
                if (response.status >= 500 || response.status === 403) {
                    console.warn(`Attempt failed with status ${response.status}. Trying next proxy...`);
                    lastError = new Error(`HTTP ${response.status}: ${errText}`);
                    continue; 
                }

                // Other errors
                let safeErr = errText;
                try { safeErr = JSON.parse(errText).error?.message || errText; } catch(e) { /* ignore parse error */ }
                throw new Error(`API Error (${response.status}): ${safeErr}`);
            }

            const data = await response.json();
            
            // Handle different response structures
            const content = data.choices?.[0]?.message?.content || data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!content) {
                console.error("Empty Response Structure:", data);
                throw new Error("Received empty response from API (Structure mismatch)");
            }
            return content; // Success!

        } catch (e: any) {
            lastError = e;
            // Fatal errors that shouldn't trigger retry loop
            if (e.message.includes('401') || e.message.includes('402') || e.message.includes('Key Rejected') || e.message.includes('Rate Limit')) {
                throw e;
            }
        }
    }

    // Comprehensive Error Message
    let errorMsg = `[Connection Failed] `;
    if (baseUrl.includes('openrouter')) {
        errorMsg += `OpenRouter connection failed. Ensure your API Key is valid and you have credits. If in China, try using a global VPN mode.`;
    } else if (baseUrl.includes('googleapis.com')) {
        errorMsg += `It seems you are using a raw Google URL. Please use the 'Google Official (Native)' preset instead.`;
    } else {
        errorMsg += `Last Error: ${lastError?.message || 'Network Error'}. Check URL/Network.`;
    }
    throw new Error(errorMsg);
};

// --- Unified Generator with Failover Strategy ---
const generateContentUnified = async (
    task: TaskType, 
    prompt: string, 
    systemInfo?: string, 
    jsonMode: boolean = false, 
    images: string[] = [], // base64 strings
    attachments: KnowledgeFile[] = []
): Promise<string> => {
    
    // 1. Gather all available configurations
    const allConfigs = getGeminiConfig();
    
    // 2. Add Native Process Env Key as a "Candidate" if it exists
    // We treat it as a special config with ID 'native'
    const nativeConfig: ApiConfig | null = process.env.API_KEY ? {
        id: 'native_env_key',
        apiKey: process.env.API_KEY,
        baseUrl: 'native', // Special flag
        priority: 0, // Highest priority by default for backward compatibility
        taskAssignment: 'default',
        modelId: NATIVE_MODEL
    } : null;

    const candidates = [...allConfigs];
    if (nativeConfig) candidates.push(nativeConfig);

    // 3. Filter by Task
    // Logic: 
    // - Include configs specifically assigned to this task.
    // - Include 'default' configs as fallback.
    const relevantCandidates = candidates.filter(c => 
        c.taskAssignment === task || !c.taskAssignment || c.taskAssignment === 'default'
    );

    if (relevantCandidates.length === 0) {
        throw new Error("No API Keys configured for this task. Please add keys in Admin Dashboard.");
    }

    // 4. Sort by Priority (Low number = High Priority)
    // 0 is highest, then 1, 2, ...
    // If priority is missing, treat as lowest (Infinity)
    relevantCandidates.sort((a, b) => {
        const pA = (a.priority !== undefined && a.priority !== null) ? a.priority : 999;
        const pB = (b.priority !== undefined && b.priority !== null) ? b.priority : 999;
        return pA - pB;
    });

    console.log(`[Failover] Found ${relevantCandidates.length} keys for task '${task}'. Starting execution chain...`);

    // 5. Execute Chain
    let lastError: any = null;

    for (const config of relevantCandidates) {
        console.log(`[Failover] Trying Config [Priority ${config.priority ?? 'Default'}]: ${config.id} (${config.baseUrl === 'native' ? 'Google Native' : config.modelId})`);
        
        try {
            if (config.baseUrl === 'native') {
                // --- STRATEGY: NATIVE GOOGLE API ---
                const ai = new GoogleGenAI({ apiKey: config.apiKey });
                const parts: Part[] = [{ text: prompt }];
                
                // Add images
                images.forEach(img => {
                    parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } });
                });

                // Add attachments (Multimodal)
                attachments.forEach(file => {
                    if (file.type === 'youtube') {
                        parts.push({ text: `[Reference YouTube Link: ${file.data}]` });
                    } else if (file.mimeType && file.data) {
                        parts.push({ 
                            inlineData: { 
                                mimeType: file.mimeType, 
                                data: file.data 
                            } 
                        });
                    }
                });

                const reqConfig: any = { systemInstruction: systemInfo };
                if (jsonMode) {
                    reqConfig.responseMimeType = "application/json";
                } else {
                    reqConfig.tools = [{ googleSearch: {} }]; 
                }

                const response = await ai.models.generateContent({
                    model: config.modelId || NATIVE_MODEL,
                    contents: [{ role: 'user', parts }],
                    config: reqConfig
                });
                
                if (response.text) return response.text;

            } else {
                // --- STRATEGY: OPENAI COMPATIBLE (RELAY) ---
                const messages: any[] = [];
                if (systemInfo) messages.push({ role: 'system', content: systemInfo });
                
                let userContent: any = prompt;
                
                // Handle images and attachments for OpenAI Vision format (or text fallback)
                if (images.length > 0 || attachments.length > 0) {
                    userContent = [{ type: "text", text: prompt }];
                    
                    images.forEach(img => {
                        userContent.push({
                            type: "image_url",
                            image_url: { url: `data:image/jpeg;base64,${img}` }
                        });
                    });

                    attachments.forEach(file => {
                        if (file.type === 'youtube') {
                            userContent.push({ type: "text", text: `[Reference YouTube Link: ${file.data}]` });
                        } else if (file.mimeType?.startsWith('text/')) {
                            userContent.push({ type: "text", text: `[File Content: ${file.name}]\n${file.data}` });
                        } else {
                            userContent.push({ type: "text", text: `[Attachment: ${file.name} (Binary data omitted for non-native API)]` });
                        }
                    });
                }
                
                messages.push({ role: 'user', content: userContent });
                const result = await callOpenAICompatible(config, messages, jsonMode);
                if (result) return result;
            }

        } catch (e: any) {
            console.warn(`[Failover] Config ${config.id} failed. Reason: ${e.message}`);
            lastError = e;
            // Continue to next config in the loop
        }
    }

    // If we get here, all candidates failed
    throw new Error(`All API strategies failed. Last Error: ${lastError?.message || 'Unknown'}`);
};

// --- Public Methods ---

export const testApiKey = async (apiKey: string, baseUrl?: string, modelId?: string): Promise<{ success: boolean; message: string }> => {
    try {
        // Special case for Official Native Key testing
        if (baseUrl === 'native') {
            const ai = new GoogleGenAI({ apiKey });
            // Use 'gemini-1.5-flash' for a quick ping test if modelId not provided or generic
            const testModel = modelId?.includes('gemini') ? modelId : 'gemini-1.5-flash';
            await ai.models.generateContent({
                model: testModel,
                contents: 'Ping',
            });
            return { success: true, message: "Google Native Connection Successful! ✅" };
        }

        // Standard OpenAI Compatible Test
        const config = { 
            id: 'test', 
            apiKey: apiKey.trim(), 
            baseUrl: baseUrl?.trim() || '', 
            modelId: modelId?.trim(), 
            taskAssignment: 'default' as TaskType 
        };
        await callOpenAICompatible(config, [{ role: 'user', content: 'Ping. Just say pong.' }]);
        return { success: true, message: "Connection Successful! ✅" };
    } catch (e: any) {
        let msg = e.message;
        if (msg.includes('404') && baseUrl?.includes('googleapis')) {
            msg = "Incorrect Base URL. Please use the 'Google Official' preset for native keys.";
        }
        return { success: false, message: `Failed: ${msg}` };
    }
};

export const generateMailGroupStrategy = async (client: AnalysisResult, productImages: string[], knowledgeBaseFiles: KnowledgeFile[]): Promise<MailGroup> => {
    const prompt = `
    Role: Sales Expert (楠哥的小助理). Write 3 Cold Emails for ${client.companyInfo.name}.
    They sell: ${client.businessScope.coreProducts.join(', ')}.
    Their pain points/weaknesses (from SWOT): ${client.swot.weaknesses.join(', ')}.
    
    Structure:
    1. Analysis: Briefly explain WHY you chose this angle (1 sentence, in Chinese).
    2. Email 1: The Hook (Soft introduction, mentioning their specific product).
    3. Email 2: Value Prop (Focus on profit margin or better supply chain).
    4. Email 3: Case Study/Social Proof (Short & punchy).

    Output JSON: { "analysis": "...", "email1": "...", "email2": "...", "email3": "..." }
    `;
    const text = await generateContentUnified('email', prompt, undefined, true, productImages, knowledgeBaseFiles);
    const res = extractJson(text);
    return {
        analysis: res.analysis || "Generated",
        email1: res.email1 || "Draft 1",
        email2: res.email2 || "Draft 2",
        email3: res.email3 || "Draft 3"
    };
};

export const generateConsolidatedEmailStrategy = async (clients: AnalysisResult[], knowledgeBaseFiles: KnowledgeFile[], context: string = ''): Promise<MailGroup> => {
    if (clients.length === 0) return { analysis: 'No Data', email1: '', email2: '', email3: '' };
    
    const clientSummary = clients.slice(0, 10).map(c => `- ${c.companyInfo.name} (${c.companyInfo.nature})`).join('\n');
    
    const prompt = `
    Role: Sales Expert (楠哥的小助理). 
    Task: Write a Universal Cold Email Sequence suitable for a group of ${clients.length} similar potential clients.
    
    My Campaign Context/Goal: "${context}"
    
    Client Examples in this batch:
    ${clientSummary}
    
    Requirement:
    Create a generalized but high-converting sequence that addresses common pain points in this industry/sector.
    Integrate my Campaign Goal keywords and our product advantages found in the attached Knowledge Base.
    
    Structure:
    1. Analysis: Strategy behind this mass-outreach template (In Chinese).
    2. Email 1: General Industry Hook (Using my context).
    3. Email 2: Product Fit & Value (Referencing KB advantages).
    4. Email 3: Meeting Request.

    Output JSON: { "analysis": "...", "email1": "...", "email2": "...", "email3": "..." }
    `;
    const text = await generateContentUnified('email', prompt, undefined, true, [], knowledgeBaseFiles);
    const res = extractJson(text);
    return {
        analysis: res.analysis || "Generated",
        email1: res.email1 || "Draft 1",
        email2: res.email2 || "Draft 2",
        email3: res.email3 || "Draft 3"
    };
};

export const analyzeCompany = async (domainOrName: string, mode: 'detailed' | 'economy' = 'detailed'): Promise<AnalysisResult> => {
  const prompt = `
  Target: "${domainOrName}".
  Task: DEEP COMMERCIAL INVESTIGATION.
  
  Action:
  1. Identify company nature, scale, and headquarters.
  2. Analyze product pricing, positioning, and supply chain role.
  3. Find 5-10 specific decision makers (Name + Title).
     - **CRITICAL**: Prioritize finding REAL LinkedIn profiles AND REAL professional email addresses.
     - For Name, provide "firstName", "lastName", and "name" (Full Name).
     - You MUST attempt to construct a professional email for every decision maker found. If you cannot find a direct email, use standard professional email patterns (e.g., first.last@company.com, first@company.com) based on the company domain and label it as 'AI (Pattern Guess)'.
     - Look for "Contact Us", "About Us", or "Team" pages to find real names and contact info.
  4. Find 3-5 competitors.
  5. Identify website product categories.
  6. **PRODUCT ANALYSIS (CRITICAL)**: Analyze the company's products in detail:
     - Features/Functions (功能)
     - Colors (颜色)
     - Packaging (包装)
     - Market Preference (分析客户和终端市场的喜好)
     - Recommendation (给出最适合的产品推荐建议)
  7. **CRITICAL**: Search for "SimilarWeb stats", "site traffic", "organic keywords". ESTIMATE if not found. Populate "trafficAnalysis".
  8. **FINANCIAL TRENDS (MANDATORY)**: You MUST provide an ESTIMATE for "revenue" and "procurement" for the last 5 years (2020-2024).
     - If exact financial reports are not public, you MUST ESTIMATE based on: Employee Count * Industry Revenue Per Capita (approx $150k-$300k/employee for trading).
     - Procurement is typically 30-50% of Revenue.
     - **DO NOT RETURN 0**. Give me your best AI estimate based on company size.
  
  IMPORTANT: All text fields (description, positioning, strategy, etc.) MUST be in Simplified Chinese.
  
  Output JSON matching the following structure exactly (no markdown):
  {
    "companyInfo": { "name": "...", "headquarters": "...", "foundedYear": "...", "nature": "...", "scale": "...", "website": "...", "description": "简要中文描述..." },
    "swot": { "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] },
    "financialTrends": [
        { "year": "2020", "revenue": 1000000, "procurement": 300000 },
        { "year": "2021", "revenue": 1200000, "procurement": 400000 },
        { "year": "2022", "revenue": 1500000, "procurement": 500000 },
        { "year": "2023", "revenue": 1800000, "procurement": 600000 },
        { "year": "2024", "revenue": 2000000, "procurement": 700000 }
    ],
    "trafficAnalysis": [
        { "category": "General", "trafficType": "Organic (SEO)", "topKeywords": "brand name, product key", "volumeEst": "Medium" }
    ],
    "websiteCategories": [{ "categoryName": "...", "items": ["..."] }],
    "businessScope": { "coreProducts": [], "relevantProducts": [], "brandPositioning": "...", "consumerGroup": "...", "productVariety": "...", "priceSensitivity": "...", "websiteStructure": "..." },
    "businessModel": { "channels": [], "hasDistributors": false, "exhibitionHistory": [], "ecommercePresence": [], "procurementInfo": "..." },
    "supplyChain": { "role": "...", "serviceType": "..." },
    "targetAudience": [],
    "financials": { "revenueEstimate": "...", "paymentTerms": "...", "ipInfo": "..." },
    "productSummary": {
        "marketPreference": "终端市场喜好分析...",
        "recommendedProducts": "最适合的产品推荐...",
        "packagingAnalysis": "包装风格分析...",
        "colorPreference": "颜色偏好分析...",
        "featureAnalysis": "产品功能特点分析..."
    },
    "socials": { "linkedin": "", "facebook": "" },
    "products": [{ "name": "...", "retailPrice": "...", "retailPriceCNY": 0, "estimatedFOBPriceCNY": 0, "imageUrl": "", "competitorLink": "...", "pricingStrategy": "...", "pitchPoint": "...", "techSpecs": "...", "features": "...", "colors": "...", "packaging": "..." }],
    "marketTrends": "...",
    "decisionMakers": [{ "firstName": "...", "lastName": "...", "name": "...", "title": "...", "emailGuess": "...", "linkedin": "...", "type": "...", "source": "AI", "isVerified": false }],
    "strategy": { "buyingOfficeLocation": "...", "actionPlan": [] },
    "similarCompanies": [{ "name": "...", "website": "...", "country": "...", "mainProducts": "..." }]
  }
  `;

  // 1. Get Basic Analysis
  const text = await generateContentUnified('analysis', prompt, SYSTEM_INSTRUCTION, true);
  const aiResult = extractJson(text);
  
  // Merge Defaults
  const result: AnalysisResult = {
    companyInfo: {
      name: aiResult.companyInfo?.name || domainOrName || "Unknown",
      headquarters: aiResult.companyInfo?.headquarters || "N/A",
      foundedYear: aiResult.companyInfo?.foundedYear || "N/A",
      nature: aiResult.companyInfo?.nature || "N/A",
      scale: aiResult.companyInfo?.scale || "N/A",
      website: aiResult.companyInfo?.website || "N/A",
      description: aiResult.companyInfo?.description || "N/A"
    },
    swot: {
        strengths: aiResult.swot?.strengths || [],
        weaknesses: aiResult.swot?.weaknesses || [],
        opportunities: aiResult.swot?.opportunities || [],
        threats: aiResult.swot?.threats || []
    },
    financialTrends: Array.isArray(aiResult.financialTrends) ? aiResult.financialTrends : [],
    trafficAnalysis: Array.isArray(aiResult.trafficAnalysis) ? aiResult.trafficAnalysis : [],
    websiteCategories: Array.isArray(aiResult.websiteCategories) ? aiResult.websiteCategories : [],
    businessScope: {
      coreProducts: aiResult.businessScope?.coreProducts || [],
      relevantProducts: aiResult.businessScope?.relevantProducts || [],
      brandPositioning: aiResult.businessScope?.brandPositioning || "N/A",
      consumerGroup: aiResult.businessScope?.consumerGroup || "N/A",
      productVariety: aiResult.businessScope?.productVariety || "Medium",
      priceSensitivity: aiResult.businessScope?.priceSensitivity || "N/A",
      websiteStructure: aiResult.businessScope?.websiteStructure || "N/A"
    },
    businessModel: {
      channels: aiResult.businessModel?.channels || [],
      hasDistributors: !!aiResult.businessModel?.hasDistributors,
      exhibitionHistory: aiResult.businessModel?.exhibitionHistory || [],
      ecommercePresence: aiResult.businessModel?.ecommercePresence || [],
      procurementInfo: aiResult.businessModel?.procurementInfo || "N/A"
    },
    supplyChain: {
      role: aiResult.supplyChain?.role || "N/A",
      serviceType: aiResult.supplyChain?.serviceType || "N/A"
    },
    targetAudience: aiResult.targetAudience || [],
    financials: {
      revenueEstimate: aiResult.financials?.revenueEstimate || "N/A",
      paymentTerms: aiResult.financials?.paymentTerms || "N/A",
      ipInfo: aiResult.financials?.ipInfo || "N/A"
    },
    productSummary: {
        marketPreference: aiResult.productSummary?.marketPreference || "N/A",
        recommendedProducts: aiResult.productSummary?.recommendedProducts || "N/A",
        packagingAnalysis: aiResult.productSummary?.packagingAnalysis || "N/A",
        colorPreference: aiResult.productSummary?.colorPreference || "N/A",
        featureAnalysis: aiResult.productSummary?.featureAnalysis || "N/A"
    },
    socials: aiResult.socials || {},
    products: (Array.isArray(aiResult.products) ? aiResult.products : []).map((p: any) => ({
        ...p,
        features: p.features || "N/A",
        colors: p.colors || "N/A",
        packaging: p.packaging || "N/A"
    })),
    marketTrends: aiResult.marketTrends || "N/A",
    decisionMakers: (aiResult.decisionMakers || []).map((dm: any) => ({ ...dm, source: 'AI', isVerified: false })),
    strategy: {
      buyingOfficeLocation: aiResult.strategy?.buyingOfficeLocation || "N/A",
      actionPlan: aiResult.strategy?.actionPlan || []
    },
    similarCompanies: Array.isArray(aiResult.similarCompanies) ? aiResult.similarCompanies : []
  };

  // 2. External Enrichment (Email Hunting)
  const targetDomain = result.companyInfo.website !== 'N/A' ? result.companyInfo.website : domainOrName;
  if (targetDomain && targetDomain.includes('.')) {
      try {
          const [hunterData, findy, anymail] = await Promise.all([
              fetchHunterEmails(targetDomain),
              fetchFindymail(targetDomain),
              fetchAnymailFinder(targetDomain)
          ]);
          
          const hunter = hunterData.people;
          const pattern = hunterData.pattern;
          const allExtra = [...hunter, ...findy, ...anymail];
          
          // Merge logic
          const existingNames = new Set(result.decisionMakers.map(dm => dm.name.toLowerCase()));
          
          // For AI found people, try to find/verify their emails using specific finder APIs
          for (const dm of result.decisionMakers) {
              if (dm.source === 'AI' && dm.firstName && targetDomain) {
                  // Try Hunter Email Finder for this specific person
                  const hunterEmail = await findEmailWithHunter(dm.firstName, dm.lastName || '', targetDomain);
                  if (hunterEmail && hunterEmail.confidence > 70) {
                      dm.emailGuess = hunterEmail.email;
                      dm.isVerified = hunterEmail.confidence > 90;
                      dm.confidence = hunterEmail.confidence;
                      dm.source = 'Hunter.io';
                  } else if (dm.name) {
                      // Try Findymail
                      const findyEmail = await findEmailWithFindymail(dm.name, targetDomain);
                      if (findyEmail) {
                          dm.emailGuess = findyEmail.email;
                          dm.isVerified = findyEmail.isVerified;
                          dm.source = 'Findymail';
                      }
                  }
                  
                  // If still no email but we have a pattern from Hunter
                  if (!dm.emailGuess && pattern && dm.firstName) {
                      const guessed = pattern
                          .replace('{first}', dm.firstName.toLowerCase())
                          .replace('{last}', (dm.lastName || '').toLowerCase())
                          .replace('{f}', dm.firstName[0].toLowerCase())
                          .replace('{l}', (dm.lastName || '')[0]?.toLowerCase() || '');
                      
                      dm.emailGuess = `${guessed}@${cleanDomain(targetDomain)}`;
                      dm.source = 'AI (Pattern Guess)';
                  }
              }
          }

          const newPeople = allExtra.filter(p => p.name && !existingNames.has(p.name.toLowerCase()));
          result.decisionMakers = [...result.decisionMakers, ...newPeople];
      } catch (e) { console.error("External API enrichment failed", e); }
  }

  // 3. Generate Email Strategy (ONLY IF DETAILED MODE)
  // If economy mode, we skip this to save tokens, and generate one at the end of the batch.
  if (mode === 'detailed') {
      try {
          const kbFiles = await getAllFilesFromDB();
          const emailStrategy = await generateMailGroupStrategy(result, [], kbFiles);
          result.generatedEmails = emailStrategy;
      } catch (e) {
          console.error("Failed to generate initial email strategy", e);
      }
  }

  return result;
};

// Add this function to export
export const searchPotentialClients = async (productKeyword: string, country: string, industry: string = '', clientType: string = '', limit: number = 200): Promise<ClientSearchResult[]> => {
  // Explicitly requested 200 items in prompt
  const prompt = `
  Act as a high-performance B2B Database Crawler (楠哥的小助理). 
  Task: List ${limit} (aim for 200) REAL potential B2B clients in ${country} for product "${productKeyword}". 
  Industry: ${industry}. 
  Types to Include: ${clientType || 'Any B2B type (Importers, Distributors, Wholesalers, Brands)'}.
  
  Important:
  - Return REAL companies with active websites.
  - Focus on finding as many valid targets as possible (Max ${limit}).
  - **Description MUST be in Simplified Chinese (简体中文).**
  
  Return a valid JSON Array ONLY. No text.
  Format: [{ "name": "Company Name", "website": "www.example.com", "description": "Short Description in Chinese", "country": "${country}" }]
  `;
  try {
    const text = await generateContentUnified('search', prompt, undefined, true);
    return extractJson(text, true);
  } catch (err) {
    console.error("Search Failed:", err);
    return [];
  }
};

export const streamStrategyChat = async function* (
    history: ChatMessage[],
    knowledgeBase: KnowledgeFile[], 
    newMessage: string, 
    newAttachments: KnowledgeFile[],
    companyData?: AnalysisResult | null
) {
    // Uses generic Chat assignment or default
    const aiConfig = getGeminiConfig().find(c => c.taskAssignment === 'chat') || { id: 'default', apiKey: '', baseUrl: '', modelId: 'gemini-1.5-pro' }; 
    // Fallback logic for streaming is complex due to mixed SDKs. 
    // For now, we prioritize Native if ENV is present, else use Relay without streaming or with partial support.
    
    const useNative = !!process.env.API_KEY;
    
    let systemInstruction = `You are 楠哥的小助理 (Nan Ge's Assistant), a Senior Trade Strategist. Speak primarily in Chinese (简体中文) unless asked otherwise.`;
    if (companyData) systemInstruction += ` Context: Analyzing ${companyData.companyInfo.name}.`;
    if (knowledgeBase.length > 0) {
        const kbText = knowledgeBase.map(f => `[KB: ${f.name}]\n${f.data.substring(0, 500)}...`).join("\n\n");
        systemInstruction += `\n\nSystem Knowledge Base:\n${kbText}`;
    }

    if (useNative) {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const chatHistory = history
            .filter(m => m.id !== 'init')
            .map(m => ({ role: m.role, parts: [{ text: m.text }] }));

        const chat = ai.chats.create({
            model: NATIVE_MODEL,
            config: { systemInstruction },
            history: chatHistory
        });

        const parts: Part[] = [{ text: newMessage }];
        for (const file of newAttachments) {
             if (file.type === 'youtube') {
                 parts.push({ text: `[Reference YouTube Link: ${file.data}]` });
             } else if (file.mimeType && file.data) {
                 parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
             } else {
                 parts.push({ inlineData: { mimeType: 'application/octet-stream', data: file.data } });
             }
        }

        const result = await chat.sendMessageStream({ message: parts });
        for await (const chunk of result) {
            yield chunk.text;
        }
    } else {
        // Fallback to Relay (Non-streaming for now as Adapter doesn't support stream yet in this implementation)
        // Using generateContentUnified logic but adapted for chat context
        const messages: any[] = [
            { role: 'system', content: systemInstruction },
            ...history.filter(m=>m.id!=='init').map(m => ({ role: m.role, content: m.text })),
            { role: 'user', content: newMessage }
        ];
        
        // This relies on getGeminiConfig finding a key
        const configs = getGeminiConfig();
        const config = configs.find(c => c.taskAssignment === 'chat') || configs[0];
        if(!config) throw new Error("No Chat API Configured");

        const text = await callOpenAICompatible(config, messages);
        yield text;
    }
};

export const extractKeywordsFromMedia = async (file: KnowledgeFile): Promise<KeywordExtractionResult> => {
    const prompt = `Analyze this product image/doc. Extract: 1. Industry Terms 2. Tier 1 Keywords 3. Tier 2 Keywords. Output JSON: { "industryTerms": [], "tier1Keywords": [], "tier2Keywords": [] }`;
    const text = await generateContentUnified('keywords', prompt, undefined, true, [file.data]);
    return extractJson(text);
};

export const generateColdEmail = async (companyName: string, request: EmailTemplateRequest): Promise<string> => {
  const prompt = `Write a Cold Email for ${companyName}. Style: ${request.style}. Context: ${request.sourceContext}. Product: ${request.ourProducts}. Advantages: ${request.advantages}. Hook: ${request.personalHook}.`;
  return await generateContentUnified('email', prompt, SYSTEM_INSTRUCTION);
};
