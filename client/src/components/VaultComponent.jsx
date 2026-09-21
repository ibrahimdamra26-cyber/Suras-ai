import React, { useState } from 'react';

export default function VaultComponent() {
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [mode, setMode] = useState('encrypt'); // encrypt أو decrypt
  const [loading, setLoading] = useState(false);


  const handleVaultAction = async (e) => {
    e.preventDefault();
    if (!file) return alert('يرجى اختيار أو سحب ملف أولاً!');
    if (!password) return alert('يرجى إدخال كلمة مرور الخزنة لحماية البيانات!');


    setLoading(true);
    const formData = new FormData();
    formData.append('file0', file);
    formData.append('vault_password', password);
    formData.append('auth_key', authKey);


    const endpoint = mode === 'encrypt' ? 'encrypt' : 'decrypt';


    try {
      const response = await fetch(`http://localhost:3001/api/vault/${endpoint}`, {
        method: 'POST',
        body: formData,
      });


      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('🚫 خطأ أمني: لا تملك الصلاحيات السيادية للوصول إلى الخزنة المصنفة.');
        }
        throw new Error('فشلت العملية. تأكد من صحة البيانات أو كلمة المرور.');
      }


      // قراءة اسم الملف المسترجع من الهيدر القادم من بايثون
      const disposition = response.headers.get('Content-Disposition');
      let filename = mode === 'encrypt' ? 'secured_file.suras' : 'restored_file';
      if (disposition && disposition.includes('filename=')) {
        filename = disposition.split('filename=')[1].replaceAll('"', '');
      }


      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();


      alert(`✅ تمت العملية بنجاح! تم تحميل: ${filename}`);
    } catch (error) {
      console.error(error);
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="glass-card" style={{ width: '100%', margin: '0 auto', padding: '24px 32px', direction: 'rtl' }}>
      <h2 style={{ color: 'var(--primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        🔒 خزنة التشفير العسكرية المتقدمة (AES-256)
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '24px' }}>
        تأمين وتعمية الوثائق والملفات المصنفة ببروتوكولات التشفير الكتلي لحمايتها من التسريب.
      </p>


      {/* أزرار التحويل بين التشفير وفك التشفير */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button 
          onClick={() => setMode('encrypt')} 
          style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: 'none', background: mode === 'encrypt' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: '#fff', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
        >
          🔐 تشفير وتعمية ملف
        </button>
        <button 
          onClick={() => setMode('decrypt')} 
          style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: 'none', background: mode === 'decrypt' ? 'var(--success)' : 'rgba(255,255,255,0.05)', color: '#fff', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' }}
        >
          🔓 فك تشفير مستند
        </button>
      </div>


      <form onSubmit={handleVaultAction} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* منطقة رفع الملف الحساس */}
        <div style={{ border: '2px dashed var(--border)', padding: '30px 20px', borderRadius: 'var(--radius-sm)', textAlign: 'center', background: 'rgba(0,0,0,0.1)', cursor: 'pointer' }} onClick={() => document.getElementById('vaultFileInput').click()}>
          <input 
            type="file" 
            id="vaultFileInput" 
            hidden 
            onChange={(e) => setFile(e.target.files[0])} 
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {file ? `📁 الملف المختار: ${file.name}` : 'اسحب الملف الحساس هنا أو اضغط للتصفح'}
          </span>
        </div>


        {/* حقول الإدخال والكلمات السرية */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>🗝️ كلمة مرور الخزنة (AES Key):</label>
            <input 
              type="password" 
              placeholder="اكتب كلمة مرور قوية للمشروع"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', color: '#fff' }}
            />
          </div>


          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: 'var(--warning)' }}>🔑 مفتاح الصلاحية السيادي للمالك:</label>
            <input 
              type="password" 
              placeholder="ادخل مفتاح التحقق الرئيسي للموقع"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', color: 'var(--warning)' }}
            />
          </div>
        </div>


        <button 
          type="submit" 
          className="btn-primary" 
          disabled={loading} 
          style={{ alignSelf: 'flex-start', marginTop: '10px', background: mode === 'encrypt' ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'linear-gradient(135deg, #059669, #34D399)' }}
        >
          {loading ? '⏳ جاري معالجة المصفوفات وتوليد بايتات الحماية...' : mode === 'encrypt' ? '🔒 بدء تشفير وحجب الملف' : '🔓 فك التشفير واسترجاع الوثيقة'}
        </button>
      </form>
    </div>
  );
}