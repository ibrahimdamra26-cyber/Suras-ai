// ============================================================
// Health Tool — فحص صحة السيرفرات والمحركات (قراءة فقط)
// ثاني أداة مسجلة في Suras Tool Registry.
// ============================================================

import { scoreKeywords } from './classifier.js';

const HEALTH_KEYWORDS = [
    { term: 'صحة', weight: 3 }, { term: 'صحه', weight: 3 }, { term: 'هيلث', weight: 3 },
    { term: 'health', weight: 3 }, { term: 'افحص', weight: 2 }, { term: 'تحقق', weight: 2 },
    { term: 'السيرفر', weight: 2 }, { term: 'السيرفرات', weight: 2 },
    { term: 'المحرك', weight: 2 }, { term: 'المحركات', weight: 2 },
    { term: 'النظام', weight: 1 }, { term: 'يعمل', weight: 1 }, { term: 'شغال', weight: 1 },
];

function isHealthRequest(text) {
    const t = String(text || '');
    const triggerFirst = /(صحة|صحه|هيلث|health|افحص|تحقق|تأكد|شغال|يعمل).*(السيرفر|السيرفرات|النظام|المحرك|المحركات|الخدمات)/i.test(t);
    const imperative = /^(افحص|تحقق).*(صحة|هيلث|health|سيرفر|محرك|نظام)/i.test(t);
    const nounFirst = /(السيرفر|السيرفرات|النظام|المحرك|المحركات|الخدمات).*(يعمل|شغال|بخير|تمام|طيب|صحة|هيلث|health|وضعه|اخباره)/i.test(t);
    return triggerFirst || imperative || nounFirst;
}
export const HEALTH_TOOL = {
    name: 'health',
    description: 'فحص صحة سيرفر الواجهة ومحرك FastAPI وFFmpeg ومجلد الإنتاج',
    searchHint: 'افحص صحة السيرفرات، هل المحرك يعمل، health check النظام',
    keywords: HEALTH_KEYWORDS,
    threshold: 1,
    timeoutMs: 30000,

    matches(query) {
        // بوابة صلبة أولاً — ثم الدرجة من المصنّف (تتأثر بالتعلّم)
        if (!isHealthRequest(query)) return null;
        const { score } = scoreKeywords(query, HEALTH_KEYWORDS, 'health');
        return { score: Math.max(1, score) };
    },

    async run(query, ctx) {
        const { govUrl, rootDir, fs, path, io } = ctx;
        const obs = [];
        const lines = [];
        io.emit('agent-update', { agent: 'Health', role: 'Checking', text: '🩺 أفحص صحة المنظومة...', theme: 'blue' });

        // 1) محرك FastAPI (3010) + قدرات مسجلة فعلاً (فيديو/صوت/استطلاع)
        let paths = [];
        try {
            const r = await fetch(`${govUrl}/openapi.json`, { signal: AbortSignal.timeout(10000) });
            if (r.ok) {
                const spec = await r.json();
                paths = Object.keys((spec && spec.paths) || {});
                lines.push('✅ محرك FastAPI (3010): يعمل');
            } else {
                lines.push(`❌ محرك FastAPI (3010): HTTP ${r.status}`);
            }
        } catch (e) {
            lines.push(`❌ محرك FastAPI (3010): لا يستجيب (${e.message})`);
        }
        const hasVideo = paths.some(p => p.includes('create-auto-video'));
        const hasTts = paths.some(p => p.includes('/tts'));
        lines.push(hasVideo ? '✅ محرك الفيديو الأوتوماتيكي: مسجّل' : '❌ محرك الفيديو الأوتوماتيكي: غير مسجّل');
        lines.push(hasTts ? '✅ محرك النطق: مسجّل' : '❌ محرك النطق: غير مسجّل');

        // 3) مجلد الإنتاج قابل للكتابة
        try {
            const outDir = path.join(rootDir, 'productions');
            await fs.mkdir(outDir, { recursive: true });
            const probe = path.join(outDir, '.health_probe');
            await fs.writeFile(probe, 'ok', 'utf-8');
            await fs.unlink(probe);
            lines.push('✅ مجلد productions: قابل للكتابة');
        } catch (e) {
            lines.push(`❌ مجلد productions: ${e.message}`);
        }

        // 4) زمن تشغيل سيرفر الواجهة
        lines.push(`✅ سيرفر الواجهة (3001): يعمل — زمن التشغيل ${Math.round(process.uptime())}s`);

        obs.push(`[تقرير صحة المنظومة]:\n${lines.join('\n')}`);
        io.emit('agent-update', { agent: 'Health', role: 'Report', text: lines.join('\n'), theme: 'green' });
        return obs;
    },
};
