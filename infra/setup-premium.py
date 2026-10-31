"""Run from the PRIVATE release ZIP in AWS CloudShell (Ohio). Never paste keys in ChatGPT/GitHub."""
import getpass,json,subprocess
from pathlib import Path
import boto3
r=Path(__file__).resolve().parents[1]
assert (r/'private-content/catalog.json').is_file(),'Use the private release ZIP, not the public repository; paid content must stay private.'
print('Creates a separate Premium stack in us-east-2. Existing student accounts are preserved. Sales stay CLOSED.')
print('A restricted Stripe key is stored in AWS Secrets Manager, never in this folder or GitHub.')
mode=input('Environment (test/live): ').strip()
assert mode in ('test','live')
price=input('Stripe $15 USD one-time Price ID: ').strip()
assert price.startswith('price_') and price[6:].isalnum()
key=getpass.getpass('Restricted Stripe API key (hidden): ')
assert key.startswith('rk_'+mode+'_'),'Use an environment-matched restricted key.'
secret=boto3.client('secretsmanager',region_name='us-east-2')
name='linform-premium-'+mode
values=json.dumps({'api_key':key,'webhook_secret':'not-configured'})
try:arn=secret.create_secret(Name=name,SecretString=values)['ARN']
except secret.exceptions.ResourceExistsException:arn=secret.update_secret(SecretId=name,SecretString=values)['ARN']
stack='linform-premium-'+mode
subprocess.run(['aws','cloudformation','deploy','--region','us-east-2','--template-file',str(r/'infra/premium.template.json'),'--stack-name',stack,'--capabilities','CAPABILITY_IAM','--parameter-overrides','StripeSecretArn='+arn,'PriceId='+price,'LiveMode='+str(mode=='live').lower(),'SalesEnabled=false'],check=True)
cf=boto3.client('cloudformation',region_name='us-east-2');outputs={x['OutputKey']:x['OutputValue'] for x in cf.describe_stacks(StackName=stack)['Stacks'][0]['Outputs']}
s3=boto3.client('s3',region_name='us-east-2')
for file in (r/'private-content').rglob('*.json'):
 s3.upload_file(str(file),outputs['ContentBucket'],file.relative_to(r/'private-content').as_posix(),ExtraArgs={'ContentType':'application/json','CacheControl':'private,no-store','ServerSideEncryption':'AES256'})
print('Create a Stripe webhook destination with API version 2026-09-30.endive at: '+outputs['WebhookUrl'])
print('Events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, charge.refunded, charge.dispute.created, charge.dispute.closed')
wh=getpass.getpass('Webhook signing secret for that destination (hidden): ')
assert wh.startswith('whsec_')
secret.put_secret_value(SecretId=arn,SecretString=json.dumps({'api_key':key,'webhook_secret':wh}))
print(json.dumps({'PremiumApiUrl':outputs['PremiumApiUrl'],'StackName':stack,'SalesEnabled':False},indent=2))
print('Return the PremiumApiUrl only to configure the website. Do not share keys. Complete sandbox tests and content review before activating live sales.')
