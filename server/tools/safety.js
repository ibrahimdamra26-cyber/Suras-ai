// ============================================================
// Suras Safety Rails — قضبان الأمان لأداة التنفيذ
// ------------------------------------------------------------
// أفكار مقتبسة (إعادة تنفيذ بلغتنا):
//  • سلوكيات allow/deny/ask + تحذيرات تدميرية إعلامية
//  • قوائم قراءة-فقط بالأعلام الآمنة لكل أمر
//  • وضع ask في سياق الشات غير التفاعلي = طلب تأكيد صريح
//    (ينفَّذ فقط إن حملت الرسالة نفسها تأكيداً واضحاً)
// ============================================================

// أوامر قراءة-فقط آمنة دائماً (تتجاوز الفحص وتمنح allow فوري)
const READONLY_PATTERNS = [
    // PowerShell استعلام
    /^\s*(Get-[A-Za-z]+|Select-Object|Where-Object|Measure-Object|Sort-Object|Format-Table|Format-List|Test-Path|Split-Path|Join-Path|Resolve-Path)\b/i,
    /^\s*(dir|ls|pwd|whoami|hostname|echo|date|Get-Date|Get-Location)\b/i,
    // git قراءة
    /^\s*git\s+(status|log|diff|show|branch|remote\s+(-v|show)?|ls-files|rev-parse)\b/i,
    // استعلام حزم وبيئة
    /^\s*(npm\s+(list|ls|view|ping|whoami)|pip\s+(list|show|check|freeze)|python\s+--version|node\s+--version)\b/i,
];

// حظر قطعي — لا يُنفَّذ أبداً
const DENY_PATTERNS = [
    { re: /\brm\s+-rf\b|\brm\s+-r\s+\//i, reason: 'حذف جذري متكرر (rm -rf)' },
    { re: /\bdel\s+[a-zA-Z]:/i, reason: 'حذف على مستوى قرص (del X:)' },
    { re: /\bformat\s+[a-zA-Z]/i, reason: 'تهيئة قرص (format)' },
    { re: /\bmkfs\b/i, reason: 'تهيئة نظام ملفات (mkfs)' },
    { re: /\b(shutdown|Restart-Computer|Stop-Computer)\b/i, reason: 'إطفاء/إعادة تشغيل الجهاز' },
    { re: /-EncodedCommand\b/i, reason: 'أمر مشفّر غامض (EncodedCommand)' },
    { re: /-(enc|e)\b\s+[A-Za-z0-9+/=]{8,}/i, reason: 'أمر مشفّر مختصر (-enc يحمل base64)' },
    { re: /\b(Invoke-Expression|iex)\b[^|;&\n]*\b(Net\.WebClient|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadFile)\b/i, reason: 'مهد تنزيل وتنفيذ عن بُعد (download cradle)' },
    { re: /\bFormat-Volume\b|\bClear-Disk\b/i, reason: 'تدمير أقراص' },
    { re: /\bvssadmin\b[^|;&\n]*delete\s+shadows/i, reason: 'حذف نسخ الظل (سلوك فدية)' },
    { re: /\bbcdedit\b|\bdiskpart\b/i, reason: 'تعديل إقلاع/أقراص منخفض المستوى' },
    { re: /\bcipher\s+\/w/i, reason: 'مسح آمن للقرص' },
    { re: /\breg\s+delete\s+HKLM\b|\bRemove-Item\b[^|;&\n]*HKLM:[^|;&\n]*-Recurse/i, reason: 'حذف من سجل النظام' },
    { re: /\bnet\s+user\b[^|;&\n]*\/add/i, reason: 'إنشاء مستخدم نظام' },
];

// يتطلب تأكيداً صريحاً — يُسأل المستخدم أولاً
const ASK_PATTERNS = [
    { re: /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*(?:-Recurse|-Force)/i, reason: 'حذف ملفات (متكرر/قسري)' },
    { re: /\bClear-Content\b[^|;&\n]*\*/i, reason: 'مسح محتوى ملفات متعددة' },
    { re: /\b(Set-ItemProperty|New-ItemProperty)\b[^|;&\n]*HKLM/i, reason: 'كتابة في سجل النظام' },
    { re: /\breg\s+add\s+HKLM\b/i, reason: 'كتابة في سجل النظام' },
    { re: /\b(New-Service|Set-Service|Remove-Service)\b/i, reason: 'تغيير خدمات النظام' },
    { re: /\bschtasks\s+\/create\b/i, reason: 'إنشاء مهمة مجدولة' },
    { re: /pip\s+install|pip3\s+install|npm\s+(install|i)\s/i, reason: 'تثبيت حزمة جديدة (يتطلب موافقة أول مرة)' },
    { re: /\bStop-Process\b/i, reason: 'إيقاف عمليات جارية' },
    { re: /Invoke-WebRequest|Invoke-RestMethod|curl\.exe|wget\b/i, reason: 'تنزيل من الإنترنت' },
];

// تحذيرات إعلامية — يُنفَّذ مع تنبيه ظاهر
const WARN_PATTERNS = [
    { re: /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b/i, warning: 'يحذف ملفات — تحقق من المسار' },
    { re: /\bClear-Content\b/i, warning: 'يمسح محتوى ملف' },
    { re: /\bSet-Location\b|\bcd\s+\.\./i, warning: 'يغيّر مجلد العمل' },
    { re: /\bSet-Content\b|Out-File\b|Set-ExecutionPolicy\b/i, warning: 'يعدّل ملفات/سياسات' },
];

// عبارات التأكيد الصريح (يجب أن تكون مقصودة لا جزءاً من صياغة الطلب)
const CONFIRM_RE = /(أؤكد|اوافق|موافق|نعم نفذ|تأكيد التنفيذ|نفذ على مسؤوليتي|confirm execution|yes execute)/i;

/**
 * تصنيف أمر قبل تنفيذه.
 * @returns {{ decision: 'allow'|'warn'|'ask'|'deny', reasons: string[], warnings: string[], confirmed: boolean }}
 */
export function checkExecute(cmd, query = '') {
    const text = String(cmd || '');
    if (!text.trim()) {
        return { decision: 'deny', reasons: ['أمر فارغ'], warnings: [], confirmed: false };
    }
    if (READONLY_PATTERNS.some(p => p.test(text))) {
        return { decision: 'allow', reasons: ['أمر قراءة-فقط آمن'], warnings: [], confirmed: false };
    }
    const denyHits = DENY_PATTERNS.filter(p => p.re.test(text));
    if (denyHits.length > 0) {
        return { decision: 'deny', reasons: denyHits.map(h => h.reason), warnings: [], confirmed: false };
    }
    const warnings = WARN_PATTERNS.filter(p => p.re.test(text)).map(h => h.warning);
    const askHits = ASK_PATTERNS.filter(p => p.re.test(text));
    if (askHits.length > 0) {
        const confirmed = CONFIRM_RE.test(String(query || ''));
        return {
            decision: confirmed ? 'warn' : 'ask',
            reasons: askHits.map(h => h.reason),
            warnings,
            confirmed,
        };
    }
    if (warnings.length > 0) {
        return { decision: 'warn', reasons: [], warnings, confirmed: false };
    }
    return { decision: 'allow', reasons: [], warnings: [], confirmed: false };
}
