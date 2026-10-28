"""Generate the single-file CloudFormation template from the tested Lambda source."""
import json
from pathlib import Path
root = Path(__file__).parent
ref = lambda x: {"Ref": x}
sub = lambda x: {"Fn::Sub": x}
get = lambda x, y: {"Fn::GetAtt": [x, y]}
resources = {
 "UserPool": {"Type": "AWS::Cognito::UserPool", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
   "UserPoolName": sub("${AWS::StackName}-students"), "UserPoolTier": "LITE",
   "UsernameAttributes": ["email"], "AutoVerifiedAttributes": ["email"],
   "UsernameConfiguration": {"CaseSensitive": False},
   "Policies": {"PasswordPolicy": {"MinimumLength": 12, "RequireLowercase": True, "RequireUppercase": True, "RequireNumbers": True, "RequireSymbols": True}},
   "AccountRecoverySetting": {"RecoveryMechanisms": [{"Name": "verified_email", "Priority": 1}]}}},
 "Client": {"Type": "AWS::Cognito::UserPoolClient", "Properties": {
   "UserPoolId": ref("UserPool"), "ClientName": "Linform website", "GenerateSecret": False,
   "AllowedOAuthFlowsUserPoolClient": True, "AllowedOAuthFlows": ["code"],
   "AllowedOAuthScopes": ["openid"], "SupportedIdentityProviders": ["COGNITO"],
   "CallbackURLs": [sub("${PrimaryOrigin}/")], "LogoutURLs": [sub("${PrimaryOrigin}/")],
   "PreventUserExistenceErrors": "ENABLED", "EnableTokenRevocation": True,
   "AccessTokenValidity": 15, "IdTokenValidity": 15,
   "TokenValidityUnits": {"AccessToken": "minutes", "IdToken": "minutes"}}},
 "Domain": {"Type": "AWS::Cognito::UserPoolDomain", "Properties": {"UserPoolId": ref("UserPool"), "Domain": ref("DomainPrefix")}},
 "ProgressTable": {"Type": "AWS::DynamoDB::Table", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
   "BillingMode": "PAY_PER_REQUEST", "AttributeDefinitions": [{"AttributeName": "userId", "AttributeType": "S"}, {"AttributeName": "lessonId", "AttributeType": "S"}],
   "KeySchema": [{"AttributeName": "userId", "KeyType": "HASH"}, {"AttributeName": "lessonId", "KeyType": "RANGE"}],
   "SSESpecification": {"SSEEnabled": True}, "PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": True}}},
 "FunctionRole": {"Type": "AWS::IAM::Role", "Properties": {
   "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
   "Policies": [{"PolicyName": "ProgressOnly", "PolicyDocument": {"Version": "2012-10-17", "Statement": [
     {"Effect": "Allow", "Action": ["dynamodb:Query", "dynamodb:BatchWriteItem"], "Resource": get("ProgressTable", "Arn")},
     {"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"], "Resource": sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-progress:*")}]}}]}},
 "LogGroup": {"Type": "AWS::Logs::LogGroup", "Properties": {"LogGroupName": sub("/aws/lambda/${AWS::StackName}-progress"), "RetentionInDays": 14}},
 "Function": {"Type": "AWS::Lambda::Function", "DependsOn": "LogGroup", "Properties": {
   "FunctionName": sub("${AWS::StackName}-progress"), "Runtime": "python3.12", "Handler": "index.handler", "Role": get("FunctionRole", "Arn"),
   "MemorySize": 128, "Timeout": 10, 
   "Environment": {"Variables": {"TABLE_NAME": ref("ProgressTable")}}, "Code": {"ZipFile": (root / "progress.py").read_text()}}},
 "Api": {"Type": "AWS::ApiGatewayV2::Api", "Properties": {"Name": sub("${AWS::StackName}-api"), "ProtocolType": "HTTP",
   "CorsConfiguration": {"AllowOrigins": [ref("PrimaryOrigin")], "AllowMethods": ["GET", "PUT", "OPTIONS"], "AllowHeaders": ["authorization", "content-type"], "MaxAge": 300}}},
 "Authorizer": {"Type": "AWS::ApiGatewayV2::Authorizer", "Properties": {"ApiId": ref("Api"), "AuthorizerType": "JWT", "Name": "Students",
   "IdentitySource": ["$request.header.Authorization"], "JwtConfiguration": {"Audience": [ref("Client")], "Issuer": sub("https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}")}}},
 "Integration": {"Type": "AWS::ApiGatewayV2::Integration", "Properties": {"ApiId": ref("Api"), "IntegrationType": "AWS_PROXY", "IntegrationUri": get("Function", "Arn"), "PayloadFormatVersion": "2.0"}},
 "Stage": {"Type": "AWS::ApiGatewayV2::Stage", "Properties": {"ApiId": ref("Api"), "StageName": "$default", "AutoDeploy": True,
   "DefaultRouteSettings": {"ThrottlingBurstLimit": 10, "ThrottlingRateLimit": 5}}},
 "Permission": {"Type": "AWS::Lambda::Permission", "Properties": {"FunctionName": ref("Function"), "Action": "lambda:InvokeFunction", "Principal": "apigateway.amazonaws.com",
   "SourceArn": sub("arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*/*/progress")}}
}
for method in ("GET", "PUT"):
 resources[method + "Route"] = {"Type": "AWS::ApiGatewayV2::Route", "Properties": {"ApiId": ref("Api"), "RouteKey": method + " /progress", "Target": sub("integrations/${Integration}"), "AuthorizationType": "JWT", "AuthorizerId": ref("Authorizer"), "AuthorizationScopes": ["openid"]}}
template = {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Linform student accounts and per-user completion sync. Creates billable AWS services.",
 "Parameters": {
  "PrimaryOrigin": {"Type": "String", "Default": "https://linformcloud.com", "AllowedPattern": "https://[a-z0-9.-]+", "Description": "Canonical website origin; HTTPS, no trailing slash. Accounts work on this exact origin."},
  "DomainPrefix": {"Type": "String", "AllowedPattern": "[a-z0-9][a-z0-9-]{1,60}[a-z0-9]", "Description": "Unique Cognito hosted login domain prefix."}},
 "Resources": resources,
 "Outputs": {
  "WebsiteAccountConfig": {"Value": sub('{"domain":"https://${DomainPrefix}.auth.${AWS::Region}.amazoncognito.com","clientId":"${Client}","apiUrl":"https://${Api}.execute-api.${AWS::Region}.amazonaws.com","origin":"${PrimaryOrigin}"}')},
  "UserPoolId": {"Value": ref("UserPool")}, "ProgressTableName": {"Value": ref("ProgressTable")}}}
(root / "accounts.template.json").write_text(json.dumps(template, indent=2) + "\n")
