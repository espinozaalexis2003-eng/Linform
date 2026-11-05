# Two-tier Premium rollout

## New offers

- Lifetime Learning: USD 15, one-time digital-library access. Guides, projects, Git training and reference downloads; no personal-support entitlement.
- Mentorship & Resume Bundle: USD 60, one-time. Includes digital access, one combined resume/LinkedIn review plus a final revision, one 30–45-minute call, and guidance to plan one career-focused project. Requesting a call does not automatically schedule it; Alexis arranges timing with the student.
- Community access is marked coming soon until a real private invite is supplied in the protected catalog. No community server has been created by this update.

The original price and bundle remain recognized for existing buyers. Legacy support uses its existing monthly request policy. Owner access reads the existing verified-owner environment value and retains full access. A new digital purchase never grants personal support.

## Installation

The website can be published before the backend: it accepts new tier checkout only when `/premium/access` reports `tierPolicyVersion: 2`. It does not send a new-tier purchase to the old checkout. Existing accounts retain their libraries during the transition.

Download the updated private Linform-Premium-Setup.zip. Upload it to AWS CloudShell, extract it, and run `python3 infra/launch-tiers.py` from the extracted package. This checks the existing restricted key against both exact Stripe prices, reviews a code-only CloudFormation update, uploads the versioned private reference toolkit/catalog, and installs the two-tier backend. It preserves environment values, parameters, webhooks, account identity, owner access, private content permissions and the existing sales-enabled setting. It does not charge a card, create AWS resources, modify a key, or add IAM permissions.

`update-premium-tiers.py` is the standalone code updater. It verifies price amount, USD currency, environment, one-time billing and active product before updating. It refuses changes to unknown webhook or owner-access implementations and blocks unrelated/replacing CloudFormation changes. It supports `--review-only`.

## Fulfillment and support

Signed checkout completion and asynchronous-payment webhooks accept only exact known bundle/price/amount/quantity combinations. Reconciliation verifies the authenticated subject, environment and current charge status. Refunds, partial refunds and disputes revoke the affected offer. A refunded mentorship bundle does not remove a separately active digital purchase.

Personal-support consumption uses conditional transactional puts in the existing table. New bundle allowances are scoped to the verified checkout session and do not reset monthly. Legacy monthly records are preserved; resume review and final revision follow the prior policy. Client tier selection cannot supply a price, customer identity or entitlement. The tier API rejects legacy empty-body checkout requests so an old cached page cannot silently buy a different offer.

## Validation and limits

Run all repository checks, including the digital and mentorship variants of premium-member-flow.mjs, premium-tier-checkout.mjs and the backend suite. Tests cover price/bundle forgery, digital-only access, legacy and owner continuity, refunds, one-time support quotas and a separately purchased digital entitlement. No live payment has been made as part of these automated checks. The sandbox prices are isolated from live prices; a real sandbox end-to-end checkout can be tested after the owner installs the backend in the sandbox stack. Do not describe mocked tests as a completed live purchase.
