// ============================================================
// Time Tool — الساعة والتاريخ الحقيقيان من ساعة الجهاز
// خامس أداة مسجلة في Suras Tool Registry.
// إجابة حتمية محلية: لا تخمين ولا "لا أستطيع معرفة الوقت".
// ============================================================

import { scoreKeywords } from './classifier.js';

const TIME_RE = /((كم|كام) الساعة|الساعة (كم|كام)|ساعة (كم|كام)|قديش الساعة|اي ساعة|أي ساعة|الوقت الآن|الوقت الحالي|الساعة الآن|what time|time now|tell me the time)/i;
const DATE_RE = /(اليوم ايش|اي يوم اليوم|أي يوم|التاريخ اليوم|تاريخ اليوم|التاريخ كم|what date|today.*date|which day)/i;

export const TIME_TOOL = {
    name: 'time',
    description: 'الساعة والتاريخ الحاليان من ساعة الجهاز المحلية',
    searchHint: 'كم الساعة الآن، تاريخ اليوم، what time is it',
    keywords: [
        { term: 'الساعة', weight: 3 }, { term: 'ساعة', weight: 1 },
        { term: 'الوقت', weight: 2 }, { term: 'التاريخ', weight: 2 },
        { term: 'تاريخ', weight: 1 }, { term: 'اليوم', weight: 1 },
        { term: 'time', weight: 2 }, { term: 'date', weight: 1 },
        { term: 'كم', weight: 1 },
    ],
    threshold: 1,
    timeoutMs: 5000,

    matches(query) {
        const text = String(query || '');
        if (!(TIME_RE.test(text) || DATE_RE.test(text))) return null;
        const { score } = scoreKeywords(text, TIME_TOOL.keywords, 'time');
        return { score: Math.max(1, score) };
    },

    async run(query, ctx) {
        const { io } = ctx;
        const now = new Date();
        const timeStr = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
            hour: '2-digit', minute: '2-digit',
        }).format(now);
        const dayStr = new Intl.DateTimeFormat('ar-JO', { weekday: 'long' }).format(now);
        const dateStr = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
            day: 'numeric', month: 'long', year: 'numeric',
        }).format(now);
        const text = `الساعة ${timeStr} — ${dayStr} ${dateStr}`;
        io.emit('agent-update', { agent: 'Time', role: 'Now', text: `🕐 ${text}`, theme: 'blue' });
        return [`[الساعة الآن]: ${text}`];
    },
};
