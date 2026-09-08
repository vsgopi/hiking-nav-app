import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV({ id: 'hiking-nav-preferences' });

export const keyValueStore = {
  getBoolean(key: string): boolean {
    return storage.getBoolean(key) ?? false;
  },
  setBoolean(key: string, value: boolean): void {
    storage.set(key, value);
  },
  getString(key: string): string | undefined {
    return storage.getString(key);
  },
  setString(key: string, value: string): void {
    storage.set(key, value);
  },
  delete(key: string): void {
    storage.remove(key);
  },
};
