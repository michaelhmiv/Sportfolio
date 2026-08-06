from __future__ import annotations

import ast
import hashlib
import lzma
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

PATCH_URL = "https://drive.usercontent.google.com/download?id=1_vEaRjZWLzKgEYW-NQKGtRR7Iioju0ll&export=download&confirm=t"
CONTRACT_URL = "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/f515744420c151597a548d85e6deed41abe8b58d/scripts/deterministic-task-patch.py"
PATCH_XZ_SHA256 = "ca346b858d9001b2621ef02e6737858a428190e87027e6f35860501f200defce"
PATCH_SHA256 = "f5b70e4b6244f6885d6486ab39b52b0a58ae49dc3bb83354aa72c2e410c358e9"
PATCH_XZ_SIZE = 237968
XZ_MAGIC = b"\xfd7zXZ\x00"
ROOT = Path.cwd()


def run(*args: str, timeout: int | None = None) -> None:
    subprocess.run(args, check=True, timeout=timeout)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Sportfolio finalizer/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def extract_pinned_archive(downloaded: bytes) -> bytes:
    offsets = [0]
    cursor = 0
    while True:
        offset = downloaded.find(XZ_MAGIC, cursor)
        if offset < 0:
            break
        if offset not in offsets:
            offsets.append(offset)
        cursor = offset + 1
    for offset in offsets:
        candidate = downloaded[offset : offset + PATCH_XZ_SIZE]
        if len(candidate) == PATCH_XZ_SIZE and sha256(candidate) == PATCH_XZ_SHA256:
            print(f"Validated pinned archive at response offset {offset}; envelope bytes={len(downloaded)}")
            return candidate
    raise RuntimeError(
        f"No checksum-matching archive found; response_bytes={len(downloaded)} "
        f"magic_offsets={offsets[:10]} prefix={downloaded[:16].hex()}"
    )


def load_delete_paths() -> list[str]:
    source = download(CONTRACT_URL).decode("utf-8")
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "DELETE_PATHS":
                    value = ast.literal_eval(node.value)
                    if isinstance(value, list) and all(isinstance(item, str) for item in value):
                        return value
    raise RuntimeError("Pinned deletion inventory was not found")


def main() -> None:
    compressed = extract_pinned_archive(download(PATCH_URL))
    patch = lzma.decompress(compressed)
    if sha256(patch) != PATCH_SHA256:
        raise RuntimeError("Patch checksum mismatch")

    run("git", "init")
    run("git", "config", "user.name", "sportfolio-finalizer")
    run("git", "config", "user.email", "finalizer@local.invalid")
    run("git", "add", "-A")
    run("git", "commit", "-m", "baseline")

    patch_path = ROOT / ".deterministic-task" / "retired-surface.patch"
    patch_path.parent.mkdir(parents=True, exist_ok=True)
    patch_path.write_bytes(patch)
    run("git", "apply", "--index", "--binary", str(patch_path))

    for raw_path in load_delete_paths():
        path = ROOT / raw_path
        if not path.exists() and not path.is_symlink():
            raise RuntimeError(f"Expected deletion target is missing: {raw_path}")
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()

    shutil.rmtree(ROOT / ".deterministic-task", ignore_errors=True)
    (ROOT / "scripts" / "deterministic-task-patch.py").unlink(missing_ok=True)
    run("git", "add", "-A")
    run("git", "diff", "--cached", "--check")

    run("npm", "ci", timeout=1200)
    run("npm", "run", "format:check", timeout=600)
    run("npm", "run", "check", timeout=1200)
    run("npm", "run", "lint", timeout=1200)
    run("npm", "run", "test:run", timeout=2700)
    run("npm", "run", "retired-surfaces:audit", timeout=600)
    run("npm", "run", "public-tools:audit", timeout=600)
    run("npm", "run", "governance:capabilities", timeout=600)
    run("npm", "run", "mcp:smoke", timeout=600)
    run("npm", "run", "build", timeout=1200)

    export_dir = ROOT / "export"
    export_dir.mkdir(exist_ok=True)
    archive = export_dir / "finalized-source.tar.xz"
    excluded = {".git", "node_modules", "dist", "export"}
    with tarfile.open(archive, "w:xz", preset=6) as tar:
        for path in sorted(ROOT.rglob("*")):
            relative = path.relative_to(ROOT)
            if relative.parts and relative.parts[0] in excluded:
                continue
            tar.add(path, arcname=str(relative), recursive=False)
    print(f"FINALIZED_ARCHIVE={archive} SIZE={archive.stat().st_size} SHA256={sha256(archive.read_bytes())}")


if __name__ == "__main__":
    main()
