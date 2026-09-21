// ============================================================
// Suras Tool Registry — سجل الأدوات الموحد
// ------------------------------------------------------------
// فكرة مقتبسة (إعادة تنفيذ بلغتنا، لا نسخ):
//  • ToolDef schema: { name, description, searchHint, threshold, timeoutMs, matches, run }
//  • مطابقة موزونة بعتبة (مستوحاة من ToolSearchTool) + سؤال عند الغموض لاحقاً
//  • كل نية تعلن أدواتها — لا أداة تعمل خارج نيتها
//  • مهلة إجبارية لكل أداة + عزل الأخطاء (فشل أداة لا يكسر البقية)
// ============================================================

import { traceStep } from './trace.js';
import { scoreKeywords } from './classifier.js';

const _tools = [];

/**
 * تسجيل أداة جديدة في السجل.
 * العقد الأدنى: { name, matches(query)->{score}|null, run(query, ctx)->Promise<string[]> }
 */
export function defineTool(def) {
    const hasMatcher = typeof def.matches === 'function'
        || (Array.isArray(def.keywords) && def.keywords.length > 0);
    if (!def || !def.name || !hasMatcher || typeof def.run !== 'function') {
        throw new Error(`[ToolRegistry] تعريف أداة ناقص: ${def && def.name} (يلزم matches أو keywords + run)`);
    }
    if (_tools.some(t => t.name === def.name)) {
        throw new Error(`[ToolRegistry] أداة مسجلة مسبقاً: ${def.name}`);
    }
    _tools.push({
        name: def.name,
        description: def.description || '',
        searchHint: def.searchHint || '',
        threshold: def.threshold ?? 1,
        timeoutMs: def.timeoutMs || 120000,
        matches: def.matches,
        keywords: Array.isArray(def.keywords) ? def.keywords : [],
        partial: typeof def.partial === 'function' ? def.partial : null,
        run: def.run,
    });
    console.log(`[ToolRegistry] ✅ أداة مسجلة: ${def.name}`);
    return def.name;
}

/** أسماء الأدوات المسجلة (للتشخيص). */
export function listTools() {
    return _tools.map(t => t.name);
}

/** جلب تعريف أداة بالاسم (لموجة ReAct — يُتحقق من التسجيل قبل أي تنفيذ). */
export function getTool(name) {
    const n = String(name || '').trim();
    return _tools.find(t => t.name === n) || null;
}

/** وصف الأدوات للمصنّف والتشخيص (بلا دوال — آمن للتسلسل). */
export function describeTools() {
    return _tools.map(t => ({
        name: t.name,
        threshold: t.threshold,
        keywords: (t.keywords || []).map(k => ({
            term: k.term instanceof RegExp ? String(k.term) : k.term,
            weight: k.weight || 1,
        })),
    }));
}

/**
 * مطابقة الاستعلام ضد كل الأدوات المسجلة.
 * تُرجع [{ tool, score }] مرتبة تنازلياً ممن تجاوزت العتبة فقط.
 */
export function matchTools(query) {
    const out = [];
    for (const tool of _tools) {
        let m = null;
        try {
            if (typeof tool.matches === 'function') {
                // الأولوية للمطابق المخصص (سلوك محفوظ تماماً)
                m = tool.matches(query);
            } else if (tool.keywords.length > 0) {
                // بديل المصنّف المركزي للأدوات المعلنة بالكلمات فقط
                const { score, hits } = scoreKeywords(query, tool.keywords);
                if (score > 0) m = { score, hits };
            }
        } catch (e) {
            console.log(`[ToolRegistry] matches() فشل لـ ${tool.name}: ${e.message}`);
            continue;
        }
        const score = m && typeof m.score === 'number' ? m.score : 0;
        if (m && score >= tool.threshold) {
            out.push({ tool, score });
        }
    }
    out.sort((a, b) => b.score - a.score);

    const text = String(query || '');
    const explicitProjectBuild = /(مشروع|تطبيق|dashboard|api|backend|واجهة كاملة|هيكل المشروع|ملفات المشروع|مجلدات المشروع|web app|app)/i.test(text)
        && /(انشئ|أنشئ|ابني|أبني|اصنع|سوي|اعمل|صمم|تصميم|build|create|generate|scaffold|make)/i.test(text);

    if (explicitProjectBuild) {
        return out.filter(item => item.tool.name !== 'pagegen');
    }

    // Landing-page requests belong exclusively to pagegen. The project engine
    // also matches broad words such as "موقع" and "واجهة", so allowing both
    // tools to run makes the second preview overwrite the first one.
    const landingPageRequest = /(صفحة هبوط|landing|page|website|site|متجر|هبوط)/i.test(text)
        && /(صمم|تصميم|ابن|ابني|انشئ|أنشئ|اعمل|سوي|اصنع|create|design|build|generate|make)/i.test(text)
        && !/(مشروع كامل|تطبيق كامل|هيكل المشروع|ملفات المشروع|مجلدات المشروع|web app|dashboard|api|backend)/i.test(text);
    if (landingPageRequest) {
        return out.filter(item => item.tool.name !== 'project-engine');
    }

    return out;
}

/**
 * توضيح الغموض: إن لم تُطابَق أي أداة، ابحث عن تطابق جزئي (partial)
 * واسأل سؤالاً واحداً محدداً بدل التجاهل الصامت.
 * @returns {{ name, question } | null}
 */export function clarifyIntent(query) {
    for (const tool of _tools) {
        if (typeof tool.partial !== 'function') continue;
        try {
            const p = tool.partial(query);
            if (p && p.question) {
                return { name: tool.name, question: String(p.question) };
            }
        } catch (e) {
            console.log(`[ToolRegistry] partial() فشل لـ ${tool.name}: ${e.message}`);
        }
    }
    return null;
}

// ============================================================
// كشف البقايا (Residual awareness) — جوهر الفهم الصادق:
// بعد تنفيذ الأدوات، أي كلمة جوهرية لم يستهلكها أي فهم تُصرَّح
// بها بدل دفنها بصمت ("سرعة" في: اريد سرعة مشروع).
// ============================================================
const RESIDUAL_STOPWORDS = new Set([
    'عن', 'في', 'من', 'على', 'الى', 'إلى', 'هل', 'ما', 'ماذا', 'متى', 'أين',
    'اين', 'كيف', 'لماذا', 'لم', 'لن', 'لا', 'هذا', 'هذه', 'ذلك', 'تلك',
    'كل', 'مع', 'بين', 'أو', 'ام', 'ثم', 'قد', 'هو', 'هي', 'هم', 'نحن',
    'انت', 'أنت', 'انا', 'أنا', 'يا', 'أي', 'اي', 'اليوم', 'الان', 'الآن',
    'كم', 'لي', 'لك', 'له', 'جدا', 'قليلا', 'بعض', 'غير', 'عبر', 'خلال',
    'بعد', 'قبل', 'عند', 'لدى', 'the', 'a', 'an', 'to', 'of', 'is', 'it',
]);

function normTok(t) {
    let s = String(t || '').replace(/[ؐ-ًؚ-ٰٟ]/g, '').toLowerCase();
    s = s.replace(/^وال|^بال|^كال|^لل|^ال/, '');
    s = s.replace(/^[وبفكل]/, '');
    return s;
}

function splitTokens(s) {
    return String(s || '')
        .replace(/[ؐ-ًؚ-ٰٟ]/g, '')
        .split(/[\s_.,،؛؟?!.|/\\\-:"'()\[\]{}]+/)
        .map(t => t.trim())
        .filter(t => t.length > 2 && !RESIDUAL_STOPWORDS.has(t.toLowerCase()));
}

/** الكلمات المستهلكة: ضربات الكلمات المفتاحية + الكيانات التي سجلتها الأدوات في ctx.entities */
function consumedTokens(query, tools, ctx) {
    const consumed = new Set();
    const qtoks = splitTokens(query);
    for (const tool of tools) {
        for (const k of tool.keywords || []) {
            if (!k || k.term == null || k.term instanceof RegExp) continue;
            const kt = normTok(k.term);
            if (!kt) continue;
            for (const t of qtoks) {
                const nt = normTok(t);
                if (nt === kt || nt.includes(kt) || kt.includes(nt)) {
                    consumed.add(t.toLowerCase());
                }
            }
        }
    }
    for (const e of (ctx && ctx.entities) || []) {
        for (const t of splitTokens(e)) consumed.add(t.toLowerCase());
    }
    return consumed;
}

/** الكلمات الجوهرية المتبقية بلا فهم — تُعاد كملاحظة صريحة. */
export function findResidual(query, tools, ctx) {
    const consumed = consumedTokens(query, tools, ctx);
    return splitTokens(query).filter(t => !consumed.has(t.toLowerCase()));
}

function withTimeout(promise, ms, toolName) {
    let timer = null;
    const guard = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`تجاوز المهلة (${Math.round(ms / 1000)}s)`)), ms);
    });
    return Promise.race([promise, guard]).finally(() => {
        if (timer) clearTimeout(timer);
    }).catch(err => {
        throw new Error(`[${toolName}] ${err.message}`);
    });
}

/**
 * تنفيذ الأدوات المطابقة وإرجاع ملاحظاتها (obs) جاهزة للحقن.
 * لا ترمي استثناءً أبداً — الفشل يُدوَّن كملاحظة.
 */
export async function dispatchTools(query, ctx = {}) {
    const obs = [];
    const matched = matchTools(query);
    if (matched.length === 0) return obs;
    const traceId = ctx.traceId || null;
    if (!Array.isArray(ctx.entities)) ctx.entities = [];
    if (traceId) traceStep(traceId, 'tools.matched', matched.map(m => `${m.tool.name}(${m.score})`).join(', '));
    console.log(`[ToolRegistry] نية مطابقة: ${matched.map(m => `${m.tool.name}(${m.score})`).join(', ')}`);
    for (const { tool } of matched) {
        const t0 = Date.now();
        try {
            const res = await withTimeout(tool.run(query, ctx), tool.timeoutMs, tool.name);
            if (traceId) traceStep(traceId, `tool.${tool.name}.ok`, `${Date.now() - t0}ms`);
            if (Array.isArray(res)) {
                for (const line of res) {
                    if (line) obs.push(String(line));
                }
            }
        } catch (e) {
            if (traceId) traceStep(traceId, `tool.${tool.name}.error`, e.message);
            console.log(`[ToolRegistry] EXCEPTION ${tool.name}: ${e.message}`);
            obs.push(`[خطأ الأداة ${tool.name}]: ${e.message}`);
            try {
                ctx.io && ctx.io.emit('agent-update', {
                    agent: tool.name, role: 'Error',
                    text: `❌ خطأ الأداة: ${e.message}`, theme: 'red',
                });
            } catch (_) { /* تجاهل فشل البث */ }
        }
    }
    // البقايا: كلمات جوهرية لم يستهلكها أي فهم — تُصرَّح بدل دفنها
    try {
        const leftovers = findResidual(query, matched.map(m => m.tool), ctx);
        if (leftovers.length > 0) {
            const names = matched.map(m => m.tool.name).join(' + ');
            const note = `[تنبيه فهم جزئي]: كلمة "${leftovers.join('، ')}" لم تُفسَّر ضمن طلبك — نفّذتُ (${names}) بأأمن تفسير. إن قصدتَ بها شيئاً آخر فوضّح معناها.`;
            obs.push(note);
            if (traceId) traceStep(traceId, 'intent.residual', leftovers.join(','));
            console.log(`[ToolRegistry] residual: ${leftovers.join(',')}`);
        }
    } catch (_) { /* البقايا تشخيصية — لا تكسر التنفيذ */ }
    return obs;
}
