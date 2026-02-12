import { AliyunConfig, EmailTemplate } from "../types";

// Helper for HMAC-SHA1 signature using Web Crypto API
async function signString(stringToSign: string, accessKeySecret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(accessKeySecret + "&");
    const data = encoder.encode(stringToSign);

    const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, data);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// Generate Timestamp in ISO8601 UTC format (YYYY-MM-DDThh:mm:ssZ)
function getTimestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}/, '');
}

// Generate Unique Nonce
function getNonce(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Percent Encode (Specific to Aliyun specs)
function percentEncode(str: string): string {
    return encodeURIComponent(str)
        .replace(/\!/g, '%21')
        .replace(/\'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
}

export const sendSingleMail = async (
    config: AliyunConfig,
    toAddress: string,
    subject: string,
    htmlBody: string
): Promise<{ success: boolean; message: string; requestId?: string }> => {
    
    if (!config.accessKeyId || !config.accessKeySecret || !config.accountName) {
        return { success: false, message: "Missing API Configuration" };
    }

    const params: Record<string, string> = {
        // System Parameters
        "Format": "JSON",
        "Version": "2015-11-23",
        "AccessKeyId": config.accessKeyId,
        "SignatureMethod": "HMAC-SHA1",
        "Timestamp": getTimestamp(),
        "SignatureVersion": "1.0",
        "SignatureNonce": getNonce(),
        "RegionId": config.regionId || "dm.aliyuncs.com", // Usually mapped to endpoint
        
        // Business Parameters
        "Action": "SingleSendMail",
        "AccountName": config.accountName,
        "ReplyToAddress": config.replyToAddress ? "true" : "false",
        "AddressType": String(config.addressType),
        "ToAddress": toAddress,
        "Subject": subject,
        "HtmlBody": htmlBody,
        "FromAlias": config.fromAlias || "DirectMail",
        "ClickTrace": "1"
    };

    if (config.tagName) {
        params["TagName"] = config.tagName;
    }

    // 1. Sort Parameters
    const sortedKeys = Object.keys(params).sort();
    
    // 2. Canonicalized Query String
    const canonicalizedQueryString = sortedKeys.map(key => {
        return percentEncode(key) + "=" + percentEncode(params[key]);
    }).join("&");

    // 3. StringToSign
    const stringToSign = "POST" + "&" + percentEncode("/") + "&" + percentEncode(canonicalizedQueryString);

    // 4. Signature
    const signature = await signString(stringToSign, config.accessKeySecret);
    
    // 5. Final Body
    // Note: We send as x-www-form-urlencoded
    const bodyParams = new URLSearchParams();
    sortedKeys.forEach(key => bodyParams.append(key, params[key]));
    bodyParams.append("Signature", signature);

    // 6. Send Request
    // IMPORTANT: Browser will block this with CORS unless a plugin is used or Aliyun allows it (rare).
    // The endpoint depends on Region. 'dm.aliyuncs.com' is Global/Hangzhou default.
    // ap-southeast-1: dm.ap-southeast-1.aliyuncs.com
    
    let endpoint = "https://dm.aliyuncs.com/";
    if (config.regionId === 'ap-southeast-1') endpoint = "https://dm.ap-southeast-1.aliyuncs.com/";
    if (config.regionId === 'ap-southeast-2') endpoint = "https://dm.ap-southeast-2.aliyuncs.com/";

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: bodyParams
        });

        const data = await response.json();

        if (response.ok) {
            return { success: true, message: "Sent", requestId: data.RequestId };
        } else {
            return { success: false, message: data.Message || data.Code || "Unknown Error" };
        }
    } catch (e: any) {
        // Likely CORS error if without plugin
        if (e.message === "Failed to fetch") {
            return { success: false, message: "Network Error (CORS). Please install 'Allow CORS' browser extension." };
        }
        return { success: false, message: e.message };
    }
};

export const loadEmailTemplates = (): EmailTemplate[] => {
    const saved = localStorage.getItem('trade_scout_email_templates');
    return saved ? JSON.parse(saved) : [];
};

export const saveEmailTemplate = (template: EmailTemplate) => {
    const templates = loadEmailTemplates();
    const idx = templates.findIndex(t => t.id === template.id);
    if (idx >= 0) templates[idx] = template;
    else templates.push(template);
    localStorage.setItem('trade_scout_email_templates', JSON.stringify(templates));
};

export const deleteEmailTemplate = (id: string) => {
    const templates = loadEmailTemplates().filter(t => t.id !== id);
    localStorage.setItem('trade_scout_email_templates', JSON.stringify(templates));
};

export const getAliyunConfig = (): AliyunConfig => {
    const saved = localStorage.getItem('trade_scout_aliyun_config');
    return saved ? JSON.parse(saved) : {
        accessKeyId: '',
        accessKeySecret: '',
        accountName: '',
        fromAlias: '',
        replyToAddress: true,
        addressType: 1,
        tagName: '',
        regionId: 'dm.aliyuncs.com'
    };
};

export const saveAliyunConfig = (config: AliyunConfig) => {
    localStorage.setItem('trade_scout_aliyun_config', JSON.stringify(config));
};