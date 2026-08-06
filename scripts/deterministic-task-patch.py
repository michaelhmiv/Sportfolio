from __future__ import annotations

import hashlib
import lzma
import shutil
import subprocess
import urllib.request
from pathlib import Path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_pinned_contract() -> dict[str, object]:
    source = subprocess.check_output(
        ["git", "show", "HEAD^:scripts/deterministic-task-patch.py"],
        text=True,
    )
    namespace: dict[str, object] = {"__name__": "deterministic_task_contract"}
    exec(compile(source, "<pinned-deterministic-task-contract>", "exec"), namespace)
    return namespace


def main() -> None:
    contract = load_pinned_contract()
    patch_url = str(contract["PATCH_URL"])
    expected_xz_sha = str(contract["PATCH_XZ_SHA256"])
    expected_patch_sha = str(contract["PATCH_SHA256"])
    expected_xz_size = int(contract["PATCH_XZ_SIZE"])
    delete_paths = list(contract["DELETE_PATHS"])

    request = urllib.request.Request(
        patch_url,
        headers={"User-Agent": "Sportfolio deterministic patch/1.1"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        downloaded = response.read()

    if len(downloaded) < expected_xz_size:
        raise RuntimeError(
            f"Compressed patch is truncated: {len(downloaded)} < {expected_xz_size}"
        )

    compressed = downloaded[:expected_xz_size]
    if sha256(compressed) != expected_xz_sha:
        raise RuntimeError(
            "Compressed patch checksum mismatch for the checksum-pinned byte range"
        )

    if len(downloaded) > expected_xz_size:
        print(
            f"Validated the pinned {expected_xz_size}-byte payload; "
            f"ignored {len(downloaded) - expected_xz_size} trailing transport bytes."
        )

    patch = lzma.decompress(compressed)
    if sha256(patch) != expected_patch_sha:
        raise RuntimeError("Patch checksum mismatch")

    patch_path = Path(".deterministic-task/retired-surface.patch")
    patch_path.write_bytes(patch)
    subprocess.run(
        ["git", "apply", "--index", "--binary", str(patch_path)],
        check=True,
    )

    for raw_path in delete_paths:
        path = Path(str(raw_path))
        if not path.exists() and not path.is_symlink():
            raise RuntimeError(f"Expected deletion target is missing: {raw_path}")
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()

    subprocess.run(["git", "diff", "--cached", "--check"], check=True)


if __name__ == "__main__":
    main()
