import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Activity, Cpu, ShieldCheck, ListChecks, RefreshCw, Brain, Radio, Lock } from 'lucide-react';

const panelSocket = io('http://localhost:3001');
const API = 'http://localhost:3001';

const secTitle = {
  display: 'flex', alignItems: 'center', gap: '8px',
  fontSize: '0.85rem', fontWeight: '700', margin: '18px 0 10px', color: 'var(--text)',
};
const card = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
  borderRadius: '12px', padding: '12px 14px', fontSize: '0.8rem', lineHeight: '1.9',
};
const btn = {
  background: 'linear-gradient(135deg, var(--primary), var(--accent))',
  border: 'none', borderRadius: '10px', color: '#fff', padding: '8px 18px',
  fontWeight: '700', cursor: 'pointer', fontSize: '0.8rem',
  display: 'inline-flex', alignItems: 'center', gap: '6px',
};
const pill = ok => ({
  display: 'inline-block', padding: '1px 10px', borderRadius: '20px', fontSize: '0.7rem',
  fontWeight: '700', background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
  color: ok ? '#34d399' : '#f87171', border: `1px solid ${ok ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
});

export default function SystemPanel() {
  const [neural, setNeural] = useState(null);
  const [lastAgent, setLastAgent] = useState(null);
  const [health, setHealth] = useState([]);
  const [checking, setChecking] = useState(false);
  const [regression, setRegression] = useState(null);
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(false);
  // زر الفتح الكامل: المفتاح لا يُحفظ أبداً (حالة لحظية فقط)
  const [lock, setLock] = useState({ unlocked: false, expiresAt: null });
  const [lockKey, setLockKey] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState('');

  useEffect(() => {
    const onMedia = data => {
      if (data && data.type === 'neural-result') setNeural(data);
    };
    const onAgent = data => {
      if (!data) return;
      setLastAgent(data);
      if (data.agent === 'Health' && (data.role === 'Report' || data.role === 'Checking')) {
        const lines = String(data.text || '').split('\n').filter(Boolean);
        if (lines.length > 1 || data.role === 'Report') setHealth(lines);
        if (data.role === 'Report' || data.role === 'Error') setChecking(false);
      }
    };
    panelSocket.on('media-update', onMedia);
    panelSocket.on('agent-update', onAgent);
    fetchRegression();
    fetchTraces();
    fetchLockStatus();
    const lockTimer = setInterval(fetchLockStatus, 15000);
    return () => {
      clearInterval(lockTimer);
      panelSocket.off('media-update', onMedia);
      panelSocket.off('agent-update', onAgent);
    };
  }, []);

  const fetchLockStatus = async () => {
    try {
      const r = await fetch(`${API}/api/system/unlock/status`);
      const j = await r.json();
      if (j.success) setLock({ unlocked: !!j.unlocked, expiresAt: j.expiresAt || null });
    } catch (e) { /* صامت */ }
  };

  const doUnlock = async () => {
    if (!lockKey.trim()) { setLockMsg('أدخل مفتاح السيادة أولاً'); return; }
    setLockBusy(true); setLockMsg('');
    try {
      const r = await fetch(`${API}/api/system/unlock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_key: lockKey }),
      });
      const j = await r.json();
      if (j.success) {
        setLock({ unlocked: true, expiresAt: null });
        setLockKey('');
        setLockMsg('مفتوحة حتى القفل اليدوي أو إعادة التشغيل');
      } else {
        setLockMsg(j.error || 'مفتاح غير صحيح');
      }
    } catch (e) { setLockMsg(`تعذر الاتصال: ${e.message}`); }
    setLockBusy(false);
  };

  const doLock = async () => {
    setLockBusy(true);
    try {
      await fetch(`${API}/api/system/lock`, { method: 'POST' });
      setLock({ unlocked: false, expiresAt: null });
      setLockMsg('أُغلقت القدرات الكاملة');
    } catch (e) { setLockMsg(`تعذر الاتصال: ${e.message}`); }
    setLockBusy(false);
  };

  const fetchRegression = async () => {
    try {
      const r = await fetch(`${API}/api/system/regression`);
      const j = await r.json();
      if (j.success) setRegression(j);
    } catch (e) { /* صامت — اللوحة تعرض آخر حالة */ }
  };

  const fetchTraces = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/system/traces?limit=15`);
      const j = await r.json();
      if (j.success) setTraces(j.traces || []);
    } catch (e) { /* صامت */ }
    setLoading(false);
  };

  const runHealthCheck = async () => {
    setChecking(true);
    setHealth(['... جارٍ الفحص']);
    try {
      await fetch(`${API}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'analyze', data: { query: 'افحص صحة السيرفرات' } }),
      });
    } catch (e) {
      setHealth([`تعذر الاتصال بالسيرفر: ${e.message}`]);
      setChecking(false);
    }
  };

  const energy = (neural && neural.content && neural.content.energy) || null;
  const confidence = (neural && neural.metadata && typeof neural.metadata.confidence === 'number')
    ? Math.round(neural.metadata.confidence * 100) : null;

  return (
    <div style={{ padding: '16px 18px', direction: 'rtl' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Cpu size={18} color="var(--accent)" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: '800' }}>لوحة التحكم العصبية</h2>
        <span style={pill(true)}>متصلة</span>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: '230px', display: 'flex', flexDirection: 'column' }}>
      <div style={secTitle}><Brain size={15} color="var(--primary)" /> المؤشرات العصبية الحية</div>
      <div style={{ ...card, flex: 1 }}>
        {!neural && <div style={{ opacity: 0.6 }}>بانتظار أول نتيجة عصبية من المحرك...</div>}
        {neural && (
          <>
            <div>🧠 النموذج: <b dir="ltr">{(neural.content && neural.content.model) || neural.title || 'suras'}</b></div>
            {confidence !== null && <div>🎯 الثقة: <b>{confidence}%</b></div>}
            {energy && <div>⚡ الطاقة: <span dir="ltr">[{energy.join(' · ')}]</span></div>}
            {neural.content && neural.content.reasoning && (
              <div style={{ opacity: 0.75 }}>📝 {neural.content.reasoning.join(' ← ')}</div>
            )}
          </>
        )}
        {lastAgent && (
          <div style={{ marginTop: '8px', opacity: 0.75 }}>
            📡 آخر نشاط: <b>{lastAgent.agent}</b> — {String(lastAgent.text || lastAgent.status || '').slice(0, 120)}
          </div>
        )}
      </div>
      </div>
      <div style={{ flex: 1, minWidth: '230px', display: 'flex', flexDirection: 'column' }}>
      <div style={secTitle}><ShieldCheck size={15} color="#34d399" /> صحة المنظومة</div>
      <div style={{ ...card, flex: 1 }}>
        {health.length === 0 && <div style={{ opacity: 0.6 }}>لم يُجرَ فحص بعد.</div>}
        {health.map((l, i) => <div key={i}>{l}</div>)}
        <div style={{ marginTop: '10px' }}>
          <button style={btn} onClick={runHealthCheck} disabled={checking}>
            <Activity size={14} /> {checking ? 'جارٍ الفحص...' : 'افحص الآن'}
          </button>
        </div>
      </div>
      </div>
      <div style={{ flex: 1, minWidth: '230px', display: 'flex', flexDirection: 'column' }}>
      <div style={secTitle}><Lock size={15} color={lock.unlocked ? '#f87171' : '#34d399'} /> الفتح الكامل للقدرات</div>
      <div style={{ ...card, flex: 1, borderColor: lock.unlocked ? 'rgba(239,68,68,0.6)' : undefined, background: lock.unlocked ? 'rgba(239,68,68,0.08)' : undefined }}>
        <div style={{ marginBottom: '8px' }}>
          <span style={pill(!lock.unlocked)}>
            {lock.unlocked ? 'مفتوحة — حتى القفل اليدوي أو إعادة التشغيل' : 'مغلقة (الوضع الآمن)'}
          </span>
        </div>
        {!lock.unlocked ? (
          <>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="password"
                value={lockKey}
                onChange={e => setLockKey(e.target.value)}
                placeholder="مفتاح السيادة (لا يُحفظ)"
                style={{ flex: 1, minWidth: '140px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', padding: '7px 10px', fontSize: '0.8rem' }}
              />
            </div>
            <div style={{ marginTop: '8px' }}>
              <button style={{ ...btn, background: 'linear-gradient(135deg, #dc2626, #991b1b)' }} onClick={doUnlock} disabled={lockBusy}>
                <Lock size={14} /> {lockBusy ? '...' : 'فتح القدرات الكاملة'}
              </button>
            </div>
            <div style={{ opacity: 0.6, fontSize: '0.72rem', marginTop: '6px' }}>
              دائم حتى تقفله بنفسك. كل أمر موثّق في سجل التدقيق. الرفض الأخلاقي (سرقة/اختراق) ثابت لا يمس.
            </div>
          </>
        ) : (
          <div>
            <button style={{ ...btn, background: 'linear-gradient(135deg, #059669, #047857)' }} onClick={doLock} disabled={lockBusy}>
              <Lock size={14} /> قفل فوري
            </button>
          </div>
        )}
        {lockMsg && <div style={{ marginTop: '6px', fontSize: '0.75rem', opacity: 0.85 }}>{lockMsg}</div>}
      </div>
      </div>
      </div>

      <div style={secTitle}><ListChecks size={15} color="var(--accent)" /> بطارية الانحدار</div>
      <div style={card}>
        {!regression && <div style={{ opacity: 0.6 }}>جارٍ التحميل...</div>}
        {regression && (
          <>
            <div>
              <span style={pill(regression.failed === 0)}>
                {regression.passed}/{regression.total} ناجحة
              </span>
              <button onClick={fetchRegression} title="إعادة التشغيل"
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', marginRight: '8px' }}>
                <RefreshCw size={14} />
              </button>
            </div>
            <div style={{ marginTop: '8px', maxHeight: '220px', overflowY: 'auto' }}>
              {regression.results.map((r, i) => (
                <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={pill(r.pass)}>{r.pass ? '✓' : '✗'}</span>{' '}
                  <span style={{ opacity: 0.9 }}>{r.query}</span>
                  <span dir="ltr" style={{ opacity: 0.55, fontSize: '0.7rem' }}> → {r.got.tool || r.got.clarify || '—'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={secTitle}><Radio size={15} color="var(--primary)" /> الأثر التشخيصي (آخر الطلبات)</div>
      <div style={card}>
        <button onClick={fetchTraces} title="تحديث"
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', marginBottom: '6px' }}>
          <RefreshCw size={14} /> {loading ? '...' : 'تحديث'}
        </button>
        {traces.length === 0 && <div style={{ opacity: 0.6 }}>لا آثار بعد.</div>}
        {traces.map(t => (
          <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div>🔹 <span style={{ opacity: 0.9 }}>{t.query}</span></div>
            <div style={{ opacity: 0.6, fontSize: '0.72rem' }} dir="ltr">
              {t.id} · {t.ms !== null && t.ms !== undefined ? `${t.ms}ms` : '…'} · {t.result || '…'}
            </div>
            {(t.steps || []).map((s, i) => (
              <div key={i} style={{ opacity: 0.7, fontSize: '0.72rem' }}>↳ {s.name}{s.detail ? `: ${s.detail}` : ''}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
