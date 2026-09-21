// ============================================================
// Projects Tool — فتح المشاريع من الأمور المخزنة
// رابع أداة مسجلة في Suras Tool Registry.
// "افتح مشروع X" / "اعرض المشاريع المخزنة" / "مشاريعي"
//  • يسرد المشاريع المكتشفة على القرص (علامات: package.json/.git/index.html...)
//  • عند تسمية مشروع موجود: يعرض هيكله ويفتح index.html في المعاينة إن وُجد
// ============================================================

import os from 'os';
import { scoreKeywords } from './classifier.js';

const MARKERS = ['package.json', '.git', 'index.html', 'requirements.txt', 'Cargo.toml', 'pom.xml'];

function projectType(names) {
    if (names.includes('package.json')) return 'node';
    if (names.includes('requirements.txt')) return 'python';
    if (names.includes('.git')) return 'git';
    return 'generic';
}

async function scanDir(fs, dir, depth, found) {
    if (depth > 2 || found.length >= 30) return;
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (_) {
        return;
    }
    const names = entries.map(e => e.name);
    if (MARKERS.some(m => names.includes(m))) {
        found.push({ name: dir.split(/[\\/]/).pop(), path: dir, type: projectType(names) });
        return;
    }
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (['node_modules', '.git', 'dist', 'Windows', 'Program Files', '$Recycle.Bin'].includes(e.name)) continue;
        await scanDir(fs, dir + '\\' + e.name, depth + 1, found);
    }
}

export async function findStoredProjects(fs, path, os2) {
    const home = (process.env.USERPROFILE || (os2 && os2.homedir()) || 'C:\\Users');
    const roots = [
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        'E:\\',
    ];
    const found = [];
    for (const r of roots) {
        await scanDir(fs, r, 0, found);
        if (found.length >= 30) break;
    }
    return found;
}

const OPEN_RE = /(افتح|اعرض|ابحث|شوف|شاهد|افتح لي|اعرض لي|اريد|أريد|ابغى|أبغي|بدي|عايز|عاوز|احتاج|أحتاج|أرني|ورني|وريني|ورجيني|فرجيني|open|show|list|want|need)/i;
const NOUN_RE = /(مشروع|مشاريع|مشاريعي|projects?|المخزنة|المخزن)/i;

const PROJECTS_KEYWORDS = [
    { term: 'مشروع', weight: 3 }, { term: 'مشاريع', weight: 3 },
    { term: 'مشاريعي', weight: 3 }, { term: 'المخزنة', weight: 2 },
    { term: 'افتح', weight: 2 }, { term: 'اعرض', weight: 1 },
    { term: 'اريد', weight: 1 }, { term: 'أريد', weight: 1 },
    { term: 'ابغى', weight: 1 }, { term: 'بدي', weight: 1 }, { term: 'احتاج', weight: 1 },
    { term: 'project', weight: 2 }, { term: 'open', weight: 1 },
];

export function isProjectsRequest(text) {
    const t = String(text || '');
    // المشاريع المبنية (built_projects) من اختصاص أداة organizer — لا نخطفها
    if (/(المبنية|المبنيه|المنشأة|المنشاة|المنشأه|built_projects|built)/i.test(t)) return false;
    return OPEN_RE.test(t) && NOUN_RE.test(t);
}

export const PROJECTS_TOOL = {
    name: 'projects',
    description: 'سرد المشاريع المخزنة على القرص وفتح أحدها في المعاينة',
    searchHint: 'افتح مشروع، اعرض المشاريع المخزنة، مشاريعي، open project',
    keywords: PROJECTS_KEYWORDS,
    threshold: 1,
    timeoutMs: 60000,

    matches(query) {
        // بوابة صلبة أولاً — ثم الدرجة من المصنّف (تتأثر بالتعلّم)
        if (!isProjectsRequest(query)) return null;
        const { score } = scoreKeywords(query, PROJECTS_KEYWORDS, 'projects');
        return { score: Math.max(1, score) };
    },

    partial(query) {
        const text = String(query || '');
        if (NOUN_RE.test(text) && !OPEN_RE.test(text)) {
            return { score: 4, question: '📁 تريد استعراض المشاريع المخزنة أم فتح مشروع بعينه؟ اذكر اسمه (مثال: افتح مشروع المتجر).' };
        }
        return null;
    },

    async run(query, ctx) {
        const { io, fs, path } = ctx;
        const obs = [];
        const queryText = String(query || '');
        // 🔐 بوابة الإذن (مُعلَّمة): مسح الجهاز — سطح المكتب/المستندات/القرص E —
        // خارج مساحة العمل، فلا يتم إلا بإذن صريح من المالك يُعاد مع الطلب.
        const CONFIRM_RE = /(أؤكد|اكد|أكد|موافق|موافقة|نعم|ايوه|تمام نفذ|نفذ|نفذي|ok|okay|yes|confirm|affirmative)/i;
        // المفتوح = إذن دائم أثناء الفتح (يُسجَّل في agent-update) — وإلا يلزم "أؤكد"
        if (!CONFIRM_RE.test(queryText) && !(ctx && ctx.unlocked)) {
            obs.push(`[مطلوب إذن قبل البحث في الجهاز]: طلبك يستلزم مسح سطح المكتب والمستندات والقرص E بحثاً عن المشاريع — وهذا خارج مساحة العمل. أعد طلبك مع كلمة "أؤكد" (مثال: أؤكد اعرض المشاريع) وسأبحث فوراً.\n💡 قاعدة الإسكان المثبتة: مشاريعك الجديدة التي أبنيها أسكنها دائماً في E:\\Suras\\built_projects\\<اسم-المشروع>_<وقت>/ — كل مشروع في مجلده الخاص المسمى، ولا شيء يُرمى في الجذر.`);
            try { io.emit('agent-update', { agent: 'Projects', role: 'Need Permission', text: `🔐 أحتاج إذنك قبل البحث في جهازك — أعد الطلب مع "أؤكد"`, theme: 'orange' }); } catch (_) {}
            return obs;
        }
        io.emit('agent-update', { agent: 'Projects', role: 'Scanning', text: '📁 أبحث في الأمور المخزنة عن المشاريع...', theme: 'blue' });
        const found = await findStoredProjects(fs, path, os);
        if (found.length === 0) {
            obs.push('[المشاريع المخزنة]: لم أعثر على مشاريع (سطح المكتب/المستندات/E).');
            return obs;
        }
        const list = found.map((p, i) => `${i + 1}. ${p.name} (${p.type}) — ${p.path}`).join('\n');
        // هل سمّى المستخدم مشروعاً بعينه؟
        const q = String(query || '');
        const named = found.find(p => q.includes(p.name) && p.name.length > 2);
        if (named) {
            if (Array.isArray(ctx.entities)) {
                for (const t of String(named.name).split(/\s+/)) {
                    if (t) ctx.entities.push(t);
                }
            }
            let top = [];
            try {
                const entries = await fs.readdir(named.path, { withFileTypes: true });
                top = entries.slice(0, 15).map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
            } catch (e) {
                top = [`تعذر قراءة المجلد: ${e.message}`];
            }
            obs.push(`[فتح المشروع "${named.name}"] (${named.type}):\n${named.path}\n${top.join('\n')}\n📂 يُفتح في مكانه دون نقل — وكل بناء جديد أبنيه يسكن built_projects/<slug>_<وقت>/ داخل مساحة العمل.`);
            io.emit('agent-update', { agent: 'Projects', role: 'Opened', text: `📂 فتحت المشروع: ${named.name}`, theme: 'green' });
            // إن وُجد index.html افتحه فعلاً في شاشة المعاينة المركزية
            try {
                const idxPath = path.join(named.path, 'index.html');
                await fs.access(idxPath);
                const url = `http://localhost:3001/preview-file?path=${encodeURIComponent(idxPath)}`;
                io.emit('media-update', { type: 'browser-preview', url, title: `📂 ${named.name}` });
                obs.push(`[معاينة حية]: ${url}`);
            } catch (_) { /* بلا index — الهيكل يكفي */ }
        } else {
            obs.push(`[المشاريع المخزنة (${found.length})]:\n${list}\n— لفتح أحدها اذكر اسمه (مثال: افتح مشروع ${found[0].name}).\n🗂️ قاعدة الإسكان: مشاريعي الجديدة تُبنى في built_projects/<slug>_<وقت>/ — كل مشروع في مجلده الخاص، ولا شيء في الجذر.`);
            io.emit('agent-update', { agent: 'Projects', role: 'Listed', text: `📁 وجدت ${found.length} مشاريع مخزنة`, theme: 'green' });
        }
        io.emit('files-changed');
        return obs;
    },
};
