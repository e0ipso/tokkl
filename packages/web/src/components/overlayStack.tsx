import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createOverlayStack, type OverlayStack } from './overlayLayers.ts';

const OverlayStackContext = createContext<OverlayStack>(createOverlayStack());

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const [stack] = useState(createOverlayStack);
  return <OverlayStackContext.Provider value={stack}>{children}</OverlayStackContext.Provider>;
}

export function useOverlayStack(): OverlayStack {
  return useContext(OverlayStackContext);
}

/**
 * Registers the calling overlay for as long as it is mounted, from the same commit that puts it in
 * the DOM. Returns whether it is the topmost overlay, to call from event handlers.
 */
export function useOverlayLayer(): () => boolean {
  const stack = useOverlayStack();
  const [layer] = useState(() => Symbol('overlay'));
  useLayoutEffect(() => stack.push(layer), [stack, layer]);
  return useCallback(() => stack.isTopmost(layer), [stack, layer]);
}
