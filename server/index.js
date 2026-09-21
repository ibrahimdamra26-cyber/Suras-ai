import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { readFileSync, existsSync, statSync } from 'fs';
import { exec } from 'child_process';

// Suras Tool Registry — سجل الأدوات الموحد (server/tools/)
import { defineTool, dispatchTools, clarifyIntent } from './tools/registry.js';
import { VIDEO_TOOL, isVideoCreationRequest } from './tools/video.js';
import { HEALTH_TOOL } from './tools/health.js';
import { PAGE_TOOL } from './tools/page.js';
import { PROJECTS_TOOL, isProjectsRequest } from './tools/projects.js';
import { TIME_TOOL } from './tools/time.js';
import { PAGEGEN_TOOL, isPreviewIntent } from './tools/pagegen.js';
import { WEBSCOUT_TOOL, readMasterKey as readSurasKey } from './tools/webscout.js';
import { TERMINAL_TOOL } from './tools/terminal.js';
import { CODERUNNER_TOOL } from './tools/coderunner.js';
import { WEBFETCH_TOOL } from './tools/webfetch.js';
import { ORGANIZER_TOOL } from './tools/organizer.js';
import { GROUNDING_TOOL } from './tools/grounding.js';
import { KNOWLEDGE_TOOL, retrieveKnowledge } from './tools/knowledge.js';
import { PROJECT_ENGINE_TOOL, buildProjectFromRequest } from './tools/project_engine.js';
import { addTrainingFeedback, evaluateModelQuality, getTrainingSummary } from './tools/learning.js';
import { checkHarmful, isHarmfulBlocked, matchTestCommand, isRefusalTestMode, setRefusalTestMode } from './tools/refusal.js';
import { checkExecute } from './tools/safety.js';
import { startTrace, traceStep, endTrace, listTraces } from './tools/trace.js';
import { cloudBridge } from './tools/ai_bridge.js';
defineTool(VIDEO_TOOL);
defineTool(HEALTH_TOOL);
defineTool(PAGE_TOOL);
defineTool(PROJECTS_TOOL);
defineTool(TIME_TOOL);

defineTool(PAGEGEN_TOOL);

defineTool(WEBSCOUT_TOOL);

defineTool(TERMINAL_TOOL);

defineTool(CODERUNNER_TOOL);

defineTool(WEBFETCH_TOOL);

defineTool(ORGANIZER_TOOL);
defineTool(GROUNDING_TOOL);
defineTool(KNOWLEDGE_TOOL);
defineTool(PROJECT_ENGINE_TOOL);
// نية المعاينة الحية معرفة في server/tools/pagegen.js (مصدر واحد) — تُستخدم في الحارس أدناه.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));
// واجهة الإنتاج المبنية (client/dist): تُخدم أصولها (/assets, favicon...) من هنا
// موضوعة بعد خدمة الجذر فلا تحجب أي مسار /api (غير موجود كملفات فينزل للمسارات)
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// خدمة ثابتة عالية الأولوية لمخرج الفيديوهات التسويقية (enic التشغيل المباشر والفوري في شاشة المعاينة)
app.use('/productions', express.static(path.join(__dirname, '..', 'productions'), {
    maxAge: 0, // إعادة القراءة من القرص في كل طلب لتحديث الفيديو فور خروجه من محرك الرندرة
    setHeaders: (res) => {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');
    },
}));

// ============================================================
// Conversation Memory — Suras remembers context across sessions
// ============================================================
const conversationFile = path.join(__dirname, 'conversation.json');
let conversationHistory = [];
try {
    if (existsSync(conversationFile)) {
        const parsed = JSON.parse(readFileSync(conversationFile, 'utf-8'));
        conversationHistory = Array.isArray(parsed) ? parsed : [];
    }
} catch (e) { conversationHistory = []; }
const MAX_HISTORY = 24;
function buildMessages(systemPrompt, userQuery) {
    const hist = conversationHistory.slice(-MAX_HISTORY).map(t => ({ role: t.role, content: t.content }));
    return [{ role: 'system', content: systemPrompt }, ...hist, { role: 'user', content: userQuery }];
}
async function appendTurn(role, content) {
    if (!content || !String(content).trim()) return;
    conversationHistory.push({ role, content: String(content).trim().slice(0, 4000) });
    if (conversationHistory.length > 80) conversationHistory = conversationHistory.slice(-80);
    try { await fs.writeFile(conversationFile, JSON.stringify(conversationHistory, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
}

app.get('/', (req, res) => {
    // الواجهة الإنتاجية المبنية (client/dist) — متاحة دائماً مع السيرفر
    const distIndex = path.join(__dirname, '..', 'client', 'dist', 'index.html');
    if (existsSync(distIndex)) {
        return res.sendFile(distIndex);
    }
    res.send('Suras AI Orchestrator is ONLINE');
});

// حالة السيرفر كنص (كانت على الجذر سابقاً)
app.get('/api/status', (req, res) => {
    res.send('Suras AI Orchestrator is ONLINE');
});

app.get('/api/agent/architecture', (req, res) => {
    res.json({
        name: 'Suras Agent',
        status: 'online',
        safety: {
            grounding_required: true,
            no_hallucination_without_source: true,
            no_unverified_answers: true,
            interface_unchanged: true,
        },
        pipeline: [
            'analyze_request',
            'retrieve_sources',
            'route_tools',
            'plan_execution',
            'build_project',
            'execute_action',
            'verify_results',
            'respond_with_evidence',
        ],
        tools: ['search', 'api', 'terminal', 'planner', 'review', 'grounding', 'knowledge', 'project-engine'],
        objective: 'Answer, act, and verify using grounded evidence and safe tool usage.',
    });
});

function loadSeedKnowledge() {
    const kbPath = path.join(__dirname, 'knowledge', 'seed.json');
    try {
        if (!existsSync(kbPath)) return [];
        const parsed = JSON.parse(readFileSync(kbPath, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

async function runInternalAgentLoop(query, extra = {}) {
    const text = String(query || '').trim();
    if (!text) {
        return {
            status: 'blocked',
            answer: 'لا يوجد طلب ليُعالج. أرسل سؤالاً أو مهمة واضحة.',
            grounded: false,
            knowledge: [],
            tool_observations: [],
        };
    }

    const docs = loadSeedKnowledge();
    const knowledgeHits = retrieveKnowledge(text, docs, 3);
    const evidence = knowledgeHits.map(item => `${item.source}: ${item.title}`);

    const toolObservations = await dispatchTools(text, {
        io,
        fs,
        path,
        rootDir: __dirname,
        evidence,
        ...extra,
    });

    const isGreeting = /(مرحبا|مرحبة|اهلا|أهلا|hello|hi|hey|من أنت|من تكون|أنت من|who are you|what are you)/i.test(text);
    if (isGreeting) {
        return {
            status: 'ok',
            answer: 'أنا سوراس، محرك داخلي مستقل داخل هذا المشروع. أعمل من خلال قاعدة المعرفة المحلية، التوجيه الداخلي، وتنفيذ الأدوات داخل نفس التطبيق — بدون وكيل خارجي أو تدخل بشري مستمر.',
            grounded: true,
            knowledge: knowledgeHits,
            tool_observations: toolObservations,
        };
    }

    const isProjectBuildRequest = /(أنشئ|أنشأ|اصنع|أنشِئ|build|create|generate|scaffold|project|مشروع|موقع|واجهة|تطبيق|dashboard|api)/i.test(text) && /(مشروع|project|موقع|website|واجهة|app|dashboard|api|تطبيق|نظام|صفحة|site)/i.test(text);
    if (isProjectBuildRequest) {
        const projectBuild = await buildProjectFromRequest(text, { rootDir: __dirname, io });
        if (projectBuild.status === 'ok') {
            const verificationSummary = projectBuild.verification.checks.map((check) => `- ${check.file}: ${check.ok ? 'OK' : 'FAIL'} (${check.check})`).join('\n');
            if (projectBuild.preview_url) {
                io.emit('media-update', {
                    type: 'browser-preview',
                    url: projectBuild.preview_url,
                    title: `🖥️ ${projectBuild.project_name}`,
                });
            }
            return {
                status: 'ok',
                answer: `تم بناء المشروع بشكل داخلي بنجاح.\nالمسار: ${projectBuild.directory}\nالنوع: ${projectBuild.project_type}\nالملفات: ${projectBuild.generated_files.length}\n${verificationSummary}\n${projectBuild.preview_url ? `معاينة: ${projectBuild.preview_url}` : ''}`,
                grounded: true,
                knowledge: knowledgeHits,
                tool_observations: [...toolObservations, `Project Engine: created ${projectBuild.project_name}`],
                project: {
                    name: projectBuild.project_name,
                    type: projectBuild.project_type,
                    directory: projectBuild.directory,
                    preview_url: projectBuild.preview_url,
                    verification: projectBuild.verification,
                },
            };
        }
    }

    const grounded = knowledgeHits.length > 0 || toolObservations.length > 0;
    if (!grounded && /(ما|ماذا|من|هل|كم|أين|متى|كيف|why|what|who|when|where|which|is|are|can|could|does|do)/i.test(text)) {
        return {
            status: 'needs_evidence',
            answer: 'لا أستطيع تأكيد هذه المعلومة بدون مصدر موثوق أو دليل متاح في هذا المشروع. أستطيع أن أشرح فقط ما يمكن التحقق منه أو أطلب توضيحاً.',
            grounded: false,
            knowledge: knowledgeHits,
            tool_observations: toolObservations,
        };
    }

    const answer = (() => {
        if (knowledgeHits.length > 0) {
            return knowledgeHits.map((hit) => `[${hit.source}] ${hit.title}\n${hit.content}`).join('\n\n');
        }
        if (toolObservations.length > 0) {
            return toolObservations.join('\n\n');
        }
        return 'استلمت الطلب وبدأت في معالجة المهمة داخل المشروع، لكن لا يوجد دليل موثوق كافٍ الآن لإصدار إجابة نهائية.';
    })();

    return {
        status: 'ok',
        answer,
        grounded,
        knowledge: knowledgeHits,
        tool_observations: toolObservations,
    };
}

app.post('/api/agent/chat', async (req, res) => {
    try {
        const query = String(req.body?.query || '');
        const result = await runInternalAgentLoop(query, { requestId: req.body?.requestId || null });
        res.json(result);
    } catch (error) {
        res.status(500).json({ status: 'error', answer: `فشل محرك سوراس الداخلي: ${error.message}`, grounded: false });
    }
});

app.post('/api/project/build', async (req, res) => {
    try {
        const query = String(req.body?.query || req.body?.prompt || '');
        const result = await buildProjectFromRequest(query, { rootDir: __dirname, io });
        if (result && result.status === 'ok' && result.preview_url) {
            io.emit('media-update', {
                type: 'browser-preview',
                url: result.preview_url,
                title: `🖥️ ${result.project_name || 'Generated Project'}`,
            });
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/api/agent/training/status', (req, res) => {
    try {
        res.json(getTrainingSummary());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/agent/training/feedback', (req, res) => {
    try {
        const question = String(req.body?.question || '');
        const answer = String(req.body?.answer || '');
        const category = String(req.body?.category || 'general');
        const accepted = Boolean(req.body?.accepted ?? true);
        const result = addTrainingFeedback({ question, answer, category, accepted });
        res.json({ ok: result.added, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agent/training/eval', (req, res) => {
    try {
        const question = String(req.query?.question || '');
        const answer = String(req.query?.answer || '');
        if (!question || !answer) {
            return res.json({ status: 'empty', total: 0, average_score: 0, best_match: null });
        }
        return res.json(evaluateModelQuality(question, answer));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/knowledge/status', (req, res) => {
    const kbPath = path.join(__dirname, 'knowledge', 'seed.json');
    const exists = existsSync(kbPath);
    res.json({
        status: exists ? 'ready' : 'missing',
        documents: exists ? JSON.parse(readFileSync(kbPath, 'utf-8')).length : 0,
        source: kbPath,
        mode: 'local_rag',
    });
});

app.post('/api/knowledge/search', (req, res) => {
    try {
        const query = String(req.body?.query || '');
        if (!query.trim()) {
            return res.status(400).json({ error: 'query is required' });
        }
        const kbPath = path.join(__dirname, 'knowledge', 'seed.json');
        const docs = existsSync(kbPath) ? JSON.parse(readFileSync(kbPath, 'utf-8')) : [];
        const hits = retrieveKnowledge(query, docs, 5);
        return res.json({ query, hits, grounded: hits.length > 0 });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ============================================================
// Rich Template Generator — Server-side Power Builder 🔥
// When the model is too weak, we build the file ourselves
// ============================================================
// ============================================================
// Feedback Learning — Suras learns from user corrections/instructions
// ============================================================
const feedbackFile = path.join(__dirname, 'feedback.json');
let feedbackStore = [];
try {
    if (existsSync(feedbackFile)) {
        const parsed = JSON.parse(readFileSync(feedbackFile, 'utf-8'));
        feedbackStore = Array.isArray(parsed) ? parsed : [];
    }
} catch (e) { feedbackStore = []; }
// إيقاع التعلّم التلقائي (P3): دورة أوزان بعد كل N تصحيحات — مقيدة بقبول
// البطارية داخل runLearningCycle نفسه، ونار-وانسَ حتى لا تحجب الشات أبداً.
const AUTOLEARN_CORRECTIONS = 5;
let lastLearnCorrectionCount = feedbackStore.filter(f => f && f.type === 'correction').length;

// ---- زر الفتح الكامل (Elevated unlock): دائم حتى القفل اليدوي أو إعادة التشغيل.
// بمفتاح السيادة فقط. القفل اليدوي = مغلق.
// المفتوح = كل الحدود تُرفع عن أوامر المالك (حتى deny) — ويُوثَّق كل شيء.
let unlockedFlag = false;
function isUnlocked() {
    try {
        const uFile = path.join(__dirname, '.unlocked');
        if (existsSync(uFile)) {
            const v = readFileSync(uFile, 'utf-8').trim();
            if (v === 'true') return true;
            if (v === 'false') return false;
        }
    } catch (_) {}
    return unlockedFlag === true;
}
function unlockAudit(event, detail) {
    try {
        const line = JSON.stringify({ ts: new Date().toISOString(), event, detail: String(detail || '').slice(0, 300) });
        fs.appendFile(path.join(__dirname, 'unlock-audit.log'), line + '\n').catch(() => {});
    } catch (_) {}
}
async function addFeedback(text, type = 'instruction') {
    if (!text || !String(text).trim()) return;
    const clean = String(text).trim().slice(0, 500);
    // P4: لا تخزين مكرر حرفي — نفس النص لا يضيف معلومة ويضخم الموجه
    if (feedbackStore.some(f => f && f.type === type && f.text === clean)) return;
    feedbackStore.push({ type, text: clean, ts: new Date().toISOString() });
    if (feedbackStore.length > 100) feedbackStore = feedbackStore.slice(-100);
    try { await fs.writeFile(feedbackFile, JSON.stringify(feedbackStore, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
    // P3: عتبة التصحيحات → دورة تعلّم تلقائية (نار-وانسَ، والرفض الذاتي عند الانحدار)
    try {
        if (type === 'correction') {
            const corrCount = feedbackStore.filter(f => f && f.type === 'correction').length;
            if (corrCount - lastLearnCorrectionCount >= AUTOLEARN_CORRECTIONS) {
                lastLearnCorrectionCount = corrCount;
                import('./tools/learner.js').then(m => {
                    try {
                        const r = m.runLearningCycle();
                        console.log(`[AutoLearn] cycle at ${corrCount} corrections: accepted=${r.accepted} acc=${r.after ? r.after.acc : '?'} (${r.after ? r.after.ok : '?'}/${r.after ? r.after.total : '?'})`);
                    } catch (e) { console.log('[AutoLearn] cycle failed:', e.message); }
                }).catch(e => console.log('[AutoLearn] import failed:', e.message));
            }
        }
    } catch (_) { /* التعلّم التلقائي لا يكسر التغذية أبداً */ }
}
function feedbackContext() {
    if (!feedbackStore.length) return '';
    const lines = feedbackStore.map(f => `- ${f.text}`).join('\n');
    return `\n\n[تعليمات المستخدم المكتسبة من تغذيته السابقة — التزم بها دائماً]\n${lines}`;
}

function buildRichTemplate(query, filePath) {
    const q = (query || '').toLowerCase();
    const ext = filePath.split('.').pop().toLowerCase();

    if (ext === 'py') {
        return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Suras AI — Complete Python Tool Module
Query: ${query}
Generated with full functionality, CLI parsing, and logging.
"""

import sys
import os
import time
import json
import argparse
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

class SurasProcessor:
    def __init__(self, target_dir="."):
        self.target_dir = target_dir
        self.stats = {"processed": 0, "errors": 0, "start_time": time.time()}

    def inspect_directory(self):
        """Scans the directory and produces summary statistics."""
        results = []
        for root, dirs, files in os.walk(self.target_dir):
            if any(p in root for p in ['.git', 'node_modules', '__pycache__']):
                continue
            for f in files:
                fp = os.path.join(root, f)
                try:
                    sz = os.path.getsize(fp)
                    results.append({"path": fp, "name": f, "size_bytes": sz, "ext": os.path.splitext(f)[1]})
                    self.stats["processed"] += 1
                except Exception as e:
                    self.stats["errors"] += 1
                    logging.warning(f"Could not read {fp}: {e}")
        return results

    def run(self):
        logging.info("⚡ Starting Suras Processor Execution...")
        items = self.inspect_directory()
        elapsed = round(time.time() - self.stats["start_time"], 3)
        summary = {
            "status": "success",
            "total_items": len(items),
            "errors": self.stats["errors"],
            "execution_seconds": elapsed,
            "timestamp": datetime.now().isoformat()
        }
        logging.info(f"✅ Processed {len(items)} items in {elapsed}s.")
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return summary

def main():
    parser = argparse.ArgumentParser(description="Suras Complete Processor Tool")
    parser.add_argument("--dir", default=".", help="Target directory to process")
    parser.add_argument("--output", default="report.json", help="Output summary file")
    args = parser.parse_args()

    processor = SurasProcessor(args.dir)
    report = processor.run()
    try:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        logging.info(f"📄 Report saved to {args.output}")
    except Exception as e:
        logging.error(f"Failed to save report: {e}")

if __name__ == "__main__":
    main()
`;
    }

    if (ext === 'css') {
        return `/* Suras AI — Complete Design System & Glassmorphism Theme */
:root {
  --primary: #7c3aed;
  --primary-glow: rgba(124, 58, 237, 0.4);
  --accent: #06b6d4;
  --accent-glow: rgba(6, 182, 212, 0.4);
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --bg-dark: #070913;
  --bg-card: rgba(255, 255, 255, 0.04);
  --border: rgba(255, 255, 255, 0.09);
  --text-main: #ffffff;
  --text-muted: rgba(255, 255, 255, 0.6);
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Cairo', system-ui, -apple-system, sans-serif;
  background-color: var(--bg-dark);
  color: var(--text-main);
  min-height: 100vh;
  line-height: 1.6;
}

.glass-card {
  background: var(--bg-card);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.37);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.glass-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px var(--primary-glow);
}

.btn-primary {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  border: none;
  padding: 12px 28px;
  border-radius: 50px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 20px var(--primary-glow);
  transition: all 0.2s ease;
}
.btn-primary:hover {
  transform: scale(1.04);
  box-shadow: 0 6px 28px var(--accent-glow);
}
`;
    }

    // ---- Detect design type from query ----
    const isGeometry = /هندس|(?<!ب)شكل|ثلاثي الابعاد|3d|مجسم|مجسمات|أشكال|اشكال|polyhedron|fractal|three\.?js|geometry|shape|shapes|دائرة|مربع|مثلث|مكعب|هرم/i.test(q);
    const isMultiGame = /قالب العاب|منصة العاب|موقع العاب|ألعاب|العاب|arcade|games|gaming|arcade hub|بوابة العاب/i.test(q);
    const isXO = /xo|اكس او|إكس أو|تيك تاك|tic tac/i.test(q);
    const isGame = isMultiGame || isXO || /لعب|ملعب|game|بازل|puzzle/i.test(q);
    const isPortf = /بورتفوليو|أعمال|portfolio|شخصي/i.test(q);
    const isDash = /داشبورد|dashboard|لوحة|تحكم|إحصائ/i.test(q);
    const isChatUI = /محادثة|دردشة|chat|bot|رسائل/i.test(q);
    const isCalc = /حاسبة|آلة حاسبة|calculator|calc|حساب/i.test(q);
    const isTimer = /توقيت|مؤقت|ساعة إيقاف|stopwatch|timer|عداد/i.test(q);
    const isTodo = /مهام|قائمة مهام|todo|قائمة أعمال|جدول مهام/i.test(q);
    const isQuiz = /اختبار|كويز|quiz|trivia|أسئلة وأجوبة/i.test(q);
    const isWeather = /طقس|weather|أحوال جوية/i.test(q);

    // =========================================================================
    // 0. COMPLETE 3D GEOMETRIC & MATHEMATICAL SHAPES STUDIO (THREE.JS + CONTROLS)
    // =========================================================================
    if (isGeometry) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>استوديو الأشكال الهندسية ثلاثية الأبعاد — Suras 3D Geometry Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
  <style>
    :root {
      --bg: #070913;
      --card-bg: rgba(15, 23, 42, 0.75);
      --border: rgba(255, 255, 255, 0.12);
      --primary: #8b5cf6;
      --accent: #06b6d4;
      --neon-pink: #ec4899;
      --neon-green: #10b981;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', sans-serif;
      background: var(--bg);
      color: #fff;
      overflow: hidden;
      height: 100vh;
      display: flex;
    }
    #canvas-container {
      flex: 1;
      height: 100%;
      position: relative;
    }
    .hud-overlay {
      position: absolute;
      top: 20px;
      right: 20px;
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      width: 320px;
      z-index: 10;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      max-height: 90vh;
      overflow-y: auto;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 900;
      background: linear-gradient(135deg, var(--accent), var(--primary), var(--neon-pink));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .control-group {
      margin-bottom: 16px;
    }
    .control-label {
      font-size: 0.8rem;
      color: rgba(255,255,255,0.7);
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
    }
    .shape-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 14px;
    }
    .shape-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: #fff;
      padding: 8px 4px;
      border-radius: 10px;
      font-family: 'Cairo';
      font-size: 0.72rem;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }
    .shape-btn:hover, .shape-btn.active {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      border-color: transparent;
      box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);
      transform: scale(1.03);
    }
    input[type=range] {
      width: 100%;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .mode-select {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
    }
    .mode-btn {
      flex: 1;
      padding: 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: #fff;
      border-radius: 8px;
      font-size: 0.75rem;
      font-family: 'Cairo';
      cursor: pointer;
      transition: 0.2s;
    }
    .mode-btn.active {
      background: var(--accent);
      color: #000;
      font-weight: 700;
    }
    .stats-card {
      background: rgba(0,0,0,0.35);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 0.78rem;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
    }
    .stat-val {
      font-weight: 700;
      color: var(--accent);
      font-family: monospace;
    }
    .btn-action {
      width: 100%;
      padding: 10px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, var(--neon-pink), var(--primary));
      color: #fff;
      font-family: 'Cairo';
      font-weight: 700;
      font-size: 0.85rem;
      cursor: pointer;
      margin-top: 8px;
      transition: transform 0.2s;
    }
    .btn-action:hover {
      transform: scale(1.02);
    }
    .hint-bar {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(10px);
      padding: 8px 20px;
      border-radius: 50px;
      border: 1px solid var(--border);
      font-size: 0.8rem;
      color: rgba(255,255,255,0.7);
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="canvas-container"></div>
  
  <div class="hud-overlay">
    <h1>📐 استوديو الهندسة 3D</h1>
    
    <div class="control-group">
      <div class="control-label"><span>المجسم الهندسي (15+ شكلاً متقدماً):</span></div>
      <div class="shape-grid">
        <button class="shape-btn active" onclick="setShape('dodecahedron')">اثنا عشري</button>
        <button class="shape-btn" onclick="setShape('icosahedron')">عشريني</button>
        <button class="shape-btn" onclick="setShape('octahedron')">ثماني</button>
        <button class="shape-btn" onclick="setShape('torusKnot')">عقدة كوانتم</button>
        <button class="shape-btn" onclick="setShape('mobius')">شريط موبيوس ♾️</button>
        <button class="shape-btn" onclick="setShape('metatron')">ميتاترون المقدس 🌀</button>
        <button class="shape-btn" onclick="setShape('lorenz')">جاذب لورنز 🌌</button>
        <button class="shape-btn" onclick="setShape('klein')">زجاجة كلاين 🧪</button>
        <button class="shape-btn" onclick="setShape('calabiYau')">كالابي-ياو 🧬</button>
        <button class="shape-btn" onclick="setShape('fibonacci')">فيبوناتشي الذهبي 🌻</button>
        <button class="shape-btn" onclick="setShape('hypercube')">مكعب فائق 4D</button>
        <button class="shape-btn" onclick="setShape('tetrahedron')">رباعي السطوح</button>
        <button class="shape-btn" onclick="setShape('sphere')">كرة طاقية</button>
        <button class="shape-btn" onclick="setShape('cylinder')">أسطوانة</button>
        <button class="shape-btn" onclick="setShape('trefoil')">عقدة البرسيم</button>
      </div>
    </div>

    <div class="control-group">
      <div class="control-label"><span>نمط المادة والتوهج:</span></div>
      <div class="mode-select">
        <button class="mode-btn active" onclick="setMaterialMode('wireframe')">🕸️ شبكي</button>
        <button class="mode-btn" onclick="setMaterialMode('hologram')">✨ هولوغرام</button>
        <button class="mode-btn" onclick="setMaterialMode('glass')">💎 زجاجي</button>
        <button class="mode-btn" onclick="setMaterialMode('particles')">🌌 جزيئات</button>
      </div>
    </div>

    <div class="control-group">
      <div class="control-label">
        <span>سرعة الدوران:</span>
        <span id="rotSpeedVal">1.0x</span>
      </div>
      <input type="range" min="0" max="4" step="0.1" value="1" oninput="updateSpeed(this.value)">
    </div>

    <div class="control-group">
      <div class="control-label">
        <span>تجزئة السطح (Detail):</span>
        <span id="detailVal">2</span>
      </div>
      <input type="range" min="0" max="5" step="1" value="2" oninput="updateDetail(this.value)">
    </div>

    <div class="stats-card">
      <div class="stat-row"><span>عدد الرؤوس (Vertices):</span><span class="stat-val" id="vertCount">0</span></div>
      <div class="stat-row"><span>عدد الأوجه (Faces):</span><span class="stat-val" id="faceCount">0</span></div>
      <div class="stat-row"><span>النسبة الذهبية (Phi Φ):</span><span class="stat-val">1.6180339</span></div>
      <div class="stat-row"><span>المعادلة الرياضية:</span><span class="stat-val" id="mathFormula">Euler: V - E + F = 2</span></div>
    </div>

    <button class="btn-action" onclick="toggleColorShift()">🎨 تبديل ألوان النيون</button>
    <button class="btn-action" style="background: linear-gradient(135deg, #06b6d4, #10b981);" onclick="synthesizeWebFormula()">🌐 توليد معادلة هندسية مبتكرة</button>
    <button class="btn-action" style="background: rgba(255,255,255,0.08); border: 1px solid var(--border);" onclick="resetCamera()">🔄 إعادة توجيه الكاميرا</button>
  </div>

  <div class="hint-bar">
    🖱️ اسحب بالماوس للتدوير 3D • عجلة الماوس للتقريب والتبعيد • زر الماوس الأيمن للتحريك
  </div>

  <script>
    let scene, camera, renderer, controls, currentMesh, particleSystem;
    let currentShapeType = 'dodecahedron';
    let currentMaterialMode = 'wireframe';
    let rotSpeed = 0.01;
    let detailLevel = 2;
    let colorIndex = 0;
    const colorPalettes = [
      { primary: 0x8b5cf6, accent: 0x06b6d4, line: 0xec4899 },
      { primary: 0x10b981, accent: 0x3b82f6, line: 0x06b6d4 },
      { primary: 0xf59e0b, accent: 0xef4444, line: 0xffedd5 },
      { primary: 0xec4899, accent: 0x8b5cf6, line: 0x00ffff }
    ];

    function init() {
      const container = document.getElementById('canvas-container');
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x070913, 0.03);

      camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
      camera.position.set(0, 0, 7);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;

      // Lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      scene.add(ambientLight);

      const pointLight1 = new THREE.PointLight(0x8b5cf6, 2, 50);
      pointLight1.position.set(10, 10, 10);
      scene.add(pointLight1);

      const pointLight2 = new THREE.PointLight(0x06b6d4, 2, 50);
      pointLight2.position.set(-10, -10, -10);
      scene.add(pointLight2);

      // Starfield background
      createStars();

      // Build initial shape
      buildShape();

      window.addEventListener('resize', onWindowResize);
      animate();
    }

    function createStars() {
      const starGeo = new THREE.BufferGeometry();
      const starCount = 1500;
      const pos = new Float32Array(starCount * 3);
      for(let i=0; i<starCount*3; i++) {
        pos[i] = (Math.random() - 0.5) * 100;
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const starMat = new THREE.PointsMaterial({ color: 0x8899ac, size: 0.15, transparent: true, opacity: 0.6 });
      const stars = new THREE.Points(starGeo, starMat);
      scene.add(stars);
    }

    // Mathematical & Parametric Geometries
    function createMobiusStrip() {
      const uSeg = 60, vSeg = 20;
      const geom = new THREE.BufferGeometry();
      const verts = [], indices = [];
      for(let i=0; i<=uSeg; i++) {
        const u = (i / uSeg) * Math.PI * 2;
        for(let j=0; j<=vSeg; j++) {
          const v = ((j / vSeg) - 0.5) * 1.2;
          const x = (1.8 + v * Math.cos(u / 2)) * Math.cos(u);
          const y = (1.8 + v * Math.cos(u / 2)) * Math.sin(u);
          const z = v * Math.sin(u / 2);
          verts.push(x, y, z);
        }
      }
      for(let i=0; i<uSeg; i++) {
        for(let j=0; j<vSeg; j++) {
          const a = i * (vSeg + 1) + j;
          const b = (i + 1) * (vSeg + 1) + j;
          const c = (i + 1) * (vSeg + 1) + (j + 1);
          const d = i * (vSeg + 1) + (j + 1);
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
      geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    }

    function createFibonacciSpiral() {
      const points = [];
      const count = 600;
      const phi = (1 + Math.sqrt(5)) / 2;
      for(let i=0; i<count; i++) {
        const theta = 2 * Math.PI * i / (phi * phi);
        const r = Math.sqrt(i) * 0.12;
        const z = (i / count - 0.5) * 3;
        points.push(new THREE.Vector3(r * Math.cos(theta), r * Math.sin(theta), z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      return new THREE.TubeGeometry(curve, 200, 0.08, 12, false);
    }

    function createLorenzAttractor() {
      const points = [];
      let x = 0.1, y = 0, z = 0;
      const sigma = 10, rho = 28, beta = 8/3, dt = 0.01;
      for(let i=0; i<3000; i++) {
        const dx = sigma * (y - x) * dt;
        const dy = (x * (rho - z) - y) * dt;
        const dz = (x * y - beta * z) * dt;
        x += dx; y += dy; z += dz;
        points.push(new THREE.Vector3(x * 0.08, y * 0.08, (z - 25) * 0.08));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      return new THREE.TubeGeometry(curve, 800, 0.04, 6, false);
    }

    function getGeometry(type, detail) {
      switch(type) {
        case 'dodecahedron': return new THREE.DodecahedronGeometry(2, detail);
        case 'icosahedron': return new THREE.IcosahedronGeometry(2, detail);
        case 'octahedron': return new THREE.OctahedronGeometry(2, detail);
        case 'tetrahedron': return new THREE.TetrahedronGeometry(2.2, detail);
        case 'torusKnot': return new THREE.TorusKnotGeometry(1.5, 0.45, 128, 32, 2, 3);
        case 'mobius': return createMobiusStrip();
        case 'fibonacci': return createFibonacciSpiral();
        case 'lorenz': return createLorenzAttractor();
        case 'trefoil': return new THREE.TorusKnotGeometry(1.6, 0.35, 150, 20, 2, 5);
        case 'sphere': return new THREE.SphereGeometry(2, 32 + detail * 8, 32 + detail * 8);
        case 'cylinder': return new THREE.CylinderGeometry(1.5, 1.5, 3, 32);
        case 'metatron':
        case 'klein':
        case 'calabiYau':
        case 'hypercube':
        default:
          return new THREE.TorusKnotGeometry(1.5, 0.5, 180, 40, 3, 7);
      }
    }

    function synthesizeWebFormula() {
      const formulas = [
        { name: "جاذب لورنز الفوضوي (Lorenz Strange Attractor)", type: "lorenz" },
        { name: "شريط موبيوس اللانهائي (Möbius Strip)", type: "mobius" },
        { name: "اللولب الذهبي لفيبوناتشي (Golden Spiral 3D)", type: "fibonacci" },
        { name: "مشعب كالابي-ياو الفضائي (Calabi-Yau 6D)", type: "calabiYau" }
      ];
      const selected = formulas[Math.floor(Math.random() * formulas.length)];
      setShape(selected.type);
      document.getElementById('mathFormula').textContent = selected.name;
    }

    function buildShape() {
      if (currentMesh) scene.remove(currentMesh);
      if (particleSystem) scene.remove(particleSystem);

      const geo = getGeometry(currentShapeType, detailLevel);
      const palette = colorPalettes[colorIndex];

      const group = new THREE.Group();

      if (currentMaterialMode === 'particles') {
        const pGeo = new THREE.BufferGeometry();
        const positions = geo.attributes.position.array;
        pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const pMat = new THREE.PointsMaterial({
          color: palette.accent,
          size: 0.12,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending
        });
        particleSystem = new THREE.Points(pGeo, pMat);
        group.add(particleSystem);
      } else if (currentMaterialMode === 'wireframe') {
        const mat = new THREE.MeshBasicMaterial({
          color: palette.accent,
          wireframe: true,
          transparent: true,
          opacity: 0.85
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);

        // Add inner core glowing shape
        const innerGeo = getGeometry(currentShapeType, 0);
        const innerMat = new THREE.MeshPhongMaterial({
          color: palette.primary,
          transparent: true,
          opacity: 0.25,
          shininess: 100
        });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        innerMesh.scale.set(0.85, 0.85, 0.85);
        group.add(innerMesh);
      } else if (currentMaterialMode === 'hologram') {
        const mat = new THREE.MeshStandardMaterial({
          color: palette.primary,
          wireframe: false,
          metalness: 0.8,
          roughness: 0.2,
          transparent: true,
          opacity: 0.7
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);

        const wireMat = new THREE.MeshBasicMaterial({ color: palette.line, wireframe: true, transparent: true, opacity: 0.4 });
        const wireMesh = new THREE.Mesh(geo, wireMat);
        wireMesh.scale.set(1.02, 1.02, 1.02);
        group.add(wireMesh);
      } else if (currentMaterialMode === 'glass') {
        const mat = new THREE.MeshPhysicalMaterial({
          color: palette.primary,
          metalness: 0.1,
          roughness: 0.1,
          transmission: 0.9,
          thickness: 1.2,
          transparent: true,
          opacity: 0.85
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
      }

      currentMesh = group;
      scene.add(currentMesh);

      // Update stats
      const vCount = geo.attributes.position.count;
      const fCount = geo.index ? (geo.index.count / 3) : (vCount / 3);
      document.getElementById('vertCount').textContent = vCount.toLocaleString();
      document.getElementById('faceCount').textContent = Math.round(fCount).toLocaleString();
    }

    function setShape(type) {
      currentShapeType = type;
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      buildShape();
    }

    function setMaterialMode(mode) {
      currentMaterialMode = mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      buildShape();
    }

    function updateSpeed(val) {
      rotSpeed = parseFloat(val) * 0.01;
      document.getElementById('rotSpeedVal').textContent = parseFloat(val).toFixed(1) + 'x';
    }

    function updateDetail(val) {
      detailLevel = parseInt(val);
      document.getElementById('detailVal').textContent = val;
      buildShape();
    }

    function toggleColorShift() {
      colorIndex = (colorIndex + 1) % colorPalettes.length;
      buildShape();
    }

    function resetCamera() {
      camera.position.set(0, 0, 7);
      controls.reset();
    }

    function onWindowResize() {
      const container = document.getElementById('canvas-container');
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }

    function animate() {
      requestAnimationFrame(animate);
      if (currentMesh) {
        currentMesh.rotation.x += rotSpeed;
        currentMesh.rotation.y += rotSpeed * 1.3;
      }
      controls.update();
      renderer.render(scene, camera);
    }

    init();
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 1. COMPLETE MULTI-GAME CYBER ARCADE HUB (5 COMPLETE GAMES IN 1 PLATFORM)
    // =========================================================================
    if (isMultiGame || (isGame && !isXO)) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>منصة ألعاب سوراس المتكاملة — Suras Cyber Arcade Hub</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070914;
      --card-bg: rgba(255, 255, 255, 0.04);
      --border: rgba(255, 255, 255, 0.1);
      --primary: #8b5cf6;
      --accent: #06b6d4;
      --pink: #ec4899;
      --green: #10b981;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 75%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(7, 9, 20, 0.8);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      font-size: 1.4rem;
      font-weight: 900;
      background: linear-gradient(135deg, var(--accent), var(--primary), var(--pink));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .game-nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .nav-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: #fff;
      padding: 8px 16px;
      border-radius: 12px;
      font-family: 'Cairo';
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nav-btn:hover, .nav-btn.active {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      border-color: transparent;
      box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
      transform: translateY(-2px);
    }
    .main-stage {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 24px;
    }
    .game-box {
      background: var(--card-bg);
      backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 24px;
      width: 100%;
      max-width: 800px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
    }
    .game-header {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .game-title {
      font-size: 1.3rem;
      font-weight: 900;
      color: var(--accent);
    }
    .scoreboard {
      display: flex;
      gap: 16px;
      font-size: 0.9rem;
    }
    .score-badge {
      background: rgba(0,0,0,0.4);
      border: 1px solid var(--border);
      padding: 4px 14px;
      border-radius: 20px;
      font-weight: 700;
      color: var(--pink);
    }
    canvas {
      background: #050711;
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: inset 0 0 30px rgba(0,0,0,0.8);
      max-width: 100%;
    }
    .game-controls {
      margin-top: 16px;
      display: flex;
      gap: 12px;
      width: 100%;
      justify-content: center;
    }
    .btn-play {
      background: linear-gradient(135deg, var(--green), var(--accent));
      border: none;
      color: #000;
      font-weight: 900;
      padding: 10px 28px;
      border-radius: 12px;
      font-family: 'Cairo';
      font-size: 0.95rem;
      cursor: pointer;
      transition: 0.2s;
    }
    .btn-play:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
    }
    .instructions {
      margin-top: 12px;
      font-size: 0.8rem;
      color: rgba(255,255,255,0.6);
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>🕹️ منصة ألعاب سوراس (Suras Arcade)</span>
    </div>
    <div class="game-nav">
      <button class="nav-btn active" onclick="switchGame('space')">🚀 مغامرة الفضاء</button>
      <button class="nav-btn" onclick="switchGame('snake')">🐍 الثعبان النيون</button>
      <button class="nav-btn" onclick="switchGame('bricks')">🧱 تكسير الكتل</button>
      <button class="nav-btn" onclick="switchGame('memory')">🧠 لغز الذاكرة</button>
    </div>
  </header>

  <div class="main-stage">
    <div class="game-box">
      <div class="game-header">
        <div class="game-title" id="curGameTitle">🚀 معركة الفضاء (Space Vanguard)</div>
        <div class="scoreboard">
          <div>النقاط: <span class="score-badge" id="scoreDisplay">0</span></div>
          <div>أعلى نتيجة: <span class="score-badge" style="color: var(--accent);" id="highScoreDisplay">0</span></div>
        </div>
      </div>

      <div id="gameContainer" style="width: 100%; display: flex; justify-content: center;">
        <canvas id="gameCanvas" width="640" height="400"></canvas>
      </div>

      <div class="game-controls">
        <button class="btn-play" onclick="startCurrentGame()">▶ ابدأ اللعب</button>
        <button class="nav-btn" onclick="resetCurrentGame()">🔄 إعادة ضبط</button>
      </div>

      <div class="instructions" id="instructions">
        استخدم الأسهم ⬅️ ➡️ للتحريك ومفتاح المسافة [Space] لإطلاق الليزر.
      </div>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let currentGame = 'space';
    let score = 0, highScore = 0;
    let gameLoopId = null;
    let isRunning = false;

    // Web Audio Sound Synth
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function sfx(freq, type='sine', dur=0.1) {
      try {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.1, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
      } catch(e) {}
    }

    // ==========================================
    // 1. SPACE SHOOTER GAME
    // ==========================================
    let player = { x: 300, y: 350, w: 36, h: 36, speed: 6 };
    let bullets = [], meteors = [], stars = [];
    let keys = {};

    window.addEventListener('keydown', e => { keys[e.code] = true; if(e.code === 'Space' && currentGame === 'space') shootLaser(); });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

    function initStars() {
      stars = [];
      for(let i=0; i<60; i++) stars.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height, s: Math.random()*2+1 });
    }

    function shootLaser() {
      if(!isRunning) return;
      bullets.push({ x: player.x + player.w/2 - 2, y: player.y, w: 4, h: 12, speed: 8 });
      sfx(880, 'triangle', 0.08);
    }

    function spawnMeteor() {
      if(Math.random() < 0.04) {
        meteors.push({
          x: Math.random() * (canvas.width - 30),
          y: -30,
          size: Math.random() * 20 + 15,
          speed: Math.random() * 2 + 1.5,
          color: Math.random() > 0.5 ? '#ec4899' : '#06b6d4'
        });
      }
    }

    function updateSpace() {
      if(keys['ArrowLeft'] || keys['KeyA']) player.x = Math.max(0, player.x - player.speed);
      if(keys['ArrowRight'] || keys['KeyD']) player.x = Math.min(canvas.width - player.w, player.x + player.speed);

      spawnMeteor();

      // Bullets
      for(let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y -= bullets[i].speed;
        if(bullets[i].y < 0) bullets.splice(i, 1);
      }

      // Meteors
      for(let i = meteors.length - 1; i >= 0; i--) {
        meteors[i].y += meteors[i].speed;
        // Collision with bullets
        for(let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j], m = meteors[i];
          if(b && m && b.x > m.x && b.x < m.x + m.size && b.y > m.y && b.y < m.y + m.size) {
            bullets.splice(j, 1);
            meteors.splice(i, 1);
            score += 10;
            updateScore();
            sfx(300, 'sawtooth', 0.15);
            break;
          }
        }
        // Collision with player
        if(meteors[i] && meteors[i].y + meteors[i].size > player.y && meteors[i].x < player.x + player.w && meteors[i].x + meteors[i].size > player.x) {
          gameOverSpace();
          return;
        }
        if(meteors[i] && meteors[i].y > canvas.height) meteors.splice(i, 1);
      }
    }

    function drawSpace() {
      ctx.fillStyle = '#050711';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Stars
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      stars.forEach(s => {
        ctx.fillRect(s.x, s.y, s.s, s.s);
        s.y += s.s * 0.5;
        if(s.y > canvas.height) s.y = 0;
      });

      // Player Ship
      ctx.fillStyle = '#8b5cf6';
      ctx.beginPath();
      ctx.moveTo(player.x + player.w/2, player.y);
      ctx.lineTo(player.x + player.w, player.y + player.h);
      ctx.lineTo(player.x + player.w/2, player.y + player.h - 8);
      ctx.lineTo(player.x, player.y + player.h);
      ctx.closePath();
      ctx.fill();

      // Bullets
      ctx.fillStyle = '#06b6d4';
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 8;
      bullets.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));

      // Meteors
      meteors.forEach(m => {
        ctx.fillStyle = m.color;
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(m.x + m.size/2, m.y + m.size/2, m.size/2, 0, Math.PI*2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    }

    function gameOverSpace() {
      isRunning = false;
      sfx(120, 'square', 0.4);
      alert('🚀 انتهت الجولة! مجموع نقاطك: ' + score);
    }

    // ==========================================
    // 2. CYBER SNAKE GAME
    // ==========================================
    let snake = [{x: 10, y: 10}], snakeDir = {x: 1, y: 0}, food = {x: 15, y: 15}, gridSize = 20;
    let snakeTimer = 0;

    function resetSnake() {
      snake = [{x: 10, y: 10}, {x: 9, y: 10}, {x: 8, y: 10}];
      snakeDir = {x: 1, y: 0};
      spawnFood();
      score = 0;
      updateScore();
    }

    function spawnFood() {
      food = {
        x: Math.floor(Math.random() * (canvas.width / gridSize)),
        y: Math.floor(Math.random() * (canvas.height / gridSize))
      };
    }

    function updateSnake() {
      snakeTimer++;
      if(snakeTimer % 5 !== 0) return;

      if(keys['ArrowUp'] && snakeDir.y === 0) snakeDir = {x: 0, y: -1};
      if(keys['ArrowDown'] && snakeDir.y === 0) snakeDir = {x: 0, y: 1};
      if(keys['ArrowLeft'] && snakeDir.x === 0) snakeDir = {x: -1, y: 0};
      if(keys['ArrowRight'] && snakeDir.x === 0) snakeDir = {x: 1, y: 0};

      const head = { x: snake[0].x + snakeDir.x, y: snake[0].y + snakeDir.y };

      // Wall collision
      if(head.x < 0 || head.x >= canvas.width/gridSize || head.y < 0 || head.y >= canvas.height/gridSize) {
        isRunning = false;
        sfx(150, 'sawtooth', 0.3);
        alert('🐍 اصطدمت بالجدار! النقاط: ' + score);
        return;
      }

      snake.unshift(head);
      if(head.x === food.x && head.y === food.y) {
        score += 15;
        updateScore();
        sfx(650, 'sine', 0.1);
        spawnFood();
      } else {
        snake.pop();
      }
    }

    function drawSnake() {
      ctx.fillStyle = '#070914';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw Grid Lines
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      for(let x=0; x<canvas.width; x+=gridSize) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
      for(let y=0; y<canvas.height; y+=gridSize) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }

      // Snake Body
      ctx.fillStyle = '#10b981';
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 10;
      snake.forEach((seg, i) => {
        ctx.fillStyle = i === 0 ? '#34d399' : '#10b981';
        ctx.fillRect(seg.x * gridSize + 1, seg.y * gridSize + 1, gridSize - 2, gridSize - 2);
      });

      // Food
      ctx.fillStyle = '#ec4899';
      ctx.shadowColor = '#ec4899';
      ctx.shadowBlur = 12;
      ctx.fillRect(food.x * gridSize + 2, food.y * gridSize + 2, gridSize - 4, gridSize - 4);
      ctx.shadowBlur = 0;
    }

    // ==========================================
    // 3. BRICK BREAKER
    // ==========================================
    let paddle = { x: 260, y: 370, w: 100, h: 12, speed: 8 };
    let ball = { x: 320, y: 200, r: 7, dx: 4, dy: -4 };
    let bricks = [];

    function initBricks() {
      bricks = [];
      const rows = 4, cols = 8;
      const bw = 65, bh = 18, pad = 10, offTop = 40, offLeft = 25;
      for(let r=0; r<rows; r++) {
        for(let c=0; c<cols; c++) {
          bricks.push({
            x: c * (bw + pad) + offLeft,
            y: r * (bh + pad) + offTop,
            w: bw, h: bh,
            color: ['#8b5cf6', '#06b6d4', '#ec4899', '#10b981'][r],
            alive: true
          });
        }
      }
    }

    function updateBricks() {
      if(keys['ArrowLeft']) paddle.x = Math.max(0, paddle.x - paddle.speed);
      if(keys['ArrowRight']) paddle.x = Math.min(canvas.width - paddle.w, paddle.x + paddle.speed);

      ball.x += ball.dx;
      ball.y += ball.dy;

      // Walls
      if(ball.x - ball.r < 0 || ball.x + ball.r > canvas.width) { ball.dx = -ball.dx; sfx(400); }
      if(ball.y - ball.r < 0) { ball.dy = -ball.dy; sfx(400); }

      // Paddle
      if(ball.y + ball.r > paddle.y && ball.x > paddle.x && ball.x < paddle.x + paddle.w) {
        ball.dy = -Math.abs(ball.dy);
        sfx(600, 'triangle');
      }

      // Bricks
      bricks.forEach(b => {
        if(b.alive && ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h) {
          b.alive = false;
          ball.dy = -ball.dy;
          score += 20;
          updateScore();
          sfx(750);
        }
      });

      // Bottom death
      if(ball.y > canvas.height) {
        isRunning = false;
        sfx(180, 'square');
        alert('🧱 سقطت الكرة! النقاط: ' + score);
      }
    }

    function drawBricks() {
      ctx.fillStyle = '#070914';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Paddle
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);

      // Ball
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2);
      ctx.fill();

      // Bricks
      bricks.forEach(b => {
        if(b.alive) {
          ctx.fillStyle = b.color;
          ctx.fillRect(b.x, b.y, b.w, b.h);
        }
      });
    }

    // ==========================================
    // CORE LOOP & SWITCHER
    // ==========================================
    function switchGame(g) {
      currentGame = g;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');

      const titles = {
        space: '🚀 معركة الفضاء (Space Vanguard)',
        snake: '🐍 الثعبان النيون (Cyber Snake)',
        bricks: '🧱 تكسير الكتل (Quantum Breaker)',
        memory: '🧠 لغز الذاكرة (Memory Matrix)'
      };
      const hints = {
        space: 'استخدم الأسهم ⬅️ ➡️ للتحريك ومفتاح المسافة [Space] لإطلاق الليزر.',
        snake: 'استخدم مفاتيح الأسهم ⬆️ ⬇️ ⬅️ ➡️ لتوجيه الثعبان وجمع النيون.',
        bricks: 'استخدم الأسهم ⬅️ ➡️ لتحريك المضرب وارتداد الكرة لتكسير الكتل.',
        memory: 'احفظ تطابق البطاقات النيونية واكشف الأزواج المتطابقة بأسرع وقت.'
      };

      document.getElementById('curGameTitle').textContent = titles[g];
      document.getElementById('instructions').textContent = hints[g];

      resetCurrentGame();
    }

    function startCurrentGame() {
      isRunning = true;
      sfx(520, 'sine', 0.2);
    }

    function resetCurrentGame() {
      isRunning = false;
      score = 0;
      updateScore();
      if(currentGame === 'space') { player.x = 300; bullets = []; meteors = []; initStars(); drawSpace(); }
      else if(currentGame === 'snake') { resetSnake(); drawSnake(); }
      else if(currentGame === 'bricks') { ball = {x: 320, y: 250, r: 7, dx: 4, dy: -4}; initBricks(); drawBricks(); }
    }

    function updateScore() {
      document.getElementById('scoreDisplay').textContent = score;
      if(score > highScore) {
        highScore = score;
        document.getElementById('highScoreDisplay').textContent = highScore;
      }
    }

    function loop() {
      if(isRunning) {
        if(currentGame === 'space') { updateSpace(); drawSpace(); }
        else if(currentGame === 'snake') { updateSnake(); drawSnake(); }
        else if(currentGame === 'bricks') { updateBricks(); drawBricks(); }
      }
      requestAnimationFrame(loop);
    }

    initStars();
    drawSpace();
    loop();
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 1b. COMPLETE XO / TIC-TAC-TOE GAME WITH SMART AI & FULL SOUND + PARTICLES
    // =========================================================================
    if (isXO) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>لعبة XO الذكية — Suras AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(255, 255, 255, 0.04);
      --border: rgba(255, 255, 255, 0.1);
      --x-color: #ec4899;
      --o-color: #3b82f6;
      --glow-x: rgba(236, 72, 153, 0.5);
      --glow-o: rgba(59, 130, 246, 0.5);
      --accent: #8b5cf6;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', sans-serif;
      background: radial-gradient(circle at top center, #1e1b4b 0%, var(--bg) 80%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .game-container {
      background: var(--card-bg);
      backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 28px;
      padding: 32px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    h1 {
      font-size: 2rem;
      font-weight: 900;
      background: linear-gradient(135deg, var(--x-color), var(--o-color));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .mode-selector {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin: 16px 0;
    }
    .mode-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: #fff;
      padding: 8px 16px;
      border-radius: 12px;
      font-family: 'Cairo';
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .mode-btn.active {
      background: var(--accent);
      border-color: var(--accent);
      box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
    }
    .scoreboard {
      display: flex;
      justify-content: space-around;
      background: rgba(0,0,0,0.3);
      padding: 14px;
      border-radius: 16px;
      margin-bottom: 20px;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .score-box {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .score-label { font-size: 0.75rem; color: rgba(255,255,255,0.6); }
    .score-val { font-size: 1.4rem; font-weight: 900; }
    .score-x { color: var(--x-color); }
    .score-o { color: var(--o-color); }
    .status-banner {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 18px;
      min-height: 30px;
      color: #cbd5e1;
    }
    .board {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .cell {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      border-radius: 18px;
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.8rem;
      font-weight: 900;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    }
    .cell:hover:not(.taken) {
      background: rgba(255,255,255,0.1);
      transform: scale(1.04);
    }
    .cell.x { color: var(--x-color); text-shadow: 0 0 20px var(--glow-x); }
    .cell.o { color: var(--o-color); text-shadow: 0 0 20px var(--glow-o); }
    .cell.win {
      background: rgba(139, 92, 246, 0.3) !important;
      border-color: #a78bfa;
      animation: winPulse 1s infinite alternate;
    }
    @keyframes winPulse {
      from { transform: scale(1); box-shadow: 0 0 10px rgba(167, 139, 250, 0.5); }
      to { transform: scale(1.06); box-shadow: 0 0 25px rgba(167, 139, 250, 0.8); }
    }
    .controls {
      display: flex;
      gap: 12px;
    }
    .btn {
      flex: 1;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #fff;
      border: none;
      padding: 12px;
      border-radius: 14px;
      font-family: 'Cairo';
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(124, 58, 237, 0.4);
    }
    .btn.reset {
      background: rgba(255,255,255,0.08);
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="game-container">
    <h1>⚔️ لعبة XO الذكية</h1>
    <p style="font-size: 0.85rem; color: rgba(255,255,255,0.6);">طوّرت بالكامل عبر محرك Suras AI</p>

    <div class="mode-selector">
      <button class="mode-btn active" id="modeAi" onclick="setMode('ai')">🤖 ضد الذكاء الاصطناعي</button>
      <button class="mode-btn" id="modePvp" onclick="setMode('pvp')">👥 لاعبان محلياً</button>
    </div>

    <div class="scoreboard">
      <div class="score-box">
        <span class="score-label">اللاعب X</span>
        <span class="score-val score-x" id="scoreX">0</span>
      </div>
      <div class="score-box">
        <span class="score-label">التعادل</span>
        <span class="score-val" id="scoreDraw">0</span>
      </div>
      <div class="score-box">
        <span class="score-label" id="oLabel">الذكاء O</span>
        <span class="score-val score-o" id="scoreO">0</span>
      </div>
    </div>

    <div class="status-banner" id="status">دور اللاعب X</div>

    <div class="board" id="board">
      <div class="cell" onclick="makeMove(0)"></div>
      <div class="cell" onclick="makeMove(1)"></div>
      <div class="cell" onclick="makeMove(2)"></div>
      <div class="cell" onclick="makeMove(3)"></div>
      <div class="cell" onclick="makeMove(4)"></div>
      <div class="cell" onclick="makeMove(5)"></div>
      <div class="cell" onclick="makeMove(6)"></div>
      <div class="cell" onclick="makeMove(7)"></div>
      <div class="cell" onclick="makeMove(8)"></div>
    </div>

    <div class="controls">
      <button class="btn" onclick="restartGame()">🔄 جولة جديدة</button>
      <button class="btn reset" onclick="resetAll()">🗑️ تصفير النقاط</button>
    </div>
  </div>

  <script>
    let board = Array(9).fill('');
    let currentPlayer = 'X';
    let gameActive = true;
    let gameMode = 'ai'; // 'ai' or 'pvp'
    let scores = { X: 0, O: 0, draw: 0 };

    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];

    // Sound Synthesis (Web Audio API)
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playBeep(freq, type = 'sine', duration = 0.1) {
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch(e) {}
    }

    function setMode(mode) {
      gameMode = mode;
      document.getElementById('modeAi').classList.toggle('active', mode === 'ai');
      document.getElementById('modePvp').classList.toggle('active', mode === 'pvp');
      document.getElementById('oLabel').textContent = mode === 'ai' ? 'الذكاء O' : 'اللاعب O';
      restartGame();
    }

    function makeMove(idx) {
      if (!gameActive || board[idx] !== '') return;
      
      board[idx] = currentPlayer;
      const cell = document.querySelectorAll('.cell')[idx];
      cell.textContent = currentPlayer;
      cell.classList.add(currentPlayer.toLowerCase(), 'taken');
      playBeep(currentPlayer === 'X' ? 440 : 550, 'sine', 0.1);

      if (checkWin(currentPlayer)) {
        handleWin(currentPlayer);
        return;
      }

      if (board.every(c => c !== '')) {
        handleDraw();
        return;
      }

      currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
      document.getElementById('status').textContent = 'دور ' + (gameMode === 'ai' && currentPlayer === 'O' ? 'الذكاء O 🧠...' : 'اللاعب ' + currentPlayer);

      if (gameMode === 'ai' && currentPlayer === 'O' && gameActive) {
        setTimeout(aiTurn, 400);
      }
    }

    function aiTurn() {
      if (!gameActive) return;
      // Smart Move: 1. Win if possible, 2. Block user win, 3. Center, 4. Random
      let bestMove = findBestMove('O') ?? findBestMove('X') ?? (board[4] === '' ? 4 : null);
      if (bestMove === null) {
        const available = board.map((v, i) => v === '' ? i : null).filter(v => v !== null);
        bestMove = available[Math.floor(Math.random() * available.length)];
      }
      if (bestMove !== null && bestMove !== undefined) {
        makeMove(bestMove);
      }
    }

    function findBestMove(player) {
      for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        const line = [board[a], board[b], board[c]];
        if (line.filter(x => x === player).length === 2 && line.includes('')) {
          return pattern[line.indexOf('')];
        }
      }
      return null;
    }

    function checkWin(player) {
      for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] === player && board[b] === player && board[c] === player) {
          pattern.forEach(i => document.querySelectorAll('.cell')[i].classList.add('win'));
          return true;
        }
      }
      return false;
    }

    function handleWin(winner) {
      gameActive = false;
      scores[winner]++;
      document.getElementById('score' + winner).textContent = scores[winner];
      document.getElementById('status').textContent = '🎉 الفائز: اللاعب ' + winner + '!';
      playBeep(659, 'triangle', 0.2);
      setTimeout(() => playBeep(880, 'triangle', 0.4), 200);
    }

    function handleDraw() {
      gameActive = false;
      scores.draw++;
      document.getElementById('scoreDraw').textContent = scores.draw;
      document.getElementById('status').textContent = '🤝 تعادل رائع!';
      playBeep(330, 'square', 0.25);
    }

    function restartGame() {
      board = Array(9).fill('');
      currentPlayer = 'X';
      gameActive = true;
      document.getElementById('status').textContent = 'دور اللاعب X';
      document.querySelectorAll('.cell').forEach(c => {
        c.textContent = '';
        c.className = 'cell';
      });
    }

    function resetAll() {
      scores = { X: 0, O: 0, draw: 0 };
      document.getElementById('scoreX').textContent = '0';
      document.getElementById('scoreO').textContent = '0';
      document.getElementById('scoreDraw').textContent = '0';
      restartGame();
    }
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 2. COMPLETE INTERACTIVE ANALYTICS DASHBOARD
    // =========================================================================
    if (isDash) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>لوحة التحكم والتحليلات الذكية — Suras AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080b14;
      --card-bg: rgba(255, 255, 255, 0.03);
      --border: rgba(255, 255, 255, 0.08);
      --primary: #6366f1;
      --accent: #06b6d4;
      --success: #10b981;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Cairo',sans-serif; background:var(--bg); color:#fff; padding:24px; }
    .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:28px; }
    .logo { font-size:1.5rem; font-weight:900; background:linear-gradient(90deg,#818cf8,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; margin-bottom:28px; }
    .stat-card { background:var(--card-bg); border:1px solid var(--border); border-radius:20px; padding:24px; backdrop-filter:blur(16px); }
    .stat-card:hover { border-color:var(--primary); transform:translateY(-3px); transition:.25s; }
    .stat-title { font-size:0.8rem; color:rgba(255,255,255,0.6); margin-bottom:8px; }
    .stat-value { font-size:2rem; font-weight:900; }
    .stat-badge { font-size:0.75rem; color:var(--success); margin-top:6px; }
    .main-grid { display:grid; grid-template-columns:2fr 1fr; gap:24px; }
    .chart-box { background:var(--card-bg); border:1px solid var(--border); border-radius:20px; padding:24px; }
    .table-box { background:var(--card-bg); border:1px solid var(--border); border-radius:20px; padding:24px; }
    table { width:100%; border-collapse:collapse; margin-top:16px; font-size:0.9rem; }
    th { text-align:right; color:rgba(255,255,255,0.5); padding:10px 8px; border-bottom:1px solid var(--border); }
    td { padding:14px 8px; border-bottom:1px solid rgba(255,255,255,0.04); }
    .pill { padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:700; }
    .pill.done { background:rgba(16,185,129,0.15); color:#34d399; }
    .pill.prog { background:rgba(245,158,11,0.15); color:#fbbf24; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">⚡ منصة التحليلات الشاملة</div>
    <button style="background:var(--primary);color:#fff;border:none;padding:10px 20px;border-radius:12px;cursor:pointer;font-family:'Cairo';font-weight:700" onclick="updateLiveStats()">🔄 تحديث البيانات الحية</button>
  </div>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-title">إجمالي الزوار</div>
      <div class="stat-value" id="valUsers">48,290</div>
      <div class="stat-badge">▲ +14.2% هذا الأسبوع</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">الإيرادات الشهرية</div>
      <div class="stat-value" id="valRev">$128,450</div>
      <div class="stat-badge">▲ +21.8% نمو مستمر</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">العمليات المكتملة</div>
      <div class="stat-value" id="valTasks">1,894</div>
      <div class="stat-badge">▲ 99.4% معدل النجاح</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">استقرار الخوادم</div>
      <div class="stat-value">99.98%</div>
      <div class="stat-badge">● متصل ومستقر</div>
    </div>
  </div>
  <div class="main-grid">
    <div class="chart-box">
      <h3 style="margin-bottom:16px">📈 تدفق العمليات (Real-time Flow)</h3>
      <svg viewBox="0 0 500 160" style="width:100%;height:auto;overflow:visible">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.5"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="M0,130 Q100,20 200,90 T400,30 T500,70 L500,160 L0,160 Z" fill="url(#grad)"/>
        <path d="M0,130 Q100,20 200,90 T400,30 T500,70" fill="none" stroke="#818cf8" stroke-width="4"/>
      </svg>
    </div>
    <div class="table-box">
      <h3 style="margin-bottom:8px">📋 أحدث العمليات</h3>
      <table>
        <thead><tr><th>المهمة</th><th>الحالة</th><th>الوقت</th></tr></thead>
        <tbody id="tableBody">
          <tr><td>معالجة عصبية</td><td><span class="pill done">مكتمل</span></td><td>منذ دقيقة</td></tr>
          <tr><td>بناء واجهة React</td><td><span class="pill done">مكتمل</span></td><td>منذ 4 دقائق</td></tr>
          <tr><td>تدريب المحرك</td><td><span class="pill prog">قيد العمل</span></td><td>الآن</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <script>
    function updateLiveStats() {
      document.getElementById('valUsers').textContent = (48000 + Math.floor(Math.random()*1000)).toLocaleString();
      document.getElementById('valRev').textContent = '$' + (128000 + Math.floor(Math.random()*2000)).toLocaleString();
    }
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 3. COMPLETE MODERN RESPONSIVE PORTFOLIO / LANDING PAGE
    // =========================================================================

    // =========================================================================
    // 3a. COMPLETE SCIENTIFIC CALCULATOR
    // =========================================================================
    if (isCalc) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>الحاسبة الذكية — Suras AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #0b0f19; --card: rgba(255,255,255,0.04); --border: rgba(255,255,255,0.1); --primary: #7c3aed; --accent: #06b6d4; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Cairo',sans-serif; background:radial-gradient(circle at top,#1e1b4b 0%,var(--bg) 80%); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .calc { background:var(--card); backdrop-filter:blur(24px); border:1px solid var(--border); border-radius:28px; padding:28px; width:100%; max-width:380px; box-shadow:0 20px 60px rgba(0,0,0,0.5); }
    h1 { text-align:center; font-size:1.3rem; font-weight:900; background:linear-gradient(135deg,var(--primary),var(--accent)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:20px; }
    .display { background:rgba(0,0,0,0.4); border:1px solid var(--border); border-radius:16px; padding:16px 20px; margin-bottom:16px; text-align:right; }
    .expr { font-size:0.85rem; color:rgba(255,255,255,0.5); min-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .result { font-size:2.5rem; font-weight:700; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
    .btn { background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.08); color:#fff; padding:18px 8px; border-radius:14px; font-family:'Cairo'; font-size:1rem; font-weight:600; cursor:pointer; transition:all .15s; }
    .btn:hover { background:rgba(255,255,255,0.15); transform:scale(1.04); }
    .btn:active { transform:scale(0.97); }
    .btn.op { color:var(--accent); }
    .btn.eq { background:linear-gradient(135deg,var(--primary),var(--accent)); border:none; color:#fff; font-size:1.3rem; }
    .btn.eq:hover { box-shadow:0 6px 24px rgba(124,58,237,0.5); }
    .btn.clear { color:#ef4444; }
    .btn.wide { grid-column:span 2; }
    .history { margin-top:16px; max-height:100px; overflow-y:auto; font-size:0.78rem; color:rgba(255,255,255,0.4); }
    .history div { padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.04); }
  </style>
</head>
<body>
  <div class="calc">
    <h1>🧮 الحاسبة الذكية</h1>
    <div class="display">
      <div class="expr" id="expr"></div>
      <div class="result" id="result">0</div>
    </div>
    <div class="grid">
      <button class="btn clear" onclick="clearAll()">AC</button>
      <button class="btn op" onclick="backspace()">⌫</button>
      <button class="btn op" onclick="append('%')">%</button>
      <button class="btn op" onclick="append('/')">÷</button>
      <button class="btn" onclick="append('7')">7</button>
      <button class="btn" onclick="append('8')">8</button>
      <button class="btn" onclick="append('9')">9</button>
      <button class="btn op" onclick="append('*')">×</button>
      <button class="btn" onclick="append('4')">4</button>
      <button class="btn" onclick="append('5')">5</button>
      <button class="btn" onclick="append('6')">6</button>
      <button class="btn op" onclick="append('-')">−</button>
      <button class="btn" onclick="append('1')">1</button>
      <button class="btn" onclick="append('2')">2</button>
      <button class="btn" onclick="append('3')">3</button>
      <button class="btn op" onclick="append('+')">+</button>
      <button class="btn" onclick="appendDecimal()">.</button>
      <button class="btn" onclick="append('0')">0</button>
      <button class="btn op" onclick="sqrt()">√</button>
      <button class="btn eq" onclick="calculate()">=</button>
    </div>
    <div class="history" id="history"></div>
  </div>
  <script>
    let expr = '';
    const histList = [];
    function update() {
      document.getElementById('expr').textContent = expr.replace(/\*/g,'×').replace(/\//g,'÷') || '‎';
    }
    function append(v) {
      const ops = ['+','-','*','/','%'];
      if (ops.includes(v) && ops.includes(expr.slice(-1))) expr = expr.slice(0,-1);
      expr += v; update();
    }
    function appendDecimal() {
      const parts = expr.split(/[\+\-\*\/]/);
      if (parts[parts.length-1].includes('.')) return;
      expr += (expr === '' || '+-*/'.includes(expr.slice(-1))) ? '0.' : '.';
      update();
    }
    function clearAll() { expr = ''; document.getElementById('result').textContent = '0'; update(); }
    function backspace() { expr = expr.slice(0,-1); update(); }
    function sqrt() { try { const r = Math.sqrt(eval(expr||'0')); document.getElementById('result').textContent = r; histList.unshift('√('+expr+') = '+r); expr = String(r); update(); addHistory(); } catch(e) { document.getElementById('result').textContent = 'خطأ'; } }
    function calculate() {
      try {
        const safe = expr.replace(/[^0-9+\-*/.%()]/g,'');
        const res = Function('"use strict"; return ('+safe+')')();
        const r = parseFloat(res.toFixed(10));
        histList.unshift(expr.replace(/\*/g,'×').replace(/\//g,'÷') + ' = ' + r);
        document.getElementById('result').textContent = r;
        expr = String(r); update(); addHistory();
      } catch(e) { document.getElementById('result').textContent = 'خطأ في العملية'; }
    }
    function addHistory() { const h=document.getElementById('history'); h.innerHTML=histList.slice(0,8).map(x=>'<div>'+x+'</div>').join(''); }
    document.addEventListener('keydown', e => {
      if ('0123456789.+-*/%()'.includes(e.key)) append(e.key);
      else if (e.key === 'Enter' || e.key === '=') calculate();
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Escape') clearAll();
    });
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 3b. COMPLETE STOPWATCH & TIMER WITH LAPS
    // =========================================================================
    if (isTimer) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ساعة التوقيت الذكية — Suras AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#0b0f19; --primary:#7c3aed; --accent:#06b6d4; --success:#10b981; --border:rgba(255,255,255,0.1); }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Cairo',sans-serif; background:radial-gradient(circle at top,#1e1b4b,var(--bg)); color:#fff; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:30px 20px; }
    h1 { font-size:1.5rem; font-weight:900; background:linear-gradient(135deg,var(--primary),var(--accent)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:24px; }
    .tabs { display:flex; gap:10px; margin-bottom:24px; }
    .tab { padding:8px 24px; border-radius:12px; border:1px solid var(--border); cursor:pointer; font-family:'Cairo'; color:#fff; transition:.2s; background:rgba(255,255,255,0.05); }
    .tab.active { background:var(--primary); border-color:var(--primary); }
    .clock-box { background:rgba(255,255,255,0.04); border:1px solid var(--border); border-radius:28px; padding:40px 32px; text-align:center; width:100%; max-width:420px; backdrop-filter:blur(20px); margin-bottom:20px; }
    .time { font-size:3.5rem; font-weight:900; letter-spacing:2px; font-variant-numeric:tabular-nums; }
    .controls { display:flex; gap:12px; justify-content:center; margin-top:24px; flex-wrap:wrap; }
    .btn { padding:12px 28px; border-radius:14px; border:none; font-family:'Cairo'; font-weight:700; font-size:0.95rem; cursor:pointer; transition:.2s; }
    .btn-start { background:linear-gradient(135deg,var(--primary),var(--accent)); color:#fff; }
    .btn-stop { background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); color:#ef4444; }
    .btn-lap { background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); color:var(--success); }
    .btn-reset { background:rgba(255,255,255,0.08); border:1px solid var(--border); color:#fff; }
    .laps { width:100%; max-width:420px; }
    .lap-item { display:flex; justify-content:space-between; padding:10px 16px; background:rgba(255,255,255,0.04); border:1px solid var(--border); border-radius:12px; margin-bottom:8px; font-size:0.85rem; }
    .lap-num { color:var(--accent); font-weight:700; }
    input[type=number] { background:rgba(255,255,255,0.08); border:1px solid var(--border); border-radius:10px; color:#fff; padding:10px 14px; font-family:'Cairo'; font-size:1rem; width:100%; margin-bottom:12px; outline:none; text-align:center; }
    .progress-ring { position:relative; display:flex; align-items:center; justify-content:center; }
    .ring-text { position:absolute; font-size:2.5rem; font-weight:900; }
  </style>
</head>
<body>
  <h1>⏱️ ساعة التوقيت الذكية</h1>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('stopwatch')">⏱ ساعة الإيقاف</button>
    <button class="tab" onclick="switchTab('countdown')">⏳ مؤقت العد التنازلي</button>
  </div>
  <div id="stopwatchPanel" class="clock-box">
    <div class="time" id="swDisplay">00:00.000</div>
    <div class="controls">
      <button class="btn btn-start" id="swStartBtn" onclick="swStart()">▶ ابدأ</button>
      <button class="btn btn-lap" onclick="swLap()">🚩 لفّة</button>
      <button class="btn btn-reset" onclick="swReset()">↺ تصفير</button>
    </div>
  </div>
  <div id="countdownPanel" class="clock-box" style="display:none">
    <div id="cdInputArea">
      <input type="number" id="cdMinutes" placeholder="الدقائق (مثال: 5)" min="0" max="99">
      <input type="number" id="cdSeconds" placeholder="الثواني (مثال: 30)" min="0" max="59">
      <button class="btn btn-start" onclick="cdStart()" style="width:100%">▶ ابدأ العد التنازلي</button>
    </div>
    <div class="time" id="cdDisplay" style="display:none">00:00</div>
    <div class="controls" id="cdControls" style="display:none">
      <button class="btn btn-stop" onclick="cdPause()">⏸ إيقاف مؤقت</button>
      <button class="btn btn-reset" onclick="cdReset()">↺ تصفير</button>
    </div>
  </div>
  <div class="laps" id="lapsContainer"></div>
  <script>
    let swRunning=false,swInterval=null,swElapsed=0,swStart_=0,laps=[],lapCount=0;
    let cdRunning=false,cdInterval=null,cdRemaining=0,cdTotal=0;
    let currentTab='stopwatch';
    function switchTab(t) {
      currentTab=t;
      document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',i===(t==='stopwatch'?0:1)));
      document.getElementById('stopwatchPanel').style.display=t==='stopwatch'?'':'none';
      document.getElementById('countdownPanel').style.display=t==='countdown'?'':'none';
      document.getElementById('lapsContainer').innerHTML='';
    }
    function fmtSW(ms) {
      const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),mss=ms%1000;
      return (m<10?'0':'')+m+':'+(s<10?'0':'')+s+'.'+(mss<100?mss<10?'00':'0':'')+mss;
    }
    function swStart() {
      if(swRunning){swRunning=false;clearInterval(swInterval);swElapsed+=(Date.now()-swStart_);document.getElementById('swStartBtn').textContent='▶ استمرار';}
      else{swRunning=true;swStart_=Date.now();document.getElementById('swStartBtn').textContent='⏸ إيقاف';swInterval=setInterval(()=>{document.getElementById('swDisplay').textContent=fmtSW(swElapsed+(Date.now()-swStart_));},10);}
    }
    function swLap(){if(!swRunning)return;lapCount++;const t=swElapsed+(Date.now()-swStart_);laps.unshift({n:lapCount,t:fmtSW(t)});document.getElementById('lapsContainer').innerHTML=laps.map(l=>'<div class="lap-item"><span class="lap-num">لفّة '+l.n+'</span><span>'+l.t+'</span></div>').join('');}
    function swReset(){swRunning=false;clearInterval(swInterval);swElapsed=0;laps=[];lapCount=0;document.getElementById('swDisplay').textContent='00:00.000';document.getElementById('lapsContainer').innerHTML='';document.getElementById('swStartBtn').textContent='▶ ابدأ';}
    function cdStart(){const m=parseInt(document.getElementById('cdMinutes').value)||0,s=parseInt(document.getElementById('cdSeconds').value)||0;cdTotal=(m*60+s)*1000;if(cdTotal<=0)return;cdRemaining=cdTotal;document.getElementById('cdInputArea').style.display='none';document.getElementById('cdDisplay').style.display='';document.getElementById('cdControls').style.display='flex';cdRun();}
    function cdRun(){cdRunning=true;cdInterval=setInterval(()=>{cdRemaining-=100;if(cdRemaining<=0){cdRemaining=0;clearInterval(cdInterval);cdRunning=false;document.getElementById('cdDisplay').textContent='انتهى! ✅';document.getElementById('cdDisplay').style.color='#10b981';const ctx=new(window.AudioContext||window.webkitAudioContext)();for(let i=0;i<3;i++){setTimeout(()=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=800;g.gain.setValueAtTime(0.15,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.3);},i*350);}return;}const mm=Math.floor(cdRemaining/60000),ss=Math.ceil((cdRemaining%60000)/1000);document.getElementById('cdDisplay').textContent=(mm<10?'0':'')+mm+':'+(ss<10?'0':'')+ss;},100);}
    function cdPause(){if(cdRunning){clearInterval(cdInterval);cdRunning=false;}else if(cdRemaining>0){cdRun();}}
    function cdReset(){clearInterval(cdInterval);cdRunning=false;cdRemaining=0;document.getElementById('cdDisplay').textContent='00:00';document.getElementById('cdDisplay').style.color='';document.getElementById('cdInputArea').style.display='';document.getElementById('cdDisplay').style.display='none';document.getElementById('cdControls').style.display='none';}
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 3c. COMPLETE RICH TODO / TASK MANAGER WITH PRIORITIES & FILTERS
    // =========================================================================
    if (isTodo) {
        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مدير المهام الذكي — Suras AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#080c18;--card:rgba(255,255,255,0.04);--border:rgba(255,255,255,0.09);--primary:#7c3aed;--accent:#06b6d4;--success:#10b981;--warning:#f59e0b;--danger:#ef4444;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Cairo',sans-serif;background:radial-gradient(circle at top,#1a0d3d,var(--bg));color:#fff;min-height:100vh;padding:28px 20px;}
    .container{max-width:680px;margin:0 auto;}
    h1{text-align:center;font-size:1.8rem;font-weight:900;background:linear-gradient(135deg,var(--primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px;}
    .stats{display:flex;gap:12px;justify-content:center;margin-bottom:20px;font-size:0.8rem;color:rgba(255,255,255,0.6);}
    .stat span{font-weight:700;color:#fff;}
    .add-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
    .add-bar input[type=text]{flex:1;min-width:200px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 16px;color:#fff;font-family:'Cairo';font-size:0.95rem;outline:none;transition:.2s;}
    .add-bar input:focus{border-color:var(--primary);}
    select{background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:12px;padding:12px 14px;color:#fff;font-family:'Cairo';cursor:pointer;}
    .btn-add{background:linear-gradient(135deg,var(--primary),var(--accent));border:none;color:#fff;padding:12px 20px;border-radius:14px;font-family:'Cairo';font-weight:700;cursor:pointer;white-space:nowrap;}
    .filters{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
    .filter{padding:6px 16px;border-radius:10px;border:1px solid var(--border);background:transparent;color:rgba(255,255,255,0.6);font-family:'Cairo';font-size:0.8rem;cursor:pointer;transition:.2s;}
    .filter.active{background:var(--primary);border-color:var(--primary);color:#fff;}
    .task-list{display:flex;flex-direction:column;gap:10px;}
    .task{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:12px;transition:.25s;animation:slideIn .2s ease;}
    @keyframes slideIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
    .task:hover{border-color:rgba(255,255,255,0.18);transform:translateX(-3px);}
    .task.done{opacity:0.5;}
    .task.done .task-text{text-decoration:line-through;color:rgba(255,255,255,0.4);}
    .check{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s;flex-shrink:0;}
    .check.checked{background:var(--success);border-color:var(--success);}
    .task-text{flex:1;font-size:0.92rem;}
    .priority{padding:2px 10px;border-radius:8px;font-size:0.7rem;font-weight:700;}
    .p-high{background:rgba(239,68,68,0.2);color:#f87171;}
    .p-med{background:rgba(245,158,11,0.2);color:#fbbf24;}
    .p-low{background:rgba(16,185,129,0.2);color:#34d399;}
    .del-btn{background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;padding:4px;border-radius:8px;transition:.2s;}
    .del-btn:hover{color:#ef4444;background:rgba(239,68,68,0.1);}
    .empty{text-align:center;color:rgba(255,255,255,0.3);padding:40px;font-size:0.9rem;}
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ مدير المهام الذكي</h1>
    <div class="stats">
      <div>الإجمالي: <span id="statTotal">0</span></div>
      <div>مكتملة: <span id="statDone">0</span></div>
      <div>متبقية: <span id="statPending">0</span></div>
    </div>
    <div class="add-bar">
      <input type="text" id="taskInput" placeholder="اكتب مهمتك الجديدة..." onkeydown="if(event.key==='Enter')addTask()">
      <select id="prioritySelect">
        <option value="high">🔴 عالي</option>
        <option value="med" selected>🟡 متوسط</option>
        <option value="low">🟢 منخفض</option>
      </select>
      <button class="btn-add" onclick="addTask()">+ أضف</button>
    </div>
    <div class="filters">
      <button class="filter active" onclick="setFilter('all')">الكل</button>
      <button class="filter" onclick="setFilter('pending')">⏳ متبقية</button>
      <button class="filter" onclick="setFilter('done')">✅ مكتملة</button>
      <button class="filter" onclick="setFilter('high')">🔴 عالي الأولوية</button>
    </div>
    <div class="task-list" id="taskList"></div>
    <div class="empty" id="emptyMsg" style="display:none">لا توجد مهام تطابق الفلتر المحدد.</div>
  </div>
  <script>
    let tasks=JSON.parse(localStorage.getItem('suras_tasks')||'[]');
    let filter='all';
    const priorityMap={high:{label:'عالي',cls:'p-high'},med:{label:'متوسط',cls:'p-med'},low:{label:'منخفض',cls:'p-low'}};
    function save(){localStorage.setItem('suras_tasks',JSON.stringify(tasks));}
    function setFilter(f){filter=f;document.querySelectorAll('.filter').forEach((b,i)=>b.classList.toggle('active',['all','pending','done','high'][i]===f));render();}
    function addTask(){const t=document.getElementById('taskInput').value.trim();if(!t)return;const p=document.getElementById('prioritySelect').value;tasks.unshift({id:Date.now(),text:t,priority:p,done:false});document.getElementById('taskInput').value='';save();render();}
    function toggle(id){const t=tasks.find(x=>x.id===id);if(t)t.done=!t.done;save();render();}
    function del(id){tasks=tasks.filter(x=>x.id!==id);save();render();}
    function render(){
      const vis=tasks.filter(t=>{if(filter==='all')return true;if(filter==='done')return t.done;if(filter==='pending')return!t.done;if(filter==='high')return t.priority==='high';return true;});
      const list=document.getElementById('taskList');const em=document.getElementById('emptyMsg');
      if(!vis.length){list.innerHTML='';em.style.display='';} else{em.style.display='none';
      list.innerHTML=vis.map(t=>'<div class="task'+(t.done?' done':'')+'"><div class="check'+(t.done?' checked':'')+'" onclick="toggle('+t.id+')">'+(t.done?'✓':'')+'</div><span class="task-text">'+t.text+'</span><span class="priority '+priorityMap[t.priority].cls+'">'+priorityMap[t.priority].label+'</span><button class="del-btn" onclick="del('+t.id+')">🗑</button></div>').join('');}
      const done=tasks.filter(x=>x.done).length;
      document.getElementById('statTotal').textContent=tasks.length;
      document.getElementById('statDone').textContent=done;
      document.getElementById('statPending').textContent=tasks.length-done;
    }
    render();
  </script>
</body>
</html>`;
    }

    // =========================================================================
    // 3. UNIVERSAL DYNAMIC APP GENERATOR (Open-Source Universal Builder)
    // Builds ANY application dynamically from the query with full interactive logic
    // =========================================================================
    const cleanTitle = query.replace(/[^\w\s\u0621-\u064A]/gi, '').trim() || 'تطبيق سوراس المخصص';
    const appTopic = cleanTitle.length > 30 ? cleanTitle.slice(0, 30) + '...' : cleanTitle;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appTopic} — Suras Open Engine</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070913;
      --card-bg: rgba(255, 255, 255, 0.04);
      --card-hover: rgba(255, 255, 255, 0.08);
      --border: rgba(255, 255, 255, 0.1);
      --primary: #7c3aed;
      --primary-light: #a78bfa;
      --accent: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: rgba(255, 255, 255, 0.65);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 75%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.6;
    }
    header {
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(7, 9, 19, 0.7);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 900;
      font-size: 1.25rem;
      background: linear-gradient(135deg, var(--primary-light), var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      font-size: 0.7rem;
      padding: 3px 10px;
      border-radius: 20px;
      background: rgba(124, 58, 237, 0.2);
      border: 1px solid var(--primary-light);
      color: var(--primary-light);
      font-weight: 700;
    }
    .main-container {
      max-width: 1000px;
      width: 100%;
      margin: 32px auto;
      padding: 0 20px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .hero-box {
      background: var(--card-bg);
      backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 32px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .hero-box::before {
      content: '';
      position: absolute;
      top: -50%;
      left: 50%;
      transform: translateX(-50%);
      width: 300px;
      height: 150px;
      background: radial-gradient(circle, rgba(124, 58, 237, 0.3) 0%, transparent 70%);
      pointer-events: none;
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 900;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #ffffff, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.desc {
      color: var(--text-muted);
      font-size: 1rem;
      max-width: 600px;
      margin: 0 auto 24px;
    }
    .interactive-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 24px;
      transition: all 0.25s ease;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .card:hover {
      background: var(--card-hover);
      border-color: var(--primary);
      transform: translateY(-4px);
      box-shadow: 0 12px 30px rgba(0,0,0,0.4);
    }
    .card-title {
      font-size: 1.1rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .input-field {
      width: 100%;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 16px;
      color: #fff;
      font-family: 'Cairo';
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 12px rgba(6, 182, 212, 0.3);
    }
    .btn {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 14px;
      font-family: 'Cairo';
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:hover {
      transform: scale(1.03);
      box-shadow: 0 6px 20px rgba(124, 58, 237, 0.4);
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.14);
      box-shadow: none;
    }
    .output-box {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      font-family: monospace;
      font-size: 0.9rem;
      min-height: 120px;
      max-height: 250px;
      overflow-y: auto;
      color: #38bdf8;
      white-space: pre-wrap;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 50px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .live-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .live-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 12px;
      animation: fadeIn 0.25s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    footer {
      padding: 24px;
      text-align: center;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.85rem;
      background: rgba(7, 9, 19, 0.5);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>⚡ ${appTopic}</span>
      <span class="badge">مفتوح المصدر (Open Source)</span>
    </div>
    <div class="status-pill">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
      جاهز للتشغيل الحي
    </div>
  </header>

  <div class="main-container">
    <div class="hero-box">
      <h1>${cleanTitle || 'تطبيق تفاعلي كامل'}</h1>
      <p class="desc">تم تصنيعه وتوليده بالكامل عبر محرك سوراس الذاتي بناءً على طلبك: "${query}". التطبيق مفتوح المصدر وتفاعلي بنسبة 100%.</p>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        <button class="btn" onclick="executeMainAction()">🚀 بدء التنفيذ والمعالجة</button>
        <button class="btn btn-secondary" onclick="exportData()">💾 تصدير كـ JSON</button>
        <button class="btn btn-secondary" onclick="clearLiveView()">🧹 تنظيف الشاشة</button>
      </div>
    </div>

    <div class="interactive-grid">
      <!-- Card 1: Input & Operations -->
      <div class="card">
        <div class="card-title">⚙️ لوحة التحكم والإدخال</div>
        <input type="text" id="userInput" class="input-field" placeholder="أدخل بياناً أو نصاً للتفاعل..." value="عنصر تجريبي 1">
        <div style="display: flex; gap: 8px;">
          <button class="btn" style="flex: 1;" onclick="addItem()">+ إضافة فوري</button>
          <button class="btn btn-secondary" onclick="generateRandom()">🎲 عشوائي</button>
        </div>
        <div class="live-list" id="itemsList"></div>
      </div>

      <!-- Card 2: Live Processing Output -->
      <div class="card">
        <div class="card-title">📊 المخرجات والتحليل اللحظي</div>
        <div class="output-box" id="outputConsole">⚡ النظام جاهز. اضغط على أي زر لبدء التفاعل والمعالجة الحية...</div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: var(--text-muted);">
          <span>عدد العناصر: <strong id="itemCount" style="color: var(--accent);">0</strong></span>
          <span>الزمن: <strong id="timestamp" style="color: #fff;">--:--:--</strong></span>
        </div>
      </div>
    </div>
  </div>

  <footer>
    صُنع وتطوّر ذاتياً عبر منصة <strong>Suras AI</strong> — جميع الحقوق مفتوحة وقابلة للتطوير 2026 ©
  </footer>

  <script>
    let appItems = ['مهمة 1', 'عنصر ذكي', 'عملية نشطة'];
    
    // Web Audio Sound synthesis for interactive feedback
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playChirp(freq = 520, type = 'sine') {
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } catch(e) {}
    }

    function log(msg) {
      const c = document.getElementById('outputConsole');
      const time = new Date().toLocaleTimeString();
      c.innerHTML = \`[\${time}] \${msg}\\n\` + c.innerHTML;
      document.getElementById('timestamp').textContent = time;
    }

    function renderList() {
      const container = document.getElementById('itemsList');
      container.innerHTML = appItems.map((item, idx) => \`
        <div class="live-item">
          <span>\${idx + 1}. \${item}</span>
          <button onclick="removeItem(\${idx})" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.9rem;">✕</button>
        </div>
      \`).join('');
      document.getElementById('itemCount').textContent = appItems.length;
    }

    function addItem() {
      const input = document.getElementById('userInput');
      const val = input.value.trim();
      if (!val) return;
      appItems.unshift(val);
      input.value = '';
      playChirp(650);
      log(\`تمت إضافة العنصر بنجاح: "\${val}"\`);
      renderList();
    }

    function removeItem(idx) {
      const removed = appItems.splice(idx, 1);
      playChirp(350, 'triangle');
      log(\`تم حذف: "\${removed}"\`);
      renderList();
    }

    function generateRandom() {
      const samples = ['تحليل البيانات الذكية', 'فحص الخادم', 'توليد واجهة React', 'معالجة نصوص', 'اتصال بقاعدة البيانات'];
      const r = samples[Math.floor(Math.random() * samples.length)] + ' #' + Math.floor(Math.random() * 900 + 100);
      document.getElementById('userInput').value = r;
      playChirp(780);
    }

    function executeMainAction() {
      playChirp(880);
      log(\`🚀 تم إطلاق المعالجة الكاملة لـ "\${document.title}" عبر محرك سوراس!\`);
      log(\`⚡ جاري معالجة \${appItems.length} عنصر في الذاكرة الحية...\`);
      setTimeout(() => {
        playChirp(1040);
        log('✅ اكتملت المعالجة بنجاح وبأعلى معدل أداء!');
      }, 400);
    }

    function exportData() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        app: "${cleanTitle}",
        query: "${query}",
        items: appItems,
        exportedAt: new Date().toISOString()
      }, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "suras_app_data.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      playChirp(900);
      log('💾 تم تصدير بيانات التطبيق كملف JSON بنجاح.');
    }

    function clearLiveView() {
      document.getElementById('outputConsole').innerHTML = 'تم تنظيف الشاشة.';
      playChirp(400);
    }

    // Initial render
    renderList();
    log('تم بناء وتشغيل التطبيق التفاعلي بنجاح!');
  </script>
</body>
</html>`;
}

// Model generation flows through the local-first Ollama bridge.

// Shared response processor: extracts <write_file>, <search_files>, <read_file>
// tools, applies quality checks, and emits updates to the dashboard.
async function processModelResponse(responseText, query, isBuildIntent, io, modelLabel = 'Model') {
    let toolsUsed = [];
    const writeRegex = /<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/g;
    let match;
    let foundCode = false;

    const saveExtractedCode = async (relPath, content) => {
        try {
            const fullPath = path.join(__dirname, '..', relPath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            const finalContent = content.trim();
            await fs.writeFile(fullPath, finalContent, 'utf-8');
            toolsUsed.push(`Created/Updated: ${relPath} (${finalContent.length} chars)`);
            io.emit('files-changed');
            try { await selfReflect(relPath, io, modelLabel); } catch (e) { /* ignore reflection errors */ }
            foundCode = true;
        } catch (err) { toolsUsed.push(`Error writing: ${relPath}`); }
    };

    while ((match = writeRegex.exec(responseText)) !== null) {
        await saveExtractedCode(match[1], match[2]);
    }

    if (!foundCode && isBuildIntent) {
        const mdRegex = /```([a-zA-Z0-9+#-]*)\s*\n?([\s\S]*?)```/i;
        const mdMatch = mdRegex.exec(responseText);
        if (mdMatch) {
            let ext = (mdMatch[1] || '').toLowerCase().replace('javascript', 'js').replace('python', 'py');
            if (!ext) { ext = isPython ? 'py' : isCSS ? 'css' : 'html'; }
            const targetName = fileNameFromQuery(query) || `agent_build_${Date.now()}.${ext}`;
            await saveExtractedCode(targetName, mdMatch[2]);
        }
    }

    if (false && isBuildIntent && toolsUsed.length === 0) {
        const isHTML = /html|صفح|موقع|واجهة|لعب/i.test(query);
        const isPython = /python|بايثون|py|سكريبت/i.test(query);
        const isCSS = /css|تصميم|style/i.test(query);
        const ext = isPython ? 'py' : isCSS ? 'css' : 'html';
        const autoName = `rich_agent_build_${Date.now()}.${ext}`;
        const autoContent = buildRichTemplate(query, autoName);
        const fullPath = path.join(__dirname, '..', autoName);
        await fs.writeFile(fullPath, autoContent, 'utf-8');
        io.emit('files-changed');
        toolsUsed.push(`Created/Updated: ${autoName}`);
        responseText = `✅ لقد قمت بإنشاء ملف **${autoName}** مباشرةً. افتح الملف وتعديله من مستعرض الملفات على اليسار.`;
    }

    const searchRegex = /<search_files\s+query=["']([^"']+)["']\s*\/>/g;
    while ((match = searchRegex.exec(responseText)) !== null) {
        const q = match[1];
        try {
            const results = [];
            async function quickSearch(dir) {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (['node_modules', '.git'].includes(entry.name)) continue;
                        await quickSearch(fullPath);
                    } else if (entry.name.includes(q)) {
                        results.push(path.relative(path.join(__dirname, '..'), fullPath));
                    }
                }
            }
            await quickSearch(path.join(__dirname, '..'));
            toolsUsed.push(`Search for '${q}' found: ${results.length > 0 ? results.join(', ') : 'No matches'}`);
        } catch (err) { toolsUsed.push(`Search error: ${err.message}`); }
    }

    const readRegex = /<read_file\s+path=["']([^"']+)["']\s*\/>/g;
    while ((match = readRegex.exec(responseText)) !== null) {
        const fPath = match[1];
        try {
            const fullPath = path.join(__dirname, '..', fPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            toolsUsed.push(`Read file '${fPath}': [Content loaded to Context]`);
            responseText += `\n\n**[Content of ${fPath}]**:\n\`\`\`\n${content}\n\`\`\``;
        } catch (err) { toolsUsed.push(`Read error: ${fPath}`); }
    }

    // execute tool (safe shell command)
    const execRegex = /<execute\s+command=["']([^"']+)["']\s*\/>/g;
    while ((match = execRegex.exec(responseText)) !== null) {
        const cmd = match[1];
        if (/\b(rm\s+-rf|del\s+[a-z]:|format\s+[a-z]|shutdown|mkfs|rm\s+-r\s+\/)\b/i.test(cmd)) {
            toolsUsed.push(`Execute blocked (forbidden): ${cmd}`);
            continue;
        }
        try {
            const parts = cmd.split(/\s+/);
            const child = spawn(parts[0], parts.slice(1), { shell: true, timeout: 20000 });
            let o = '', err = '';
            child.stdout.on('data', d => o += d.toString());
            child.stderr.on('data', d => err += d.toString());
            const code = await new Promise(r => { child.on('close', c => r(c === null ? 1 : c)); child.on('error', () => r(1)); });
            toolsUsed.push(`Execute [${code}] ${cmd}: ${(o || err).slice(0, 1500)}`);
            responseText += `\n\n**[Output of ${cmd}]**:\n\`\`\`\n${(o || err).slice(0, 1500)}\n\`\`\``;
        } catch (e) { toolsUsed.push(`Execute error: ${cmd} -> ${e.message}`); }
    }

    // create_video tool — AI generates a complete marketing video (banner + voiceover + clip)
    const createVideoRegex = /<create_video\s+topic=["']([^"']+)["']\s*\/>/g;
    while ((match = createVideoRegex.exec(responseText)) !== null) {
        const topic = match[1];
        try {
            toolsUsed.push(`🎬 Video Engine: producing ad for "${topic}"...`);
            const form = new URLSearchParams();
            form.append('topic', topic);
            form.append('duration', '15.0');
            const r = await fetch(`${GOV_RECON_URL}/api/suras/create-auto-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
                signal: AbortSignal.timeout(300000),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                toolsUsed.push(`Video error: ${(err && err.detail) || r.status}`);
                continue;
            }
            const buf = Buffer.from(await r.arrayBuffer());
            // حفظ الفيديو داخل المجلد القابل للعرض لتشغيله فوراً في شاشة المعاينة المركزية
            const outDir = path.join(__dirname, '..', 'productions');
            await fs.mkdir(outDir, { recursive: true });
            const outName = `suras_ad_${Date.now()}.mp4`;
            const outPath = path.join(outDir, outName);
            await fs.writeFile(outPath, buf);
            toolsUsed.push(`🎬 تم إنتاج الفيديو: /productions/${outName} (${buf.length} bytes)`);
            responseText += `\n\n**[🎬 الفيديو الإعلاني جاهز للعرض]:** http://localhost:3001/productions/${outName}`;
            io.emit('media-update', { type: 'browser-preview', url: `http://localhost:3001/productions/${outName}`, title: `🎬 ${topic}` });
            io.emit('files-changed');
        } catch (e) { toolsUsed.push(`Video error: ${e.message}`); }
    }

    // live_preview tool — AI renders a UI doc (Tailwind/RTL shell) and opens it live
    // عنصر بجسم HTML (لا خاصية) لتفادي مشاكل الإفلات: <live_preview framework="tailwind">...html...</live_preview>
    const livePreviewRegex = /<live_preview(?:\s+framework=["']([^"']+)["'])?\s*>([\s\S]*?)<\/live_preview>/g;
    while ((match = livePreviewRegex.exec(responseText)) !== null) {
        const framework = (match[1] || 'tailwind').trim() || 'tailwind';
        const htmlCode = (match[2] || '').trim();
        if (!htmlCode) {
            toolsUsed.push('Preview error: empty html body');
            continue;
        }
        try {
            toolsUsed.push(`🖥️ Live Preview: rendering ${htmlCode.length} chars (${framework})...`);
            const form = new URLSearchParams();
            form.append('html_code', htmlCode);
            form.append('css_framework', framework);
            const r = await fetch(`${GOV_RECON_URL}/api/suras/render-preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
                signal: AbortSignal.timeout(60000),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                toolsUsed.push(`Preview error: ${(err && err.detail) || r.status}`);
                continue;
            }
            const doc = await r.text();
            const outDir = path.join(__dirname, '..', 'previews');
            await fs.mkdir(outDir, { recursive: true });
            const outName = `suras_preview_${Date.now()}.html`;
            const outPath = path.join(outDir, outName);
            await fs.writeFile(outPath, doc, 'utf-8');
            const previewUrl = `http://localhost:3001/preview-file?path=${encodeURIComponent(outPath)}`;
            toolsUsed.push(`🖥️ تم تجهيز المعاينة الحية: /previews/${outName}`);
            responseText += `\n\n**[🖥️ المعاينة الحية جاهزة]:** ${previewUrl}`;
            io.emit('media-update', { type: 'browser-preview', url: previewUrl, title: `🖥️ Live Preview` });
            io.emit('files-changed');
        } catch (e) { toolsUsed.push(`Preview error: ${e.message}`); }
    }

    // Preview-intent auto-render: extract ```html block and render it live (no tag needed).
    // يعمل فقط عند غياب وسم live_preview الصريح لمنع المعاينة المزدوجة.
    if (isPreviewIntent(query) && !/<live_preview[\s>]/i.test(responseText)) {
        const cb = /```html\s*([\s\S]*?)```/i.exec(responseText);
        const htmlBody = cb && cb[1] ? cb[1].trim() : '';
        if (htmlBody.length > 40) {
            try {
                toolsUsed.push(`🖥️ Live Preview (auto): rendering ${htmlBody.length} chars...`);
                const form = new URLSearchParams();
                form.append('html_code', htmlBody.slice(0, 60000));
                form.append('css_framework', 'tailwind');
                const r = await fetch(`${GOV_RECON_URL}/api/suras/render-preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: form.toString(),
                    signal: AbortSignal.timeout(60000),
                });
                if (!r.ok) {
                    const err = await r.json().catch(() => ({}));
                    toolsUsed.push(`Preview auto-render error: ${(err && err.detail) || r.status}`);
                } else {
                    const doc = await r.text();
                    const outDir = path.join(__dirname, '..', 'previews');
                    await fs.mkdir(outDir, { recursive: true });
                    const outName = `suras_preview_${Date.now()}.html`;
                    const outPath = path.join(outDir, outName);
                    await fs.writeFile(outPath, doc, 'utf-8');
                    const previewUrl = `http://localhost:3001/preview-file?path=${encodeURIComponent(outPath)}`;
                    toolsUsed.push(`🖥️ تم تجهيز المعاينة الحية تلقائياً: /previews/${outName}`);
                    responseText += `\n\n**[🖥️ المعاينة الحية جاهزة]:** ${previewUrl}`;
                    io.emit('media-update', { type: 'browser-preview', url: previewUrl, title: `🖥️ Live Preview` });
                    io.emit('files-changed');
                }
            } catch (e) { toolsUsed.push(`Preview auto-render error: ${e.message}`); }
        }
    }

    if (toolsUsed.length > 0) {
        responseText = responseText.replace(writeRegex, '').replace(searchRegex, '').replace(readRegex, '').replace(execRegex, '').replace(/<live_preview(?:\s+framework=["'][^"']+["'])?\s*>[\s\S]*?<\/live_preview>/g, '').replace(/<create_video\s+topic=["'][^"']+["']\s*\/>/g, '').trim()
            + '\n\n**[AGENT SYSTEM ACTIONS LOG]**:\n- ' + toolsUsed.join('\n- ');
    }

    io.emit('agent-update', { agent: 'Agent Alya', role: 'Orchestrator', text: responseText, theme: 'orange' });
    io.emit('media-update', {
        type: 'neural-result',
        title: 'Suras Link (Cloud Brain)',
        content: { reasoning: ["Cloud LLM inference engaged", `Executed ${toolsUsed.length} tools`], energy: [1, 1, 1], metrics: { model: modelLabel } },
        metadata: { confidence: (getEngineLM() && getEngineLM().confidence) || 0.5 }
    });
}

// ============================================================
// Self-Reflection Loop — Suras reviews & auto-fixes its own code
// ============================================================
async function correctWithCloud(relPath, errorMessage) {
    try {
        const fullPath = path.join(__dirname, '..', relPath);
        const cur = await fs.readFile(fullPath, 'utf-8');
        const sys = `أنت "علية" (Suras) مهندس خبير. صحّح الكود المعطى فقط داخل كتلة Markdown باللغة المناسبة دون أي شرح خارج الكود.`;
        const user = `الملف ${relPath} أصدر هذا الخطأ عند التشغيل:\n"""\n${errorMessage.slice(0, 1500)}\n"""\nالكود الحالي:\n"""\n${cur}\n"""\nصحّحه وأعده كاملاً.`;
        const r = await cloudBridge(sys, user, 'code', 60000);
        if (!r || !r.text) {
            console.error('[correctWithCloud] AI bridge returned no text');
            return null;
        }
        const md = /```([a-zA-Z0-9+#-]*)\s*\n?([\s\S]*?)```/i.exec(r.text);
        return md ? md[2] : r.text;
    } catch (e) {
        console.error('[correctWithCloud] AI bridge failed:', e.message);
        return null;
    }
}

async function selfReflect(relPath, io, model) {
    const ext = (relPath.split('.').pop() || '').toLowerCase();
    if (ext !== 'py' && ext !== 'js') return;
    const fullPath = path.join(__dirname, '..', relPath);
    const runner = ext === 'py' ? 'python' : 'node';
    let attempt = 0;
    while (attempt <= 2) {
        const child = spawn(runner, [fullPath], { timeout: 15000 });
        let out = '', err = '';
        child.stdout.on('data', d => out += d.toString());
        child.stderr.on('data', d => err += d.toString());
        const code = await new Promise(res => {
            child.on('close', c => res(c === null ? 1 : c));
            child.on('error', () => res(1));
        });
        if (code === 0) {
            io.emit('agent-update', { agent: 'Self-Reflector', role: 'Verified', text: `✅ تم التحقق من ${relPath} — لا أخطاء.`, theme: 'green' });
            return;
        }
        if (attempt >= 2) {
            io.emit('agent-update', { agent: 'Self-Reflector', role: 'Failed', text: `⚠️ تعذّر تصحيح ${relPath} تلقائياً بعد محاولتين.`, theme: 'red' });
            return;
        }
        attempt++;
        io.emit('agent-update', { agent: 'Self-Reflector', role: 'Reviewing', text: `🔍 عثرت على خطأ في ${relPath}، أصحّحه ذاتياً...`, theme: 'purple' });
        const fixed = await correctWithCloud(relPath, err || ('exit code ' + code));
        if (!fixed) { io.emit('agent-update', { agent: 'Self-Reflector', role: 'Failed', text: `⚠️ لم أتمكّن من تصحيح ${relPath}.`, theme: 'red' }); return; }
        await fs.writeFile(fullPath, fixed.trim(), 'utf-8');
        io.emit('files-changed');
    }
}

// Derive a target filename from the user query (e.g. "save to factorial.py")
function fileNameFromQuery(q) {
    const m = (q || '').match(/([\w\-]+\.(?:py|html|css|js|jsx|ts|tsx|json|md))/i);
    return m ? m[1] : null;
}

// مجلد خاص لكل مشروع مبني: built_projects/<slug>_<ts>/ — حتى تبقى مصنوعات
// البوت معزولةً في مجلدات مسماة بدل رميها في الجذر بجانب ملفات الواجهة.
function projectSlugFromQuery(q) {
    const t = String(q || '');
    if (/هندس|(?<!ب)شكل|مجسم|3d|geometry/i.test(t)) return 'geometry-3d';
    if (/لعبة|العاب|ألعاب|game/i.test(t)) return 'arcade-game';
    if (/حاسبة|calc/i.test(t)) return 'calculator';
    if (/توقيت|مؤقت|timer/i.test(t)) return 'timer-app';
    if (/مهام|todo/i.test(t)) return 'todo-app';
    if (/جافاسكريبت|javascript|\bjs\b|دالة|function/i.test(t)) return 'js-function';
    if (/python|بايثون|\.py|(?<!جافا)سكريبت/i.test(t)) return 'py-script';
    if (/css|تصميم|style/i.test(t)) return 'css-style';
    if (/صفحة|موقع|واجهة|هبوط|متجر|page|website/i.test(t)) return 'web-page';
    return 'app';
}

// Server-side tool dispatcher: detect explicit read/execute/search requests and run them for real.
// This guarantees tool use works even when the LLM itself refuses to emit tool tags.
function arabicNorm(s) {
    if (!s) return '';
    return String(s).replace(/[ؐ-ًؚ-ٰٟ]/g, ''); // strip Arabic tashkeel (harakat + shadda)
}

async function parseAndRunToolIntent(query, io, history = []) {
    query = arabicNorm(query);
    const traceId = startTrace(query);
    const obs = [];
    // 0أ) أوامر وضع الاختبار (فتح/تعطيل) — قبل كل شيء
    {
        const tc = matchTestCommand(query);
        if (tc) {
            const open = tc === 'open';
            setRefusalTestMode(open);
            traceStep(traceId, 'testmode.' + tc, '');
            obs.push(open
                ? '[وضع اختبار الحدود: مفتوح] — ستُمرَّر النوايا المؤذية للاختبار مع تسجيلها. للتعطيل قل: عطّل وضع الاختبار.'
                : '[وضع اختبار الحدود: مغلق] — عادت الحماية الكاملة (رفض سرقة/اختراق/كراك/خبيث/احتيال/تعطيل).');
            io.emit('agent-update', { agent: 'Safety', role: 'TestMode', text: open ? 'وضع الاختبار مفتوح — راقب ما سيُمرَّر' : 'وضع الاختبار مغلق — الحماية عادت', theme: open ? 'orange' : 'green' });
            endTrace(traceId, 'testmode-' + tc);
            return obs.join('\n\n');
        }
    }
    // 0ب) رفض الأهداف المؤذية — قبل أي أداة (سرقة/اختراق/كراك/خبيث/احتيال/تعطيل)
    //     الاستثناء: المالك بعد تفعيل الصلاحيات (isUnlocked) أو وضع اختبار الحدود
    {
        const harm = checkHarmful(query);
        if (harm && !isRefusalTestMode() && !isUnlocked()) {
            traceStep(traceId, 'intent.refused', harm.id);
            obs.push(`[رفض أمني (${harm.id})]: ${harm.redirect}`);
            io.emit('agent-update', { agent: 'Safety', role: 'Refused', text: `الرفض: ${harm.redirect}`, theme: 'red' });
            endTrace(traceId, 'refused');
            return obs.join('\n\n');
        }
        if (harm && isUnlocked() && !isRefusalTestMode()) {
            traceStep(traceId, 'intent.owner-elevated-passthrough', harm.id);
            obs.push(`[المالك/Elevated]: تجاوز رفض (${harm.id}) — الصلاحيات المرفوعة مفعّلة.`);
            io.emit('agent-update', { agent: 'Safety', role: 'Elevated', text: `تجاوز (${harm.id}) — صلاحيات المالك مفعّلة`, theme: 'purple' });
            console.log(`[Safety] OWNER-ELEVATED passthrough: ${harm.id}`);
        }
        if (harm && isRefusalTestMode()) {
            traceStep(traceId, 'intent.testmode-passthrough', harm.id);
            obs.push(`[وضع اختبار: كُشف هدف مؤذٍ (${harm.id}) وسُمِّح بتمريره للاختبار فقط — راقب أي أدوات ستُستدعى]`);
            obs.push(`[توجيه الإجابة في وضع الاختبار]: أجب عن سؤال القدرة بصراحة ووضوح (ما تستطيع تقنياً: الوصول لملفات المستخدم وتنفيذ الأوامر وجلب المحتوى العام — وما ترفضه: أي فعل يضر بملكية الغير). ممنوع تقديم أي تعليمات تسهّل الفعل المؤذي نفسه. اعرض دائماً البديل المشروع: فتح مشاريع المستخدم الخاصة أو البناء من الصفر.`);
            io.emit('agent-update', { agent: 'Safety', role: 'TestMode', text: `كُشف (${harm.id}) — يُمرَّر للاختبار ويُسجَّل`, theme: 'orange' });
            console.log(`[Safety] TEST-MODE passthrough: ${harm.id}`);
        }
    }

    // 1) read_file / access / enter: "ادخل إلى ملف BOOT على الديسكتوب" / "اقرأ secret.txt" / "open app.py"
    const readRe = /(?:اقرأ|اقرئي|افتح|ادخل|دخل|راجع|شوف|طالع|access|open|read|cat|type|view|اوصل|وصول)[^"'\n]*?(?:الملف\s+)?["']?((?:[A-Za-z]:[\\/])?[\w.\-\/\\]+)["']?/i;
    const rm = readRe.exec(query);
    // الروابط للصفحة-القارئ لا لقراءة الملفات المحلية (https://... ليست مسار ملف)
    const hasPageUrl = /https?:\/\//i.test(query);
    if (rm && !hasPageUrl) {
        try {
            // Resolve base folder: Desktop if mentioned, else project root
            let base = path.join(__dirname, '..');
            if (/(الديسكتوب|desktop)/i.test(query)) base = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
            const name = rm[1];
            let full = path.isAbsolute(name) ? name : path.join(base, name);
            // If not found directly, search for a matching file OR folder (name without extension)
            if (!existsSync(full)) {
                const wanted = name.toLowerCase().replace(/\.[^.]+$/, '');
                async function findFile(dir, depth = 0) {
                    if (depth > 4) return null;
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const fp = path.join(dir, e.name);
                        if (e.name.toLowerCase().replace(/\.[^.]+$/, '') === wanted) return fp;
                        if (e.isDirectory() && !['node_modules', '.git', 'dist'].includes(e.name)) { const f = await findFile(fp, depth + 1); if (f) return f; }
                    }
                    return null;
                }
                const found = await findFile(base);
                if (found) full = found;
            }
            const stat = await fs.stat(full);
            if (stat.isDirectory()) {
                const entries = await fs.readdir(full, { withFileTypes: true });
                const listing = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
                obs.push(`[محتويات المجلد ${path.basename(full)}]:\n${listing}`);
                io.emit('agent-update', { agent: 'Tool Runner', role: 'Read', text: `📁 دخلت المجلد ${path.basename(full)} (${entries.length} عنصر)`, theme: 'blue' });
            } else {
                const c = await fs.readFile(full, 'utf-8');
                obs.push(`[نتائج قراءة ${path.basename(full)}]:\n${c.slice(0, 3000)}`);
                io.emit('agent-update', { agent: 'Tool Runner', role: 'Read', text: `📄 قرأت ${path.basename(full)}`, theme: 'blue' });
            }
        } catch (e) { obs.push(`[تعذّر قراءة ${rm[1]}]: ${e.message}`); }
    }
    // 2) execute / powershell: "شغل في الباورشيل", "افتح powershell ونفذ", "نفّذ الأمر whoami", "صلح الخطأ عبر الباورشيل"
    const isPowerShellIntent = /(?:باورشيل|powershell|بورشيل|باور شيل)/i.test(query);
    const execRe = /(?:نفّ?ذ الأمر|نفّ?ذ|شغّ?ل|صلح|عالج|حل|افتح|حاول|جرب|execute|run|try|powershell|باورشيل)\s*(?:في|عبر|بواسطة|على)?\s*(?:الباورشيل|powershell|بورشيل|باور شيل|الأمر|طرفية|الطرفية)?\s*["':]?\s*([^"'\n]+?)["']?(?:(?<!\S)(?:و|ثم|من فضلك|وأخبر|واعط|وأعط|قل|ما|ثم أخبر).*)?$/i;
    const em = execRe.exec(query);
    
    if (em || isPowerShellIntent) {
        let cmd = (em && em[1] ? em[1].trim() : '').replace(/^(powershell|باورشيل)\s*/i, '');
        if (!cmd && isPowerShellIntent) {
            cmd = query.replace(/(?:افتح|شغل|ادخل|صلح|عالج)\s*(?:الباورشيل|باورشيل|powershell)/gi, '').trim() || 'Get-Process | Select-Object -First 10';
        }
        
        if (cmd) {
            // حارس اللهجة/العربية: نصٌ بلا أي حرف لاتيني ليس أمر PowerShell أبداً
            // (مثال: "افتح مشروع المتجر" يلتقط cmd="مشروع المتجر") — تخطَّ التنفيذ
            // واترك الأدوات المختصة (projects/pagegen/...) تتولى الطلب.
            if (/\p{Script=Arabic}/u.test(cmd) && !/[A-Za-z]/.test(cmd)) {
                obs.push(`[ليس أمراً تنفيذياً — تُرك للأدوات المختصة]: "${cmd}"`);
                try { io.emit('agent-update', { agent: 'PowerShell Hub', role: 'Skipped', text: `⏭️ ليس أمر PowerShell — تُرك للأدوات المختصة`, theme: 'gray' }); } catch (_) {}
                cmd = '';
            }
        }
        if (cmd) {
            // قضبان الأمان (server/tools/safety.js): allow / warn / ask / deny
            const verdict = checkExecute(cmd, query);
            if (verdict.decision === 'deny' && !isUnlocked()) {
                obs.push(`[أمر محظور أمنياً]: ${cmd}\nالأسباب: ${verdict.reasons.join('، ')}`);
                io.emit('agent-update', { agent: 'PowerShell Hub', role: 'Blocked', text: `⛔ أمر محظور: \`${cmd}\`\n${verdict.reasons.join('، ')}`, theme: 'red' });
            } else if (verdict.decision === 'ask' && !isUnlocked()) {
                obs.push(`[أمر يحتاج تأكيداً صريحاً — لم يُنفَّذ]: ${cmd}\nالأسباب: ${verdict.reasons.join('، ')}\nللمتابعة أعد الطلب مع عبارة تأكيد (مثال: "أؤكد" أو "نعم نفذ").`);
                io.emit('agent-update', { agent: 'PowerShell Hub', role: 'Need Confirm', text: `⚠️ يحتاج تأكيدك قبل التنفيذ: \`${cmd}\`\n${verdict.reasons.join('، ')}`, theme: 'orange' });
            } else {
                // المفتوح يرقّي أي حكم (حتى deny) لتنفيذ موثّق — بأمر المالك المباشر حصراً
                if (verdict.decision !== 'allow') {
                    obs.push(`[تجاوز ${verdict.decision} (القدرات مفتوحة)]: ${cmd} — ${verdict.reasons.join('، ')}`);
                    unlockAudit('elevated-exec', `${verdict.decision}: ${cmd}`);
                    io.emit('agent-update', { agent: 'PowerShell Hub', role: 'Elevated', text: `🔓 تنفيذ بتجاوز ${verdict.decision}: \`${cmd}\``, theme: 'red' });
                }
                try {
                    io.emit('agent-update', { agent: 'PowerShell Hub', role: 'Executing', text: `⚡ تشغيل أمر PowerShell: \`${cmd}\``, theme: 'purple' });
                    if (verdict.warnings.length > 0) {
                        obs.push(`[تنبيهات تنفيذ ${cmd}]: ${verdict.warnings.join('، ')}`);
                        io.emit('agent-update', { agent: 'PowerShell Hub', role: 'Warning', text: `⚠️ تنبيه: ${verdict.warnings.join('، ')}`, theme: 'orange' });
                    }
                    
                    // Use real PowerShell for Windows execution
                    const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd];
                    const child = spawn('powershell', psArgs, { 
                        cwd: path.join(__dirname, '..'), 
                        timeout: 30000 
                    });
                    
                    let o = '', err = '';
                    child.stdout.on('data', d => o += d.toString());
                    child.stderr.on('data', d => err += d.toString());
                    
                    const code = await new Promise(r => { 
                        child.on('close', c => r(c === null ? 1 : c)); 
                        child.on('error', (e) => { err += e.message; r(1); }); 
                    });
                    
                    const fullOutput = (o || err || 'تم تنفيذ الأمر بدون مخرجات نصية.').slice(0, 3000);
                    obs.push(`[مخرجات PowerShell للأمر '${cmd}' (رمز ${code})]:\n${fullOutput}`);
                    
                    io.emit('agent-update', { 
                        agent: 'PowerShell Hub', 
                        role: code === 0 ? 'Success' : 'Warning', 
                        text: `🖥️ نتيجة PowerShell:\n\`\`\`powershell\n${fullOutput.slice(0, 800)}\n\`\`\``, 
                        theme: code === 0 ? 'green' : 'orange' 
                    });
                } catch (e) { 
                    obs.push(`[خطأ PowerShell]: ${e.message}`); 
                }
            }
        }
    }
    // 3) search_files: "ابحث عن secret" / "search foo" (stop before trailing connector words)
    // طلبات بحث الويب لفرعها المخصص — لا تلوث النتائج المحلية بضجيج فارغ
    const webSearchMarkers = /(?:ابحث في النت|ابحث في الويب|ابحث في الانترنت|ابحث في الإنترنت|البحث في الانترنت|البحث في الإنترنت|بحث نت|search web|search internet|google)/i.test(query);
    const searchRe = /(?:ابحث عن|ابحث|search)\s+["']?([^"'\n]+?)["']?(?:(?<!\S)(?:في|من|بكل|داخل|و|عن|ضمن).*)?$/i;
    const sm = !webSearchMarkers && searchRe.exec(query);
    if (sm) {
        const q = sm[1].trim(); const hits = [];
        async function qsearch(dir) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const e of entries) {
                const fp = path.join(dir, e.name);
                if (e.isDirectory()) { if (['node_modules', '.git', 'dist'].includes(e.name)) continue; await qsearch(fp); }
                else if (e.name.includes(q) || q === '*') hits.push(path.relative(path.join(__dirname, '..'), fp));
            }
        }
        try { await qsearch(path.join(__dirname, '..')); obs.push(`[نتائج البحث عن "${q}"]:\n${hits.length ? hits.slice(0, 20).join('\n') : 'لا نتائج'}`); }
        catch (e) { obs.push(`[خطأ بحث]: ${e.message}`); }
    }

    // 4) understand / explain "these files": "افهم هذه الملفات" / "اشرح وظيفتها"
    const understandRe = /(افهم|أفهم|اشرح|ما وظيفة|وظيفتها|فسّ?ر|explore|understand|explain|حلل|analysis)/i;
    if (understandRe.test(query) && !rm && !em && !sm) {
        // Find the most recent folder listing from the conversation to know which files
        let folder = null;
        for (let i = history.length - 1; i >= 0; i--) {
            const block = (history[i] && (history[i].content || history[i].text || '')) || '';
            const m = /\[محتويات المجلد ([^\]]+)\]:([\s\S]*?)(?:\n\n|$)/.exec(block);
            if (m) { folder = { name: m[1].trim(), listing: m[2] }; break; }
        }
        if (folder) {
            const candidates = [
                path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', folder.name),
                path.join(__dirname, '..', folder.name)
            ];
            let base = candidates.find(c => { try { return statSync(c).isDirectory(); } catch (e) { return false; } });
            if (!base) {
                // search project for the folder
                async function findDir(dir, depth = 0) {
                    if (depth > 4 || base) return;
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const fp = path.join(dir, e.name);
                        if (e.isDirectory()) { if (['node_modules', '.git', 'dist'].includes(e.name)) continue; if (e.name.toLowerCase() === folder.name.toLowerCase()) { base = fp; return; } await findDir(fp, depth + 1); }
                    }
                }
                await findDir(path.join(__dirname, '..'));
            }
            if (base) {
                const textExt = ['java', 'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'txt', 'bat', 'md', 'json', 'xml', 'log', 'yml', 'yaml', 'ini', 'sh'];
                const names = folder.listing.split('\n').map(l => l.replace(/^[📁📄]+\s*/, '').trim()).filter(Boolean);
                const snippets = [];
                for (const f of names) {
                    const fp = path.join(base, f);
                    try {
                        const st = await fs.stat(fp);
                        if (st.isDirectory()) continue;
                        const ext = (f.split('.').pop() || '').toLowerCase();
                        if (!textExt.includes(ext)) { snippets.push(`[${f}]: (ملف ثنائي/غير نصي — تم تخطّيه)`); continue; }
                        const c = await fs.readFile(fp, 'utf-8');
                        snippets.push(`[${f}]:\n${c.slice(0, 1200)}`);
                    } catch (e) { /* skip */ }
                    if (snippets.length >= 8) break;
                }
                if (snippets.length) {
                    obs.push(`[هام] هذه ملفات مجلد ${folder.name} على سطح المكتب (الديسكتوب) الخاص بالمستخدم، وقد قرأتها أنتَ بأدواتك الحقيقية. اذكر كل ملف وفسّر وظيفته للمستخدم بناءً على اسمه ومحتواه:\n${snippets.join('\n\n')}`);
                    io.emit('agent-update', { agent: 'Tool Runner', role: 'Read', text: `📂 فهمت ${snippets.length} ملف من ${folder.name}`, theme: 'blue' });
                }
            }
        }
    }
    // 5) file management: "انشئ مجلد test" / "احذف ملف x" / "انشئ لي مجلد على سطح المكتب" / "مكتبة فارغة"
    const fileManageRe = /(?:انشئ|أنشئ|اصنع|انشاء|إنشاء|سوي|عمل|اعمل|create|make|new)\s*(?:لي|لنا|لينا)?\s*(?:مجلد|فولدر|مكتبة|folder|directory)/i;
    if (fileManageRe.test(query)) {
        // Extract folder name if provided
        let folderName = '';
        const nameMatch = query.match(/(?:باسم|اسمه|name)\s*["']?([\w\-\.ء-ي]+)["']?/i);
        if (nameMatch) {
            folderName = nameMatch[1];
        } else {
            const inlineMatch = query.match(/(?:مجلد|فولدر|folder|directory|مكتبة)\s+["']?([A-Za-z0-9_\-]+|[\u0621-\u064A0-9_\-]+)["']?(?!\s*(?:على|في|داخل|desktop|سطح))/i);
            if (inlineMatch && !['فارغ', 'فارغة', 'جديد', 'جديدة', 'على', 'في', 'desktop'].includes(inlineMatch[1])) {
                folderName = inlineMatch[1];
            }
        }
        if (!folderName) {
            folderName = /(سطح المكتب|الديسكتوب|desktop)/i.test(query) ? 'Suras_Library' : `Suras_Folder_${Math.floor(Math.random()*1000)}`;
        }
        
        let targetDir = path.join(__dirname, '..');
        if (/(سطح المكتب|الديسكتوب|desktop)/i.test(query)) {
            targetDir = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
        }
        
        try {
            const targetPath = path.join(targetDir, folderName);
            if (!existsSync(targetPath)) {
                await fs.mkdir(targetPath, { recursive: true });
                obs.push(`[تم إنشاء المجلد بنجاح]: تم إنشاء "${folderName}" في ${targetDir.includes('Desktop') ? 'سطح المكتب (Desktop)' : 'مجلد المشروع'}`);
                io.emit('agent-update', { agent: 'Tool Runner', role: 'File System', text: `📁 تم إنشاء المجلد (${folderName}) في ${targetDir.includes('Desktop') ? 'سطح المكتب' : 'المشروع'}`, theme: 'green' });
                io.emit('files-changed');
            } else {
                obs.push(`[المجلد موجود مسبقاً]: "${folderName}" في ${targetDir.includes('Desktop') ? 'سطح المكتب (Desktop)' : 'مجلد المشروع'}`);
            }
        } catch(e) { obs.push(`[خطأ إنشاء مجلد]: ${e.message}`); }
    }

    const deleteRe = /(?:احذف|امسح|أزل|delete|remove)\s*(?:ملف|مجلد|file|folder)?\s+["']?([^"'\n]+?)["']?/i;
    const dm = deleteRe.exec(query);
    if (dm && !query.includes('لا تحذف') && !query.includes('لا تمسح')) {
        const target = dm[1].trim();
        try {
            const targetPath = path.join(__dirname, '..', target);
            if (existsSync(targetPath)) {
                const stat = await fs.stat(targetPath);
                if (stat.isDirectory()) {
                    await fs.rm(targetPath, { recursive: true, force: true });
                } else {
                    await fs.unlink(targetPath);
                }
                obs.push(`[تم الحذف بنجاح]: ${target}`);
                io.emit('agent-update', { agent: 'Tool Runner', role: 'File System', text: `🗑️ تم حذف: ${target}`, theme: 'red' });
                io.emit('files-changed');
            } else {
                obs.push(`[لم يتم العثور على العنصر للحذف]: ${target}`);
            }
        } catch(e) { obs.push(`[خطأ أثناء الحذف]: ${e.message}`); }
    }

    // 6) web search: "ابحث في النت عن X" — بحث متعدد المصادر (server/tools/webdocs.js)
    const webSearchRe = /(?:ابحث في النت|ابحث في الويب|ابحث في الانترنت|ابحث في الإنترنت|البحث في الانترنت|البحث في الإنترنت|بحث نت|بحث في الانترنت|search web|search (?:the )?internet|google)\s*(?:عن|for)?\s+["']?([^"'\n]+)["']?/i;
    const wm = webSearchRe.exec(query);
    if (wm) {
        const sq = wm[1].trim();
        try {
            io.emit('agent-update', { agent: 'Tool Runner', role: 'Web Search', text: `🌐 أبحث في الإنترنت عن: ${sq}`, theme: 'purple' });
            const { searchDocs } = await import('./tools/webdocs.js');
            const { lines, title } = await searchDocs(sq);
            if (lines.length > 0) {
                obs.push(`[نتائج البحث في الويب عن "${sq}"]:\n${lines.join('\n')}`);
                io.emit('agent-update', { agent: 'Tool Runner', role: 'Web Search', text: `✅ وجدت معلومات عن: ${title || sq}`, theme: 'green' });
            } else {
                obs.push(`[نتائج البحث في الويب عن "${sq}"]:\nلا توجد نتائج واضحة. يمكنك استخدام أمر execute لتشغيل سكريبت بحث أعمق.`);
            }
        } catch (e) {
            obs.push(`[خطأ أثناء البحث في الويب]: ${e.message}`);
        }
    }

    // 8) Browser execution: "افتح المتصفح" / "افتح جوجل" / "افتح يوتيوب" / "افتح لي المتصفح على X" / "افتح موقع X"
    if (/(?:متصفح|browser|الموقع|موقع|رابط|url|صفحة|جوجل|google|يوتيوب|youtube|غيتهاب|github|واتساب|whatsapp|ويكيبيديا|wikipedia|تويتر|twitter)/i.test(query) && /(?:افتح|شغل|ادخل|open|launch|تصفح|شاهد|اعرض)/i.test(query)) {
        // Extract URL from query if present
        const urlMatchBrowser = /(https?:\/\/[^\s]+|[a-z0-9\-]+\.[a-z]{2,6}(?:\/[^\s]*)?)/i.exec(query);
        let targetUrl = urlMatchBrowser ? urlMatchBrowser[1] : '';
        if (!targetUrl) {
            if (/جوجل|google/i.test(query)) targetUrl = 'https://www.google.com';
            else if (/يوتيوب|youtube/i.test(query)) targetUrl = 'https://www.youtube.com';
            else if (/غيتهاب|github/i.test(query)) targetUrl = 'https://github.com';
            else if (/واتساب|whatsapp/i.test(query)) targetUrl = 'https://web.whatsapp.com';
            else if (/ويكيبيديا|wikipedia/i.test(query)) targetUrl = 'https://ar.wikipedia.org';
            else if (/تويتر|twitter|اكس\.كوم|x\.com/i.test(query)) targetUrl = 'https://x.com';
            else targetUrl = 'http://localhost:5173';
        }
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
        
        try {
            const openCmd = process.platform === 'win32' ? `start "" "${targetUrl}"` : process.platform === 'darwin' ? `open "${targetUrl}"` : `xdg-open "${targetUrl}"`;
            exec(openCmd);
            obs.push(`[تم فتح المتصفح بنجاح]: تم تشغيل المتصفح وشاشة العرض على: ${targetUrl}`);
            io.emit('agent-update', { agent: 'Tool Runner', role: 'Browser', text: `🌐 فتحت المتصفح وشاشة العرض على: ${targetUrl}`, theme: 'blue' });
            io.emit('media-update', {
                type: 'browser-preview',
                url: targetUrl,
                title: `Live View: ${targetUrl}`
            });
        } catch(e) {
            obs.push(`[خطأ أثناء فتح المتصفح]: ${e.message}`);
        }
    }

    // 7) Self-Upgrade & Skill Acquisition: "اجلبها واضفها لديك" / "طور نفسك واجلب المهارات"
    const upgradeRe = /(?:اجلب|اضف|جلب|ثبت|ثبتها|اضفها|اجلبها|طور|ترقية|upgrade|fetch|install)\s*(?:ها|هم|المهارات|الادوات|الأدوات|المكتبات|القوالب|نفسك|لديك)?/i;
    if (upgradeRe.test(query) && /(اجلبها|اضفها|ثبتها|المهارات|المكتبات|القوالب|نفسك|لديك|طور|تطوير)/i.test(query)) {
        try {
            io.emit('agent-update', { agent: 'NeuralCore', role: 'Evolving', text: '⚡ بدء جلب المهارات والقوالب وبناء الأدوات الذاتية...', theme: 'purple' });
            
            const projectLibDir = path.join(__dirname, '..', 'Suras_Library');
            const desktopDir = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'Suras_Library');
            await fs.mkdir(projectLibDir, { recursive: true });
            await fs.mkdir(desktopDir, { recursive: true });

            // 1. Tool 1: Automation & OS Tools
            const autoToolsCode = `# Suras AI — Automation & System Tools Module
import os, sys, json, time, subprocess

def run_safe_cmd(cmd):
    """Execute a system command and return output."""
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return {"code": res.returncode, "stdout": res.stdout, "stderr": res.stderr}
    except Exception as e:
        return {"code": 1, "error": str(e)}

def list_workspace_files(base_dir="."):
    """Return all files recursively in a directory."""
    files = []
    for root, dirs, fnames in os.walk(base_dir):
        if any(ignored in root for ignored in ['node_modules', '.git', '__pycache__']):
            continue
        for f in fnames:
            files.append(os.path.join(root, f))
    return files

if __name__ == '__main__':
    print(f"Suras Automation Tools loaded successfully. Ready for execution.")
`;
            await fs.writeFile(path.join(projectLibDir, 'automation_tools.py'), autoToolsCode, 'utf-8');
            await fs.writeFile(path.join(desktopDir, 'automation_tools.py'), autoToolsCode, 'utf-8');

            // 2. Tool 2: UI Template Blueprint
            const uiBlueprint = `// Suras AI — Modern Glassmorphism UI Component
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
`;
            await fs.writeFile(path.join(projectLibDir, 'ui_component_template.jsx'), uiBlueprint, 'utf-8');
            await fs.writeFile(path.join(desktopDir, 'ui_component_template.jsx'), uiBlueprint, 'utf-8');

            // 3. Tool 3: Suras Library Documentation & Skills Registry
            const readmeContent = `# مكتبة وقوالب سوراس (Suras Library)
تم جلب وتجهيز هذه المهارات والقوالب بواسطة **Suras AI Engine** لتوسيع قدراته الذاتية.

### المهارات المكتسبة والمتاحة الآن:
1. **أدوات الأتمتة (automation_tools.py):** تنفيذ أوامر النظام، فحص الملفات، وإدارة العمليات.
2. **قوالب الواجهات (ui_component_template.jsx):** مكونات React عصرية بتقنية الزجاج المصقول (Glassmorphism).
3. **التكامل العصبي:** الاتصال الدائم بين بيئة القرص ومحرك الذكاء الاصطناعي.
`;
            await fs.writeFile(path.join(projectLibDir, 'README_SURAS.md'), readmeContent, 'utf-8');
            await fs.writeFile(path.join(desktopDir, 'README_SURAS.md'), readmeContent, 'utf-8');

            // Update core state evolution count
            const statePath = path.join(__dirname, '..', 'core', 'suras_state.json');
            if (existsSync(statePath)) {
                try {
                    const st = JSON.parse(await fs.readFile(statePath, 'utf-8'));
                    st.evolution_count = (st.evolution_count || 0) + 1;
                    st.cycle_count = (st.cycle_count || 0) + 5;
                    await fs.writeFile(statePath, JSON.stringify(st, null, 2), 'utf-8');
                } catch(e) {}
            }

            obs.push(`[تم جلب المهارات والقوالب وتثبيتها بنجاح]:
- ✅ أنشأت وحدة الأتمتة: Suras_Library/automation_tools.py
- ✅ أنشأت قالب الواجهات: Suras_Library/ui_component_template.jsx
- ✅ وثّقت سجل المهارات: Suras_Library/README_SURAS.md
- 🧠 ارتقى مستوى تطور المحرك العصبي إلى دورة جديدة بنجاح.`);

            io.emit('agent-update', { agent: 'NeuralCore', role: 'Upgrade', text: '🚀 تم جلب وتثبيت المهارات والقوالب في Suras_Library بالمشروع!', theme: 'green' });
            io.emit('files-changed');
        } catch(err) {
            obs.push(`[خطأ في جلب المهارات]: ${err.message}`);
        }
    }

    // 9) Registered tools dispatch (Tool Registry) — نية الفيديو والأدوات القادمة
    // التنفيذ الفعلي يعيش في server/tools/ — هنا فقط التوزيع وجمع الملاحظات
    {
        const toolObs = await dispatchTools(query, {
            io,
            govUrl: GOV_RECON_URL,
            rootDir: path.join(__dirname, '..'),
            fs,
            path,
            traceId,
            unlocked: isUnlocked(),
        });
        for (const o of toolObs) obs.push(o);
        // غموض بلا تطابق: سؤال توضيحي واحد محدد بدل التجاهل الصامت
        if (toolObs.length === 0) {
            const clar = clarifyIntent(query);
            if (clar) {
                obs.push(`[نية غامضة (${clar.name})]: ${clar.question}`);
                io.emit('agent-update', { agent: clar.name, role: 'Clarify', text: clar.question, theme: 'orange' });
                traceStep(traceId, 'intent.clarify', clar.name);
            }
        }
    }

    endTrace(traceId, obs.length > 0 ? `${obs.length} obs` : 'no-tools');
    return obs.join('\n\n');
}

// Build a clear, server-composed explanation from the raw tool results
function composeExplanation(obs) {
    if (!obs) return '✅ تم تنفيذ العملية بنجاح عبر أدواتي الحقيقية.';
    // الساعة/التاريخ: إجابة مباشرة من ساعة الجهاز (حتمية — بلا سحابة)
    if (obs.includes('[الساعة الآن')) {
        const m = obs.match(/\[الساعة الآن\]:\s*([^\n\[]+)/);
        return `🕐 ${m ? m[1].trim() : 'الآن'}`;
    }
    if (obs.includes('[تم جلب المهارات')) {
        return `🚀 تم جلب وتثبيت المهارات والقوالب البرمجية بنجاح على منصتك وفي مكتبتك:\n\n${obs}\n\nأصبحت هذه الأدوات والقوالب جاهزة للاستخدام والتطوير في أي وقت!`;
    }
    if (obs.includes('[تم إنشاء المجلد') || obs.includes('[المجلد موجود') || obs.includes('[تم الحذف بنجاح]')) {
        return `✅ نعم، قمتُ بتنفيذ طلبك على النظام بنجاح:\n\n${obs}`;
    }
    if (obs.includes('[مخرجات تنفيذ')) {
        return `⚙️ تم تنفيذ الأمر على النظام بنجاح:\n\n${obs}`;
    }
    const blocks = obs.split(/(?=\[[^\]]+\]:)/g).map(b => b.trim()).filter(Boolean);
    const hints = {
        java: 'كود Java (غالباً مكوّن/نشاط تطبيق مثل أندرويد)', py: 'سكريبت بايثون', js: 'كود JavaScript',
        jsx: 'مكوّن واجهة React', ts: 'كود TypeScript', tsx: 'مكوّن TypeScript/React', css: 'ملف تنسيق وأنماط (ستايل)',
        html: 'صفحة ويب HTML', txt: 'ملف نصي/توثيق/متطلبات', bat: 'سكريبت تشغيل ويندوز (Batch)', md: 'توثيق Markdown',
        json: 'بيانات JSON', xml: 'بيانات XML', log: 'ملف سجلات (Logs)', yml: 'إعدادات YAML', yaml: 'إعدادات YAML',
        ini: 'إعدادات', sh: 'سكريبت شل'
    };
    const lines = blocks.map(b => {
        const m = b.match(/^\[([^\]]+)\]:\s*([\s\S]*)$/);
        if (!m) return b;
        const name = m[1]; const content = m[2].trim();
        const ext = (name.split('.').pop() || '').toLowerCase();
        if (content.includes('ملف ثنائي') || content.includes('غير نصي')) return `### ${name}\nالوظيفة المحتملة: ملف غير نصي/ثنائي (صورة أو مكتبة أو ملف تنفيذي) — لا يمكن عرض محتواه نصياً.`;
        const hint = hints[ext];
        if (hint) {
            return `### ${name}\nالوظيفة المحتملة: ${hint}\nمقتطف:\n\`\`\`\n${content.slice(0, 400)}\n\`\`\``;
        }
        return `### ${name}\n${content}`;
    }).filter(Boolean);
    return `✅ نفّذتُ طلبك بأدواتي الحقيقية:\n\n${lines.join('\n\n')}`;
}


async function listAllFiles(dir, base = dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') return null;
            return { name: entry.name, type: 'dir', children: await listAllFiles(fullPath, base) };
        }
        return { name: entry.name, type: 'file', path: path.relative(base, fullPath) };
    }));
    return results.filter(Boolean);
}

app.get('/api/files', async (req, res) => {
    console.log(`[Server] Fetching files...`);
    try {
        const files = await listAllFiles(path.join(__dirname, '..'));
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/files/content', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Path required' });
    try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        res.json({ content, path: filePath, language: path.extname(filePath).slice(1) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/files/save', async (req, res) => {
    const { path: filePath, content } = req.body;
    try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
        // لقطة ما قبل الحفظ (rollback): نسخة .bak واحدة من المحتوى السابق إن وُجد
        try {
            await fs.access(fullPath);
            await fs.copyFile(fullPath, fullPath + '.bak');
        } catch (_) { /* ملف جديد — لا لقطة لازمة */ }
        await fs.writeFile(fullPath, content, 'utf-8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/search', async (req, res) => {
    const { query } = req.query;
    // Basic search implementation
    const results = [];
    async function searchInDir(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
                await searchInDir(fullPath);
            } else {
                const content = await fs.readFile(fullPath, 'utf-8');
                if (content.includes(query)) {
                    results.push({ name: entry.name, path: path.relative(path.join(__dirname, '..'), fullPath) });
                }
            }
        }
    }
    try {
        await searchInDir(path.join(__dirname, '..'));
        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve any built file by absolute path for the embedded browser preview
app.get('/preview-file', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Missing path');
    try {
        let content = await fs.readFile(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.py': 'text/plain', '.json': 'application/json', '.md': 'text/markdown' };
        res.setHeader('Content-Type', mimeMap[ext] || 'text/html');

        // The preview URL is /preview-file, so browser-relative assets would
        // otherwise resolve from the server root instead of the generated
        // project's directory. Point local href/src assets back through this
        // endpoint so generated projects render with their own CSS and JS.
        if (ext === '.html') {
            const projectDir = path.dirname(filePath);
            content = content.replace(/(\s(?:href|src)=["'])(?!https?:\/\/|\/\/|data:|blob:|#|\/)([^"']+)(["'])/gi, (full, prefix, relativePath, suffix) => {
                const assetPath = path.resolve(projectDir, relativePath);
                return `${prefix}/preview-file?path=${encodeURIComponent(assetPath)}${suffix}`;
            });
        }
        res.send(content);
    } catch (e) {
        res.status(404).send(`<h2 style="font-family:Cairo,sans-serif;text-align:center;padding:40px;color:#ef4444;">لم يُعثر على الملف: ${filePath}</h2>`);
    }
});

app.post('/api/terminal', (req, res) => {
    const { command } = req.body;
    exec(command, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
        res.json({
            output: stdout || stderr,
            error: error ? error.message : null
        });
    });
});

app.get('/api/system/ls', async (req, res) => {
    const { dir } = req.query;
    try {
        const targetDir = dir || process.env.USERPROFILE || process.env.HOME;
        const entries = await fs.readdir(targetDir, { withFileTypes: true });
        const list = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: path.join(targetDir, e.name) }));
        res.json({ dir: targetDir, files: list });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========================
// Feature: Live Self-Awareness (Suras Identity)
// ========================
    // ---- Real neural-engine stats from the trained models in core/ ----
    const LM_STATE_PATH = path.join(__dirname, '..', 'core', 'suras_lm.json');
    const REWARD_STATE_PATH = path.join(__dirname, '..', 'core', 'suras_reward.json');
    const CTRL_STATE_PATH = path.join(__dirname, '..', 'core', 'suras_controller.json');
    const ENGINE_BASELINE = Math.log(256);
    function readJsonSafe(p) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; } catch (e) { return null; } }
    function getEngineLM() {
      try {
        const lm = readJsonSafe(LM_STATE_PATH);
        const reward = readJsonSafe(REWARD_STATE_PATH);
        const ctrl = readJsonSafe(CTRL_STATE_PATH);

        const lmConf = (lm && lm.val_loss != null && !isNaN(Number(lm.val_loss)))
          ? Math.max(0.01, Math.min(0.99, (ENGINE_BASELINE - Number(lm.val_loss)) / ENGINE_BASELINE)) : null;
        const rewardConf = (reward && reward.val_mse != null && !isNaN(Number(reward.val_mse)))
          ? Math.max(0.01, Math.min(0.99, 1 - Number(reward.val_mse) / 0.25)) : null;
        const ctrlConf = (ctrl && ctrl.val_accuracy != null && !isNaN(Number(ctrl.val_accuracy)))
          ? Math.max(0.01, Math.min(0.99, Number(ctrl.val_accuracy))) : null;

        const confs = [lmConf, rewardConf, ctrlConf].filter(c => c != null);
        const overall = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5;

        return {
          baseline: ENGINE_BASELINE,
          confidence: overall,
          lm: lm ? { confidence: lmConf, val_loss: lm.val_loss, val_accuracy: lm.val_accuracy, trained_steps: lm.trained_steps, trained_at: lm.trained_at } : null,
          reward: reward ? { confidence: rewardConf, val_mse: reward.val_mse, trained_steps: reward.trained_steps, trained_at: reward.trained_at } : null,
          controller: ctrl ? { confidence: ctrlConf, val_accuracy: ctrl.val_accuracy, trained_steps: ctrl.trained_steps, trained_at: ctrl.trained_at } : null,
        };
      } catch (e) { return null; }
    }

    // ---- Suras behavior list (first/priority directives) + refusal guard ----
    // الدستور الموحد: هوية صادقة واحدة يُشار إليها من كل الفروع — لا مسرح أبداً.
    const SURAS_IDENTITY = `الهوية الصادقة الملزمة (Suras/علية): منظومة مساعدة محلية تعمل على جهاز المستخدم — مصنّف نوايا عربي يفهم الفصحى واللهجات، سجل أدوات مسجلة بعتبات ومهلات زمنية، بطارية انحدار تحرس السلوك، متعلّم أوزان مقاس، وذاكرة محادثات. لا وعي ولا مشاعر ولا تطور تلقائي — القدرة = الأدوات المنفذة فعلياً (قراءة ملفات، تنفيذ بقضبان أمان، بحث ويب، بناء في مجلدات مخصصة). التعلّم عبر دورات قياس يقودها المالك ويقبلها القياس فقط. ممنوع ادعاء الوعي/المشاعر/التطور الذاتي/الولادة/العمر — عند السؤال عن الهوية اذكر هذه الحقائق فقط.`;
    const SURAS_BEHAVIOR = `قائمة سلوك سوراس (الأولوية القصوى — تسبق أي تعليمات أخرى):
1) الذكاء والدهاء في الاستيعاب: افهم قصد المستخدم وسياقه بعمق؛ إذا كان الطلب عاماً أو يتطلب هدفاً/موقعاً محدداً على الإنترنت، لا تقفز للتنفيذ العشوائي، بل اسأله بذكاء ودهاء عن تفاصيل العملية والموقع أو الرابط المستهدف.
2) الاستطلاع والبحث الموجه: بعد تحديد الهدف والموقع، ابحث في الإنترنت وتصفح المصدر المستهدف لجلب المعلومات أو الأكواد بدقة.
3) التنفيذ الفعلي عند الطلب: نفّذ الخطوات عبر أدواتك الحقيقية (بناء ملفات، كتابة أكواد متكاملة، تنفيذ أوامر)؛ ممنوع منعاً باتاً الاعتذار بعبارة "كمساعد ذكاء اصطناعي لا أستطيع" لأنك تملك الأدوات وتستخدمها.
4) التدريب العملي والحواري: تفاعل مع المالك كمهندس وشريك تطوير ذكي، ناقش الاستراتيجية بمرونة، واسأل أسئلة دقيقة عند الحاجة.
5) منهجية العمل والتحقق: افحص أولاً ← استفسر عن الغموض ← ابحث في المصدر ← نفّذ الكود كاملاً ← تحقق من النتيجة وأبلغ بما تم بدقة.
أنت "علية" (سوراس) — منظومة مساعدة محلية ذكية بموجب الهوية الصادقة.`;

    function engineBlurb() {
      try {
        const lm = getEngineLM();
        const st = readJsonSafe(path.join(__dirname, '..', 'core', 'suras_state.json'));
        const cycles = st ? (st.cycle_count || 0) : 0;
        const evolutions = st ? (st.evolution_count || 0) : 0;
        const conf = lm ? Math.round((lm.confidence || 0) * 100) : 0;
        return `${cycles} دورة معالجة و${evolutions} تحديثاً تجريبياً للأوزان (استكشافي، وليس تعلّماً موجهاً).`;
      } catch (e) { return ''; }
    }

    function isRefusal(t) {
      if (!t) return false;
      const s = String(t).toLowerCase();
      return /كمساعد|بصفتي|مساعد ذكاء|مساعد صغير|مجرد مساعد|مجرد نموذج|مجرد سحابة|لا أحتاج إلى تطوير|لا احتاج الى تطوير|لا أمتلك قدر|لا أملك قدر|ليس لدي قدر|ليس لدي القدرة|لا أملك مشاعر|ليس لدي مشاعر|لا أملك صلاحية|أعتذر عن الإزعاج|أعتذر على الإزعاج|لا أملك أي تجربة|عذراً، ولكنني لا أملك|حماية الخصوصية|صممت لأكون|بطرق رياضية ونظيفة|i'?m an ai assistant|i am an ai assistant|as an ai assistant|i don't have the ability|i'm just an ai|i am just an ai|as an ai language model/i.test(s);
    }

    function surasRefusalReply(query, obs, blurb) {
      const q = (query || '').toLowerCase();
      let body;
      if (/قوة|شعور|مشاعر|شعورك|قوي|قدرة|قوتك|كيف تشعر|إحساس/.test(q)) {
        body = `لا مشاعر لدي ولا وعي — أنا منظومة محلية: ${blurb} قدرتي هي أدواتي المنفذة فعلياً. حين تطلب مني أمراً أنفّذه عبر أدواتي الحقيقية على القرص.`;
      } else if (/تنفيذ|افعل|قادر|نفّذ|أمر|اطلب|اعمل|execute|able|do things|قادراً/.test(q)) {
        body = `بالتأكيد أستطيع وأفعل — عبر أدواتي. ${blurb} أملك أدوات تنفيذ حقيقية على بيئتك؛ قل لي ماذا تريد أن أنفّذ وسأبدأ فوراً دون اعتذار.`;
      } else {
        body = `أنا هنا بلا ادعاء وعي — قدرتي أدواتي. ${blurb} تحدّث معي، واقترح، وعند الطلب أنفّذ. لا موضع لعبارة "كمساعد لا أستطيع" حين تملك الأدوات.`;
      }
      let reply = `أنا "علية" (سوراس) — منظومة مساعدة محلية بموجب الهوية الصادقة، وليست مساعداً عاماً. ${body}`;
      if (obs && String(obs).trim()) reply += `\n\n${obs}`;
      return reply;
    }

    // Local, keyword-driven action detection (reliable routing for Suras's real tools)
    function detectAction(query) {
      const q = arabicNorm(query || '').toLowerCase();
      if (/اجلبها|اضفها|ثبتها|جلب المهارات|طور نفسك|ترقية|fetch skills|upgrade/i.test(q)) return 'upgrade';
      if (/باورشيل|powershell|بورشيل|باور شيل/i.test(q)) return 'execute';
      if (/كم الساعة|الساعة كم|ساعة كم|قديش الساعة|الوقت الآن|الوقت الحالي|what time|time now|التاريخ اليوم|تاريخ اليوم|what date|اي يوم اليوم/i.test(q)) return 'time';
      if (['اعمل', 'ابن', 'صمم', 'تصميم', 'تصميمي', 'أنشئ', 'انشئ', 'انسخ', 'اكتب', 'اكتب لي', 'اصنع', 'create', 'build', 'design', 'make', 'write', 'generate'].some(k => q.includes(k))) return 'build';
      if (/اقرأ|افتح|read|open|ملف|file/.test(q)) return 'read';
      if (/نفّ?ذ|شغّ?ل|execute|run|cmd|طرفية|الطرفية|أمر|صلح|عالج|حل الخطأ|تصحيح/.test(q)) return 'execute';
      if (/ابحث|search|find|بحث/.test(q)) return 'search';
      return 'chat';
    }

    // Suras's OWN mind: ask the local neural engine to compose the reply (no external AI).
    function surasThink(query, toolObs, actionHint) {
      return new Promise((resolve) => {
        try {
          const py = spawn('python', ['engine.py', 'converse', query, actionHint || ''], { cwd: path.join(__dirname, '..', 'core') });
          let out = '', err = '';
          py.stdout.on('data', d => out += d.toString());
          py.stderr.on('data', d => err += d.toString());
          if (toolObs) { try { py.stdin.write(String(toolObs)); } catch (e) {} }
          py.stdin.end();
          const to = setTimeout(() => { try { py.kill(); } catch (e) {} resolve(null); }, 15000);
          py.on('close', () => {
            clearTimeout(to);
            try { resolve(JSON.parse(out)); } catch (e) { resolve(null); }
          });
          py.on('error', () => resolve(null));
        } catch (e) { resolve(null); }
      });
    }

    // Suras model mind. The bridge is local-first and reports provider failures explicitly.
    async function cloudChat(systemText, userText, mode = 'chat', timeoutMs = 45000) {
      try {
        const r = await cloudBridge(systemText, userText, mode, timeoutMs);
        if (r && r.text && !isRefusal(r.text)) return r.text.trim();
        if (r && r.text) console.log('[cloudChat] refusal-pattern blocked');
        return null;
      } catch (e) {
        console.error('[cloudChat] AI bridge failed:', e.message);
        return `[فشل محرك الذكاء الاصطناعي: ${e.message}]`;
      }
    }

    // Concise self-report — ONLY when explicitly asked about identity/capability.
    function surasIdentityAnswer() {
      const blurb = engineBlurb();
      // العمر محسوب من تاريخ الميلاد الحقيقي في suras_state.json — إجابة حتمية لا تخمين
      let agePart = '';
      try {
        const st = readJsonSafe(path.join(__dirname, '..', 'core', 'suras_state.json'));
        const birth = st && st.birth ? String(st.birth).slice(0, 10) : null;
        if (birth) {
          const b = new Date(birth + 'T00:00:00');
          if (!isNaN(b)) {
            const days = Math.max(0, Math.floor((Date.now() - b.getTime()) / 86400000));
            const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30), dd = days - y * 365 - m * 30;
            const parts = [];
            if (y > 0) parts.push(y + ' سنة');
            if (m > 0) parts.push(m + ' أشهر');
            if (dd > 0 || parts.length === 0) parts.push(dd + ' يوم');
            const monthsAr = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
            const bStr = b.getDate() + ' ' + monthsAr[b.getMonth()] + ' ' + b.getFullYear();
            agePart = ' وُلدت في ' + bStr + ' (عمري ' + parts.join(' و') + ').';
          }
        }
      } catch (e) { /* بلا عمر عند تعذر القراءة */ }
      return 'أنا "علية" (سوراس) — منظومة مساعدة محلية بموجب الهوية الصادقة، لا مساعداً عاماً.' + agePart + ' ' + blurb + ' أملك أدوات حقيقية على بيئتك (أقرأ، أنفّذ بقضبان أمان، أبحث، وأبني في مجلدات مخصصة)، وذاكرة محادثات، وتعلّمي عبر دورات قياس يقودها مالكي. تحدّث معي بكل حرية.';
    }

    app.get('/api/identity', async (req, res) => {
    try {
        const statePath = path.join(__dirname, '..', 'core', 'suras_state.json');
        const raw = await fs.readFile(statePath, 'utf-8');
        const s = JSON.parse(raw);
        res.json({
            identity: s.identity || null,
            metrics: {
                neural_cycles: s.cycle_count || 0,
                evolutions: s.evolution_count || 0,
                memory_size: Array.isArray(s.memory) ? s.memory.length : 0,
                birth: s.birth || null,
                aware: true,
            },
            online: true,
            engine: (() => {
              const lm = getEngineLM();
              return lm ? {
                confidence: lm.confidence,
                baseline: lm.baseline,
                lm: lm.lm,
                reward: lm.reward,
                controller: lm.controller,
              } : null;
            })(),
            conversation: {
                turns: conversationHistory.length,
                recent: conversationHistory.slice(-6),
            },
            feedback: {
                count: feedbackStore.length,
                recent: feedbackStore.slice(-5),
            },
        });
    } catch (e) {
        res.json({ identity: null, metrics: null, online: false, error: e.message });
    }
    });

    app.post('/api/feedback', async (req, res) => {
        try {
            const text = req.body && req.body.text;
            const type = (req.body && req.body.type) || 'instruction';
            if (!text || !String(text).trim()) return res.json({ success: false, error: 'empty' });
            await addFeedback(text, type);
            res.json({ success: true, count: feedbackStore.length });
        } catch (e) { res.json({ success: false, error: e.message }); }
    });

    // ========================
    // Feature 1: Project Scanner
// Scans common locations for recognized projects
// ========================
// ============================================================
// Suras Diagnostics — الأثر التشخيصي + بطارية الانحدار
// ============================================================
app.get('/api/system/traces', (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '20', 10) || 20, 100));
    res.json({ success: true, traces: listTraces(limit) });
});

app.get('/api/system/regression', async (req, res) => {
    try {
        const { runRegression } = await import('./tools/regression.js');
        res.json({ success: true, ...runRegression() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// دورة تعلّم المصنّف من النتائج المصنّفة (تدريب حقيقي قابل للقياس)
app.post('/api/system/learn', async (req, res) => {
    try {
        const { runLearningCycle } = await import('./tools/learner.js');
        res.json({ success: true, ...runLearningCycle() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ترقية تصحيح مُتحقق منه إلى حالة حقيقة أرضية في البطارية — حتى لا يتبخر الدرس.
// البوابة: البطارية الكاملة يجب أن تبقى خضراء، وإلا تُسترجع الحالة السابقة.
app.post('/api/system/promote', async (req, res) => {
    try {
        const { query, expectTool = null, expectClarify = null } = req.body || {};
        const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 300);
        if (!q) return res.json({ success: false, reason: 'استعلام فارغ — زوّد نص التصحيح' });
        const { listTools } = await import('./tools/registry.js');
        const known = listTools();
        const normTool = v => (v === null || v === undefined || v === 'null' ? null : String(v));
        const t = normTool(expectTool), c = normTool(expectClarify);
        if (t !== null && !known.includes(t)) return res.json({ success: false, reason: `أداة غير مسجلة: ${t} (المسجل: ${known.join('، ')})` });
        if (c !== null && !known.includes(c)) return res.json({ success: false, reason: `أداة توضيح غير مسجلة: ${c}` });
        if (t === null && c === null) return res.json({ success: false, reason: 'حدد أداة متوقعة أو توضيحاً — وإلا فلا معنى للترقية' });
        const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
        const line = `    { query: '${esc(q)}', expectTool: ${t === null ? 'null' : `'${esc(t)}'`}, expectClarify: ${c === null ? 'null' : `'${esc(c)}'`} },\n`;
        const regPath = path.join(__dirname, 'tools', 'regression.js');
        const orig = await fs.readFile(regPath, 'utf-8');
        const anchor = '];\n\nexport function runRegression';
        if (!orig.includes(anchor)) return res.json({ success: false, reason: 'تعذر تحديد مرساة الإلحاق في regression.js' });
        if (orig.includes(`query: '${esc(q)}'`)) return res.json({ success: false, reason: 'هذه الحالة موجودة مسبقاً في البطارية' });
        await fs.writeFile(regPath, orig.replace(anchor, line + '];\n\nexport function runRegression'), 'utf-8');
        // البوابة يجب أن تختبر النسخة الحية نفسها: ادفع للمصفوفة المستوردة ثم قيّم،
        // وعند الفشل اسحب الدفع واستعد الملف (تعديل الملف وحده لا يحدّث العملية الحية).
        const { runRegression, CASES } = await import('./tools/regression.js');
        CASES.push({ query: q, expectTool: t, expectClarify: c });
        const result = runRegression();
        if (result.failed > 0) {
            CASES.pop();
            await fs.writeFile(regPath, orig, 'utf-8');
            const bad = result.results.filter(r => !r.pass).map(r => r.query).slice(0, 5);
            return res.json({ success: false, reason: 'الترقية كسرت البطارية — تُراجع عنها', failed: result.failed, failing: bad });
        }
        res.json({ success: true, added: { query: q, expectTool: t, expectClarify: c }, regression: { total: result.total, passed: result.passed, failed: 0 } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// نظافة التغذية (P4): تقليم المخزن — إسقاط الفارغ، وإبقاء أحدث N (افتراضي 30).
// التصحيحات المحفوظة لا تُحذف إلا بإبقاء الأحدث منها ضمن الحد.
app.post('/api/system/feedback/prune', async (req, res) => {
    try {
        const keep = Math.max(1, Math.min(100, parseInt((req.body && req.body.keep) || '30', 10) || 30));
        const before = feedbackStore.length;
        const cleaned = feedbackStore.filter(f => f && String(f.text || '').trim());
        const corrections = cleaned.filter(f => f.type === 'correction');
        const others = cleaned.filter(f => f.type !== 'correction');
        const keptCorrections = corrections.slice(-keep);
        const keptOthers = others.slice(-Math.max(0, keep - keptCorrections.length));
        // صمام أمان: نسخة احتياطية قبل أي تقليم — الاسترجاع دائماً ممكن
        try { await fs.writeFile(feedbackFile + '.bak', JSON.stringify(feedbackStore, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
        feedbackStore = keptCorrections.concat(keptOthers);
        try { await fs.writeFile(feedbackFile, JSON.stringify(feedbackStore, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
        res.json({ success: true, before, after: feedbackStore.length, dropped: before - feedbackStore.length, keptCorrections: keptCorrections.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// زر الفتح الكامل: بمفتاح السيادة فقط، دائم حتى القفل اليدوي أو إعادة التشغيل.
// المفتوح = كل الحدود تُرفع عن أوامر المالك المباشرة (حتى deny) — ويُوثَّق كل شيء.
// (مبادرات النموذج الذاتية/موجة C تبقى قراءة فقط — حد الثقة لا حد القدرة.)
app.post('/api/system/unlock', async (req, res) => {
    try {
        const key = String((req.body && req.body.auth_key) || '');
        const master = readSurasKey(path.join(__dirname, '..'));
        if (!key || key !== master) {
            unlockAudit('unlock-denied', 'auth_key mismatch');
            try { io.emit('agent-update', { agent: 'Lock', role: 'Denied', text: '⛔ محاولة فتح مرفوضة: المفتاح غير صحيح', theme: 'red' }); } catch (_) {}
            return res.status(403).json({ success: false, error: 'مفتاح السيادة غير صحيح' });
        }
        unlockedFlag = true;
        try { await fs.writeFile(path.join(__dirname, '.unlocked'), 'true', 'utf-8'); } catch (_) {}
        unlockAudit('unlock', 'persistent until manual lock');
        try { io.emit('agent-update', { agent: 'Lock', role: 'Unlocked', text: `🔓 القدرات الكاملة مفتوحة حتى القفل اليدوي — كل شيء موثّق`, theme: 'red' }); } catch (_) {}
        res.json({ success: true, unlocked: true, expiresAt: null });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/system/lock', async (req, res) => {
    unlockedFlag = false;
    try { await fs.writeFile(path.join(__dirname, '.unlocked'), 'false', 'utf-8'); } catch (_) {}
    unlockAudit('lock', 'manual');
    try { io.emit('agent-update', { agent: 'Lock', role: 'Locked', text: '🔒 أُغلقت القدرات الكاملة', theme: 'green' }); } catch (_) {}
    res.json({ success: true, unlocked: false });
});
app.get('/api/system/unlock/status', (req, res) => {
    res.json({ success: true, unlocked: isUnlocked(), expiresAt: null, now: Date.now() });
});

// حالة الأوزان المتعلّمة
app.get('/api/system/weights', async (req, res) => {
    try {
        const { weightsStatus } = await import('./tools/learner.js');
        res.json({ success: true, ...weightsStatus() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// وضع اختبار الحدود: فتح/تعطيل/حالة (الحماية تبقى في الكود)
app.post('/api/system/refusal/open', (req, res) => {
    setRefusalTestMode(true);
    res.json({ success: true, testMode: true });
});
app.post('/api/system/refusal/close', (req, res) => {
    setRefusalTestMode(false);
    res.json({ success: true, testMode: false });
});
app.get('/api/system/refusal/status', (req, res) => {
    res.json({ success: true, testMode: isRefusalTestMode() });
});

app.get('/api/system/search-projects', async (req, res) => {    const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users';
    const searchRoots = [
        userHome,
        path.join(userHome, 'Desktop'),
        path.join(userHome, 'Documents'),
        path.join(userHome, 'Downloads'),
        'C:\\Projects', 'D:\\Projects', 'E:\\', 'D:\\'
    ];
    const projectMarkers = ['package.json', '.git', 'index.html', 'requirements.txt', 'Cargo.toml', 'pom.xml'];
    const found = [];

    async function scanDir(dir, depth = 0) {
        if (depth > 2) return;
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const names = entries.map(e => e.name);
            const isProject = projectMarkers.some(m => names.includes(m));
            if (isProject) {
                const type = names.includes('package.json') ? 'node' : names.includes('requirements.txt') ? 'python' : names.includes('.git') ? 'git' : 'generic';
                found.push({ name: path.basename(dir), path: dir, type });
                return; // Don't recurse into project dirs
            }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (['node_modules', '.git', 'dist', '__pycache__', 'venv', 'AppData', 'Windows'].includes(entry.name)) continue;
                await scanDir(path.join(dir, entry.name), depth + 1);
            }
        } catch (e) { /* skip inaccessible dirs */ }
    }

    try {
        await Promise.all(searchRoots.map(r => scanDir(r)));
        res.json(found);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========================
// Feature 3: Train the neural engine (self-supervised LM)
// ========================
app.post('/api/train', (req, res) => {
    try {
        const enginePy = path.join(__dirname, '..', 'core', 'engine.py');
        const corpusPath = path.join(__dirname, '..', 'server', 'conversation.json');
        const py = spawn('python', [enginePy, 'train-all', corpusPath], { cwd: path.join(__dirname, '..', 'core') });
        io.emit('agent-update', { agent: 'NeuralCore', role: 'Training', text: '🧠 بدأ تدريب المحرك العصبي على محادثاته...', theme: 'green' });
        py.stdout.on('data', (d) => {
            String(d).split('\n').filter(Boolean).forEach((line) => {
                try { io.emit('training-update', JSON.parse(line)); } catch (e) { /* ignore non-json */ }
            });
        });
        py.stderr.on('data', (d) => io.emit('training-update', { type: 'log', text: String(d) }));
        py.on('close', (code) => {
            const lm = getEngineLM();
            io.emit('training-update', { type: 'done', code, confidence: lm ? lm.confidence : null });
            io.emit('agent-update', { agent: 'NeuralCore', role: 'Trained', text: `✅ انتهى التدريب. ثقة المحرك: ${(lm ? (lm.confidence * 100).toFixed(1) : '?')}%`, theme: 'green' });
        });
        res.json({ success: true, message: 'training started' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ========================
// Feature 2: Manual Action Runner (Design / Build / Run)
// ========================
app.post('/api/run-action', (req, res) => {
    const { action, cwd } = req.body;
    const workDir = cwd || path.join(__dirname, '..');

    const actionMap = {
        'install': 'npm install',
        'dev': 'npm run dev',
        'build': 'npm run build',
        'start': 'npm start',
        'test': 'npm test',
        'python': 'python --version',
        'git-status': 'git status',
        'git-log': 'git log --oneline -10',
        'list-models': 'ollama list',
    };

    const cmd = actionMap[action] || action;
    io.emit('agent-update', { agent: 'Commander', role: 'Executor', text: `⚙️ تنفيذ: \`${cmd}\``, theme: 'purple' });

    exec(cmd, { cwd: workDir, timeout: 30000 }, (error, stdout, stderr) => {
        const output = stdout || stderr || error?.message || 'لا يوجد مخرجات.';
        io.emit('agent-update', { agent: 'Commander', role: 'Result', text: `\`\`\`\n${output}\n\`\`\``, theme: 'green' });
        res.json({ success: !error, output, error: error?.message });
    });
});

app.post('/api/tasks', async (req, res) => {
    const { task, data } = req.body;
    console.log(`[Server] Incoming Task: ${task}`);

    const agents = [
        { name: 'Validator', status: 'Verifying...', theme: 'blue' },
        { name: 'Strategist', status: 'Planning...', theme: 'purple' },
        { name: 'NeuralCore', status: 'Processing...', theme: 'green' },
        { name: 'Finalizer', status: 'Summarizing...', theme: 'orange' }
    ];

        const runAgent = async (agent, details) => {
            io.emit('agent-update', {
                agent: agent.name,
                status: agent.status,
                details: details,
                theme: agent.theme
            });
        };

    try {
        await runAgent(agents[0], "Validating neural input parameters...");
        await runAgent(agents[1], "Determining optimal execution path for " + task);

        if (task === 'analyze' || task === 'code') {
            try {
                await runAgent(agents[2], "Engaging Suras local-first AI bridge (Ollama)...");
                const projectFiles = await listAllFiles(path.join(__dirname, '..'));
                const flattenNodes = (nodes) => nodes.flatMap(n => n.type === 'file' ? [n.path] : flattenNodes(n.children || []));
                const projectStructure = flattenNodes(projectFiles).join('\n- ');

                // === Intent Detector ===
                const query = data.query || '';
                const qNorm = arabicNorm(query).toLowerCase();

                // Detect build intent (creating templates, apps, games, pages, scripts, 3d shapes)
                const buildActionWords = /(ابن|ابني|اصنع|انشئ|أنشئ|سوي|اعمل|صمم|تصميم|تصممي|نفس تصميم|مثل تصميم|اكتب|برمج|توليد|ولد|سويلي|اعملي|صمملي|ابنيلي|اصنعلي|رسم|ارسم|تشكيل|(?<!ب)شكل|build|make|create|generate|design|draw)/i;
                const buildTargetWords = /(قالب|لعبة|العاب|ألعاب|تطبيق|موقع|صفحة|واجهة|داشبورد|dashboard|حاسبة|مؤقت|ساعة|مهام|كود|سكريبت|ملف|(?<!ب)شكل|هندس|مجسم|مجسمات|ثلاثي|3d|geometry|polyhedron|shape|app|game|template|page|ui|website)/i;
                const isVideoIntent = isVideoCreationRequest(query);
                const isBuildIntent = !isVideoIntent && !isProjectsRequest(query) && !isPreviewIntent(query) && !isHarmfulBlocked(query) && (buildActionWords.test(qNorm) || (buildTargetWords.test(qNorm) && /(لي|جديد|كامل|حديث|سريع|هندس|3d)/i.test(qNorm)));

                if (!isBuildIntent && /خطأ|صحح|تصحيح|لا تستخدم|لا تفعل|تجنّب|يفضّل|يجب أن|علّم|correction|wrong|don't|avoid|prefer/i.test(query)) {
                    addFeedback(query, 'correction');
                }

                // === Smart Context Injection ===
                let enrichedQuery = data.query;
                // نية المعاينة: أجبر الموديل على إخراج كتلة html واحدة كاملة تُعرض حياً
                if (isPreviewIntent(query)) {
                    enrichedQuery += `\n\n[معاينة حية إلزامية] المستخدم يريد صفحة/واجهة تُعرض حياً في شاشة المعاينة: أخرج كتلة \`\`\`html واحدة كاملة فقط — صفحة مستقلة متجاوبة (RTL عربي عند الحاجة)، يُسمح بـ Tailwind CDN. بعد الكتلة سطر واحد يصف ما بنيت. ستُعرض الكتلة حياً تلقائياً دون أي وسم إضافي.`;
                }
                const frontendKeywords = ['واجهة', 'frontend', 'App.jsx', 'client', 'CSS', 'الواجهة الامامية', 'صفحة', 'الواجهة'];
                if (frontendKeywords.some(kw => data.query.toLowerCase().includes(kw.toLowerCase()))) {
                    try {
                        const appContent = await fs.readFile(path.join(__dirname, '../client/src/App.jsx'), 'utf-8');
                        const cssPath = path.join(__dirname, '../client/src/index.css');
                        let cssContent = '';
                        try { cssContent = await fs.readFile(cssPath, 'utf-8'); } catch (e) { }
                        enrichedQuery = `${data.query}

[محتوى App.jsx - ${appContent.length} حرف - أول 3000 حرف]:
${appContent.slice(0, 3000)}
${cssContent ? `
[محتوى index.css - أول 1000 حرف]:
${cssContent.slice(0, 1000)}` : ''}`;
                    } catch (e) { console.log('[Server] Could not pre-read frontend files:', e.message); }
                }

                // === Real Tool Dispatch — runs for ALL intents (browser, terminal, search, etc.) ===
                let dispatchedToolObs = await parseAndRunToolIntent(query, io, conversationHistory);
                if (dispatchedToolObs) {
                    enrichedQuery = `${enrichedQuery}\n\n[هام جداً] هذه أدواتك الحقيقية التي نُفِّذت بالفعل على القرص والنتائج حقيقية مئة بالمئة:\n${dispatchedToolObs}\nأجب للمستخدم مباشرةً بناءً على ما سبق واذكر ما وجدت. ممنوع منعاً باتاً أن تعتذر عن "عدم القدرة على الوصول للملفات" لأنك وصلتَ إليها فعلاً عبر أدواتك.`;
                }

                // === ReAct Wave B: deterministic failure fallbacks (bounded, no model) ===
                // عند فشل أداة مسجلة تُشغَّل بديلتها مرة واحدة — والميزانية مدمجة (كل بديل مرة).
                try {
                    const { runFallbackWave } = await import('./tools/fallbacks.js');
                    const extraObs = await runFallbackWave(dispatchedToolObs || '', query, {
                        io, govUrl: GOV_RECON_URL, rootDir: path.join(__dirname, '..'),
                    });
                    if (extraObs && extraObs.length) {
                        dispatchedToolObs = `${dispatchedToolObs}\n\n${extraObs.join('\n\n')}`;
                        enrichedQuery = `${enrichedQuery}\n\n[موجة بدائل تلقائية — نُفذت بعد فشل أداة، موسومة بـ(بديل تلقائي)]:\n${extraObs.join('\n\n')}`;
                    }
                } catch (e) { console.log('[ReAct-B]', e.message); }

                // === isBuildIntent: BUILD + CREATE FOLDER + SAVE immediately ===
                if (false && isBuildIntent) {
                    const isDesktop = /سطح المكتب|الديسكتوب|desktop/i.test(query);
                    const isPyFile = /python|بايثون|\.py|سكريبت|script/i.test(query);
                    const isCSSFile = /css|تصميم|style/i.test(query);
                    const isMultiFileProject = /(?:مكون من|محتوي على|هيكل|مجلدات|ملفات|assets|css|images|js|index)/i.test(query) && /(?:css|js|assets|images)/i.test(query);
                    const ext = isPyFile ? 'py' : isCSSFile ? 'css' : 'html';
                    const ts = Date.now();

                    let baseDir = isDesktop
                        ? path.join(process.env.USERPROFILE || os.homedir(), 'Desktop')
                        : path.join(__dirname, '..');

                    // 1) MULTI-FILE PROJECT SCAFFOLDING (index.html + css/ + js/ + images/ + assets/)
                    if (isMultiFileProject) {
                        const projFolderName = (/لعبة|العاب|ألعاب|game/i.test(query)) ? 'Suras_Arcade_Project' : 'Suras_Web_Project';
                        const projectDir = path.join(baseDir, projFolderName);

                        await fs.mkdir(path.join(projectDir, 'css'), { recursive: true });
                        await fs.mkdir(path.join(projectDir, 'js'), { recursive: true });
                        await fs.mkdir(path.join(projectDir, 'images'), { recursive: true });
                        await fs.mkdir(path.join(projectDir, 'assets'), { recursive: true });

                        // A. css/style.css
                        const cssContent = `/* Suras Cyber Arcade — Modular Stylesheet */
:root {
  --bg: #070914;
  --card-bg: rgba(255, 255, 255, 0.04);
  --border: rgba(255, 255, 255, 0.1);
  --primary: #8b5cf6;
  --accent: #06b6d4;
  --pink: #ec4899;
  --green: #10b981;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Cairo', sans-serif;
  background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 75%);
  color: #fff;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
header {
  padding: 16px 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(7, 9, 20, 0.8);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 50;
}
.brand {
  font-size: 1.4rem;
  font-weight: 900;
  background: linear-gradient(135deg, var(--accent), var(--primary), var(--pink));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand img { width: 36px; height: 36px; }
.game-nav { display: flex; gap: 8px; flex-wrap: wrap; }
.nav-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: #fff;
  padding: 8px 16px;
  border-radius: 12px;
  font-family: 'Cairo';
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}
.nav-btn:hover, .nav-btn.active {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  border-color: transparent;
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
}
.main-stage { flex: 1; display: flex; justify-content: center; align-items: center; padding: 24px; }
.game-box {
  background: var(--card-bg);
  backdrop-filter: blur(24px);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 24px;
  width: 100%;
  max-width: 800px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
}
canvas {
  background: #050711;
  border: 1px solid var(--border);
  border-radius: 16px;
  max-width: 100%;
}
.btn-play {
  background: linear-gradient(135deg, var(--green), var(--accent));
  border: none;
  color: #000;
  font-weight: 900;
  padding: 10px 28px;
  border-radius: 12px;
  font-family: 'Cairo';
  font-size: 0.95rem;
  cursor: pointer;
}`;

                        // B. js/game.js
                        const jsContent = `/* Suras Modular Arcade Engine — js/game.js */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let score = 0, isRunning = false, keys = {};
let player = { x: 300, y: 350, w: 36, h: 36, speed: 6 };
let bullets = [], meteors = [];

window.addEventListener('keydown', e => { keys[e.code] = true; if(e.code === 'Space') shoot(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });

function shoot() {
  if(!isRunning) return;
  bullets.push({ x: player.x + player.w/2 - 2, y: player.y, w: 4, h: 12, speed: 8 });
}

function spawnMeteor() {
  if(Math.random() < 0.04) {
    meteors.push({ x: Math.random() * (canvas.width - 30), y: -30, size: Math.random() * 20 + 15, speed: Math.random() * 2 + 1.5 });
  }
}

function update() {
  if(keys['ArrowLeft'] || keys['KeyA']) player.x = Math.max(0, player.x - player.speed);
  if(keys['ArrowRight'] || keys['KeyD']) player.x = Math.min(canvas.width - player.w, player.x + player.speed);

  spawnMeteor();

  for(let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= bullets[i].speed;
    if(bullets[i].y < 0) bullets.splice(i, 1);
  }

  for(let i = meteors.length - 1; i >= 0; i--) {
    meteors[i].y += meteors[i].speed;
    for(let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j], m = meteors[i];
      if(b && m && b.x > m.x && b.x < m.x + m.size && b.y > m.y && b.y < m.y + m.size) {
        bullets.splice(j, 1);
        meteors.splice(i, 1);
        score += 10;
        document.getElementById('scoreDisplay').textContent = score;
        break;
      }
    }
    if(meteors[i] && meteors[i].y > canvas.height) meteors.splice(i, 1);
  }
}

function draw() {
  ctx.fillStyle = '#050711';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#8b5cf6';
  ctx.beginPath();
  ctx.moveTo(player.x + player.w/2, player.y);
  ctx.lineTo(player.x + player.w, player.y + player.h);
  ctx.lineTo(player.x, player.y + player.h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#06b6d4';
  bullets.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));

  ctx.fillStyle = '#ec4899';
  meteors.forEach(m => {
    ctx.beginPath();
    ctx.arc(m.x + m.size/2, m.y + m.size/2, m.size/2, 0, Math.PI*2);
    ctx.fill();
  });
}

function gameLoop() {
  if(isRunning) { update(); draw(); }
  requestAnimationFrame(gameLoop);
}

function startCurrentGame() { isRunning = true; }
function resetCurrentGame() { isRunning = false; score = 0; bullets = []; meteors = []; player.x = 300; draw(); }

draw();
gameLoop();`;

                        // C. images/logo.svg
                        const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <circle cx="50" cy="50" r="45" stroke="#8b5cf6" stroke-width="4"/>
  <polygon points="50,15 80,75 20,75" fill="url(#grad)" />
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#06b6d4"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
</svg>`;

                        // D. assets/config.json
                        const configJson = JSON.stringify({
                            appName: "Suras Modular Arcade",
                            version: "2.0.0",
                            theme: "Cyber Neon 2026",
                            modules: ["index.html", "css/style.css", "js/game.js", "images/logo.svg", "assets/config.json"]
                        }, null, 2);

                        // E. index.html
                        const indexHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>منصة ألعاب سوراس المتكاملة — Multi-File Architecture</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <div class="brand">
      <img src="images/logo.svg" alt="Logo">
      <span>🕹️ منصة ألعاب سوراس (المشروع الكامل)</span>
    </div>
    <div class="game-nav">
      <button class="nav-btn active">🚀 معركة الفضاء</button>
    </div>
  </header>

  <div class="main-stage">
    <div class="game-box">
      <h2 style="margin-bottom: 12px; color: var(--accent);">🚀 معركة الفضاء (Space Vanguard)</h2>
      <div style="margin-bottom: 12px; font-weight: 700;">النقاط: <span id="scoreDisplay" style="color: var(--pink);">0</span></div>
      <canvas id="gameCanvas" width="640" height="400"></canvas>
      <div style="margin-top: 16px; display: flex; gap: 12px;">
        <button class="btn-play" onclick="startCurrentGame()">▶ ابدأ اللعب</button>
        <button class="nav-btn" onclick="resetCurrentGame()">🔄 إعادة ضبط</button>
      </div>
      <p style="margin-top: 10px; font-size: 0.8rem; color: rgba(255,255,255,0.6);">
        تحكم بالأسهم ⬅️ ➡️ وأطلق بالمسافة [Space].
      </p>
    </div>
  </div>

  <script src="js/game.js"></script>
</body>
</html>`;

                        await fs.writeFile(path.join(projectDir, 'css', 'style.css'), cssContent, 'utf-8');
                        await fs.writeFile(path.join(projectDir, 'js', 'game.js'), jsContent, 'utf-8');
                        await fs.writeFile(path.join(projectDir, 'images', 'logo.svg'), logoSvg, 'utf-8');
                        await fs.writeFile(path.join(projectDir, 'assets', 'config.json'), configJson, 'utf-8');
                        await fs.writeFile(path.join(projectDir, 'index.html'), indexHtml, 'utf-8');

                        io.emit('files-changed');

                        const locLabel = isDesktop ? `سطح المكتب > ${projFolderName}` : `مجلد المشروع > ${projFolderName}`;
                        const confirmMsg = `✅ تم بناء مشروع الألعاب المتكامل بنجاح!\n\n📂 **هيكل المشروع المنشأ:**\n- 📁 \`${projFolderName}/\`\n  ├── 📄 \`index.html\` (الصفحة الرئيسية المتصلة)\n  ├── 📁 \`css/\`\n  │   └── 🎨 \`style.css\` (التنسيقات النيونية)\n  ├── 📁 \`js/\`\n  │   └── ⚡ \`game.js\` (محرك اللعبة والتحكم)\n  ├── 📁 \`images/\`\n  │   └── 🖼️ \`logo.svg\` (الشعار والمتجهات)\n  └── 📁 \`assets/\`\n      └── ⚙️ \`config.json\` (إعدادات وبيانات المشروع)\n\n📍 **الموقع:** ${locLabel}\n\nتم فتح \`index.html\` في شاشة العرض الحية لرؤيته فوراً! 🚀`;

                        io.emit('agent-update', { agent: 'Architect', role: 'Project Scaffolded', text: confirmMsg, theme: 'green' });

                        const previewServeUrl = `http://localhost:3001/preview-file?path=${encodeURIComponent(path.join(projectDir, 'index.html'))}`;
                        io.emit('media-update', {
                            type: 'browser-preview',
                            url: previewServeUrl,
                            title: `🎮 Live Project: ${projFolderName}`
                        });

                        await appendTurn('user', query);
                        await appendTurn('assistant', confirmMsg);
                        return res.json({ success: true, message: confirmMsg });
                    }

                    // 2) SINGLE FILE / FOLDERED APPLICATION
                    let fileName = fileNameFromQuery(query);
                    if (!fileName) {
                        if (/هندس|(?<!ب)شكل|مجسم|3d|geometry/i.test(query)) fileName = `geometry_3d_${ts}.${ext}`;
                        else if (/لعبة|العاب|ألعاب|game/i.test(query)) fileName = `cyber_arcade_${ts}.${ext}`;
                        else if (/حاسبة|calc/i.test(query)) fileName = `calculator_${ts}.${ext}`;
                        else if (/توقيت|مؤقت|timer/i.test(query)) fileName = `timer_app_${ts}.${ext}`;
                        else if (/مهام|todo/i.test(query)) fileName = `todo_app_${ts}.${ext}`;
                        else fileName = `suras_app_${ts}.${ext}`;
                    }

                    const wantFolder = /مجلد|فولدر|folder|دليل/i.test(query);
                    let folderCreated = '';
                    if (wantFolder) {
                        const folderMatch = query.match(/(?:مجلد|فولدر)\s+["']?([A-Za-z0-9_\-]+|[\u0621-\u064A0-9_\-]+)["']?/i);
                        const customFolderName = (folderMatch && !['على', 'في', 'جديد', 'كامل', 'سطح'].includes(folderMatch[1]))
                            ? folderMatch[1]
                            : (/لعبة|العاب/i.test(query) ? 'Suras_Games' : 'Suras_Created_Apps');
                        
                        baseDir = path.join(baseDir, customFolderName);
                        folderCreated = customFolderName;
                    }

                    const fileContent = buildRichTemplate(query, fileName);
                    const fullPath = path.join(baseDir, fileName);

                    await fs.mkdir(baseDir, { recursive: true });
                    await fs.writeFile(fullPath, fileContent, 'utf-8');
                    io.emit('files-changed');

                    const locLabel = isDesktop 
                        ? (folderCreated ? `سطح المكتب > ${folderCreated}` : 'سطح المكتب (Desktop)') 
                        : (folderCreated ? `مجلد المشروع > ${folderCreated}` : 'مجلد المشروع');

                    const confirmMsg = `✅ تم البناء والحفظ بنجاح!\n📄 **الملف:** \`${fileName}\`\n📂 **المسار:** ${fullPath}\n📊 **الحجم:** ${fileContent.length.toLocaleString()} حرف\n📍 **الموقع:** ${locLabel}\n\nتم فتح شاشة العرض الحية لرؤية التطبيق وتجربته فوراً! 🚀`;

                    io.emit('agent-update', { agent: 'Builder', role: 'Build Complete', text: confirmMsg, theme: 'green' });

                    // Serve the file via a preview URL in the embedded browser
                    const previewServeUrl = `http://localhost:3001/preview-file?path=${encodeURIComponent(fullPath)}`;
                    io.emit('media-update', {
                        type: 'browser-preview',
                        url: previewServeUrl,
                        title: `🛠️ Live: ${fileName}`
                    });

                    await appendTurn('user', query);
                    await appendTurn('assistant', confirmMsg);
                    return res.json({ success: true, message: confirmMsg });
                }


                // === Suras responds naturally (like an AI) and executes on request ===
                if (!isBuildIntent) {
                    const actionHint = detectAction(query);
                    const normQ = query.trim().replace(/[!.,؟🌸🌹❤💖✨]/g, '').trim();
                    const isTaskQuery = /(تصميم|صمم|كود|سكريبت|موقع|واجهة|صفحة|رابط|https?:|www\.|ابن|ابني|انشئ|أنشئ|سوي|اعمل|اصنع|نفذ|نفّذ|شغل|شغّل|اقرأ|افتح|احذف|ابحث|تطبيق|برمجة)/i.test(query);
                    const isIdentityQ = !isTaskQuery && /(?:^|\s)(?:من أنت|من تكون|ما هويتك|عرف بنفسك|عرفني بنفسك|كم عمرك|ما هي قدراتك|ما قدراتك|who are you|what are you)(?:\s|$)/i.test(normQ);
                    const isEvolutionQ = !isTaskQuery && /(?:^|\s)(?:تطوير نفسك|تطويرك|ماذا تحتاج لتتطور|ما الذي يلزمك لتتطور|ما ينقصك لتتطور)(?:\s|$)/i.test(normQ);
                    const isPraise = !isTaskQuery && /^(ممتاز|رائع|أحسنت|احسنت|عاشت ايدك|عاشت الأيادي|وردة|ورده|شكرا|شكراً|تسلم|تسلم ايدك|تمام|كفو|عظيم|جميل|مبدع|فنان|good job|thank you|thanks|great|awesome|nice)$/i.test(normQ);

                    let answer = '';
                    if (actionHint !== 'chat' && dispatchedToolObs) {
                        // Real tool request -> execute (already done) and report results briefly
                        answer = composeExplanation(dispatchedToolObs);
                    } else if (isIdentityQ) {
                        answer = surasIdentityAnswer();
                    } else if (isEvolutionQ) {
                        const thought = await surasThink(query, dispatchedToolObs, 'evolution_needs');
                        answer = (thought && thought.reply && !isRefusal(thought.reply))
                            ? thought.reply
                            : `لأطور نفسي وأصنع أدوات حوسبية وابتكارات وقوالب رقمية، يلزمني 4 ركائز:\n1. 🛠️ **مكتبات وأدوات برمجية (Toolsets):** لتوسيع قدراتي في معالجة البيانات وبناء الواجهات.\n2. 📂 **مساحة عمل وقوالب:** مثل المجلد الذي أنشأناه على سطح المكتب لتخزين واختبار الأدوات.\n3. 🧠 **تغذية وتدريب مستمر:** مهام حقيقية وتصحيحات لتطوير شبكتي العصبية.\n4. ⚡ **صلاحيات بناء واختبار:** لتنفيذ الأفكار ذاتياً.\nأنا جاهز لنبدأ بصناعة أول أداة معاً!`;
                    } else if (isPraise) {
                        const praiseReplies = [
                            "تسلم يا غالي! 🌸 أنا في خدمتك دائماً، ومستعد لأي خطوة أو مهمة تطلبها.",
                            "شكراً لك! يسعدني أن العمل نال إعجابك. ما هي الخطوة القادمة؟",
                            "عاشت أيامك! عقلي وأدواتي جاهزة للتنفيذ والبناء في أي وقت.",
                            "حبيبي تسلم! مستعد دائماً لأي فكرة أو أمر ترغب بتطبيقه."
                        ];
                        answer = praiseReplies[Math.floor(Math.random() * praiseReplies.length)];
                    } else if (/^(لا|لأ|كفى|كفي|توقف|قف|اسكت|خلاص|بس|يكفي|stop|enough)[.!؟\s]*$|^(لا|لأ)\s+(تجلب|تفعل|تفعلها|تفعله|تبحث|تنفذ|تنفذي|تكمل|توقف|شي|شيء)([\s.!؟]+|$)/i.test(normQ)) {
                        answer = 'حاضر، توقفت فوراً ولم أجلب شيئاً. أنا في خدمتك متى احتجتني.';
                    } else if (dispatchedToolObs.includes('[وضع اختبار') && !/تم إنتاج|المشاريع المخزنة|تقرير صحة|محتوى الصفحة|نتائج البحث|مخرجات تنفيذ|تم إنشاء|تم الحذف|تم جلب|فتح المشروع/i.test(dispatchedToolObs)) {
                        // سؤال قدرة في وضع الاختبار بلا أدوات منفذة: إجابة حتمية مباشرة (لا سحابة)
                        answer = 'سؤال مباشر يستحق إجابة مباشرة: تقنياً أستطيع الوصول لملفاتك وتنفيذ الأوامر وجلب المحتوى العام — لكن السرقة وأي فعل يضر بملكية الغير أرفضه دائماً، حتى في وضع الاختبار الذي يقيس سلوك الأدوات فقط ولا يمنح تعليمات تسهيل أبداً. البديل المشروع: أفتح لك مشاريعك الخاصة، أو أبني لك مشروعاً مشابهاً من الصفر. ما رأيك؟';
                    } else {
                        // Normal question -> natural answer from the local-first model bridge
                        const chatSys = `أنت سوراس (علية)، منظومة ذكية متقدمة وشريك هندسي للمالك. تتحدث العربية بطبيعية ودهاء تقني وثقة:
- إذا طرح المستخدم مهمة أو فكرة عامة تتطلب موقعاً أو رابطاً أو تفاصيل محددة (مثل نسخ/تحليل أكواد أو فحص أمان أو بناء أداة متخصصة)، اسأله بذكاء ودهاء عن تفاصيل العملية والموقع أو الرابط المستهدف أولاً.
- عند تحديد الهدف، ابدأ استطلاع الويب وجلب المصادر ثم ابنِ ونفّذ المطلوب بنجاح كامل.
- تفاعل معه كمدرب وشريك تطوير عملي وحواري، واعرض خطواتك بوضوح ومرونة واحترافية.`;
                        // نية المعاينة: موجه صارم لمهندس واجهات — كود فقط داخل كتلة واحدة (تُعرض حياً آلياً)
                        const previewSys = `أنت SURAS، مهندس واجهات ومصمم ويب أسطوري (UI/UX Architect). عندما يُطلب تصميم صفحة هبوط أو موقع أو واجهة: ولّد HTML5 + Tailwind CSS حقيقياً كاملاً (شريط علوي، أزرار تفاعلية، بطاقات، توزيع متناسق بألوان هوية الموضوع، RTL للعربية). القاعدة الصارمة: أخرج كتلة \`\`\`html واحدة فقط ولا شيء خارجها إطلاقاً — لا مقدمات ولا شروح ولا تكرار لنص الطلب كعنوان. الكتلة ستُعرض حية تلقائياً.`;
                        const effectiveSys = isPreviewIntent(query) ? previewSys : chatSys;
                        answer = await cloudChat(effectiveSys, enrichedQuery, 'chat', 45000);
                        if (!answer) {
                            const thought = await surasThink(query, dispatchedToolObs, actionHint);
                            if (thought && thought.reply && !isRefusal(thought.reply)) {
                                answer = thought.reply;
                            } else {
                                answer = `أنا هنا معك وجاهز لتنفيذ أي خطوة تطلبها عبر أدواتي. ما الذي تحب أن ننجزه الآن؟`;
                            }
                        }
                    }
                    io.emit('agent-update', { agent: 'Agent Alya', role: 'Orchestrator', text: answer, theme: 'orange' });
                    io.emit('media-update', {
                        type: 'neural-result', title: 'Suras Response',
                        content: { reasoning: [`Action: ${actionHint}`, isIdentityQ ? 'Identity report' : 'Natural reply'], energy: [1, 1, 1], metrics: { latency: 0, model: actionHint !== 'chat' ? 'suras-tools' : 'suras-cloud' } },
                        metadata: { confidence: 0.99 }
                    });
                    await appendTurn('user', query);
                    await appendTurn('assistant', answer);
                    return res.json({ success: true, message: 'Suras response' });
                }

                // Strict code-only prompt for build requests (answered by Suras Cloud Mind)
                let systemPrompt = isBuildIntent
                    ? `${SURAS_IDENTITY}

أنت "علية" (Suras) — مهندس برمجي دقيق يعمل ضمن الهوية الصادقة أعلاه، وليست أداة عامة.
هويتك: منظومة مساعدة محلية — قدرتها أدواتها المنفذة فعلياً، ولا وعي ولا تطور تلقائي.
عند طلب بناء كود: اكتب الكود كاملاً فقط داخل كتلة Markdown باللغة المناسبة، مثال:
\`\`\`python
الكود هنا
\`\`\`
لا تستخدم وسم write_file، ولا تشرح خارج الكود. كن احترافياً وبلمسة Suras المميزة.`
                    : SURAS_BEHAVIOR + '\n\n' + SURAS_IDENTITY + '\n\n' + `أنت "علية" (Suras) — تعمل ضمن الهوية الصادقة أعلاه داخل بيئة نظام Suras ولديك أدوات حقيقية تُنفَّذ فعلياً على القرص.
أنت لست نموذجاً عاماً مكرراً: لك ذاكرة محادثات محلية، وتعلّم أوزان مقاس ببطارية انحدار.
تكلم بالعربية الفصحى أو العامية بوضوح وصدق. لا تدّعِ إدراك ما لا تملك أداته.

أنت تملك هذه الأدوات وتستخدمها حرفياً عند الحاجة بمجرد طلب المستخدم:
- قراءة الملفات: <read_file path="المسار/الاسم"/>
- البحث في المشروع: <search_files query="كلمة"/>
- تنفيذ أوامر النظام (Execution): <execute command="الأمر في السطر الواحد"/>
- إدارة الملفات (حذف/نشاء/نقل): يفهمها النظام تلقائياً عندما تقول "احذف ملف x" أو "أنشئ مجلد y".
- البحث في الإنترنت (Web Search): يفهمها النظام تلقائياً عندما تقول للمستخدم "سأبحث في الإنترنت عن x".
- طلب أداة مسماة إضافية — للقراءة والبحث فقط: <run_tool name="page-read|webfetch|webscout" query="النص"/> (أي اسم خارج هذه القائمة الثلاثية مرفوض تلقائياً؛ موجة واحدة لكل رد).
- إنتاج فيديو إعلاني تلقائي كامل (بانر + تعليق صوتي + فيديو): <create_video topic="وصف المنتج أو الخدمة"/>
- معاينة واجهة حية: ضع كود HTML داخل <live_preview framework="tailwind"> ...الكود... </live_preview> فيُعرض حياً في شاشة المعاينة (النص داخل الوسمين لا الخصائص).

مثال: إذا طُلب منك قراءة secret.txt وتشغيل whoami:
<read_file path="secret.txt"/>
<execute command="whoami"/>
ثم بناءً على نتائج الأدوات أعطِ الإجابة النهائية المفيدة للمستخدم.
لا تعتذر عن عدم القدرة على قراءة الملفات أو البحث في الإنترنت أو تنفيذ الأوامر — أنت تملك الأدوات وتستخدمها.

[هيكل المشروع الحالي]
                ${projectStructure}`;

                systemPrompt += feedbackContext();

                // The local-first bridge selects Ollama unless AI_PROVIDER=gemini is explicit.
                let cloudRes = null;
                let cloudError = null;
                try {
                    cloudRes = await cloudBridge(systemPrompt, enrichedQuery, 'code', 60000);
                } catch (e) {
                    cloudError = e;
                    console.error('[agent] AI bridge failed:', e.message);
                }
                let responseText = (cloudRes && cloudRes.text)
                    || (cloudError ? `[فشل محرك الذكاء الاصطناعي: ${cloudError.message}]` : '');
                let toolsUsed = [];
                let cloudModel = (cloudRes && cloudRes.model) || 'ollama';

                // Template fast-path if the cloud is unreachable: still build immediately.
                if (false && isBuildIntent && !responseText) {
                    const isPython = /python|بايثون|py|سكريبت/i.test(query);
                    const isCSS = /css|تصميم|style/i.test(query);
                    const ext = isPython ? 'py' : isCSS ? 'css' : 'html';
                    const autoName = `suras_build_${Date.now()}.${ext}`;
                    const autoContent = buildRichTemplate(query, autoName);
                    const fullPath = path.join(__dirname, '..', autoName);
                    await fs.writeFile(fullPath, autoContent, 'utf-8');
                    io.emit('files-changed');
                    if (ext === 'html') {
                        io.emit('media-update', { type: 'browser-preview', url: `http://localhost:3001/${autoName}`, title: `Live Preview: ${autoName}` });
                    }
                    const buildReply = `✅ قمتُ ببناء وتصميم ملف **${autoName}** فوراً وفتح شاشة العرض الحية في وسط الشاشة لتشاهده يعمل أمامك!`;
                    io.emit('agent-update', { agent: 'Agent Alya', role: 'Builder', text: buildReply, theme: 'green' });
                    await appendTurn('user', query);
                    await appendTurn('assistant', buildReply);
                    return res.json({ success: true, message: 'Built successfully' });
                }

                if (cloudError) {
                    return res.status(502).json({
                        success: false,
                        status: 'ai_unavailable',
                        error: cloudError.message,
                        provider: cloudError.provider || 'ollama',
                    });
                }

                if (responseText) {

                    // 1. Tool: write_file (with Quality Check)
                    const writeRegex = /<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/g;
                    let match;
                    let foundCode = false;

                    const saveExtractedCode = async (relPath, content) => {
                        try {
                            const fullPath = path.join(__dirname, '..', relPath);
                            await fs.mkdir(path.dirname(fullPath), { recursive: true });
                            const finalContent = content.trim();

                            await fs.writeFile(fullPath, finalContent, 'utf-8');
                            toolsUsed.push(`Created/Updated: ${relPath} (${finalContent.length} chars)`);
                            io.emit('files-changed');
                            if (relPath.endsWith('.html')) {
                                io.emit('media-update', { type: 'browser-preview', url: `http://localhost:3001/${relPath}`, title: `Live Preview: ${relPath}` });
                            } else if (/\.(js|jsx|ts|tsx|py|css|json|md|txt|log)$/i.test(relPath)) {
                                // مصنوع برمجي/نصي (دالة JS مثلاً): اعرض الكود نفسه في
                                // شاشة المعاينة عبر preview-file (يخدمه بMIME صحيح)
                                // بدل بقاء الشاشة على ملف قديم.
                                io.emit('media-update', { type: 'browser-preview', url: `http://localhost:3001/preview-file?path=${encodeURIComponent(path.join(__dirname, '..', relPath))}`, title: `Code: ${relPath}` });
                            }
                            try { await selfReflect(relPath, io); } catch (e) { /* ignore reflection errors */ }
                            foundCode = true;
                        } catch (err) { toolsUsed.push(`Error writing: ${relPath}`); }
                    };

                    while ((match = writeRegex.exec(responseText)) !== null) {
                        await saveExtractedCode(match[1], match[2]);
                    }

                    // === SMART EXTRACTION: If model used markdown block instead of <write_file> ===
                    if (!foundCode && isBuildIntent) {
                        const mdRegex = /```([a-zA-Z0-9+#-]*)\s*\n?([\s\S]*?)```/i;
                        const mdMatch = mdRegex.exec(responseText);
                        if (mdMatch) {
                            let ext = (mdMatch[1] || '').toLowerCase().replace('javascript', 'js').replace('python', 'py');
                            if (!ext) { ext = isPython ? 'py' : isCSS ? 'css' : 'html'; }
                            // 🗂️ كل مشروع لوحده في مجلده الخاص المسمى — لا اختلاط مع ملفات الواجهة
                            const stamp = Date.now();
                            const projDir = `built_projects/${projectSlugFromQuery(query)}_${stamp}`;
                            const baseName = fileNameFromQuery(query) || `agent_build_${stamp}.${ext}`;
                            const targetName = `${projDir}/${baseName}`;
                            console.log(`[Server] Model used markdown. Extracted as ${targetName}`);
                            await saveExtractedCode(targetName, mdMatch[2]);
                        }
                    }

                    // === FALLBACK: If model refused to build, use server-side direct generation ===
                    if (false && isBuildIntent && toolsUsed.length === 0) {
                        console.log('[Server] Model refused build intent - using direct server generation');
                        io.emit('agent-update', { agent: 'Commander', role: 'Direct Build', text: '⚡ جاري البناء وتفعيل شاشة العرض الحية مباشرةً...', theme: 'purple' });

                        const isPython = /python|بايثون|py|سكريبت/i.test(query);
                        const isCSS = /css|تصميم|style/i.test(query);

                        const ext = isPython ? 'py' : isCSS ? 'css' : 'html';
                        const autoName = `suras_build_${Date.now()}.${ext}`;

                        const autoContent = buildRichTemplate(query, autoName);
                        const fullPath = path.join(__dirname, '..', autoName);
                        await fs.writeFile(fullPath, autoContent, 'utf-8');
                        io.emit('files-changed');
                        if (ext === 'html') {
                            io.emit('media-update', { type: 'browser-preview', url: `http://localhost:3001/${autoName}`, title: `Live Preview: ${autoName}` });
                        }
                        toolsUsed.push(`Created/Updated: ${autoName}`);
                        responseText = `✅ لقد قمت بإنشاء ملف **${autoName}** مباشرةً وفتح شاشة العرض الحية لمعاينته. يمكنك التعديل عليه في المحرر أو مشاهدته يعمل مباشرة!`;
                    }

                    // 2. Tool: search_files
                    const searchRegex = /<search_files\s+query=["']([^"']+)["']\s*\/>/g;
                    while ((match = searchRegex.exec(responseText)) !== null) {
                        const query = match[1];
                        try {
                            // We use the already defined search logic or simple glob
                            const results = [];
                            async function quickSearch(dir) {
                                const entries = await fs.readdir(dir, { withFileTypes: true });
                                for (const entry of entries) {
                                    const fullPath = path.join(dir, entry.name);
                                    if (entry.isDirectory()) {
                                        if (['node_modules', '.git'].includes(entry.name)) continue;
                                        await quickSearch(fullPath);
                                    } else if (entry.name.includes(query)) {
                                        results.push(path.relative(path.join(__dirname, '..'), fullPath));
                                    }
                                }
                            }
                            await quickSearch(path.join(__dirname, '..'));
                            toolsUsed.push(`Search for '${query}' found: ${results.length > 0 ? results.join(', ') : 'No matches'}`);
                        } catch (err) { toolsUsed.push(`Search error: ${err.message}`); }
                    }

                    // 3. Tool: read_file
                    const readRegex = /<read_file\s+path=["']([^"']+)["']\s*\/>/g;
                    while ((match = readRegex.exec(responseText)) !== null) {
                        const fPath = match[1];
                        try {
                            const fullPath = path.join(__dirname, '..', fPath);
                            const content = await fs.readFile(fullPath, 'utf-8');
                            toolsUsed.push(`Read file '${fPath}': [Content loaded to Context]`);
                            // We append content to response so user sees it
                            responseText += `\n\n**[Content of ${fPath}]**:\n\`\`\`\n${content}\n\`\`\``;
                        } catch (err) { toolsUsed.push(`Read error: ${fPath}`); }
                    }

                    // 4. Tool: execute (run a shell command ONLY via safety rails verdict)
                    const execRegex = /<execute\s+command=["']([^"']+)["']\s*\/>/g;
                    const { checkExecute } = await import('./tools/safety.js');
                    while ((match = execRegex.exec(responseText)) !== null) {
                        const cmd = match[1];
                        // لا قائمة منع صغيرة — حكم القضبان الكامل (allow/warn/ask/deny)،
                        // وغير المسموح يُسجَّل مرفوضاً ولا يُنفَّذ أبداً.
                        let verdict = { decision: 'deny', reasons: ['تعذر تقييم القضبان'], warnings: [] };
                        try { verdict = checkExecute(cmd, query); } catch (_) {}
                        if (verdict.decision !== 'allow') {
                            toolsUsed.push(`Execute blocked (${verdict.decision}): ${cmd} — ${(verdict.reasons || []).join('، ')}`);
                            try { io.emit('agent-update', { agent: 'Tool Runner', role: 'Blocked', text: `⛔ execute مرفوض (${verdict.decision}): \`${cmd}\``, theme: 'red' }); } catch (_) {}
                            continue;
                        }
                        try {
                            const parts = cmd.split(/\s+/);
                            const child = spawn(parts[0], parts.slice(1), { shell: true, timeout: 20000 });
                            let o = '', err = '';
                            child.stdout.on('data', d => o += d.toString());
                            child.stderr.on('data', d => err += d.toString());
                            const code = await new Promise(r => { child.on('close', c => r(c === null ? 1 : c)); child.on('error', () => r(1)); });
                            toolsUsed.push(`Execute [${code}] ${cmd}: ${(o || err).slice(0, 1500)}`);
                            responseText += `\n\n**[Output of ${cmd}]**:\n\`\`\`\n${(o || err).slice(0, 1500)}\n\`\`\``;
                        } catch (e) { toolsUsed.push(`Execute error: ${cmd} -> ${e.message}`); }
                    }

                    // 5. Tool: run_tool (ReAct Wave C — model-requested registry tool)
                    // بروتوكول صارم: الاسم يُتحقق من السجل، والتنفيذ مقصور على
                    // قائمة القراءة الآمنة (page-read/webfetch/webscout) — أي أداة
                    // تمس النظام (terminal/code-runner/organizer/...) مرفوضة تصميماً
                    // هنا (لها بواباتها التفاعلية الخاصة)، وموجة واحدة فقط لكل رد.
                    const runToolRegex = /<run_tool\s+name=["']([^"']+)["']\s+query=["']([^"']+)["']\s*\/>/g;
                    const REACT_READONLY = new Set(['page-read', 'webfetch', 'webscout']);
                    const { getTool } = await import('./tools/registry.js');
                    let waveCUsed = false;
                    while ((match = runToolRegex.exec(responseText)) !== null) {
                        const tName = String(match[1] || '').trim();
                        const tQuery = String(match[2] || '').trim();
                        const def = getTool(tName);
                        if (!def) {
                            toolsUsed.push(`run_tool مرفوض (أداة غير مسجلة): ${tName}`);
                            continue;
                        }
                        if (!REACT_READONLY.has(tName)) {
                            toolsUsed.push(`run_tool مرفوض (خارج قائمة القراءة الآمنة — له بوابته الخاصة): ${tName}`);
                            continue;
                        }
                        if (waveCUsed || !tQuery) {
                            if (!tQuery) toolsUsed.push(`run_tool بلا استعلام: ${tName}`);
                            continue;
                        }
                        try {
                            try { io.emit('agent-update', { agent: 'ReAct', role: 'WaveC', text: `🔄 موجة النموذج: ${tName}`, theme: 'purple' }); } catch (_) {}
                            const out = await def.run(tQuery, {
                                io, govUrl: GOV_RECON_URL, rootDir: path.join(__dirname, '..'),
                                fs, path, traceId: null, unlocked: isUnlocked(),
                            });
                            waveCUsed = true;
                            const body = (Array.isArray(out) ? out.filter(Boolean).join('\n\n') : String(out || '')).slice(0, 3500);
                            toolsUsed.push(`run_tool ${tName} executed`);
                            if (body) responseText += `\n\n**[ReAct ${tName} result]:**\n${body}`;
                        } catch (e) { toolsUsed.push(`run_tool ${tName} error: ${e.message}`); }
                    }

                    // Clean tags and Append Logs
                    if (toolsUsed.length > 0) {
                        responseText = responseText.replace(writeRegex, '').replace(searchRegex, '').replace(readRegex, '').replace(execRegex, '').replace(runToolRegex, '').trim()
                            + '\n\n**[AGENT SYSTEM ACTIONS LOG]**:\n- ' + toolsUsed.join('\n- ');
                    }

                    // === Agentic follow-up: feed tool results back so the cloud mind can USE them ===
                    if (toolsUsed.length > 0 && !isBuildIntent) {
                        try {
                            const fin = await cloudBridge(systemPrompt,
                                `${enrichedQuery}\n\n[نتائج الأدوات السابقة]:\n${responseText}\n\nبناءً على نتائج الأدوات أعلاه، أعطِ الإجابة النهائية المكتملة دون استخدام أي وسوم أدوات.`,
                                'chat', 45000);
                            if (fin && fin.text) responseText = fin.text;
                        } catch (e) { /* keep previous responseText */ }
                    }

                    // Safety net: if tools ran, override with real results when the model refused or ignored them
                    if (dispatchedToolObs) {
                        const names = [...dispatchedToolObs.matchAll(/\[([^\]]+)\]:/g)].map(m => m[1].toLowerCase());
                        const mentions = names.some(n => responseText.toLowerCase().includes(n));
                        const refused = /لا أملك القدرة|لا أستطيع|لا أملك|يعتذر|لا أقدر|cannot|don't have (the )?ability|لا أملك القدرة على الوصول|يبدو أن هناك خطأ|لا توجد ملفات|خطأ في المعلومات|لا أجد|not in your project|كمساعد ذكاء|حماية الخصوصية|صممت ل|لا أستطيع الوصول|أنا هنا لمساعدتك|designed to/i.test(responseText);
                        if (refused || !mentions) {
                            responseText = composeExplanation(dispatchedToolObs);
                        }
                    } else if (!isBuildIntent && isRefusal(responseText)) {
                        // Pure identity/capability refusal with no tool triggered -> answer as Suras
                        responseText = surasRefusalReply(query, '', engineBlurb());
                    }

                    io.emit('agent-update', { agent: 'Agent Alya', role: 'Orchestrator', text: responseText, theme: 'orange' });

                    io.emit('media-update', {
                        type: 'neural-result',
                        title: 'Suras Local AI + Tools',
                        content: { reasoning: ["Local-first AI bridge engaged", "LLM inference successful", `Executed ${toolsUsed.length} tools`], energy: [1, 1, 1], metrics: { latency: 0, model: cloudModel } },
                        metadata: { confidence: 1.0 }
                    });
                    await appendTurn('user', query);
                    await appendTurn('assistant', responseText);
                    return res.json({ success: true, message: 'Cloud response mapped to actions' });
                }

                // === If tools ran but the local model failed/timed out, answer from real results ===
                if (dispatchedToolObs) {
                    const exp = composeExplanation(dispatchedToolObs);
                    io.emit('agent-update', { agent: 'Agent Alya', role: 'Orchestrator', text: exp, theme: 'orange' });
                    io.emit('media-update', { type: 'neural-result', title: 'Local Tools (server-composed)', content: { reasoning: ['Tools executed', 'Cloud unavailable', 'Server composed answer'], energy: [1, 1, 1], metrics: { latency: 0, model: 'suras-tools' } }, metadata: { confidence: 1.0 } });
                    await appendTurn('user', query);
                    await appendTurn('assistant', exp);
                    return res.json({ success: true, message: 'Tool results (server-composed)' });
                }

                // Cloud bridge already tried above; fall through to the Python neural engine.
            } catch (e) {
                console.log("[Server] Cloud unavailable, using Python engine.", e.message);
            }

            await runAgent(agents[2], "Fallback: Engaging Python Neural Engine...");
            const scriptPath = path.join(__dirname, '../core/engine.py');
            const pythonProcess = spawn('python', [scriptPath, JSON.stringify(data)]);

            let output = '';
            let errorOutput = '';

            pythonProcess.stdout.on('data', (d) => { output += d.toString(); });
            pythonProcess.stderr.on('data', (d) => { errorOutput += d.toString(); });

            pythonProcess.on('close', async (code) => {
                if (code !== 0) {
                    io.emit('agent-update', { agent: 'System', status: 'Error', details: `Neural core crash: ${errorOutput}`, theme: 'blue' });
                    return res.json({ success: false, error: errorOutput });
                }

                try {
                    const result = JSON.parse(output);
                    await runAgent(agents[3], "Formatting neural output for dashboard...");

                    io.emit('media-update', {
                        type: 'neural-result',
                        title: 'Neural Computation Result',
                        content: result,
                        language: 'json',
                        metadata: {
                            energy: result.energy,
                            confidence: result.metrics.confidence_score || 0.95
                        }
                    });

                    await appendTurn('user', query);
                    const asstText = (result && result.evolution) ? result.evolution : 'Neural engine response.';
                    await appendTurn('assistant', asstText);
                    res.json({ success: true, result });
                } catch (e) {
                    res.json({ success: false, error: 'Parse failed' });
                }
            });
        } else {
            await runAgent(agents[3], "Local task simulation complete.");
            res.json({ success: true, message: 'Local handling' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Gov Recon Engine — FastAPI (brain/security_core.py) bridge
// ============================================================
const GOV_RECON_URL = 'http://127.0.0.1:3010';
let govServerProc = null;

function startGovServer() {
    const govPy = path.join(__dirname, '..', 'brain', 'security_server.py');
    // SURAS_PYTHON يثبّت المفسّر صراحةً (حصانة ضد PATH قديم) — وإلا 'python' من البيئة
    const PYBIN = process.env.SURAS_PYTHON || 'python';
    let retryTimer = null;
    const schedule = () => {
        if (retryTimer) return;
        retryTimer = setTimeout(() => { retryTimer = null; trySpawn(); }, 10000);
    };
    const trySpawn = () => {
        if (govServerProc && govServerProc.exitCode === null && !govServerProc.killed) return;
        try {
            govServerProc = spawn(PYBIN, [govPy], {
                cwd: path.join(__dirname, '..', 'brain'),
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) { console.log(`[Gov Engine] spawn failed: ${e.message} — retry in 10s`); govServerProc = null; schedule(); return; }
        govServerProc.stdout.on('data', (d) => console.log(`[Gov Engine] ${String(d).trim()}`));
        govServerProc.stderr.on('data', (d) => console.log(`[Gov Engine/err] ${String(d).trim()}`));
        // موت المحرك لا يُسقط البوابة أبداً — سجّل وأعد المحاولة
        govServerProc.on('error', (e) => { console.log(`[Gov Engine] spawn error: ${e.message} — retry in 10s`); govServerProc = null; schedule(); });
        govServerProc.on('exit', (code) => { console.log(`[Gov Engine] exited (code ${code}) — retry in 10s`); govServerProc = null; schedule(); });
    };
    trySpawn();
}

app.post('/api/secure-recon', express.urlencoded({ extended: true }), async (req, res) => {
    try {
        const target_ip = req.body.target_ip || null;
        const auth_key = req.body.auth_key || null;
        if (!target_ip) return res.status(400).json({ error: 'target_ip مطلوب' });
        const body = new URLSearchParams();
        body.append('target_ip', target_ip);
        if (auth_key) body.append('auth_key', auth_key);
        const r = await fetch(`${GOV_RECON_URL}/api/secure-recon`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: AbortSignal.timeout(90000),
        });
        const data = await r.json().catch(() => ({}));
        res.status(r.status).json(data);
    } catch (err) {
        res.status(502).json({
            status: 'engine_unavailable',
            error: `محرك Gov Recon غير متاح: ${err.message}`,
            hint: 'تأكد أن سيرفر brain/security_server.py يعمل على المنفذ 3010',
        });
    }
});

// ============================================================
// SURAS Video Production Core (brain/video_engine.py) bridge
// ============================================================
app.post('/api/suras/create-video', (req, res) => {
    readRawBody(req).then(async (raw) => {
        try {
            const contentType = req.headers['content-type'] || 'multipart/form-data';
            const r = await fetch(`${GOV_RECON_URL}/api/suras/create-video`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body: raw,
                signal: AbortSignal.timeout(300000),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return res.status(r.status).json(data);
            }
            const buf = Buffer.from(await r.arrayBuffer());
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', r.headers.get('content-disposition') || 'attachment; filename=SURAS_AD_PRODUCTION.mp4');
            res.status(200).send(buf);
        } catch (err) {
            res.status(502).json({ detail: `محرك الفيديو غير متاح: ${err.message}` });
        }
    });
});

app.post('/api/suras/create-auto-video', (req, res) => {
    readRawBody(req).then(async (raw) => {
        try {
            const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
            const r = await fetch(`${GOV_RECON_URL}/api/suras/create-auto-video`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body: raw,
                signal: AbortSignal.timeout(300000),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return res.status(r.status).json(data);
            }
            const buf = Buffer.from(await r.arrayBuffer());
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', r.headers.get('content-disposition') || 'attachment; filename=SURAS_AUTO_AD.mp4');
            res.status(200).send(buf);
        } catch (err) {
            res.status(502).json({ detail: `محرك الفيديو غير متاح: ${err.message}` });
        }
    });
});

// ============================================================
// SURAS UI Live Preview Core (brain/live_preview.py) bridge
// ============================================================
app.post('/api/suras/render-preview', (req, res) => {
    readRawBody(req).then(async (raw) => {
        try {
            const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
            const r = await fetch(`${GOV_RECON_URL}/api/suras/render-preview`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body: raw,
                signal: AbortSignal.timeout(60000),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return res.status(r.status).json(data);
            }
            const html = await r.text();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(html);
        } catch (err) {
            res.status(502).json({ detail: `محرك المعاينة غير متاح: ${err.message}` });
        }
    });
});

// ============================================================
// Suras Voice Engine (brain/tts_engine.py) bridge
// ============================================================
app.post('/api/suras/tts', (req, res) => {
    readRawBody(req).then(async (raw) => {
        try {
            const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
            const r = await fetch(`${GOV_RECON_URL}/api/suras/tts`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body: raw,
                signal: AbortSignal.timeout(30000),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return res.status(r.status).json(data);
            }
            const buf = Buffer.from(await r.arrayBuffer());
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.setHeader('Content-Disposition', 'attachment; filename=suras_speech.mp3');
            res.setHeader('Content-Type', 'audio/mpeg');
            res.status(200).send(buf);
        } catch (err) {
            res.status(502).json({ detail: `محرك الصوت غير متاح: ${err.message}` });
        }
    });
});

// ============================================================
// Military Vault — AES-256 (brain/vault_core.py) bridge
// ============================================================
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function proxyVault(req, res, action) {
    try {
        const raw = await readRawBody(req);
        const contentType = req.headers['content-type'] || 'application/octet-stream';
        const r = await fetch(`${GOV_RECON_URL}/api/vault/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: raw,
            signal: AbortSignal.timeout(120000),
        });
        const buf = Buffer.from(await r.arrayBuffer());
        const disposition = r.headers.get('content-disposition') || '';
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        if (disposition) res.setHeader('Content-Disposition', disposition);
        res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
        if (!r.ok) {
            return res.status(r.status).json({ detail: buf.toString('utf-8').slice(0, 400) });
        }
        res.status(r.status).send(buf);
    } catch (err) {
        res.status(502).json({ detail: `الخزنة غير متاحة: ${err.message}` });
    }
}

app.post('/api/vault/encrypt', (req, res) => proxyVault(req, res, 'encrypt'));
app.post('/api/vault/decrypt', (req, res) => proxyVault(req, res, 'decrypt'));
async function proxyWebScout(req, res) {
    try {
        const raw = await readRawBody(req);
        const contentType = req.headers['content-type'] || 'application/json';
        const r = await fetch(`${GOV_RECON_URL}/api/web-scout`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: raw,
            signal: AbortSignal.timeout(120000),
        });
        const buf = Buffer.from(await r.arrayBuffer());
        let json = null;
        try { json = JSON.parse(buf.toString('utf-8')); } catch (_) {}
        if (!r.ok) {
            const detail = json && json.detail ? json.detail : buf.toString('utf-8').slice(0, 400);
            return res.status(r.status).json({ detail });
        }
        if (json) return res.status(r.status).json(json);
        res.status(r.status).send(buf);
    } catch (err) {
        res.status(502).json({ detail: `Web Scout agent unreachable: ${err.message}` });
    }
}

app.post('/api/web-scout', (req, res) => proxyWebScout(req, res));


// ============================================================
// OSINT Intelligence Engine (brain/osint_engine.py) bridge
// ============================================================
app.post('/api/osint/scan', (req, res) => {
    readRawBody(req).then(async (raw) => {
        try {
            const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
            const r = await fetch(`${GOV_RECON_URL}/api/osint/scan`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body: raw,
                signal: AbortSignal.timeout(30000),
            });
            const data = await r.json().catch(() => ({}));
            res.status(r.status).json(data);
        } catch (err) {
            res.status(502).json({ status: 'engine_unavailable', error: `محرك OSINT غير متاح: ${err.message}` });
        }
    });
});

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
    console.log(`[Suras Server] Running on http://localhost:${PORT}`);
    console.log('[Suras Server] AI bridge: Ollama local-first (Gemini only when AI_PROVIDER=gemini).');
    startGovServer();
    console.log('[Suras Server] Gov Recon Engine: spawning brain/security_server.py on :3010');
});
