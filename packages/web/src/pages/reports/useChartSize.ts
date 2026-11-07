import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { DEFAULT_GEOMETRY, readGeometry, type Geometry } from './seriesChartLayout.ts';

/** The element's content width, kept up to date while it resizes. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Reads the geometry from the element's custom properties once, before the first paint. */
export function useGeometry(ref: RefObject<HTMLElement | null>): Geometry {
  const [geometry, setGeometry] = useState(DEFAULT_GEOMETRY);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const style = getComputedStyle(ref.current);
    setGeometry(readGeometry(name => style.getPropertyValue(name)));
  }, [ref]);
  return geometry;
}
