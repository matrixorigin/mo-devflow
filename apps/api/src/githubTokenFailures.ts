import { classifyGitHubError } from "@mo-devflow/github";

export interface GitHubTokenWorkflowFailure {
  statusCode: number;
  error: "github_token_reconnect_required" | "github_target_unavailable";
  message: string;
  shouldRevokeToken: boolean;
}

export function githubTokenFailureForWorkflowRead(error: unknown): GitHubTokenWorkflowFailure | null {
  const classified = classifyGitHubError(error);
  if (classified.kind === "permission") {
    return {
      statusCode: classified.status === 401 ? 401 : 403,
      error: "github_token_reconnect_required",
      message:
        classified.status === 401
          ? "GitHub rejected the connected token. Reconnect a valid GitHub token before workflow fixes are enabled."
          : "GitHub token no longer has access to this repository or issue. Reconnect a token with the required permissions.",
      shouldRevokeToken: true
    };
  }
  if (classified.kind === "not_found") {
    return {
      statusCode: 409,
      error: "github_target_unavailable",
      message:
        "GitHub could not read the target issue with this token. It may have moved, been deleted, or become inaccessible.",
      shouldRevokeToken: false
    };
  }
  return null;
}
