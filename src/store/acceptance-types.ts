import { Type, type Static } from "typebox";

const text = Type.String({ minLength: 1, pattern: "\\S" });
export const AcceptanceEvidence = Type.Object({
  reference: text,
  result: text,
  command: Type.Optional(text),
  cwd: Type.Optional(text),
  fingerprint: Type.Optional(text),
});
export const AcceptancePayload = Type.Object({
  evidence: Type.Array(AcceptanceEvidence),
  knownGaps: Type.Array(text),
  findings: Type.Array(text),
});
export type AcceptancePayload = Static<typeof AcceptancePayload>;
export type AcceptanceVerdict = "unchecked" | "checking" | "accepted" | "incomplete" | "blocked";
export interface AcceptanceRecord extends AcceptancePayload {
  swarmId: number;
  originalTask: string;
  revision: number;
  verdict: AcceptanceVerdict;
  claimant: string | null;
  claimRun: number | null;
  updatedBy: string | null;
  updatedAt: number | null;
}
