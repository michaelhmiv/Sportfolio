#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "server/storage.ts"
text = path.read_text()
old = '''  async getAvailableShares(userId: string, assetType: string, assetId: string): Promise<number> {
    if (assetType === "player") {
      const [regularAvailable, multiplier] = await Promise.all([
        this.getRegularAvailableShares(userId, assetId),
        this.getPlayerMultiplier(userId, assetId),
      ]);

      return regularAvailable + (multiplier ? 1 : 0);
    }
'''
new = '''  async getAvailableShares(userId: string, assetType: string, assetId: string): Promise<number> {
    if (assetType === "player") {
      return this.getRegularAvailableShares(userId, assetId);
    }
'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError("Could not locate legacy getAvailableShares multiplier branch")

# The preceding storage codemod deliberately fails if multiplier references survive. This finalize pass
# runs before that assertion on subsequent executions, so all active storage must be free of Stack types.
path.write_text(text)
print("Economy V2 share availability finalized")
