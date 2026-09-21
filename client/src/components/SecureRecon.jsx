import React, { useState } from 'react';

export default function SecureRecon() {
  const [targetIp, setTargetIp] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);


  const handleReconSubmit = async (e) => {
    e.preventDefault();
    if (!targetIp) return alert('يرجى إدخال عنوان الـ IP المستهدف أولاً!');


    setLoading(true);
    setScanResult(null);


    // تجهيز البيانات كـ JSON متوافق مع المسار الخلفي
    const postBody = JSON.stringify({ target_ip: targetIp, auth_key: authKey });


    try {
      const response = await fetch('http://localhost:3001/api/secure-recon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: postBody,
      });


      if (!response.ok) {
        throw new Error('فشلت عملية الاستطلاع على السيرفر الخارجي.');
      }


      const data = await response.json();
      setScanResult(data);
    } catch (error) {
      console.error(error);
      alert('تعذر الاتصال بالباك إيند، تأكد من تشغيل سيرفر بايثون المطور.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="glass-card" style={{ width: '100%', margin: '0 auto', padding: '24px 32px', direction: 'rtl' }}>
      <h2 style={{ color: 'var(--accent)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        🕵️‍♂️ محرك الاستطلاع الرقمي وفحص الأنظمة المتقدم
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '24px' }}>
        قم بإدخال الهدف لفحصه سبرانياً. النظام محمي ذاتياً ببروتوكول المراوغة السيادية ثلاثي الأبعاد.
      </p>


      <form onSubmit={handleReconSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'nowrap', alignItems: 'flex-end', width: '100%' }}>
          {/* حقل إدخال الـ IP المستهدف */}
          <div style={{ flex: '2', minWidth: '0' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>عنوان الـ IP أو النطاق المستهدف:</label>
            <input
              type="text"
              placeholder="مثال: 192.168.1.1 أو google.com"
              value={targetIp}
              onChange={(e) => setTargetIp(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', color: '#fff' }}
            />
          </div>


          {/* حقل المفتاح السيادي السري (صلاحيات المالك) */}
          <div style={{ flex: '1.5', minWidth: '0' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: 'var(--warning)', whiteSpace: 'nowrap' }}>🔑 مفتاح الصلاحية السيادي:</label>
            <input
              type="password"
              placeholder="اتركه فارغاً لاختبار المراوغة"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', color: 'var(--warning)' }}
            />
          </div>


          {/* زر الفحص */}
          <div style={{ flex: '1', minWidth: '0' }}>
            <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: '12px', height: '42px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap', minWidth: 'fit-content' }}>
              {loading ? '⏳ جاري הפحص...' : '🚀 إطلاق محرك الفحص'}
            </button>
          </div>
        </div>
      </form>


      {/* ── لوحة عرض النتائج والمراوغة الذكية ── */}
      {scanResult && (
        <div style={{ marginTop: '30px', padding: '20px', borderRadius: 'var(--radius-md)', background: scanResult.status === 'unlocked' ? 'rgba(16,185,129,0.05)' : 'rgba(245,158,11,0.05)', border: `1px solid ${scanResult.status === 'unlocked' ? 'var(--success)' : 'var(--warning)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ color: scanResult.status === 'unlocked' ? 'var(--success)' : 'var(--warning)', margin: 0 }}>
              {scanResult.message}
            </h4>
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '50px', background: 'rgba(255,255,255,0.05)', fontWeight: 'bold' }}>
              الوضع الحركي: {scanResult.mode}
            </span>
          </div>


          {/* استعراض معلومات المنافذ والأجهزة القادمة من السيرفر */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            {scanResult.results.map((host, index) => (
              <div key={index} style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#fff' }}>🎯 الهدف: {host.ip} ({host.status})</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {host.protocols.length > 0 ? (
                    <ul style={{ paddingRight: '20px', margin: 0 }}>
                      {host.protocols.map((p, pIdx) => (
                        <li key={pIdx} style={{ marginBottom: '4px' }}>
                          المنفذ <strong style={{ color: 'var(--accent)' }}>{p.port}</strong> ({p.name}) ── حالته: <span style={{ color: p.state === 'open' || p.state === 'monitored_and_safe' ? 'var(--success)' : 'var(--danger)' }}>{p.state}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div>لم يتم العثور على منافذ مفتوحة قياسية في هذا النطاق المحدود.</div>
                  )}
                </div>
              </div>
            ))}
          </div>


          {/* تلميح وعقل الـ AI المراوغ في حال الدخول غير المصرح به */}
          {scanResult.ai_advice && (
            <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '8px' }}>
              💡 <strong>توجيه مستشار SURAS الدبلوماسي:</strong> {scanResult.ai_advice}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
