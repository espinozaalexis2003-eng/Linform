"""Validate a complete restricted Stripe key before replacing the saved key.
Run in the Linform owner's AWS CloudShell. Never prints keys or raw provider errors.
"""
import getpass
import json
import re
import urllib.error
import urllib.request
import boto3

PRICE='price_1UWiNeR3GqiWlMaKPqUEeA9Q'
SECRET='linform-premium-live'
REGION='us-east-2'

class KeyCheckError(Exception):
    pass

def read_stripe(path,key):
    req=urllib.request.Request('https://api.stripe.com'+path,headers={'Authorization':'Bearer '+key,'Stripe-Version':'2026-09-30.endive'})
    try:
        with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
    except urllib.error.HTTPError as error:
        # Provider error messages may contain key fragments; never display them.
        meanings={401:'Stripe rejected the key; check the complete key value and whether it is active',403:'the key needs permission for this API',404:'the configured Price is not available to this account'}
        raise KeyCheckError('HTTP '+str(error.code)+': '+meanings.get(error.code,'Stripe could not complete the check')) from None
    except (OSError,ValueError):raise KeyCheckError('Could not reach Stripe or read its response. Nothing was saved.') from None

def validate(key):
    if not isinstance(key,str) or not re.fullmatch(r'rk_live_[A-Za-z0-9_]{24,}',key):raise KeyCheckError('Use the COMPLETE live restricted key, not a masked preview or key ID.')
    price=read_stripe('/v1/prices/'+PRICE+'?expand[]=product',key)
    if not (price.get('livemode') is True and price.get('unit_amount')==1500 and price.get('currency')=='usd' and price.get('type')=='one_time'):raise KeyCheckError('The expected live $15 USD one-time price was not verified. Nothing was saved.')
    read_stripe('/v1/checkout/sessions?limit=1',key)

def main(manager=None,validator=validate,prompt=getpass.getpass):
    if manager is None:
        if boto3.client('sts',region_name=REGION).get_caller_identity()['Account']!='461729034360':raise KeyCheckError('Use the Linform AWS account.')
        manager=boto3.client('secretsmanager',region_name=REGION)
    data=json.loads(manager.get_secret_value(SecretId=SECRET)['SecretString'])
    old=data.get('api_key','');clean=old.strip() if isinstance(old,str) else ''
    try:
        validator(clean)
        if clean!=old:
            data['api_key']=clean;manager.put_secret_value(SecretId=SECRET,SecretString=json.dumps(data))
        print('Stored API key verified. Premium price and Checkout reads: OK.');return
    except KeyCheckError as error:print('Stored key check: '+str(error))
    print('Paste the COMPLETE active live restricted key from Stripe. Input stays hidden.')
    key=prompt('Replacement restricted Stripe key (hidden): ').strip()
    validator(key)
    data['api_key']=key
    manager.put_secret_value(SecretId=SECRET,SecretString=json.dumps(data))
    print('New restricted API key verified and saved securely.')
    print('Premium price: verified $15 USD one-time, live')
    print('Checkout read permission: OK')
    print('Your webhook signing secret was preserved. Checkout remains closed.')

if __name__=='__main__':
    try:main()
    except KeyCheckError as error:raise SystemExit(str(error)+' No replacement key was saved.')
