import React, { memo } from "react";
import Lockup from "@/assets/pacepilot-lockup.svg";

type Props = {
  width?: number;
  size?: number;     // alias pratique
  color?: string;
  style?: any;
};

function PacepilotMark({
  width,
  size,
  color = "#FFFFFF",
  style,
}: Props) {
  const w = size ?? width ?? 280;

  // ✅ Ratio exact du SVG (hauteur / largeur)
  const ratio = 549 / 585;

  return (
    <Lockup
      width={w}
      height={Math.round(w * ratio)}
      color={color}
      style={[{ flexShrink: 0 }, style]}
    />
  );
}

export default memo(PacepilotMark);
