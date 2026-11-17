/**
 * Where the sun is, for sun mode (DESIGN.md section 6): `Site` carries no coordinates and the device gives none
 * without a permission prompt (ADR 0038 refuses location), so the one site the product serves is approximated by the
 * UAE centroid (journeys O3). A country spans about 4 degrees of longitude, which moves sunrise and sunset by at most
 * a quarter of an hour: far inside the margin of a theme switch.
 */
export const UAE_CENTROID = { lat: 24.4, lon: 54.4 } as const;

/**
 * Solar elevation above the horizon in degrees (negative below it), geometric, no atmospheric refraction.
 *
 * NOAA "General Solar Position Calculations": fractional year gamma, then the equation of time and the declination as
 * the NOAA Fourier series, then the hour angle from true solar time. Accurate to a few tenths of a degree, about a
 * minute of sunrise or sunset: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 *
 * This function is also the source of the inline theme script: `theme-script.ts` embeds `solarElevationDeg.toString()`
 * so there is exactly one implementation. It therefore must stay self-contained: no import, no module-level constant,
 * no syntax that needs a compiler helper (no destructuring, spread or optional chaining). The unit tests run the
 * embedded copy, so a change that breaks that fails there.
 */
export function solarElevationDeg(lat: number, lon: number, at: Date): number {
  const rad = Math.PI / 180;
  const startOfYear = Date.UTC(at.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((at.getTime() - startOfYear) / 86400000) + 1;
  const utcHours = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const equationOfTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const trueSolarTimeMin = utcHours * 60 + equationOfTimeMin + 4 * lon;
  const hourAngle = (trueSolarTimeMin / 4 - 180) * rad;
  const cosZenith =
    Math.sin(lat * rad) * Math.sin(declination) + Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / rad;
}
