import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Donut } from "./Donut";
import { HourBars } from "./HourBars";

it("draws contiguous clockwise donut segments from twelve o'clock and names every count", () => {
  render(
    <Donut
      label="Tasks"
      value={6}
      total={10}
      completeLabel="done"
      segments={[
        { label: "Done", count: 6, color: "var(--accent)" },
        { label: "In progress", count: 4, color: "var(--accent-dim)" },
      ]}
    />,
  );
  const chart = screen.getByRole("img", { name: "Tasks: 6 done, 4 in progress. 6 of 10 done" });
  const circles = chart.querySelectorAll('circle[pathLength="100"]');
  expect(circles).toHaveLength(2);
  expect(circles[0]).toHaveAttribute("stroke-dasharray", "60 40");
  expect(circles[1]).toHaveAttribute("stroke-dashoffset", "-60");
  expect(circles[0]).toHaveAttribute("transform", "rotate(-90 70 70)");
  expect(circles[0]).toHaveAttribute("stroke-width", "16");
  expect(chart).toHaveTextContent("of 10 done");
});

it("renders empty donuts without invalid geometry", () => {
  render(
    <Donut
      label="Criteria"
      value={0}
      total={0}
      completeLabel="satisfied"
      segments={[{ label: "Satisfied", count: 0, color: "var(--accent)" }]}
    />,
  );
  const chart = screen.getByRole("img", { name: /0 of 0 satisfied/ });
  expect(chart.querySelectorAll("circle")).toHaveLength(1);
  expect(chart.innerHTML).not.toMatch(/NaN|Infinity/);
});

it("keeps the current hour last, shows twelve bars and labels every third hour in UTC", () => {
  const buckets = Array.from({ length: 13 }, (_, index) => ({ hourStart: index * 3600000, accepted: index }));
  render(<HourBars buckets={buckets} />);
  const chart = screen.getByRole("img", { name: /01:00: 1.*12:00: 12/ });
  const bars = chart.querySelectorAll("rect");
  expect(bars).toHaveLength(12);
  expect(bars[11]).toHaveAttribute("height", "96");
  expect(chart.querySelectorAll("text")).toHaveLength(4);
  expect(chart).toHaveTextContent("01:00");
  expect(chart).toHaveTextContent("10:00");
});

it("renders zero throughput without invalid bars", () => {
  render(<HourBars buckets={[{ hourStart: 0, accepted: 0 }]} />);
  const chart = screen.getByRole("img", { name: "Accepted per hour, UTC: 00:00: 0" });
  expect(chart.querySelector("rect")).toHaveAttribute("height", "0");
});
