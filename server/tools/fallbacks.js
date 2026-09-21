// ============================================================
// ReAct Fallbacks — موجة البدائل الحتمية (بلا نموذج)
// ------------------------------------------------------------
// عند فشل أداة مسجلة، تُشغَّل بديلتها المسجلة هنا تلقائياً —
// مرة واحدة لكل أداة في الطلب (الميزانية مدمجة في التصميم).
//  • webscout (محرك Playwright معطّل) → بحث webdocs + قراءة عميقة
//  • page-read (قراءة مباشرة فاشلة) → جلب عميق عبر محرك web-scout
// البديل يُوسم [بديل تلقائي] في الملاحظات — لا انتحال لنجاح.
// ============================================================

const URL_RE = /(https?:\/\/[^\s"'<>]+|[a-z0-9\-]+\.(?:com|net|org|io|dev|app|ai|co|edu|gov|info|me|tv|tech|store|online|site|blog)\b(?:\/[^\s"'<>]*)?)/i;

/** بصمات الفشل لكل أداة (مقتطفات مستقرة من رسائل الأدوات نفسها). */
export const FALLBACK_TRIGGERS = {
    webscout: ['غير متاح', 'تعذر الجلب', 'فشل محرك', 'Web Scout agent unreachable', 'agent unreachable'],
    'page-read': ['تعذر قراءة الصفحة', 'تعذّر قراءة الصفحة'],
};

function firstUrl(text) {
    const m = URL_RE.exec(String(text || ''));
    return m ? m[1] : null;
}

function normUrl(u) {
    let s = String(u || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
}

/** بديل webscout: بحث متعدد المصادر + قراءة أعمق نتيجة (بلا متصفح). */
async function webscoutFallback(query, ctx) {
    const obs = [];
    try {
        const { searchDocs, readPage } = await import('./webdocs.js');
        const { lines, title } = await searchDocs(String(query || '').slice(0, 200));
        if (!lines.length) {
            obs.push('[بديل تلقائي webscout]: البحث الاحتياطي بلا نتائج أيضاً.');
            return obs;
        }
        obs.push(`[بديل تلقائي webscout — المحرك كان معطلاً، هذا من البحث الاحتياطي] عن "${title || query}":\n${lines.join('\n')}`);
        const deep = firstUrl(lines.join('\n'));
        if (deep) {
            try {
                const { title: dt, text: dtxt } = await readPage(deep);
                obs.push(`[قراءة عميقة احتياطية "${dt}"]:\n${String(dtxt).slice(0, 2500)}`);
            } catch (e) { obs.push(`[تعذرت القراءة الاحتياطية]: ${e.message}`); }
        }
    } catch (e) {
        obs.push(`[فشل البديل التلقائي webscout]: ${e.message}`);
    }
    return obs;
}

/** بديل page-read: جلب عميق عبر محرك web-scout (Playwright + مهمة). */
async function pageReadFallback(query, ctx) {
    const obs = [];
    const url = normUrl(firstUrl(query));
    if (!url) return obs;
    const engineBase = String((ctx && ctx.govUrl) || 'http://127.0.0.1:3010').replace(/\/$/, '');
    try {
        const { readMasterKey } = await import('./webscout.js');
        const rootDir = (ctx && ctx.rootDir) || process.cwd();
        const form = new URLSearchParams();
        form.append('target_url', url);
        form.append('auth_key', readMasterKey(rootDir));
        form.append('task', String(query || ''));
        const r = await fetch(`${engineBase}/api/web-scout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            signal: AbortSignal.timeout(150000),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            obs.push(`[بديل تلقائي page-read]: المحرك أيضاً تعذر (${(data && data.detail) || r.status}).`);
            return obs;
        }
        obs.push(`[بديل تلقائي page-read — جلب عميق من ${data.target_url || url}]:\n${String(data.extracted_payload || '').slice(0, 3000) || '(فارغ)'}`);
    } catch (e) {
        obs.push(`[بديل تلقائي page-read تعذر]: ${e.message}`);
    }
    return obs;
}

const FALLBACKS = { webscout: webscoutFallback, 'page-read': pageReadFallback };

/**
 * موجة البدائل: تفحص الملاحظات بحثاً عن بصمات فشل، وتشغّل البديل مرة واحدة.
 * @returns {string[]} ملاحظات إضافية (فارغة إن لم يلزم بديل)
 */
export async function runFallbackWave(obsText, query, ctx = {}) {
    const out = [];
    const text = String(obsText || '');
    if (!text) return out;
    for (const tool of Object.keys(FALLBACKS)) {
        const markers = FALLBACK_TRIGGERS[tool] || [];
        if (markers.some(m => text.includes(m))) {
            try {
                if (ctx.io) ctx.io.emit('agent-update', { agent: 'ReAct', role: 'Fallback', text: `🔄 فشلت ${tool} — أشغّل البديل التلقائي...`, theme: 'orange' });
            } catch (_) {}
            try {
                const lines = await FALLBACKS[tool](query, ctx);
                for (const l of lines) if (l) out.push(l);
            } catch (e) {
                out.push(`[خطأ البديل التلقائي ${tool}]: ${e.message}`);
            }
        }
    }
    return out;
}
