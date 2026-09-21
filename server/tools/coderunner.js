// ============================================================
// Code Runner Tool — مجرّب الأكواد المعزول (JS/Python بمهلة)
// ------------------------------------------------------------
// "جرّب قبل التسليم": يستخرج أول كتلة ```js|python من الطلب،
// يشغّلها في مجلد مؤقت معزول (E:\SurasData\tmp-runner — لا C:),
// ويعيد المخرجات أو الخطأ (الخطأ وقود حلقة التصحيح الذاتي).
// الحدود: مهلة 15s، مخرجات 3000 حرف، بلا shell وسيط (spawn مباشر)،
// لا إنترنت مفترضاً، ولا تنفيذ بلا كتلة كود + فعل تجربة صريح
// (حتى لا يخطف تدفقات البناء التي تلصق كوداً).
// ============================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { scoreKeywords } from './classifier.js';

const FENCE_RE = /```(js|javascript|python|py)\s*\n?([\s\S]*?)```/i;
const TRY_VERBS = /(جرب|جرّب|شغل|نفذ|اختبر|try|run|test|execute)/i;

function extractSnippet(text) {
    const m = FENCE_RE.exec(String(text || ''));
    if (!m) return null;
    let lang = m[1].toLowerCase();
    if (lang === 'js') lang = 'javascript';
    if (lang === 'py') lang = 'python';
    const code = (m[2] || '').trim();
    if (!code || code.length > 20000) return null;
    return { lang, code };
}

export const CODERUNNER_TOOL = {
    name: 'code-runner',
    description: 'تجربة مقتطف JS/Python معزولة بمهلة وإعادة المخرجات أو الخطأ',
    searchHint: 'جرب الكود، شغل سكريبت، try code',
    keywords: [
        { term: 'جرب', weight: 3 }, { term: 'جرّب', weight: 3 },
        { term: 'اختبر', weight: 2 }, { term: 'try', weight: 2 },
        { term: 'test', weight: 1 }, { term: 'كود', weight: 1 },
        { term: 'سكريبت', weight: 1 },
    ],
    threshold: 5,
    timeoutMs: 30000,

    matches(query) {
        const text = String(query || '');
        if (!TRY_VERBS.test(text)) return null;
        if (!extractSnippet(text)) return null;
        const { score } = scoreKeywords(text, CODERUNNER_TOOL.keywords, 'code-runner');
        if (score < 5) return { score: 6 };
        return { score, hits: [] };
    },

    async run(query, ctx) {
        const { io } = ctx;
        const obs = [];
        const snip = extractSnippet(query);
        if (!snip) {
            obs.push('[مجرّب الأكواد بلا كتلة]: الصق الكتلة بين ```js أو ```python مع فعل تجربة وسأشغّلها.');
            return obs;
        }
        const tmpDir = path.join('E:', 'SurasData', 'tmp-runner');
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
        const stamp = Date.now();
        const file = path.join(tmpDir, snip.lang === 'python' ? `run_${stamp}.py` : `run_${stamp}.js`);
        try { fs.writeFileSync(file, snip.code, 'utf-8'); } catch (e) {
            obs.push(`[تعذر كتابة المقتطف المؤقت]: ${e.message}`);
            return obs;
        }
        const isPy = snip.lang === 'python';
        const exe = isPy ? 'E:\\Python313\\python.exe' : 'node';
        const args = [file];
        try { io.emit('agent-update', { agent: 'CodeRunner', role: 'Running', text: `🧪 أجرّب مقتطف ${snip.lang}...`, theme: 'purple' }); } catch (_) {}
        const out = await new Promise((resolve) => {
            let acc = '';
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            try {
                const child = spawn(exe, args, { cwd: tmpDir, timeout: 15000 });
                child.stdout.on('data', (d) => { acc += d.toString(); });
                child.stderr.on('data', (d) => { acc += d.toString(); });
                child.on('close', (c) => finish({ code: c === null ? 1 : c, text: acc }));
                child.on('error', (e) => finish({ code: 1, text: acc + e.message }));
                setTimeout(() => { try { child.kill(); } catch (_) {} finish({ code: 124, text: acc + '\n[مهلة 15s]' }); }, 17000);
            } catch (e) { finish({ code: 1, text: String(e.message || e) }); }
        });
        try { fs.unlinkSync(file); } catch (_) {}
        const body = String(out.text || '(بلا مخرجات)').slice(0, 3000);
        if (out.code === 0) {
            obs.push(`[تجربة ${snip.lang} ناجحة (رمز 0)]:\n${body}`);
            try { io.emit('agent-update', { agent: 'CodeRunner', role: 'Done', text: `✅ نجح المقتطف`, theme: 'green' }); } catch (_) {}
        } else {
            obs.push(`[تجربة ${snip.lang} فشلت (رمز ${out.code}) — وقود التصحيح]:\n${body}`);
            try { io.emit('agent-update', { agent: 'CodeRunner', role: 'Error', text: `❌ فشل المقتطف (رمز ${out.code})`, theme: 'red' }); } catch (_) {}
        }
        return obs;
    },
};

export function __coderunnerExtract(text) { return extractSnippet(text); }
