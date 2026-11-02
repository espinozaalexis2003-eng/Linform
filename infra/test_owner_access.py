import copy
import importlib.util
import unittest
import io
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('owner_access_setup',Path(__file__).with_name('enable-owner-access.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
EMAIL='owner@example.com'
ACCOUNT='000000000000'
ARGV=['enable-owner-access.py','--account-id',ACCOUNT,'--user-pool-id','us-east-2_fixture','--stack-name','fixture-stack','--owner-email',EMAIL]
SUBJECT='11111111-2222-3333-4444-555555555555'
SOURCE="""import os,hmac,re
SUB=re.compile(r'[a-zA-Z0-9-]{1,128}\\Z')
def entitled(client,subject): return subject == 'paid-student'
def ready(client): return True
def check(claims,client,subject):
 if claims.get('token_use')!='access':return 401
 return {'purchased':entitled(client,subject),'checkoutReady':ready(client),'amount':1500}
def mentoring(client,subject):
 if not entitled(client,subject):return 403
 return 201
def content(client,subject):
 if not entitled(client,subject):return 403
 return 200
def respond(code,data):return code
def checkout(client,subject):
 if entitled(client,subject):return respond(409,{'error':'already'})
 return 200
"""
TEMPLATE={'Resources':{'Function':{'Type':'AWS::Lambda::Function','Properties':{'Handler':'index.handler','Runtime':'python3.12','Code':{'ZipFile':SOURCE},'Environment':{'Variables':{'SALES_ENABLED':'true','PRICE_ID':'existing-price'}}}},'Keep':{'Type':'AWS::S3::Bucket','Properties':{'BucketName':'unchanged'}}},'Parameters':{'SalesEnabled':{'Type':'String'}}}
class OwnerSetupTests(unittest.TestCase):
 def test_owner_is_server_subject_not_email_or_browser_flag(self):
  ns={};exec(m.patch_code(SOURCE),ns)
  with patch.dict('os.environ',{'LINFORM_OWNER_SUB':SUBJECT}):
   self.assertTrue(ns['has_premium_access'](None,SUBJECT))
   self.assertFalse(ns['has_premium_access'](None,EMAIL))
   self.assertFalse(ns['has_premium_access'](None,'other-student'))
   self.assertTrue(ns['has_premium_access'](None,'paid-student'))
   self.assertFalse(ns['check']({'token_use':'access'},None,SUBJECT)['purchased'])
   self.assertTrue(ns['check']({'token_use':'access'},None,SUBJECT)['owner'])
   self.assertEqual(ns['check']({'token_use':'id'},None,SUBJECT),401)
   self.assertEqual(ns['content'](None,SUBJECT),200)
   self.assertEqual(ns['content'](None,'other-student'),403)
 def test_template_changes_only_function_code_and_owner_binding(self):
  before=copy.deepcopy(TEMPLATE);after=m.build_template(before,SUBJECT)
  self.assertEqual(before,TEMPLATE)
  self.assertEqual(after['Resources']['Keep'],before['Resources']['Keep'])
  props=after['Resources']['Function']['Properties'];self.assertEqual(props['Environment']['Variables']['SALES_ENABLED'],'true')
  self.assertEqual(props['Environment']['Variables']['PRICE_ID'],'existing-price')
  self.assertEqual(props['Environment']['Variables']['LINFORM_OWNER_SUB'],SUBJECT)
  self.assertEqual(m.build_template(after,SUBJECT),after)
 def test_unknown_source_and_invalid_subject_are_rejected(self):
  with self.assertRaises(ValueError):m.patch_code('print("unknown")')
  with self.assertRaises(ValueError):m.build_template(TEMPLATE,EMAIL)
 def test_unverified_email_never_changes_infrastructure(self):
  calls=[]
  def aws(*args):
   calls.append(args)
   if args[:2]==('sts','get-caller-identity'):return {'Account':ACCOUNT}
   return {'Enabled':True,'UserAttributes':[{'Name':'email','Value':EMAIL},{'Name':'email_verified','Value':'false'}]}
  with patch.object(m,'aws',aws),patch('sys.argv',ARGV):
   with self.assertRaises(RuntimeError):m.main()
  self.assertFalse(any(x[0]=='cloudformation' for x in calls))
 def test_wrong_aws_account_is_rejected(self):
  with patch.object(m,'aws',return_value={'Account':'wrong'}),patch('sys.argv',ARGV):
   with self.assertRaises(RuntimeError):m.main()
 def test_only_expected_function_update_can_execute(self):
  for target,should_execute,review_only in [('Function',True,False),('Keep',False,False),('Function',False,True),('Keep',False,True)]:
   calls=[]
   def aws(*args):
    calls.append(args)
    service,operation=args[:2]
    if service=='sts':return {'Account':ACCOUNT}
    if service=='cognito-idp':return {'Enabled':True,'UserAttributes':[{'Name':'email','Value':EMAIL},{'Name':'email_verified','Value':'true'},{'Name':'sub','Value':SUBJECT}]}
    if operation=='describe-stacks':return {'Stacks':[{'StackStatus':'UPDATE_COMPLETE','Parameters':[{'ParameterKey':'SalesEnabled'}]}]}
    if operation=='get-template':return {'TemplateBody':copy.deepcopy(TEMPLATE)}
    if operation=='create-change-set':return {'Id':'fixture-change'}
    if operation=='describe-change-set':return {'Changes':[{'ResourceChange':{'LogicalResourceId':target,'Action':'Modify','Replacement':'False'}}]}
    return {}
   with patch.object(m,'aws',aws),patch('sys.argv',ARGV+(['--review-only'] if review_only else [])),redirect_stdout(io.StringIO()) as output:
    if should_execute or review_only:m.main()
    else:
     with self.assertRaises(RuntimeError):m.main()
   self.assertEqual(any(c[1]=='execute-change-set' for c in calls),should_execute)
   if not should_execute:
    self.assertTrue(any(c[1]=='delete-change-set' for c in calls))
    self.assertIn('PROPOSED CHANGE SUMMARY',output.getvalue())
    self.assertNotIn(EMAIL,output.getvalue())
    self.assertNotIn(SUBJECT,output.getvalue())
if __name__=='__main__':unittest.main()

