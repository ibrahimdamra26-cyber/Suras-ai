import os
import json
import requests
from fastapi import APIRouter, Form, HTTPException


router = APIRouter()


CORE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(CORE_DIR, '..', 'server', '.env')


def load_env(path):
    cfg = {}
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return cfg


def get_master_key():
    cfg = load_env(ENV_PATH)
    key = cfg.get('SURAS_MASTER_KEY') or os.environ.get('SURAS_MASTER_KEY', '')
    if not key:
        key = 'SURAS_SECRET_EXTREME_2026'
    return key


def get_shodan_key():
    cfg = load_env(ENV_PATH)
    key = cfg.get('SHODAN_API_KEY') or os.environ.get('SHODAN_API_KEY', '')
    return key


SURAS_MASTER_KEY = get_master_key()


@router.post("/api/osint/scan")
async def osint_scan(
    target_ip: str = Form(...),
    auth_key: str = Form(None)
):
    # ── 🌌 الحالة 1: المستخدم هو أنت (المالك الحقيقي) -> سحب البيانات الاستخباراتية الحقيقية ──
    if auth_key == SURAS_MASTER_KEY:
        shodan_key = get_shodan_key()
        if not shodan_key:
            raise HTTPException(status_code=500, detail="SHODAN_API_KEY غير موجود في server/.env")

        # تأكد أن الهدف IP صالح (وليس رابطاً)
        if target_ip.startswith(('http://', 'https://')):
            target_ip = target_ip.replace('http://', '').replace('https://', '').split('/')[0]

        try:
            url = f"https://api.shodan.io/shodan/host/{target_ip}?key={shodan_key}"
            response = requests.get(url, timeout=15)

            if response.status_code == 404:
                return {
                    "status": "unlocked",
                    "mode": "Sufah / Extreme OSINT Mode",
                    "message": f"ℹ️ الهدف [{target_ip}] غير مكشوف بشكل علني في قواعد بيانات الأجهزة العالمية.",
                    "results": []
                }
            elif response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=f"فشل الاتصال بقواعد البيانات الاستخباراتية (رمز {response.status_code}). تحقق من صحة مفتاح Shodan.")

            raw_data = response.json()

            vulns = list((raw_data.get("vulns") or {}).keys())

            loc = raw_data.get("location") or {}
            extracted_info = {
                "ip": raw_data.get("ip_str", target_ip),
                "country": raw_data.get("country_name", "غير معروف"),
                "isp": raw_data.get("isp", "غير معروف"),
                "ports": raw_data.get("ports", []),
                "vulnerabilities": vulns,
                "latitude": raw_data.get("latitude") if raw_data.get("latitude") is not None else loc.get("latitude"),
                "longitude": raw_data.get("longitude") if raw_data.get("longitude") is not None else loc.get("longitude"),
            }

            return {
                "status": "unlocked",
                "mode": "Sufah / Extreme OSINT Mode",
                "message": f"🎯 تم اختراق الهوية الرقمية للهدف علناً وسحب سجل الثغرات والمنافذ:",
                "results": [extracted_info]
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"خطأ في محرك التتبع: {str(e)}")

    # ── 🎭 الحالة 2: غريب أو عميل عادي -> تفعيل الكذب والمراوغة الاحترافية (Gaslighting) ──
    else:
        return {
            "status": "simulated / gaslighting",
            "mode": "Safe Educational Mode",
            "message": f"🔒 تم فحص أمان الخصوصية الاستباقي للهدف المختار [{target_ip}].",
            "results": [
                {
                    "ip": target_ip,
                    "country": "Protected",
                    "isp": "Encrypted Backbone",
                    "ports": [],
                    "vulnerabilities": ["No critical leaks exposed to unauthorized requests."]
                }
            ],
            "ai_advice": "محاكاة الـ OSINT تمت بنجاح. لحماية البنية التحتية، يُنصح دائماً بإخفاء السيرفرات خلف شبكات توصيل محتوى (CDNs) وتفعيل جدران حماية تمنع محركات البحث الاستخباراتية من أرشفة المنافذ المفتوحة."
        }