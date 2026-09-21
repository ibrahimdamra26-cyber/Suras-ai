// ============================================================
// PageGen Tool — توليد صفحات الهبوط الذاتي (بلا سحابة)
// سادس أداة مسجلة في Suras Tool Registry.
// الموضوع → صفحة هبوط كاملة مصممة → معاينة حية. يعمل حتى
// عند انقطاع حصة الموديل السحابي (حتمي محلي بالكامل).
// ============================================================

import { scoreKeywords } from './classifier.js';
import { expandWithDialects } from './dialects.js';
import { cloudBridge } from './ai_bridge.js';

/**
 * نية المعاينة الحية: طلب صفحة/موقع/واجهة للعرض الحي (لا القالب العام).
 * تُستثنى: أوامر الفتح (افتح موقع X → المتصفح)، ومشاريع multi-file المهيكلة.
 */
export function isPreviewIntent(q) {
    // الفحص على النص الموسّع اللهجياً (إلحاق فقط) — فيرى «تصاميم» كما «صمم»
    const text = String(expandWithDialects(q || ''));

    // طلب بناء مشروع/تطبيق/واجهات كاملة ليس صفحة هبوط واحدة؛ يذهب إلى project-engine
    const projectBuildIntent = /(مشروع|تطبيق|app|web app|dashboard|api|backend|واجهة كاملة|واجهة متكاملة|هيكل المشروع|مجلدات المشروع|ملفات المشروع|موقع كامل)/i.test(text)
        && /(انشئ|أنشئ|ابني|أبني|اصنع|سوي|اعمل|صمم|تصميم|build|create|generate|scaffold|make)/i.test(text);
    if (projectBuildIntent) return false;

    if (/(افتح|شغل|ادخل|اعرض|شاهد|تصفح|open|launch)/i.test(text)
        && !/(صمم|ابن|انشئ|اعمل|سوي|اصنع|create|design|build|generate|make)/i.test(text)) {
        return false;
    }
    const hasAction = /(صمم|تصميم|تصميمي|نفس تصميم|مثل تصميم|ابن|ابني|انشئ|أنشئ|اعمل|سوي|اصنع|ابنيلي|صمملي|create|design|build|generate|make)/i.test(text);
    const hasPage = /(صفحة|موقع|واجهة|واجهات|هبوط|متجر|لاندنج|landing|page|website|site|webpage|store)/i.test(text);
    if (!(hasAction && hasPage)) return false;
    if (/(?:مكون من|محتوي على|هيكل|مجلدات|ملفات|assets|css|images|js|index)/i.test(text)
        && /(?:css|js|assets|images)/i.test(text)) {
        return false;
    }
    return true;
}

const GENERIC_SCAFFOLD = /^(صفحة|صفحه|موقع|هبوط|مثل|متل|ك|تصميم|جديدة|جديده|لاندنج|عصرية|حديثة|احترافية)\s+/i;

function extractPageTopic(query) {
    let topic = '';
    const aboutM = /(?:مثل|متل|عن|حول|بخصوص|لمنتج|لخدمة|لموقع|ك)\s+["']?([^"'\n؟?]+?)["']?\s*(?:\.|$)/i.exec(String(query || ''));
    if (aboutM) topic = aboutM[1].trim();
    if (!topic) {
        const afterM = /(?:صفحة|موقع|واجهة|هبوط|متجر|landing|page|website)\s*(?:هبوط|جديدة|جديده|عصرية|حديثة)?\s*["']?([^"'\n؟?]+?)["']?\s*(?:\.|$)/i.exec(String(query || ''));
        if (afterM) topic = afterM[1].trim();
    }
// إسقاط كلمات السقالة العامة من البداية (مثل/موقع/صفحة/هبوط...)
    let prev = '';
    while (topic && topic !== prev) {
        prev = topic;
        topic = topic.replace(GENERIC_SCAFFOLD, '').trim();
    }
    topic = topic.replace(/^(?:اصنع|اعمل|سوي|انشئ|صمم|تصميم|لي|لنا|لو سمحت|من فضلك|نفس)/i, '').trim();
    // رابط ويب → اسم النطاق كموضوع نظيف (amazon.com → amazon)
    const urlM = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z]{2,}/i.exec(topic);
    if (urlM) topic = urlM[1];
    topic = topic.replace(/\s+(بدقة|بالضبط|مثل|لي|الان|الان|فورا|الان)/i, '').trim();
    return topic.slice(0, 80);
}

const PAGEGEN_KEYWORDS = [
    { term: 'صفحة', weight: 3 }, { term: 'صفحه', weight: 3 },
    { term: 'موقع', weight: 3 }, { term: 'واجهة', weight: 2 },
    { term: 'هبوط', weight: 3 }, { term: 'متجر', weight: 2 },
    { term: 'لاندنج', weight: 3 }, { term: 'landing', weight: 3 },
    { term: 'page', weight: 2 }, { term: 'website', weight: 2 },
    { term: 'صمم', weight: 2 }, { term: 'ابن', weight: 1 }, { term: 'انشئ', weight: 1 },
];

export const PAGEGEN_TOOL = {
    name: 'pagegen',
    description: 'توليد صفحة هبوط كاملة مصممة من الموضوع وعرضها حياً',
    searchHint: 'صمم صفحة هبوط، ابن موقع متجر، create landing page',
    keywords: PAGEGEN_KEYWORDS,
    threshold: 1,
    timeoutMs: 60000,

    matches(query) {
        // بوابة صلبة أولاً — ثم الدرجة من المصنّف (تتأثر بالتعلّم)
        if (!isPreviewIntent(query)) return null;
        const { score } = scoreKeywords(query, PAGEGEN_KEYWORDS, 'pagegen');
        return { score: Math.max(1, score) };
    },

    async run(query, ctx) {
        const { io, govUrl, rootDir, fs, path } = ctx;
        const obs = [];
        const topic = extractPageTopic(query);
        if (!topic || topic.length < 2) {
            obs.push('[طلب صفحة بلا موضوع واضح]: حدد موضوع الصفحة (مثال: صمم صفحة هبوط لمتجر عطور).');
            io.emit('agent-update', { agent: 'PageGen', role: 'Need Topic', text: '🖥️ عن ماذا تكون الصفحة؟ حدد الموضوع وسأبنيها فوراً.', theme: 'orange' });
            return obs;
        }
        try {
            io.emit('agent-update', { agent: 'PageGen', role: 'Building', text: `🖥️ أبني صفحة هبوط عن: ${topic} — تصميم + معاينة حية...`, theme: 'purple' });
            
            const systemPrompt = `أنت مهندس واجهات (UI/UX Designer) خبير. صمم صفحة هبوط عن الموضوع التالي: ${topic}.
استخدم HTML5 و TailwindCSS (عبر رابط CDN).
يجب أن يكون التصميم عصرياً جداً، فخماً (Premium)، ومبهراً (Vibrant colors, Glassmorphism, Modern typography).
اكتب كود HTML كامل يحتوي على: (Header, Hero Section, Features, CTA, Footer).
لا تستخدم ألواناً باهتة، أضف تأثيرات حركية عبر CSS إذا لزم الأمر.
أرجع الكود النهائي فقط داخل كتلة \`\`\`html ... \`\`\` ولا تكتب أي كلام آخر.`;

            const r = await cloudBridge(systemPrompt, `أرجوك صمم صفحة الهبوط المطلوبة`, 'code', 90000);
            
            if (!r || !r.text) {
                obs.push(`[فشل بناء الصفحة عن "${topic}"]: الذكاء الاصطناعي لم يرد`);
                io.emit('agent-update', { agent: 'PageGen', role: 'Error', text: `❌ تعذر بناء الصفحة بالذكاء الاصطناعي`, theme: 'red' });
            } else {
                let doc = r.text;
                const match = /```html\s*([\s\S]*?)\s*```/i.exec(doc);
                if (match) doc = match[1];

                const outDir = path.join(rootDir, 'previews');
                await fs.mkdir(outDir, { recursive: true });
                const outName = `suras_preview_${Date.now()}.html`;
                const outPath = path.join(outDir, outName);
                await fs.writeFile(outPath, doc, 'utf-8');
                const previewUrl = `http://localhost:3001/preview-file?path=${encodeURIComponent(outPath)}`;
                obs.push(`[🖥️ تم بناء صفحة الهبوط بنجاح عن "${topic}"]: الملف /previews/${outName} (${doc.length} حرف) — رابط المعاينة الحية: ${previewUrl} — أخبر المستخدم أن الصفحة جاهزة وتُعرض الآن في شاشة المعاينة المركزية.`);
                io.emit('media-update', { type: 'browser-preview', url: previewUrl, title: `🖥️ ${topic}` });
                io.emit('files-changed');
                io.emit('agent-update', { agent: 'PageGen', role: 'Done', text: `✅ صفحة الهبوط جاهزة: ${topic}`, theme: 'green' });
                if (Array.isArray(ctx.entities)) {
                    for (const t of String(topic).split(/\s+/)) {
                        if (t) ctx.entities.push(t);
                    }
                }
            }
        } catch (e) {
            obs.push(`[خطأ محرك الصفحات]: ${e.message}`);
            io.emit('agent-update', { agent: 'PageGen', role: 'Error', text: `❌ خطأ المحرك: ${e.message}`, theme: 'red' });
        }
        return obs;
    },
};
