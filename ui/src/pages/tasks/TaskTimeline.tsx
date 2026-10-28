import type { TaskEvent, TaskEventKind } from "../../../../src/api-types";
import { TimelineBody } from "./TimelineBody";
import { relativeTime } from "../../lib/time";
import styles from "./TaskTimeline.module.css";

const actions: Record<TaskEventKind, string> = {
  created: "created the task",
  edited: "edited the task",
  claimed: "claimed the task",
  released: "released the task",
  handoff: "handed off the task",
  started: "started the task",
  review_requested: "requested review",
  review_accepted: "accepted the task",
  changes_requested: "requested changes",
  reopened: "reopened the task",
  linked: "linked a criterion",
  unlinked: "unlinked a criterion",
  dependency_added: "added a dependency",
  dependency_removed: "removed a dependency",
  dependencies_ready: "marked dependencies ready",
  dependency_reopened: "reopened a dependency",
};

function TimelineEvent({ event }: { event: TaskEvent }) {
  const text = [event.kind === "review_requested" ? "" : event.body, event.evidence].filter(Boolean).join("\n");
  return (
    <li className={styles.event}>
      <p>
        <span className={styles.name}>{event.actor}</span> · {actions[event.kind]} ·{" "}
        <span className={styles.time}>{relativeTime(event.createdAt)}</span>
      </p>
      {text && <TimelineBody text={text} />}
    </li>
  );
}

export function TaskTimeline({ events }: { events: TaskEvent[] }) {
  return (
    <ol className={styles.timeline} aria-label="Task timeline">
      {events.map((event) => (
        <TimelineEvent key={event.id} event={event} />
      ))}
    </ol>
  );
}
