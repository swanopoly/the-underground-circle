export const Platform = {
  OS: 'web',
  select: (obj) => (obj ? (obj.web !== undefined ? obj.web : obj.default) : undefined),
};

export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove() {} }),
};

export const Dimensions = {
  get: () => ({ width: 1280, height: 800, scale: 2, fontScale: 1 }),
};

export const NativeModules = {};
export const StyleSheet = {
  create: (styles) => styles,
  flatten: (styles) => styles,
};

const asyncStorageStub = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
  multiGet: async () => [],
  multiSet: async () => {},
  multiRemove: async () => {},
  getAllKeys: async () => [],
};

export default asyncStorageStub;
