from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "client/src/App.tsx"
source = path.read_text(encoding="utf-8")
source = source.replace('import AuthCallback from "@/pages/AuthCallback";\n', '')
source = source.replace('        <Route path="/auth/callback" component={AuthCallback} />\n', '')
path.write_text(source, encoding="utf-8")
