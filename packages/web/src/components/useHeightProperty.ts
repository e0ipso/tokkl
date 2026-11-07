import { useEffect, type RefObject } from 'react';

/**
 * Writes the element's height to a custom property on <html> while it is mounted, such as the
 * timer bar's --timer-bar-height: the bulk bar is not inside the timer bar, so it reads the height
 * from there to stick right under it.
 */
export function useHeightProperty(ref: RefObject<HTMLElement | null>, property: string) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(property, `${element.offsetHeight}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(property);
    };
  }, [ref, property]);
}
