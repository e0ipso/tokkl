import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

/**
 * The open modals and popovers, in the order they opened. Global key handlers ask it whether an
 * overlay is open, and a modal asks whether it is the topmost one before Escape closes it, instead
 * of looking for overlay class names in the DOM.
 */
export interface OverlayStack {
  /** Adds a layer and returns the function that removes it. */
  push(layer: symbol): () => void;
  isOpen(): boolean;
  isTopmost(layer: symbol): boolean;
}

export function createOverlayStack(): OverlayStack {
  const layers: symbol[] = [];
  return {
    push(layer) {
      layers.push(layer);
      return () => {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
      };
    },
    isOpen: () => layers.length > 0,
    isTopmost: layer => layers[layers.length - 1] === layer,
  };
}

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
