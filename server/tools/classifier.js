// ============================================================
// Suras Intent Classifier — مصنّف النوايا المركزي
// ------------------------------------------------------------
// فكرة مقتبسة (إعادة تنفيذ بلغتنا):
//  • مطابقة موزونة متعددة الإشارات (اسم تام > جزء > تضمين)
//  • مستويات ثقة: high (تنفيذ) / medium (توضيح) / low (تجاهل)
//  • يدعم آلاف النوايا: كل أداة تعلن keywords فقط، والمصنّف يرتّب
// الأدوات ذات matches() المخصص تبقى لها الأولوية (سلوكها محفوظ).
// ============================================================

const TASHKEEL_RE = /[ؐ-ًؚ-ٰٟ]/g;

// الأوزان المتعلّمة (server/tools/weights.json) — يكتبها learner.js.
// تُحمَّل كسولةً ومخزّنة؛ reloadLearnedWeights() تبطل التخزين بعد دورة تعلّم.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expandWithDialects } from './dialects.js';

const __cfDir = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = path.join(__cfDir, 'weights.json');
let _learnedCache = null;

function loadLearnedWeights() {
    if (_learnedCache !== null) return _learnedCache;
    try {
        const raw = fs.readFileSync(WEIGHTS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        _learnedCache = (parsed && parsed.weights && typeof parsed.weights === 'object') ? parsed.weights : {};
    } catch (_) {
        _learnedCache = {};
    }
    return _learnedCache;
}

/** إبطال تخزين الأوزان (بعد دورة تعلّم). */
export function reloadLearnedWeights() {
    _learnedCache = null;
    return loadLearnedWeights();
}

/** مضاعف التعلّم لحدّ (tool, term) — 1.0 افتراضياً. */
export function learnedMultiplier(toolName, term) {
    const w = loadLearnedWeights();
    const t = w && w[toolName] && w[toolName][term];
    return (typeof t === 'number' && t > 0) ? t : 1.0;
}

function norm(s) {
    return String(s || '').replace(TASHKEEL_RE, '').toLowerCase();
}

function tokenize(s) {
    return norm(s).split(/[\s_.,،؛؟?!.|/\\\-:"'()\[\]{}]+/).filter(t => t.length > 1);
}

/**
 * تسجيل إشارة موزونة واحدة.
 * keyword: { term: string|RegExp, weight=1 }
 *  • كلمة تامة = weight*2 ، تضمين نصي = weight ، تعبير نمطي = weight*2
 *  • تُضرب الأوزان النصية بمضاعف التعلّم (weights.json) عند توفر toolName
 */
export function scoreKeywords(query, keywords = [], toolName = null) {
    // طبقة اللهجات أولاً: إلحاق المرادفات الفصيحة (النص الأصلي محفوظ)
    const expanded = expandWithDialects(query);
    const text = norm(expanded);
    const tokens = new Set(tokenize(expanded));
    let score = 0;
    const hits = [];
    for (const k of keywords || []) {
        if (!k || k.term == null) continue;
        const w = k.weight || 1;
        if (k.term instanceof RegExp) {
            if (k.term.test(text)) { score += w * 2; hits.push(String(k.term)); }
            continue;
        }
        const t = norm(k.term);
        if (!t) continue;
        const mult = toolName ? learnedMultiplier(toolName, t) : 1.0;
        if (tokens.has(t)) { score += w * 2 * mult; hits.push(mult !== 1 ? `${t}x${mult}` : t); }
        else if (text.includes(t)) { score += w * mult; hits.push((mult !== 1 ? `${t}x${mult}` : t) + '~'); }
    }
    return { score: Math.round(score * 100) / 100, hits };
}

/**
 * ترتيب كل الأدوات حسب الدرجة مع مستوى الثقة.
 * tools: [{ name, threshold=1, keywords }]
 */
export function classify(query, tools = []) {
    const ranked = [];
    for (const t of tools) {
        const { score, hits } = scoreKeywords(query, t.keywords || []);
        if (score <= 0) continue;
        const th = t.threshold ?? 1;
        ranked.push({
            name: t.name,
            score,
            hits,
            level: score >= th ? 'high' : (score >= th / 2 ? 'medium' : 'low'),
        });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
}
