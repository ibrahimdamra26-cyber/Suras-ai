import uvicorn
import traceback
import sys
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from security_core import router as security_router
from vault_core import router as vault_router
from osint_engine import router as osint_router
from tts_engine import router as tts_router
from video_engine import router as video_router
from live_preview import router as preview_router
from web_scout import router as web_scout_router

app = FastAPI(title="Suras Gov Recon Engine")

# اصطياد مركزي: طباعة كامل الـ traceback لأي استثناء غير مُلتقَط لسهولة التشخيص
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    print("FATAL:", repr(exc), file=sys.stderr)
    return JSONResponse(status_code=500, content={"detail": f"خطأ داخلي: {type(exc).__name__}: {str(exc)}"})

app.include_router(security_router, tags=["Gov Recon Engine"])
app.include_router(vault_router, tags=["Military Vault Engine"])
app.include_router(osint_router, tags=["OSINT Intelligence Engine"])
app.include_router(tts_router, tags=["Suras Voice Engine"])
app.include_router(video_router, tags=["SURAS Video Production Core"])
app.include_router(preview_router, tags=["SURAS UI Live Preview Core"])
app.include_router(web_scout_router, tags=["SURAS Web Scout Agent"])

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=3010)