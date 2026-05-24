module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@shopify/flash-list|nativewind|react-native-css-interop|zustand|react-native-mmkv|react-native-reanimated|react-native-gesture-handler|react-native-screens|react-native-safe-area-context)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/__tests__/helpers/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFiles: [],
};
