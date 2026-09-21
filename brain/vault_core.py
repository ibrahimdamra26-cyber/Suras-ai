import os
import json
from fastapi import APIRouter, Form, UploadFile, File, HTTPException, Response

router = APIRouter()

CORE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(CORE_DIR, '..', 'server', '.env')

MAGIC = b'SVLT'
SALT_LEN = 16
NONCE_LEN = 12


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


def _derive_key(password: str, salt: bytes) -> bytes:
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=120000,
    )
    return kdf.derive(password.encode('utf-8'))


def _encrypt_aes(plaintext: bytes, key: bytes, nonce: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM(key).encrypt(nonce, plaintext, None)


def _decrypt_aes(ciphertext: bytes, key: bytes, nonce: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM(key).decrypt(nonce, ciphertext, None)


@router.post('/api/vault/encrypt')
async def vault_encrypt(
    file0: UploadFile = File(...),
    vault_password: str = Form(...),
    auth_key: str = Form(None),
):
    if auth_key != get_master_key():
        raise HTTPException(status_code=403, detail='ACCESS_DENIED: لا تملك الصلاحيات السيادية للوصول إلى الخزنة المصنفة.')
    data = await file0.read()
    if not data:
        raise HTTPException(status_code=400, detail='الملف فارغ.')

    salt = os.urandom(SALT_LEN)
    nonce = os.urandom(NONCE_LEN)
    key = _derive_key(vault_password, salt)
    orig_name = file0.filename or 'document.bin'
    payload = orig_name.encode('utf-8') + b'\x00' + data
    ct = _encrypt_aes(payload, key, nonce)
    envelope = MAGIC + salt + nonce + ct

    return Response(
        content=envelope,
        media_type='application/octet-stream',
        headers={
            'Content-Disposition': 'attachment; filename="secured_file.suras"',
            'Access-Control-Expose-Headers': 'Content-Disposition',
        },
    )


@router.post('/api/vault/decrypt')
async def vault_decrypt(
    file0: UploadFile = File(...),
    vault_password: str = Form(...),
    auth_key: str = Form(None),
):
    if auth_key != get_master_key():
        raise HTTPException(status_code=403, detail='ACCESS_DENIED: لا تملك الصلاحيات السيادية للوصول إلى الخزنة المصنفة.')
    envelope = await file0.read()
    if not envelope.startswith(MAGIC) or len(envelope) < len(MAGIC) + SALT_LEN + NONCE_LEN + 16:
        raise HTTPException(status_code=400, detail='الملف ليس صيغة سوراس المشفرة (.suras).')

    salt = envelope[len(MAGIC):len(MAGIC) + SALT_LEN]
    nonce = envelope[len(MAGIC) + SALT_LEN:len(MAGIC) + SALT_LEN + NONCE_LEN]
    ct = envelope[len(MAGIC) + SALT_LEN + NONCE_LEN:]
    key = _derive_key(vault_password, salt)
    try:
        plaintext = _decrypt_aes(ct, key, nonce)
    except Exception:
        raise HTTPException(status_code=400, detail='كلمة مرور الخزنة غير صحيحة أو الملف معطوب.')

    split = plaintext.find(b'\x00')
    if split < 0:
        raise HTTPException(status_code=400, detail='صيغة الخزنة معطوبة.')
    orig_name = plaintext[:split].decode('utf-8', 'replace') or 'restored_file'
    file_data = plaintext[split + 1:]

    return Response(
        content=file_data,
        media_type='application/octet-stream',
        headers={
            'Content-Disposition': f'attachment; filename="{orig_name}"',
            'Access-Control-Expose-Headers': 'Content-Disposition',
        },
    )