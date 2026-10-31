"""Isolated, no-real-money Premium payment/access checks in the owner's AWS account.
Uses a separate Stripe sandbox, AWS stack, secret, order table and fixture-only content.
Admin Lambda invocations use synthetic claims to test backend ownership; they do not
replace the public API's Cognito JWT checks. Never grants live Premium access.
"""
import argparse
import getpass
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid
import boto3

REGION='us-east-2'
STACK='linform-premium-sandbox-check'
SECRET='linform-premium-sandbox-check'
LIVE_STACK='linform-premium-live-v2'
ORIGIN='https://linformcloud.com'
STATE=Path('linform-sandbox-check.json')
SOURCE='https://raw.githubusercontent.com/espinozaalexis2003-eng/Linform/12077e39afa9c9d735dae0e78fed8d914de20516/infra/premium.template.json'
class CheckError(Exception):pass

def client(name):return boto3.client(name,region_name=REGION)
def save(state):STATE.write_text(json.dumps(state,indent=2)+'\n')
def load():
    value=json.loads(STATE.read_text())
    if value.get('stack')!=STACK:raise CheckError('Unexpected test state.')
    return value

def stripe(path,key,params=None):
    import urllib.parse
    req=urllib.request.Request('https://api.stripe.com'+path,data=None if params is None else urllib.parse.urlencode(params).encode(),headers={'Authorization':'Bearer '+key,'Stripe-Version':'2026-09-30.endive','Content-Type':'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
    except urllib.error.HTTPError as error:raise CheckError('Stripe check failed: HTTP '+str(error.code)+'. No key or provider error was printed.') from None

def stored():return json.loads(client('secretsmanager').get_secret_value(SecretId=SECRET)['SecretString'])
def function(stack):return client('cloudformation').describe_stack_resource(StackName=stack,LogicalResourceId='Function')['StackResourceDetail']['PhysicalResourceId']
def invoke(stack,method,path,subject,query=None):
    event={'rawPath':path,'headers':{'origin':ORIGIN},'body':'{}','requestContext':{'http':{'method':method},'authorizer':{'jwt':{'claims':{'sub':subject,'token_use':'access'}}}}}
    if query:event['queryStringParameters']=query
    response=client('lambda').invoke(FunctionName=function(stack),Payload=json.dumps(event).encode())
    result=json.loads(response['Payload'].read())
    if response.get('FunctionError'):raise CheckError('The test Lambda returned an execution error.')
    return result['statusCode'],json.loads(result['body'])

def setup(price_id):
    if STATE.exists():raise CheckError('Sandbox state already exists. Continue with start/verify, or clean up before a new setup.')
    if not price_id or not price_id.startswith('price_'):raise CheckError('Pass the sandbox Price ID with --price-id.')
    key=getpass.getpass('Stripe SANDBOX restricted key (hidden; rk_test_): ').strip()
    if not key.startswith('rk_test_'):raise CheckError('Use a restricted TEST key. Live keys are not accepted here.')
    price=stripe('/v1/prices/'+price_id+'?expand[]=product',key)
    if not (price.get('livemode') is False and price.get('unit_amount')==1500 and price.get('currency')=='usd' and price.get('type')=='one_time' and price.get('active') and price.get('product',{}).get('active')):raise CheckError('An active sandbox $15 USD one-time Price is required.')
    stripe('/v1/checkout/sessions?limit=1',key)
    secret=client('secretsmanager');value=json.dumps({'api_key':key,'webhook_secret':'not-configured'})
    try:arn=secret.create_secret(Name=SECRET,SecretString=value)['ARN']
    except secret.exceptions.ResourceExistsException:arn=secret.update_secret(SecretId=SECRET,SecretString=value)['ARN']
    with urllib.request.urlopen(SOURCE,timeout=20) as response:template=json.load(response)
    for name in ('Content','Entitlements'):
        template['Resources'][name].pop('DeletionPolicy',None);template['Resources'][name].pop('UpdateReplacePolicy',None)
    template['Resources']['Content']['Properties'].pop('VersioningConfiguration',None)
    # Sandbox redirects must not send test session IDs to the live Premium API.
    code=template['Resources']['Function']['Properties']['Code']['ZipFile']
    old_return="ORIGIN+'/?premium_session={CHECKOUT_SESSION_ID}#premium'"
    old_result="return respond(200,{'url':url})"
    if old_return not in code or old_result not in code:raise CheckError('Unexpected test source shape; no checkout was opened.')
    code=code.replace(old_return,"ORIGIN+'/#premium'").replace(old_result,"return respond(200,{'url':url,'sessionId':session['id']})")
    template['Resources']['Function']['Properties']['Code']['ZipFile']=code
    template['Description']='Disposable Linform sandbox payment checks. No paid guides or live payments.'
    path=Path('infra/premium-sandbox-check.template.json');path.write_text(json.dumps(template,indent=2))
    print('Deploying isolated test resources. Normal AWS usage charges apply; Stripe payments are simulated.',flush=True)
    result=subprocess.run(['aws','cloudformation','deploy','--region',REGION,'--stack-name',STACK,'--template-file',str(path),'--capabilities','CAPABILITY_IAM','--parameter-overrides','StripeSecretArn='+arn,'PriceId='+price_id,'LiveMode=false','SalesEnabled=true'])
    if result.returncode:raise CheckError('Test deployment failed; inspect events for '+STACK+'.')
    outputs={x['OutputKey']:x['OutputValue'] for x in client('cloudformation').describe_stacks(StackName=STACK)['Stacks'][0]['Outputs']}
    fixture={'id':'sandbox-fixture','kind':'guide','exam':'Sandbox only','title':'Sandbox access fixture','revision':'Test data','intro':'No paid content is stored here.','studyPlan':['Test payment and ownership.'],'chapters':[{'id':'premium-sandbox-fixture','title':'Access check','domain':'Test','explanation':'This is a fixture, not a Premium study guide.','practice':'Verify access boundaries.','pitfall':'Never treat a test payment as a live entitlement.','checkpoint':{'question':'Can this grant live Premium access?','answer':'No.'},'reference':'https://docs.stripe.com/testing/overview'}]}
    catalog={'version':'sandbox-check','notice':'Test fixture only; no live Premium access.','items':[{'id':'sandbox-fixture','kind':'guide','exam':'Sandbox','title':'Sandbox access fixture','description':'No paid content.'}]}
    for key_name,data in [('catalog.json',catalog),('content/sandbox-fixture.json',fixture)]:client('s3').put_object(Bucket=outputs['ContentBucket'],Key=key_name,Body=json.dumps(data).encode(),ContentType='application/json',CacheControl='private,no-store',ServerSideEncryption='AES256')
    state={'stack':STACK,'price':price_id,'subjectA':'qa-'+str(uuid.uuid4()),'subjectB':'qa-'+str(uuid.uuid4()),'outputs':outputs,'paid_check_passed':False,'refund_check_passed':False};save(state)
    print(json.dumps({'SandboxApiUrl':outputs['PremiumApiUrl'],'SandboxWebhookUrl':outputs['WebhookUrl']},indent=2))
    print('Share these test URLs only. The sandbox signing secret is configured in the start step.')

def start():
    state=load();secret=client('secretsmanager');data=stored()
    if state.get('sessionId'):print('An existing sandbox session is saved. Complete it, then run verify.');print(state['checkoutUrl']);return
    signing=getpass.getpass('SANDBOX webhook signing secret (hidden; whsec_): ').strip()
    if not signing.startswith('whsec_'):raise CheckError('Use the signing secret from this sandbox endpoint.')
    data['webhook_secret']=signing;secret.put_secret_value(SecretId=SECRET,SecretString=json.dumps(data))
    code,response=invoke(STACK,'POST','/premium/checkout',state['subjectA'])
    if code!=200:raise CheckError('Sandbox checkout creation failed: HTTP '+str(code))
    from urllib.parse import urlparse
    url=response['url'];session_id=response.get('sessionId','')
    if urlparse(url).netloc!='checkout.stripe.com' or not session_id.startswith('cs_test_'):raise CheckError('Expected a Stripe TEST Checkout Session; stopping.')
    state.update({'sessionId':session_id,'checkoutUrl':url});save(state)
    print(json.dumps({'SandboxCheckoutUrl':url},indent=2))
    print('Use a Stripe test card only. A return to the live site does not grant live Premium access. Then run verify.')

def verify(refund=False):
    state=load();session_id=state.get('sessionId')
    if not session_id:raise CheckError('Create the sandbox Checkout Session first with start.')
    session=stripe('/v1/checkout/sessions/'+session_id+'?expand[]=payment_intent.latest_charge',stored()['api_key'])
    if session.get('livemode') is not False or session.get('client_reference_id')!=state['subjectA']:raise CheckError('Unexpected sandbox session owner or environment.')
    if session.get('payment_status')!='paid':raise CheckError('The sandbox payment is not complete yet.')
    if refund:
        if not state.get('paid_check_passed'):raise CheckError('Run the successful-payment verification before the refund check.')
        charge=session.get('payment_intent',{}).get('latest_charge',{})
        if not (charge.get('refunded') or charge.get('amount_refunded',0)>0):raise CheckError('Stripe has not recorded a sandbox refund yet.')
        code,access=invoke(STACK,'GET','/premium/access',state['subjectA']);denied,_=invoke(STACK,'GET','/premium/catalog',state['subjectA'])
        if code!=200 or access.get('purchased') is not False or denied!=403:raise CheckError('Refund-revocation check failed.')
        state['refund_check_passed']=True;save(state);print('PASS: refunded sandbox purchase loses access.');return
    code,access=invoke(STACK,'GET','/premium/access',state['subjectA'],{'session_id':session_id})
    if code!=200 or access.get('purchased') is not True:raise CheckError('Purchaser access check failed.')
    code,catalog=invoke(STACK,'GET','/premium/catalog',state['subjectA'])
    if code!=200 or [x['id'] for x in catalog.get('items',[])]!=['sandbox-fixture']:raise CheckError('Fixture-only catalog access failed.')
    code,other=invoke(STACK,'GET','/premium/access',state['subjectB'],{'session_id':session_id});denied,_=invoke(STACK,'GET','/premium/catalog',state['subjectB'])
    if code!=200 or other.get('purchased') is not False or denied!=403:raise CheckError('Non-purchaser isolation check failed.')
    code,live=invoke(LIVE_STACK,'GET','/premium/access',state['subjectA']);live_denied,_=invoke(LIVE_STACK,'GET','/premium/catalog',state['subjectA'])
    if code!=200 or live.get('purchased') is not False or live_denied!=403:raise CheckError('Live/test isolation check failed.')
    intent=session.get('payment_intent',{}).get('id');state.update({'paid_check_passed':True,'paymentIntent':intent});save(state)
    print(json.dumps({'purchaser_unlocks_test_fixture':True,'other_account_denied':True,'test_purchase_does_not_unlock_live':True,'SandboxPaymentIntent':intent},indent=2))
    print('Share this result only. After a sandbox refund, run refund-check.')

def cleanup():
    state=load();bucket=state['outputs']['ContentBucket'];actual={x['OutputKey']:x['OutputValue'] for x in client('cloudformation').describe_stacks(StackName=STACK)['Stacks'][0]['Outputs']}
    if actual['ContentBucket']!=bucket:raise CheckError('Unexpected sandbox bucket; nothing deleted.')
    # Only the two known test fixture keys are deleted. No live resources or guides.
    client('s3').delete_objects(Bucket=bucket,Delete={'Objects':[{'Key':'catalog.json'},{'Key':'content/sandbox-fixture.json'}]})
    client('cloudformation').delete_stack(StackName=STACK);client('cloudformation').get_waiter('stack_delete_complete').wait(StackName=STACK)
    client('secretsmanager').delete_secret(SecretId=SECRET,RecoveryWindowInDays=7)
    print('Sandbox AWS stack removed; sandbox secret scheduled for recoverable deletion. Live resources unchanged.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['setup','start','verify','refund-check','cleanup']);parser.add_argument('--price-id');args=parser.parse_args()
    try:
        if client('sts').get_caller_identity()['Account']!='461729034360':raise CheckError('Use the Linform AWS account.')
        if args.action=='setup':setup(args.price_id)
        elif args.action=='start':start()
        elif args.action=='cleanup':cleanup()
        else:verify(args.action=='refund-check')
    except CheckError as error:raise SystemExit(str(error))
