// ============================================================
// WebFetch Tool — الجالب المباشر (جلب سريع يحفظ الأكواد)
// ------------------------------------------------------------
// التقسيم الثلاثي الصريح لمنع الازدواج:
//  • page-read: اقرأ/لخص + رابط (نص مقروء منظف)
//  • webfetch (هذه): اجلب/هات + رابط (جلب مباشر يحفظ <pre>/<code>)
//  • webscout: تصفح/ادخل/ابحث + رابط (Playwright مستقل) أو مهمة بلا رابط
// بلا رابط → null (البحث المفتوح من اختصاص webscout).
// ============================================================

const URL_RE = /(https?:\/\/[^\s"'<>]+|[a-z0-9\-]+\.(?:com|net|org|io|dev|app|ai|co|edu|gov|info|me|tv|tech|store|online|site|blog)\b(?:\/[^\s"'<>]*)?)/i;
const FETCH_VERBS = /(اجلب|هات|جلب|جلبلي|fetch\b|get\b)/i;

const UA = { 'User-Agent': 'SurasPlatform/1.0 (direct-fetcher)' };

function decodeEntities(s) {
    return String(s || '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch (_) { return ''; } });
}

function htmlToText(html) {
    let t = String(html || '');
    t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
    t = t.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
    t = t.replace(/<!--[\s\S]*?-->/g, ' ');
    t = t.replace(/<[^>]+>/g, ' ');
    t = decodeEntities(t);
    return t.replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/** استخراج يحفظ كتل الأكواد مسيّجة ثم النص المقروء للباقي. */
function extractWithCode(html) {
    const blocks = [];
    let t = String(html || '');
    t = t.replace(/<pre[\s\S]*?<\/pre>/gi, (m) => {
        const code = htmlToText(m).slice(0, 1500);
        if (code.trim()) blocks.push('```\n' + code.trim() + '\n```');
        return '\n[كتلة كود محفوظة]\n';
    });
    t = t.replace(/<(code|tt)[\s\S]*?<\/(code|tt)>/gi, (m) => {
        const code = htmlToText(m).slice(0, 500);
        if (code.trim() && code.trim().length > 3) blocks.push('`' + code.trim() + '`');
        return ' ';
    });
    const rest = htmlToText(t).slice(0, 2500);
    return { blocks: blocks.slice(0, 6), rest };
}

export const WEBFETCH_TOOL = {
    name: 'webfetch',
    description: 'جلب مباشر سريع لمحتوى رابط مع حفظ كتل الأكواد',
    searchHint: 'اجلب محتوى رابط، هات كود صفحة، fetch url',
    keywords: [
        { term: 'اجلب', weight: 3 }, { term: 'هات', weight: 3 },
        { term: 'جلب', weight: 2 }, { term: 'fetch', weight: 2 },
        { term: 'get', weight: 1 },
    ],
    threshold: 5,
    timeoutMs: 60000,

    matches(query) {
        const text = String(query || '');
        if (!URL_RE.test(text)) return null;
        if (!FETCH_VERBS.test(text)) return null;
        // ملف محلي أو بناء → ليس جلب ويب
        if (/(ملف|مجلد|file|folder)/i.test(text)) return null;
        if (/(صمم|ابن|ابني|انشئ|أنشئ|اعمل|سوي|اصنع|create|design|build|generate|make)/i.test(text)
            && /(صفحة|موقع|واجهة|هبوط|متجر|landing|page|website)/i.test(text)) return null;
        return { score: 10 };
    },

    async run(query, ctx) {
        const { io } = ctx;
        const obs = [];
        const m = URL_RE.exec(String(query || ''));
        let url = m ? m[1] : null;
        if (!url) {
            obs.push('[جلب مباشر بلا رابط واضح]: زوّدني بالرابط وسأجلبه فوراً.');
            return obs;
        }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try { io.emit('agent-update', { agent: 'WebFetch', role: 'Fetching', text: `⚡ جلب مباشر: ${url}`, theme: 'blue' }); } catch (_) {}
        try {
            const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000), redirect: 'follow' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const ctype = (r.headers.get('content-type') || '').toLowerCase();
            if (!ctype.includes('html') && !ctype.includes('text')) {
                throw new Error(`نوع غير نصي (${ctype || 'مجهول'})`);
            }
            const html = await r.text();
            const { blocks, rest } = extractWithCode(html);
            if (Array.isArray(ctx.entities)) ctx.entities.push(url);
            let out = `[جلب مباشر ${url}]:\n${rest}`;
            if (blocks.length) out += `\n\n[أكواد محفوظة (${blocks.length})]:\n${blocks.join('\n\n')}`;
            obs.push(out.slice(0, 4500));
            try { io.emit('agent-update', { agent: 'WebFetch', role: 'Done', text: `✅ جلبت ${url} (${blocks.length} كتل كود)`, theme: 'green' }); } catch (_) {}
        } catch (e) {
            obs.push(`[تعذر الجلب المباشر من ${url}]: ${e.message}`);
            try { io.emit('agent-update', { agent: 'WebFetch', role: 'Error', text: `❌ ${e.message}`, theme: 'red' }); } catch (_) {}
        }
        return obs;
    },
};
