from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
previous = subprocess.check_output(
    ["git", "show", "HEAD^:scripts/deterministic-task-patch.py"],
    cwd=ROOT,
    text=True,
)
previous = previous.replace(
    '  const resend = new Resend(config.RESEND_API_KEY);\n  app.post(RESEND_WEBHOOK_PATH, async (req, res) => {',
    '  const webhookSecret = config.RESEND_WEBHOOK_SECRET;\n  const resend = new Resend(config.RESEND_API_KEY);\n  app.post(RESEND_WEBHOOK_PATH, async (req, res) => {',
)
previous = previous.replace(
    '        webhookSecret: config.RESEND_WEBHOOK_SECRET,',
    '        webhookSecret,',
)
exec(compile(previous, "scripts/deterministic-task-patch.py", "exec"))
