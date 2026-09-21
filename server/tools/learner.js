// ============================================================
// Suras Learner — التعلّم من النتائج المصنّفة (تدريب المصنّف)
// ------------------------------------------------------------
// تدريب صادق وخاضع للقياس: مجموعة CASES المُصنّفة في
// regression.js هي الحقيقة الأرضية. الدورة تحسب لكل حدّ
// (term, tool) مضاعف دقة مُنعَّم وتكتبه في weights.json،
// فيستخدمها المصنّف (classifier.js) فوراً بعد إبطال التخزين.
// القياس: دقة البطارية قبل/بعد — تُرفض الدورة إن سببت انحداراً.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describeTools, matchTools } from './registry.js';
import { reloadLearnedWeights } from './classifier.js';
import { CASES } from './regression.js';
import { expandWithDialects } from './dialects.js';

const __lrDir = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = path.join(__lrDir, 'weights.json');

function normTerm(t) {
    return String(t || '').replace(/[ؐ-ًؚ-ٰٟ]/g, '').toLowerCase();
}

function tokenize(q) {
    // نفس توسيع اللهجات الذي يراه المصنّف — حتى يتعلّم من الصيغ اللهجية
    return normTerm(expandWithDialects(q)).split(/[\s_.,،؛؟?!.|/\\\-:"'()\[\]{}]+/).filter(t => t.length > 1);
}

/** دقة البطارية الحالية (كسر 0..1) باستخدام المطابقة الحية. */
export function batteryAccuracy() {
    let ok = 0;
    for (const c of CASES) {
        const matched = matchTools(c.query).map(m => m.tool.name);
        const got = matched.length > 0 ? matched[0] : null;
        if (got === c.expectTool) ok++;
    }
    return { acc: ok / CASES.length, ok, total: CASES.length };
}

function readWeights() {
    try {
        const raw = fs.readFileSync(WEIGHTS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.weights && typeof parsed.weights === 'object') return parsed;
    } catch (_) { /* لا ملف بعد */
    }
    return { version: 1, updatedAt: null, cycles: 0, weights: {} };
}

/** حالة الأوزان المتعلّمة (للتشخيص). */
export function weightsStatus() {
    const w = readWeights();
    let count = 0;
    for (const t of Object.keys(w.weights)) count += Object.keys(w.weights[t]).length;
    return { cycles: w.cycles || 0, updatedAt: w.updatedAt, entries: count, weights: w.weights };
}

/**
 * دورة تعلّم واحدة:
 *  mult(t,T) = دقة الحد المُنعَّمة / أولوية الأداة — مقيدة [0.2, 5].
 * تُحفظ فقط المضاعفات المتباينة عن 1.0، وتُرفض الدورة إن خفّضت الدقة.
 */
export function runLearningCycle() {
    const before = batteryAccuracy();
    const tools = describeTools();
    const labels = CASES.map(c => c.expectTool);

    // إحصاء: لكل أداة T وحدّ t — ظهوره في استعلامات T مقابل كل الاستعلامات
    const stats = {}; // key `${tool}||${term}` -> { hitT, hitAll }
    const bump = (tool, term, isT) => {
        const k = `${tool}||${term}`;
        if (!stats[k]) stats[k] = { hitT: 0, hitAll: 0 };
        stats[k].hitAll++;
        if (isT) stats[k].hitT++;
    };

    for (const tool of tools) {
        const kwTerms = (tool.keywords || []).map(k => normTerm(k.term)).filter(Boolean);
        for (const c of CASES) {
            const toks = new Set(tokenize(c.query));
            const text = normTerm(c.query);
            for (const t of kwTerms) {
                if (toks.has(t) || text.includes(t)) {
                    bump(tool.name, t, c.expectTool === tool.name);
                }
            }
        }
    }

    const prior = {};
    for (const tool of tools) {
        prior[tool.name] = labels.filter(l => l === tool.name).length / Math.max(1, labels.length);
    }

    const ALPHA = 1.0, K = 2.0;
    const next = {};
    for (const key of Object.keys(stats)) {
        const [tool, term] = key.split('||');
        const s = stats[key];
        const precision = (s.hitT + ALPHA) / (s.hitAll + ALPHA * K);
        const mult = precision / Math.max(prior[tool] || 0.05, 0.05);
        const clamped = Math.max(0.2, Math.min(5, Math.round(mult * 100) / 100));
        if (Math.abs(clamped - 1) > 0.05) {
            if (!next[tool]) next[tool] = {};
            next[tool][term] = clamped;
        }
    }

    // احفظ مؤقتاً وقيّم — ارفض إن سببت انحداراً
    const prev = readWeights();
    const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        cycles: (prev.cycles || 0) + 1,
        weights: next,
    };
    fs.writeFileSync(WEIGHTS_PATH + '.tmp', JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(WEIGHTS_PATH + '.tmp', WEIGHTS_PATH);
    reloadLearnedWeights();
    const after = batteryAccuracy();

    if (after.acc < before.acc) {
        // انحدار — استعد السابق
        if (prev.updatedAt) {
            fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(prev, null, 2), 'utf-8');
        } else {
            try { fs.unlinkSync(WEIGHTS_PATH); } catch (_) { /* لا ملف */ }
        }
        reloadLearnedWeights();
        return {
            accepted: false,
            reason: 'الدورة خفّضت دقة البطارية — رُفضت واستُعيد السابق',
            before, after,
        };
    }
    return { accepted: true, before, after, ...weightsStatus() };
}
