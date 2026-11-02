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
TEMPLATE={'Resources':{'Function':{'Type':'AWS::Lambda::Function','Properties':{'Handler':'index.handler','Runtime':'python3.12','Code':{'ZipFile':SOURCE},'Environment':{'Variables':{'SALES_ENABLED':'true','PRICE_ID':'existing-price'}}}},'Integration':{'Type':'AWS::ApiGatewayV2::Integration','Properties':{'IntegrationUri':{'Fn::GetAtt':['Function','Arn']}}},'Keep':{'Type':'AWS::S3::Bucket','Properties':{'BucketName':'unchanged'}}},'Parameters':{'SalesEnabled':{'Type':'String'}}}
FUNCTION_CHANGE={'LogicalResourceId':'Function','ResourceType':'AWS::Lambda::Function','Action':'Modify','Replacement':'False','Scope':['Properties'],'Details':[{'Target':{'Attribute':'Properties','Name':name,'RequiresRecreation':'Never'},'Evaluation':'Static','ChangeSource':'DirectModification'} for name in ['Code','Environment']]}
INTEGRATION_CHANGE={'LogicalResourceId':'Integration','ResourceType':'AWS::ApiGatewayV2::Integration','Action':'Modify','Replacement':'False','Scope':['Properties'],'Details':[{'Target':{'Attribute':'Properties','Name':'IntegrationUri','RequiresRecreation':'Never'},'Evaluation':'Dynamic','ChangeSource':'ResourceAttribute','CausingEntity':'Function.Arn'}]}
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
    if operation=='describe-change-set':return {'Changes':[{'ResourceChange':{**copy.deepcopy(FUNCTION_CHANGE),'LogicalResourceId':target}}]}
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
 def test_observed_arn_dependency_is_accepted(self):
  change={'Changes':[{'ResourceChange':copy.deepcopy(row)} for row in [FUNCTION_CHANGE,INTEGRATION_CHANGE]]}
  self.assertTrue(m.expected_changes(change,TEMPLATE))
  self.assertTrue(m.expected_changes({'Changes':[{'ResourceChange':FUNCTION_CHANGE}]},TEMPLATE))
 def test_other_integration_edits_and_replacements_stay_blocked(self):
  for mutate in [
   lambda row:row.update(Replacement='True'),
   lambda row:row.update(Replacement='Conditional'),
   lambda row:row.update(Action='Remove'),
   lambda row:row['Details'][0].update(ChangeSource='DirectModification'),
   lambda row:row['Details'][0].update(CausingEntity='OtherFunction.Arn'),
   lambda row:row['Details'][0]['Target'].update(Name='CredentialsArn'),
   lambda row:row['Details'][0]['Target'].update(RequiresRecreation='Always')]:
   row=copy.deepcopy(INTEGRATION_CHANGE);mutate(row)
   self.assertFalse(m.expected_changes({'Changes':[{'ResourceChange':FUNCTION_CHANGE},{'ResourceChange':row}]},TEMPLATE))
  template=copy.deepcopy(TEMPLATE);template['Resources']['Integration']['Properties']['IntegrationUri']='https://example.com'
  self.assertFalse(m.expected_changes({'Changes':[{'ResourceChange':FUNCTION_CHANGE},{'ResourceChange':INTEGRATION_CHANGE}]},template))
 def test_unrelated_function_properties_duplicate_resources_and_extra_pages_are_blocked(self):
  row=copy.deepcopy(FUNCTION_CHANGE);row['Details'][0]['Target']['Name']='Role'
  self.assertFalse(m.expected_changes({'Changes':[{'ResourceChange':row}]},TEMPLATE))
  self.assertFalse(m.expected_changes({'Changes':[{'ResourceChange':FUNCTION_CHANGE}]*2},TEMPLATE))
  self.assertFalse(m.expected_changes({'Changes':[{'ResourceChange':FUNCTION_CHANGE}], 'NextToken':'more'},TEMPLATE))
if __name__=='__main__':unittest.main()


