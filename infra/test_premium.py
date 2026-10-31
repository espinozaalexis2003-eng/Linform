import copy,hashlib,hmac,importlib.util,io,json,os,sys,time,types,unittest
from pathlib import Path
from unittest.mock import patch
class Table:
 def __init__(self):self.items={}
 def put_item(self,Item):self.items[(Item['pk'],Item['sk'])]=copy.deepcopy(Item)
 def get_item(self,Key,**kw):return {'Item':self.items.get((Key['pk'],Key['sk']))}
 def query(self,**kw):return {'Items':[copy.deepcopy(v) for (pk,sk),v in self.items.items() if pk==kw['ExpressionAttributeValues'][':u'] and sk.startswith(kw['ExpressionAttributeValues'].get(':m','ORDER#'))]}
table=Table();reads=[]
def object_read(**kw):
 reads.append(kw);return {'Body':io.BytesIO(json.dumps({'items':[{'id':'aws-guide'}]} if kw['Key']=='catalog.json' else {'title':'private fixture'}).encode())}
secret=types.SimpleNamespace(get_secret_value=lambda **kw:{'SecretString':json.dumps({'api_key':'fixture','webhook_secret':'signature-fixture'})})
fake=types.SimpleNamespace(resource=lambda name:types.SimpleNamespace(Table=lambda name:table),client=lambda name:types.SimpleNamespace(get_object=object_read) if name=='s3' else secret)
spec=importlib.util.spec_from_file_location('premium_under_test',Path(__file__).with_name('premium.py'));p=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'boto3':fake}),patch.dict(os.environ,{'ENTITLEMENTS_TABLE':'fixture'}):spec.loader.exec_module(p)
class Client:
 def __init__(self):
  self.session={'client_reference_id':'student-a','livemode':False,'mode':'payment','metadata':{'bundle':p.BUNDLE},'currency':'usd','amount_subtotal':1500,'payment_status':'paid','payment_intent':{'id':'pi_fixture','status':'succeeded','latest_charge':{'paid':True,'refunded':False,'disputed':False,'amount_refunded':0}}};self.lines={'data':[{'price':{'id':'price_fixture'},'quantity':1}]};self.fail=False
 def request(self,path,params=None):
  if self.fail:raise RuntimeError('provider down')
  if '/line_items' in path:return self.lines
  return copy.deepcopy(self.session)
class PremiumTests(unittest.TestCase):
 def setUp(self):
  table.items.clear();reads.clear();p.PRICE='price_fixture';p.LIVE=False;self.client=Client()
  self.gateway=patch.object(p,'StripeGateway',lambda key:self.client);self.gateway.start();self.addCleanup(self.gateway.stop)
  self.env=patch.dict(os.environ,{'STRIPE_SECRET_ARN':'fixture','CONTENT_BUCKET':'fixture','SALES_ENABLED':'false'});self.env.start();self.addCleanup(self.env.stop)
 def event(self,path='/premium/access',method='GET',subject='student-a',body=None):return {'rawPath':path,'requestContext':{'http':{'method':method},'authorizer':{'jwt':{'claims':{'sub':subject,'token_use':'access'}}}},'headers':{'origin':p.ORIGIN},'body':body}
 def call(self,event):
  response=p.handler(event,None);self.assertIn('no-store',response['headers']['cache-control']);return response['statusCode'],json.loads(response['body'])
 def grant(self):return p.paid_order(self.client,'cs_test_order','student-a')
 def test_authentication_required(self):
  self.assertEqual(self.call({})[0],401);e=self.event();e['requestContext']['authorizer']['jwt']['claims']['token_use']='id';self.assertEqual(self.call(e)[0],401)
 def test_no_content_read_without_payment(self):
  self.assertEqual(self.call(self.event('/premium/content/aws-guide'))[0],403);self.assertFalse(reads)
 def test_owner_only_and_content_allowlist(self):
  self.grant();self.assertEqual(self.call(self.event('/premium/content/aws-guide'))[0],200);self.assertEqual(self.call(self.event('/premium/catalog',subject='student-b'))[0],403);self.assertEqual(self.call(self.event('/premium/content/unknown'))[0],404)
 def test_return_url_never_grants_another_account(self):
  e=self.event(subject='student-b');e['queryStringParameters']={'session_id':'cs_test_order'};self.assertFalse(self.call(e)[1]['purchased']);self.assertFalse(table.items)
 def test_delayed_payment_and_idempotence(self):
  self.client.session['payment_status']='unpaid';self.grant();self.assertFalse(p.entitled(self.client,'student-a'))
  self.client.session['payment_status']='paid';self.grant();self.grant();self.assertTrue(p.entitled(self.client,'student-a'));self.assertEqual(len(table.items),2)
 def test_amount_price_environment_and_currency_verified(self):
  for key,value in [('amount_subtotal',1),('livemode',True),('currency','eur')]:
   previous=self.client.session[key];self.client.session[key]=value;self.assertIsNone(self.grant());self.client.session[key]=previous
  self.client.lines['data'][0]['price']['id']='wrong';self.assertIsNone(self.grant())
 def test_refunds_partial_refunds_and_disputes_revoke_without_webhook(self):
  charge=self.client.session['payment_intent']['latest_charge']
  for key,value in [('refunded',True),('amount_refunded',100),('disputed',True)]:
   self.grant();charge[key]=value;self.assertFalse(p.entitled(self.client,'student-a'));charge[key]=False if key!='amount_refunded' else 0
 def test_checkout_closed_and_client_values_rejected(self):
  self.assertEqual(self.call(self.event('/premium/checkout','POST',body='{}'))[0],503);self.assertEqual(self.call(self.event('/premium/checkout','POST',body='{"amount":1}'))[0],400)
  e=self.event('/premium/checkout','POST');e['headers']['origin']='https://evil.example';self.assertEqual(self.call(e)[0],403)
 def test_raw_signature_tolerance_and_multiple_signatures(self):
  stamp=str(int(time.time()));raw=b'{}';digest=hmac.new(b'signature-fixture',stamp.encode()+b'.'+raw,hashlib.sha256).hexdigest();signature='t='+stamp+',v1=bad,v1='+digest
  self.assertTrue(p.signature_valid(raw,signature,'signature-fixture'));self.assertFalse(p.signature_valid(raw+b' ',signature,'signature-fixture'));self.assertFalse(p.signature_valid(raw,signature,'signature-fixture',now=int(stamp)+301))
 def test_webhook_rejects_unsigned_events_and_accepts_signed_duplicate(self):
  e={'rawPath':'/stripe/webhook','requestContext':{'http':{'method':'POST'}},'body':'{}'};self.assertEqual(self.call(e)[0],400)
  e['body']=json.dumps({'type':'checkout.session.completed','livemode':False,'data':{'object':{'id':'cs_test_order'}}});stamp=str(int(time.time()));digest=hmac.new(b'signature-fixture',stamp.encode()+b'.'+e['body'].encode(),hashlib.sha256).hexdigest();e['headers']={'stripe-signature':'t='+stamp+',v1='+digest}
  self.assertEqual(self.call(e)[0],200);self.assertEqual(self.call(e)[0],200);self.assertEqual(len(table.items),2)
 def test_provider_failure_fails_closed(self):
  self.grant();self.client.fail=True;self.assertEqual(self.call(self.event('/premium/catalog'))[0],503);self.assertFalse(reads)
 def test_infrastructure_access_boundaries(self):
  t=json.loads(Path(__file__).with_name('premium.template.json').read_text());r=t['Resources'];self.assertEqual(t['Parameters']['SalesEnabled']['Default'],'false');self.assertTrue(all(r['Content']['Properties']['PublicAccessBlockConfiguration'].values()))
  for resource in r.values():
   if resource['Type']=='AWS::ApiGatewayV2::Route' and 'webhook' not in resource['Properties']['RouteKey']:self.assertEqual(resource['Properties']['AuthorizationType'],'JWT')
  self.assertNotIn('ReservedConcurrentExecutions',r['Function']['Properties'])

 def mentoring_data(self):return {'topic':'project-feedback','message':'Could you review my architecture and explain the access boundaries?','replyEmail':'student@example.com','projectUrl':'https://github.com/example/project','consent':True}
 def test_mentoring_requires_payment_and_binds_to_authenticated_user(self):
  e=self.event('/premium/mentoring','POST',body=json.dumps(self.mentoring_data()))
  self.assertEqual(self.call(e)[0],403);self.grant();code,data=self.call(e);self.assertEqual(code,201)
  row=next(v for k,v in table.items.items() if k[1].startswith('MENTOR#'));self.assertEqual(row['pk'],'USER#student-a');self.assertEqual(row['status'],'requested')
  e['requestContext']['authorizer']['jwt']['claims']['sub']='student-b';self.assertEqual(self.call(e)[0],403)
 def test_mentoring_input_origin_and_daily_limit(self):
  self.grant();data=self.mentoring_data();data['userId']='victim';self.assertEqual(self.call(self.event('/premium/mentoring','POST',body=json.dumps(data)))[0],400)
  for field,value in [('consent',False),('message','short'),('replyEmail','not-email'),('projectUrl','https://evil.example/a')]:
   data=self.mentoring_data();data[field]=value;self.assertEqual(self.call(self.event('/premium/mentoring','POST',body=json.dumps(data)))[0],400)
  e=self.event('/premium/mentoring','POST',body=json.dumps(self.mentoring_data()));e['headers']['origin']='https://evil.example';self.assertEqual(self.call(e)[0],403)
  for i in range(5):self.assertEqual(self.call(self.event('/premium/mentoring','POST',body=json.dumps(self.mentoring_data())))[0],201)
  self.assertEqual(self.call(self.event('/premium/mentoring','POST',body=json.dumps(self.mentoring_data())))[0],429)

if __name__=='__main__':unittest.main()
