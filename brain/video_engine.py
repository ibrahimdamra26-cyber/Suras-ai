import os
import tempfile
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from moviepy import ImageClip, AudioFileClip, vfx


router = APIRouter()

# FFmpeg المضمّن من imageio-ffmpeg (لا يحتاج تثبيت يدوي على النظام)
import imageio_ffmpeg
os.environ["IMAGEIO_FFMPEG_EXE"] = imageio_ffmpeg.get_ffmpeg_exe()


def _render_video_from_paths(input_img_path, input_aud_path, duration, output_vid_path):
    """محرك الرندرة المشترك: يطبّق Ken Burns على الصورة ويدمج الصوت لموجز MP4."""
    video_clip = None
    audio_clip = None
    try:
        audio_clip = AudioFileClip(input_aud_path)
        effective_duration = min(duration, float(audio_clip.duration))

        base_clip = ImageClip(input_img_path).with_duration(effective_duration).with_fps(24)
        clip_w, clip_h = base_clip.w, base_clip.h

        video_clip = base_clip.resized(
            new_size=lambda t: (1.0 + 0.12 * (t / max(effective_duration, 0.1)))
        )
        video_clip = video_clip.cropped(
            x_center=clip_w / 2, y_center=clip_h / 2,
            width=clip_w, height=clip_h
        )
        video_clip = video_clip.with_effects([vfx.CrossFadeOut(0.6)])

        audio_clip = audio_clip.with_duration(effective_duration)
        video_clip = video_clip.with_audio(audio_clip)

        video_clip.write_videofile(
            output_vid_path,
            fps=24,
            codec="libx264",
            audio_codec="aac",
            logger=None,
        )
        return effective_duration
    finally:
        if video_clip is not None:
            try:
                video_clip.close()
            except Exception:
                pass
        if audio_clip is not None:
            try:
                audio_clip.close()
            except Exception:
                pass


@router.post("/api/suras/create-video")
async def create_marketing_video(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    duration: float = Form(15.0)  # المدة القياسية للإعلانات القصيرة 15 ثانية
):
    """
    محرك توليد الفيديوهات التسويقية المطور لـ SURAS.
    يطبّق تحريك Ken Burns السينمائي على الصورة ويدمج التعليق الصوتي لمخرج فيديو إعلاني احترافي محلياً.
    """
    # التحقق من الامتدادات لمنع انهيار FFmpeg
    if not image.filename.lower().endswith(('.png', '.jpg', '.jpeg')):
        raise HTTPException(status_code=400, detail="صيغة الصورة غير مدعومة. يرجى رفع JPG أو PNG.")
    if not audio.filename.lower().endswith(('.mp3', '.wav', '.m4a')):
        raise HTTPException(status_code=400, detail="صيغة الصوت غير مدعومة. يرجى رفع MP3 أو WAV.")

    # إنشاء مجلد مؤقت آمن لحماية هاردوير لابتوبك وتنظيف الملفات فوراً بعد التحميل
    with tempfile.TemporaryDirectory() as tmpdir:
        input_img_path = os.path.join(tmpdir, image.filename)
        input_aud_path = os.path.join(tmpdir, audio.filename)
        output_vid_path = os.path.join(tmpdir, "suras_ad_output.mp4")

        # حفظ الملفات المرفوعة مؤقتاً على القرص
        with open(input_img_path, "wb") as f:
            f.write(await image.read())
        with open(input_aud_path, "wb") as f:
            f.write(await audio.read())

        try:
            _render_video_from_paths(input_img_path, input_aud_path, duration, output_vid_path)

            # قراءة البايتات داخل الكتلة المؤقتة ثم إرجاعها مباشرة
            # (FileResponse يقصد المسار، لكن مجلد temp يُحذف قبل الإرسال — لذا نُمرّر الذاكرة)
            with open(output_vid_path, "rb") as f:
                video_bytes = f.read()

            return Response(
                content=video_bytes,
                media_type="video/mp4",
                headers={"Content-Disposition": 'attachment; filename="SURAS_AD_PRODUCTION.mp4"'},
            )

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل محرك رندرة وتوليد الفيديو: {str(e)}")


@router.post("/api/suras/create-auto-video")
async def create_auto_video(
    topic: str = Form(...),   # وصف المنتج/الخدمة الذي يحدده المستخدم للبوت
    duration: float = Form(15.0)
):
    """
    محرك الإنتاج الذاتي الكامل: البوت ينتج كل شيء بنفسه.
    يولّد البانر الإعلاني (PIL) + التعليق الصوتي (gTTS) + الفيديو السينمائي (MoviePy)
    دون أي ملفات من المستخدم ثم يبث MP4 جاهز للنشر.
    """
    topic = topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="الموضوع فارغ — ماذا تريد الإعلان عنه؟")

    topic = topic[:120]

    try:
        from PIL import Image, ImageDraw, ImageFont
        from gtts import gTTS
        import arabic_reshaper
        from bidi.algorithm import get_display
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"مكتبة إنتاج غير متوفرة: {str(e)}")

    def _ar(text):
        """تشكيل النص العربي للعرض الصحيح في PIL (اتصال الحروف + اتجاه RTL)."""
        return get_display(arabic_reshaper.reshape(str(text)))

    with tempfile.TemporaryDirectory() as tmpdir:
        banner_path = os.path.join(tmpdir, "banner.png")
        voice_path = os.path.join(tmpdir, "voice.mp3")
        output_vid_path = os.path.join(tmpdir, "auto_ad.mp4")

        # === 1) تصميم البانر الإعلاني الفاخر (1080x1920 عمودي لريلز/تيك توك) ===
        # هوية بصرية: إسبريسو دافئ + ذهبي ملكي + فينييت سينمائي
        from PIL import ImageFilter
        W, H = 1080, 1920
        GOLD, GOLD_LT, GOLD_DK = (212, 175, 88), (246, 210, 122), (148, 108, 44)
        CREAM = (248, 240, 224)

        def _lerp(c1, c2, t):
            return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

        # خلفية متدرجة ثلاثية: إسبريسو → عنابي دافئ → كحلي ليلي
        TOP, MID, BOT = (30, 17, 11), (56, 27, 44), (12, 12, 32)
        img = Image.new("RGB", (W, H))
        d = ImageDraw.Draw(img)
        for y in range(H):
            if y < H * 0.45:
                col = _lerp(TOP, MID, y / (H * 0.45))
            else:
                col = _lerp(MID, BOT, (y - H * 0.45) / (H * 0.55))
            d.line([(0, y), (W, y)], fill=col)

        # توهج ذهبي ناعم خلف المنتج (مرسوم صغيراً + تمويه + تكبير للسرعة والنعومة)
        glow = Image.new("RGBA", (W // 4, H // 4), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gw, gh = glow.size
        for rr, al in [(150, 26), (115, 36), (80, 48), (48, 64)]:
            cx, cy = gw // 2, int(gh * 0.44)
            gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(236, 192, 112, al))
        glow = glow.filter(ImageFilter.GaussianBlur(12)).resize((W, H), Image.BILINEAR)
        img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
        d = ImageDraw.Draw(img)

        # فينييت سينمائي: تعتيم ناعم للحواف عبر قناع صغير مكبّر
        mw, mh = 120, 213
        vmask = Image.new("L", (mw, mh))
        vpx = vmask.load()
        for yy in range(mh):
            for xx in range(mw):
                dx = (xx - mw / 2) / (mw / 2)
                dy = (yy - mh / 2) / (mh / 2)
                dist = min(1.0, (dx * dx + dy * dy) ** 0.5 / 1.12)
                vpx[xx, yy] = int(150 * dist * dist)
        vmask = vmask.resize((W, H), Image.BILINEAR)
        img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), vmask)
        d = ImageDraw.Draw(img)

        # حلقات ذهبية رفيعة + شرارات لامعة (طبقة شفافة)
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.ellipse([880 - 150, 180 - 150, 880 + 150, 180 + 150], outline=(212, 175, 88, 90), width=3)
        od.ellipse([880 - 105, 180 - 105, 880 + 105, 180 + 105], outline=(212, 175, 88, 55), width=2)
        od.ellipse([150 - 170, 1620 - 170, 150 + 170, 1620 + 170], outline=(212, 175, 88, 70), width=3)
        for sx, sy, sr in [(150, 620, 10), (935, 700, 7), (120, 1150, 8), (960, 1420, 10), (540, 240, 6)]:
            od.polygon([(sx, sy - sr * 2), (sx + sr // 2, sy - sr // 2), (sx + sr * 2, sy),
                        (sx + sr // 2, sy + sr // 2), (sx, sy + sr * 2),
                        (sx - sr // 2, sy + sr // 2), (sx - sr * 2, sy),
                        (sx - sr // 2, sy - sr // 2)], fill=(246, 210, 122, 200))
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        d = ImageDraw.Draw(img)

        # شريط ذهبي علوي متدرج
        for x in range(W):
            d.line([(x, 0), (x, 10)], fill=_lerp(GOLD_DK, GOLD_LT, x / W))

        # خطوط نصية
        def _load_font(size, bold=False):
            for cand in ["C:\\Windows\\Fonts\\Tahoma.ttf", "C:\\Windows\\Fonts\\segoeui.ttf", "C:\\Windows\\Fonts\\arial.ttf"]:
                if os.path.exists(cand):
                    try:
                        return ImageFont.truetype(cand, size)
                    except Exception:
                        continue
            return ImageFont.load_default()

        def _t(xy, text, font, fill):
            """نص بظل سفلي خفيف لعمق سينمائي."""
            x, y = xy
            d.text((x + 3, y + 5), text, font=font, fill=(0, 0, 0), anchor="mm")
            d.text((x, y), text, font=font, fill=fill, anchor="mm")

        def _fit(text, start, max_w):
            """تصغير تلقائي للخط حتى يلائم العرض المتاح."""
            size = start
            while size > 30:
                f = _load_font(size)
                bb = d.textbbox((0, 0), _ar(text), font=f)
                if bb[2] - bb[0] <= max_w:
                    return f
                size -= 6
            return _load_font(30)

        # العلامة التجارية
        _t((W // 2, 150), _ar("منظومة سوراس  •  SURAS"), _load_font(40), GOLD_LT)

        # شارة الفئة
        bw0, bw1, bh0, bh1 = (W - 360) // 2, (W + 360) // 2, 205, 300
        d.rounded_rectangle([bw0, bh0, bw1, bh1], radius=47, outline=GOLD, width=3)
        _t((W // 2, (bh0 + bh1) // 2), _ar("إعلان رقمي"), _load_font(54), CREAM)

        # فاصل زخرفي: خط — معين — خط
        dy0 = 375
        d.line([(W // 2 - 260, dy0), (W // 2 - 40, dy0)], fill=GOLD_DK, width=3)
        d.line([(W // 2 + 40, dy0), (W // 2 + 260, dy0)], fill=GOLD_DK, width=3)
        d.polygon([(W // 2, dy0 - 14), (W // 2 + 14, dy0), (W // 2, dy0 + 14), (W // 2 - 14, dy0)], fill=GOLD)

        # بطاقة المنتج الزجاجية بإطار ذهبي
        box_top, box_bot = 470, 1130
        card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(card).rounded_rectangle(
            [70, box_top, W - 70, box_bot], radius=56, fill=(10, 8, 20, 208))
        img = Image.alpha_composite(img.convert("RGBA"), card).convert("RGB")
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([70, box_top, W - 70, box_bot], radius=56, outline=GOLD, width=4)
        d.line([(120, box_top + 34), (W - 120, box_top + 34)], fill=(122, 96, 50), width=2)

        # سطر تمهيدي + اسم المنتج (تقسيم على حدود الكلمات + ملاءمة تلقائية)
        _t((W // 2, box_top + 105), _ar("— تجربة فاخرة تستحقها —"), _load_font(40), GOLD_LT)
        words = topic.split()
        if len(words) > 3:
            half = (len(words) + 1) // 2
            line1, line2 = " ".join(words[:half]), " ".join(words[half:])
            _t((W // 2, box_top + 330), _ar(line1), _fit(line1, 116, 840), CREAM)
            _t((W // 2, box_top + 480), _ar(line2), _fit(line2, 116, 840), CREAM)
        else:
            _t((W // 2, box_top + 400), _ar(topic), _fit(topic, 124, 860), CREAM)

        # زر CTA ذهبي متدرج بظل ناعم
        cbw, cbh = 640, 132
        bx0, by0 = (W - cbw) // 2, 1236
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle(
            [bx0, by0 + 14, bx0 + cbw, by0 + cbh + 14], radius=66, fill=(0, 0, 0, 120))
        sh = sh.filter(ImageFilter.GaussianBlur(12))
        img = Image.alpha_composite(img.convert("RGBA"), sh).convert("RGB")
        btn = Image.new("RGB", (cbw, cbh))
        bd = ImageDraw.Draw(btn)
        for x in range(cbw):
            bd.line([(x, 0), (x, cbh)], fill=_lerp(GOLD_DK, GOLD_LT, x / cbw))
        bmask = Image.new("L", (cbw, cbh), 0)
        ImageDraw.Draw(bmask).rounded_rectangle([0, 0, cbw, cbh], radius=66, fill=255)
        img.paste(btn, (bx0, by0), bmask)
        d = ImageDraw.Draw(img)
        d.text((W // 2, by0 + cbh // 2), _ar("اكتشف المزيد الآن"),
               font=_load_font(62), fill=(46, 28, 8), anchor="mm")

        # سطور الإقناع والتوقيع
        _t((W // 2, 1490), _ar("جودة استثنائية  •  سعر لا يُنافس"), _load_font(46), CREAM)
        _t((W // 2, 1600), _ar("اطلب الآن — الكمية محدودة"), _load_font(60), GOLD_LT)
        d.text((W // 2, 1845), _ar("إنتاج SURAS VIDEO ENGINE"),
               font=_load_font(34), fill=(150, 128, 80), anchor="mm")

        img.save(banner_path)

        # === 2) توليد التعليق الصوتي (gTTS) بمحتوى تلقائي ===
        voice_text = f"اكتشف {topic}. جودة استثنائية وسعر لا يُنافس، والنقل متوفر لجميع المدن. اطلب الآن!"
        tts = gTTS(text=voice_text, lang="ar", slow=False)
        mp3_fp = open(voice_path, "wb")
        tts.write_to_fp(mp3_fp)
        mp3_fp.close()

        # === 3) رندرة الفيديو السينمائي ===
        try:
            _render_video_from_paths(banner_path, voice_path, duration, output_vid_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل رندرة الفيديو: {str(e)}")

        with open(output_vid_path, "rb") as f:
            video_bytes = f.read()

        return Response(
            content=video_bytes,
            media_type="video/mp4",
            headers={"Content-Disposition": 'attachment; filename="SURAS_AUTO_AD.mp4"'},
        )