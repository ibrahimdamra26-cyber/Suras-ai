// Suras AI — Modern Glassmorphism UI Component
import React, { useState } from 'react';

export default function SurasComponent({ title = "Suras Neural Widget" }) {
  const [active, setActive] = useState(false);

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.05)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '20px',
      padding: '24px',
      color: '#fff',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.37)'
    }}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#a855f7' }}>{title}</h3>
      <p style={{ opacity: 0.7, fontSize: '0.875rem', marginTop: '8px' }}>تم إنشاؤه عبر أدوات سوراس الذاتية.</p>
      <button 
        onClick={() => setActive(!active)}
        style={{
          marginTop: '16px',
          background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
          border: 'none',
          padding: '10px 20px',
          borderRadius: '10px',
          color: '#fff',
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        {active ? '⚡ نشط ومفعّل' : 'تفعيل المكوّن'}
      </button>
    </div>
  );
}
