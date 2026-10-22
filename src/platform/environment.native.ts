import { Platform } from 'react-native';

import type { RuntimePlatform } from './environment';

/** iOS and Android are both `'native'`: the distinction is not a funnel dimension. */
export function runtimePlatform(): RuntimePlatform {
  return Platform.OS === 'web' ? 'web' : 'native';
}
