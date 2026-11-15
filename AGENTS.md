# Repository Agent Conventions

## Archiving Plan Documents (`/docs/plans`)

Whenever executing an approved implementation plan (or when asked to archive a reviewed plan without implementing it):

1. Save a versioned Markdown copy to `/docs/plans/YYYY-MM-DD-<slug>.md`.
2. Include YAML frontmatter at the top of the file:
   ```yaml
   ---
   title: <Plan Title>
   status: implemented # or planned
   created_at: <ISO-8601 UTC timestamp>
   implemented_at: <ISO-8601 UTC timestamp or null>
   ---
   ```
3. Update the index table in `/docs/plans/README.md`.
4. Note that during AI Studio's Planning Phase (before `Proceed`), workspace modifications are restricted to the temporary `implementation_plan.md` artifact, so `/docs/plans/` entries are written during execution (`Proceed`) or upon explicit post-review archive request.
