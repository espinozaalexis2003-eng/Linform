# Linform Premium — setup status

The public Premium page is safe to deploy with checkout closed. It is not a completed live commerce launch.

- Price: $15 USD, one-time purchase for this edition. No subscription.
- Live Stripe product: linform_premium_v1 (inactive).
- Live Price ID: price_1UWiNeR3GqiWlMaKPqUEeA9Q.
- Private draft: 39 chapters across CLF-C02, AZ-900 and Terraform Associate 004, plus six project guides and member mentoring requests. Paid content is deliberately NOT in this public repository.
- The private delivery ZIP contains the guides, an owner-review Markdown manuscript and the same backend/template/setup script. Never commit the ZIP or private-content directory to this public repository.

## Architecture

The public index.html contains marketing, a locked member reader and no paid chapter content. Existing Cognito authenticates students. A separate Premium API validates the same access-token issuer/client and checks current Stripe payment state before returning a catalog or guide from private S3. Public route visibility, localStorage flags and return URLs do not grant access. Refunds and disputes revoke access; at present even a partial refund suspends the corresponding order. A second valid order can still grant access. Chapter-completion IDs use the existing per-account progress sync; those IDs are not an entitlement.

Checkout uses a server-selected USD $15 one-time Price, not a client-provided amount. Stripe-hosted Checkout collects payment information. Webhook signatures use raw bytes, timestamp tolerance and constant-time comparisons. Both immediate and delayed payment events are handled, and reconciliation checks the authenticated Cognito subject against the current session. Production content endpoints fail closed if Stripe is unavailable. Content responses are no-store. No private guides, API keys, card data or bank details are in website HTML or the public repo.

Payment fulfillment uses Stripe API version 2026-09-30.endive. Use the same API version for the webhook destination. Secrets live in AWS Secrets Manager. Lambda receives only the secret ARN. Deploy a separate test stack with a separate sandbox key and matching test Price. Never use a sandbox key with the live Price or the live endpoint with test events. The existing student-account stack must not be replaced.

## Owner setup

1. Complete Stripe's account activation and add your payout bank in Stripe's secure Dashboard. The ChatGPT connection does not prove bank payouts are ready. Do not put bank details or keys into chat or GitHub.
2. Review the private OWNER-REVIEW.md. Validate the cloud and Terraform exercises and the current official exam objectives. The material is original educational guidance, not exam dumps, exam fees or a hiring guarantee. Finalize product description, customer support, access duration, refund policy and tax settings before enabling sales. Tax collection is not configured by this release.
3. Create a separate Stripe sandbox, an equivalent $15 one-time test Price and a restricted test key. Runtime permissions: Checkout Sessions write/read, Prices/Products read, PaymentIntents read, and Charges read. Setup does not need to create a payout or charge a real card.
4. Upload the private ZIP to AWS CloudShell in us-east-2, unzip it into a new directory and run `python3 infra/setup-premium.py`. Use test first. The script creates only a separate Premium stack, uploads paid JSON to private S3, and stores the key in Secrets Manager using a hidden prompt. It never prints keys. The CloudFormation stack creates billable AWS resources. A failed deploy must be inspected before retrying. S3 and DynamoDB have retain policies.
5. Create a Stripe webhook destination for the returned WebhookUrl, on API version 2026-09-30.endive. Required events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, charge.refunded, charge.dispute.created, charge.dispute.closed. Copy its whsec value only into the script's hidden prompt.
6. Configure the public `PREMIUM_API_URL` constant inside the account script in index.html with the test stack API URL for isolated test deployment. Do not point the production site at a test stack. Use a separate test origin/Cognito app configuration if conducting browser tests outside the existing canonical production origin; the template defaults to linformcloud.com; an isolated staging site needs its own origin and Cognito callback/client configuration. An owner can instead keep the public production checkout closed and verify HTTP endpoints with a legitimate student access token in a controlled environment. Never paste tokens into chat or commit them.
7. Acceptance: verify unsigned/expired webhook rejection; paid account A/unpaid B isolation; delayed payment pending/success/failure; duplicate events; wrong Price/amount; canceled Checkout; successful page return without webhook delivery; wrong-account session reconciliation; full/partial refund; dispute; provider outage; chapter progress after sign-out/sign-in; and direct S3 access denied. Use sandbox transactions only. Unit mocks do not replace these deployed tests.
8. Repeat setup for live mode with a live restricted key and the existing live Price. Keep SalesEnabled=false until the live webhook and private content are installed and checks pass. Complete the bank, product, refund and tax setup. Activate the Stripe product only when ready.
9. Configure the production Premium API URL and then deliberately update the live stack's SalesEnabled parameter to true. This opens real checkout; it is a separate release step. Confirm a completed purchase produces paid-only access. Do not claim live payments work before testing the deployed integration.

## Validation

Run `node tests/validate-site.mjs`, `node --test tests/account-progress.mjs tests/terminal.mjs tests/terraform.mjs`, and `python -m unittest discover -s infra -p 'test_*.py' -v` from the repo root. `python infra/build-premium-template.py` must be rerun after premium.py changes. The generated template embeds the exact tested backend.

## Operational limits

Payment-state reads are verified with Stripe on content requests, favoring prompt revocation over availability. A Stripe outage temporarily locks the library. Monitor API/Lambda failures and Stripe webhook delivery. Retained paid content/versioned objects and entitlement data need explicit lifecycle and account-deletion procedures. Purchased users can copy what they can view; purchase authorization prevents unpaid API access, not redistribution by a customer. Content currently remains a review draft and checkout is closed.

## Mentoring included in Premium

Alexis Espinosa is presented as a cloud engineer and founder. Members can request study help, project feedback or learning-plan guidance. This is an asynchronous request workflow, not automatic calendar booking, a promise of unlimited calls or a guaranteed response deadline. Timing and availability are confirmed individually. The public page also states that more projects, study material and mentoring resources are planned.

POST /premium/mentoring requires a valid student access token, a currently verified purchase, a valid reply email, a focused 20–3000 character message, a supported topic and explicit consent. An optional link must be a public GitHub repository URL. Requests are limited to approximately five per account per 24-hour window. The authenticated subject, not an input userId, owns the request. Requests are stored as MENTOR# records in the existing private Premium DynamoDB table; no automatic email notification or appointment is sent. The site acknowledges storage only.

Owner review: open the Premium stack in CloudFormation, locate its Entitlements DynamoDB table, and filter records whose sk begins with MENTOR#. Review status=requested entries and reply using the student's provided replyEmail. Treat all links and messages as untrusted student input. Record follow-up status in the table. Access is through your AWS administrative account, not a public website endpoint. Review the queue regularly after launch. No bank details, credentials or confidential customer data should be requested through this form. Include mentoring requests in your account-data deletion process.

The new projects are: an AWS authenticated support-ticket API, an Azure Linux operations/recovery lab, and a Terraform change-review/team-handoff exercise. They supplement the original three projects. Cloud usage is separate; the local Terraform examples use built-in terraform_data without provisioning cloud services.
