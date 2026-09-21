// ============================================================
// Suras WebDocs — جلب التوثيق العميق وقراءة الصفحات
// ------------------------------------------------------------
// بلا مفاتيح وبلا حزم: DuckDuckGo Instant Answer + Wikipedia API
// + قارئ صفحات (استخراج النص المقروء من HTML).
// ============================================================

const UA = { 'User-Agent': 'SurasPlatform/1.0 (docs-fetcher)' };

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

/**
 * بحث متعدد المصادر: DDG أولاً ثم Wikipedia.
 * @returns {Promise<{ lines: string[], title: string|null }>}
 */
export async function searchDocs(sq) {
    const lines = [];
    let title = null;
    // 1) DuckDuckGo Instant Answer (بلا مفتاح)
    try {
        const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(sq)}&format=json&no_html=1&skip_disambig=1`, {
            headers: UA, signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
            const d = await r.json();
            if (d.AbstractText) {
                title = d.Heading || null;
                lines.push(`${d.Heading || sq}: ${d.AbstractText}${d.AbstractURL ? ` (${d.AbstractURL})` : ''}`);
            }
            const rel = Array.isArray(d.RelatedTopics) ? d.RelatedTopics : [];
            for (const t of rel.slice(0, 3)) {
                const txt = t.Text || (t.Topics && t.Topics[0] && t.Topics[0].Text);
                if (txt) lines.push(`• ${txt.slice(0, 300)}`);
            }
        }
    } catch (_) { /* تجاهل — البديل التالي */ }
    // 2) Wikipedia (عربي ثم إنجليزي)
    if (lines.length === 0) {
        for (const lang of ['ar', 'en']) {
            try {
                const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(sq)}&utf8=&format=json`, {
                    headers: UA, signal: AbortSignal.timeout(15000),
                });
                const data = await r.json();
                const hits = (data.query && data.query.search) || [];
                if (hits.length > 0) {
                    const h = hits[0];
                    title = h.title;
                    lines.push(`${h.title}: ${String(h.snippet).replace(/<[^>]*>?/gm, '')}`);
                    break;
                }
            } catch (_) { /* التالي */ }
        }
    }
    return { lines, title };
}

function extractTitle(html) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
    return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
}

/**
 * قراءة عميقة لصفحة: العنوان + النص المقروء (حتى ~4000 حرف).
 * @returns {Promise<{ title, text }>}
 */
export async function readPage(url) {
    let u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000), redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('html') && !ctype.includes('text')) {
        throw new Error(`نوع غير نصي (${ctype || 'مجهول'}) — لا يمكن قراءته كنص`);
    }
    const html = await r.text();
    const title = extractTitle(html);
    const text = htmlToText(html).slice(0, 4000);
    if (!text) throw new Error('الصفحة بلا نص مقروء (ربما تطبيق JS فقط)');
    return { title: title || u, text };
}
