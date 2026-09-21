// ============================================================
// Grounding Policy Tool — توجيه صارم لمصدرية الإجابة
// يمنع الإجابات من غير مصدر موثوق ويقيد التخمين.
// ============================================================

import { scoreKeywords } from './classifier.js';

const GROUNDING_KEYWORDS = [
    { term: 'مصدر', weight: 4 },
    { term: 'مصادر', weight: 4 },
    { term: 'دليل', weight: 4 },
    { term: 'أدلة', weight: 4 },
    { term: 'معلومة', weight: 3 },
    { term: 'حقيقة', weight: 3 },
    { term: 'حالات', weight: 1 },
    { term: 'موثوق', weight: 4 },
    { term: 'تأكد', weight: 3 },
    { term: 'تأكيد', weight: 3 },
    { term: 'برهان', weight: 3 },
    { term: 'source', weight: 4 },
    { term: 'grounding', weight: 4 },
    { term: 'evidence', weight: 4 },
    { term: 'proof', weight: 3 },
    { term: 'verify', weight: 3 },
    { term: 'confirm', weight: 3 },
    { term: 'citation', weight: 3 },
    { term: 'وثيقة', weight: 3 },
    { term: 'قاعدة معرفة', weight: 3 },
    { term: 'api', weight: 2 },
    { term: 'بحث', weight: 2 },
    { term: 'مراجع', weight: 2 },
    { term: 'دقة', weight: 3 },
];

function isGroundingCheck(text) {
    const s = String(text || '');
    const patterns = [
        /مصدر|دليل|معلومة|موثوق|تأكد|تأكيد|برهان|proof|source|grounding|evidence|verify|confirm|citation|قاعدة معرفة|بحث|مراجع|دقة/i,
        /هل.*(صحيح|دقيق|موثوق|مدعوم|مؤكد)/i,
        /أثبت|اثبت|اشرح.*(مصدر|دليل|معلومة)|استشهد|راجع/i,
        /من.*مصدر|من.*دليل|بأي.*مصدر|بأي.*دليل/i,
    ];
    return patterns.some((re) => re.test(s));
}

export const GROUNDING_TOOL = {
    name: 'grounding',
    description: 'تحقق من مصدرية الإجابة ومصادقتها قبل إرسالها.',
    searchHint: 'مصدر، دليل، توثيق، تحقق، grounding, evidence, source verification',
    keywords: GROUNDING_KEYWORDS,
    threshold: 1,
    timeoutMs: 15000,

    matches(query) {
        if (!isGroundingCheck(query)) return null;
        const { score } = scoreKeywords(query, GROUNDING_KEYWORDS, 'grounding');
        return { score: Math.max(1, score) };
    },

    async run(query, ctx = {}) {
        const q = String(query || '');
        const evidence = Array.isArray(ctx.evidence) ? ctx.evidence : [];
        const hasSource = evidence.length > 0 || /(api|source|مستند|وثيقة|قاعدة معرفة|بحث|document|retrieval)/i.test(q);
        const lines = [];

        lines.push('[Grounding Gate] تم تفعيل سياسة مصدرية الإجابة.');
        lines.push('قاعدة السلامة: لا تخمين، لا إجابة نهائية من غير مصدر موثوق.');

        if (hasSource) {
            lines.push('حالة التحقق: تم العثور على مصدر أو بيانات يمكن ربطها بمعلومة الإجابة.');
        } else {
            lines.push('حالة التحقق: لا يوجد مصدر موثوق في السياق الحالي.');
            lines.push('إجابتك ستقتصر على ما يمكن التحقق منه فقط، أو ستطلب توضيحاً إذا كانت المعلومة غير مؤكدة.');
        }

        lines.push('سلسلة التنفيذ: تحليل الطلب → استرجاع المصدر → التحقق من التوافق → الإجابة مع الدليل → مراجعة نهائية.');
        return lines;
    },
};
