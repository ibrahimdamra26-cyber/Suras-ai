// ============================================================
// Suras Regression Battery — بطارية الانحدار للنوايا
// ------------------------------------------------------------
// بلا أي آثار جانبية: تختبر المطابقة (matchTools) والتوضيح
// (clarifyIntent) فقط — لا تنفيذ. تُعرض عبر
// GET /api/system/regression وتُشغَّل بعد كل تغيير.
// ============================================================

import { matchTools, clarifyIntent, describeTools } from './registry.js';
import { classify } from './classifier.js';

// كل حالة: الاستعلام ← الأداة المتوقعة ('auto-video' | 'health' | null) + توضيح متوقع (اسم الأداة | null)
// وهي نفسها مجموعة التدريب المُصنّفة للمتعلّم (learner.js) — حقيقة أرضية واحدة.
export const CASES = [
    { query: 'اصنع فيديو اعلاني عن قهوة عربية فاخرة', expectTool: 'auto-video', expectClarify: null },
    { query: 'اصنع لي فيدو لاعلان تسويقي عن القهوة', expectTool: 'auto-video', expectClarify: null },
    { query: 'سوي لي فيديو عن العسل', expectTool: 'auto-video', expectClarify: null },
    { query: 'create a marketing video about honey', expectTool: 'auto-video', expectClarify: null },
    { query: 'احذف الفيديو القديم', expectTool: null, expectClarify: null },
    { query: 'فيديو عن القهوة', expectTool: null, expectClarify: 'auto-video' },
    { query: 'اقرأ ملف notes.txt', expectTool: null, expectClarify: null },
    { query: 'شغل whoami في الباورشيل', expectTool: 'terminal', expectClarify: null },
    { query: 'افحص صحة السيرفرات', expectTool: 'health', expectClarify: null },
    { query: 'هل المحرك يعمل؟', expectTool: 'health', expectClarify: null },
    { query: 'اقرأ الرابط https://example.com', expectTool: 'page-read', expectClarify: null },
    { query: 'افتح موقع يوتيوب', expectTool: null, expectClarify: null },
    { query: 'اعرض المشاريع المخزنة', expectTool: 'projects', expectClarify: null },
    { query: 'افتح مشروع المتجر', expectTool: 'projects', expectClarify: null },
    { query: 'مشروع', expectTool: null, expectClarify: 'projects' },
    { query: 'اريد سرعة مشروع', expectTool: 'projects', expectClarify: null },
    { query: 'ابغى مشروع', expectTool: 'projects', expectClarify: null },
    { query: 'دعنا نتعارف', expectTool: null, expectClarify: null },
    { query: 'عرفني على نفسك', expectTool: null, expectClarify: null },
    { query: 'كم الساعة الان', expectTool: 'time', expectClarify: null },
    { query: 'تاريخ اليوم', expectTool: 'time', expectClarify: null },
    { query: 'what time is it', expectTool: 'time', expectClarify: null },
    { query: 'صمم لي صفحة هبوط مثل موقع amazon', expectTool: 'pagegen', expectClarify: null },
    { query: 'نفس تصميم موقع amazon بدقة', expectTool: 'pagegen', expectClarify: null },
    { query: 'ابن موقع متجر عطور', expectTool: 'pagegen', expectClarify: null },
    // —— اللهجات: مصري/شامي/خليجي (تطبيع dialects.js) ——
    { query: 'عايز افتح مشروع المتجر', expectTool: 'projects', expectClarify: null },
    { query: 'بدي اعرض المشاريع المخزنة', expectTool: 'projects', expectClarify: null },
    { query: 'عايز فيديو عن القهوة', expectTool: null, expectClarify: 'auto-video' },
    { query: 'الساعة كام دلوقتي', expectTool: 'time', expectClarify: null },
    { query: 'قديش الساعة هلق', expectTool: 'time', expectClarify: null },
    { query: 'السيرفر شغال ولا لا', expectTool: 'health', expectClarify: null },
    { query: 'دورلي في الانترنت عن الذكاء الاصطناعي', expectTool: 'webscout', expectClarify: null },
    { query: 'اقرا الرابط https://example.com', expectTool: 'page-read', expectClarify: null },
    { query: 'جيب لي اكواد بايثون من الانترنت', expectTool: 'webscout', expectClarify: null },
    // —— عائلات صرفية ولهجية (أوزان الفعل/المشتقات) ——
    { query: 'اعرض اخطاء المشروع', expectTool: 'projects', expectClarify: null },
    { query: 'رتب مشاريعي المبنية', expectTool: 'organizer', expectClarify: null },
    { query: 'اعرض تصاميم صفحة هبوط لموقعي', expectTool: 'pagegen', expectClarify: null },
    { query: 'وريني مشروعات المتجر', expectTool: 'projects', expectClarify: null },
    { query: 'ابني موقع متجر العطور', expectTool: 'pagegen', expectClarify: null },
    { query: 'صمم صفحة مؤسستي', expectTool: 'pagegen', expectClarify: null },
    // —— P2: سلبيات + اتساع لهجي + أقفال ضد الاختطاف ——
    { query: 'بشكل أفضل', expectTool: null, expectClarify: null },
    { query: 'ابي افتح مشروع المتجر', expectTool: 'projects', expectClarify: null },
    { query: 'وريني المشاريع المخزنة', expectTool: 'projects', expectClarify: null },
    { query: 'دورلي على مشروع', expectTool: 'webscout', expectClarify: null },
    { query: 'اقرالي الرابط https://example.com', expectTool: 'page-read', expectClarify: null },
    { query: 'كم الساعة الحين', expectTool: 'time', expectClarify: null },
    { query: 'تأكد ان المحرك شغال', expectTool: 'health', expectClarify: null },
    { query: 'صمم موقع متجر', expectTool: 'pagegen', expectClarify: null },
    { query: 'افتح مشروع', expectTool: 'projects', expectClarify: null },
    // —— P5: الأدوات الأربع الجديدة ——
    { query: 'شغل whoami', expectTool: 'terminal', expectClarify: null },
    { query: 'نفذ echo test', expectTool: 'terminal', expectClarify: null },
    { query: 'جرب الكود التالي ```js\nconsole.log(42)\n```', expectTool: 'code-runner', expectClarify: null },
    { query: 'شغل سكريبت البايثون ```python\nprint("hi")\n```', expectTool: 'code-runner', expectClarify: null },
    { query: 'اجلب كود الصفحة https://example.com', expectTool: 'webfetch', expectClarify: null },
    { query: 'هات محتوى https://example.com', expectTool: 'webfetch', expectClarify: null },
    { query: 'اعرض مشاريعي المبنية', expectTool: 'organizer', expectClarify: null },
    { query: 'نظم مشاريع built_projects', expectTool: 'organizer', expectClarify: null },
];

export function runRegression() {
    const tools = describeTools();
    const results = CASES.map(c => {
        const matched = matchTools(c.query).map(m => m.tool.name);
        const gotTool = matched.length > 0 ? matched[0] : null;
        const clar = gotTool ? null : clarifyIntent(c.query);
        const gotClarify = clar ? clar.name : null;
        const pass = gotTool === c.expectTool && gotClarify === c.expectClarify;
        return {
            query: c.query,
            expected: { tool: c.expectTool, clarify: c.expectClarify },
            got: { tool: gotTool, clarify: gotClarify },
            classifier: classify(c.query, tools),
            pass,
        };
    });
    const passed = results.filter(r => r.pass).length;
    return { total: results.length, passed, failed: results.length - passed, results };
}
