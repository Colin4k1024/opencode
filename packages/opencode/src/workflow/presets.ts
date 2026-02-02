import z from "zod"

const stepSchema = z.object({
  id: z.string(),
  agent: z.string(),
  prompt: z.string(),
  condition: z
    .object({
      type: z.enum(["git_exists", "test_passed", "custom"]),
      check: z.string(),
    })
    .optional(),
  on_success: z.string().nullable().optional(),
  on_failure: z.union([z.literal("stop"), z.literal("continue"), z.string()]).optional(),
})

export type WorkflowStep = z.infer<typeof stepSchema>

export type WorkflowPreset = {
  name: string
  description: string
  steps: WorkflowStep[]
}

/**
 * Predefined workflow: fix -> test -> git commit
 * Fixes an error, runs tests, and commits if tests pass and git exists
 */
export function createFixTestCommitWorkflow(errorDescription: string, commitMessage?: string): WorkflowPreset {
  return {
    name: "fix-test-commit",
    description: "Fix error, run tests, and commit if tests pass",
    steps: [
      {
        id: "fix",
        agent: "fix",
        prompt: `Fix the following error: ${errorDescription}`,
        on_success: "test",
        on_failure: "stop",
      },
      {
        id: "test",
        agent: "general",
        prompt:
          "Run tests to verify the fix works correctly. Use the bash tool to execute the appropriate test command for this project (e.g., npm test, mvn test, pytest, go test, etc.).",
        condition: {
          type: "test_passed",
          check: "npm test", // Default test command, can be customized
        },
        on_success: "commit",
        on_failure: "stop",
      },
      {
        id: "commit",
        agent: "general",
        prompt: commitMessage
          ? `Commit the changes using git. Use the bash tool to run: git add -A && git commit -m '${commitMessage}'`
          : `Commit the changes using git with an appropriate message describing the fix. Use the bash tool to run: git add -A && git commit -m '[describe the fix]'`,
        condition: {
          type: "git_exists",
          check: "test -d .git",
        },
        on_success: null,
        on_failure: "continue", // Continue even if git doesn't exist
      },
    ],
  }
}

/**
 * Predefined workflow: fix -> test
 * Fixes an error and runs tests
 */
export function createFixTestWorkflow(errorDescription: string): WorkflowPreset {
  return {
    name: "fix-test",
    description: "Fix error and run tests",
    steps: [
      {
        id: "fix",
        agent: "fix",
        prompt: `Fix the following error: ${errorDescription}`,
        on_success: "test",
        on_failure: "stop",
      },
      {
        id: "test",
        agent: "general",
        prompt:
          "Run tests to verify the fix works correctly. Use the bash tool to execute the appropriate test command for this project.",
        on_success: null,
        on_failure: "stop",
      },
    ],
  }
}

/**
 * Predefined workflow: test -> git commit
 * Runs tests and commits if tests pass
 */
export function createTestCommitWorkflow(commitMessage?: string): WorkflowPreset {
  return {
    name: "test-commit",
    description: "Run tests and commit if tests pass",
    steps: [
      {
        id: "test",
        agent: "general",
        prompt:
          "Run tests to verify everything works. Use the bash tool to execute the appropriate test command for this project.",
        condition: {
          type: "test_passed",
          check: "npm test",
        },
        on_success: "commit",
        on_failure: "stop",
      },
      {
        id: "commit",
        agent: "general",
        prompt: commitMessage
          ? `Commit the changes using git. Use the bash tool to run: git add -A && git commit -m '${commitMessage}'`
          : `Commit the changes using git with an appropriate message. Use the bash tool to run: git add -A && git commit -m '[describe the changes]'`,
        condition: {
          type: "git_exists",
          check: "test -d .git",
        },
        on_success: null,
        on_failure: "continue",
      },
    ],
  }
}

/**
 * Predefined workflow: fix -> test -> git commit -> push
 * Fixes an error, runs tests, commits if tests pass, and pushes to remote if remote exists
 */
export function createFixTestCommitPushWorkflow(errorDescription: string, commitMessage?: string): WorkflowPreset {
  return {
    name: "fix-test-commit-push",
    description: "Fix error, run tests, commit if tests pass, and push to remote",
    steps: [
      {
        id: "fix",
        agent: "fix",
        prompt: `Fix the following error: ${errorDescription}`,
        on_success: "test",
        on_failure: "stop",
      },
      {
        id: "test",
        agent: "general",
        prompt:
          "Run tests to verify the fix works correctly. Use the bash tool to execute the appropriate test command for this project (e.g., npm test, mvn test, pytest, go test, etc.).",
        condition: {
          type: "test_passed",
          check: "npm test", // Default test command, can be customized
        },
        on_success: "commit",
        on_failure: "stop",
      },
      {
        id: "commit",
        agent: "general",
        prompt: commitMessage
          ? `Commit the changes using git. Use the bash tool to run: git add -A && git commit -m '${commitMessage}'`
          : `Commit the changes using git with an appropriate message describing the fix. Use the bash tool to run: git add -A && git commit -m '[describe the fix]'`,
        condition: {
          type: "git_exists",
          check: "test -d .git",
        },
        on_success: "push",
        on_failure: "continue", // Continue even if git doesn't exist
      },
      {
        id: "push",
        agent: "general",
        prompt: "Push the committed changes to remote repository. Use the bash tool to execute: git push",
        condition: {
          type: "custom",
          check: "git remote -v | grep -q .", // Check if remote exists
        },
        on_success: null,
        on_failure: "continue", // Continue even if push fails (e.g., no remote configured)
      },
    ],
  }
}

/**
 * Get a workflow preset by name
 */
export function getWorkflowPreset(name: string, ...args: any[]): WorkflowPreset | null {
  switch (name) {
    case "fix-test-commit":
      return createFixTestCommitWorkflow(args[0] || "Fix the error", args[1])
    case "fix-test-commit-push":
      return createFixTestCommitPushWorkflow(args[0] || "Fix the error", args[1])
    case "fix-test":
      return createFixTestWorkflow(args[0] || "Fix the error")
    case "test-commit":
      return createTestCommitWorkflow(args[0])
    default:
      return null
  }
}

/**
 * List all available workflow presets
 */
export function listWorkflowPresets(): Array<{ name: string; description: string }> {
  return [
    { name: "fix-test-commit", description: "Fix error, run tests, and commit if tests pass" },
    { name: "fix-test-commit-push", description: "Fix error, run tests, commit if tests pass, and push to remote" },
    { name: "fix-test", description: "Fix error and run tests" },
    { name: "test-commit", description: "Run tests and commit if tests pass" },
  ]
}
