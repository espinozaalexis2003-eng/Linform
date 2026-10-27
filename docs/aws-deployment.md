# Connect GitHub Actions to Linform on AWS

## Status

The workflow is installed. AWS authentication must still be configured and a first successful run verified. Until AWS_ROLE_ARN is set, deployment jobs are skipped.

## What deployment does

A push changing index.html or the workflow on main publishes only index.html to the existing linform-website-alexis S3 bucket in us-east-2. It invalidates / and /index.html in the existing CloudFront distribution and waits for invalidation completion. Manual runs are supported on main. No bucket objects are deleted and public bucket access is not enabled.

The first run publishes the version in GitHub. Compare that file with any newer local or S3 copy before enabling automatic deployment.

## 1. Create AWS connection

Open AWS CloudShell in the AWS account that owns Linform. Review scripts/setup-aws-deploy.sh, then paste its full contents into CloudShell.

The script discovers the existing CloudFront distribution by its domain d22b5dik21lmzq.cloudfront.net, checks bucket ownership, creates the GitHub OIDC identity provider only if absent, and creates an IAM role named LinformGitHubDeploy. It will stop if that role already exists rather than overwrite it.

Permissions are limited to overwriting the bucket's index.html and creating/reading invalidations for the one distribution. Trust is restricted to this repository's main branch, including immutable GitHub owner/repository IDs. No AWS access keys are created.

If the script stops with an error, preserve the error and inspect it before retrying. It may have completed earlier setup steps.

## 2. Set GitHub variables

Repository > Settings > Secrets and variables > Actions > Variables > New repository variable.

Add the exact two values printed by the script:

- AWS_ROLE_ARN
- CLOUDFRONT_DISTRIBUTION_ID

These are identifiers, not passwords; use repository variables, not access-key secrets.

## 3. Test

Open Actions > Deploy Linform to AWS > Run workflow > main > Run workflow. Check that upload, invalidation, and completion succeed. Open https://linformcloud.com and verify the expected version and inquiry form. A skipped run is not a successful deployment.

Thereafter, index.html changes pushed or merged to main publish automatically. Documentation-only changes do not deploy.

## Security and maintenance

Keep main branch write access limited to trusted maintainers. The workflow uses temporary OIDC credentials and pinned action commit SHAs. Review action upgrades before updating pins. Pull request workflows do not deploy.

If AWS authentication reports a subject mismatch, inspect the repository's current OIDC subject configuration. Do not broaden trust to all repositories or branches.

If adding separate CSS, JavaScript, or images later, update both the upload workflow and narrowly scoped IAM permissions; this first workflow uploads only the current self-contained index.html.

To stop deployments, remove AWS_ROLE_ARN from repository variables or disable the workflow. To revoke AWS access, remove the dedicated role's policy or delete the dedicated role. Do not remove a shared OIDC provider used by other projects.

GitHub Actions, AWS requests, and CloudFront invalidations follow their providers' billing and included allowances.

## References

- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://docs.github.com/en/actions/reference/security/oidc
