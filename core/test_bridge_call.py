import subprocess
import json

payload = {
    "system": "You are a helpful assistant.",
    "user": "اكتب كود دالة لحساب مجموع مصفوفة في جافاسكريبت",
    "temperature": 0.5,
    "max_tokens": 800
}

print("Running cloud_bridge.py chat...")
process = subprocess.Popen(
    ['python', 'e:/Suras/core/cloud_bridge.py', 'chat'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True
)

stdout, stderr = process.communicate(input=json.dumps(payload))

print("STDOUT:")
print(stdout)
print("STDERR:")
print(stderr)
