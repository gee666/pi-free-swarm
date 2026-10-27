import { Pill } from "./Pill";
import { statusLabels, type WorkStatus } from "./StatusGlyph";
import { Tooltip } from "./Tooltip";

export function StatusPill({ status, label }: { status: WorkStatus; label?: string }) {
  const text = label ?? statusLabels[status];
  return (
    <Tooltip content={text}>
      <Pill>{text}</Pill>
    </Tooltip>
  );
}
