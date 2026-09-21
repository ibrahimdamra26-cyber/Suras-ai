import React, { useState, useEffect, useRef } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { io } from 'socket.io-client';

import {
  Folder, FolderOpen, FileText, Send, Camera,
  Paperclip, ChevronRight, MoreHorizontal,
  Circle, Terminal, LayoutGrid, Activity, X,
  FileCode, Database, Cpu, Search, GitBranch,
  Play, Box, Settings, Menu, Bell, Brain,
  Globe, RefreshCw, ExternalLink, Smartphone, Monitor, Lock, Mic
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SecureRecon from './components/SecureRecon';
import VaultComponent from './components/VaultComponent';
import OsintWidget from './components/OsintWidget';
import SystemPanel from './components/SystemPanel';

const socket = io('http://localhost:3001');

const Logo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="45" stroke="var(--primary)" strokeWidth="2" opacity="0.2" />
    <circle cx="50" cy="50" r="35" stroke="var(--accent)" strokeWidth="3" opacity="0.5" className="pulse-slow" />
    <circle cx="50" cy="50" r="25" stroke="var(--secondary)" strokeWidth="4" />
    <circle cx="50" cy="50" r="8" fill="var(--text)" className="pulse" />
  </svg>
);

const ActivityIcon = ({ icon: Icon, active, onClick }) => (
  <div
    onClick={onClick}
    style={{
      padding: '12px',
      cursor: 'pointer',
      color: active ? 'var(--text)' : 'var(--text-muted)',
      borderLeft: active ? '2px solid var(--primary)' : '2px solid transparent',
      background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
      transition: '0.2s'
    }}
  >
    <Icon size={24} strokeWidth={active ? 2.5 : 2} />
  </div>
);

const TopMenuItem = ({ label, active, onClick, onClose, items = [] }) => (
  <div style={{ position: 'relative' }}>
    <span
      onClick={onClick}
      style={{
        fontSize: '0.75rem',
        padding: '4px 8px',
        borderRadius: '4px',
        cursor: 'pointer',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        background: active ? 'rgba(255,255,255,0.1)' : 'transparent'
      }}
      className="hover-item"
    >
      {label}
    </span>
    {active && items.length > 0 && (
      <div className="glass" style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        minWidth: '160px',
        background: 'rgba(20,20,20,0.95)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '8px 0',
        zIndex: 1000,
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
      }}>
        {items.map((item, i) => (
          <div key={i} onClick={() => { item.onClick && item.onClick(); onClose && onClose(); }} style={{
            padding: '8px 16px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between'
          }} className="hover-item">
            <span>{item.label}</span>
            <span style={{ opacity: 0.4 }}>{item.shortcut}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

function App() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('suras_messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { console.error("History load error", e); }
    return [
      { id: Date.now(), type: 'agent', name: 'Agent Alya', role: 'Orchestrator', time: 'SYSTEM', text: 'Intelligence cluster online. Waiting for instructions.', theme: 'blue' }
    ];
  });
  const [files, setFiles] = useState([]);
  const [mediaContent, setMediaContent] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  // Explanation doc tabs (detailed agent answers shown in the central area)
  const [explainTabs, setExplainTabs] = useState([]);
  const [activeExplainId, setActiveExplainId] = useState(null);
  const [showExplain, setShowExplain] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const activeFile = openFiles.find(f => f.path === activeFilePath);
  const activeExplainTab = explainTabs.find(t => t.id === activeExplainId) || null;
  const [activeTab, setActiveTab] = useState('explorer');
  const [activeMenu, setActiveMenu] = useState(null);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState(() => {
    try {
      return localStorage.getItem('suras_terminal') || 'Suras Terminal v1.0.0\nReady for input...\n';
    } catch (e) { return 'Suras Terminal v1.0.0\nReady for input...\n'; }
  });
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [lockInfo, setLockInfo] = useState({ unlocked: false, expiresAt: null });
  const [searchResults, setSearchResults] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [projects, setProjects] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const [customCmd, setCustomCmd] = useState('');
  const [identity, setIdentity] = useState(null);
  const [identityOnline, setIdentityOnline] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [engine, setEngine] = useState(null);
  const chatEndRef = useRef(null);

  const [previewMode, setPreviewMode] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('http://localhost:5173');
  const [previewDevice, setPreviewDevice] = useState('desktop'); // desktop, tablet, mobile
  const [previewKey, setPreviewKey] = useState(0);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const recognitionRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const cameraVideoRef = useRef(null);

  // عرض صفحة واحدة كاملة في الوسط: لوحة كاملة عند غياب المحتوى، ومحتوى كامل عند وجوده
  const isPanelTab = ['recon', 'vault', 'osint', 'system'].includes(activeTab);
  const hasContentView = previewMode || (showExplain && !!activeExplainTab) || !!activeFile;
  const panelFull = !hasContentView && isPanelTab;
  const contentFull = hasContentView;
  const [showCamera, setShowCamera] = useState(false);
  const cameraStreamRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'ar-SA';
      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        }
        if (finalTranscript) setInput(prev => prev + (prev ? ' ' : '') + finalTranscript);
      };
      recognitionRef.current.onstart = () => setIsRecording(true);
      recognitionRef.current.onend = () => setIsRecording(false);
      recognitionRef.current.onerror = () => setIsRecording(false);
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('المتصفح لا يدعم التعرف على الصوت. جرب Chrome أو Edge.');
      return;
    }
    if (isRecording) recognitionRef.current?.stop();
    else {
      try { recognitionRef.current?.start(); }
      catch(err) { console.error(err); }
    }
  };

  const handleChatFileUpload = (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const isImage = file.type.startsWith('image/');
        setPendingFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: file.name,
          isImage,
          data: reader.result,
          textContent: isImage ? null : String(reader.result).slice(0, 3000),
        }]);
      };
      if (file.type.startsWith('image/')) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleOpenCamera = async () => {
    setShowPlusMenu(false);
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
    } catch (err) {
      alert('تعذّر الوصول إلى الكاميرا: ' + err.message);
      setShowCamera(false);
    }
  };

  const handleCapturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg');
    setPendingFiles(prev => [...prev, {
      id: Date.now(),
      name: 'صورة_ملتقطة.jpg',
      isImage: true,
      data: dataUrl,
      textContent: null,
    }]);
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    setShowCamera(false);
  };

  const handleCloseCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    setShowCamera(false);
  };

  useEffect(() => {
    // 1. Fetch Real Files
    const fetchFiles = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/files');
        const data = await res.json();
        setFiles(Array.isArray(data) ? data : []);
      } catch (e) { console.error("File sync failed", e); }
    };
    fetchFiles();

    // 1ب. حالة زر الفتح الكامل (استطلاع دوري + تحديث فوري عند أحداث القفل)
    const fetchLock = async () => {
      try {
        const r = await fetch('http://localhost:3001/api/system/unlock/status');
        const j = await r.json();
        if (j.success) setLockInfo({ unlocked: !!j.unlocked, expiresAt: j.expiresAt || null });
      } catch (e) { /* صامت */ }
    };
    fetchLock();
    const lockTimer = setInterval(fetchLock, 15000);

    // 2. Listen for Socket Events
    socket.on('agent-update', (data) => {
      setMessages(prev => [...prev, { ...data, id: Date.now(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), theme: data.agent === 'NeuralCore' ? 'green' : 'blue', type: 'agent' }]);
      if (data && data.agent === 'Lock') fetchLock();
      // Open detailed explanations as a tab in the central area
      if ((data.text || '').length > 350) {
        const id = 'doc_' + Date.now();
        setExplainTabs(prev => [...prev, { id, title: '📘 شرح ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), content: data.text }]);
        setActiveExplainId(id);
        setShowExplain(true);
      }
    });

    socket.on('files-changed', () => {
      fetchFiles();
    });

    socket.on('media-update', (data) => {
      setMediaContent(data);
      if (data && data.type === 'browser-preview') {
        if (data.url) setPreviewUrl(data.url);
        setPreviewMode(true);
        setShowExplain(false);
        setActiveFilePath(null);
      } else {
        setShowExplain(false);
      }
    });
        socket.on('training-update', (data) => {
          if (data.type === 'progress') {
            setTerminalOutput(prev => prev + `\n[TRAIN] step ${data.step} | loss ${data.loss} | acc ${data.acc}`);
          } else if (data.type === 'done') {
            setTerminalOutput(prev => prev + `\n[TRAIN] ✅ انتهى. ثقة المحرك: ${(data.confidence != null ? (data.confidence * 100).toFixed(1) + '%' : '?')}`);
          } else if (data.type === 'log') {
            setTerminalOutput(prev => prev + `\n[TRAIN] ${data.text}`);
          }
          setIsTerminalOpen(true);
        });

    return () => {
      clearInterval(lockTimer);
      socket.off('agent-update');
      socket.off('media-update');
      socket.off('files-changed');
    };
  }, []);

  const monaco = useMonaco();
  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme('suras-theme', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: 'ff7b72', fontStyle: 'bold' },     // Neon Red/Pink for keywords
          { token: 'string', foreground: 'a5d6ff' },                         // Bright Blue for strings
          { token: 'number', foreground: '79c0ff' },
          { token: 'function', foreground: 'd2a8ff', fontStyle: 'bold' },    // Purple for functions
          { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
          { token: 'variable', foreground: '7ee787' },                       // Neon Green for variables
          { token: 'type', foreground: 'ff7b72' },
          { token: 'class', foreground: 'd2a8ff' },
          { token: 'string.link', foreground: '58a6ff', fontStyle: 'underline' } // Markdown links
        ],
        colors: {
          'editor.background': '#00000000', // Transparent to let glassmorphism show through!
          'editor.lineHighlightBackground': '#ffffff0a',
          'editorLineNumber.foreground': '#484f58',
          'editorCursor.foreground': '#58a6ff'
        }
      });
      monaco.editor.setTheme('suras-theme');
    }
  }, [monaco]);

  useEffect(() => {
    localStorage.setItem('suras_messages', JSON.stringify(messages));
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('suras_terminal', terminalOutput);
  }, [terminalOutput]);

  // Live Self-Awareness polling
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/identity');
        const data = await res.json();
        setIdentity(data.identity);
        setIdentityOnline(!!data.online);
        setConversation(data.conversation || null);
        setFeedback(data.feedback || null);
        setEngine(data.engine || null);
      } catch (e) {
        setIdentityOnline(false);
      }
    };
    fetchIdentity();
    const idInt = setInterval(fetchIdentity, 2500);
    return () => clearInterval(idInt);
  }, []);

  const handleFileClick = async (path) => {
    if (!openFiles.find(f => f.path === path)) {
      try {
        const res = await fetch(`http://localhost:3001/api/files/content?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        setOpenFiles(prev => [...prev, data]);
      } catch (e) {
        console.error("Failed to fetch file content", e);
      }
    }
    setActiveFilePath(path);
    setMediaContent(null);
    setShowExplain(false);
  };

  const handleSaveFile = async () => {
    if (!activeFile) return;
    setIsSaving(true);
    try {
      await fetch('http://localhost:3001/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile.path, content: activeFile.content }),
      });
    } catch (e) {
      console.error("Save failed", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunCommand = async (cmd) => {
    setIsTerminalOpen(true);
    setTerminalOutput(prev => prev + `\n> ${cmd}\n`);
    try {
      const res = await fetch('http://localhost:3001/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      setTerminalOutput(prev => prev + (data.output || '') + (data.error || ''));

      // AUTO-HEALING TRIGGER
      if (data.error || (data.output && data.output.toLowerCase().includes('traceback'))) {
        setTerminalOutput(prev => prev + `\n[Auto-Heal]: Crash detected. Intercepting error and sending to Agent Alya for autonomous fix...\n`);

        await fetch('http://localhost:3001/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'code',
            data: {
              query: `I ran the command '${cmd}' and got the following crash log:\n${data.error || ''}\n${data.output || ''}\n\nPlease analyze this error, rewrite the corrected code, and save the file using the <write_file path="filename"> XML format.`
            }
          }),
        });
      }
    } catch (e) {
      setTerminalOutput(prev => prev + `Error: ${e.message}`);
    }
  };

  const handleSearch = async (query) => {
    if (!query) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`http://localhost:3001/api/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (e) {
      console.error("Search failed", e);
    }
  };

  const textareaRef = useRef(null);

  const handleSend = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const query = input.trim();
    if (!query && pendingFiles.length === 0) return;

    // Build text including file content
    let fullText = query;
    const filesForMsg = [...pendingFiles];

    // Clear input immediately
    setInput('');
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setIsProcessing(true);
    const userMsg = {
      id: Date.now(),
      type: 'user',
      name: 'You',
      role: 'Sarah',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: fullText || (filesForMsg.length > 0 ? filesForMsg.map(f => f.name).join('، ') : ''),
      theme: 'orange',
      attachments: filesForMsg,
    };
    setMessages(prev => [...prev, userMsg]);

    // Build query for server including file content
    let serverQuery = fullText;
    filesForMsg.forEach(f => {
      if (f.textContent) serverQuery += `\n\n[ملف: ${f.name}]\n\`\`\`\n${f.textContent}\n\`\`\``;
      else if (f.isImage) serverQuery += `\n\n[صورة مرفقة: ${f.name}]`;
    });

    try {
      await fetch('http://localhost:3001/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'analyze', data: { query: serverQuery || fullText } }),
      });
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now(), type: 'agent', name: 'System', role: 'Error', text: 'Communication failure.', theme: 'blue' }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // === Explanation doc tabs ===
  const openDocTab = (title, content) => {
    const id = 'doc_' + Date.now();
    setExplainTabs(prev => [...prev, { id, title, content }]);
    setActiveExplainId(id);
    setShowExplain(true);
  };

  // === MENU ACTIONS ===
  const handleNewFile = () => {
    const name = window.prompt('اسم الملف الجديد (مثال: notes.txt):');
    if (!name) return;
    fetch('http://localhost:3001/api/files/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: name, content: '' })
    }).then(() => handleFileClick(name)).catch(e => console.error(e));
  };

  const handleOpenLocalFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const p = file.name;
      setOpenFiles(prev => prev.find(f => f.path === p) ? prev : [...prev, { path: p, content: String(reader.result) }]);
      setActiveFilePath(p);
      setMediaContent(null);
      setShowExplain(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUndo = () => editorRef.current && editorRef.current.getAction('undo') && editorRef.current.getAction('undo').run();
  const handleRedo = () => editorRef.current && editorRef.current.getAction('redo') && editorRef.current.getAction('redo').run();
  const handleSelectAll = () => editorRef.current && editorRef.current.getAction('editor.action.selectAll') && editorRef.current.getAction('editor.action.selectAll').run();
  const handleCut = () => document.execCommand('cut');

  const handleGoToLine = () => {
    const lineStr = window.prompt('رقم السطر:');
    const line = parseInt(lineStr, 10);
    if (editorRef.current && line) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: 1 });
      editorRef.current.focus();
    }
  };

  const handleRunActiveFile = () => {
    if (!activeFile) { window.alert('افتح ملفاً أولاً لتشغيله.'); return; }
    const ext = activeFile.path.split('.').pop().toLowerCase();
    let cmd = '';
    if (ext === 'py') cmd = `python ${activeFile.path}`;
    else if (ext === 'js' || ext === 'jsx') cmd = `node ${activeFile.path}`;
    else if (ext === 'sh') cmd = `bash ${activeFile.path}`;
    else if (ext === 'html') cmd = `start ${activeFile.path}`;
    else { window.alert('تشغيل هذا النوع غير مدعوم مباشرة عبر القائمة.'); return; }
    handleRunCommand(cmd);
  };

  const handleRunCommandPrompt = () => {
    const cmd = window.prompt('اكتب الأمر للتشغيل:');
    if (cmd && cmd.trim()) handleRunCommand(cmd.trim());
  };

  const openHelpDoc = (kind) => {
    const c = {
      about: '# Suras AI-Pro\n\nمنظومة مساعدة محلية: مصنّف نوايا عربي، أدوات مسجلة، وبطارية تحقق — بلا ادعاء وعي.\nالوكيل "علية" يملك أدوات حقيقية: يقرأ الملفات، ينفّذ الأوامر بقضبان أمان، يبحث، ويبني.\n\n- المحرك العصبي: core/engine.py\n- الخادم: server/index.js (المنفذ 3001)\n- الواجهة: client (المنفذ 5173)',
      shortcuts: '# اختصارات لوحة المفاتيح\n\n- Ctrl+N: ملف جديد\n- Ctrl+S: حفظ الملف\n- Ctrl+Z: تراجع\n- Ctrl+Y: إعادة\n- Ctrl+L: الذهاب إلى سطر\n- Ctrl+` : تبديل الطرفية',
      docs: '# التوثيق السريع\n\n1) استخدم اللوحة اليمنى للتحدث مع الوكيل.\n2) استخدم الشريط الجانبي (Explorer/Search/Actions/Identity).\n3) شغّل الأوامر من قائمة Run أو الطرفية.\n4) الشروحات المفصّلة تظهر هنا كتبويبات.'
    };
    openDocTab('❓ ' + (kind === 'about' ? 'حول Suras' : kind === 'shortcuts' ? 'الاختصارات' : 'التوثيق'), c[kind] || '');
  };

  return (
    <div className="outer-shell" style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100vh',
      overflow: 'hidden',
    }}>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleOpenLocalFile} />
      <input ref={chatFileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleChatFileUpload} />
      {/* Camera modal */}
      {showCamera && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <video ref={cameraVideoRef} autoPlay playsInline style={{ borderRadius: '16px', maxWidth: '90vw', maxHeight: '60vh', background: '#000' }} />
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={handleCapturePhoto} style={{ padding: '10px 28px', borderRadius: '10px', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>📷 التقاط</button>
            <button onClick={handleCloseCamera} style={{ padding: '10px 20px', borderRadius: '10px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}>إغلاق</button>
          </div>
        </div>
      )}
      {/* 1. TOP MENU BAR */}
      <nav style={{
        height: '35px',
        background: 'rgba(0,0,0,0.4)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        justifyContent: 'space-between',
        position: 'relative'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Logo size={18} />
          <div style={{ display: 'flex', gap: '4px' }}>
            <TopMenuItem
              label="File"
              active={activeMenu === 'file'}
              onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
              onClose={() => setActiveMenu(null)}
              items={[
                { label: 'New Text File', shortcut: 'Ctrl+N', onClick: handleNewFile },
                { label: 'Open File...', shortcut: 'Ctrl+O', onClick: () => fileInputRef.current && fileInputRef.current.click() },
                { label: 'Save', shortcut: 'Ctrl+S', onClick: handleSaveFile },
                { label: 'Exit', shortcut: '', onClick: () => window.close() }
              ]}
            />
            <TopMenuItem
              label="Edit"
              active={activeMenu === 'edit'}
              onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
              onClose={() => setActiveMenu(null)}
              items={[
                { label: 'Undo', shortcut: 'Ctrl+Z', onClick: handleUndo },
                { label: 'Redo', shortcut: 'Ctrl+Y', onClick: handleRedo },
                { label: 'Cut', shortcut: 'Ctrl+X', onClick: handleCut }
              ]}
            />
            <TopMenuItem
              label="Selection"
              active={activeMenu === 'selection'}
              onClick={() => setActiveMenu(activeMenu === 'selection' ? null : 'selection')}
              onClose={() => setActiveMenu(null)}
              items={[{ label: 'Select All', shortcut: 'Ctrl+A', onClick: handleSelectAll }]}
            />
            <TopMenuItem
              label="View"
              active={activeMenu === 'view'}
              onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
              onClose={() => setActiveMenu(null)}
              items={[
                { label: 'Explorer', onClick: () => setActiveTab('explorer') },
                { label: 'Search', onClick: () => setActiveTab('search') },
                { label: 'Actions', onClick: () => setActiveTab('actions') },
                { label: 'Identity', onClick: () => setActiveTab('identity') },
                { label: 'Terminal', onClick: () => setIsTerminalOpen(v => !v) },
                { label: 'Explanations', onClick: () => setShowExplain(v => !v) }
              ]}
            />
            <TopMenuItem
              label="Go"
              active={activeMenu === 'go'}
              onClick={() => setActiveMenu(activeMenu === 'go' ? null : 'go')}
              onClose={() => setActiveMenu(null)}
              items={[
                { label: 'Go to File...', onClick: () => setActiveTab('search') },
                { label: 'Go to Line...', shortcut: 'Ctrl+G', onClick: handleGoToLine },
                { label: 'Go to Explorer', onClick: () => setActiveTab('explorer') }
              ]}
            />
            <TopMenuItem
              label="Run"
              active={activeMenu === 'run'}
              onClick={() => setActiveMenu(activeMenu === 'run' ? null : 'run')}
              onClose={() => setActiveMenu(null)}
              items={[
                { label: 'Run Active File', onClick: handleRunActiveFile },
                { label: 'Run Command...', onClick: handleRunCommandPrompt }
              ]}
            />
            <TopMenuItem label="Terminal" active={isTerminalOpen} onClick={() => setIsTerminalOpen(!isTerminalOpen)} />
            <TopMenuItem
              label="Help"
              active={activeMenu === 'help'}
              onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}
              onClose={() => setActiveMenu(null)}
              items={[
                { label: 'About Suras', onClick: () => openHelpDoc('about') },
                { label: 'Keyboard Shortcuts', onClick: () => openHelpDoc('shortcuts') },
                { label: 'Documentation', onClick: () => openHelpDoc('docs') }
              ]}
            />
          </div>
        </div>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '500', pointerEvents: 'none' }}>
            Suras Engine - engine.py (Workspace)
          </div>
          <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', position: 'relative', left: '80px' }}>
            {[
              { icon: Globe, tab: 'recon', title: 'Secure Recon' },
              { icon: Lock, tab: 'vault', title: 'AES-256 Vault' },
              { icon: Search, tab: 'osint', title: 'OSINT Engine' },
              { icon: Cpu, tab: 'system', title: 'System Control' },
            ].map(({ icon: Icon, tab, title }) => (
              <button
                key={tab}
                title={title}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: activeTab === tab ? 'rgba(255,255,255,0.08)' : 'none',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                  color: activeTab === tab ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '3px 7px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Bell size={14} color="var(--text-muted)" />
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: 12, height: 12, borderRadius: '2px', border: '1px solid var(--text-muted)' }} />
            <div style={{ width: 12, height: 12, borderRadius: '2px', border: '1px solid var(--text-muted)' }} />
            <X size={14} color="var(--text-muted)" />
          </div>
        </div>
      </nav>

      <div className="app-layout" style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden'
      }}>
        {/* 2. ACTIVITY BAR */}
        <aside style={{
          width: '60px',
          minWidth: '60px',
          background: 'rgba(0,0,0,0.2)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '8px'
        }}>
          <ActivityIcon icon={Folder} active={activeTab === 'explorer'} onClick={() => setActiveTab('explorer')} />
          <ActivityIcon icon={Search} active={activeTab === 'search'} onClick={() => setActiveTab('search')} />
          <ActivityIcon icon={Box} active={activeTab === 'projects'} onClick={() => setActiveTab('projects')} />
          <ActivityIcon icon={Play} active={activeTab === 'actions'} onClick={() => setActiveTab('actions')} />
           <ActivityIcon icon={GitBranch} active={activeTab === 'git'} onClick={() => setActiveTab('git')} />
           <ActivityIcon icon={Brain} active={activeTab === 'identity'} onClick={() => setActiveTab('identity')} />

          <div style={{ marginTop: 'auto', marginBottom: '16px' }}>
            <ActivityIcon icon={Settings} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </div>
        </aside>

        {/* 3. SIDEBAR (Dynamic Content) */}
        {['explorer', 'search', 'git', 'projects', 'actions', 'identity'].includes(activeTab) && (
          <div style={{ display: 'flex', flexDirection: 'column', width: '200px', minWidth: '200px', borderRight: '1px solid var(--border)' }}>
            {activeTab === 'explorer' && (
              <aside style={{ width: '100%', height: '100%', padding: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Explorer</span>
                  <MoreHorizontal size={14} color="var(--text-muted)" />
                </div>

                <div className="project-list" style={{ flex: 1, overflowY: 'auto' }}>
                  {Array.isArray(files) ? files.map((node, i) => <FileTreeNode key={i} node={node} depth={0} onFileClick={handleFileClick} />) : <div style={{ color: 'red', fontSize: '0.7rem' }}>Error loading files.</div>}
                </div>

                <div style={{ marginTop: 'auto', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', fontSize: '0.7rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <Database size={12} color="var(--primary)" />
                    <span style={{ color: 'var(--text-muted)' }}>SURAS_V1</span>
                  </div>
                  <div className="pulse-slow" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', opacity: 0.6 }}>
                    <Activity size={10} />
                    <span>LINK_READY</span>
                  </div>
                </div>
              </aside>
            )}

            {activeTab === 'search' && (
              <aside style={{ width: '100%', height: '100%', padding: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Search</span>
                </div>
                <input
                  placeholder="Search project..."
                  className="glass"
                  onChange={(e) => handleSearch(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
                <div style={{ marginTop: '20px', flex: 1, overflowY: 'auto' }}>
                  {Array.isArray(searchResults) && searchResults.map((res, i) => (
                    <div key={i} onClick={() => handleFileClick(res.path)} className="hover-item" style={{ padding: '8px', borderRadius: '6px', cursor: 'pointer', marginBottom: '4px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: '600' }}>{res.name}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.path}</div>
                    </div>
                  ))}
                  {(!Array.isArray(searchResults) || searchResults.length === 0) && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>No results found.</div>
                  )}
                </div>
              </aside>
            )}

            {activeTab === 'git' && (
              <aside style={{ width: '100%', height: '100%', padding: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Source Control</span>
                </div>
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.8rem', marginBottom: '8px' }}>Changes</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>No changes detected.</div>
                </div>
              </aside>
            )}

            {/* === PROJECTS SCANNER PANEL === */}
            {activeTab === 'projects' && (
              <aside style={{ width: '100%', height: '100%', padding: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: '10px' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Projects Scanner</span>
                <button
                  onClick={async () => {
                    setIsScanning(true);
                    setProjects([]);
                    try {
                      const res = await fetch('http://localhost:3001/api/system/search-projects');
                      const data = await res.json();
                      setProjects(Array.isArray(data) ? data : []);
                    } catch (e) { console.error(e); }
                    setIsScanning(false);
                  }}
                  className="glass"
                  style={{ padding: '8px', fontSize: '0.75rem', cursor: 'pointer', background: 'var(--primary)22', borderRadius: '8px', width: '100%' }}
                >
                  {isScanning ? '⏳ جارٍ الفحص...' : '🔍 فحص الكمبيوتر'}
                </button>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {projects.map((proj, i) => (
                    <div key={i} className="glass hover-item" style={{ padding: '10px', borderRadius: '8px', cursor: 'pointer', borderLeft: `3px solid ${proj.type === 'node' ? 'var(--success)' : proj.type === 'python' ? 'var(--accent)' : 'var(--primary)'}` }}
                      onClick={() => handleFileClick && fetch(`http://localhost:3001/api/files?root=${encodeURIComponent(proj.path)}`)}>
                      <div style={{ fontSize: '0.75rem', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '2px' }}>[{proj.type}] {proj.path.slice(0, 28)}...</div>
                    </div>
                  ))}
                  {!isScanning && projects.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textAlign: 'center', marginTop: '20px' }}>اضغط فحص للبحث</div>}
                </div>
              </aside>
            )}

            {/* === ACTIONS COMMAND PALETTE === */}
            {activeTab === 'actions' && (
              <aside style={{ width: '100%', height: '100%', padding: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: '8px' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Quick Actions</span>
                {[
                  { label: '▶ Dev Server', action: 'dev', color: 'var(--success)' },
                  { label: '⚙ Install Deps', action: 'install', color: 'var(--primary)' },
                  { label: '🔨 Build', action: 'build', color: 'var(--accent)' },
                  { label: '🧪 Test', action: 'test', color: '#f59e0b' },
                  { label: '🐍 Python Info', action: 'python', color: '#3b82f6' },
                  { label: '📋 Git Status', action: 'git-status', color: '#8b5cf6' },
                  { label: '📜 Git Log', action: 'git-log', color: '#8b5cf6' },
                  { label: '☁️ Cloud Status', action: 'list-models', color: 'var(--accent)' },
                ].map((btn) => (
                  <button key={btn.action} className="glass hover-item"
                    style={{ padding: '8px 10px', fontSize: '0.72rem', cursor: 'pointer', textAlign: 'left', borderRadius: '7px', borderLeft: `3px solid ${btn.color}`, background: `${btn.color}11` }}
                    onClick={async () => {
                      const res = await fetch('http://localhost:3001/api/run-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: btn.action }) });
                      const d = await res.json();
                      setActionLog(prev => [`[${btn.label}]: ${(d.output || d.error || '').slice(0, 120)}`, ...prev.slice(0, 9)]);
                      setIsTerminalOpen(true);
                      setTerminalOutput(prev => prev + `\n> ${btn.label}\n${d.output || d.error || ''}\n`);
                    }}>
                    {btn.label}
                  </button>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px' }}>أمر مخصص</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input value={customCmd} onChange={e => setCustomCmd(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && customCmd.trim()) {
                          const res = await fetch('http://localhost:3001/api/run-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: customCmd }) });
                          const d = await res.json();
                          setTerminalOutput(prev => prev + `\n> ${customCmd}\n${d.output || d.error || ''}\n`);
                          setIsTerminalOpen(true);
                          setCustomCmd('');
                        }
                      }}
                      placeholder="npm run ..."
                      className="glass"
                      style={{ flex: 1, padding: '6px', fontSize: '0.7rem', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }} />
                    <button className="glass" style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: '6px' }}
                      onClick={async () => {
                        if (!customCmd.trim()) return;
                        const res = await fetch('http://localhost:3001/api/run-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: customCmd }) });
                        const d = await res.json();
                        setTerminalOutput(prev => prev + `\n> ${customCmd}\n${d.output || d.error || ''}\n`);
                        setIsTerminalOpen(true);
                        setCustomCmd('');
                      }}>
                      <Play size={12} />
                    </button>
                  </div>
                  <button className="glass hover-item" style={{ marginTop: '8px', padding: '8px', fontSize: '0.72rem', cursor: 'pointer', borderRadius: '7px', borderLeft: '3px solid var(--accent)', background: 'var(--accent)11', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    onClick={async () => {
                      setIsTerminalOpen(true);
                      setTerminalOutput(prev => prev + '\n> 🧠 تدريب المحرك العصبي... (قد يستغرق حوالي دقيقتين)\n');
                      await fetch('http://localhost:3001/api/train', { method: 'POST' });
                    }}>
                    🧠 Train Neural Engine
                  </button>
                </div>
                </aside>
            )}

            {/* === SELF-AWARENESS PANEL === */}
            {activeTab === 'identity' && (
              <IdentityPanel identity={identity} online={identityOnline} conversation={conversation} feedback={feedback} engine={engine} />
            )}

          </div>
        )}

        {/* 4. MIDDLE SECTION (Editor/Stream) */}
        <section className="glass" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, borderRight: '1px solid var(--border)', borderLeft: 'none', borderTop: 'none', borderBottom: 'none', borderRadius: 0 }}>
          {openFiles.length > 0 && !panelFull && (
            <div style={{ display: 'flex', overflowX: 'auto', background: 'rgba(0,0,0,0.5)', width: '100%', borderBottom: '1px solid var(--border)' }}>
              {openFiles.map(f => (
                <div key={f.path} onClick={() => { setActiveFilePath(f.path); setMediaContent(null); }} style={{ padding: '8px 16px', background: activeFilePath === f.path ? 'rgba(255,255,255,0.05)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', borderTop: activeFilePath === f.path ? '2px solid var(--accent)' : '2px solid transparent', borderRight: '1px solid var(--border)' }}>
                  {f.path.split(/\\|\//).pop()}
                  <button onClick={(e) => { e.stopPropagation(); setOpenFiles(prev => prev.filter(x => x.path !== f.path)); if (activeFilePath === f.path) setActiveFilePath(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* === SECURE RECON PANEL === */}
          {activeTab === 'recon' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0', display: contentFull ? 'none' : 'block' }}>
              <SecureRecon />
            </div>
          )}

          {/* === VAULT PANEL === */}
          {activeTab === 'vault' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0', display: contentFull ? 'none' : 'block' }}>
              <VaultComponent />
            </div>
          )}

          {/* === OSINT PANEL === */}
          {activeTab === 'osint' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0', display: contentFull ? 'none' : 'block' }}>
              <OsintWidget />
            </div>
          )}

          {/* === SYSTEM CONTROL PANEL === */}
          {activeTab === 'system' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '0', display: contentFull ? 'none' : 'block' }}>
              <SystemPanel />
            </div>
          )}

          {/* === EXPLANATION DOC TABS === */}
          {showExplain && explainTabs.length > 0 && (
            <div style={{ display: 'flex', overflowX: 'auto', background: 'rgba(0,0,0,0.35)', width: '100%', borderBottom: '1px solid var(--border)' }}>
              {explainTabs.map(t => (
                <div key={t.id} onClick={() => { setActiveExplainId(t.id); setShowExplain(true); }} style={{ padding: '8px 16px', background: activeExplainId === t.id ? 'rgba(255,255,255,0.06)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', borderTop: activeExplainId === t.id ? '2px solid var(--accent)' : '2px solid transparent', borderRight: '1px solid var(--border)' }}>
                  {t.title}
                  <button onClick={(e) => { e.stopPropagation(); setExplainTabs(prev => prev.filter(x => x.id !== t.id)); if (explainTabs.length <= 1) setShowExplain(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <header style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: panelFull ? 'none' : 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Activity size={18} color="var(--accent)" />
              <h2 style={{ fontSize: '0.9rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>Neural Engine Stream</h2>
            </div>
            <div className="ticker-wrap" style={{ flex: 1, margin: '0 20px', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.6 }}>
              <div className="ticker" style={{ display: 'inline-block', paddingLeft: '100%', animation: 'ticker 15s linear infinite' }}>
                SYNCING_NODE_01 ... ANALYZING_LATENCY: 12ms ... CORE_EVOLUTION: +0.02% ... MEMORY_STABILITY: 99.8% ...
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                <div className="status-dot online" />
                <span style={{ fontSize: '0.7rem', color: 'var(--success)' }}>SYSTEM READY</span>
              </div>
            </div>
          </header>
          {lockInfo.unlocked && (
            <div style={{ background: 'linear-gradient(90deg, rgba(220,38,38,0.25), rgba(153,27,27,0.25))', borderBottom: '2px solid #ef4444', padding: '6px 20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', fontWeight: '700', color: '#fca5a5' }}>
              <span>🔓 القدرات الكاملة مفتوحة</span>
              <span style={{ opacity: 0.85 }}>دائمة حتى القفل اليدوي أو إعادة التشغيل</span>
              <span style={{ opacity: 0.7, fontWeight: '400' }}>كل أمر موثّق — القفل من لوحة النظام</span>
            </div>
          )}

          <div style={{ flex: 1, padding: '24px', background: 'rgba(0,0,0,0.3)', overflowY: 'auto', display: panelFull ? 'none' : 'block' }}>
            <AnimatePresence mode="wait">
              {showExplain && activeExplainTab ? (
                <motion.div
                  key={'doc_' + activeExplainTab.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="glass" style={{ padding: '0px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileCode size={18} color="var(--accent)" />
                        <span style={{ fontWeight: '600', fontSize: '0.8rem' }}>{activeExplainTab.title}</span>
                      </div>
                      <button
                        onClick={() => { setExplainTabs(prev => prev.filter(x => x.id !== activeExplainTab.id)); if (explainTabs.length <= 1) setShowExplain(false); }}
                        className="glass"
                        style={{ padding: '4px 12px', fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        CLOSE
                      </button>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden', paddingTop: '8px' }}>
                      <Editor
                        height="100%"
                        language="markdown"
                        theme="suras-theme"
                        value={activeExplainTab.content}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          fontSize: 13,
                          fontFamily: "monospace",
                          lineHeight: 24,
                          padding: { top: 16 },
                          scrollBeyondLastLine: false,
                          smoothScrolling: true,
                          wordWrap: 'on'
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              ) : previewMode || (activeFile && (activeFile.path.endsWith('.html') || activeFile.path.endsWith('.htm'))) ? (
                <motion.div
                  key={'preview_' + (activeFile?.path || previewUrl) + '_' + previewKey}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="glass" style={{ padding: '0px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    {/* Antigravity-style Browser Frame Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid var(--border)', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
                      </div>

                      {/* URL / Path bar */}
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '4px 12px', gap: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <Globe size={14} color="var(--accent)" />
                        <input
                          type="text"
                          value={activeFile ? `suras://preview/${activeFile.path}` : previewUrl}
                          onChange={(e) => setPreviewUrl(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') setPreviewKey(k => k + 1); }}
                          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '0.75rem', fontFamily: 'monospace' }}
                        />
                        <button onClick={() => setPreviewKey(k => k + 1)} title="إعادة تحميل" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                          <RefreshCw size={13} />
                        </button>
                      </div>

                      {/* Controls & Device toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          onClick={() => setPreviewDevice('desktop')}
                          title="Desktop view"
                          style={{ padding: '4px 8px', borderRadius: '6px', background: previewDevice === 'desktop' ? 'rgba(255,255,255,0.15)' : 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
                        >
                          <Monitor size={14} />
                        </button>
                        <button
                          onClick={() => setPreviewDevice('mobile')}
                          title="Mobile view"
                          style={{ padding: '4px 8px', borderRadius: '6px', background: previewDevice === 'mobile' ? 'rgba(255,255,255,0.15)' : 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
                        >
                          <Smartphone size={14} />
                        </button>

                        {activeFile && (
                          <button
                            onClick={() => setPreviewMode(false)}
                            className="glass"
                            style={{ padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer', background: 'var(--primary)33', color: '#fff' }}
                          >
                            💻 المحرر
                          </button>
                        )}

                        <button
                          onClick={() => window.open(activeFile ? `http://localhost:3001/${activeFile.path}` : previewUrl, '_blank')}
                          title="فتح في نافذة خارجية"
                          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                        >
                          <ExternalLink size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Web Frame Iframe */}
                    <div style={{ flex: 1, background: '#fff', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                      <iframe
                        key={previewKey}
                        srcDoc={activeFile && activeFile.content ? activeFile.content : undefined}
                        src={!activeFile ? previewUrl : undefined}
                        title="Suras Live Preview"
                        style={{
                          width: previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%',
                          height: '100%',
                          border: previewDevice !== 'desktop' ? '1px solid rgba(0,0,0,0.2)' : 'none',
                          boxShadow: previewDevice !== 'desktop' ? '0 10px 40px rgba(0,0,0,0.3)' : 'none',
                          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          background: '#fff'
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              ) : activeFile ? (
                <motion.div
                  key={activeFile.path}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="glass" style={{ padding: '0px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileCode size={18} color="var(--primary)" />
                        <span style={{ fontWeight: '600', fontSize: '0.8rem' }}>{activeFile.path}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setPreviewMode(true)}
                          className="glass"
                          style={{ padding: '4px 12px', fontSize: '0.7rem', cursor: 'pointer', background: 'var(--accent)33', color: '#fff' }}
                        >
                          🌐 شاشة العرض
                        </button>
                        <button
                          onClick={handleSaveFile}
                          className="glass"
                          style={{ padding: '4px 12px', fontSize: '0.7rem', cursor: 'pointer', background: isSaving ? 'var(--success)44' : 'rgba(255,255,255,0.05)' }}
                        >
                          {isSaving ? 'SAVING...' : 'SAVE'}
                        </button>
                        <button
                          onClick={() => handleRunCommand(`python ${activeFile.path}`)}
                          className="glass"
                          style={{ padding: '4px 12px', fontSize: '0.7rem', cursor: 'pointer', background: 'var(--primary)44' }}
                        >
                          RUN
                        </button>
                      </div>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden', paddingTop: '8px' }}>
                      <Editor
                        height="100%"
                        language={(() => {
                          const ext = activeFile.path.split('.').pop().toLowerCase();
                          const map = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sql: 'sql', sh: 'shell', yaml: 'yaml', yml: 'yaml', xml: 'xml' };
                          return map[ext] || 'plaintext';
                        })()}
                        theme="suras-theme"
                        value={activeFile.content}
                        onChange={(val) => setOpenFiles(prev => prev.map(f => f.path === activeFile.path ? { ...f, content: val } : f))}
                        onMount={(editor) => { editorRef.current = editor; }}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          fontFamily: "monospace",
                          lineHeight: 24,
                          padding: { top: 16 },
                          scrollBeyondLastLine: false,
                          smoothScrolling: true
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              ) : mediaContent ? (
                <motion.div
                  key={mediaContent.timestamp || Date.now()}
                  initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.5, ease: "circOut" }}
                >
                  <div style={{ padding: '8px 4px' }}>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '32px' }}>
                      <div>
                        <h3 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '4px' }}>{mediaContent.title}</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>COMPUTATION SEQUENCE: #{Math.floor(Math.random() * 900000)}</p>
                      </div>
                      <div className="glass" style={{ padding: '12px 20px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Cpu size={20} color="var(--accent)" />
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>CONFIDENCE</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--accent)' }}>{(mediaContent.metadata?.confidence * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '24px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>Reasoning Steps</div>
                          {mediaContent.content.reasoning?.map((step, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', fontSize: '0.85rem' }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)' }} />
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>

                        <div style={{ background: 'rgba(0,0,0,0.4)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>Neural Output Vector</div>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {mediaContent.content.energy?.map((val, i) => (
                              <div key={i} className="glass" style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--accent)', borderColor: 'var(--accent)33' }}>
                                {val.toFixed(4)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {Object.entries(mediaContent.content.metrics || {}).map(([key, val]) => (
                          <div key={key} className="glass" style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)' }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'capitalize' }}>{key.replace('_', ' ')}</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>{typeof val === 'number' && val < 1 ? (val * 100).toFixed(1) + '%' : val}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>INTERNAL_CORE_LATENCY: 124ms</div>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button className="glass" style={{ padding: '6px 16px', fontSize: '0.7rem', cursor: 'pointer' }}>DOWNLOAD STATE</button>
                        <button className="glass" style={{ padding: '6px 16px', fontSize: '0.7rem', cursor: 'pointer', background: 'var(--primary)22' }}>RE-ENGAGE</button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div key="empty" style={{ height: '100%', border: '1px dashed var(--border)', borderRadius: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 8, ease: "linear" }}>
                    <Activity size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
                  </motion.div>
                  <p style={{ fontSize: '1.2rem', fontWeight: '300' }}>Awaiting <span style={{ color: 'var(--accent)' }}>Neural Transmission</span>...</p>
                  <p style={{ fontSize: '0.8rem', marginTop: '8px', opacity: 0.5 }}>Cluster heartbeat: 64bpm</p>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* 6. TERMINAL SECTION (New) */}
          {isTerminalOpen && (
            <div style={{ height: '180px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)' }}>TERMINAL</span>
                <button onClick={() => setIsTerminalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
              </div>
              <pre style={{ flex: 1, overflow: 'auto', padding: '12px', fontSize: '0.75rem', color: '#a7f3d0', fontFamily: 'monospace', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {terminalOutput}
              </pre>
            </div>
          )}
        </section>

        {/* 5. RIGHT SECTION (Chat) — Antigravity Style */}
        <main style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '320px',
          minWidth: '280px',
          overflow: 'hidden',
          background: '#0d0d12',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
        }}>
          {/* Minimal header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isProcessing ? '#f97316' : '#22c55e',
                boxShadow: isProcessing ? '0 0 6px #f97316' : '0 0 6px #22c55e',
                transition: 'all 0.3s',
              }} />
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.3px' }}>
                سوراس
              </span>
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontWeight: '400' }}>
                {isProcessing ? 'يعالج...' : 'جاهز'}
              </span>
            </div>
            <button
              onClick={() => setMessages([
                { id: Date.now(), type: 'agent', agent: 'سوراس', name: 'سوراس', role: 'AI', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: 'مرحباً! محادثة جديدة. كيف يمكنني مساعدتك؟', theme: 'orange' }
              ])}
              title="محادثة جديدة"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.3)', padding: '4px', borderRadius: '6px',
                fontSize: '0.7rem',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}
            >
              +
            </button>
          </div>

          {/* Chat messages area — Antigravity style, no cards */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.08) transparent',
          }}>
            {Array.isArray(messages) && messages
              .filter(msg => msg.type === 'user' || msg.agent === 'Agent Alya' || msg.name === 'سوراس')
              .map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '2px 0' }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'linear-gradient(135deg,#f97316,#dc2626)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.65rem', fontWeight: '800', color: '#fff', flexShrink: 0,
                }}>ع</div>
                <div style={{ paddingTop: 6, display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <motion.div key={i}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                      style={{ width: 6, height: 6, borderRadius: '50%', background: '#f97316' }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input — Antigravity style */}
          <footer style={{
            padding: '12px 14px 14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.15)',
          }}>
            <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '8px',
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${pendingFiles.length > 0 ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '14px',
                padding: '8px 12px',
                transition: 'border-color 0.2s',
                flexDirection: 'column',
              }}
                onFocus={() => {}}
              >
                {/* Pending files preview — horizontal scrollable strip, does NOT expand the box */}
                {pendingFiles.length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: '6px',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    paddingBottom: '6px',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    flexShrink: 0,
                    scrollbarWidth: 'none',
                  }}>
                    {pendingFiles.map(f => (
                      <div key={f.id} style={{ position: 'relative', flexShrink: 0 }}>
                        {f.isImage ? (
                          <img src={f.data} alt={f.name} style={{ height: 32, width: 32, objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', display: 'block' }} />
                        ) : (
                          <div style={{ padding: '3px 7px', background: 'rgba(255,255,255,0.07)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.65rem', color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '90px', height: 32, boxSizing: 'border-box' }}>
                            <Paperclip size={10} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setPendingFiles(prev => prev.filter(x => x.id !== f.id))}
                          style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, borderRadius: '50%', background: 'rgba(239,68,68,0.9)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.55rem', lineHeight: 1, zIndex: 1 }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', position: 'relative' }}>
                    {showPlusMenu && (
                      <div style={{
                        position: 'absolute',
                        bottom: '40px',
                        left: '0',
                        background: 'rgba(20,20,20,0.95)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '12px',
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        width: '140px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                        zIndex: 100
                      }}>
                        <div className="hover-item" style={{ padding: '6px 10px', fontSize: '0.75rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.85)' }} onClick={() => { chatFileInputRef.current?.click(); setShowPlusMenu(false); }}>
                          <Paperclip size={14} /> إرفاق ملف
                        </div>
                        <div className="hover-item" style={{ padding: '6px 10px', fontSize: '0.75rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.85)' }} onClick={handleOpenCamera}>
                          <Camera size={14} /> التقاط صورة
                        </div>
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={!input.trim() && pendingFiles.length === 0}
                      style={{
                        width: 34, height: 34, borderRadius: '10px', border: 'none',
                        background: (input.trim() || pendingFiles.length > 0)
                          ? 'linear-gradient(135deg,#7c3aed,#2563eb)'
                          : 'rgba(255,255,255,0.08)',
                        cursor: (input.trim() || pendingFiles.length > 0) ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.2s',
                        boxShadow: (input.trim() || pendingFiles.length > 0) ? '0 2px 10px rgba(124,58,237,0.4)' : 'none',
                      }}
                    >
                      <Send size={15} color={(input.trim() || pendingFiles.length > 0) ? '#fff' : 'rgba(255,255,255,0.3)'} />
                    </button>
                    <button
                      type="button"
                      title="تسجيل صوتي"
                      onClick={toggleRecording}
                      style={{
                        width: 34, height: 34, borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
                        background: isRecording ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.2s',
                        boxShadow: isRecording ? '0 0 12px rgba(239,68,68,0.5)' : 'none'
                      }}
                      onMouseEnter={e => { if (!isRecording) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                      onMouseLeave={e => { if (!isRecording) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    >
                      <Mic size={15} color={isRecording ? '#ef4444' : 'rgba(255,255,255,0.7)'} />
                    </button>
                    <button
                      type="button"
                      title="خيارات إضافية"
                      onClick={() => setShowPlusMenu(!showPlusMenu)}
                      style={{
                        width: 34, height: 34, borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
                        background: showPlusMenu ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.2s',
                        color: 'rgba(255,255,255,0.7)',
                        fontSize: '1.2rem',
                        fontWeight: '300',
                      }}
                      onMouseEnter={e => { if (!showPlusMenu) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { if (!showPlusMenu) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
                    >
                      +
                    </button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    placeholder={pendingFiles.length > 0 ? 'أضف توضيحاً للملف... (اختياري)' : 'أرسل رسالة لسوراس...'}
                    value={input}
                    onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                    rows={1}
                    dir="auto"
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'rgba(255,255,255,0.9)',
                      fontSize: '0.87rem',
                      lineHeight: '1.5',
                      resize: 'none',
                      fontFamily: 'inherit',
                      minHeight: pendingFiles.length > 0 ? '74px' : '114px',
                      maxHeight: '200px',
                      overflow: 'auto',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)' }}>Enter للإرسال • Shift+Enter سطر جديد</span>
                <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)' }}>{isProcessing ? '⏳ معالجة...' : '● جاهز'}</span>
              </div>
            </form>
          </footer>
        </main>
      </div>
    </div>
  );
}

function FileTreeNode({ node, depth, onFileClick }) {
  const [isOpen, setIsOpen] = useState(depth < 1);
  const Icon = node.type === 'dir' ? (isOpen ? FolderOpen : Folder) : FileText;

  const handleClick = () => {
    if (node.type === 'dir') {
      setIsOpen(!isOpen);
    } else {
      onFileClick(node.path);
    }
  };

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <div
        onClick={handleClick}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', cursor: 'pointer', borderRadius: '6px', fontSize: '0.8rem', color: node.type === 'dir' ? 'var(--text-muted)' : 'var(--text)' }}
      >
        {node.type === 'dir' && <ChevronRight size={12} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: '0.2s' }} />}
        <Icon size={14} color={node.type === 'dir' ? 'var(--primary)' : 'var(--text-muted)'} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </div>
      {node.type === 'dir' && isOpen && node.children && (
        <div>{node.children.map((child, i) => <FileTreeNode key={i} node={child} depth={depth + 1} onFileClick={onFileClick} />)}</div>
      )}
    </div>
  );
}

// === SURAS Voice Engine (gTTS) — speak any agent reply aloud ===
async function speakText(text) {
  if (!text || !text.trim()) return;
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const body = new URLSearchParams();
  body.append('text', text);
  body.append('lang', hasArabic ? 'ar' : 'en');
  try {
    const res = await fetch('http://localhost:3001/api/suras/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'فشل مولّد الصوت');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play();
  } catch (e) {
    console.error('TTS error:', e);
    alert('تعذر توليد الصوت: ' + e.message);
  }
}

function SpeakButton({ text }) {
  const [playing, setPlaying] = useState(false);
  let liveAudio = null;
  const onSpeak = (e) => {
    e.stopPropagation();
    if (playing && liveAudio) {
      liveAudio.pause();
      URL.revokeObjectURL(liveAudio.src);
      liveAudio = null;
      setPlaying(false);
      return;
    }
    if (!text || !text.trim()) return;
    const hasArabic = /[\u0600-\u06FF]/.test(text);
    const body = new URLSearchParams();
    body.append('text', text);
    body.append('lang', hasArabic ? 'ar' : 'en');
    fetch('http://localhost:3001/api/suras/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('فشل مولّد الصوت');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        liveAudio = audio;
        audio.onended = () => { URL.revokeObjectURL(url); setPlaying(false); };
        setPlaying(true);
        audio.play();
      })
      .catch((err) => {
        console.error('TTS error:', err);
        alert('تعذر توليد الصوت');
      });
  };
  return (
    <button
      onClick={onSpeak}
      title="🎙️ النطق الصوتي (SURAS Voice)"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: playing ? '#f97316' : 'rgba(255,255,255,0.35)',
        padding: '2px 6px', borderRadius: '6px', fontSize: '0.85rem',
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        transition: 'color 0.2s',
      }}
      onMouseEnter={e => e.target.style.color = playing ? '#f97316' : 'rgba(255,255,255,0.8)'}
      onMouseLeave={e => e.target.style.color = playing ? '#f97316' : 'rgba(255,255,255,0.35)'}
    >
      {playing ? '⏹' : '🔊'}
    </button>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.type === 'user';

  // User message — right-aligned gradient bubble
  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        style={{ display: 'flex', justifyContent: 'flex-end' }}
      >
        <div style={{
          maxWidth: '80%',
          background: 'linear-gradient(135deg,#5b21b6,#1d4ed8)',
          borderRadius: '18px 18px 4px 18px',
          padding: '9px 14px',
          fontSize: '0.875rem',
          lineHeight: '1.6',
          color: '#fff',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          boxShadow: '0 2px 16px rgba(91,33,182,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }} dir="auto">
          {/* Attachments */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: msg.text ? '4px' : 0 }}>
              {msg.attachments.map(f => (
                f.isImage ? (
                  <img key={f.id} src={f.data} alt={f.name} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: '10px', display: 'block', objectFit: 'cover' }} />
                ) : (
                  <div key={f.id} style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Paperclip size={11} /> {f.name}
                  </div>
                )
              ))}
            </div>
          )}
          {msg.text && <span>{msg.text}</span>}
        </div>
      </motion.div>
    );
  }

  // System / AI message — plain text, no card, small colored dot + name
  const dotColor =
    msg.theme === 'green'  ? '#22c55e' :
    msg.theme === 'purple' ? '#a855f7' :
    msg.theme === 'orange' ? '#f97316' :
    msg.theme === 'red'    ? '#ef4444' :
                             '#60a5fa';

  const agentLabel =
    msg.agent === 'Agent Alya'     ? 'سوراس' :
    msg.agent === 'NeuralCore'     ? 'العقل العصبي' :
    msg.agent === 'Tool Runner'    ? 'منفّذ الأدوات' :
    msg.agent === 'Self-Reflector' ? 'مراجع ذاتي' :
    msg.agent === 'Commander'      ? 'منفّذ الأوامر' :
    msg.name === 'System'          ? 'نظام' :
    msg.agent || msg.name || 'سوراس';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}
    >
      {/* Tiny colored avatar circle */}
      <div style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: `${dotColor}22`,
        border: `1.5px solid ${dotColor}55`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 1,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Agent name + time inline */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '3px' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: '600', color: dotColor }}>
            {agentLabel}
          </span>
          {msg.status && (
            <span style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
              {msg.status}
            </span>
          )}
          <span style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>
            {msg.time}
          </span>
        </div>

        {/* Message body — pure text, no box */}
        <div style={{
          fontSize: '0.865rem',
          lineHeight: '1.72',
          color: 'rgba(255,255,255,0.82)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }} dir="auto">
          {msg.details || msg.text}
        </div>

        {/* SURAS Voice Engine — النطق الصوتي للرد */}
        <SpeakButton text={msg.details || msg.text} />
      </div>
    </motion.div>
  );
}

function ToolbarSmallBtn({ icon, label, primary }) {
  return (
    <button className={`glow-btn ${primary ? 'primary' : ''}`} style={{ width: '56px', height: '48px', borderRadius: '12px' }}>
      {icon}
      <span style={{ fontSize: '0.6rem' }}>{label}</span>
    </button>
  );
}

function IdentityPanel({ identity, online, conversation, feedback, engine }) {
  return (
    <aside style={{ width: '100%', height: '100%', padding: '14px', display: 'flex', flexDirection: 'column', overflowY: 'auto', gap: '12px' }}>
      <div className="glass" style={{ padding: '12px', borderRadius: '12px', borderLeft: '3px solid var(--primary)', background: 'linear-gradient(90deg, var(--primary)11, transparent)' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>قائمة سلوك سوراس (الأولى)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '8px' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', marginTop: 6 }} /><span><b>1) الاستيعاب:</b> يفهم قصدك بعمق قبل الرد.</span></div>
          <div style={{ display: 'flex', gap: '8px' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginTop: 6 }} /><span><b>2) التحدث والاقتراح:</b> يخاطبك ويقترح أفعالاً استباقية.</span></div>
          <div style={{ display: 'flex', gap: '8px' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', marginTop: 6 }} /><span><b>3) التنفيذ عند الطلب:</b> ينفّذ فعلياً عبر أدواته الحقيقية، بلا اعتذار.</span></div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Self-Awareness</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="status-dot" style={{ background: online ? 'var(--success)' : 'var(--text-muted)' }} />
          <span style={{ fontSize: '0.6rem', color: online ? 'var(--success)' : 'var(--text-muted)' }}>{online ? 'AWARE' : 'OFFLINE'}</span>
        </div>
      </div>

      {identity ? (
        <>
          <div className="glass" style={{ padding: '14px', borderRadius: '12px', borderLeft: '3px solid var(--primary)', background: 'linear-gradient(90deg, var(--primary)11, transparent)' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text)' }}>{identity.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginBottom: '6px' }}>«{identity.alias}»</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{identity.kind}</div>
          </div>

          <div className="glass" style={{ padding: '12px', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Creed</div>
            <p style={{ fontSize: '0.75rem', lineHeight: '1.7', color: 'var(--text)', textAlign: 'right', direction: 'rtl' }}>{identity.creed}</p>
          </div>

          <div className="glass" style={{ padding: '12px', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Core Traits</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {identity.traits.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass" style={{ padding: '12px', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Dialogue Memory</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text)' }}>رحلات حوارية: {conversation ? conversation.turns : 0}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>يتذكّر سياقك عبر الجلسات</div>
          </div>

          <div className="glass" style={{ padding: '12px', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Learned Feedback</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text)' }}>تعليمات مكتسبة: {feedback ? feedback.count : 0}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>يتعلّم من تغذيتك ويطبّقها لاحقاً</div>
          </div>

          <div className="glass" style={{ padding: '12px', borderRadius: '12px', borderLeft: '3px solid var(--accent)', background: 'linear-gradient(90deg, var(--accent)11, transparent)' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Neural Engine (المحرك العصبي)</div>
            {engine ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(engine.confidence * 100).toFixed(0)}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--accent))' }} />
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--accent)' }}>{(engine.confidence * 100).toFixed(1)}%</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>الثقة الكلية (متوسط النماذج الثلاثة)</div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  • لغة (LM): {engine.lm ? (engine.lm.confidence * 100).toFixed(0) + '%' : '—'} {engine.lm ? `| val_loss ${Number(engine.lm.val_loss).toFixed(3)}` : ''}
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  • مكافأة (Reward): {engine.reward ? (engine.reward.confidence * 100).toFixed(0) + '%' : '—'} {engine.reward ? `| val_mse ${Number(engine.reward.val_mse).toFixed(3)}` : ''}
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  • متحكّم (Controller): {engine.controller ? (engine.controller.confidence * 100).toFixed(0) + '%' : '—'} {engine.controller ? `| acc ${Number(engine.controller.val_accuracy).toFixed(3)}` : ''}
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '4px' }}>آخر تدريب: {engine.lm?.trained_at || engine.reward?.trained_at || engine.controller?.trained_at || '—'}</div>
              </>
            ) : (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>لم يُدرّب بعد. استخدم «🧠 Train Engine» من لوحة Actions.</div>
            )}
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center', marginTop: '20px' }}>
          العقل العصبي غير نشط بعد.<br />أرسل استفساراً لتفعيل الوعي.
        </div>
      )}

      <div style={{ marginTop: 'auto', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Brain size={14} color="var(--primary)" />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>SURAS_IDENTITY_CORE v1</span>
      </div>
    </aside>
  );
}

export default App;
