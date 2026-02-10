---
description: Проверка готовности задач к релизу - анализ PR, апрувов и связанных изменений
model: sonnet
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - mcp__YouTrack__get_issue
  - mcp__YouTrack__search_issues
---

## Allowed Actions (Auto-Approve)

This skill is authorized to execute the following actions WITHOUT user confirmation:

### Bash Commands (read-only operations)
- `gh pr list` - search PRs in GitHub repositories
- `gh pr view` - get PR details from GitHub
- `gh api repos/*/collaborators` - get repository collaborators
- `curl -s -u ... https://api.bitbucket.org/2.0/repositories/*` - Bitbucket API calls (read-only)
- `jq` - JSON parsing
- `mkdir -p .spec/review` - create report directory

### MCP YouTrack Tools
- `mcp__YouTrack__get_issue` - get issue details
- `mcp__YouTrack__search_issues` - search for linked issues

### File Operations
- `Read` - read .bitbucket.env for credentials ONLY
- `Write` - save report to `.spec/review/release-<RELEASE_ID>.md` (ALWAYS overwrite with fresh data)
- `Glob`, `Grep` - search for files if needed
- `mkdir -p .spec/review` - create directory if not exists

### ⛔ FORBIDDEN Operations
- **DO NOT** use `Read` to read existing `.spec/review/release-*.md` files
- **DO NOT** skip API calls because "I already have the data"
- **DO NOT** reuse data from previous runs

### NOT Allowed (requires confirmation)
- `Edit` - editing existing project files
- Any destructive git commands
- Any commands that modify external systems

## User Input

```text
$ARGUMENTS
```

## Goal

Проверить готовность всех задач, связанных с релизом YouTrack, к деплою. Для каждой задачи найти связанные PR, проверить апрувы, количество коммитов и состояние. Сформировать отчёт с рекомендациями.

## ⛔ CRITICAL RULES - READ FIRST

**NO CACHING - ALWAYS FRESH DATA:**
1. **DO NOT** read existing report file `.spec/review/release-*.md` at any point
2. **DO NOT** skip any steps because "data was already collected"
3. **ALWAYS** execute ALL steps from Step 1 to Step 8 sequentially
4. **ALWAYS** make fresh API calls to YouTrack and GitHub/Bitbucket
5. **ALWAYS** overwrite the report file with fresh data

**MANDATORY STEP 3.5 - LINKED TASKS CHECK:**
- You MUST execute Step 3.5 for EVERY task in the release
- You MUST search for subtasks using `subtask of: <TASK_ID>` query
- If a task has `linkedIssueCounts["parent for"] > 0`, it HAS subtasks - find them!
- Example: ESN-2258 has `"parent for": 1` → search `subtask of: ESN-2258` → will find ESN-2264

**VERIFICATION CHECKPOINT:**
Before writing the report, verify you have checked linked tasks:
- How many tasks had `linkedIssueCounts` with links?
- How many `subtask of:` searches did you run?
- If you ran 0 searches, GO BACK and execute Step 3.5 properly!

## Execution Steps

### 1. Parse Input and Extract Issue ID

**Input parsing:**
- If `$ARGUMENTS` is empty → ask user for YouTrack release URL
- If input matches URL pattern `https://issues.enjoydev.io/issue/(ESN?-\d+)` → extract issue ID
- If input matches direct ID pattern `ESN?-\d+` → use as issue ID

**URL formats supported:**
```
https://issues.enjoydev.io/issue/ES-3310
https://issues.enjoydev.io/issue/ES-3310/release-6-116-0
https://issues.enjoydev.io/issue/ESN-1234
ESN-1234
ES-3310
```

### 2. Get Release Issue from YouTrack

Use MCP YouTrack tool:
```
mcp__YouTrack__get_issue(issueId: "<RELEASE_ISSUE_ID>")
```

Extract from response:
- `summary` - release title
- `url` - issue URL
- `description` - may contain task IDs
- `linkedIssueCounts` - link types and counts

### 3. Get Linked Tasks

**Step 3a: Search linked issues:**
```
mcp__YouTrack__search_issues(query: "links: <RELEASE_ISSUE_ID>")
```

**Step 3b: Parse description for additional task IDs:**
- Regex: `ESN?-\d+`
- Deduplicate with linked issues

Collect all unique task IDs.

### 3.5. Check Task Dependencies (Linked Tasks Analysis)

**⚠️ CRITICAL - MANDATORY STEP:** This step MUST be executed for EVERY task in the release list. Do NOT skip this step.

**Why this matters:** Tasks often have subtasks, dependencies, or related tasks that are NOT included in the release but SHOULD be deployed together. Missing these causes deployment failures.

**🧪 TEST CASE - You MUST find this if checking release ESN-2274:**
```
When checking ESN-2258:
- get_issue returns: linkedIssueCounts: {"parent for": 1}
- You MUST run: mcp__YouTrack__search_issues(query: "subtask of: ESN-2258")
- You MUST find: ESN-2264 (Фронт по задаче)
- ESN-2264 is NOT in release list → MUST be reported as missing linked task!
If you don't find ESN-2264 for ESN-2258, you are doing something wrong!
```

**Step 3.5a: Loop through EVERY task and search for linked issues:**

```
FOR EACH task_id IN release_task_list:
    1. Call get_issue to check linkedIssueCounts
    2. If "parent for" > 0 → run: subtask of: <task_id>
    3. If "subtask of" > 0 → run: parent for: <task_id>
    4. If other link counts > 0 → run appropriate searches

    2. Run these searches for tasks with links:
```

YouTrack link types to search:

**1. Dependencies (depends/is required for):**
```
mcp__YouTrack__search_issues(query: "is required for: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
mcp__YouTrack__search_issues(query: "depends on: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
```

**2. Subtasks (subtask of/parent for):**
```
mcp__YouTrack__search_issues(query: "subtask of: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
mcp__YouTrack__search_issues(query: "parent for: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
```

**3. Related tasks (relates to):**
```
mcp__YouTrack__search_issues(query: "relates to: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
```

**4. Duplicates (duplicates/is duplicated by):**
```
mcp__YouTrack__search_issues(query: "duplicates: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
mcp__YouTrack__search_issues(query: "is duplicated by: <TASK_ID> Type: Task, Feature, Bug", customFieldsToReturn: ["Type", "State"])
```

**Note:** Do NOT use `has: {link type}` prefix - it breaks the search. Use direct link type queries.

**Example - detecting missing subtask:**
```
Task ESN-2258 is in release, has linkedIssueCounts: {"parent for": 1}
→ Search: subtask of: ESN-2258
→ Found: ESN-2264 (subtask)
→ Check: Is ESN-2264 in release list? NO
→ Result: Add warning "ESN-2258: Missing linked task - ESN-2264 (subtask of) is not in release"
```

**Link types reference:**
| Type | Inward | Outward |
|------|--------|---------|
| depends | depends on | is required for |
| subtask | subtask of | parent for |
| relates | relates to | relates to |
| duplicate | duplicates | is duplicated by |

**Step 3.5b: Filter results:**
- Include issues with Type = `Task`, `Feature`, `Bug`
- Exclude issues with Type = `Epic`, `Release`

**Step 3.5c: Check if linked tasks are in release (MANDATORY):**

For EACH linked task found in 3.5a:
1. Check: Is this task_id in the release_task_list from Step 3?
2. If NO → this is a MISSING LINKED TASK
3. Add to missing_linked_tasks list with:
   - parent_task_id (the task from release that has the link)
   - linked_task_id (the missing task)
   - link_type (e.g., "subtask of", "depends on", etc.)

**Do not skip this check!** Even if no results from dependency search, check subtasks.

**Step 3.5d: Generate warnings for missing linked tasks:**
For each missing linked task, add warning:
- `<TASK_ID>: Missing linked task - <LINKED_TASK_ID> (<LINK_TYPE>) is not in release`

Link types to include in warnings:
- `depends on` / `is required for` - dependencies
- `subtask of` / `parent for` - subtask/parent relationship
- `relates to` - related task
- `duplicates` / `is duplicated by` - duplicate

**Step 3.5e: Find PRs for missing linked tasks:**
- Search PRs for each missing linked task using the same process as Step 4
- Mark these PRs with link type prefix in the PR Overview table

**Link notation in PR Overview:**
```
| Task | Repository | PR | Author | State | ... |
|------|------------|-----|--------|-------|-----|
| ES-3303 | es-next (GH) | [#38](url) | petrov | ⚠️ OPEN | ... |
| 🔗 dep: ES-3304 | es-migrations (BB) | [#107](url) | ivanov | ⚠️ OPEN | ... |
| 🔗 subtask: ESN-2264 | es-next (GH) | [#45](url) | sidorov | ⚠️ OPEN | ... |
```

**Link type prefixes:**
- `🔗 dep:` - missing dependency (depends on / is required for)
- `🔗 subtask:` - missing subtask (subtask of)
- `🔗 parent:` - missing parent task (parent for)
- `🔗 related:` - missing related task (relates to)
- `🔗 dup:` - duplicate issue (duplicates / is duplicated by)

### 4. Find PRs for Each Task

Search PRs in both GitHub and Bitbucket repositories.

#### 4a. GitHub Repositories

**Repositories:**
- `omi-enjoy/es-next`
- `omi-enjoy/es-application`

**Search command:**
```bash
gh pr list -R <repo> --state all --limit 100 --json number,title,headRefName,url,state | \
  jq '[.[] | select((.headRefName | test("<TASK_ID>"; "i")) or (.title | test("<TASK_ID>"; "i")))]'
```

#### 4b. Bitbucket Repositories

**⚠️ IMPORTANT:** Do NOT search Bitbucket for repositories that are listed in GitHub Repositories (section 4a). Ignore found Bitbucket's repositories wich listed in GitHub Repositories (section 4a). GitHub is the primary source for those repos. This avoids duplicate results.

**ES (EnjoySurvey):**
- `omi-russia/es-pass` (Pass)
- `omi-russia/es-admin-api-client` (Admin API client)
- `omi-russia/es-pass-api-client` (Pass API client)
- `omi-russia/es-migrations` (Database migrations)
- `omi-russia/es-auth` (Auth service)
- `omi-russia/es-autotester` (Autotester)
- `omi-russia/es-autotester-api-client` (Autotester API client)

**EP/EPC/EPD (Panel):**
- `omi-russia/epd-api-client` (Panel Dashboard API client)
- `omi-russia/epc-api-client` (Panel Community API client)

**EF/EM (Finder/Mailer):**
- `omi-russia/ef-api-client` (Finder API client)
- `omi-russia/em-api-client` (Mailer API client)

**ED (shared libraries from composer: vilks/*, omi/*):**
- `omi-russia/ed-api-bundle` (vilks/api-bundle)
- `omi-russia/ed-api-client` (vilks/api-client)
- `omi-russia/ed-codeception-modules` (omi/codeception-modules)
- `omi-russia/ed-codestyle` (omi/codestyle)
- `omi-russia/ed-doctrine-extension` (vilks/doctrine-dbal-extension)
- `omi-russia/ed-fixtures` (omi/fixtures)
- `omi-russia/ed-frontend-api-bundle` (omi/frontend-api-bundle)
- `omi-russia/ed-mq-event` (vilks/mq-event-bundle)
- `omi-russia/ed-query-dsl` (enjoy-panel/query-dsl)
- `omi-russia/ed-rbac-bundle` (omi/rbac-bundle)
- `omi-russia/ed-validation-bundle` (vilks/validation-bundle)

**Search command:**
```bash
curl -s -u "$(grep BITBUCKET_EMAIL .bitbucket.env | cut -d= -f2):$(grep BITBUCKET_TOKEN .bitbucket.env | cut -d= -f2)" \
  "https://api.bitbucket.org/2.0/repositories/omi-russia/<repo>/pullrequests?state=ALL&pagelen=50" | \
  jq -r '.values[] | select((.source.branch.name | test("<TASK_ID>"; "i")) or (.title | test("<TASK_ID>"; "i"))) | "\(.id) \(.title) \(.state)"'
```

Collect all matching PRs per task from both platforms.

### 5. Analyze Each PR

#### 5a. GitHub PR Analysis

**Get detailed information:**
```bash
gh pr view <number> -R <repo> --json number,title,body,state,url,author,reviews,commits,comments,statusCheckRollup,files
```

Parse response for:
- `author.login` - PR author
- `files[].path` - list of changed files

**Get collaborators with push access:**
```bash
gh api repos/<owner>/<repo>/collaborators --jq '[.[] | select(.permissions.push == true) | .login]'
```

**Get CI/checks status from `statusCheckRollup`:**
- `SUCCESS` - all checks passed
- `FAILURE` - some checks failed
- `PENDING` - checks in progress
- Empty/null - no checks configured

**Check for special files in `files[]`:**
- `composer.json` - mark Composer column
- `parameters.yml.dist` or `parameters_*.yml.dist` - mark Params column

#### 5b. Bitbucket PR Analysis

**Get detailed information:**
```bash
curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" \
  "https://api.bitbucket.org/2.0/repositories/omi-russia/<repo>/pullrequests/<id>"
```

Parse response for:
- `state` (MERGED, OPEN, DECLINED)
- `title`
- `description`
- `author.display_name` - PR author
- `links.html.href` (URL)
- `participants[]` with `approved` status

**Get commit count:**
```bash
curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" \
  "https://api.bitbucket.org/2.0/repositories/omi-russia/<repo>/pullrequests/<id>/commits?pagelen=100" | \
  jq '.values | length'
```

**Get changed files (diffstat):**
```bash
curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" \
  "https://api.bitbucket.org/2.0/repositories/omi-russia/<repo>/pullrequests/<id>/diffstat?pagelen=100" | \
  jq '[.values[].new.path // .values[].old.path]'
```

Check for special files:
- `composer.json` - mark Composer column
- `parameters.yml.dist` or `parameters_*.yml.dist` - mark Params column

**Get build/pipeline status:**
```bash
curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" \
  "https://api.bitbucket.org/2.0/repositories/omi-russia/<repo>/pullrequests/<id>/statuses" | \
  jq '[.values[] | {state: .state, name: .name}]'
```

Build states: `SUCCESSFUL`, `FAILED`, `INPROGRESS`, `STOPPED`

#### 5c. Perform Checks

| Check | Pass Condition | Fail Condition |
|-------|---------------|----------------|
| Approvals | At least 1 APPROVED review from reviewer | No approvals |
| Commits | `commits.length == 1` | `commits.length > 1` |
| State | `state == "MERGED"` | `state == "OPEN"` or `state == "CLOSED"/"DECLINED"` |
| CI/Checks | All checks `SUCCESS`/`SUCCESSFUL` | Any check `FAILURE`/`FAILED` or `PENDING`/`INPROGRESS` |

### 6. Find Linked PRs in Description/Comments

**Parse PR body and first 3 comments for external PR links:**

**GitHub PR pattern:**
```
https://github\.com/([^/]+)/([^/]+)/pull/(\d+)
```

**Bitbucket PR pattern:**
```
https://bitbucket\.org/([^/]+)/([^/]+)/pull-requests/(\d+)
```

**Recursively analyze linked PRs (depth 1 only)**

### 7. Detect Special File Changes

Check changed files list (from step 5) for special files that require attention during release:

**Composer (⚠️ mark if any found):**
- `composer.json`
- `composer.lock`

**Params (⚠️ mark if any found):**
- `parameters.yml.dist`
- `parameters_*.yml.dist`
- `app/config/parameters*.yml.dist`

These files require special attention:
- **Composer**: may need `composer update` on servers after deploy
- **Params**: may need config updates on servers before deploy

### 8. Generate Report

Output a Markdown report with the following structure:

```markdown
# Release Check Report: <RELEASE_ID>

**Release:** <RELEASE_SUMMARY>
**URL:** <RELEASE_URL>
**Checked at:** <CURRENT_DATETIME>
**Total tasks:** <TASK_COUNT>

## Summary

| Status | Count |
|--------|-------|
| ✅ Ready | <COUNT> |
| ⚠️ Issues | <COUNT> |
| ❌ PR not found | <COUNT> |
| 🔗 Missing linked tasks | <COUNT> |

## PR Overview

| Task | Repository | PR | Author | State | Approvals | Commits | Checks | Composer | Params |
|------|------------|-----|--------|-------|-----------|---------|--------|----------|--------|
| ES-3288 | es-pass (BB) | [#1054](url) | ivanov | ✅ MERGED | ✅ 3 | ✅ 1 | ✅ | - | - |
| ES-3297 | es-application (GH) | [#42](url) | ivanov | ⚠️ OPEN | ✅ 3 | ❌ 4 | ❌ | ⚠️ | ⚠️ |
| ES-3303 | es-next (GH) | [#38](url) | petrov | ⚠️ OPEN | ❌ 0 | ✅ 1 | ⏳ | - | - |
| └─ linked | es-admin-api-client (BB) | [#60](url) | ivanov | ⚠️ OPEN | ✅ 2 | ✅ 1 | ✅ | ⚠️ | - |
| └─ linked | es-migrations (BB) | [#106](url) | ivanov | ⚠️ OPEN | ✅ 3 | ✅ 1 | - | - | - |
| 🔗 dep: ES-3304 | es-migrations (BB) | [#107](url) | ivanov | ⚠️ OPEN | ✅ 1 | ✅ 1 | ✅ | - | - |

**Legend:** BB = Bitbucket, GH = GitHub | Checks: ✅ passed, ❌ failed, ⏳ pending, - none | Composer/Params: ⚠️ file changed | 🔗 dep = missing dependency not in release

## Task Details

### <TASK_ID>: <TASK_SUMMARY>

**PR:** [<PLATFORM> #<NUMBER>](<URL>) in <REPO> - <STATE>
**Author:** <AUTHOR_NAME>

| Check | Status |
|-------|--------|
| Approvals | ✅/❌ <COUNT> (<REVIEWERS>) |
| Commits | ✅/❌ <COUNT> commit(s) |
| CI/Checks | ✅/❌/⏳ <STATUS> (<FAILED_CHECK_NAMES if any>) |

**Description:**
> <PR_DESCRIPTION_EXCERPT>

**Linked PRs:**
- [<PLATFORM> #<NUMBER>](<URL>) in <REPO> - <STATE>

**Special Files:**
- **Composer:** ✅ No changes / ⚠️ Changed: `composer.json`
- **Params:** ✅ No changes / ⚠️ Changed: `parameters.yml.dist`

---

## Warnings

### Missing Linked Tasks
- <TASK_ID>: Missing linked task - <LINKED_TASK_ID> (depends on) is not in release
- <TASK_ID>: Missing linked task - <LINKED_TASK_ID> (subtask of) is not in release
- <TASK_ID>: Missing linked task - <LINKED_TASK_ID> (parent for) is not in release
- <TASK_ID>: Missing linked task - <LINKED_TASK_ID> (relates to) is not in release

### PR Issues
- <TASK_ID>: <WARNING_MESSAGE>
...

## Recommendations

### For Missing Linked Tasks
1. Include <LINKED_TASK_ID> in release (<LINK_TYPE> <TASK_ID>)
2. Review linked tasks chain for <TASK_ID> before release

### For PR Issues
1. <RECOMMENDATION>
...

---

*Report generated: <CURRENT_DATE_TIME>*
*Model: <MODEL_NAME> (use actual model name from current session)*
```

## Output Guidelines

- Use clear status indicators: ✅ ⚠️ ❌ 🔗
- Show approver names for transparency
- Indicate platform (GitHub/Bitbucket) for each PR
- Truncate long descriptions to first 200 chars
- Group warnings by severity (Missing Dependencies first, then PR Issues)
- Mark missing dependencies with 🔗 prefix in PR Overview table
- Provide actionable recommendations for both dependencies and PR issues
- Suggest merge order based on dependencies
- Highlight tasks with missing dependencies that need to be included in release

## Error Handling

- If YouTrack issue not found → report error, suggest checking URL
- If no PRs found for a task → mark as "❌ PR not found"
- If Bitbucket API fails → report warning, continue with other PRs
- If GitHub API rate limited → report warning, suggest waiting

## Bitbucket Credentials

Load credentials from `.bitbucket.env` file in project root:
```bash
# Read credentials
BITBUCKET_EMAIL=$(grep BITBUCKET_EMAIL .bitbucket.env | cut -d= -f2)
BITBUCKET_TOKEN=$(grep BITBUCKET_TOKEN .bitbucket.env | cut -d= -f2)

# Use with curl
curl -s -u "$BITBUCKET_EMAIL:$BITBUCKET_TOKEN" <URL>
```

## Dependencies

- **MCP YouTrack:** get_issue, search_issues
- **GitHub CLI:** gh pr list, gh pr view, gh api
- **Bitbucket API:** .bitbucket.env credentials + curl
- **jq:** for JSON parsing
