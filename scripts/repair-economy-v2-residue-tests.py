#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
path = root / "server/market-mobile-overview.test.ts"
text = path.read_text()
text = text.replace(
'''  overrides: Partial<HoldingWithPlayerSummary> &
    Pick<HoldingWithPlayerSummary, "id" | "userId" | "isStackedShare">,
''',
'''  overrides: Partial<HoldingWithPlayerSummary> &
    Pick<HoldingWithPlayerSummary, "id" | "userId">,
''')
# If the residue pass already deleted the Pick line, restore a valid signature.
text = text.replace(
'''  overrides: Partial<HoldingWithPlayerSummary> &
): HoldingWithPlayerSummary {''',
'''  overrides: Partial<HoldingWithPlayerSummary> &
    Pick<HoldingWithPlayerSummary, "id" | "userId">,
): HoldingWithPlayerSummary {''')
text = re.sub(r'^\s*multiplier: overrides\.multiplier.*\n', '', text, flags=re.MULTILINE)
text = re.sub(r'^\s*isStackedShare: overrides\.isStackedShare.*\n', '', text, flags=re.MULTILINE)
path.write_text(text)
print("Economy V2 market test fixture repaired")
