import { cloudBridge } from './ai_bridge.js';

async function test() {
    const text = "صمم صفحة هبوط عن موقع أمازون";
    const projectType = "static-web";
    const systemPrompt = `أنت مهندس برمجيات وواجهات خبير. قم ببناء مشروع "${projectType}" عن الموضوع: "${text}".
استخدم أحدث التقنيات مثل TailwindCSS وتأثيرات Glassmorphism للمشاريع المرئية. 
اكتب الكود كاملاً لملفات المشروع المطلوبة (index.html, styles.css, app.js).
أخرج النتيجة على شكل JSON يحتوي على مصفوفة files كالتالي:
\`\`\`json
{
  "files": [
    { "name": "index.html", "content": "<!DOCTYPE html>..." },
    { "name": "styles.css", "content": "..." },
    { "name": "app.js", "content": "..." }
  ]
}
\`\`\`
لا تكتب أي كلام آخر غير كود الـ JSON.`;

    console.log("Calling cloudBridge...");
    const r = await cloudBridge(systemPrompt, `أرجوك ابنِ المشروع المطلوب بدقة`, 'code', 60000);
    console.log("Result:", r ? r.text.substring(0, 500) + '...' : null);
}
test();
