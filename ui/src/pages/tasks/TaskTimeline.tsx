import type { TaskEvent, TaskEventKind } from "../../../../src/api-types";
import { AuthoredEntry } from "../../components/AuthoredEntry";
import { RichText } from "../../components/RichText";
import { relativeTime } from "../../lib/time";
import styles from "./TaskTimeline.module.css";

const actions: Record<TaskEventKind, string> = {
  created: "created the task",
  edited: "edited the task",
  claimed: "claimed the task",
  released: "released the task",
  handoff: "handed off the task",
  started: "started the task",
  review_requested: "started a review subagent",
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

export function TaskTimeline({ events }: { events: TaskEvent[] }) {
  return (
    <ol className={styles.timeline} aria-label="Task timeline">
      {events.map((event) => (
        <AuthoredEntry
          key={event.id}
          author={event.actor}
          action={actions[event.kind]}
          time={relativeTime(event.createdAt)}
        >
          <RichText
            text={[event.kind === "review_requested" ? "" : event.body, event.evidence].filter(Boolean).join("\n")}
          />
        </AuthoredEntry>
      ))}
    </ol>
  );
}
