import urllib.request
import json
import os

api_key = os.environ.get("OPENAI_API_KEY", "")
if not api_key:
    raise SystemExit("OPENAI_API_KEY is required; set it in the environment, never in source code.")
url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"

print("Connecting directly to Google Gemini API via HTTPS...")
try:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode('utf-8'))
        models = [m.get('name') for m in data.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
        print("SUCCESS! Available models for your API Key:")
        for m in models[:10]:
            print(f" - {m}")
except Exception as e:
    print("FAILED to list models:")
    print(e)
