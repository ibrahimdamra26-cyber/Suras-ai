// ============================================================
// Page Tool — قراءة محتوى صفحات الويب (أتمتة المحتوى)
// ثالث أداة مسجلة في Suras Tool Registry.
// "اقرأ الرابط X" / "اجلب محتوى الصفحة" / "لخص الموقع"
// ============================================================

const URL_RE = /(https?:\/\/[^\s"'<>]+|[a-z0-9\-]+\.(?:com|net|org|io|dev|app|ai|co|edu|gov|info|me|tv|tech|store|online|site|blog)\b(?:\/[^\s"'<>]*)?)/i;

export const PAGE_TOOL = {
    name: 'page-read',
    description: 'جلب وقراءة النص المقروء من صفحة ويب عبر رابطها',
    searchHint: 'اقرأ الرابط، اجلب محتوى الصفحة، لخص الموقع، read url',
    keywords: [
        { term: 'اقرأ', weight: 2 }, { term: 'الرابط', weight: 3 },
        { term: 'رابط', weight: 2 }, { term: 'الموقع', weight: 1 },
        { term: 'الصفحة', weight: 2 }, { term: 'صفحة', weight: 1 },
        { term: 'لخص', weight: 2 }, { term: 'محتوى', weight: 2 },
        { term: 'http', weight: 3 }, { term: 'read', weight: 2 },
    ],
    threshold: 5,
    timeoutMs: 60000,

    matches(query) {
        const text = String(query || '');
        // ملف/مجلد محلي أولاً — فرع القراءة المحلية أولى به (notes.txt ليست رابطاً)
        if (/(اقرأ|افتح|read|open).*(ملف|مجلد|file|folder)/i.test(text)) return null;
        const hasUrl = URL_RE.test(text);
        if (!hasUrl) return null;
        // التقسيم الثلاثي: القراءة/التلخيص هنا — الجلب المباشر لأداة webfetch، والتصفح العميق لـwebscout
        const hasReadVerb = /(اقرأ|اقرا|اقري|لخص|افتح واقرأ|ماذا في|شو في|read|summarize|open and read)/i.test(text);
        if (!hasReadVerb) return null;
        const m = URL_RE.exec(text);
        return { score: 10, url: m ? m[1] : null };
    },

    async run(query, ctx) {
        const { io } = ctx;
        const obs = [];
        const m = URL_RE.exec(String(query || ''));
        const url = m ? m[1] : null;
        if (!url) {
            obs.push('[قراءة صفحة بلا رابط واضح]: زوّدني بالرابط الكامل وسأقرأ محتواه.');
            return obs;
        }
        io.emit('agent-update', { agent: 'Page Reader', role: 'Fetching', text: `📄 أقرأ الصفحة: ${url}`, theme: 'blue' });
        try {
            if (Array.isArray(ctx.entities)) ctx.entities.push(url);
            const { readPage } = await import('./webdocs.js');
            const { title, text } = await readPage(url);
            obs.push(`[محتوى الصفحة "${title}"] (${url}):\n${text}`);
            io.emit('agent-update', { agent: 'Page Reader', role: 'Done', text: `✅ قرأت: ${title} (${text.length} حرف)`, theme: 'green' });
        } catch (e) {
            obs.push(`[تعذر قراءة الصفحة ${url}]: ${e.message}`);
            io.emit('agent-update', { agent: 'Page Reader', role: 'Error', text: `❌ ${e.message}`, theme: 'red' });
        }
        return obs;
    },
};
