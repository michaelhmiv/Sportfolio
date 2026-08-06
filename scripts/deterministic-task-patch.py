from __future__ import annotations

import hashlib
import lzma
import shutil
import subprocess
import urllib.request
from pathlib import Path

PINNED_CONTRACT_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "f515744420c151597a548d85e6deed41abe8b58d/"
    "scripts/deterministic-task-patch.py"
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(url: str, *, user_agent: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def load_pinned_contract() -> dict[str, object]:
    source = download(PINNED_CONTRACT_URL, user_agent="Sportfolio finalizer/1.0").decode(
        "utf-8"
    )
    namespace: dict[str, object] = {"__name__": "pinned_contract"}
    exec(compile(source, "<pinned-contract>", "exec"), namespace)
    return namespace


def main() -> None:
    contract = load_pinned_contract()
    patch_url = str(contract["PATCH_URL"])
    expected_xz_sha = str(contract["PATCH_XZ_SHA256"])
    expected_patch_sha = str(contract["PATCH_SHA256"])
    expected_xz_size = int(contract["PATCH_XZ_SIZE"])
    delete_paths = [str(path) for path in contract["DELETE_PATHS"]]

    downloaded = download(patch_url, user_agent="Sportfolio finalizer/1.0")
    if len(downloaded) < expected_xz_size:
        raise RuntimeError(
            f"Compressed patch is truncated: {len(downloaded)} < {expected_xz_size}"
        )

    compressed = downloaded[:expected_xz_size]
    if sha256(compressed) != expected_xz_sha:
        raise RuntimeError("Compressed patch checksum mismatch")

    patch = lzma.decompress(compressed)
    if sha256(patch) != expected_patch_sha:
        raise RuntimeError("Patch checksum mismatch")

    patch_path = Path(".deterministic-task/retired-surface.patch")
    patch_path.parent.mkdir(parents=True, exist_ok=True)
    patch_path.write_bytes(patch)

    subprocess.run(
        ["git", "apply", "--no-index", "--binary", str(patch_path)],
        check=True,
    )

    for raw_path in delete_paths:
        path = Path(raw_path)
        if not path.exists() and not path.is_symlink():
            raise RuntimeError(f"Expected deletion target is missing: {raw_path}")
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()

    print(
        f"Applied verified patch {expected_patch_sha} and removed "
        f"{len(delete_paths)} retired paths."
    )


if __name__ == "__main__":
    main()
