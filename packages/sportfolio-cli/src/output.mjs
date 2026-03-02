export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printList(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}
