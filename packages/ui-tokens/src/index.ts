/** Brew Haven design tokens (ADR-0006). tokens.css mirrors these values. */
export const color = {
  espresso: "#120D0A",
  walnut: "#241810",
  roasted: "#57331F",
  brass: "#D9AD70",
  parchment: "#F1E4CC",
  cream: "#FBF6EC",
  warmGrey: "#B8A48B",
  ink: "#2A1C14",
  inkMuted: "#6B5546",
  leaf: "#6F8F5A",
  leafText: "#46633A",
  mint: "#D7EEDC",
  danger: "#A3361F",
  warning: "#8A5A00",
} as const;

/** Text/background pairs the apps use. Each must meet WCAG AA (4.5:1). */
export const textPairs: Array<[fg: keyof typeof color, bg: keyof typeof color]> = [
  ["ink", "cream"],
  ["ink", "parchment"],
  ["inkMuted", "cream"],
  ["roasted", "cream"],
  ["leafText", "cream"],
  ["leafText", "mint"],
  ["danger", "cream"],
  ["warning", "cream"],
  ["parchment", "espresso"],
  ["brass", "espresso"],
  ["brass", "walnut"],
  ["cream", "roasted"],
  ["warmGrey", "espresso"],
  ["espresso", "brass"],
];

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
