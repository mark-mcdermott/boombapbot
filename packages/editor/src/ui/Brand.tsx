import mascotUrl from '../assets/mascot.svg?url';

/** The mascot's drawing is 560 by 434 units. */
const MASCOT_ASPECT = 560 / 434;
/** Height at full size; the stylesheet shrinks it to fit narrow screens. */
const MASCOT_HEIGHT = 57;

export const TAGLINE = 'Let’s cook';

/**
 * The wordmark. A stand-in drawn on the seven-unit grid of the owner's earlier
 * wordmark, in the same blocks, until they supply their own. The stylesheet
 * fills it with the lockup's cream.
 */
function Wordmark() {
  return (
    <svg className="sb-wordmark" viewBox="0 0 507.3 47.67" role="img" aria-label="boombapbot">
      <path fillRule="evenodd" d="M0,47.67L0,0L40.86,0L40.86,6.81L47.67,6.81L47.67,20.43L40.86,20.43L40.86,27.24L47.67,27.24L47.67,40.86L40.86,40.86L40.86,47.67ZM20.43,13.62L27.24,13.62L27.24,20.43L20.43,20.43ZM20.43,27.24L27.24,27.24L27.24,34.05L20.43,34.05Z" />
      <path fillRule="evenodd" d="M57.88,0L91.93,0L91.93,6.81L98.74,6.81L98.74,40.86L91.93,40.86L91.93,47.67L57.88,47.67L57.88,40.86L51.07,40.86L51.07,6.81L57.88,6.81ZM71.5,13.62L78.31,13.62L78.31,34.05L71.5,34.05Z" />
      <path fillRule="evenodd" d="M108.95,0L143,0L143,6.81L149.81,6.81L149.81,40.86L143,40.86L143,47.67L108.95,47.67L108.95,40.86L102.14,40.86L102.14,6.81L108.95,6.81ZM122.57,13.62L129.38,13.62L129.38,34.05L122.57,34.05Z" />
      <path fillRule="evenodd" d="M153.21,47.67L153.21,0L194.07,0L194.07,6.81L200.88,6.81L200.88,47.67L187.26,47.67L187.26,13.62L180.45,13.62L180.45,47.67L173.64,47.67L173.64,13.62L166.83,13.62L166.83,47.67Z" />
      <path fillRule="evenodd" d="M204.28,47.67L204.28,0L245.14,0L245.14,6.81L251.95,6.81L251.95,20.43L245.14,20.43L245.14,27.24L251.95,27.24L251.95,40.86L245.14,40.86L245.14,47.67ZM224.71,13.62L231.52,13.62L231.52,20.43L224.71,20.43ZM224.71,27.24L231.52,27.24L231.52,34.05L224.71,34.05Z" />
      <path fillRule="evenodd" d="M255.35,47.67L255.35,34.05L262.16,34.05L262.16,20.43L268.97,20.43L268.97,6.81L275.78,6.81L275.78,0L282.59,0L282.59,6.81L289.4,6.81L289.4,20.43L296.21,20.43L296.21,34.05L303.02,34.05L303.02,47.67Z" />
      <path fillRule="evenodd" d="M306.42,47.67L306.42,0L347.28,0L347.28,6.81L354.09,6.81L354.09,20.43L347.28,20.43L347.28,27.24L326.85,27.24L326.85,47.67ZM326.85,13.62L333.66,13.62L333.66,20.43L326.85,20.43Z" />
      <path fillRule="evenodd" d="M357.49,47.67L357.49,0L398.35,0L398.35,6.81L405.16,6.81L405.16,20.43L398.35,20.43L398.35,27.24L405.16,27.24L405.16,40.86L398.35,40.86L398.35,47.67ZM377.92,13.62L384.73,13.62L384.73,20.43L377.92,20.43ZM377.92,27.24L384.73,27.24L384.73,34.05L377.92,34.05Z" />
      <path fillRule="evenodd" d="M415.37,0L449.42,0L449.42,6.81L456.23,6.81L456.23,40.86L449.42,40.86L449.42,47.67L415.37,47.67L415.37,40.86L408.56,40.86L408.56,6.81L415.37,6.81ZM428.99,13.62L435.8,13.62L435.8,34.05L428.99,34.05Z" />
      <path fillRule="evenodd" d="M459.63,0L507.3,0L507.3,13.62L493.68,13.62L493.68,47.67L473.25,47.67L473.25,13.62L459.63,13.62Z" />
    </svg>
  );
}

/** The lockup on the left of the header: the mascot over the tagline, beside the wordmark. */
export function Brand() {
  return (
    <div className="sb-brand" data-testid="brand">
      {/* Decorative: the wordmark beside it carries the name. */}
      <img
        className="sb-mascot"
        data-testid="brand-mascot"
        src={mascotUrl}
        alt=""
        width={Math.round(MASCOT_HEIGHT * MASCOT_ASPECT)}
        height={MASCOT_HEIGHT}
        draggable={false}
      />
      <Wordmark />
      <p className="sb-tagline" data-testid="tagline">
        {TAGLINE}
      </p>
    </div>
  );
}
