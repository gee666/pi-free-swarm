import { Link } from "react-router-dom";
import { Tooltip } from "./Tooltip";
import styles from "./IdLink.module.css";

export function IdLink({
  swarmId,
  kind,
  id,
  title,
}: {
  swarmId: string;
  kind: "task" | "criterion";
  id: number;
  title: string;
}) {
  return (
    <Tooltip content={title}>
      <Link
        className={styles.link}
        to={`/s/${encodeURIComponent(swarmId)}/${kind === "task" ? "tasks" : "criteria"}/${id}`}
      >
        #{id}
      </Link>
    </Tooltip>
  );
}
