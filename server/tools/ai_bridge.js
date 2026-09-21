// Local-first AI bridge. Ollama is the default; Gemini is opt-in via AI_PROVIDER=gemini.
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:1.5b';
const DEFAULT_OLLAMA_TIMEOUT_MS = 180000;
const DEFAULT_OLLAMA_CODE_NUM_PREDICT = 8192;

function loadEnv() {
    const cfg = { ...process.env };
    for (const envName of ['.env', '.env.env']) {
        const envPath = path.join(__dirname, '..', envName);
        try {
            const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
                const idx = trimmed.indexOf('=');
                const key = trimmed.slice(0, idx).trim();
                if (cfg[key] !== undefined) continue;
                cfg[key] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            }
        } catch (_) {
            // An env file is optional; process.env remains the source of truth.
        }
    }
    return cfg;
}

function postJson(endpoint, data, timeoutMs) {
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(data);

    return new Promise((resolve, reject) => {
        const req = transport.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let output = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { output += chunk; });
            res.on('end', () => {
                let parsed = output;
                try { parsed = output ? JSON.parse(output) : {}; } catch (_) {}
                resolve({ status: res.statusCode || 0, body: parsed });
            });
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function describeError(body) {
    if (typeof body === 'string') return body.slice(0, 500);
    return body?.error?.message || body?.error || body?.message || JSON.stringify(body).slice(0, 500);
}

function bridgeError(provider, message, details = {}) {
    const error = new Error(`[${provider}] ${message}`);
    error.provider = provider;
    Object.assign(error, details);
    return error;
}

async function ollamaRequest(prompt, systemPrompt, timeoutMs, cfg, options = {}) {
    const baseUrl = (cfg.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    const model = cfg.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
    let response;
    try {
        response = await postJson(`${baseUrl}/api/generate`, {
            model,
            prompt,
            system: systemPrompt || undefined,
            stream: false,
            options: {
                temperature: 0.3,
                ...(options.numPredict ? { num_predict: options.numPredict } : {}),
            },
        }, timeoutMs);
    } catch (error) {
        throw bridgeError('ollama', `connection failed at ${baseUrl}: ${error.message}`, { cause: error });
    }

    if (response.status < 200 || response.status >= 300) {
        throw bridgeError('ollama', `API request failed with HTTP ${response.status}: ${describeError(response.body)}`, {
            status: response.status,
        });
    }
    const text = typeof response.body?.response === 'string' ? response.body.response.trim() : '';
    if (!text) throw bridgeError('ollama', 'API returned no response text');
    return { text, model };
}

async function geminiGenerate(prompt, systemPrompt, timeoutMs, cfg) {
    const apiKey = cfg.OPENAI_API_KEY || '';
    const model = (cfg.OPENAI_MODEL || 'gemini-2.5-flash').replace('models/', '');
    if (!apiKey) throw bridgeError('gemini', 'AI_PROVIDER=gemini requires OPENAI_API_KEY');

    const requestBody = {
        contents: [
            ...(systemPrompt ? [
                { role: 'user', parts: [{ text: systemPrompt }] },
                { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ] : []),
            { role: 'user', parts: [{ text: prompt }] },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 65536, responseMimeType: 'text/plain' },
    };
    let response;
    try {
        response = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, requestBody, timeoutMs);
    } catch (error) {
        throw bridgeError('gemini', `connection failed: ${error.message}`, { cause: error });
    }
    if (response.status !== 200) {
        throw bridgeError('gemini', `API request failed with HTTP ${response.status}: ${describeError(response.body)}`, {
            status: response.status,
            quotaFailure: response.status === 429,
        });
    }
    const text = response.body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!text) throw bridgeError('gemini', 'API returned no response text');
    return { text, model };
}

export async function generate(prompt, systemPrompt = '', timeoutMs = 90000, options = {}) {
    const cfg = loadEnv();
    const provider = String(cfg.AI_PROVIDER || 'ollama').trim().toLowerCase();
    if (provider === 'ollama' || provider === 'local') {
        return ollamaRequest(String(prompt || ''), String(systemPrompt || ''), timeoutMs, cfg, options);
    }
    if (provider === 'gemini') {
        return geminiGenerate(String(prompt || ''), String(systemPrompt || ''), timeoutMs, cfg);
    }
    throw bridgeError('config', `unsupported AI_PROVIDER "${provider}"; use "ollama" or explicitly "gemini"`);
}

export const ollamaGenerate = generate;

export function cloudBridge(systemText, userText, mode = 'chat', timeoutMs = 90000) {
    const fullPrompt = systemText ? `${systemText}\n\n---\n\n${userText}` : userText;
    const cfg = loadEnv();
    const configuredTimeout = Number(cfg.OLLAMA_TIMEOUT_MS || DEFAULT_OLLAMA_TIMEOUT_MS);
    const effectiveTimeout = mode === 'code'
        ? Math.max(timeoutMs, configuredTimeout, DEFAULT_OLLAMA_TIMEOUT_MS)
        : timeoutMs;
    const codeNumPredict = Number(cfg.OLLAMA_CODE_NUM_PREDICT || DEFAULT_OLLAMA_CODE_NUM_PREDICT);
    return generate(fullPrompt, '', effectiveTimeout, mode === 'code' ? { numPredict: codeNumPredict } : {});
}
