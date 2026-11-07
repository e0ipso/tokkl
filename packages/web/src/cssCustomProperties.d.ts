import 'react';

declare module 'react' {
  interface CSSProperties {
    /** Custom properties the stylesheets read, such as --project-color or --swatch-check. */
    [property: `--${string}`]: string | number | undefined;
  }
}
