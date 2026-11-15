import mascotUrl from '../assets/mascot.svg?url';

/** The mascot's drawing is 374.53 by 318.91 units. */
const MASCOT_ASPECT = 374.53 / 318.91;
/** Height at full size; the stylesheet shrinks it to fit narrow screens. */
const MASCOT_HEIGHT = 105;

/**
 * The boombapbot wordmark, as the outlines supplied by the owner. The
 * stylesheet fills it with the lockup's cream.
 */
function Wordmark() {
  return (
    <svg className="sb-wordmark" viewBox="0 0 402.19 47.72" role="img" aria-label="boombapbot">
      <path d="M0,47.72v-13.63h27.25v-6.81H6.81v-6.81H0V6.81h6.81V0h40.91v13.66h-27.29v6.81h20.48v6.81h6.81v13.63h-6.81v6.81H0Z" />
      <path d="M51.5,47.72V0h40.9v6.81h6.81v40.91h-20.47V13.66h-6.81v34.06H51.5Z" />
      <path d="M101.49,47.72v-13.63h6.81v-13.62h6.81V6.81h6.82V0h6.81v6.81h6.81v13.66h6.85v13.62h6.81v13.63H101.49Z" />
      <path d="M151.49,47.72V0h40.9v6.81h6.81v13.66h-6.81v6.81h6.81v20.44h-20.47v-13.63h-6.81v13.63H151.49ZM178.73,20.47v-6.81h-6.81v6.81H178.73Z" />
      <path d="M202.16,13.66V0h47.72v13.66H202.16ZM202.16,47.72v-27.25h47.72v6.81h-27.29v6.81h27.28v13.63H202.16Z" />
      <path d="M253.28,47.72V0h40.9v6.81h6.82v13.66h-6.82v6.81h6.82v13.63h-6.82v6.81H253.28ZM280.52,20.47v-6.81h-6.81v6.81H280.52ZM280.52,34.09v-6.81h-6.81v6.81H280.52Z" />
      <path d="M303.57,47.72V0h40.91v6.81h6.81v40.91h-20.47V13.66h-6.81v34.06H303.57Z" />
      <path d="M354.47,47.72V0h40.91v6.81h6.81v13.66h-6.81v6.81h6.81v13.63h-6.81v6.81H354.47ZM381.72,20.47v-6.81h-6.82v6.81H381.72ZM381.72,34.09v-6.81h-6.82v6.81H381.72Z" />
    </svg>
  );
}

/** Mascot and wordmark, the only thing in the header. */
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
    </div>
  );
}
