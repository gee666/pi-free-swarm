import type { WorkerAssignment } from "../../../src/run-configuration";

export function WorkerModel({ model }: { model?: WorkerAssignment | null }) {
  return (
    <span title={model ? `Provider: ${model.provider}` : "No effective assignment was recorded for this worker"}>
      {model
        ? `${model.provider}/${model.modelId} · thinking: ${model.thinkingLevel ?? "unspecified"}`
        : "Model not recorded"}
    </span>
  );
}
