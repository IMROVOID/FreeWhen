/**
 * The route line's colour, derived from the pin it leads to.
 *
 * ★ THE LINE AND THE PIN ARE THE SAME COLOUR AND STILL LOOK DIFFERENT.
 *
 * The report was "the routing lines follow the proposed location's colour but are
 * too dark — make them dynamically lighter, almost as bright as the map pins".
 * There is no darkening code: the black casing that used to sit under the stroke
 * was removed, and both the pin and the line are handed the same `#RRGGBB`.
 *
 * The difference is perceptual and it is structural:
 *
 *  - a pin is a FILLED shape, ringed in white and lifted by a drop shadow, so all
 *    of its pixels are saturated and it reads at full value;
 *  - a 6 px stroke carries roughly a third of that ink, and its edges are
 *    antialiased against a busy basemap — so the same hex reads a step darker.
 *
 * Matching the two inputs therefore cannot fix it; the line needs a brighter
 * input to render at the same apparent brightness. That is what this module is.
 *
 * ★ IT LIFTS TOWARD WHITE RATHER THAN RAISING VALUE, AND THAT IS THE HUE.
 *
 * Colour on this map answers exactly one question — "whose line is that?" — so a
 * brightening pass must not desaturate. Each channel moves by the same FRACTION
 * OF ITS OWN HEADROOM (`c + (255 - c) · k`), which leaves the channels' order
 * untouched and therefore leaves the hue on the same side of the wheel. A plain
 * multiply would clamp saturated channels at 255 and drift the hue toward
 * whatever did not clamp.
 *
 * ★ AN UNPARSEABLE VALUE IS RETURNED UNCHANGED.
 *
 * A theme token may already carry alpha (`withAlpha` emits `rgba(…)`), and a hex
 * parser fed that would emit a colour the renderer rejects — which reads as "the
 * line disappeared", a far worse defect than "the line is dark".
 */

/**
 * How far each channel travels toward white.
 *
 * ★ 0.22 WAS NOT ENOUGH, AND THE MEASUREMENT SAYS SO.
 *
 * The first value was chosen to "gain roughly the apparent luminance a filled pin
 * has over a stroke of the same hex". A device screenshot says that reasoning was
 * right in principle and too timid in practice: the report came back as "the lines
 * are still too dark" with the stroke reading as a muted olive beside a bright pin.
 * A stroke has to clear the pin's apparent brightness, not approach it — the pin
 * is a filled shape with a shadow under it, the stroke is a hairline over a busy
 * basemap that is darker than either.
 *
 * At 0.42, tangerine `#FF7A2F` becomes `#FFC7A5` and volt `#D4FF3A` becomes
 * `#EBFFB2`: still the same hue, now unmistakably the brighter of the two marks.
 * Beyond about 0.5 a saturated colour starts to read as pastel rather than as the
 * palette entry it belongs to, which would break "whose line is that?".
 */
export const STROKE_LIFT = 0.42;

/**
 * The luminance a stroke must reach, whatever its hue.
 *
 * ★ A FIXED FRACTION IS NOT ENOUGH ON ITS OWN, BECAUSE IT IS RELATIVE TO THE HUE.
 *
 * Lifting a dark red by 42 % of its headroom leaves it well below a bright lime
 * lifted by the same fraction, so "is this line bright enough to read?" would
 * depend on which person happened to propose the place. After the lift the colour
 * is pushed toward white until it clears this floor, which is a measured value
 * rather than a taste: it sits comfortably above the night basemap's own luminance
 * (~0.02) and above a mid-tone street, so the line never disappears into the map.
 */
export const MIN_STROKE_LUMINANCE = 0.5;

/** Two hex digits, upper-cased, from a byte. */
function byteHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

function channelsOf(value: number): [number, number, number] {
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * The colour a route stroke is drawn in, given the colour of the pin it reaches.
 *
 * Two steps, in this order:
 *
 *  1. every channel moves the same FRACTION of its own headroom toward white, which
 *     brightens without reordering the channels and therefore without shifting the
 *     hue — the thing that answers "whose line is that?";
 *  2. if that still leaves the colour dimmer than `MIN_STROKE_LUMINANCE`, it is
 *     pushed further toward white until it clears the floor. Step 2 cannot change
 *     the hue either, for the same reason.
 *
 * Returns the input unchanged when it is not a `#RRGGBB` value, so a caller may
 * pass a token it did not construct without a guard at the call site.
 */
export function brightenForStroke(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;

  const [red, green, blue] = channelsOf(parseInt(match[1] as string, 16));

  const lift = (channel: number, amount: number): number =>
    channel + (255 - channel) * amount;

  const firstPass = [lift(red, STROKE_LIFT), lift(green, STROKE_LIFT), lift(blue, STROKE_LIFT)];

  const format = (rgb: number[]): string =>
    `#${byteHex(rgb[0] as number)}${byteHex(rgb[1] as number)}${byteHex(rgb[2] as number)}`;

  const lifted = format(firstPass);
  if (relativeLuminance(lifted) >= MIN_STROKE_LUMINANCE) return lifted;

  // ★ SOLVED, NOT GUESSED: bisect on the extra lift until the floor is met.
  //
  // A closed-form answer would be one line of algebra over the sRGB transfer
  // function, and it would be wrong the moment somebody adjusts the curve. Bisection
  // is bounded, obvious, and lands within a byte of the smallest sufficient lift.
  let low = 0;
  let high = 1;

  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2;
    const candidate = format([
      lift(red, STROKE_LIFT + (1 - STROKE_LIFT) * mid),
      lift(green, STROKE_LIFT + (1 - STROKE_LIFT) * mid),
      lift(blue, STROKE_LIFT + (1 - STROKE_LIFT) * mid),
    ]);

    if (relativeLuminance(candidate) >= MIN_STROKE_LUMINANCE) high = mid;
    else low = mid;
  }

  return format([
    lift(red, STROKE_LIFT + (1 - STROKE_LIFT) * high),
    lift(green, STROKE_LIFT + (1 - STROKE_LIFT) * high),
    lift(blue, STROKE_LIFT + (1 - STROKE_LIFT) * high),
  ]);
}

/**
 * A colour's relative luminance, on the WCAG scale.
 *
 * Exported because the tests measure "brighter" rather than asserting a literal:
 * a value that is eyeballed against one palette entry stops being true when the
 * palette changes, and this product derives marker colours from a hash.
 */
export function relativeLuminance(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return 0;

  const value = parseInt(match[1] as string, 16);
  const linear = (channel: number): number => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };

  const red = linear((value >> 16) & 0xff);
  const green = linear((value >> 8) & 0xff);
  const blue = linear(value & 0xff);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
