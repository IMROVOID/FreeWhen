/**
 * The Settings row that shows and edits the global nickname (Plan 49 T8).
 *
 * ★ IT READS THE VALUE THE SAME WAY THE GATE DOES.
 *
 * `loadNickname` is cached-then-remote, so this row shows the last known name
 * instantly and corrects itself when the server answers. A separate read path
 * here would be a second definition of "what is my nickname".
 *
 * The row follows `MuteToggle`'s shape — a label and a hint on the leading side,
 * the control on the trailing side — because it sits in the same column of the
 * same screen and a different shape would read as a different kind of setting.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { nicknameErrorKey, NicknameField } from '@/src/features/profile/components/NicknameField';
import { colorForNickname } from '@/src/features/profile/services/nickname-color';
import { loadNickname, saveNickname } from '@/src/features/profile/services/profile';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface NicknameRowProps {
  testID?: string;
}

export function NicknameRow({ testID = 'nickname-row' }: NicknameRowProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [nickname, setNickname] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    void loadNickname().then((value) => {
      if (active) setNickname(value);
    });

    return () => {
      active = false;
    };
  }, []);

  const open = useCallback(() => {
    setDraft(nickname ?? '');
    setErrorKey(null);
    setEditing(true);
  }, [nickname]);

  const save = useCallback(async () => {
    const key = nicknameErrorKey(draft);
    if (key) {
      setErrorKey(key);
      return;
    }

    setSaving(true);
    setErrorKey(null);

    try {
      const stored = await saveNickname(draft);
      setNickname(stored);
      setEditing(false);
    } catch {
      // A failed write keeps the sheet open with the typed value, so the person
      // can retry rather than believing the change was saved.
      setErrorKey('errors.unknown');
    } finally {
      setSaving(false);
    }
  }, [draft]);

  return (
    <>
      <Pressy
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t('profile.changeNickname')}
        testID={testID}
        style={styles.row}
      >
        <View style={styles.labels}>
          <Text variant="body" weight={600} color={nickname ? colorForNickname(nickname) : theme.text}>
            {nickname ?? t('profile.nicknameLabel')}
          </Text>
          <Text variant="caption" color={theme.textMuted}>
            {t('profile.changeNicknameHint')}
          </Text>
        </View>

        <Text variant="caption" color={theme.brand}>
          {t('profile.changeNickname')}
        </Text>
      </Pressy>

      <BottomSheet visible={editing} onDismiss={() => setEditing(false)} testID="nickname-sheet">
        <View style={styles.sheet}>
          <Text variant="h2">{t('profile.changeNickname')}</Text>

          <NicknameField
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              setErrorKey(null);
            }}
            error={errorKey ? t(errorKey) : null}
            testID="nickname-sheet-field"
          />

          <Button
            label={t('profile.save')}
            onPress={() => void save()}
            loading={saving}
            disabled={saving}
            testID="nickname-sheet-save"
          />
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
    justifyContent: 'space-between',
  },
  labels: {
    flexShrink: 1,
    gap: space[1],
  },
  sheet: {
    gap: space[4],
  },
});
