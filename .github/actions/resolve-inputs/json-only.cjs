/**
 * Reads the parser's stdout and prints only the JSON object.
 *
 * Deliberately a file rather than a `node -e` one-liner inside the composite
 * action: the one-liner needed nested quoting (`"` inside `'` inside `$( )`
 * inside a multi-line command substitution) and could not survive a shell
 * that re-quotes it. A file has no quoting at all.
 */
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
});
process.stdin.on('end', () => {
  const end = buffer.lastIndexOf('}');
  process.stdout.write(end < 0 ? '{"warnings":[]}' : buffer.slice(0, end + 1));
});
