/**
 * The proposal type choice — زمان / مکان / هر دو (Plan 06 Task 7, FR-2.2).
 *
 * A thin wrapper over the shared `SegmentedControl`, so the choice looks and
 * behaves like every other segmented control in the app (Style Guide §11.4) and
 * the label never has to be restated at a call site.
 */

import { SegmentedControl, type SegmentedOption } from '@/src/components/ui/Chip';
import { PROPOSAL_TYPES, type ProposalType } from '@/src/types/proposal';
import { useTranslation } from 'react-i18next';

export interface ProposalTypeSegmentProps {
  value: ProposalType;
  onChange: (value: ProposalType) => void;
  testID?: string;
}

export function ProposalTypeSegment({ value, onChange, testID }: ProposalTypeSegmentProps) {
  const { t } = useTranslation();

  const options: SegmentedOption[] = PROPOSAL_TYPES.map((type) => ({
    value: type,
    label: t(`proposals.type.${type}`),
  }));

  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={(next) => onChange(next as ProposalType)}
      testID={testID ?? 'proposal-type'}
    />
  );
}
