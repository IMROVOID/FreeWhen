import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import type { RenderedScreen } from './support/render';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

describe('JoinEventCard component', () => {
  test('renders heading and submit button in Persian', async () => {
    const { JoinEventCard } = await import('@/src/features/events/components/JoinEventCard');

    const screen: RenderedScreen = renderComponent(JoinEventCard, {
      onJoin: () => {},
    });

    assert.ok(screen.has('پیوستن با کد یا لینک'), 'heading is displayed');
    assert.ok(screen.has('پیوستن'), 'button is displayed');
  });

  test('renders properly with English locale', async () => {
    initI18n('en');
    const { JoinEventCard } = await import('@/src/features/events/components/JoinEventCard');

    const screen: RenderedScreen = renderComponent(JoinEventCard, {
      onJoin: () => {},
    });

    assert.ok(screen.has('Join with Code or Link'), 'English heading is displayed');
    assert.ok(screen.has('Join'), 'English submit button is displayed');
  });
});

describe('InviteShareCard component', () => {
  test('displays code above URL, share button, and regenerate button without revoke button', async () => {
    initI18n('fa');
    const { InviteShareCard } = await import('@/src/features/events/components/InviteShareCard');

    const screen: RenderedScreen = renderComponent(InviteShareCard, {
      url: 'https://freewhen.app/e/TEST_CODE_123456789012',
      code: 'TEST_CODE_123456789012',
      expiresLabel: 'تا فردا معتبر است',
      canRotate: true,
      onRotate: () => {},
    });

    assert.ok(screen.has('TEST_CODE_123456789012'), 'venue code is displayed');
    assert.ok(screen.has('https://freewhen.app/e/TEST_CODE_123456789012'), 'url is displayed');
    assert.ok(screen.has('اشتراک‌گذاری'), 'share button is displayed');
    assert.ok(screen.has('ساخت لینک تازه'), 'regenerate button is displayed');
    assert.ok(!screen.has('لغو لینک'), 'disable link button is removed');
    assert.ok(!screen.has('رونوشت لینک'), 'separate copy button is removed');
  });
});
