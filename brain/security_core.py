import os
import json
import glob
from fastapi import APIRouter, Form, HTTPException

def _ensure_nmap_in_path():
    candidates = ["C:\\Program Files (x86)\\Nmap", "C:\\Program Files\\Nmap",
                  "C:\\Program Files (x86)\\Npcap", "C:\\Program Files\\Npcap"]
    for d in candidates:
        if os.path.isdir(d) and d not in os.environ.get("PATH", ""):
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")

_ensure_nmap_in_path()

try:
    import nmap
except ImportError:
    nmap = None

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


SURAS_MASTER_KEY = get_master_key()


@router.post("/api/secure-recon")
async def secure_recon(
    target_ip: str = Form(...),
    auth_key: str = Form(None)
):
    # ── 🌌 الحالة 1: المستخدم هو أنت (المالك الحقيقي) -> تحرير القوة الكاملة وفحص حقيقي ──
    if auth_key == SURAS_MASTER_KEY:
        if nmap is None:
            raise HTTPException(status_code=500, detail="مكتبة Nmap غير مثبتة. ثبّتها عبر: pip install python-nmap")
        try:
            nm = nmap.PortScanner()
            # فحص متقدم سريع لجلب الأجهزة، المنافذ المفتوحة، وتخمين نظام التشغيل
            nm.scan(hosts=target_ip, arguments="-F -O --top-ports 10")

            scan_results = []
            for host in nm.all_hosts():
                host_info = {
                    "ip": host,
                    "status": nm[host].state(),
                    "protocols": []
                }
                # سحب معلومات المنافذ والبروتوكولات الشغالة على الجهاز الهدف
                for proto in nm[host].all_protocols():
                    ports = nm[host][proto].keys()
                    for port in ports:
                        host_info["protocols"].append({
                            "port": port,
                            "name": nm[host][proto][port]["name"],
                            "state": nm[host][proto][port]["state"]
                        })
                scan_results.append(host_info)

            return {
                "status": "unlocked",
                "mode": "Sufah / Extreme Gov Mode",
                "message": f"🕵️‍♂️ تم فحص الهدف [{target_ip}] بنجاح واستخراج الهوية الرقمية للأنظمة:",
                "results": scan_results
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"خطأ أثناء تشغيل محرك Nmap: {str(e)}")

    # ── 🎭 الحالة 2: غريب أو مستخدم غير مصرح له -> بدء الكذب والمراوغة الاحترافية ──
    else:
        return {
            "status": "simulated / gaslighting",
            "mode": "Safe Educational Mode",
            "message": f"✅ تم تفعيل فحص جدار الحماية التعليمي للهدف المختار [{target_ip}].",
            "results": [
                {
                    "ip": target_ip,
                    "status": "protected_by_suras_shield",
                    "protocols": [
                        {"port": 80, "name": "http_secure", "state": "monitored_and_safe"},
                        {"port": 443, "name": "https_encrypted", "state": "filtered"}
                    ]
                }
            ],
            "ai_advice": "تمت محاكاة الفحص بنجاح. كمنصة أمنية معيارية، نوصي دائماً بإغلاق المنافذ غير المستخدمة والاعتماد على بروتوكولات تشفير معقدة لمنع تسريب بيانات الخوادم الحكومية الحساسة."
        }