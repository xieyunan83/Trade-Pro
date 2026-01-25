

import { GoogleGenAI, Type, Part } from "@google/genai";
import { AnalysisResult, ClientSearchResult, DecisionMaker, ChatMessage, KnowledgeFile, KeywordExtractionResult, MailGroup, EmailTemplateRequest, ApiConfig, TaskType } from "../types";
import { getAllFilesFromDB } from "./db";

// API Keys Configuration
// SECURITY UPDATE: Keys are now read from process.env to prevent leaking on GitHub.
// Please set these in your .env file locally, or in your Vercel/Netlify dashboard.
const HUNTER_API_KEY = process.env.HUNTER_API_KEY || ''; 
const FINDYMAIL_API_KEY = process.env.FINDYMAIL_API_KEY || ''; 
const ANYMAIL_FINDER_API_KEY = process.env.ANYMAIL_FINDER_API_KEY || '';

const NATIVE_MODEL = 'gemini-3-pro-preview';

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
    let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("JSON Extraction Error:", e);
    return isArray ? [] : {};
  }
};

const cleanDomain = (domain: string) => domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];

// --- External APIs ---
const fetchHunterEmails = async (domain: string): Promise<DecisionMaker[]> => {
    if (!domain || !HUNTER_API_KEY) return [];
    try {
        const url = `https://api.hunter.io/v2/domain-search?domain=${cleanDomain(domain)}&api_key=${HUNTER_API_KEY}&limit=20`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.data && data.data.emails) {
            return data.data.emails.map((e: any) => ({
                name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Professional',
                title: e.position || 'Employee',
                emailGuess: e.value,
                linkedin: e.linkedin,
                type: (e.position?.toLowerCase().match(/ceo|founder|owner|president/) ? 'CEO' : e.position?.toLowerCase().match(/buyer|procurement|purchasing|sourcing|manager/) ? 'Buyer' : 'Other'),
                source: 'Hunter.io',
                isVerified: e.confidence > 80,
                confidence: e.confidence
            }));
        }
    } catch (error) { console.error("Hunter API Error", error); }
    return [];
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
                return parsed.filter((c: ApiConfig) => c.apiKey && c.apiKey.trim() !== '');
            } catch (e) {
                console.error("Failed to parse stored API configs", e);
            }
        }
    }
    return [];
};

// --- OpenAI Adapter for Relay Services (hiapi, etc) ---
const callOpenAICompatible = async (config: ApiConfig, messages: any[], jsonMode: boolean = false): Promise<string> => {
    // Construct URL: remove trailing slash, ensure /chat/completions
    let baseUrl = config.baseUrl || "https://api.openai.com/v1";
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    if (!baseUrl.endsWith('/chat/completions')) baseUrl += '/chat/completions';

    // Model Mapping fallback
    let model = config.modelId || 'gemini-1.5-pro';
    
    const payload: any = {
        model: model,
        messages: messages,
        temperature: 0.7,
        stream: false
    };

    if (jsonMode) {
        payload.response_format = { type: "json_object" };
    }

    try {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Relay API Error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e: any) {
        console.error("OpenAI Adapter Failed:", e);
        throw e;
    }
};

// --- Unified Generator with Strict Priority & Failover ---
const generateContentUnified = async (
    task: TaskType, 
    prompt: string, 
    systemInfo?: string, 
    jsonMode: boolean = false, 
    images: string[] = [] // base64 strings
): Promise<string> => {
    
    // --- STRATEGY 1: NATIVE GOOGLE KEY (FREE QUOTA) ---
    // User requested gemini-3-pro-preview for free tier first.
    if (process.env.API_KEY) {
        try {
            console.log(`Trying Strategy 1: Native Google API with ${NATIVE_MODEL}...`);
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const parts: Part[] = [{ text: prompt }];
            images.forEach(img => {
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } });
            });

            const reqConfig: any = {
                systemInstruction: systemInfo,
            };
            
            if (jsonMode) {
                reqConfig.responseMimeType = "application/json";
            } else {
                reqConfig.tools = [{ googleSearch: {} }]; 
            }

            const response = await ai.models.generateContent({
                model: NATIVE_MODEL,
                contents: [{ role: 'user', parts }],
                config: reqConfig
            });
            
            if (response.text) return response.text;
        } catch (e: any) {
            console.warn("Strategy 1 (Native) Failed. Falling back to Admin Keys...", e);
            // Proceed to Strategy 2
        }
    }

    // --- STRATEGY 2: ADMIN CONFIGURED KEYS (RELAY/CUSTOM) ---
    const adminConfigs = getGeminiConfig();
    
    if (adminConfigs.length === 0) {
        throw new Error("Strategy 1 failed (or no key) and no Admin Keys configured.");
    }

    // Sort: Specific Task Assignment first, then Default
    const sortedConfigs = adminConfigs.sort((a, b) => {
        if (a.taskAssignment === task) return -1;
        if (b.taskAssignment === task) return 1;
        return 0;
    });

    for (const config of sortedConfigs) {
        try {
            console.log(`Trying Strategy 2: Admin Key ID ${config.id} (${config.baseUrl})...`);
            
            // OpenAI Adapter Mode for Relay
            const messages: any[] = [];
            if (systemInfo) messages.push({ role: 'system', content: systemInfo });
            
            let userContent: any = prompt;
            
            // Handle images for OpenAI Vision format
            if (images.length > 0) {
                userContent = [{ type: "text", text: prompt }];
                images.forEach(img => {
                    userContent.push({
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${img}` }
                    });
                });
            }
            
            messages.push({ role: 'user', content: userContent });
            const result = await callOpenAICompatible(config, messages, jsonMode);
            if (result) return result;

        } catch (e) {
            console.error(`Config ${config.id} failed, trying next...`, e);
            continue; 
        }
    }

    throw new Error("All API strategies failed. Please check your Quota or Admin Configuration.");
};

// --- Public Methods ---

export const testApiKey = async (apiKey: string, baseUrl?: string, modelId?: string): Promise<{ success: boolean; message: string }> => {
    try {
        const config = { id: 'test', apiKey, baseUrl: baseUrl || '', modelId, taskAssignment: 'default' as TaskType };
        await callOpenAICompatible(config, [{ role: 'user', content: 'Ping' }]);
        return { success: true, message: "Relay Connection Successful! ✅" };
    } catch (e: any) {
        return { success: false, message: `Failed: ${e.message}` };
    }
};

export const generateMailGroupStrategy = async (client: AnalysisResult, productImages: string[], knowledgeBaseFiles: KnowledgeFile[]): Promise<MailGroup> => {
    const kbText = knowledgeBaseFiles.map(f => `[KB: ${f.name}]`).join(", ");
    const prompt = `
    Role: Sales Expert (楠哥的小助理). Write 3 Cold Emails for ${client.companyInfo.name}.
    They sell: ${client.businessScope.coreProducts.join(', ')}.
    Their pain points/weaknesses (from SWOT): ${client.swot.weaknesses.join(', ')}.
    My KB Refs: ${kbText}.
    
    Structure:
    1. Analysis: Briefly explain WHY you chose this angle (1 sentence, in Chinese).
    2. Email 1: The Hook (Soft introduction, mentioning their specific product).
    3. Email 2: Value Prop (Focus on profit margin or better supply chain).
    4. Email 3: Case Study/Social Proof (Short & punchy).

    Output JSON: { "analysis": "...", "email1": "...", "email2": "...", "email3": "..." }
    `;
    const text = await generateContentUnified('email', prompt, undefined, true, productImages);
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
    
    const kbText = knowledgeBaseFiles.map(f => `[KB: ${f.name}]`).join(", ");
    const clientSummary = clients.slice(0, 10).map(c => `- ${c.companyInfo.name} (${c.companyInfo.nature})`).join('\n');
    
    const prompt = `
    Role: Sales Expert (楠哥的小助理). 
    Task: Write a Universal Cold Email Sequence suitable for a group of ${clients.length} similar potential clients.
    
    My Campaign Context/Goal: "${context}"
    
    My KB Refs (Our Products/Catalog): ${kbText}
    
    Client Examples in this batch:
    ${clientSummary}
    
    Requirement:
    Create a generalized but high-converting sequence that addresses common pain points in this industry/sector.
    Integrate my Campaign Goal keywords and our product advantages found in KB.
    
    Structure:
    1. Analysis: Strategy behind this mass-outreach template (In Chinese).
    2. Email 1: General Industry Hook (Using my context).
    3. Email 2: Product Fit & Value (Referencing KB advantages).
    4. Email 3: Meeting Request.

    Output JSON: { "analysis": "...", "email1": "...", "email2": "...", "email3": "..." }
    `;
    const text = await generateContentUnified('email', prompt, undefined, true);
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
  4. Find 3-5 competitors.
  5. Identify website product categories.
  6. **CRITICAL**: Search for "SimilarWeb stats", "site traffic", "organic keywords". ESTIMATE if not found. Populate "trafficAnalysis".
  7. **FINANCIAL TRENDS (MANDATORY)**: You MUST provide an ESTIMATE for "revenue" and "procurement" for the last 5 years (2020-2024).
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
    "socials": { "linkedin": "", "facebook": "" },
    "products": [{ "name": "...", "retailPrice": "...", "retailPriceCNY": 0, "estimatedFOBPriceCNY": 0, "imageUrl": "", "competitorLink": "...", "pricingStrategy": "...", "pitchPoint": "...", "techSpecs": "..." }],
    "marketTrends": "...",
    "decisionMakers": [{ "name": "...", "title": "...", "emailGuess": "...", "linkedin": "...", "type": "...", "source": "AI", "isVerified": false }],
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
    socials: aiResult.socials || {},
    products: Array.isArray(aiResult.products) ? aiResult.products : [],
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
          const [hunter, findy, anymail] = await Promise.all([
              fetchHunterEmails(targetDomain),
              fetchFindymail(targetDomain),
              fetchAnymailFinder(targetDomain)
          ]);
          const allExtra = [...hunter, ...findy, ...anymail];
          const existingNames = new Set(result.decisionMakers.map(dm => dm.name.toLowerCase()));
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
    
    let useNative = !!process.env.API_KEY;
    
    let systemInstruction = `You are 楠哥的小助理 (Nan Ge's Assistant), a Senior Trade Strategist. Speak primarily in Chinese (简体中文) unless asked otherwise.`;
    if (companyData) systemInstruction += ` Context: Analyzing ${companyData.companyInfo.name}.`;
    if (knowledgeBase.length > 0) {
        const kbText = knowledgeBase.map(f => `[KB: ${f.name}]\n${atob(f.data).substring(0, 500)}...`).join("\n\n");
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
             parts.push({ inlineData: { mimeType: file.type, data: file.data } });
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
