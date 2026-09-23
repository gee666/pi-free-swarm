import { Ban, Check, CheckCheck, Clock, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import type { RecipientStatus, RecipientView } from "../../../src/api-types";
import { formatTimestamp } from "../lib/time";
import { Avatar } from "./Avatar";
import styles from "./DeliveryStatus.module.css";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { VisuallyHidden } from "./VisuallyHidden";

const STATES: Record<RecipientStatus, { icon: LucideIcon; label: string; accent: boolean; rank: number }> = {
  pending: { icon: Clock, label: "Pending", accent: false, rank: 0 },
  delivered: { icon: Check, label: "Delivered", accent: false, rank: 1 },
  read: { icon: CheckCheck, label: "Read", accent: true, rank: 2 },
  undeliverable: { icon: Ban, label: "Not delivered", accent: true, rank: -1 },
};

/** The least advanced recipient status; any undeliverable recipient wins. */
export function aggregateDelivery(recipients: readonly RecipientView[]): RecipientStatus | undefined {
  let result: RecipientStatus | undefined;
  for (const { status } of recipients) {
    if (result === undefined || STATES[status].rank < STATES[result].rank) result = status;
  }
  return result;
}

/** "Read 10:25 AM", "Delivered 10:24 AM", "Pending", "Not delivered". */
export function deliveryLabel(recipient: RecipientView): string {
  const time =
    recipient.status === "read" ? recipient.readAt : recipient.status === "delivered" ? recipient.deliveredAt : null;
  const label = STATES[recipient.status].label;
  return time === null ? label : `${label} ${formatTimestamp(time)}`;
}

export function DeliveryIcon({ status }: { status: RecipientStatus }) {
  const state = STATES[status];
  return <Icon icon={state.icon} size="status" className={cx(styles.icon, state.accent && styles.accent)} />;
}

/** Collapsed-row indicator: one aggregate icon, every recipient listed in the tooltip. */
export function DeliverySummary({ recipients }: { recipients: readonly RecipientView[] }) {
  const status = aggregateDelivery(recipients);
  if (status === undefined) return null;
  const details = recipients.map((recipient) => `${recipient.name} · ${deliveryLabel(recipient)}`).join("\n");
  return (
    <Tooltip content={details}>
      <span className={styles.summary}>
        <DeliveryIcon status={status} />
        <VisuallyHidden>{details}</VisuallyHidden>
      </span>
    </Tooltip>
  );
}

/** Expanded message: one line per recipient under the body. */
export function DeliveryList({ recipients }: { recipients: readonly RecipientView[] }) {
  return (
    <ul className={styles.list}>
      {recipients.map((recipient) => (
        <li key={recipient.name} className={styles.line}>
          <Avatar name={recipient.name} size="xs" />
          <span className={styles.name}>{recipient.name}</span>
          <span aria-hidden="true">·</span>
          <DeliveryIcon status={recipient.status} />
          <span>{deliveryLabel(recipient)}</span>
        </li>
      ))}
    </ul>
  );
}
