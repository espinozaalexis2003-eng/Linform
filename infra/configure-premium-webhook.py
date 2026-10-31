"""Finish Linform's live webhook configuration from AWS CloudShell.
The signing secret is entered through getpass, then stored only in Secrets Manager.
"""
import getpass
import json
import urllib.error
import urllib.request
import boto3

REGION='us-east-2'
SECRET='linform-premium-live'
PRICE='price_1UWiNeR3GqiWlMaKPqUEeA9Q'
ENDPOINT='https://le0sa6j8m0.execute-api.us-east-2.amazonaws.com/stripe/webhook'
assert boto3.client('sts',region_name=REGION).get_caller_identity()['Account']=='461729034360','Use the Linform AWS account.'
manager=boto3.client('secretsmanager',region_name=REGION)
data=json.loads(manager.get_secret_value(SecretId=SECRET)['SecretString'])
assert isinstance(data.get('api_key'),str),'The saved Stripe API key is missing.'
print('Use the signing secret for this live Stripe webhook destination:')
print(ENDPOINT)
value=getpass.getpass('Webhook signing secret (hidden; starts with whsec_): ').strip()
if not value.startswith('whsec_') or len(value)<20:raise SystemExit('Invalid signing-secret format. Nothing was changed.')
data['webhook_secret']=value
manager.put_secret_value(SecretId=SECRET,SecretString=json.dumps(data))
print('Webhook signing secret saved securely. No API key was changed.')
for label,path in [('Premium price','/v1/prices/'+PRICE+'?expand[]=product'),('Checkout read permission','/v1/checkout/sessions?limit=1')]:
    request=urllib.request.Request('https://api.stripe.com'+path,headers={'Authorization':'Bearer '+data['api_key'],'Stripe-Version':'2026-09-30.endive'})
    try:
        with urllib.request.urlopen(request,timeout=15) as response:result=json.load(response)
    except urllib.error.HTTPError as error:
        print(label+': HTTP '+str(error.code)+'. Share this status only; do not share any keys.')
        continue
    if label=='Premium price':
        matches=result.get('currency')=='usd' and result.get('unit_amount')==1500 and result.get('type')=='one_time' and result.get('livemode') is True
        print('Premium price: '+('verified $15 USD one-time, live' if matches else 'unexpected price configuration; keep sales closed'))
    else:print(label+': OK')
print('Webhook setup saved. Checkout remains closed pending payment and access testing.')
