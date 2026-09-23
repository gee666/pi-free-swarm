import type { LucideIcon } from "lucide-react";

/** Icon sizes: 20px inline, 24px in the rail, 16px for delivery status. */
const ICON_SIZE = { status: 16, inline: 20, rail: 24, empty: 40 } as const;
const STROKE_WIDTH = 1.75;

interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof ICON_SIZE;
  className?: string;
}

export function Icon({ icon: Glyph, size = "inline", className }: IconProps) {
  return <Glyph size={ICON_SIZE[size]} strokeWidth={STROKE_WIDTH} className={className} aria-hidden="true" />;
}
