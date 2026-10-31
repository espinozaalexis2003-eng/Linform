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
    if session.get('metadata',{}).get('bundle')!=BUNDLE:return None
    lines=client.request('/v1/checkout/sessions/'+session_id+'/line_items?limit=2')
    rows=lines.get('data',[])
    if len(rows)!=1 or lines.get('has_more') or rows[0].get('price',{}).get('id')!=PRICE or rows[0].get('quantity')!=1:return None
    if session.get('currency')!='usd' or session.get('amount_subtotal')!=1500:return None
    intent=session.get('payment_intent')
    if not isinstance(intent,dict):return None
    charge=intent.get('latest_charge')
    if not isinstance(charge,dict):return None
    active=(session.get('payment_status')=='paid' and intent.get('status')=='succeeded' and charge.get('paid') is True and not charge.get('refunded') and not charge.get('disputed') and charge.get('amount_refunded',0)==0)
    row={'pk':'USER#'+subject,'sk':'ORDER#'+session_id,'sessionId':session_id,'paymentIntent':intent['id'],'active':active,'bundle':BUNDLE,'created':session.get('created',0)}
    table.put_item(Item=row)
    table.put_item(Item={'pk':'PAYMENT#'+intent['id'],'sk':'ORDER','subject':subject,'sessionId':session_id})
    return row

def entitled(client,subject):
    # Check the current payment, not only a cached entitlement. Refunds/disputes
    # revoke access even if a webhook was delayed. Fail closed on provider errors.
    for row in order_items(subject):
        current=paid_order(client,row['sessionId'],subject)
        if current and current['active']:return True
    return False

def ready(client):
    if os.environ.get('SALES_ENABLED')!='true':return False
    price=client.request('/v1/prices/'+PRICE+'?expand[]=product')
    product=price.get('product',{})
    return bool(price.get('active') and price.get('livemode') is LIVE and price.get('type')=='one_time' and price.get('currency')=='usd' and price.get('unit_amount')==1500 and isinstance(product,dict) and product.get('active'))

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
            return respond(200,{'purchased':entitled(client,subject),'checkoutReady':ready(client),'amount':1500,'currency':'usd'})
        if path=='/premium/checkout' and method=='POST':
            headers={k.lower():v for k,v in event.get('headers',{}).items()}
            if headers.get('origin')!=ORIGIN:return respond(403,{'error':'Invalid origin'})
            if (event.get('body') or '') not in ('','{}'):return respond(400,{'error':'Checkout accepts no client-supplied price or identity'})
            if entitled(client,subject):return respond(409,{'error':'Already purchased; refresh Premium access'})
            if not ready(client):return respond(503,{'error':'Premium checkout is not open yet'})
            session=client.request('/v1/checkout/sessions',{
                'mode':'payment','line_items[0][price]':PRICE,'line_items[0][quantity]':'1',
                'client_reference_id':subject,'metadata[bundle]':BUNDLE,
                'payment_intent_data[metadata][bundle]':BUNDLE,
                'success_url':ORIGIN+'/?premium_session={CHECKOUT_SESSION_ID}#premium',
                'cancel_url':ORIGIN+'/#premium','customer_creation':'always',
                'integration_identifier':'linform_premium_'+''.join(secrets.choice(string.ascii_lowercase) for _ in range(8))})
            url=session.get('url','')
            if not url.startswith('https://checkout.stripe.com/'):raise ValueError('Unexpected checkout URL')
            return respond(200,{'url':url})
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
