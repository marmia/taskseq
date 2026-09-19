import type { AreaColor } from "../../domain/task";

export type AreaColorTone = {
  solid: string;
  soft: string;
  tint: string;
  text: string;
};

export const areaColorTones: Record<AreaColor, AreaColorTone> = {
  blue: {
    solid: "#60a5fa",
    soft: "#dbeafe",
    tint: "#eff6ff",
    text: "#1d4ed8",
  },
  purple: {
    solid: "#c084fc",
    soft: "#f3e8ff",
    tint: "#faf5ff",
    text: "#7e22ce",
  },
  green: {
    solid: "#34d399",
    soft: "#d1fae5",
    tint: "#ecfdf5",
    text: "#047857",
  },
  yellow: {
    solid: "#fcd34d",
    soft: "#fef3c7",
    tint: "#fffbeb",
    text: "#a16207",
  },
  orange: {
    solid: "#fb923c",
    soft: "#ffedd5",
    tint: "#fff7ed",
    text: "#c2410c",
  },
  pink: {
    solid: "#f472b6",
    soft: "#fce7f3",
    tint: "#fdf2f8",
    text: "#be185d",
  },
  brown: {
    solid: "#b45309",
    soft: "#fef3c7",
    tint: "#fffbeb",
    text: "#92400e",
  },
  gray: {
    solid: "#94a3b8",
    soft: "#f1f5f9",
    tint: "#f8fafc",
    text: "#475569",
  },
};

export const areaBorderColors = Object.fromEntries(
  Object.entries(areaColorTones).map(([color, tone]) => [color, tone.solid]),
) as Record<AreaColor, string>;
