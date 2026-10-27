/**
 * The first-launch nickname gate (Plan 49 T8).
 *
 * ★ IT IS A GATE, NOT A PROMPT.
 *
 * The request is explicit: the overlay "shouldn't be able to skip or Close … or use
 * the App until choosing a Nickname". So this mounts above the router in
 * `app/_layout.tsx` and the sheet is `dismissible={false}` — no scrim press, no
 * Escape, no back gesture. There is no route that can be reached around it, which
 * is why it lives in the layout rather than on a screen.
 *
 * ★ AND IT STILL CANNOT LOCK ANYONE OUT.
 *
 * A gate with no exit is a lockout the moment its save request fails: offline, a
 * cold function, a validation refusal. So a refused save is not a wall — the
 * nickname is cached locally and the gate opens, because being unable to reach the
 * server must never mean being unable to use the app. The next successful load
 * reconciles the server copy, which stays the source of truth.
 *
 * ★ IT RENDERS NOTHING UNTIL IT KNOWS.
 *
 * `null` while loading, so a person who already has a nickname never sees the gate
 * flash on launch. `app/_layout.tsx` already waits for fonts, so there is no
 * blank-frame problem in waiting for one cached read.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { nicknameErrorKey, NicknameField } from '@/src/features/profile/components/NicknameField';
import {
  loadNickname,
  saveNickname,
  saveNicknameOptimistically,
} from '@/src/features/profile/services/profile';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface NicknameGateProps {
  /** Called once a nickname exists, so the layout can stop rendering the gate. */
  onResolved: (nickname: string) => void;
  /**
   * Stands the gate down while another screen is already asking for a name.
   *
   * ★ THE INVITE SCREEN ASKS THE SAME QUESTION.
   *
   * `prefs.nickname-gate` used to mount over every route, including `/e/[token]`,
   * where `JoinForm` has its own "اسم شما" field. A guest arriving from an invite
   * link therefore saw TWO name prompts stacked — the join form and the sheet on
   * top of it — and the sheet's save failed with a 403 (no identity had been
   * minted yet, which only happens on join), leaving the guest stuck behind a gate
   * they could not complete.
   *
   * The invite screen's name is the better answer anyway: it is the name they are
   * joining WITH, and `joinViaInvite` already stores it. When that succeeds the
   * route calls `adoptNickname` so the rest of the app has an identity.
   */
  suspended?: boolean;
  /** Injected by the tests; the app omits it and the service is used. */
  loadNicknameImpl?: typeof loadNickname;
  saveNicknameImpl?: typeof saveNickname;
  saveOptimisticallyImpl?: typeof saveNicknameOptimistically;
}

export function NicknameGate({
  onResolved,
  suspended = false,
  loadNicknameImpl = loadNickname,
  saveNicknameImpl = saveNickname,
  saveOptimisticallyImpl = saveNicknameOptimistically,
}: NicknameGateProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [checking, setChecking] = useState(true);
  const [value, setValue] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    void loadNicknameImpl().then((existing) => {
      if (!active) return;

      if (existing) {
        onResolved(existing);
        return;
      }
      setChecking(false);
    });

    return () => {
      active = false;
    };
  }, [loadNicknameImpl, onResolved]);

  const submit = useCallback(async () => {
    const key = nicknameErrorKey(value);
    if (key) {
      setErrorKey(key);
      return;
    }

    const trimmed = value.trim();
    setSaving(true);
    setErrorKey(null);

    try {
      const stored = await saveNicknameImpl(trimmed);
      onResolved(stored);
    } catch {
      // ★ A REFUSED SAVE IS NOT A LOCKOUT.
      //
      // The person answered the question; the network did not carry it. Cache the
      // answer so the app opens, and let the next successful load reconcile.
      await saveOptimisticallyImpl(trimmed);
      onResolved(trimmed);
    } finally {
      setSaving(false);
    }
  }, [value, saveNicknameImpl, saveOptimisticallyImpl, onResolved]);

  if (suspended || checking) return null;

  return (
    <BottomSheet
      visible
      dismissible={false}
      onDismiss={() => {
        // Unreachable while `dismissible` is false; present because the prop is a
        // function and an empty one would be a silent trap if that ever changes.
      }}
      testID="nickname-gate"
    >
      <View style={styles.content}>
        <Text variant="h2">{t('profile.gateTitle')}</Text>
        <Text variant="body" color={theme.textMuted}>
          {t('profile.gateBody')}
        </Text>

        <NicknameField
          value={value}
          onChangeText={(next) => {
            setValue(next);
            setErrorKey(null);
          }}
          error={errorKey ? t(errorKey) : null}
          testID="nickname-gate-field"
        />

        <Button
          label={t('profile.gateAction')}
          onPress={() => void submit()}
          loading={saving}
          disabled={saving}
          testID="nickname-gate-submit"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[4],
  },
});
