import copy
import importlib.util
from pathlib import Path
import unittest

root=Path(__file__).parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
update=load('support_update',root/'update-premium-support.py')
owner=load('support_owner',root/'enable-owner-access.py')

class SupportUpdateTests(unittest.TestCase):
    def old_source(self):
        source=(root/'premium.py').read_text()
        start=source.index('# Linform support allowances v1')
        end=source.index('def handler(',start)
        legacy='def save_mentoring(event,client,subject):\n    if not entitled(client,subject):return respond(403,{})\n    return respond(201,{})\n\n'
        return (source[:start]+legacy+source[end:]).replace(", 'support': support_usage(subject)",'').replace(",'support':support_usage(subject)",'')
    def test_patch_preserves_verified_owner_and_unrelated_functions(self):
        source=owner.patch_code(self.old_source());patched=update.patch_code(source)
        self.assertIn('def owner_access(subject):',patched);self.assertIn('def has_premium_access(client, subject):',patched)
        self.assertIn("'owner':rights['owner']",patched);self.assertIn("'support':support_usage(subject)",patched)
        self.assertEqual(source[source.index('def webhook('):source.index('def save_mentoring(')],patched[patched.index('def webhook('):patched.index('# Linform support allowances v1')])
        self.assertEqual(update.patch_code(patched),patched)
    def test_template_changes_only_inline_code(self):
        template={'Resources':{'Function':{'Type':'AWS::Lambda::Function','Properties':{'Handler':'index.handler','Runtime':'python3.12','Environment':{'Variables':{'LINFORM_OWNER_SUB':'fixture-owner','SALES_ENABLED':'true'}},'Code':{'ZipFile':self.old_source()}}},'Other':{'Type':'Fixture','Properties':{'value':'unchanged'}}},'Parameters':{'Price':{'Default':'fixture'}}}
        before=copy.deepcopy(template);after=update.patch_template(template)
        after['Resources']['Function']['Properties']['Code']=before['Resources']['Function']['Properties']['Code']
        self.assertEqual(after,before);self.assertEqual(template,before)
    def test_rejects_non_inline_or_unrecognized_code(self):
        with self.assertRaises(ValueError):update.patch_code('def handler(event,context): pass')
        with self.assertRaises(ValueError):update.patch_template({'Resources':{}})

if __name__=='__main__':unittest.main()
