/**
 * Captures a PNG of a real Chrome page over CDP, at a chosen viewport.
 *
 * Not a test — the visual counterpart to `cdp-eval.ts`, used to check an
 * exported web build. `Page.captureScreenshot` needs the same page target, so
 * the connection code is duplicated rather than shared: this is a throwaway
 * verification tool, not a library.
 *
 *   npx tsx scripts/verify/cdp-shot.ts <url> <out.png> [width] [height] [fullPage]
 */

import { writeFileSync } from 'node:fs';

const [, , url, outArg, widthArg, heightArg, fullArg] = process.argv;

if (!url || !outArg) {
  console.error('usage: cdp-shot.ts <url> <out.png> [width] [height] [fullPage]');
  process.exit(2);
}

const width = Number(widthArg ?? 430);
const height = Number(heightArg ?? 932);
const fullPage = fullArg === 'full';
const out: string = outArg;

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

  const shot = (await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  })) as { data: string };

  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${out}`);
  socket.close();
}

void main();
