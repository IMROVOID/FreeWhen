/**
 * One-tap start-point deletion (Plan 09 Task 4, FR-8.21 / AC-8.8.1).
 *
 * ★ DELETING THE LOCATION IS NOT LEAVING THE EVENT.
 *
 * The control removes the coordinate and nothing else — not the participant,
 * not their votes, not their proposals, not their RSVP. Cascading any of those
 * would punish the person for using the privacy control the product promised
 * them, and would make the button dangerous enough that nobody would press it.
 *
 * ★ NO CONFIRMATION DIALOG.
 *
 * Unlike account deletion, this is cheap to undo: adding a start point again
 * takes one tap, and the person is already on the screen that does it. A modal
 * here would add friction to exactly the action a privacy control must make
 * easy. The destructive, irreversible action (account) is the one that confirms.
 *
 * ★ THE RANKING THEN REPORTS REDUCED COVERAGE (AC-8.8.1).
 *
 * It does not silently drop the member. The honest statement is that this
 * person's travel time is no longer included — see the ranking, which reads
 * `has_start_point` rather than assuming everyone has one.
 */

import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';

export interface DeleteLocationActionProps {
  onConfirm: () => void | Promise<void>;
  /** Disables the button while the delete is in flight. */
  busy?: boolean;
  testID?: string;
}

export function DeleteLocationAction({ onConfirm, busy = false, testID }: DeleteLocationActionProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* ★ A SURFACE, LIKE EVERY OTHER CONTROL ON THE SCREEN.
          This was `variant="ghost"`, which paints no fill, so «حذف مکان من» was
          bare text among painted pills. It stays the quiet variant rather than
          the danger one: this action is cheap to undo (adding a start point
          again is one tap on this same screen), and painting it red would stop
          people using the privacy control it exists to offer. */}
      <Button
        label={t('privacy.deleteLocation')}
        variant="secondary"
        size="medium"
        loading={busy}
        onPress={() => {
          void onConfirm();
        }}
        testID={testID}
        accessibilityLabel={t('privacy.deleteLocationA11y')}
      />
      {/* Stated BEFORE the tap, so the person knows what survives. */}
      <Text variant="caption" color="textFaint" style={styles.hint}>
        {t('privacy.deleteLocationHint')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  hint: { marginTop: space[2] },
});
