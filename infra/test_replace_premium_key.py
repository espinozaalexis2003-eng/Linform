import contextlib,importlib.util,io,json,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('replace_key',Path(__file__).with_name('replace-premium-stripe-key.py'));mod=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'boto3':types.SimpleNamespace()}):spec.loader.exec_module(mod)
class Manager:
 def __init__(self,key='old'):self.data={'api_key':key,'webhook_secret':'private-signing-fixture','other':'keep'};self.writes=[]
 def get_secret_value(self,**kw):return {'SecretString':json.dumps(self.data)}
 def put_secret_value(self,**kw):self.writes.append(json.loads(kw['SecretString']))
class Tests(unittest.TestCase):
 def test_replacement_is_verified_and_signing_secret_preserved(self):
  manager=Manager();checked=[]
  def validate(key):
   checked.append(key)
   if key=='old':raise mod.KeyCheckError('HTTP 401')
  with contextlib.redirect_stdout(io.StringIO()):mod.main(manager,validate,lambda prompt:' new-key ')
  self.assertEqual(checked,['old','new-key']);self.assertEqual(manager.writes,[{'api_key':'new-key','webhook_secret':'private-signing-fixture','other':'keep'}])
 def test_invalid_replacement_is_not_saved(self):
  manager=Manager()
  def validate(key):raise mod.KeyCheckError('HTTP 401')
  with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(mod.KeyCheckError):mod.main(manager,validate,lambda prompt:'invalid-key')
  self.assertFalse(manager.writes)
 def test_whitespace_is_normalized_only_after_validation(self):
  manager=Manager(' valid ')
  with contextlib.redirect_stdout(io.StringIO()):mod.main(manager,lambda key:self.assertEqual(key,'valid'),lambda prompt:self.fail('unnecessary key prompt'))
  self.assertEqual(manager.writes[0]['api_key'],'valid');self.assertEqual(manager.writes[0]['webhook_secret'],'private-signing-fixture')
 def test_commands_rejected_before_network(self):
  with patch.object(mod,'read_stripe') as read,self.assertRaises(mod.KeyCheckError):mod.validate('python3 infra/replace-premium-stripe-key.py')
  read.assert_not_called()
 def test_key_tail_format_and_length_are_validated_by_stripe(self):
  with patch.object(mod,'read_stripe',side_effect=[{'livemode':True,'currency':'usd','type':'one_time','unit_amount':1500},{}]) as read:mod.validate('rk_live_synthetic-format+v2');self.assertEqual(read.call_count,2)
 def test_wrapping_quotes_and_whitespace_are_removed(self):
  self.assertEqual(mod.normalize('  "rk_live_synthetic"  '),'rk_live_synthetic')
 def test_masked_value_can_never_be_saved_on_stripe_rejection(self):
  manager=Manager()
  with patch.object(mod,'read_stripe',side_effect=mod.KeyCheckError('HTTP 401')),contextlib.redirect_stdout(io.StringIO()),self.assertRaises(mod.KeyCheckError):mod.main(manager,mod.validate,lambda prompt:'rk_live_...masked')
  self.assertFalse(manager.writes)
 def test_wrong_price_configuration_rejected(self):
  with patch.object(mod,'read_stripe',return_value={'livemode':True,'currency':'usd','type':'one_time','unit_amount':1}),self.assertRaises(mod.KeyCheckError):mod.validate('rk_live_'+'x'*30)
if __name__=='__main__':unittest.main()
