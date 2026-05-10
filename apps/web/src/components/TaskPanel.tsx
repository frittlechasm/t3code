import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { CheckIcon, ClockIcon, XCircleIcon } from "lucide-react";
import { useMemo } from "react";

import { useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";

type TaskStatus = "running" | "completed" | "failed" | "stopped";

interface TaskEntry {
  taskId: string;
  label: string;
  status: TaskStatus;
}

function extractTaskId(payload: unknown): string | null {
  if (payload !== null && typeof payload === "object" && "taskId" in payload) {
    const id = (payload as Record<string, unknown>).taskId;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function extractTaskLabel(activity: OrchestrationThreadActivity): string {
  const payload = activity.payload as Record<string, unknown> | null;
  if (payload) {
    if (typeof payload.summary === "string" && payload.summary.length > 0) {
      return payload.summary;
    }
    if (typeof payload.description === "string" && payload.description.length > 0) {
      return payload.description;
    }
  }
  return activity.summary;
}

function extractTaskStatus(activity: OrchestrationThreadActivity): TaskStatus {
  if (activity.kind === "task.started" || activity.kind === "task.progress") {
    return "running";
  }
  if (activity.kind === "task.completed") {
    const payload = activity.payload as Record<string, unknown> | null;
    const status = payload?.status;
    if (status === "failed") return "failed";
    if (status === "stopped") return "stopped";
    return "completed";
  }
  return "running";
}

function buildTaskList(activities: readonly OrchestrationThreadActivity[]): TaskEntry[] {
  const taskMap = new Map<string, TaskEntry>();
  const relevant = activities
    .filter(
      (a) => a.kind === "task.started" || a.kind === "task.progress" || a.kind === "task.completed",
    )
    .toSorted((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  for (const activity of relevant) {
    const taskId = extractTaskId(activity.payload);
    if (!taskId) continue;
    taskMap.set(taskId, {
      taskId,
      label: extractTaskLabel(activity),
      status: extractTaskStatus(activity),
    });
  }

  return [...taskMap.values()].toReversed();
}

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === "running") {
    return (
      <span
        aria-label="Running"
        className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
      />
    );
  }
  if (status === "completed") {
    return <CheckIcon aria-label="Completed" className="size-3.5 text-green-500" />;
  }
  return <XCircleIcon aria-label="Failed" className="size-3.5 text-destructive" />;
}

export default function TaskPanel({ mode }: { mode: DiffPanelMode }) {
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const tasks = useMemo(
    () => buildTaskList(activeThread?.activities ?? []),
    [activeThread?.activities],
  );

  return (
    <DiffPanelShell mode={mode} header={<span className="text-sm font-medium">Tasks</span>}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <ClockIcon className="size-8 opacity-40" />
            <span className="text-sm">No task activity yet</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((task) => (
              <li
                key={task.taskId}
                className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted/50"
              >
                <span className="mt-0.5 shrink-0">
                  <TaskStatusIcon status={task.status} />
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground">{task.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DiffPanelShell>
  );
}
