#!/usr/bin/env bash
# One-time setup: creates the public GitHub repo, pushes, and turns on the live dashboard.
# Needs: git, and the GitHub CLI signed in (gh auth login).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-retrospect}"
gh auth status >/dev/null 2>&1 || { echo "Sign in first: gh auth login"; exit 1; }
OWNER="$(gh api user --jq .login)"
echo "Publishing as github.com/$OWNER/$NAME (public)"

# Make the owner the required reviewer for guardrails, requirements, scoring and config.
sed -i.bak "s/@OWNER/@$OWNER/g" .github/CODEOWNERS && rm -f .github/CODEOWNERS.bak

[ -d .git ] || git init -q -b main
git add -A
git commit -q -m "Set code owner to @$OWNER" || true

gh repo create "$OWNER/$NAME" --public --source . --remote origin --push \
  --description "Retrospect: an agent that speeds up delivery without lowering quality or test coverage"

# Live dashboard on GitHub Pages, deployed by the collect workflow.
gh api -X POST "repos/$OWNER/$NAME/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$NAME/pages" -f build_type=workflow >/dev/null

# Protect main: CI must pass and code owners must review.
gh api -X PUT "repos/$OWNER/$NAME/branches/main/protection" --input - >/dev/null <<JSON || echo "Branch protection skipped (needs admin rights)"
{
  "required_status_checks": { "strict": true, "contexts": ["typecheck, test (100% coverage), trace"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "require_code_owner_reviews": true, "required_approving_review_count": 0 },
  "restrictions": null
}
JSON

gh workflow run collect.yml --repo "$OWNER/$NAME" >/dev/null || true
echo
echo "Repo:      https://github.com/$OWNER/$NAME"
echo "Dashboard: https://$OWNER.github.io/$NAME/  (live after the first collect run, about 2 minutes)"
