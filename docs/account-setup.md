# Linform student accounts: AWS setup

The website works in guest mode before account setup. Accounts are not advertised as active until you configure them. The prepared integration uses Cognito classic hosted login, authorization code + PKCE, API Gateway JWT authorization, Lambda, and DynamoDB. Passwords never pass through Linform's HTML or API. No AWS access keys or client secrets belong in GitHub or the browser.

## 1. Deploy in your AWS account

Use AWS CloudShell in **us-east-2 (Ohio)** with an identity allowed to create CloudFormation, Cognito, DynamoDB, Lambda, HTTP API Gateway, CloudWatch Logs, and the restricted Lambda IAM role. Your existing GitHub website deploy role intentionally cannot provision this infrastructure.

This creates **usage-billed AWS services**, including database storage, point-in-time recovery, API requests, Lambda, Cognito usage, and logs. Throttling limits traffic but is not a hard spending cap. Review your AWS budget and account quotas first. Cognito's default email service also has sending limits; configure SES for larger audiences.

Run in CloudShell:

```bash
curl --fail --location --output linform-accounts.json \
  https://raw.githubusercontent.com/espinozaalexis2003-eng/Linform/main/infra/accounts.template.json

aws cloudformation deploy \
  --region us-east-2 \
  --stack-name linform-student-accounts \
  --template-file linform-accounts.json \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    PrimaryOrigin=https://linformcloud.com \
    DomainPrefix=linform-students-461729034360

aws cloudformation describe-stacks \
  --region us-east-2 \
  --stack-name linform-student-accounts \
  --query 'Stacks[0].Outputs' \
  --output table
```

If the domain prefix is taken, choose another unique lowercase prefix and retry. If your AWS account's Lambda quota prevents reserving five concurrent executions, request a quota increase or reduce/remove `ReservedConcurrentExecutions` after reviewing the capacity and cost implications.

## 2. Connect the website

Find **WebsiteAccountConfig** in the stack outputs. In `index.html`, find:

```js
const ACCOUNT_CONFIG = {domain: "", clientId: "", apiUrl: "", origin: ""};
```

Replace only the object with the returned JSON. These are public identifiers, not credentials. Commit to main. The existing GitHub Actions workflow publishes `index.html` and refreshes CloudFront.

Accounts use exactly the configured origin and `/` callback. If you visit `www.linformcloud.com`, the website tells you to open the canonical domain to sign in. To choose `www` instead, deploy with that PrimaryOrigin and use its returned configuration. Do not add an open redirect.

## 3. Required live checks before announcing accounts

1. Open the canonical site. Create a new test account and verify the emailed code.
2. Complete a lesson, wait for **Progress synced**, then sign in using a second browser/device. Verify it appears completed there.
3. Complete a different lesson on device two, then press **Sync progress** on device one. Both completions must remain.
4. Create a second account. It must not inherit the first account's progress or the guest history.
5. Sign out. The separate guest history returns. A reload needs sign-in again because access/ID/refresh tokens are not persisted; Cognito may remember its own login session.
6. With browser developer tools, call GET/PUT `/progress` without a bearer token; expect 401/403. A caller-supplied `userId` must not choose another account.
7. Test expired login and failed API requests. Account progress is cached separately on that device, and the UI provides a manual sync retry. Do not claim sync succeeded when it failed.

**Completion records are self-reported progress, not verified certification or examination results.**

## Data handling and maintenance

- Cognito stores the email and password verifier for student accounts. DynamoDB stores only a user subject and completed lesson IDs. It does not store terminal input, passwords, emails, or quiz answers.
- Guest and each account's completion cache are separate in browser storage. Signing in never automatically uploads guest history. Access tokens stay in memory, expire after 15 minutes, and are discarded on sign-out; refresh tokens returned by Cognito are discarded immediately.
- The API validates token type and gets the user identity only from API Gateway's validated claims. Each lesson is an independent, monotonic record, preserving updates from multiple devices. Requests accept at most 200 IDs with strict length and character checks. API Gateway throttling and a Lambda concurrency limit reduce bursts.
- CORS is restricted to the canonical site, but CORS is not authentication; JWT authorization protects both API routes.
- CloudFormation retains the user pool and progress table when the stack is deleted to prevent accidental loss of students' data. Retained storage continues to cost money until deliberately removed.
- To honor account deletion requests, use Cognito's administrative user deletion and remove DynamoDB records for that user's `sub`. Do both; deleting a Cognito account alone does not erase progress. Publish a fuller privacy policy and a deletion contact before broad promotion.
- Password reset is handled by Cognito's verified email recovery. Linform does not manage passwords itself.
- A clean browser does not keep an access token after reload. This is deliberate. For longer-lived sessions, use a reviewed backend-for-frontend with secure HttpOnly cookies rather than persisting refresh tokens in localStorage.
- Keep `infra/progress.py` and the template's inline Lambda source in sync with `python infra/build-template.py`, then deploy the changed template. Re-run `python -m unittest discover -s infra -p 'test_*.py'` before publishing.

## References

- [Cognito authorization code flow and PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
- [HTTP API JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
