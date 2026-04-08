/**
 * useAppHooks — Re-exports useful Mantine hooks for cross-platform use.
 *
 * All hooks here come from @mantine/hooks which is a zero-dependency
 * utility library. Most hooks are pure JS and work on any platform.
 * Web-only hooks (useHotkeys, useClipboard, etc.) are re-exported
 * as-is — consumers should guard with Platform.OS checks when needed.
 */
import { Platform } from 'react-native';

// Re-export Mantine hooks that work cross-platform
export { useDebouncedValue, useToggle, useCounter, useInterval, useTimeout, usePrevious } from '@mantine/hooks';

// Web-only hooks — re-export with Platform guard wrappers
export { useHotkeys, useClipboard, useLocalStorage, useIdle, useNetwork } from '@mantine/hooks';
