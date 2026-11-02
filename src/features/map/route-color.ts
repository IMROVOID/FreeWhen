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
 * Chosen so the stroke gains roughly the apparent luminance a filled pin has over
 * a stroke of the same hex, without washing out a saturated colour: at 0.22,
 * tangerine `#FF7A2F` becomes `#FF9B69` — recognisably the same orange, visibly
 * lighter. Larger values start to read as a different palette entry.
 */
export const STROKE_LIFT = 0.22;

/** Two hex digits, upper-cased, from a byte. */
function byteHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * The colour a route stroke is drawn in, given the colour of the pin it reaches.
 *
 * Returns the input unchanged when it is not a `#RRGGBB` value, so a caller may
 * pass a token it did not construct without a guard at the call site.
 */
export function brightenForStroke(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;

  const value = parseInt(match[1] as string, 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;

  const lift = (channel: number): number => channel + (255 - channel) * STROKE_LIFT;

  return `#${byteHex(lift(red))}${byteHex(lift(green))}${byteHex(lift(blue))}`;
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
