/**
 * The graffiti "Tokkl" wordmark, drawn as SVG paths so it needs no font and fetches nothing.
 *
 * Layers, back to front: a halo around every letter and its shadow, the shadow (the letters offset
 * down and right in the outline colour), then each letter with its outline, drips and shines. Colours
 * come from the --wordmark-* tokens in styles.css, so the drawing follows the theme; the contrast
 * table there has the pairs. docs/brand/tokkl-wordmark.svg is a copy of this drawing with the light
 * colours written in, for the README. Change both together.
 */

type Letter = {
  /** Fill class: one of the four palette colours. */
  fill: 'orange' | 'aqua' | 'pink' | 'lime';
  /** Each letter leans its own way. */
  transform: string;
  /** The letter's body; the o's counter is a second subpath, cut out by the even-odd rule. */
  body: string;
  /** Paint drips under the letter, drawn first so the letter covers their tops. */
  drips?: string[];
  /** Highlight strokes on the fill. */
  shines: string[];
};

const LETTERS: Letter[] = [
  {
    fill: 'orange',
    transform: 'rotate(-5 44 55)',
    body: 'M4 16 L82 6 L84 34 L58 37 L58 98 L30 102 L30 40 L6 42 Z',
    shines: ['M12 22 L34 19'],
  },
  {
    fill: 'aqua',
    transform: 'rotate(4 112 74)',
    body:
      'M112 42 C134 42 145 56 145 72 C145 90 131 103 112 103 C92 103 81 90 81 72 C81 54 93 42 112 42 Z ' +
      'M113 61 C107 61 104 66 104 72 C104 79 107 84 113 84 C119 84 122 79 122 72 C122 66 119 61 113 61 Z',
    drips: ['M100 96 L100 116 C100 122 108 122 108 116 L108 96 Z'],
    shines: ['M92 62 C94 55 99 51 105 50'],
  },
  {
    fill: 'pink',
    transform: 'rotate(-3 178 55)',
    body: 'M146 10 L171 4 L171 58 L191 36 L216 40 L188 68 L214 98 L185 102 L171 84 L171 100 L146 102 Z',
    shines: ['M153 16 L153 40'],
  },
  {
    fill: 'lime',
    transform: 'rotate(5 240 58)',
    body: 'M210 12 L235 6 L235 60 L255 38 L280 42 L252 70 L278 100 L249 104 L235 86 L235 102 L210 104 Z',
    shines: ['M217 18 L217 42'],
  },
  {
    fill: 'orange',
    transform: 'rotate(-3 296 54)',
    body: 'M280 6 L306 0 L306 76 C306 86 313 88 321 81 L330 97 C314 112 282 110 282 92 Z',
    drips: ['M290 98 L290 122 C290 128 298 128 298 122 L298 98 Z'],
    shines: ['M287 12 L287 40'],
  },
];

const VIEW_BOX = { x: -12, y: -13, width: 363, height: 158 };
const SHADOW_OFFSET = 'translate(6 6)';

/** Every letter as a flat silhouette (body and drips), for the halo and the shadow. */
function silhouettes() {
  return LETTERS.map((letter, i) => (
    <g key={i} transform={letter.transform}>
      {letter.drips?.map((d) => <path key={d} d={d} />)}
      <path d={letter.body} />
    </g>
  ));
}

export function Wordmark({ width }: { width: number }) {
  const height = Math.round((width * VIEW_BOX.height) / VIEW_BOX.width);
  return (
    <svg
      className="wordmark"
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
      width={width}
      height={height}
      fillRule="evenodd"
      role="img"
      aria-label="Tokkl"
    >
      <g className="wordmark-halo">
        {silhouettes()}
        <g transform={SHADOW_OFFSET}>{silhouettes()}</g>
      </g>
      <g className="wordmark-shadow" transform={SHADOW_OFFSET}>{silhouettes()}</g>
      {LETTERS.map((letter, i) => (
        <g key={i} transform={letter.transform} className={`wordmark-letter wordmark-${letter.fill}`}>
          {letter.drips?.map((d) => <path key={d} d={d} />)}
          <path d={letter.body} />
          {letter.shines.map((d) => <path key={d} d={d} className="wordmark-shine" />)}
        </g>
      ))}
    </svg>
  );
}
