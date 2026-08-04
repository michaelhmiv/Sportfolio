from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

privacy_path = ROOT / "client/src/pages/privacy.tsx"
privacy = privacy_path.read_text()
old_privacy = "Certain credential, token, SMS-link, or provider-key management workflows may accept sensitive input only when you specifically initiate that account-security feature; you should never paste those values into ordinary conversation unless the approved connection interface explicitly requires them."
new_privacy = "Certain credential, token, or provider-key management workflows may accept sensitive input only when you specifically initiate that account-security feature; you should never paste those values into ordinary conversation unless the approved connection interface explicitly requires them."
if privacy.count(old_privacy) != 1:
    raise SystemExit("Expected retired SMS-link privacy wording was not found exactly once")
privacy_path.write_text(privacy.replace(old_privacy, new_privacy))

fixture_path = ROOT / "client/src/visual-fixtures/special-surfaces.tsx"
fixture = fixture_path.read_text()
old_fixture = "Hermes, premium, Scout, collections, alerts, and ceremonies retain distinct semantic\n              roles in both themes."
new_fixture = "Premium, Scout, collections, alerts, and ceremonies retain distinct semantic roles in\n              both themes."
if fixture.count(old_fixture) != 1:
    raise SystemExit("Expected retired Hermes visual-fixture wording was not found exactly once")
fixture_path.write_text(fixture.replace(old_fixture, new_fixture))
