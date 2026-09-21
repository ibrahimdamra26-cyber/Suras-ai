import React, { useState } from 'react';

function buildMapSrc(lat, lon, zoom = 3) {
  if (lat == null || lon == null) return null;
  const bbox = `${lon - 90},${lat - 45},${lon + 90},${lat + 45}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}&zoom=${zoom}`;
}

export default function OsintWidget() {
  const [targetIp, setTargetIp] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);


  const handleOsintScan = async (e) => {
    e.preventDefault();
    if (!targetIp) return alert('يرجى إدخال عنوان الـ IP المراد تتبعه استخباراتياً!');


    setLoading(true);
    setScanResult(null);


    const formData = new FormData();
    formData.append('target_ip', targetIp);
    formData.append('auth_key', authKey);


    try {
      const response = await fetch('http://localhost:3001/api/osint/scan', {
        method: 'POST',
        body: formData,
      });


      if (!response.ok) {
        throw new Error('فشلت عملية سحب البيانات من السيرفر.');
      }


      const data = await response.json();
      setScanResult(data);
    } catch (error) {
      console.error(error);
      alert('تعذر الاتصال بمحرك بايثون الخلفي، تأكد من تشغيل Uvicorn.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="glass-card" style={{ width: '100%', margin: '0 auto', padding: '24px 32px', direction: 'rtl' }}>
      <h2 style={{ color: 'var(--accent)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        🌐 محرك استخبارات المصادر المفتوحة (OSINT) والتعقب الجغرافي
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '24px' }}>
        سحب وتتبع البيانات الرقمية الحية للأجهزة والخوادم العالمية، وتحديد مواقع التهديدات السبرانية جغرافياً.
      </p>


      <form onSubmit={handleOsintScan} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '2', minWidth: '250px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>عنوان الـ IP المستهدف للتحري:</label>
            <input
              type="text"
              placeholder="مثال: 8.8.8.8 أو اكتب IP سيرفر خارجي"
              value={targetIp}
              onChange={(e) => setTargetIp(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', color: '#fff' }}
            />
          </div>


          <div style={{ flex: '1', minWidth: '180px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: 'var(--warning)' }}>🔑 مفتاح الصلاحية السيادي للمالك:</label>
            <input
              type="password"
              placeholder="اتركه فارغاً لاختبار كذب الروبوت"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', color: 'var(--warning)' }}
            />
          </div>
        </div>


        <button type="submit" className="btn-primary" disabled={loading} style={{ alignSelf: 'flex-start', marginTop: '8px' }}>
          {loading ? '⏳ جاري اختراق الهوية الرقمية للهدف وسحب سجلات الأرشفة...' : '🔍 إطلاق محرك التحري والتتبع'}
        </button>
      </form>


      {/* ── لوحة عرض النتائج المدمجة (بيانات + خرائط تفاعلية) ── */}
      {scanResult && scanResult.results && scanResult.results.length > 0 && (
        <div style={{ marginTop: '30px', padding: '20px', borderRadius: 'var(--radius-md)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <h3 style={{ color: scanResult.status === 'unlocked' ? 'var(--success)' : 'var(--warning)', margin: 0 }}>
              {scanResult.message}
            </h3>
            <span style={{ fontSize: '0.8rem', padding: '4px 12px', borderRadius: '50px', background: 'rgba(255,255,255,0.05)', fontWeight: 'bold' }}>
              الوضع الحركي العقلاني: {scanResult.mode}
            </span>
          </div>


          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', flexWrap: 'wrap' }}>

            {/* القسم الأيمن: شبكة البيانات الاستخباراتية والمنافذ والثغرات */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {scanResult.results.map((host, idx) => {
                const mapSrc = buildMapSrc(host.latitude, host.longitude);
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                      <div style={{ marginBottom: '6px' }}>📍 الدولة المستضيفة: <span style={{ color: 'var(--accent)' }}>{host.country}</span></div>
                      <div style={{ marginBottom: '6px' }}>🏢 مزود الإنترنت (ISP): <span>{host.isp}</span></div>
                      <div style={{ marginBottom: '6px' }}>🎯 الـ IP الفعلي للهدف: <code>{host.ip}</code></div>
                      {host.latitude != null && host.longitude != null && (
                        <div style={{ marginBottom: '6px' }}>🧭 الإحداثيات: <code style={{ color: 'var(--accent)' }}>{host.latitude.toFixed(4)}, {host.longitude.toFixed(4)}</code></div>
                      )}
                    </div>


                    {/* صندوق المنافذ الرقمية المفتوحة */}
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <h4 style={{ color: '#fff', marginBottom: '8px', fontSize: '0.9rem' }}>🔓 المنافذ المفتوحة المكتشفة علناً:</h4>
                      {host.ports && host.ports.length > 0 ? (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {host.ports.map((port, pIdx) => (
                            <span key={pIdx} style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(6,182,212,0.15)', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 'bold' }}>
                              Port {port}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>لا توجد منافذ عامة مكشوفة بشكل خطر.</span>
                      )}
                    </div>


                    {/* صندوق السجل التكتيكي للثغرات CVEs */}
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <h4 style={{ color: 'var(--danger)', marginBottom: '8px', fontSize: '0.9rem' }}>⚠️ سجل الثغرات الموثقة (CVEs):</h4>
                      {host.vulnerabilities && host.vulnerabilities.length > 0 ? (
                        <ul style={{ paddingRight: '16px', margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', maxHeight: '150px', overflowY: 'auto' }}>
                          {host.vulnerabilities.map((vuln, vIdx) => (
                            <li key={vIdx} style={{ marginBottom: '4px', color: '#ff7878' }}>❌ {vuln}</li>
                          ))}
                        </ul>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>🛡️ الأنظمة آمنة من الثغرات المؤرشفة علناً في هذا الطلب.</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>


            {/* القسم الأيسر: لوحة عرض الخرائط التفاعلية السيادية */}
            <div style={{ minHeight: '300px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
              {scanResult.status === 'unlocked' && scanResult.results[0] ? (
                (() => {
                  const host = scanResult.results[0];
                  const mapSrc = buildMapSrc(host.latitude, host.longitude, 4);
                  return mapSrc ? (
                    <div style={{ width: '100%', height: '100%', minHeight: '300px' }}>
                      <iframe
                        title="OSINT Map"
                        src={mapSrc}
                        style={{ width: '100%', height: '100%', minHeight: '300px', border: 0 }}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: 'var(--text-muted)' }}>
                      لا توجد إحداثيات جغرافية لهذا الهدف.
                    </div>
                  );
                })()
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  🛡️ <span style={{ marginRight: '8px' }}>خريطة محاكاة وهمية — شبكة الحماية العالمية في وضع آمن (مراوغة سيادية مفعّلة).</span>
                </div>
              )}
            </div>


          </div>


          {/* نصيحة ومراوغة الروبوت التكتيكية */}
          {scanResult.ai_advice && (
            <div style={{ marginTop: '20px', fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(255,255,255,0.01)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid var(--warning)' }}>
              💡 <strong>توجيه مستشار SURAS الدبلوماسي:</strong> {scanResult.ai_advice}
            </div>
          )}


        </div>
      )}
    </div>
  );
}