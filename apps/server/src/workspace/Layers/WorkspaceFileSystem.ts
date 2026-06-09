import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const DEFAULT_READ_FILE_MAX_BYTES = 256 * 1024;
const BINARY_DETECTION_SAMPLE_BYTES = 8 * 1024;

function isPathInsideRoot(path: Path.Path, root: string, filePath: string): boolean {
  const relativeToRoot = path.relative(root, filePath);
  return (
    relativeToRoot.length === 0 ||
    (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))
  );
}

function hasBinaryBytes(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.byteLength, BINARY_DETECTION_SAMPLE_BYTES);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function decodeUtf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      const maxBytes = input.maxBytes ?? DEFAULT_READ_FILE_MAX_BYTES;

      const fileStat = yield* fileSystem.stat(target.absolutePath).pipe(
        Effect.catch((cause) => {
          if (cause.reason._tag === "NotFound") {
            return Effect.succeed(null);
          }
          return Effect.fail(
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.stat",
              detail: cause.message,
              cause,
            }),
          );
        }),
      );

      if (!fileStat) {
        return {
          relativePath: target.relativePath,
          sizeBytes: 0,
          state: "missing",
        };
      }

      if (fileStat.type !== "File") {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile",
          detail: "Workspace path is not a file.",
        });
      }

      const fileSizeBytes = Number(fileStat.size);

      if (fileSizeBytes > maxBytes) {
        return {
          relativePath: target.relativePath,
          sizeBytes: fileSizeBytes,
          state: "too_large",
          maxBytes,
        };
      }

      const [realRoot, realFilePath] = yield* Effect.all(
        [fileSystem.realPath(input.cwd), fileSystem.realPath(target.absolutePath)],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.realPath",
              detail: cause.message,
              cause,
            }),
        ),
      );

      if (!isPathInsideRoot(path, realRoot, realFilePath)) {
        return yield* new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile",
          detail: "Workspace file resolved outside the project root.",
        });
      }

      const bytes = yield* fileSystem.readFile(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.readFile",
              detail: cause.message,
              cause,
            }),
        ),
      );

      if (bytes.byteLength > maxBytes) {
        return {
          relativePath: target.relativePath,
          sizeBytes: bytes.byteLength,
          state: "too_large",
          maxBytes,
        };
      }

      if (hasBinaryBytes(bytes)) {
        return {
          relativePath: target.relativePath,
          sizeBytes: bytes.byteLength,
          state: "binary",
        };
      }

      const contents = decodeUtf8Text(bytes);
      if (contents === null) {
        return {
          relativePath: target.relativePath,
          sizeBytes: bytes.byteLength,
          state: "binary",
        };
      }

      return {
        relativePath: target.relativePath,
        sizeBytes: bytes.byteLength,
        state: "text",
        contents,
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return { readFile, writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
