# Claude Code — Project Guidelines

## PR Review Workflow

When reviewing a pull request:

1. Read the PR title, description, and any linked Jira ticket to understand the intended change.
2. Review the diff for bugs, logic errors, missing null checks, off-by-one errors, unhandled edge cases, and style inconsistencies.
3. Post a summary comment on the PR listing any findings with file paths and line numbers.
4. For each finding, add an inline review comment on the relevant line.

### Fixing comments

When a fix is applied for a review comment or conversation thread — whether it was posted by Claude or another reviewer — **resolve the corresponding thread** immediately after pushing the fix. Use `pull_request_review_write` with `method: resolve_thread` and the thread's node ID.

This applies to:
- Threads where a code fix was committed and pushed.
- Threads confirmed as false positives (resolve after posting a clarifying reply).

Do not leave fixed or dismissed threads open.
