import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import * as Effect from "effect/Effect"
import type { ProcessExecutorShape } from "@llm4ts/core/ProcessExecutor"
import { ProcessError, type FlowError } from "@llm4ts/flow/FlowError"

// Pam's deliverable plumbing: a Jekyll post lands as a PR branch on the
// blog repo. Deterministic git via ProcessExecutor; command sequences are
// pure builders so tests never touch git. gh's own auth carries the token.

export const blogDefaultBranch = "master"

export const slugOf = (path: string): string => {
  const match = /_posts\/\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\.md$/.exec(path)
  return match?.[1] ?? "post"
}

export const branchFor = (cardId: number, path: string): string =>
  `dm/card-${cardId}-${slugOf(path)}`

export const cloneCommands = (
  repoSlug: string,
  cloneDir: string,
  exists: boolean
): ReadonlyArray<ReadonlyArray<string>> =>
  exists
    ? [["git", "fetch", "origin", blogDefaultBranch]]
    : [["gh", "repo", "clone", repoSlug, cloneDir]]

export const publishCommands = (
  branch: string,
  path: string,
  message: string
): ReadonlyArray<ReadonlyArray<string>> => [
  ["git", "checkout", "-B", branch, `origin/${blogDefaultBranch}`],
  ["git", "add", path],
  ["git", "commit", "-m", message],
  ["git", "push", "-u", "origin", branch, "--force-with-lease"]
]

const runAll = (
  process: ProcessExecutorShape,
  cwd: string,
  commands: ReadonlyArray<ReadonlyArray<string>>
): Effect.Effect<void, FlowError> =>
  Effect.forEach(
    commands,
    (argv) =>
      process.run(argv, cwd, {}).pipe(
        Effect.mapError((error) =>
          ProcessError.make({ message: argv.join(" "), detail: error.message })
        ),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.void
            : Effect.fail(
                ProcessError.make({
                  message: argv.join(" "),
                  detail:
                    [...result.stdout, ...result.stderr].join("\n").trim() ||
                    `exit code ${result.exitCode}`
                })
              )
        )
      ),
    { discard: true }
  )

const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.tryPromise({ try: () => stat(path), catch: () => "missing" }).pipe(
    Effect.map(() => true),
    Effect.catch(() => Effect.succeed(false))
  )

// Absolute: clone commands run with cwd = the clone's parent, so a
// relative target would double the path (.state/.state/blog).
export const blogCloneDir = (workspaceDir: string): string => resolve(workspaceDir, "blog")

export const ensureClone = (
  process: ProcessExecutorShape,
  workspaceDir: string,
  repoSlug: string
): Effect.Effect<string, FlowError> =>
  Effect.gen(function* () {
    const cloneDir = blogCloneDir(workspaceDir)
    const exists = yield* pathExists(join(cloneDir, ".git"))
    if (!exists) {
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(cloneDir), { recursive: true }),
        catch: (error) => ProcessError.make({ message: "mkdir workspace", detail: String(error) })
      }).pipe(
        Effect.mapError((error) =>
          error instanceof ProcessError
            ? error
            : ProcessError.make({ message: "mkdir workspace", detail: String(error) })
        )
      )
    }
    yield* runAll(process, exists ? cloneDir : dirname(cloneDir), cloneCommands(repoSlug, cloneDir, exists))
    return cloneDir
  })

// Write the post file into the clone and push it as a PR-ready branch.
export const pushPostBranch = (
  process: ProcessExecutorShape,
  cloneDir: string,
  cardId: number,
  path: string,
  content: string,
  message: string
): Effect.Effect<string, FlowError> =>
  Effect.gen(function* () {
    const branch = branchFor(cardId, path)
    // Branch off the fresh default branch BEFORE writing, so the file
    // lands on the branch, then stage/commit/push.
    yield* runAll(process, cloneDir, [publishCommands(branch, path, message)[0] ?? []])
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(join(cloneDir, path)), { recursive: true })
        await writeFile(join(cloneDir, path), content, "utf8")
      },
      catch: (error) => String(error)
    }).pipe(
      Effect.mapError((error) =>
        ProcessError.make({ message: `write ${path}`, detail: String(error) })
      )
    )
    yield* runAll(process, cloneDir, publishCommands(branch, path, message).slice(1))
    return branch
  })
