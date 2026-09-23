import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecipientStatus, RecipientView } from "../../../src/api-types";
import { aggregateDelivery, deliveryLabel, DeliveryList } from "./DeliveryStatus";

const TEN_TWENTY_FIVE = new Date().setHours(10, 25, 0, 0);

const recipient = (name: string, status: RecipientStatus): RecipientView => ({
  name,
  status,
  deliveredAt: status === "pending" || status === "undeliverable" ? null : TEN_TWENTY_FIVE,
  readAt: status === "read" ? TEN_TWENTY_FIVE : null,
});

describe("aggregateDelivery", () => {
  it("reflects the least advanced recipient", () => {
    expect(aggregateDelivery([recipient("Maria", "read"), recipient("John", "delivered")])).toBe("delivered");
    expect(aggregateDelivery([recipient("Maria", "read"), recipient("John", "pending")])).toBe("pending");
    expect(aggregateDelivery([recipient("Maria", "read")])).toBe("read");
    expect(aggregateDelivery([])).toBeUndefined();
  });

  it("lets undeliverable win over everything", () => {
    const recipients = [recipient("Maria", "pending"), recipient("John", "undeliverable"), recipient("Ava", "read")];
    expect(aggregateDelivery(recipients)).toBe("undeliverable");
  });
});

describe("deliveryLabel", () => {
  it("adds the time only for delivered and read", () => {
    expect(deliveryLabel(recipient("Maria", "read"))).toBe("Read 10:25 AM");
    expect(deliveryLabel(recipient("Maria", "delivered"))).toBe("Delivered 10:25 AM");
    expect(deliveryLabel(recipient("Maria", "pending"))).toBe("Pending");
    expect(deliveryLabel(recipient("Maria", "undeliverable"))).toBe("Not delivered");
  });
});

describe("DeliveryList", () => {
  it("renders one line per recipient", () => {
    render(<DeliveryList recipients={[recipient("Maria", "read"), recipient("John", "pending")]} />);
    const lines = screen.getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent("Maria·Read 10:25 AM");
    expect(lines[1]).toHaveTextContent("John·Pending");
  });
});
