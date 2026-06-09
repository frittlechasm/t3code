import { queryOptions } from "@tanstack/react-query";
import type { EnvironmentId } from "@t3tools/contracts";

import { ensureEnvironmentApi } from "../environmentApi";

export const gitQueryKeys = {
  fileDiff: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    path: string | null,
    ignoreWhitespace: boolean,
    contextLines?: number,
  ) =>
    [
      "git",
      "file-diff",
      environmentId ?? null,
      cwd,
      path,
      ignoreWhitespace,
      contextLines ?? null,
    ] as const,
};

export function vcsFileDiffQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  path: string | null;
  ignoreWhitespace: boolean;
  contextLines?: number;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.fileDiff(
      input.environmentId,
      input.cwd,
      input.path,
      input.ignoreWhitespace,
      input.contextLines,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.path || !input.environmentId) {
        throw new Error("File diff is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.vcs.getFileDiff({
        cwd: input.cwd,
        path: input.path,
        includeStaged: true,
        includeUnstaged: true,
        ignoreWhitespace: input.ignoreWhitespace,
        ...(input.contextLines !== undefined ? { contextLines: input.contextLines } : {}),
      });
    },
    enabled:
      input.environmentId !== null &&
      input.cwd !== null &&
      input.path !== null &&
      (input.enabled ?? true),
    staleTime: 1_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
