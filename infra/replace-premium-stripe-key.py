"""Validate a complete restricted Stripe key before replacing the saved key.
Run in the Linform owner's AWS CloudShell. Never prints keys or raw provider errors.
"""
import getpass
import json
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

def normalize(key):
    value=key.strip() if isinstance(key,str) else ''
    if len(value)>1 and value[0]==value[-1] and value[0] in ("'",'"'):value=value[1:-1].strip()
    return value

def validate(key):
    if not isinstance(key,str) or not key.startswith('rk_live_'):
        if isinstance(key,str) and key.startswith(('python','curl')):raise KeyCheckError('A command was entered at the key prompt. Paste the key copied from Stripe at this prompt.')
        raise KeyCheckError('The key must be the live restricted key copied from Stripe (rk_live_ prefix).')
    if not key.isascii() or any(ord(c)<33 or ord(c)>126 for c in key):raise KeyCheckError('The copied value contains whitespace or non-ASCII formatting. Use Stripe’s Copy button.')
    # Do not guess the credential length or tail alphabet. Stripe validates it.
    price=read_stripe('/v1/prices/'+PRICE+'?expand[]=product',key)
    if not (price.get('livemode') is True and price.get('unit_amount')==1500 and price.get('currency')=='usd' and price.get('type')=='one_time'):raise KeyCheckError('The expected live $15 USD one-time price was not verified. Nothing was saved.')
    read_stripe('/v1/checkout/sessions?limit=1',key)

def main(manager=None,validator=validate,prompt=getpass.getpass):
    if manager is None:
        if boto3.client('sts',region_name=REGION).get_caller_identity()['Account']!='461729034360':raise KeyCheckError('Use the Linform AWS account.')
        manager=boto3.client('secretsmanager',region_name=REGION)
    data=json.loads(manager.get_secret_value(SecretId=SECRET)['SecretString'])
    old=data.get('api_key','');clean=normalize(old)
    try:
        validator(clean)
        if clean!=old:
            data['api_key']=clean;manager.put_secret_value(SecretId=SECRET,SecretString=json.dumps(data))
        print('Stored API key verified. Premium price and Checkout reads: OK.');return
    except KeyCheckError as error:print('Stored key check: '+str(error))
    print('NEXT: Open Stripe API keys and use the Copy button for your live restricted key.')
    print('Paste that copied KEY at the prompt below, then press Enter. No characters will appear.')
    key=normalize(prompt('Paste the Stripe key here (hidden): '))
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
