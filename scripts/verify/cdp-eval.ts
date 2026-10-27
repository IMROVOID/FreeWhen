/**
 * Evaluates a JavaScript expression in a real Chrome page over CDP.
 *
 * Not a test — a measurement tool for verifying an exported web build, since
 * node --test cannot open a browser. Usage:
 *
 *   npx tsx scripts/verify/cdp-eval.ts <url> <file-with-expression> [width] [height]
 *
 * The expression runs after the page has loaded and settled, and its JSON
 * result is printed. Written as a REST/WebSocket client rather than pulling in
 * puppeteer, which is not a dependency of this project.
 */

import { readFileSync } from 'node:fs';

const [, , url, expressionFile, widthArg, heightArg] = process.argv;

if (!url || !expressionFile) {
  console.error('usage: cdp-eval.ts <url> <expression-file> [width] [height]');
  process.exit(2);
}

const width = Number(widthArg ?? 430);
const height = Number(heightArg ?? 932);
const expression = readFileSync(expressionFile, 'utf8');

interface Target {
  webSocketDebuggerUrl: string;
}

async function main(): Promise<void> {
  const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as Target[];
  const page = targets.find((target) => target.webSocketDebuggerUrl);

  if (!page) {
    console.error('no debuggable target');
    process.exit(1);
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<number, (value: unknown) => void>();

  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (message.id !== undefined) {
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    }
  });

  await new Promise((resolve) => socket.addEventListener('open', resolve));

  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });

  // The app hydrates, loads fonts, then paints. Wait for network idle plus a
  // settle window rather than the load event, which fires before hydration.
  await new Promise((resolve) => setTimeout(resolve, 9000));

  const evaluated = (await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };

  if (evaluated.exceptionDetails) {
    console.error('page error:', evaluated.exceptionDetails.text);
    process.exit(1);
  }

  console.log(JSON.stringify(evaluated.result?.value, null, 2));
  socket.close();
}

void main();
