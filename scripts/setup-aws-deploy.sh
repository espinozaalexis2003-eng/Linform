#!/usr/bin/env bash
# Run in AWS CloudShell in the account hosting Linform.
set -euo pipefail
export AWS_PAGER=""

BUCKET="linform-website-alexis"
DOMAIN="d22b5dik21lmzq.cloudfront.net"
ROLE="LinformGitHubDeploy"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
DIST_ID=$(aws cloudfront list-distributions --query 'DistributionList.Items[?DomainName==`d22b5dik21lmzq.cloudfront.net`].Id | [0]' --output text)
if [[ -z "$DIST_ID" || "$DIST_ID" == "None" ]]; then
  echo "Could not find the Linform CloudFront distribution in this AWS account." >&2
  exit 1
fi
aws s3api head-bucket --bucket "$BUCKET" --expected-bucket-owner "$ACCOUNT_ID"

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "Role $ROLE already exists. Stop and inspect it before changing its permissions." >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
PROVIDER_ARN="arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output json > "$WORK_DIR/providers.json"
if ! python3 -c 'import json,sys; sys.exit(0 if sys.argv[1] in json.load(open(sys.argv[2])) else 1)' "$PROVIDER_ARN" "$WORK_DIR/providers.json"; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com >/dev/null
else
  aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" > "$WORK_DIR/provider.json"
  python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); sys.exit(0 if "sts.amazonaws.com" in p["ClientIDList"] else "Existing provider lacks sts.amazonaws.com audience; inspect it before continuing.")' "$WORK_DIR/provider.json"
fi

cat > "$WORK_DIR/trust.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "$PROVIDER_ARN"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:espinozaalexis2003-eng@280049809/Linform@1435157892:ref:refs/heads/main"
    }}
  }]
}
JSON

cat > "$WORK_DIR/permissions.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishOnlyLinformHtml",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::$BUCKET/index.html"
    },
    {
      "Sid": "RefreshOnlyLinformDistribution",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::$ACCOUNT_ID:distribution/$DIST_ID"
    }
  ]
}
JSON

aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document "file://$WORK_DIR/trust.json" \
  --description "Deploy Linform index.html from its GitHub main branch" >/dev/null
aws iam put-role-policy --role-name "$ROLE" --policy-name LinformWebsiteDeploy \
  --policy-document "file://$WORK_DIR/permissions.json"

echo "AWS connection created. Add these GitHub repository Actions variables:"
echo "AWS_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/$ROLE"
echo "CLOUDFRONT_DISTRIBUTION_ID=$DIST_ID"
echo "No access keys are needed. This script has not deployed website files."
