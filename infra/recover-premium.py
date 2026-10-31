"""Recover the initial Linform Premium stage-ordering failure in AWS CloudShell.
Reuses the existing Secrets Manager entry; never prints or asks for API keys.
Creates a separate recovery stack and keeps live sales disabled.
"""
import json
from pathlib import Path
import subprocess
import boto3

REGION='us-east-2'
STACK='linform-premium-live-v2'
ROOT=Path(__file__).resolve().parents[1]
content=ROOT/'private-content'
assert (content/'catalog.json').is_file(),'Run this from your extracted private Linform-Premium-Setup folder.'
account=boto3.client('sts',region_name=REGION).get_caller_identity()['Account']
assert account=='461729034360','This recovery is intended for the Linform AWS account.'
path=ROOT/'infra/premium.template.json'
template=json.loads(path.read_text())
resources=template['Resources']
resources['Stage']['DependsOn']=[key for key,value in resources.items() if value['Type']=='AWS::ApiGatewayV2::Route']
path.write_text(json.dumps(template,indent=2)+'\n')
print('Fixed API stage ordering. Preparing '+STACK+'; checkout stays closed.',flush=True)
secret_arn=boto3.client('secretsmanager',region_name=REGION).describe_secret(SecretId='linform-premium-live')['ARN']
result=subprocess.run(['aws','cloudformation','deploy','--region',REGION,'--template-file',str(path),'--stack-name',STACK,'--capabilities','CAPABILITY_IAM','--parameter-overrides','StripeSecretArn='+secret_arn,'PriceId=price_1UWiNeR3GqiWlMaKPqUEeA9Q','LiveMode=true','SalesEnabled=false'])
if result.returncode:raise SystemExit('Deployment failed. Share the AWS error above this line, or inspect events for '+STACK+'.')
cf=boto3.client('cloudformation',region_name=REGION)
outputs={x['OutputKey']:x['OutputValue'] for x in cf.describe_stacks(StackName=STACK)['Stacks'][0]['Outputs']}
s3=boto3.client('s3',region_name=REGION)
files=list(content.rglob('*.json'))
for file in files:s3.upload_file(str(file),outputs['ContentBucket'],file.relative_to(content).as_posix(),ExtraArgs={'ContentType':'application/json','CacheControl':'private,no-store','ServerSideEncryption':'AES256'})
print('Private Premium files uploaded:',len(files))
print(json.dumps({'StackName':STACK,'PremiumApiUrl':outputs['PremiumApiUrl'],'WebhookUrl':outputs['WebhookUrl'],'SalesEnabled':False},indent=2))
print('Send only these output URLs to continue webhook setup. Do not share any API keys.')
