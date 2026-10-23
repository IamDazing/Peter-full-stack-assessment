"""Start both local services; stop both on Ctrl+C or a child failure."""
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("Node.js is missing. Install Node.js 22.12+ (22 LTS) or 24 LTS first.", file=sys.stderr)
        return 1
    if not (ROOT / "app/frontend/node_modules").exists():
        print("Run npm ci --prefix app/frontend first.", file=sys.stderr)
        return 1
    children: list[subprocess.Popen] = []
    try:
        children.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "app.backend.main:app", "--host", "127.0.0.1", "--port", "8000"], cwd=ROOT))
        # Launch Vite directly so termination cannot orphan an npm child process.
        children.append(subprocess.Popen([node, str(ROOT / "app/frontend/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"], cwd=ROOT / "app/frontend"))
        print("Frontend http://127.0.0.1:5173 | API http://127.0.0.1:8000/docs", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.3)
        return next((child.returncode for child in children if child.returncode), 1)
    except KeyboardInterrupt:
        return 0
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    sys.exit(main())
