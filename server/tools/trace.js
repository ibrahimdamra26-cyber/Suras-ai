// ============================================================
// Suras Trace — الأثر التشخيصي لكل طلب
// ------------------------------------------------------------
// فكرة مقتبسة: كل قرار موثّق + عدّاد فشل + قراءة الذيل.
// حلقة دائرية (آخر 100 أثر) تُعرض عبر GET /api/system/traces.
// ============================================================

const MAX_TRACES = 100;
const _ring = [];

function now() {
    return new Date().toISOString();
}

/** بدء أثر جديد لاستعلام. @returns {string} المعرّف */
export function startTrace(query) {
    const id = `tr_${Date.now().toString(36)}_${Math.floor(Math.random() * 1296).toString(36)}`;
    const entry = {
        id,
        at: now(),
        query: String(query || '').slice(0, 200),
        steps: [],
        done: false,
        ms: null,
        _t0: Date.now(),
    };
    _ring.push(entry);
    if (_ring.length > MAX_TRACES) _ring.shift();
    return id;
}

/** خطوة داخل الأثر. */
export function traceStep(id, name, detail = '') {
    const e = _ring.find(t => t.id === id);
    if (!e) return;
    e.steps.push({ at: now(), name, detail: String(detail).slice(0, 500) });
    console.log(`[Trace:${id}] ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`);
}

/** إنهاء الأثر بنتيجة. */
export function endTrace(id, result = 'ok') {
    const e = _ring.find(t => t.id === id);
    if (!e) return;
    e.done = true;
    e.result = String(result).slice(0, 200);
    e.ms = Date.now() - e._t0;
    delete e._t0;
    console.log(`[Trace:${id}] done (${e.ms}ms): ${e.result}`);
}

/** آخر الآثار (الأحدث أولاً)، بلا حقول داخلية. */
export function listTraces(limit = 20) {
    return _ring.slice(-Math.max(1, Math.min(limit, MAX_TRACES))).reverse().map(e => {
        const { _t0, ...pub } = e;
        return pub;
    });
}
