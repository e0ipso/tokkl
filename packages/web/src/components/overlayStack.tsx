import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

/** In opening order. Global key handlers check for an open overlay; a modal checks it is topmost before Escape. */
interface OverlayStack {
  push(layer: symbol): () => void;
  isOpen(): boolean;
  isTopmost(layer: symbol): boolean;
}

function createOverlayStack(): OverlayStack {
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

/** From the same commit that mounts it. Returns whether it is topmost, to call from event handlers. */
export function useOverlayLayer(): () => boolean {
  const stack = useOverlayStack();
  const [layer] = useState(() => Symbol('overlay'));
  useLayoutEffect(() => stack.push(layer), [stack, layer]);
  return useCallback(() => stack.isTopmost(layer), [stack, layer]);
}
