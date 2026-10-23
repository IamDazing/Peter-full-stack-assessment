"""Run all required automated checks with the selected Python environment."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
npm = shutil.which("npm")
if not npm:
    sys.exit("npm is missing")
for command, cwd in [
    ([sys.executable, "-m", "pytest", "-q"], root),
    ([npm, "test"], root / "app/frontend"),
    ([npm, "run", "build"], root / "app/frontend"),
]:
    subprocess.run(command, cwd=cwd, check=True)
