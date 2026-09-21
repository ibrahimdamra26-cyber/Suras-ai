# Suras AI — Automation & System Tools Module
import os, sys, json, time, subprocess

def run_safe_cmd(cmd):
    """Execute a system command and return output."""
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return {"code": res.returncode, "stdout": res.stdout, "stderr": res.stderr}
    except Exception as e:
        return {"code": 1, "error": str(e)}

def list_workspace_files(base_dir="."):
    """Return all files recursively in a directory."""
    files = []
    for root, dirs, fnames in os.walk(base_dir):
        if any(ignored in root for ignored in ['node_modules', '.git', '__pycache__']):
            continue
        for f in fnames:
            files.append(os.path.join(root, f))
    return files

if __name__ == '__main__':
    print(f"Suras Automation Tools loaded successfully. Ready for execution.")
