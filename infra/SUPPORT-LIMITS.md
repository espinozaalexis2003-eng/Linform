# Premium personal-support policy

The public page groups personal support inside the existing blue mentoring box. Custom-project guidance and resume support appear there for prospects and members. The illustrative project preview is prospect-only; the complete private guides remain authenticated.

## Allowances

- One mentoring request per authenticated account per UTC calendar month. Existing study-question, project-feedback and learning-plan topics share this allowance.
- One custom-project request per authenticated account per UTC calendar month, separate from mentoring.
- One initial resume review and one final revision per authenticated account, without a monthly reset. The final revision requires an initial request; the form asks students to wait for initial feedback before submitting it.
- A request is a saved asynchronous feedback request. Reply timing and availability are arranged individually. No automatic email or appointment is promised.

The new counters start when the server policy is installed. Historical requests are retained and are not retroactively charged against the new counters.

## Owner installation

Run `update-premium-support.py --account-id YOUR_ACCOUNT_ID --stack-name YOUR_PREMIUM_STACK` in AWS CloudShell. The script is self-contained. It verifies the caller's AWS account, reads the current deployed CloudFormation template, preserves every parameter and environment value, and changes only inline Lambda code. It preserves existing owner-access helpers, Stripe handling, JWT validation, private content and permissions. It rejects unrelated or replacing change-set entries; only Lambda Code and an exact existing IntegrationUri dependency reevaluation are allowed. `--review-only` creates and removes the temporary change set without executing it.

The page remains compatible with the previous API while the owner performs this step. Displaying the policy on the page alone does not install server-side enforcement.

## Storage and atomicity

Existing Entitlements table records use `USER#<verified subject>` plus `SUPPORT#MENTORING#YYYY-MM`, `SUPPORT#CUSTOM#YYYY-MM`, or `SUPPORT#RESUME`. A transaction conditionally writes the allowance record and the mentoring request together. Competing requests cannot consume the same allowance, and an unsuccessful transaction creates neither record. Existing table-scoped PutItem permission covers both transactional puts; no new table or IAM policy is needed.

The existing `/premium/access` response returns the caller's own allowance usage. No client-supplied user ID, browser counter, topic value, return URL or local flag grants Premium access. The existing request contract is preserved through explicit request prefixes for resume reviews, final revisions and custom projects.

## Verification

Run the backend unit suite and `node tests/premium-support.mjs`, plus the existing member/owner, review, account and site checks. After installation, refresh Premium to fetch the usage. A genuine support submission consumes its allowance; avoid submitting throwaway live requests merely for QA. Unit tests exercise limits, prerequisites, month boundaries, isolation, failed transactions and competing writes without customer data or payments.
