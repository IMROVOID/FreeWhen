/**
 * The desktop presentation frame — native implementation.
 *
 * ★ IT DOES NOT EXIST ON A PHONE, AND THIS FILE IS HOW THAT IS SAID.
 *
 * A native app already fills its own window; there is no desktop to guard
 * against and no viewport to cap. Metro resolves this file for the native bundle
 * and `AppFrame.web.tsx` for the web one, so the call site in `app/_layout.tsx`
 * needs no platform branch and the native tree keeps exactly the node structure
 * it had before the frame existed.
 */

export const TABLET_BREAKPOINT = 768;
export const FRAME_MAX_WIDTH = 520;

export interface AppFrameProps {
  children: React.ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  return <>{children}</>;
}
