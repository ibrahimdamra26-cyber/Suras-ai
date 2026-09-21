// ============================================================
// WebScout Tool — أداة التصفح والجلب من الإنترنت لشات سوراس
// ------------------------------------------------------------
// تسد الفجوة القاتلة: طلبات "ابحث في الانترنت / تصفح / اجلب اكواد"
// كانت تسقط من كل التوجيه (لا رابط → page-read يرفض، ولا أداة
// إنترنت مسجلة) فيجيب العقل برد عام وتبقى المعاينة على ملف قديم.
//  • رابط في النص → جلب عميق عبر محرك web-scout (:3010 Playwright)
//  • بلا رابط → بحث متعدد المصادر (webdocs) + قراءة أعمق نتيجة
// ============================================================

import fs from 'fs';
import path from 'path';
import { scoreKeywords } from './classifier.js';

const URL_RE = /(https?:\/\/[^\s"'<>]+|[a-z0-9\-]+\.(?:com|net|org|io|dev|app|ai|co|edu|gov|info|me|tv|tech|store|online|site|blog)\b(?:\/[^\s"'<>]*)?)/i;

const WEBSCOUT_KEYWORDS = [
    { term: 'انترنت', weight: 3 }, { term: 'الانترنت', weight: 3 },
    { term: 'internet', weight: 3 }, { term: 'تصفح', weight: 3 },
    { term: 'متصفح', weight: 3 }, { term: 'ابحث', weight: 3 },
    { term: 'بحث', weight: 2 }, { term: 'اكواد', weight: 2 },
    { term: 'كود', weight: 1 }, { term: 'معلومات', weight: 1 },
    { term: 'رابط', weight: 2 }, { term: 'روابط', weight: 2 },
    { term: 'موقع', weight: 1 }, { term: 'search', weight: 2 },
    { term: 'browse', weight: 2 }, { term: 'fetch', weight: 2 },
    { term: 'web', weight: 1 },
];

/** قراءة المفتاح السيادي من server/.env (نفس نهج brain) — مُصدَّرة لبدائل ReAct */
export function readMasterKey(rootDir) {
    try {
        const envPath = path.join(rootDir, 'server', '.env');
        const raw = fs.readFileSync(envPath, 'utf-8');
        for (const line of raw.split('\n')) {
            const t = line.trim();
            if (!t || t.startsWith('#') || !t.includes('=')) continue;
            const i = t.indexOf('=');
            const k = t.slice(0, i).trim();
            if (k === 'SURAS_MASTER_KEY') {
                return t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
            }
        }
    } catch (_) { /* fallback below */ }
    return process.env.SURAS_MASTER_KEY || 'SURAS_SECRET_EXTREME_2026';
}

function firstUrl(text) {
    const m = URL_RE.exec(String(text || ''));
    return m ? m[1] : null;
}

export const WEBSCOUT_TOOL = {
    name: 'webscout',
    description: 'البحث في الإنترنت وجلب المحتوى والأكواد (تصفح حر عبر محرك web-scout)',
    searchHint: 'ابحث في الانترنت، تصفح موقع، اجلب اكواد، search internet',
    keywords: WEBSCOUT_KEYWORDS,
    threshold: 5,
    timeoutMs: 180000,

    matches(query) {
        const text = String(query || '');
        // رابط صريح + فعل تصفح/دخول = تطابق قوي ومباشر
        // (أفعال القراءة والجلب المباشر لأداتي page-read وwebfetch — لا ازدواج)
        if (URL_RE.test(text) && /(افتح|تصفح|ادخل|ابحث|browse|open)/i.test(text)) {
            return { score: 10 };
        }
        // طلب ملف محلي صريح → ليس من اختصاص هذه الأداة
        if (/(اقرأ|افتح|read|open).*(ملف|مجلد|file|folder)/i.test(text)) return null;
        // طلب بناء صفحة/معاينة → لأداة pagegen (لا نخطفها)
        if (/(صمم|ابن|ابني|انشئ|أنشئ|اعمل|سوي|اصنع|create|design|build|generate|make)/i.test(text)
            && /(صفحة|موقع|واجهة|هبوط|متجر|landing|page|website)/i.test(text)) return null;
        const { score, hits } = scoreKeywords(text, WEBSCOUT_KEYWORDS, 'webscout');
        if (score <= 0) return null;
        return { score, hits };
    },

    async run(query, ctx) {
        const { io, govUrl, rootDir } = ctx;
        const obs = [];
        const q = String(query || '').trim();
        const url = firstUrl(q);
        const masterKey = readMasterKey(rootDir || path.join(process.cwd()));
        const engineBase = (govUrl || 'http://127.0.0.1:3010').replace(/\/$/, '');

        // —— المسار 1: رابط صريح → جلب عميق مستقل عبر المحرك ——
        if (url) {
            let target = url;
            if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
            io.emit('agent-update', { agent: 'WebScout', role: 'Browsing', text: `🕷️ أتصفح بعمق: ${target}`, theme: 'purple' });
            try {
                const form = new URLSearchParams();
                form.append('target_url', target);
                form.append('auth_key', masterKey);
                form.append('task', q);
                const r = await fetch(`${engineBase}/api/web-scout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: form.toString(),
                    signal: AbortSignal.timeout(150000),
                });
                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                    obs.push(`[تعذر الجلب العميق من ${target}]: ${(data && data.detail) || r.status}`);
                    io.emit('agent-update', { agent: 'WebScout', role: 'Error', text: `❌ ${(data && data.detail) || r.status}`, theme: 'red' });
                    return obs;
                }
                if (data.mode === 'Autonomous Web Scout Agent' && Array.isArray(data.findings)) {
                    obs.push(`[تصفح مستقل للمهمة "${data.task || q}"] — صفحات مفتوحة: ${data.pages_opened}/${data.total_pages_found}\n${data.extracted_payload || '(بلا نص مطابق)'}`);
                    for (const f of data.findings.slice(0, 6)) {
                        if (f.status === 'ok' && f.lines && f.lines.length) {
                            obs.push(`[من ${f.url}]:\n${f.lines.slice(0, 12).join('\n')}`);
                        }
                    }
                } else {
                    obs.push(`[محتوى ${data.target_url || target}]:\n${data.extracted_payload || '(فارغ)'}`);
                    const links = [...(data.internal_links || []), ...(data.external_links || [])].slice(0, 10);
                    if (links.length) obs.push(`[روابط قابلة للفتح]:\n${links.join('\n')}`);
                }
                try {
                    if (Array.isArray(ctx.entities)) {
                        ctx.entities.push(target);
                        for (const w of q.split(/\s+/).slice(0, 8)) if (w) ctx.entities.push(w);
                    }
                } catch (_) { /* entities اختيارية */ }
                io.emit('agent-update', { agent: 'WebScout', role: 'Done', text: `✅ جلبت محتوى ${target}`, theme: 'green' });
            } catch (e) {
                obs.push(`[محرك التصفح غير متاح]: ${e.message}`);
                io.emit('agent-update', { agent: 'WebScout', role: 'Error', text: `❌ المحرك غير متاح: ${e.message}`, theme: 'red' });
            }
            return obs;
        }

        // —— المسار 2: بلا رابط → بحث متعدد المصادر + قراءة أعمق نتيجة ——
        io.emit('agent-update', { agent: 'WebScout', role: 'Searching', text: `🌐 أبحث في الإنترنت عن: ${q.slice(0, 80)}`, theme: 'purple' });
        try {
            const { searchDocs, readPage } = await import('./webdocs.js');
            const sq = q.replace(/^(أريد منك|أريد|اريد|من فضلك|لو سمحت)\s+/i, '').trim().slice(0, 200);
            const { lines, title } = await searchDocs(sq);
            if (!lines.length) {
                obs.push(`[بحث الويب عن "${sq}"]: لا توجد نتائج واضحة.`);
                io.emit('agent-update', { agent: 'WebScout', role: 'Empty', text: '⚠️ بلا نتائج واضحة', theme: 'orange' });
                return obs;
            }
            obs.push(`[نتائج البحث في الويب عن "${sq}"]:\n${lines.join('\n')}`);
            io.emit('agent-update', { agent: 'WebScout', role: 'Found', text: `✅ وجدت معلومات عن: ${title || sq}`, theme: 'green' });
            // قراءة أعمق نتيجة (أول رابط يظهر في النتائج)
            const joined = lines.join('\n');
            const deep = firstUrl(joined);
            if (deep) {
                try {
                    io.emit('agent-update', { agent: 'WebScout', role: 'Reading', text: `📖 أقرأ أعمق نتيجة: ${deep}`, theme: 'blue' });
                    const { title: dt, text: dtxt } = await readPage(deep);
                    obs.push(`[قراءة عميقة "${dt}"] (${deep}):\n${String(dtxt).slice(0, 3000)}`);
                    if (Array.isArray(ctx.entities)) { ctx.entities.push(deep); }
                } catch (e) {
                    obs.push(`[تعذرت القراءة العميقة لـ ${deep}]: ${e.message}`);
                }
            }
            try {
                if (Array.isArray(ctx.entities)) {
                    for (const w of sq.split(/\s+/).slice(0, 8)) if (w) ctx.entities.push(w);
                }
            } catch (_) { /* entities اختيارية */ }
        } catch (e) {
            obs.push(`[خطأ أثناء البحث في الويب]: ${e.message}`);
            io.emit('agent-update', { agent: 'WebScout', role: 'Error', text: `❌ ${e.message}`, theme: 'red' });
        }
        return obs;
    },
};
