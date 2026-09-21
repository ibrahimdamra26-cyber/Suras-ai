// ============================================================
// Organizer Tool — منظم المشاريع المبنية (built_projects/)
// ------------------------------------------------------------
// الفصل الصريح عن أداة projects (مشاريع الجهاز المخزنة):
//  • organizer (هذه): مشاريع Suras المبنية في built_projects/
//    (المبنية/المنشأة/built) — بلا مسح للجهاز، بلا إذن خاص.
//  • projects: مسح الجهاز (سطح المكتب/المستندات/E) — ببوابة إذن.
// العمليات: سرد (افتراضي) + إعادة تسمية + أرشفة القديم.
// حديد الأمان: كل طفرة مقيدة داخل built_projects (فحص بادئة
// المسار المحلول) — ولا حذف أبداً (الأرشفة نقل لـ_archive/).
// ============================================================

import fs from 'fs';
import path from 'path';
import { scoreKeywords } from './classifier.js';

const BUILT_DIRNAME = 'built_projects';
const ARCHIVE_DIRNAME = '_archive';

const BUILT_WORDS = /(المبنية|المبنيه|المنشأة|المنشاة|المنشأه|built_projects|built)/i;
const ORGANIZE_WORDS = /(نظم|نظّم|رتب|أرشف|ارشفة|أرشفة|organize|archive)/i;

function builtDir(rootDir) {
    return path.join(rootDir || path.join(process.cwd()), BUILT_DIRNAME);
}

/** حلّ اسم/مسار داخل built_projects مع رفض أي خروج عنها. */
function resolveInside(rootDir, name) {
    const base = path.resolve(builtDir(rootDir));
    const full = path.resolve(base, String(name || '').trim());
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    if (path.basename(full) !== String(name || '').trim()) return null;
    if (/^\.|[\/\\]/.test(String(name || '').trim())) return null;
    return full;
}

function dirInfo(dp) {
    try {
        const st = fs.statSync(dp);
        let size = 0, count = 0;
        try {
            const walk = (d) => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const fp = path.join(d, e.name);
                    if (e.isDirectory()) walk(fp);
                    else { count++; try { size += fs.statSync(fp).size; } catch (_) {} }
                }
            };
            walk(dp);
        } catch (_) {}
        return { mtime: st.mtimeMs, size, count };
    } catch (_) { return null; }
}

export const ORGANIZER_TOOL = {
    name: 'organizer',
    description: 'تنظيم المشاريع المبنية: سرد/إعادة تسمية/أرشفة داخل built_projects فقط',
    searchHint: 'مشاريعي المبنية، نظم المشاريع، أرشفة القديم',
    keywords: [
        { term: 'المبنية', weight: 3 }, { term: 'المبنيه', weight: 3 },
        { term: 'المنشأة', weight: 3 }, { term: 'نظم', weight: 2 },
        { term: 'رتب', weight: 2 }, { term: 'أرشف', weight: 2 },
        { term: 'أرشفة', weight: 2 }, { term: 'ارشفة', weight: 2 },
        { term: 'built', weight: 2 }, { term: 'مشاريعي', weight: 1 },
    ],
    threshold: 5,
    timeoutMs: 30000,

    matches(query) {
        const text = String(query || '');
        // فعل إعادة تسمية صريح → تطابق مباشر (وrun() يفرض الاحتواء داخل built_projects)
        if (/(أعد تسمية|اعادة تسمية|إعادة تسمية|rename)/i.test(text)) {
            return { score: 9 };
        }
        const hasBuilt = BUILT_WORDS.test(text);
        if (!hasBuilt) {
            // بلا سياق مبني: لا نخطف طلبات المشاريع المخزنة أو غيرها
            if (!ORGANIZE_WORDS.test(text)) return null;
            if (!/(مشروع|مشاريع|project)/i.test(text)) return null;
        }
        const { score } = scoreKeywords(text, ORGANIZER_TOOL.keywords, 'organizer');
        const finalScore = hasBuilt ? Math.max(8, score) : score;
        if (finalScore < 5) return null;
        return { score: finalScore };
    },

    async run(query, ctx) {
        const { io, rootDir } = ctx;
        const obs = [];
        const q = String(query || '');
        const base = builtDir(rootDir);
        try { fs.mkdirSync(base, { recursive: true }); } catch (_) {}
        const emit = (role, text, theme) => { try { io.emit('agent-update', { agent: 'Organizer', role, text, theme }); } catch (_) {} };

        // —— إعادة تسمية: "أعد تسمية X إلى Y" / "سم X بـ Y" ——
        const renM = /(?:أعد تسمية|اعادة تسمية|إعادة تسمية|سم|سمّ|rename)\s+["']?([^"'\n]+?)["']?\s+(?:إلى|الى|بـ|ب|=>|->|to)\s+["']?([^"'\n]+?)["']?\s*$/i.exec(q);
        if (renM) {
            const from = renM[1].trim(), to = renM[2].trim().replace(/[\\/]/g, '').replace(/^\.+/, '');
            const src = resolveInside(rootDir, from);
            const dst = resolveInside(rootDir, to);
            if (!src || !dst || !fs.existsSync(src)) {
                obs.push(`[تعذرت إعادة التسمية]: تحقق من الاسم داخل built_projects (المصدر: ${from}).`);
                return obs;
            }
            if (fs.existsSync(dst)) {
                obs.push(`[تعذرت إعادة التسمية]: الاسم "${to}" موجود مسبقاً — اختر اسماً آخر.`);
                return obs;
            }
            try {
                fs.renameSync(src, dst);
                try { io.emit('files-changed'); } catch (_) {}
                obs.push(`[تمت إعادة التسمية داخل built_projects]: ${from} ← ${to}`);
                emit('Done', `✅ أصبح: ${to}`, 'green');
            } catch (e) { obs.push(`[خطأ إعادة التسمية]: ${e.message}`); }
            return obs;
        }

        // —— أرشفة القديم (افتراضي >30 يوماً) إلى _archive/ ——
        if (/(أرشف|أرشفة|ارشفة|archive)/i.test(q)) {
            const dayM = /(\d+)\s*(يوم|أيام|days?)/i.exec(q);
            const days = dayM ? Math.max(1, parseInt(dayM[1], 10)) : 30;
            const arch = path.join(base, ARCHIVE_DIRNAME);
            try { fs.mkdirSync(arch, { recursive: true }); } catch (_) {}
            const cutoff = Date.now() - days * 86400000;
            let moved = [];
            try {
                for (const e of fs.readdirSync(base, { withFileTypes: true })) {
                    if (!e.isDirectory() || e.name === ARCHIVE_DIRNAME) continue;
                    const fp = path.join(base, e.name);
                    const info = dirInfo(fp);
                    if (info && info.mtime < cutoff) {
                        const dst = path.join(arch, e.name);
                        if (!fs.existsSync(dst)) { fs.renameSync(fp, dst); moved.push(e.name); }
                    }
                }
            } catch (e) { obs.push(`[خطأ الأرشفة]: ${e.message}`); return obs; }
            try { io.emit('files-changed'); } catch (_) {}
            obs.push(moved.length
                ? `[أرشفة built_projects (أقدم من ${days} يوماً) → _archive/]:\n${moved.join('\n')}`
                : `[أرشفة built_projects]: لا مجلدات أقدم من ${days} يوماً — كل شيء حديث.`);
            emit('Done', `🗂️ أرشفت ${moved.length}`, 'green');
            return obs;
        }

        // —— الافتراضي: سرد منظم ——
        let entries = [];
        try {
            entries = fs.readdirSync(base, { withFileTypes: true })
                .filter(e => e.isDirectory() && e.name !== ARCHIVE_DIRNAME)
                .map(e => ({ name: e.name, info: dirInfo(path.join(base, e.name)) }))
                .sort((a, b) => (b.info ? b.info.mtime : 0) - (a.info ? a.info.mtime : 0));
        } catch (e) { obs.push(`[تعذر سرد built_projects]: ${e.message}`); return obs; }
        if (!entries.length) {
            obs.push('[مشاريعي المبنية (built_projects/)]: فارغ بعد — أول بناء سيُسكن هنا تلقائياً في مجلده المسمى.');
            return obs;
        }
        const lines = entries.map((e, i) => {
            const kb = e.info ? Math.max(1, Math.round(e.info.size / 1024)) : '?';
            const dt = e.info ? new Date(e.info.mtime).toLocaleDateString('ar-JO') : '?';
            return `${i + 1}. ${e.name} — ${kb}KB في ${e.info ? e.info.count : '?'} ملف — ${dt}`;
        });
        obs.push(`[مشاريعي المبنية (${entries.length}) — built_projects/]:\n${lines.join('\n')}\n— لإعادة تسمية: "أعد تسمية <القديم> إلى <الجديد>". للأرشفة: "أرشف القديم".`);
        emit('Listed', `🗂️ ${entries.length} مشاريع مبنية`, 'green');
        return obs;
    },
};
