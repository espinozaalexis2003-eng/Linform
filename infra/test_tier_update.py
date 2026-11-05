import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).with_name('update-premium-tiers.py')
spec=importlib.util.spec_from_file_location('tier_update',path);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)

class TierUpdateTests(unittest.TestCase):
 def test_source_is_synchronized_and_idempotent(self):
  self.assertEqual(u.SOURCE,Path(__file__).with_name('premium.py').read_text());self.assertEqual(u.patch_code(u.SOURCE),u.SOURCE)
 def test_older_recognized_source_is_upgraded(self):
  old=u.SOURCE.replace('Prices identify the purchased offer','Earlier code: prices identify the purchased offer')
  self.assertEqual(u.patch_code(old),u.SOURCE)
 def test_custom_webhook_or_owner_logic_is_never_overwritten(self):
  for old in (u.SOURCE.replace("return respond(200,{'received':True})","return respond(200,{'received':False})"),u.SOURCE.replace("configured = os.environ.get('LINFORM_OWNER_SUB', '')","configured = 'unexpected-owner'"),u.SOURCE+'\ndef custom_business_logic(): pass\n'):
   with self.assertRaises(ValueError):u.patch_code(old)

if __name__=='__main__':unittest.main()
