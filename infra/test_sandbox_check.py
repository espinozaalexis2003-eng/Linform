import contextlib,importlib.util,io,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('sandbox_check',Path(__file__).with_name('check-premium-sandbox.py'));m=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'boto3':types.SimpleNamespace()}):spec.loader.exec_module(m)
class SandboxTests(unittest.TestCase):
 def setUp(self):
  self.state={'stack':m.STACK,'subjectA':'qa-a','subjectB':'qa-b','sessionId':'cs_test_fixture','paid_check_passed':False,'refund_check_passed':False}
  self.session={'livemode':False,'client_reference_id':'qa-a','payment_status':'paid','payment_intent':{'id':'pi_fixture','latest_charge':{'refunded':False,'amount_refunded':0}}}
 def invocation(self,stack,method,path,subject,query=None):
  allowed=stack==m.STACK and subject=='qa-a'
  if path=='/premium/access':return 200,{'purchased':allowed}
  return (200,{'items':[{'id':'sandbox-fixture'}]}) if allowed else (403,{'error':'denied'})
 def run_check(self,invoke=None,refund=False):
  with patch.object(m,'load',return_value=self.state),patch.object(m,'stored',return_value={'api_key':'dummy'}),patch.object(m,'stripe',return_value=self.session),patch.object(m,'invoke',side_effect=invoke or self.invocation),patch.object(m,'save') as save,contextlib.redirect_stdout(io.StringIO()):
   m.verify(refund);return save
 def test_paid_fixture_access_and_account_isolation(self):
  save=self.run_check();self.assertTrue(save.call_args.args[0]['paid_check_passed']);self.assertEqual(save.call_args.args[0]['paymentIntent'],'pi_fixture')
 def test_test_payment_cannot_unlock_live(self):
  def leak(stack,*args,**kwargs):return (200,{'purchased':True}) if stack==m.LIVE_STACK else self.invocation(stack,*args,**kwargs)
  with self.assertRaises(m.CheckError):self.run_check(leak)
 def test_other_account_cannot_reconcile_someone_elses_purchase(self):
  def leak(stack,method,path,subject,query=None):return (200,{'purchased':True}) if subject=='qa-b' and path=='/premium/access' else self.invocation(stack,method,path,subject,query)
  with self.assertRaises(m.CheckError):self.run_check(leak)
 def test_live_or_unpaid_session_is_rejected(self):
  self.session['livemode']=True
  with self.assertRaises(m.CheckError):self.run_check()
  self.session['livemode']=False;self.session['payment_status']='unpaid'
  with self.assertRaises(m.CheckError):self.run_check()
 def test_refund_requires_prior_payment_and_real_refund_evidence(self):
  with self.assertRaises(m.CheckError):self.run_check(refund=True)
  self.state['paid_check_passed']=True
  with self.assertRaises(m.CheckError):self.run_check(refund=True)
  self.session['payment_intent']['latest_charge']['refunded']=True
  def revoked(stack,method,path,subject,query=None):return (200,{'purchased':False}) if path=='/premium/access' else (403,{'error':'denied'})
  save=self.run_check(revoked,True);self.assertTrue(save.call_args.args[0]['refund_check_passed'])
if __name__=='__main__':unittest.main()
