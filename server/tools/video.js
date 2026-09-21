// ============================================================
// Video Tool — نية صناعة الفيديو الإعلاني التلقائي
// أول أداة مسجلة في Suras Tool Registry.
// السلوك منقول حرفياً من الفرع المضمّن سابقاً (بلا أي تغيير وظيفي).
// ============================================================

const VERB_RE = /(?:اصنع|اصنعي|اعمل|اعملي|سوي|سويلي|سولي|انشئ|أنشئ|انتج|أنتج|صمم|صممي|ابن|ابني|طلع|ولد|create|make|generate|produce)/i;
const NOUN_RE = /(?:فيديو|فيديوا|فديو|فيدو|مقطع|ريلز|ريل|موشن|video|reel|clip)/i;
const DELETE_RE = /(?:احذف|امسح|أزل|delete|remove)/i;

/**
 * كاشف موحد لطلبات صناعة الفيديو — يُستخدم هنا وفي حارس isBuildIntent.
 * (حتى لا يُصنَّف "اصنع فيديو" خطأً على أنه بناء صفحة ويب)
 */
export function isVideoCreationRequest(q) {
    const text = String(q || '').replace(/[ؐ-ًؚ-ٰٟ]/g, ''); // تجريد التشكيل كما في arabicNorm
    const hasVerb = VERB_RE.test(text);
    const hasNoun = NOUN_RE.test(text);
    const isDelete = DELETE_RE.test(text);
    return hasVerb && hasNoun && !isDelete;
}

/** كشف جزئي: ذُكر الفيديو بلا فعل إنشاء (غموض يستحق سؤالاً لا تجاهلاً). */
export function isVideoMentionOnly(q) {
    const text = String(q || '').replace(/[ؐ-ًؚ-ٰٟ]/g, '');
    return NOUN_RE.test(text) && !VERB_RE.test(text) && !DELETE_RE.test(text);
}

import { scoreKeywords } from './classifier.js';

const VIDEO_KEYWORDS = [
    { term: 'فيديو', weight: 3 }, { term: 'فيديوا', weight: 3 },
    { term: 'فديو', weight: 3 }, { term: 'فيدو', weight: 3 },
    { term: 'مقطع', weight: 2 }, { term: 'ريلز', weight: 2 }, { term: 'ريل', weight: 2 },
    { term: 'موشن', weight: 2 }, { term: 'video', weight: 3 },
    { term: 'reel', weight: 2 }, { term: 'clip', weight: 1 },
    { term: 'اعلاني', weight: 2 }, { term: 'تسويقي', weight: 2 },
    { term: 'اصنع', weight: 2 }, { term: 'اعمل', weight: 1 }, { term: 'سوي', weight: 1 },
];

function extractTopic(query) {
    // بعد "عن" / "حول" / "بخصوص" / "لمنتج" / "لخدمة" — بمسافة إجبارية
    // (بدون "ل" المفردة حتى لا تلتقط لاماً من داخل كلمة مثل "اعلاني")
    let topic = '';
    const aboutM = /(?:عن|حول|بخصوص|لمنتج|لخدمة)\s+["']?([^"'\n؟?]+?)["']?\s*(?:\.|$)/i.exec(query);
    if (aboutM) topic = aboutM[1].trim();
    if (!topic) {
        const afterM = /(?:فيديو|فيديوا|فديو|فيدو|مقطع|ريلز|ريل|video)\s*(?:اعلاني|إعلاني|تسويقي|دعائي)?\s*["']?([^"'\n؟?]+?)["']?\s*(?:\.|$)/i.exec(query);
        if (afterM) topic = afterM[1].trim();
    }
    // تنظيف بقايا أفعال الأمر من بداية الموضوع
    topic = topic.replace(/^(?:اصنع|اعمل|سوي|انشئ|انتج|صمم|لي|لنا|لو سمحت|من فضلك)\s+/i, '').trim();
    return topic.slice(0, 120);
}

export const VIDEO_TOOL = {
    name: 'auto-video',
    description: 'إنتاج فيديو إعلاني تلقائي كامل (بانر + تعليق صوتي + رندرة) من وصف الموضوع',
    searchHint: 'اصنع فيديو اعلاني عن منتج، سوي مقطع تسويقي، create marketing video',
    keywords: VIDEO_KEYWORDS,
    threshold: 1,
    timeoutMs: 300000,

    matches(query) {
        // بوابة صلبة أولاً (بما فيها استثناء الحذف) — ثم الدرجة من المصنّف (تتأثر بالتعلّم)
        const ok = isVideoCreationRequest(query);
        console.log(`[VideoIntent] check query="${String(query).slice(0, 80)}" => ${ok}`);
        if (!ok) return null;
        const { score, hits } = scoreKeywords(query, VIDEO_KEYWORDS, 'auto-video');
        return { score: Math.max(1, score), hits };
    },

    // سؤال التوضيح عند الغموض: "فيديو عن القهوة؟" بلا فعل إنشاء
    partial(query) {
        if (isVideoMentionOnly(query)) {
            return {
                score: 5,
                question: '🎬 يبدو أنك تريد فيديو إعلانياً — عن أي منتج أو خدمة؟ (مثال: اصنع فيديو اعلاني عن قهوة عربية)',
            };
        }
        return null;
    },

    async run(query, ctx) {
        const { io, govUrl, rootDir, fs, path } = ctx;
        const obs = [];
        const topic = extractTopic(query);

        if (!topic || topic.length < 2) {
            obs.push(`[طلب فيديو بلا موضوع واضح]: اطلب من المستخدم تحديد المنتج أو الخدمة (مثال: اصنع فيديو اعلاني عن قهوة عربية).`);
            io.emit('agent-update', { agent: 'Video Engine', role: 'Need Topic', text: '🎬 عن أي منتج أصنع الفيديو الإعلاني؟ حدد الموضوع وسأنتجه فوراً.', theme: 'orange' });
            return obs;
        }

        console.log(`[VideoIntent] topic="${topic}" — calling engine...`);
        try {
            if (Array.isArray(ctx.entities)) {
                for (const t of String(topic).split(/\s+/)) {
                    if (t) ctx.entities.push(t);
                }
            }
            io.emit('agent-update', { agent: 'Video Engine', role: 'Producing', text: `🎬 أُنتج الآن فيديو إعلاني عن: ${topic} — بانر + تعليق صوتي + رندرة سينمائية...`, theme: 'purple' });
            const form = new URLSearchParams();
            form.append('topic', topic);
            form.append('duration', '15.0');
            const r = await fetch(`${govUrl}/api/suras/create-auto-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
                signal: AbortSignal.timeout(300000),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                console.log(`[VideoIntent] engine FAILED http=${r.status} detail=${(err && err.detail) || '?'}`);
                obs.push(`[فشل إنتاج الفيديو عن "${topic}"]: ${(err && err.detail) || r.status}`);
                io.emit('agent-update', { agent: 'Video Engine', role: 'Error', text: `❌ تعذر إنتاج الفيديو: ${(err && err.detail) || r.status}`, theme: 'red' });
            } else {
                const buf = Buffer.from(await r.arrayBuffer());
                const outDir = path.join(rootDir, 'productions');
                await fs.mkdir(outDir, { recursive: true });
                const outName = `suras_ad_${Date.now()}.mp4`;
                await fs.writeFile(path.join(outDir, outName), buf);
                const videoUrl = `http://localhost:3001/productions/${outName}`;
                console.log(`[VideoIntent] SAVED ${outName} (${buf.length} bytes)`);
                obs.push(`[🎬 تم إنتاج الفيديو الإعلاني بنجاح عن "${topic}"]: الملف /productions/${outName} (${buf.length} بايت) — رابط المعاينة المباشرة: ${videoUrl} — أخبر المستخدم أن الفيديو جاهز ويُعرض الآن في شاشة المعاينة المركزية مع رابط التحميل.`);
                io.emit('media-update', { type: 'browser-preview', url: videoUrl, title: `🎬 ${topic}` });
                io.emit('files-changed');
                io.emit('agent-update', { agent: 'Video Engine', role: 'Done', text: `✅ الفيديو الإعلاني جاهز: ${topic}`, theme: 'green' });
            }
        } catch (e) {
            console.log(`[VideoIntent] EXCEPTION: ${e.message}`);
            obs.push(`[خطأ محرك الفيديو]: ${e.message}`);
            io.emit('agent-update', { agent: 'Video Engine', role: 'Error', text: `❌ خطأ المحرك: ${e.message}`, theme: 'red' });
        }
        return obs;
    },
};
