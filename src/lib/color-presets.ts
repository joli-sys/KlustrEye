export interface ColorPreset {
  label: string;
  primary: string;
  ring: string;
  /** A simple CSS color for dots/indicators outside the CSS variable scope */
  dot: string;
}

function preset(label: string, hue: number, lightness = 0.648, chroma = 0.2): [string, ColorPreset] {
  const color = `oklch(${lightness} ${chroma} ${hue})`;
  return [label.toLowerCase(), { label, primary: color, ring: color, dot: color }];
}

export const COLOR_PRESETS: Record<string, ColorPreset> = Object.fromEntries([
  preset("Red", 25),
  preset("Tomato", 40),
  preset("Orange", 55),
  preset("Amber", 75),
  preset("Yellow", 90),
  preset("Lime", 125),
  preset("Green", 145),
  preset("Emerald", 165),
  preset("Teal", 195),
  preset("Cyan", 210),
  preset("Sky", 230),
  preset("Blue", 260),
  preset("Indigo", 280),
  preset("Purple", 300),
  preset("Fuchsia", 320),
  preset("Pink", 340),
]);

export const DEFAULT_COLOR_SCHEME = "blue";
