from __future__ import annotations

import hashlib
import lzma
import shutil
import subprocess
import urllib.request
from pathlib import Path

PATCH_URL = "https://drive.usercontent.google.com/download?id=1_vEaRjZWLzKgEYW-NQKGtRR7Iioju0ll&export=download&confirm=t"
PATCH_XZ_SHA256 = "ca346b858d9001b2621ef02e6737858a428190e87027e6f35860501f200defce"
PATCH_SHA256 = "f5b70e4b6244f6885d6486ab39b52b0a58ae49dc3bb83354aa72c2e410c358e9"
PATCH_XZ_SIZE = 237968

DELETE_PATHS = ['.agent-dev.log', '.agent/rules.md', '.agent/workflows/best-practices.md', '.agent/workflows/local-dev-database.md', '.hermes/plans/2026-07-17_124008-supabase-to-railway-postgres-cutover.md', 'AGENT_GUIDE.md', 'docs/agent-readiness-improvements.md', 'docs/agent/CONTEXT_BUDGET.md', 'docs/agent/CONTEXT_INDEX.md', 'docs/agent/REFACTOR_QUEUE.md', 'docs/agent/REPO_MAP.md', 'docs/implementation/unified-sports-release-a-cleanup.md', 'docs/implementation/unified-sports-release-a.md', 'docs/plugin/release-a-runtime-cleanup.md', 'docs/refactor/JULY_2026_AUDIT.md', 'docs/ui/pr4-special.md', 'docs/wiki/agent/android-notification-audit-2026-05-28.md', 'docs/wiki/agent/api-map.md', 'docs/wiki/agent/binary-files-root-cause.md', 'docs/wiki/agent/current-surface.md', 'docs/wiki/agent/data-model-economy.md', 'docs/wiki/agent/hermes-product-contract.md', 'docs/wiki/agent/mcp-tool-reference.md', 'docs/wiki/agent/product-mechanics.md', 'docs/wiki/agent/runbooks.md', 'docs/wiki/agent/runtime-model.md', 'docs/wiki/agent/strategies.md', 'docs/wiki/agent/task-definitions.md', 'docs/wiki/changelog/2026-05-12-interface-contract-refresh.md', 'docs/wiki/features/agent-operator.md', 'docs/wiki/features/sms-agent.md', 'docs/wiki/internal/agent-skills.md', 'docs/wiki/internal/telnyx-sms-setup.md', 'scripts/agent-audit.ts', 'scripts/agent-debug-loop.mjs', 'scripts/agent-readiness-smoke.mjs', 'scripts/agent-self-improve.mjs', 'scripts/agent-smoke.ts', 'scripts/check-agent-invariants.mjs', 'scripts/check-agent-invariants.test.ts', 'scripts/dev-orchestrator.mjs', 'scripts/public-surface-dev-validate.ts', 'server/agent/agent-model.ts', 'server/agent/clarification.test.ts', 'server/agent/clarification.ts', 'server/agent/context-compressor.ts', 'server/agent/context-loader.ts', 'server/agent/continuity-state.ts', 'server/agent/conversation-prompts.test.ts', 'server/agent/conversation-prompts.ts', 'server/agent/data-sources.test.ts', 'server/agent/data-sources.ts', 'server/agent/executor.test.ts', 'server/agent/executor.ts', 'server/agent/hermes-client.test.ts', 'server/agent/hermes-client.ts', 'server/agent/hermes-local.ts', 'server/agent/hermes-orchestrator.test.ts', 'server/agent/hermes-orchestrator.ts', 'server/agent/hermes-tool-registry.ts', 'server/agent/hermes-tools.test.ts', 'server/agent/hermes-tools.ts', 'server/agent/improvement.test.ts', 'server/agent/improvement.ts', 'server/agent/intent-router.test.ts', 'server/agent/intent-router.ts', 'server/agent/internal-auth.ts', 'server/agent/internal-mlb-mcp.test.ts', 'server/agent/internal-mlb-mcp.ts', 'server/agent/mcp-client.ts', 'server/agent/mcp-sources.test.ts', 'server/agent/mcp-sources.ts', 'server/agent/memory.test.ts', 'server/agent/memory.ts', 'server/agent/model-catalog.test.ts', 'server/agent/model-catalog.ts', 'server/agent/model-first-router.test.ts', 'server/agent/model-first-router.ts', 'server/agent/operations-planner.test.ts', 'server/agent/operations-planner.ts', 'server/agent/output-schema.test.ts', 'server/agent/output-schema.ts', 'server/agent/pi-provider.test.ts', 'server/agent/pi-provider.ts', 'server/agent/policy-engine.ts', 'server/agent/profile-defaults.test.ts', 'server/agent/profile-defaults.ts', 'server/agent/provider-registry.test.ts', 'server/agent/provider-registry.ts', 'server/agent/research.test.ts', 'server/agent/research.ts', 'server/agent/runtime-adapter.internal-mcp.test.ts', 'server/agent/runtime-adapter.test.ts', 'server/agent/runtime-adapter.ts', 'server/agent/runtime-engine.test.ts', 'server/agent/runtime-engine.ts', 'server/agent/runtime-session-logger.ts', 'server/agent/scenario-matrix.test.ts', 'server/agent/schedules.test.ts', 'server/agent/schedules.ts', 'server/agent/scout-agent-core.smoke.test.ts', 'server/agent/scout-agent-core.test.ts', 'server/agent/scout-agent-core.ts', 'server/agent/semantic-router.test.ts', 'server/agent/semantic-router.ts', 'server/agent/service.test.ts', 'server/agent/service.ts', 'server/agent/skills.test.ts', 'server/agent/skills.ts', 'server/agent/sms-renderer.test.ts', 'server/agent/sms-renderer.ts', 'server/agent/strategies.test.ts', 'server/agent/strategies.ts', 'server/agent/strategy-policy.test.ts', 'server/agent/strategy-policy.ts', 'server/agent/strategy-runner.test.ts', 'server/agent/strategy-runner.ts', 'server/agent/strategy-timeline.test.ts', 'server/agent/strategy-timeline.ts', 'server/agent/system-settings.ts', 'server/agent/thread-runtime.test.ts', 'server/agent/thread-runtime.ts', 'server/agent/thread-service.ts', 'server/agent/turn-events.ts', 'server/agent/types.ts', 'server/agent/ui-blocks.test.ts', 'server/agent/ui-blocks.ts', 'server/agent/workflow-bundle.test.ts', 'server/agent/workflow-bundle.ts', 'server/bot/runtime.test.ts', 'server/bot/runtime.ts', 'server/hermes-sidecar.test.ts', 'server/hermes-sidecar.ts', 'server/jobs/retired-capabilities.contract.test.ts', 'server/lib/encryption.ts', 'server/mcp/gameplay-capability-matrix.ts', 'server/routes/internal-agent-tools.ts', 'server/routes/sms.ts', 'server/service-role.ts', 'server/services/telnyx-sms.test.ts', 'server/services/telnyx-sms.ts', 'server/sms-service.ts', 'shared/agent-strategy.ts', 'shared/agent-ui.ts', 'tests/e2e/agent-shell.spec.ts', 'tests/fixtures/agent/sandbox-thread.ts']


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    request = urllib.request.Request(PATCH_URL, headers={"User-Agent": "Sportfolio deterministic patch/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        compressed = response.read(PATCH_XZ_SIZE + 1)
    if len(compressed) != PATCH_XZ_SIZE:
        raise RuntimeError(f"Unexpected compressed patch size: {len(compressed)}")
    if sha256(compressed) != PATCH_XZ_SHA256:
        raise RuntimeError("Compressed patch checksum mismatch")

    patch = lzma.decompress(compressed)
    if sha256(patch) != PATCH_SHA256:
        raise RuntimeError("Patch checksum mismatch")

    patch_path = Path('.deterministic-task/retired-surface.patch')
    patch_path.write_bytes(patch)
    subprocess.run(['git', 'apply', '--index', '--binary', str(patch_path)], check=True)

    for raw_path in DELETE_PATHS:
        path = Path(raw_path)
        if not path.exists() and not path.is_symlink():
            raise RuntimeError(f"Expected deletion target is missing: {raw_path}")
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()

    subprocess.run(['git', 'diff', '--cached', '--check'], check=True)


if __name__ == '__main__':
    main()
