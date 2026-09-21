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

cfg = load_env(ENV_PATH)
api_key = cfg.get('OPENAI_API_KEY', '')

# List of URLs to test
endpoints = [
    "https://generativelanguage.googleapis.com/v1beta/",
    "https://generativelanguage.googleapis.com/v1beta/openai/",
]

from openai import OpenAI

for base_url in endpoints:
    print(f"\n--- Testing Endpoint: {base_url} ---")
    try:
        client = OpenAI(api_key=api_key, base_url=base_url)
        resp = client.chat.completions.create(
            model="gemini-1.5-flash",
            messages=[{"role": "user", "content": "Hello! Reply with 'GEMINI_ONLINE'"}],
            max_tokens=20
        )
        print("SUCCESS!")
        print("Gemini Replied:", resp.choices[0].message.content)
        break
    except Exception as e:
        print("Error:", e)
