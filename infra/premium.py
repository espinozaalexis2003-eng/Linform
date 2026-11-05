"""Linform Premium. API Gateway verifies Cognito JWTs before authenticated routes.
Only verified Stripe events/reconciliation grant access. Content stays in private S3.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import string
import time
import urllib.parse
import urllib.request
import boto3

ORIGIN=os.environ.get('PRIMARY_ORIGIN','https://linformcloud.com')
PRICE=os.environ.get('PRICE_ID','')
LIVE=os.environ.get('LIVE_MODE','false')=='true'
BUNDLE='linform-premium-v1'
table=boto3.resource('dynamodb').Table(os.environ['ENTITLEMENTS_TABLE'])
s3=boto3.client('s3')
secret_store=boto3.client('secretsmanager')
SUB=re.compile(r'[a-zA-Z0-9-]{1,128}\Z')
ID=re.compile(r'[a-z][a-z0-9-]{0,79}\Z')

# Prices identify the purchased offer; the original PRICE remains valid for legacy buyers.
TIERS = {
 'digital': {'price': 'price_1UYXmgR3GqiWlMaKNVW7qXpn' if LIVE else 'price_1UYXrcJ6R4GUUH3bbGsZ7dwk', 'amount': 1500, 'bundle': 'linform-digital-v2'},
 'mentorship': {'price': 'price_1UYXmmR3GqiWlMaKkZ50VQEZ' if LIVE else 'price_1UYXrgJ6R4GUUH3b4B9psAut', 'amount': 6000, 'bundle': 'linform-mentorship-v2'},
}
# Linform owner access v1
def owner_access(subject):
    configured = os.environ.get('LINFORM_OWNER_SUB', '')
    return bool(isinstance(subject, str) and SUB.fullmatch(subject) and configured and hmac.compare_digest(configured, subject))

def has_premium_access(client, subject):
    return owner_access(subject) or entitled(client, subject)



def respond(code,value):
    return {'statusCode':code,'headers':{'content-type':'application/json','cache-control':'private, no-store, max-age=0','pragma':'no-cache','x-content-type-options':'nosniff'},'body':json.dumps(value)}

def secret_values():
    # Fetch per invocation so rotations take effect without redeploying functions.
    return json.loads(secret_store.get_secret_value(SecretId=os.environ['STRIPE_SECRET_ARN'])['SecretString'])

class StripeGateway:
    def __init__(self,key):self.key=key
    def request(self,path,params=None):
        if not path.startswith('/v1/'):raise ValueError('Invalid Stripe path')
        data=urllib.parse.urlencode(params).encode() if params is not None else None
        req=urllib.request.Request('https://api.stripe.com'+path,data=data,headers={'Authorization':'Bearer '+self.key,'Stripe-Version':'2026-09-30.endive','Content-Type':'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req,timeout=10) as res:return json.load(res)

def signature_valid(raw,signature,signing_secret,now=None):
    try:
        values=[part.split('=',1) for part in signature.split(',')]
        stamp=next(v for k,v in values if k=='t')
        if abs((time.time() if now is None else now)-int(stamp))>300:return False
        digest=hmac.new(signing_secret.encode(),stamp.encode()+b'.'+raw,hashlib.sha256).hexdigest()
        return any(k=='v1' and hmac.compare_digest(digest,v) for k,v in values)
    except (ValueError,StopIteration,TypeError):return False

def order_items(subject):
    items=[];args={'KeyConditionExpression':'pk = :u AND begins_with(sk, :o)','ExpressionAttributeValues':{':u':'USER#'+subject,':o':'ORDER#'},'ConsistentRead':True}
    while True:
        result=table.query(**args);items.extend(result.get('Items',[]))
        if len(items)>1000:raise ValueError('Too many orders')
        if 'LastEvaluatedKey' not in result:return items
        args['ExclusiveStartKey']=result['LastEvaluatedKey']

def paid_order(client,session_id,expected_subject=None):
    if not re.fullmatch(r'cs_[a-zA-Z0-9_]{1,240}',session_id):return None
    session=client.request('/v1/checkout/sessions/'+session_id+'?expand[]=payment_intent.latest_charge')
    subject=session.get('client_reference_id','')
    if not SUB.fullmatch(subject) or (expected_subject and subject!=expected_subject):return None
    if session.get('livemode') is not LIVE or session.get('mode')!='payment':return None
    lines=client.request('/v1/checkout/sessions/'+session_id+'/line_items?limit=2')
    rows=lines.get('data',[])
    if len(rows)!=1 or lines.get('has_more') or rows[0].get('quantity')!=1:return None
    price_id=rows[0].get('price',{}).get('id')
    bundle=session.get('metadata',{}).get('bundle')
    offer=next(((name,details) for name,details in TIERS.items() if price_id==details['price'] and bundle==details['bundle']),None)
    if price_id==PRICE and bundle==BUNDLE:tier,amount='legacy',1500
    elif offer:tier,amount=offer[0],offer[1]['amount']
    else:return None
    if session.get('currency')!='usd' or session.get('amount_subtotal')!=amount:return None
    intent=session.get('payment_intent')
    if not isinstance(intent,dict):return None
    charge=intent.get('latest_charge')
    if not isinstance(charge,dict):return None
    active=(session.get('payment_status')=='paid' and intent.get('status')=='succeeded' and charge.get('paid') is True and not charge.get('refunded') and not charge.get('disputed') and charge.get('amount_refunded',0)==0)
    row={'pk':'USER#'+subject,'sk':'ORDER#'+session_id,'sessionId':session_id,'paymentIntent':intent['id'],'active':active,'bundle':bundle,'tier':tier,'created':session.get('created',0)}
    table.put_item(Item=row)
    table.put_item(Item={'pk':'PAYMENT#'+intent['id'],'sk':'ORDER','subject':subject,'sessionId':session_id})
    return row

def purchase_rights(client,subject):
    if owner_access(subject):return {'digital':True,'personal':True,'legacy':False,'owner':True,'tier':'owner','supportScope':'OWNER'}
    active=[]
    for row in order_items(subject):
        current=paid_order(client,row['sessionId'],subject)
        if current and current['active']:active.append(current)
    legacy=any(row['tier']=='legacy' for row in active)
    mentorship=next((row for row in sorted(active,key=lambda row:row['created'],reverse=True) if row['tier']=='mentorship'),None)
    return {'digital':bool(active),'personal':legacy or bool(mentorship),'legacy':legacy,'owner':False,
            'tier':'legacy' if legacy else 'mentorship' if mentorship else 'digital' if active else 'none',
            'supportScope':'LEGACY' if legacy else mentorship['sessionId'] if mentorship else ''}

def entitled(client,subject):
    return purchase_rights(client,subject)['digital']

def ready(client,tier='digital'):
    if os.environ.get('SALES_ENABLED')!='true' or tier not in TIERS:return False
    offer=TIERS[tier]
    price=client.request('/v1/prices/'+offer['price']+'?expand[]=product')
    product=price.get('product',{})
    return bool(price.get('active') and price.get('livemode') is LIVE and price.get('type')=='one_time' and price.get('currency')=='usd' and price.get('unit_amount')==offer['amount'] and isinstance(product,dict) and product.get('active'))

def checkout_options(client):
    options={}
    for tier in TIERS:
        try:options[tier]=ready(client,tier)
        except Exception:options[tier]=False
    return options

def content_object(key):
    raw=s3.get_object(Bucket=os.environ['CONTENT_BUCKET'],Key=key)['Body'].read(1500001)
    if len(raw)>1500000:raise ValueError('Content too large')
    return json.loads(raw)

def webhook(event,client,signing_secret):
    body=event.get('body','')
    if not isinstance(body,str) or len(body)>1200000:return respond(400,{'error':'Invalid event'})
    try:raw=base64.b64decode(body,validate=True) if event.get('isBase64Encoded') else body.encode()
    except (ValueError,UnicodeError):return respond(400,{'error':'Invalid event'})
    headers={k.lower():v for k,v in event.get('headers',{}).items()}
    if not signature_valid(raw,headers.get('stripe-signature',''),signing_secret):return respond(400,{'error':'Invalid signature'})
    message=json.loads(raw)
    if message.get('livemode') is not LIVE:return respond(400,{'error':'Wrong environment'})
    kind=message.get('type');obj=message.get('data',{}).get('object',{})
    if kind in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'):
        paid_order(client,obj.get('id',''))
    elif kind in ('charge.refunded','charge.dispute.created','charge.dispute.closed'):
        intent=obj.get('payment_intent')
        if not intent and obj.get('charge'):
            charge=client.request('/v1/charges/'+urllib.parse.quote(obj['charge'],safe=''));intent=charge.get('payment_intent')
        if isinstance(intent,str):
            reverse=table.get_item(Key={'pk':'PAYMENT#'+intent,'sk':'ORDER'},ConsistentRead=True).get('Item')
            if reverse:paid_order(client,reverse['sessionId'],reverse['subject'])
    return respond(200,{'received':True})


# Linform support allowances v1. Only this helper block and save_mentoring are patched into live code.
def support_period(now=None):
    return time.strftime('%Y-%m', time.gmtime(time.time() if now is None else now))

def support_usage(subject, rights=None):
    rights = rights or {'personal':True,'legacy':True,'supportScope':'LEGACY'}
    period = support_period()
    prefix = 'SUPPORT#' if rights.get('legacy') else 'SUPPORT#BUNDLE#'+rights.get('supportScope','')+'#'
    suffix = '#'+period if rights.get('legacy') else ''
    def used(key):
        row = table.get_item(Key={'pk': 'USER#'+subject, 'sk': key}, ConsistentRead=True).get('Item') or {}
        return int(row.get('used', 0))
    return {'policyVersion': 2, 'mode': 'legacy-monthly' if rights.get('legacy') else 'bundle', 'month': period,
            'mentoringUsed': used(prefix+'MENTORING'+suffix),
            'customProjectUsed': used(prefix+'CUSTOM'+suffix),
            'resumeUsed': used(prefix+'RESUME')}

def support_kind(topic, message):
    # Preserve compatibility with the existing public request contract.
    if topic == 'learning-plan' and message.startswith('[Resume final revision]\n'):
        return 'resume-revision'
    if topic == 'learning-plan' and message.startswith('[Resume review]\n'):
        return 'resume-review'
    if topic == 'project-feedback' and message.startswith('[Custom project]\n'):
        return 'custom-project'
    return 'mentoring'

def save_support_request(subject, kind, row, rights=None):
    rights = rights or {'personal':True,'legacy':True,'supportScope':'LEGACY'}
    period = support_period(row['created'])
    prefix = 'SUPPORT#' if rights.get('legacy') else 'SUPPORT#BUNDLE#'+rights.get('supportScope','')+'#'
    category = 'RESUME' if kind.startswith('resume-') else 'CUSTOM' if kind == 'custom-project' else 'MENTORING'
    key = prefix+category+('#'+period if rights.get('legacy') and category!='RESUME' else '')
    current = table.get_item(Key={'pk': 'USER#'+subject, 'sk': key}, ConsistentRead=True).get('Item') or {}
    used = int(current.get('used', 0))
    if kind == 'resume-revision' and used == 0:
        return respond(409, {'error': 'Submit your initial resume review before the final revision.'})
    limit = 2 if kind == 'resume-revision' else 1
    if used >= limit:
        label = 'Your resume review and final revision have been used.' if kind == 'resume-revision' else 'Your initial resume review has been requested; use the final revision option after receiving feedback.' if kind == 'resume-review' else 'Your custom-project request allowance has been used.' if kind == 'custom-project' else 'Your mentorship request allowance has been used.'
        return respond(429, {'error': label})
    marker = {'pk': 'USER#'+subject, 'sk': key, 'used': used+1, 'policyVersion': 1,
              'lastRequestId': row['requestId'], 'created': row['created']}
    def encode(item):
        return {key: ({'BOOL': value} if isinstance(value, bool) else {'N': str(value)} if isinstance(value, int) else {'S': value}) for key, value in item.items()}
    quota = {'TableName': os.environ['ENTITLEMENTS_TABLE'], 'Item': encode(marker),
             'ConditionExpression': '#used = :expected' if current else 'attribute_not_exists(pk)',
             **({'ExpressionAttributeNames': {'#used': 'used'}, 'ExpressionAttributeValues': {':expected': {'N': str(used)}}} if current else {})}
    row['supportKind'] = kind
    try:
        # Two conditional puts consume the allowance and save the request atomically.
        # Existing table-scoped PutItem permission covers both transactional puts.
        boto3.client('dynamodb').transact_write_items(TransactItems=[
            {'Put': quota},
            {'Put': {'TableName': os.environ['ENTITLEMENTS_TABLE'], 'Item': encode(row), 'ConditionExpression': 'attribute_not_exists(pk)'}}
        ])
    except Exception as error:
        response = getattr(error, 'response', {})
        reasons = response.get('CancellationReasons', [])
        if response.get('Error', {}).get('Code') == 'TransactionCanceledException' and any(reason.get('Code') == 'ConditionalCheckFailed' for reason in reasons):
            return respond(429, {'error': 'Another request used this allowance. Refresh Premium to see your remaining support.'})
        raise
    return respond(201, {'requestId': row['requestId'], 'status': 'requested', 'support': support_usage(subject, rights),
                         'message': 'Saved for Alexis. Reply timing and availability are confirmed individually.'})

def save_mentoring(event, client, subject):
    headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
    if headers.get('origin') != ORIGIN:
        return respond(403, {'error': 'Invalid origin'})
    rights = purchase_rights(client, subject)
    if not rights['personal']:
        return respond(403, {'error': 'A verified personal-support bundle or legacy membership is required'})
    raw = event.get('body', '')
    if not isinstance(raw, str) or len(raw) > 16000:
        return respond(400, {'error': 'Invalid mentoring request'})
    try:
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw, validate=True).decode('utf-8')
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        return respond(400, {'error': 'Invalid mentoring request'})
    fields = {'topic', 'message', 'replyEmail', 'projectUrl', 'consent'}
    if not isinstance(data, dict) or set(data) != fields or data.get('consent') is not True:
        return respond(400, {'error': 'Consent and request fields are required'})
    if data.get('topic') not in ('study-question', 'project-feedback', 'learning-plan'):
        return respond(400, {'error': 'Choose a mentoring topic'})
    message, email, url = data.get('message'), data.get('replyEmail'), data.get('projectUrl')
    if not isinstance(message, str) or not 20 <= len(message.strip()) <= 3000:
        return respond(400, {'error': 'Use 20 to 3000 characters for your question'})
    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        return respond(400, {'error': 'Enter a reply email'})
    if not isinstance(url, str) or len(url) > 300 or (url and not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+', url)):
        return respond(400, {'error': 'Use an optional public GitHub repository URL'})
    now = int(time.time())
    request_id = str(now)+'-'+secrets.token_hex(8)
    row = {'pk': 'USER#'+subject, 'sk': 'MENTOR#'+request_id, 'requestId': request_id, 'created': now,
           'status': 'requested', 'topic': data['topic'], 'message': message.strip(),
           'replyEmail': email, 'projectUrl': url, 'consent': True}
    return save_support_request(subject, support_kind(data['topic'], message.strip()), row, rights)


def handler(event,context):
    path=event.get('rawPath','');method=event.get('requestContext',{}).get('http',{}).get('method')
    try:
        if path=='/stripe/webhook' and method=='POST':
            values=secret_values();return webhook(event,StripeGateway(values['api_key']),values['webhook_secret'])
        claims=event.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims',{})
        subject=claims.get('sub','')
        if not isinstance(subject,str) or not SUB.fullmatch(subject) or claims.get('token_use')!='access':return respond(401,{'error':'Sign in required'})
        values=secret_values();client=StripeGateway(values['api_key'])
        if path=='/premium/access' and method=='GET':
            # A return URL never grants access. Reconcile only a verified purchase
            # whose client_reference_id matches this authenticated student.
            session=(event.get('queryStringParameters') or {}).get('session_id')
            if session:paid_order(client,session,subject)
            rights=purchase_rights(client,subject)
            options=checkout_options(client)
            return respond(200,{'purchased':rights['digital'],'owner':rights['owner'],'tierPolicyVersion':2,'tier':rights['tier'],'supportAccess':rights['personal'],'legacyBenefits':rights['legacy'],'checkoutOptions':options,'checkoutReady':False,'amount':1500,'currency':'usd','support':support_usage(subject,rights) if rights['personal'] else None})
        if path=='/premium/checkout' and method=='POST':
            headers={k.lower():v for k,v in event.get('headers',{}).items()}
            if headers.get('origin')!=ORIGIN:return respond(403,{'error':'Invalid origin'})
            raw=event.get('body','')
            if not isinstance(raw,str) or len(raw)>200:return respond(400,{'error':'Choose a tier'})
            if event.get('isBase64Encoded'):raw=base64.b64decode(raw,validate=True).decode('utf-8')
            try:data=json.loads(raw)
            except (ValueError,TypeError):return respond(400,{'error':'Choose a tier'})
            if not isinstance(data,dict) or set(data)!={'tier'} or not isinstance(data.get('tier'),str) or data['tier'] not in TIERS:return respond(400,{'error':'Refresh Linform and choose a valid tier; prices and identity are server-controlled'})
            tier=data['tier'];offer=TIERS[tier];rights=purchase_rights(client,subject)
            if rights['digital'] and tier=='digital' or rights['personal'] and tier=='mentorship':return respond(409,{'error':'This account already has that access'})
            if not ready(client,tier):return respond(503,{'error':'This checkout is temporarily unavailable'})
            session=client.request('/v1/checkout/sessions',{
                'mode':'payment','line_items[0][price]':offer['price'],'line_items[0][quantity]':'1',
                'client_reference_id':subject,'metadata[bundle]':offer['bundle'],
                'payment_intent_data[metadata][bundle]':offer['bundle'],
                'success_url':ORIGIN+'/?premium_session={CHECKOUT_SESSION_ID}#premium',
                'cancel_url':ORIGIN+'/#premium','customer_creation':'always',
                'integration_identifier':'linform_'+tier+'_'+''.join(secrets.choice(string.ascii_lowercase) for _ in range(8))})
            url=session.get('url','')
            if not url.startswith('https://checkout.stripe.com/'):raise ValueError('Unexpected checkout URL')
            return respond(200,{'url':url})
        if path=='/premium/mentoring' and method=='POST':return save_mentoring(event,client,subject)
        if method=='GET' and (path=='/premium/catalog' or path.startswith('/premium/content/')):
            if not entitled(client,subject):return respond(403,{'error':'A verified Premium purchase is required'})
            if path=='/premium/catalog':return respond(200,content_object('catalog.json'))
            key=path.removeprefix('/premium/content/')
            if not ID.fullmatch(key):return respond(404,{'error':'Not found'})
            catalog=content_object('catalog.json')
            if key not in {item['id'] for item in catalog['items']}:return respond(404,{'error':'Not found'})
            return respond(200,content_object('content/'+key+'.json'))
        return respond(404,{'error':'Not found'})
    except Exception:
        # Do not expose keys, request bodies, personal data or provider errors.
        return respond(503,{'error':'Premium service temporarily unavailable; no access was granted'})
