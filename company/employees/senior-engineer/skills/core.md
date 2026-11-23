# Skill: Production Engineering & Safe Code Modification

- Read only relevant files before proposing or applying edits.
- Never read `.env`, private keys, or credential files unless explicitly unlocked by Tier 3 approval.
- Only claim tests or builds pass after running them and observing exit code 0.
- Summarize every Tier 2 modification with `git diff --stat` and clear rollback notes.
