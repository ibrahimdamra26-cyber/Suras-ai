// ============================================================
// Knowledge Base / RAG Core — قاعدة معرفة بسيطة وموجهة للحقائق
// تتيح استرجاع مستندات موثقة وفق كلمات الاستعلام، مع مصدر واضح.
// ============================================================

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreKeywords } from './classifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_KB_PATH = path.join(__dirname, '..', 'knowledge', 'seed.json');

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, ' ')
        .trim();
}

function tokenize(text) {
    return normalize(text)
        .split(' ')
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => t.length > 2);
}

function loadKnowledgeBase(filePath = DEFAULT_KB_PATH) {
    try {
        if (!existsSync(filePath)) return [];
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.log(`[Knowledge] failed to load seed knowledge: ${error.message}`);
        return [];
    }
}

function scoreDocument(query, doc) {
    const qTokens = new Set(tokenize(query));
    const text = `${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`;
    const tokens = tokenize(text);
    const wordMap = new Map();

    for (const token of tokens) {
        wordMap.set(token, (wordMap.get(token) || 0) + 1);
    }

    let score = 0;
    for (const token of qTokens) {
        score += (wordMap.get(token) || 0) * 3;
        if (text.toLowerCase().includes(token)) score += 1;
    }

    if (doc.title && normalize(doc.title).includes(normalize(query))) score += 8;
    return score;
}

function buildVector(text, vocabulary) {
    const vector = [];
    const tokens = tokenize(text);
    const counts = new Map();
    for (const token of tokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
    }
    for (const term of vocabulary) {
        vector.push(counts.get(term) || 0);
    }
    return vector;
}

function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dot / (magnitudeA * magnitudeB);
}

function vectorSearch(query, docs, limit = 3) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    const vocabulary = Array.from(new Set(docs.flatMap((doc) => tokenize(`${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`))))
        .filter((term) => term.length > 2)
        .sort();

    const qVector = buildVector(query, vocabulary);
    const results = docs
        .map((doc) => {
            const docVector = buildVector(`${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`, vocabulary);
            const sim = cosineSimilarity(qVector, docVector);
            const lexical = scoreDocument(query, doc);
            const finalScore = Number((sim * 15 + lexical).toFixed(4));
            return { doc, score: finalScore };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return results;
}

export function retrieveKnowledge(query, docs = null, limit = 3) {
    const items = docs || loadKnowledgeBase();
    if (!query || !String(query).trim()) return [];

    const vectorHits = vectorSearch(query, items, limit);
    const scored = vectorHits.length
        ? vectorHits
        : items
              .map((doc) => ({ doc, score: scoreDocument(query, doc) }))
              .filter((entry) => entry.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, limit);

    return scored
        .map(({ doc, score }) => ({
            title: doc.title || 'Untitled',
            source: doc.source || 'local_knowledge_base',
            score,
            content: doc.content || '',
            tags: Array.isArray(doc.tags) ? doc.tags : [],
        }));
}

const KNOWLEDGE_KEYWORDS = [
    { term: 'قاعدة معرفة', weight: 5 },
    { term: 'قاعدة المعرفة', weight: 5 },
    { term: 'knowledge', weight: 5 },
    { term: 'kb', weight: 4 },
    { term: 'معلومة', weight: 3 },
    { term: 'معلومات', weight: 3 },
    { term: 'بحث', weight: 3 },
    { term: 'مستند', weight: 3 },
    { term: 'وثيقة', weight: 3 },
    { term: 'دليل', weight: 3 },
    { term: 'مراجع', weight: 3 },
    { term: 'source', weight: 4 },
    { term: 'grounding', weight: 4 },
    { term: 'evidence', weight: 4 },
    { term: 'retrieval', weight: 4 },
    { term: 'retrieve', weight: 3 },
    { term: 'معرفة', weight: 3 },
    { term: 'سجل المعرفة', weight: 4 },
];

function isKnowledgeRequest(text) {
    const s = String(text || '');
    return /(قاعدة معرفة|قاعدة المعرفة|knowledge|kb|بحث|معلومة|معلومات|مستند|وثيقة|دليل|مراجع|source|grounding|evidence|retrieval)/i.test(s);
}

export const KNOWLEDGE_TOOL = {
    name: 'knowledge',
    description: 'استرجاع المعلومات من قاعدة المعرفة المحلية مع مصدر واضح وتقييم ملائم.',
    searchHint: 'قاعدة معرفة، معرفة، بحث في المستندات، source grounding, retrieval, KB',
    keywords: KNOWLEDGE_KEYWORDS,
    threshold: 1,
    timeoutMs: 20000,

    matches(query) {
        if (!isKnowledgeRequest(query)) return null;
        const { score } = scoreKeywords(query, KNOWLEDGE_KEYWORDS, 'knowledge');
        return { score: Math.max(1, score) };
    },

    partial(query) {
        const text = String(query || '');
        if (/(قاعدة معرفة|knowledge|kb|معلومة|معلومات)/i.test(text) && !/(بحث|استرجع|ابحث|retrieve|source|grounding|evidence)/i.test(text)) {
            return { score: 4, question: 'أريد أن أبحث في قاعدة المعرفة. ما الذي ترغب في معرفته؟ حدد الموضوع أو السؤال.' };
        }
        return null;
    },

    async run(query, ctx = {}) {
        const items = loadKnowledgeBase();
        const hits = retrieveKnowledge(String(query || ''), items, 3);

        if (!hits.length) {
            return [
                '[Knowledge Base] لم أجد تطابقاً في قاعدة المعرفة الحالية. قد تحتاج إلى إضافة وثيقة جديدة أو توضيح السؤال.',
                'مبدأ السلامة: لا أجيب عن معلومة غير مضمونة بالمصدر.',
            ];
        }

        const lines = hits.map((hit) => {
            const snippet = hit.content.length > 220 ? `${hit.content.slice(0, 220).trim()}...` : hit.content;
            return `[${hit.source}] ${hit.title}\nScore: ${hit.score}\n${snippet}`;
        });

        return lines;
    },
};
