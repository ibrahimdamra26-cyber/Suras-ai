"""Suras Cloud Bridge — Suras talks to its Cloud LLM (Gemini/OpenAI) through Python.

No Ollama, no local model libraries. The server spawns:
    python cloud_bridge.py chat   (stdin: {"system": ..., "user": ..., "temperature"?, "max_tokens"?})
    python cloud_bridge.py code   (same shape; lower temperature for deterministic code)

Config lives ONLY in server/.env (never in code):
    OPENAI_API_KEY=AIzaSy...   (Gemini API Key)
    OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/
    OPENAI_MODEL=gemini-2.5-flash

Stdout is always a single JSON line: {"reply": "..."} or {"error": "..."}.
The API key is never printed.
"""
import json
import os
import sys

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


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'chat'
    if mode == 'status':
        cfg = load_env(ENV_PATH)
        model = cfg.get('OPENAI_MODEL') or os.environ.get('OPENAI_MODEL', 'gemini-2.5-flash')
        key = cfg.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY', '')
        print(json.dumps({'model': model, 'key_configured': bool(key.strip())}, ensure_ascii=False))
        return
    try:
        raw = sys.stdin.read() or ''
        payload = json.loads(raw.lstrip('\ufeff').strip() or '{}')
    except Exception:
        payload = {}
    system = str(payload.get('system', ''))
    user = str(payload.get('user', ''))
    temperature = float(payload.get('temperature', 0.2 if mode == 'code' else 0.5))
    # For code generation, allow much larger output (Gemini supports up to 65536)
    max_tokens = int(payload.get('max_tokens', 8000 if mode == 'code' else 2000))

    cfg = load_env(ENV_PATH)
    api_key = cfg.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY', '')
    model = cfg.get('OPENAI_MODEL') or os.environ.get('OPENAI_MODEL', 'gemini-2.5-flash')
    base_url = cfg.get('OPENAI_BASE_URL') or os.environ.get('OPENAI_BASE_URL') or None

    if not api_key:
        print(json.dumps({'error': 'missing OPENAI_API_KEY (server/.env)'}, ensure_ascii=True))
        return
    if not user.strip():
        print(json.dumps({'error': 'empty user prompt'}, ensure_ascii=True))
        return
    try:
        from openai import OpenAI
        kwargs = {'api_key': api_key, 'timeout': 90.0}
        if base_url:
            kwargs['base_url'] = base_url
        client = OpenAI(**kwargs)
        messages = []
        if system.strip():
            messages.append({'role': 'system', 'content': system})
        messages.append({'role': 'user', 'content': user})
        
        # Use max_completion_tokens for newer models (Gemini compatibility)
        create_kwargs = {
            'model': model,
            'messages': messages,
            'temperature': temperature,
        }
        # Gemini via OpenAI-compat uses max_tokens
        create_kwargs['max_tokens'] = max_tokens
        
        resp = client.chat.completions.create(**create_kwargs)
        text = (resp.choices[0].message.content or '').strip()
        if not text:
            print(json.dumps({'error': 'empty cloud reply'}, ensure_ascii=True))
            return
        print(json.dumps({'reply': text, 'model': model}, ensure_ascii=True))
    except Exception as e:
        msg = str(e)
        if api_key and api_key in msg:
            msg = msg.replace(api_key, '***')
        print(json.dumps({'error': msg[:500]}, ensure_ascii=True))


if __name__ == '__main__':
    main()
