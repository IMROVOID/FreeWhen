/**
 * A minimal `@react-native-async-storage/async-storage` stand-in.
 *
 * ★ THE REAL PACKAGE IS A TURBO MODULE.
 *
 * Importing it in Node reaches for `NativeModules` and fails with
 * `Cannot read properties of undefined (reading 'EventEmitter')` before any test
 * body runs. The services under test use it as a plain key/value store, so an
 * in-memory map is the whole contract — and it is also what makes a cache test
 * able to set a value and read it back within one process.
 */

const store = new Map<string, string>();

const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => store.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    store.delete(key);
  },
  clear: async (): Promise<void> => {
    store.clear();
  },
  getAllKeys: async (): Promise<string[]> => [...store.keys()],
  multiGet: async (keys: string[]): Promise<[string, string | null][]> =>
    keys.map((key) => [key, store.get(key) ?? null]),
  multiSet: async (pairs: [string, string][]): Promise<void> => {
    for (const [key, value] of pairs) store.set(key, value);
  },
  mergeItem: async (key: string, value: string): Promise<void> => {
    const current = store.get(key);
    store.set(key, current ? JSON.stringify({ ...JSON.parse(current), ...JSON.parse(value) }) : value);
  },
};

export default AsyncStorage;
