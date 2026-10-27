import type { CriterionDetailResponse, TaskDetailResponse } from "../../../../src/api-types";
import { useWorkDetail } from "../work-items/useWorkData";
import type { WallLink } from "./WallLinks";

export function navigationLinkIds(state: unknown) {
  const taskId =
    state && typeof state === "object" && "taskId" in state && typeof state.taskId === "number"
      ? state.taskId
      : undefined;
  const criterionId =
    state && typeof state === "object" && "criterionId" in state && typeof state.criterionId === "number"
      ? state.criterionId
      : undefined;
  return { taskId, criterionId };
}

export function useWallPrefill(swarmId: string, taskId: number | undefined, criterionId: number | undefined) {
  const task = useWorkDetail<TaskDetailResponse>(swarmId, taskId === undefined ? undefined : `tasks/${taskId}`);
  const criterion = useWorkDetail<CriterionDetailResponse>(
    swarmId,
    criterionId === undefined ? undefined : `criteria/${criterionId}`,
  );
  const links: WallLink[] = [];
  if (taskId !== undefined) {
    const value = task.data?.id === taskId ? task.data : undefined;
    links.push({
      targetKind: "task",
      targetId: taskId,
      title: value?.title ?? `Task #${taskId}`,
      status: value?.waiting ? "waiting" : value?.status,
    });
  }
  if (criterionId !== undefined) {
    const value = criterion.data?.id === criterionId ? criterion.data : undefined;
    links.push({
      targetKind: "criterion",
      targetId: criterionId,
      title: value?.title ?? `Criterion #${criterionId}`,
      status: value?.status,
    });
  }
  return {
    links,
    error: taskId !== undefined ? task.error : criterion.error,
    reload: () => {
      task.reload();
      criterion.reload();
    },
  };
}
