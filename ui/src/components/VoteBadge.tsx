import { Tooltip } from "./Tooltip";
import styles from "./VoteBadge.module.css";

export function VoteBadge({ current, required }: { current: number; required: number }) {
  const label = `votes ${current}/${required}`;
  return <Tooltip content={label}><span aria-label={label} className={current >= required && required > 0 ? styles.complete : styles.badge}>{label}</span></Tooltip>;
}
