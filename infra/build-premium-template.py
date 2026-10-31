import json
from pathlib import Path
r=Path(__file__).parent
ref=lambda name:{'Ref':name}
sub=lambda value:{'Fn::Sub':value}
get=lambda name,attr:{'Fn::GetAtt':[name,attr]}
resources={
'Content':{'Type':'AWS::S3::Bucket','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True},'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},'VersioningConfiguration':{'Status':'Enabled'},'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]}}},
'ContentPolicy':{'Type':'AWS::S3::BucketPolicy','Properties':{'Bucket':ref('Content'),'PolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[get('Content','Arn'),sub('${Content.Arn}/*')],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}}},
'Entitlements':{'Type':'AWS::DynamoDB::Table','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'BillingMode':'PAY_PER_REQUEST','AttributeDefinitions':[{'AttributeName':'pk','AttributeType':'S'},{'AttributeName':'sk','AttributeType':'S'}],'KeySchema':[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}],'SSESpecification':{'SSEEnabled':True},'PointInTimeRecoverySpecification':{'PointInTimeRecoveryEnabled':True}}},
'Logs':{'Type':'AWS::Logs::LogGroup','Properties':{'LogGroupName':sub('/aws/lambda/${AWS::StackName}-api'),'RetentionInDays':14}},
'Role':{'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'PremiumOnly','PolicyDocument':{'Version':'2012-10-17','Statement':[
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:Query'],'Resource':get('Entitlements','Arn')},
 {'Effect':'Allow','Action':'s3:GetObject','Resource':sub('${Content.Arn}/*')},
 {'Effect':'Allow','Action':'secretsmanager:GetSecretValue','Resource':ref('StripeSecretArn')},
 {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('${Logs.Arn}:*')}]}}]}},
'Function':{'Type':'AWS::Lambda::Function','DependsOn':'Logs','Properties':{'FunctionName':sub('${AWS::StackName}-api'),'Runtime':'python3.12','Handler':'index.handler','Role':get('Role','Arn'),'MemorySize':256,'Timeout':29,'Environment':{'Variables':{'ENTITLEMENTS_TABLE':ref('Entitlements'),'CONTENT_BUCKET':ref('Content'),'STRIPE_SECRET_ARN':ref('StripeSecretArn'),'PRICE_ID':ref('PriceId'),'PRIMARY_ORIGIN':ref('PrimaryOrigin'),'SALES_ENABLED':ref('SalesEnabled'),'LIVE_MODE':ref('LiveMode')}},'Code':{'ZipFile':(r/'premium.py').read_text()}}},
'Api':{'Type':'AWS::ApiGatewayV2::Api','Properties':{'Name':sub('${AWS::StackName}-api'),'ProtocolType':'HTTP','CorsConfiguration':{'AllowOrigins':[ref('PrimaryOrigin')],'AllowMethods':['GET','POST','OPTIONS'],'AllowHeaders':['authorization','content-type'],'MaxAge':60}}},
'Authorizer':{'Type':'AWS::ApiGatewayV2::Authorizer','Properties':{'ApiId':ref('Api'),'AuthorizerType':'JWT','Name':'LinformStudents','IdentitySource':['$request.header.Authorization'],'JwtConfiguration':{'Audience':[ref('ClientId')],'Issuer':sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPoolId}')}}},
'Integration':{'Type':'AWS::ApiGatewayV2::Integration','Properties':{'ApiId':ref('Api'),'IntegrationType':'AWS_PROXY','IntegrationUri':get('Function','Arn'),'PayloadFormatVersion':'2.0'}},
'Stage':{'Type':'AWS::ApiGatewayV2::Stage','Properties':{'ApiId':ref('Api'),'StageName':'$default','AutoDeploy':True,'DefaultRouteSettings':{'ThrottlingBurstLimit':10,'ThrottlingRateLimit':3},'RouteSettings':{'POST /premium/checkout':{'ThrottlingBurstLimit':2,'ThrottlingRateLimit':1}}}},
'Permission':{'Type':'AWS::Lambda::Permission','Properties':{'FunctionName':ref('Function'),'Action':'lambda:InvokeFunction','Principal':'apigateway.amazonaws.com','SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*/*/*')}}}
for i,route in enumerate(['GET /premium/access','POST /premium/checkout','GET /premium/catalog','GET /premium/content/{id}','POST /stripe/webhook','POST /premium/mentoring']):
 p={'ApiId':ref('Api'),'RouteKey':route,'Target':sub('integrations/${Integration}')}
 if 'webhook' not in route:p.update({'AuthorizationType':'JWT','AuthorizerId':ref('Authorizer'),'AuthorizationScopes':['openid']})
 resources['Route'+str(i)]={'Type':'AWS::ApiGatewayV2::Route','Properties':p}
template={'AWSTemplateFormatVersion':'2010-09-09','Description':'Linform Premium purchase authorization and private content; separate from existing student accounts. Sales disabled by default. Creates billable AWS resources.','Parameters':{
'StripeSecretArn':{'Type':'String','AllowedPattern':'arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+'},
'PriceId':{'Type':'String','Default':'price_1UWiNeR3GqiWlMaKPqUEeA9Q','AllowedPattern':'price_[a-zA-Z0-9]+'},
'UserPoolId':{'Type':'String','Default':'us-east-2_enXS1Mre0','AllowedPattern':'us-east-2_[a-zA-Z0-9]+'},
'ClientId':{'Type':'String','Default':'74d5juhq61h28f2fc086jlgq5o','AllowedPattern':'[a-zA-Z0-9]+'},
'PrimaryOrigin':{'Type':'String','Default':'https://linformcloud.com','AllowedPattern':'https://[a-z0-9.-]+'},
'LiveMode':{'Type':'String','Default':'false','AllowedValues':['true','false']},
'SalesEnabled':{'Type':'String','Default':'false','AllowedValues':['true','false']}},'Resources':resources,'Outputs':{'PremiumApiUrl':{'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com')},'WebhookUrl':{'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/stripe/webhook')},'ContentBucket':{'Value':ref('Content')}}}
(r/'premium.template.json').write_text(json.dumps(template,indent=2)+'\n')
