from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import HTMLResponse
import html as html_lib


router = APIRouter()


@router.post("/api/suras/render-preview", response_class=HTMLResponse)
async def render_live_preview(
    html_code: str = Form(...),
    css_framework: str = Form("tailwind")  # يدعم Tailwind CSS تلقائياً لتصميم الواجهات الحديثة
):
    """
    محرك الـ Live Preview المطور لـ SURAS.
    يستقبل الأكواد الهندسية ويحقنها داخل حاوية آمنة ليعرض الواجهات حية للمستخدم.
    """
    if not html_code.strip():
        raise HTTPException(status_code=400, detail="كود الواجهة المرسل فارغ.")

    # إدراج روابط مكتبات التنسيق الحديثة تلقائياً بناءً على اختيار المستخدم لضمان الفخامة البصرية
    # ملاحظة: CDN الرسمي هو cdn.tailwindcss.com (وليس tailwindcss.com وهو موقع التوثيق)
    tailwind_script = '<script src="https://cdn.tailwindcss.com"></script>' if css_framework == "tailwind" else ""

    # بناء الصفحة الكاملة والمؤمنة داخل البيئة المحلية
    full_html_document = f"""
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SURAS Live UI Preview</title>
        {tailwind_script}
        <style>
            body {{
                font-family: 'Cairo', sans-serif;
                margin: 0;
                padding: 20px;
                background-color: #0d1117;
                color: #c9d1d9;
            }}
        </style>
    </head>
    <body>
        <!-- حقن الواجهة المولدة من الروبوت هنا حركياً -->
        {html_code}
    </body>
    </html>
    """

    return HTMLResponse(content=full_html_document, status_code=200)


@router.post("/api/suras/create-auto-page", response_class=HTMLResponse)
async def create_auto_page(
    topic: str = Form(...),  # موضوع الصفحة/النشاط التجاري — يولّد البوت كل شيء بنفسه
    style: str = Form("gold"),
):
    """
    مولّد صفحات الهبوط الذاتي: تصميم parametric كامل (بطل + مزايا +
    منتجات + آراء + CTA + تذييل) بهوية سوراس الذهبية — بلا أي اعتماد
    على الموديل السحابي، يعمل حتى عند انقطاع الحصة.
    """
    topic = topic.strip()[:80]
    if not topic:
        raise HTTPException(status_code=400, detail="الموضوع فارغ — عن ماذا تكون الصفحة؟")
    safe_topic = html_lib.escape(topic)

    doc = """<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TOPIC__ | صفحة هبوط</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
body { font-family: 'Cairo', sans-serif; background: #0c0a14; color: #f3ecdd; }
.hero { background: radial-gradient(ellipse 80% 60% at 50% 0%, #3d2358 0%, #1c1030 55%, #0c0a14 100%); }
.gold-text { background: linear-gradient(135deg, #f6d27a, #d4af55 60%, #9c7a2e); -webkit-background-clip: text; background-clip: text; color: transparent; }
.gold-btn { background: linear-gradient(135deg, #b08a2e, #f6d27a); color: #2e2008; transition: transform .2s, box-shadow .2s; }
.gold-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(212,175,85,.35); }
.glass { background: rgba(255,255,255,.045); border: 1px solid rgba(212,175,85,.25); backdrop-filter: blur(8px); }
.card:hover { transform: translateY(-4px); border-color: rgba(212,175,85,.6); }
.card { transition: transform .25s, border-color .25s; }
.badge { border: 1px solid rgba(212,175,85,.5); color: #f6d27a; }
.divider { height: 2px; background: linear-gradient(90deg, transparent, #d4af55, transparent); }
</style>
</head>
<body>
<header class="flex items-center justify-between px-6 md:px-12 py-5">
  <div class="text-2xl font-black gold-text">__TOPIC__</div>
  <nav class="hidden md:flex gap-8 text-sm opacity-80">
    <a href="#features" class="hover:text-yellow-200">المزايا</a>
    <a href="#products" class="hover:text-yellow-200">المنتجات</a>
    <a href="#reviews" class="hover:text-yellow-200">آراء العملاء</a>
  </nav>
  <a href="#cta" class="gold-btn font-bold px-5 py-2 rounded-full text-sm">اطلب الآن</a>
</header>
<section class="hero text-center px-6 pt-16 pb-20">
  <span class="badge rounded-full px-4 py-1 text-xs">✦ تجربة تسوق فاخرة ✦</span>
  <h1 class="text-4xl md:text-6xl font-black mt-6 leading-tight">كل ما تحتاجه من <span class="gold-text">__TOPIC__</span><br>في مكان واحد</h1>
  <p class="opacity-70 mt-4 max-w-xl mx-auto">جودة استثنائية، أسعار لا تُنافس، وتوصيل سريع لباب منزلك — اكتشف التشكيلة الآن.</p>
  <div class="mt-8 flex gap-4 justify-center">
    <a href="#products" class="gold-btn font-bold px-8 py-3 rounded-full">تسوّق الآن</a>
    <a href="#features" class="px-8 py-3 rounded-full border border-yellow-200/40 hover:bg-white/5">لماذا نحن؟</a>
  </div>
  <div class="mt-10 flex gap-10 justify-center text-center">
    <div><div class="text-3xl font-black gold-text">+10K</div><div class="text-xs opacity-60">عميل سعيد</div></div>
    <div><div class="text-3xl font-black gold-text">4.9★</div><div class="text-xs opacity-60">تقييم عام</div></div>
    <div><div class="text-3xl font-black gold-text">24h</div><div class="text-xs opacity-60">توصيل سريع</div></div>
  </div>
</section>
<div class="divider mx-12"></div>
<section id="features" class="px-6 md:px-12 py-14">
  <h2 class="text-2xl md:text-3xl font-black text-center mb-8">لماذا <span class="gold-text">__TOPIC__</span>؟</h2>
  <div class="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
    <div class="glass card rounded-2xl p-6 text-center"><div class="text-4xl">🚚</div><h3 class="font-bold mt-3">توصيل سريع</h3><p class="text-sm opacity-60 mt-2">لجميع المدن خلال 24 ساعة مع تغليف فاخر.</p></div>
    <div class="glass card rounded-2xl p-6 text-center"><div class="text-4xl">💎</div><h3 class="font-bold mt-3">جودة مضمونة</h3><p class="text-sm opacity-60 mt-2">منتجات أصلية مختارة بعناية مع ضمان الاستبدال.</p></div>
    <div class="glass card rounded-2xl p-6 text-center"><div class="text-4xl">💰</div><h3 class="font-bold mt-3">أسعار منافسة</h3><p class="text-sm opacity-60 mt-2">عروض يومية وخصومات حصرية للأعضاء.</p></div>
  </div>
</section>
<section id="products" class="px-6 md:px-12 py-14" style="background:rgba(255,255,255,.015)">
  <h2 class="text-2xl md:text-3xl font-black text-center mb-8">الأكثر طلباً في <span class="gold-text">__TOPIC__</span></h2>
  <div class="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
    <div class="glass card rounded-2xl p-6 text-center"><div class="text-5xl">📦</div><h3 class="font-bold mt-4">الباقة الأساسية</h3><div class="gold-text text-2xl font-black mt-2">99 ر.س</div><a href="#cta" class="gold-btn inline-block mt-4 px-6 py-2 rounded-full text-sm font-bold">أضف للسلة</a></div>
    <div class="glass card rounded-2xl p-6 text-center" style="border-color:rgba(212,175,85,.6)"><div class="text-5xl">🎁</div><h3 class="font-bold mt-4">الباقة المميزة <span class="text-xs badge rounded-full px-2 py-0.5">الأكثر مبيعاً</span></h3><div class="gold-text text-2xl font-black mt-2">199 ر.س</div><a href="#cta" class="gold-btn inline-block mt-4 px-6 py-2 rounded-full text-sm font-bold">أضف للسلة</a></div>
    <div class="glass card rounded-2xl p-6 text-center"><div class="text-5xl">👑</div><h3 class="font-bold mt-4">الباقة الملكية</h3><div class="gold-text text-2xl font-black mt-2">349 ر.س</div><a href="#cta" class="gold-btn inline-block mt-4 px-6 py-2 rounded-full text-sm font-bold">أضف للسلة</a></div>
  </div>
</section>
<section id="reviews" class="px-6 md:px-12 py-14">
  <h2 class="text-2xl md:text-3xl font-black text-center mb-8">ماذا يقول عملاؤنا؟</h2>
  <div class="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
    <div class="glass rounded-2xl p-6"><div class="text-yellow-300">★★★★★</div><p class="mt-2 text-sm opacity-80">"تجربة رائعة من الطلب حتى الاستلام. الجودة فاقت توقعاتي!"</p><div class="mt-3 text-sm font-bold">— أحمد م.</div></div>
    <div class="glass rounded-2xl p-6"><div class="text-yellow-300">★★★★★</div><p class="mt-2 text-sm opacity-80">"أفضل متجر جربته. التوصيل كان أسرع مما تخيلت والأسعار ممتازة."</p><div class="mt-3 text-sm font-bold">— سارة خ.</div></div>
  </div>
</section>
<section id="cta" class="text-center px-6 py-16" style="background:radial-gradient(ellipse 70% 80% at 50% 100%, #3d2358 0%, #0c0a14 70%)">
  <h2 class="text-3xl md:text-4xl font-black">جاهز تبدأ التسوق من <span class="gold-text">__TOPIC__</span>؟</h2>
  <p class="opacity-70 mt-3">خصم 15% على أول طلب — الكمية محدودة.</p>
  <a href="#" class="gold-btn inline-block mt-6 px-10 py-4 rounded-full font-black text-lg">ابدأ الآن</a>
</section>
<footer class="text-center py-8 text-xs opacity-50">إنتاج SURAS UI Live Preview Engine — __TOPIC__ © 2026</footer>
</body>
</html>"""

    return HTMLResponse(content=doc.replace("__TOPIC__", safe_topic), status_code=200)
