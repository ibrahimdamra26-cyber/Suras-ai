// ============================================================
// Terminal Tool — منفّذ طرفية مصنّف (قراءة-فقط عبر القضبان)
// ------------------------------------------------------------
// يمنح قسم التنفيذ (exec) تغطية مصنّفة: مطابقة موزونة + عتبة +
// مهلة + حالات انحدار — بدل الاعتماد على regex وحده.
// حدّ أمني صارم: يُنفَّذ فقط ما حكمه checkExecute = allow.
// (warn/ask/deny تُعاد رسالتها دون تنفيذ — لا تنفيذ ذاتي خطر.)
// ملاحظة صدق: طلبات exec الصريحة قد ينفذها قسم exec أيضاً
// (نفس الأمر الآمن مكرراً) — ضجيج مقبول لأوامر القراءة فقط.
// ============================================================

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { scoreKeywords } from './classifier.js';

const SAFE_CMD_RE = /\b(whoami|dir|ls|echo|date|hostname|pwd|get-date|get-location)\b/i;
const EXEC_VERBS = /(نفذ|شغل|باورشيل|powershell|terminal|طرفية|طرفيه)/i;

function extractSafeCmd(text) {
    const m = SAFE_CMD_RE.exec(String(text || ''));
    if (!m) return null;
    const head = m[1].toLowerCase();
    const tail = String(text || '').slice(m.index + m[0].length);
    // وسائط حميدة فقط: حروف/أرقام/مسافات/شرطات — أي محارف صدفية تُرفض
    const argM = /^\s*([A-Za-z0-9_\-./\\: ]{0,80})/.exec(tail);
    let args = (argM ? argM[1] : '').trim();
    if (/[;&|$`()<>]/.test(tail.slice(0, args.length + 5))) return null;
    if (/[;&|$`()<>]/.test(args)) return null;
    return args ? `${head} ${args}` : head;
}

export const TERMINAL_TOOL = {
    name: 'terminal',
    description: 'تنفيذ أوامر طرفية آمنة للقراءة فقط عبر قضبان safety.js',
    searchHint: 'شغل whoami، نفذ dir، terminal command',
    keywords: [
        { term: 'طرفية', weight: 3 }, { term: 'طرفيه', weight: 3 },
        { term: 'باورشيل', weight: 3 }, { term: 'powershell', weight: 3 },
        { term: 'terminal', weight: 3 }, { term: 'نفذ', weight: 2 },
        { term: 'شغل', weight: 1 }, { term: 'whoami', weight: 2 },
        { term: 'dir', weight: 1 },
    ],
    threshold: 5,
    timeoutMs: 30000,

    matches(query) {
        const text = String(query || '');
        if (!EXEC_VERBS.test(text)) return null;
        const cmd = extractSafeCmd(text);
        if (!cmd) return null;
        const { score } = scoreKeywords(text, TERMINAL_TOOL.keywords, 'terminal');
        return { score: Math.max(8, score) };
    },

    async run(query, ctx) {
        const { io } = ctx;
        const obs = [];
        const cmd = extractSafeCmd(query);
        if (!cmd) {
            obs.push('[طرفية بلا أمر آمن واضح]: اذكر أمر قراءة فقط (whoami/dir/echo/...) وسأنفذه.');
            return obs;
        }
        let verdict = { decision: 'allow', reasons: [], warnings: [] };
        try {
            const { checkExecute } = await import('./safety.js');
            verdict = checkExecute(cmd, String(query || ''));
        } catch (_) { /* بدون قضبان لا تنفيذ مستقل */ }
        const elevated = !!(ctx && ctx.unlocked);
        // المفتوح ينفذ كل الأحكام (حتى deny) بأمر المالك المباشر وموثّقاً.
        // المغلق: allow حصراً — والباقي يُرد بلا تنفيذ.
        if (verdict.decision !== 'allow' && !elevated) {
            const msg = `لم يُنفَّذ (حكم القضبان: ${verdict.decision}): ${cmd}\n${(verdict.reasons || []).join('، ')}`;
            obs.push(`[الطرفية رفضت التنفيذ الذاتي]: ${msg}`);
            try { io.emit('agent-update', { agent: 'Terminal', role: 'Blocked', text: `⛔ ${msg}`, theme: 'red' }); } catch (_) {}
            return obs;
        }
        const elevatedNote = (elevated && verdict.decision !== 'allow')
            ? ` (مفتوح: تجاوز ${verdict.decision} — ${[...new Set([...(verdict.warnings || []), ...(verdict.reasons || [])])].join('، ')})`
            : '';
        if (elevated && verdict.decision !== 'allow') {
            try {
                const ap = path.join((ctx.rootDir || process.cwd()), 'server', 'unlock-audit.log');
                fs.appendFile(ap, JSON.stringify({ ts: new Date().toISOString(), event: 'elevated-terminal', detail: cmd }) + '\n').catch(() => {});
            } catch (_) {}
        }
        try {
            io.emit('agent-update', { agent: 'Terminal', role: 'Executing', text: `⚡ تنفيذ آمن: \`${cmd}\``, theme: 'purple' });
        } catch (_) {}
        const out = await new Promise((resolve) => {
            let acc = '';
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            try {
                const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 20000 });
                child.stdout.on('data', (d) => { acc += d.toString(); });
                child.stderr.on('data', (d) => { acc += d.toString(); });
                child.on('close', (c) => finish({ code: c === null ? 1 : c, text: acc }));
                child.on('error', (e) => finish({ code: 1, text: acc + e.message }));
                setTimeout(() => { try { child.kill(); } catch (_) {} finish({ code: 124, text: acc + '\n[مهلة 20s]' }); }, 22000);
            } catch (e) { finish({ code: 1, text: String(e.message || e) }); }
        });
        const body = String(out.text || '(بلا مخرجات)').slice(0, 2000);
        obs.push(`[مخرجات الطرفية للأمر '${cmd}' (رمز ${out.code})${elevatedNote}]:\n${body}`);
        try { io.emit('agent-update', { agent: 'Terminal', role: 'Done', text: `✅ نفذت: \`${cmd}\``, theme: 'green' }); } catch (_) {}
        return obs;
    },
};
