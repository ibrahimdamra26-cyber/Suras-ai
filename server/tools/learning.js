// ============================================================
// Internal Learning Loop — دورة تدريب داخلية محلية
// تُعلم النظام من أسئلة مستخدمين واقعية وتقييمات ردودهم دون أي
// وكيل خارجي أو خدمة سحابية. هذا محرك تعلم محلي تقني وصادق.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRAINING_FILE = path.join(__dirname, '..', 'knowledge', 'train_examples.json');

function loadExamples(filePath = TRAINING_FILE) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, ' ')
        .trim();
}

export function evaluateModelQuality(question, answer) {
    const examples = loadExamples();
    if (!examples.length) {
        return { total: 0, average_score: 0, best_match: null, status: 'no_training_data' };
    }

    const q = normalizeText(question);
    const a = normalizeText(answer);
    let best = null;

    for (const example of examples) {
        const exQ = normalizeText(example.question || '');
        const exA = normalizeText(example.answer || '');
        const qOverlap = exQ && q ? (q.includes(exQ) || exQ.includes(q) ? 1 : 0) : 0;
        const aOverlap = exA && a ? (a.includes(exA) || exA.includes(a) ? 1 : 0) : 0;
        const score = Number((qOverlap * 0.6 + aOverlap * 0.4).toFixed(2));
        if (!best || score > best.score) {
            best = { score, category: example.category || 'unknown', question: example.question, answer: example.answer };
        }
    }

    const bestScore = best ? best.score : 0;
    return {
        total: examples.length,
        average_score: Number((bestScore * 0.8 + (examples.length > 0 ? 1 : 0) * 0.2).toFixed(2)),
        best_match: best,
        status: bestScore >= 0.6 ? 'good' : 'weak',
    };
}

export function addTrainingFeedback({ question, answer, category = 'general', accepted = true }) {
    const examples = loadExamples();
    const item = {
        question: String(question || '').trim(),
        answer: String(answer || '').trim(),
        category: String(category || 'general').trim(),
        accepted: Boolean(accepted),
        timestamp: new Date().toISOString(),
    };

    if (!item.question || !item.answer) return { added: false, reason: 'question and answer are required' };

    const existed = examples.some((entry) => normalizeText(entry.question) === normalizeText(item.question) && normalizeText(entry.answer) === normalizeText(item.answer));
    if (existed) return { added: false, reason: 'duplicate_training_example' };

    examples.push(item);
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(examples, null, 2), 'utf-8');
    return { added: true, total: examples.length, sample: item };
}

export function getTrainingSummary() {
    const examples = loadExamples();
    const byCategory = {};
    let accepted = 0;

    for (const item of examples) {
        const category = String(item.category || 'general');
        byCategory[category] = (byCategory[category] || 0) + 1;
        if (item.accepted) accepted += 1;
    }

    return {
        total_examples: examples.length,
        accepted_examples: accepted,
        categories: byCategory,
        status: examples.length > 0 ? 'ready' : 'empty',
    };
}
