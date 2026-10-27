/**
 * Clicks a control on a real page and captures the result, in one session.
 *
 * Not a test. A separate navigate-then-click would lose the interaction, so
 * this does both over the same CDP connection:
 *
 *   npx tsx scripts/verify/cdp-click-shot.ts <url> <selector-file> <out.png> [w] [h]
 *
 * The selector file contains a JS expression returning the element to click.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , url, selectorFile, outArg, widthArg, heightArg] = process.argv;

if (!url || !selectorFile || !outArg) {
  console.error('usage: cdp-click-shot.ts <url> <selector-file> <out.png> [w] [h]');
  process.exit(2);
}

const out: string = outArg;
const width = Number(widthArg ?? 430);
const height = Number(heightArg ?? 932);
const selector = readFileSync(selectorFile, 'utf8');

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
  await send('Page.navigate', { url });
  await new Promise((resolve) => setTimeout(resolve, 9000));

  const clicked = (await send('Runtime.evaluate', {
    expression: selector,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };

  if (clicked.exceptionDetails) {
    console.error('page error:', clicked.exceptionDetails.text);
    process.exit(1);
  }

  console.log('click:', JSON.stringify(clicked.result?.value));

  // A sheet animates in; capture once it has settled.
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${out}`);
  socket.close();
}

void main();
