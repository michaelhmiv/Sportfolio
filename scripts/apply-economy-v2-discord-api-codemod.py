#!/usr/bin/env python3
from pathlib import Path
import re

path = Path(__file__).resolve().parents[1] / "server/discord-api.ts"
text = path.read_text()

# Portfolio has one player ownership view now: Singles. Remove the retired stacked/regular selector.
text = re.sub(
    r'''\n        \{\n          type: 3,\n          name: "view",\n          description: "Holding type view",\n          required: false,\n          choices: \[[\s\S]*?\n          \],\n        \},''',
    "",
    text,
    count=1,
)

# Remove /stack entirely.
text = re.sub(
    r'''\n    \{\n      name: "stack",\n      description: "Stack \(condense\) shares using existing stack rules",[\s\S]*?\n    \},(?=\n    \{\n      name: "market")''',
    "",
    text,
    count=1,
)

# Direct-share Boost slot choices and explicit quantity.
text = text.replace(
    '''              choices: [\n                { name: "2x", value: 2 },\n                { name: "3x", value: 3 },\n                { name: "4x", value: 4 },\n                { name: "5x", value: 5 },\n              ],''',
    '''              choices: [\n                { name: "2x", value: 2 },\n                { name: "3x", value: 3 },\n                { name: "5x", value: 5 },\n                { name: "7x", value: 7 },\n                { name: "10x", value: 10 },\n              ],''',
)
needle = '''            {\n              type: 3,\n              name: "date",\n              description: "Date in YYYY-MM-DD (ET)",\n              required: false,\n            },'''
quantity = '''            {\n              type: 10,\n              name: "shares",\n              description: "Singles to permanently burn when the game begins",\n              required: true,\n              min_value: 0.0001,\n            },\n'''
# Add only to boost.assign, identified after its marker.
assign_idx = text.find('name: "assign",\n          description: "Assign a boost slot"')
if assign_idx >= 0:
    date_idx = text.find(needle, assign_idx)
    if date_idx >= 0 and quantity.strip() not in text[assign_idx:date_idx + len(needle)]:
        text = text[:date_idx] + quantity + text[date_idx:]

path.write_text(text)
print("Discord Economy V2 command cleanup applied")
