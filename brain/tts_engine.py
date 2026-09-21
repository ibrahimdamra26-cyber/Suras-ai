import io
from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import StreamingResponse
from gtts import gTTS


router = APIRouter()


@router.post("/api/suras/tts")
async def suras_tts(
    text: str = Form(...),
    lang: str = Form("ar")  # يدعم العربية 'ar' والإنجليزية 'en' تلقائياً
):
    """
    محرك النطق الصوتي الفوري الخفيف لـ SURAS لتحويل الإجابات والنصوص إلى ملفات صوتية متدفقة.
    """
    if not text.strip():
        raise HTTPException(status_code=400, detail="النص المرسل فارغ، يرجى كتابة محتوى ليتم نطقة.")

    try:
        # توليد الصوت سحابياً دون أي مجهود على معالج لابتوبك
        tts = gTTS(text=text, lang=lang, slow=False)

        # حفظ بايتات الصوت في الذاكرة المؤقتة (RAM) لتسريع الأداء بدلاً من الكتابة على الهاردوير
        mp3_fp = io.BytesIO()
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)

        # بث الملف الصوتي فوراً للمتصفح كتدفق سريع
        return StreamingResponse(
            mp3_fp,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=suras_speech.mp3"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل محرك النطق السحابي: {str(e)}")