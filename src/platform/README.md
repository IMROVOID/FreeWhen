# The platform layer

One rule: **a shared file never imports a native module.**

Metro resolves `foo.web.ts` for the browser and `foo.native.ts` for iOS and
Android. That substitution is the only mechanism that removes code from a
bundle — a runtime `Platform.OS === 'web'` branch does not. The import is
evaluated at load, so a native module reached from a shared file crashes the
web bundle before any branch is ever consulted.

## The three files

A capability has up to three files:

| File | Holds | Imported by |
|---|---|---|
| `foo.ts` | The interface, and a typed fallback | `tsc` — and nothing else at runtime |
| `foo.native.ts` | The iOS / Android implementation | Metro, on native |
| `foo.web.ts` | The browser implementation | Metro, on web |

`foo.ts` exists for one reason: **`tsc` does not resolve the suffixes.** A
suffix-free module is what makes `import { foo } from './foo'` type-check.
Metro never picks it when a suffixed sibling exists, so its body is dead at
runtime — but it is still evaluated by the bundler's type pass and by any
tooling that ignores suffixes, so it must stay **pure**: no `react-native`, no
Expo, nothing but types and a fallback that throws if it is somehow reached.

## Adding a capability

1. Write `foo.ts` with the interface and a fallback that throws a message
   naming the two files Metro should have chosen instead.
2. Write `foo.native.ts`. Import the native module **here and nowhere else**.
3. Write `foo.web.ts`. If the platform genuinely lacks the capability, a no-op
   is correct — say so in a comment. A no-op is not a stub when the platform
   has nothing to offer.
4. Call sites import the bare specifier. They never branch on platform.

`eslint.config.js` enforces step 2: `@rnmapbox/maps`, `expo-haptics`,
`expo-notifications` and `expo-blur` are `no-restricted-imports` everywhere
except their own implementation files and `*.web.*`.

## Where a platform gets a different COMPONENT

Haptics and direction differ only in implementation. The map differs in
**kind**: the two platforms use different map LIBRARIES, so
`InteractiveMap.web.tsx` runs `mapbox-gl` and `InteractiveMap.native.tsx` runs
`react-native-maps`. Same props, different engine — and the two siblings are what
keep `mapbox-gl` out of the native bundle and `react-native-maps` out of the web
export. `src/components/ui/InteractiveMap.tsx` holds only types and a throwing
fallback.

The same split applies to `VenueMap` and `EventRouteMap`, whose `.web`/`.native`
siblings differ in content as well as library.

## What is deliberately absent on web

The web surface is a reviewer and viewer path, not the participant product:

- **No haptics.** Press feedback is the CSS active state on `Pressy`.
- **No notifications.** Push is a native capability.
- **No mobility data, no background location.**
- **No native basemap SDK.** Web gets MapBox through `mapbox-gl`; native gets
  MapBox raster tiles over a blank Google map shell, because
  `@rnmapbox/maps` needs a private Maven that this project's no-account APK build
  cannot use (Plan 64 D64-1).

A reader who finds an undocumented limitation discounts every other claim.
This list is the honest boundary, and `src/platform/` is where it is held.
