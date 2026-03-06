import React from "react";
import Lockup from "@/assets/pacepilot-lockup.svg";

type Props = {
  width?: number;
};

export default function PacepilotMark({ width = 280 }: Props) {
  // Ratio exact du SVG
  const ratio = 549 / 585;

  return (
    <Lockup
      width={width}
      height={Math.round(width * ratio)}
    />
  );
}
