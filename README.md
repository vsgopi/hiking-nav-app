# Hiking Nav App

Offline-first hiking navigation app (mobile), with a backend planned for a later phase.

## Project structure

```
apps/mobile/   Expo/React Native mobile app (source of truth for the app)
android/       Generated native Android project (Expo prebuild output)
```

## Prerequisites

- Node.js 20+
- npm
- For Android builds: Android Studio with an SDK/emulator set up, or a physical device with USB debugging enabled
- For iOS builds (macOS only): Xcode

This app uses native modules (`@maplibre/maplibre-react-native`, `react-native-mmkv`) via `expo-dev-client`, so it **cannot run in the plain Expo Go app** — you need a custom dev client build first.

## Setup

Install dependencies from the repo root (npm workspaces):

```bash
npm install
```

## Running the app

### Android

Build and install the dev client, then start Metro:

```bash
cd apps/mobile
npm run android
```

This builds the app using the checked-in `android/` project and installs it on a connected device/emulator. On future runs, once the dev client is installed, you can just run:

```bash
npm start
```

and open the app already on the device.

### iOS (macOS only)

```bash
cd apps/mobile
npm run ios
```

### Web

```bash
cd apps/mobile
npm run web
```

## Other useful commands

Run from `apps/mobile/`:

```bash
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm test            # Jest test suite
```
