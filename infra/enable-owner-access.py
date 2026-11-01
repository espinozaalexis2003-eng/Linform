"""Grant Linform's verified owner private-library access through CloudFormation.
Uses CloudShell's AWS identity; never requests Stripe keys or account passwords.
"""
import argparse
import copy
import json
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

REGION = 'us-east-2'
MARKER = '# Linform owner access v1'
HELPER = '''\n# Linform owner access v1
def owner_access(subject):
    configured = os.environ.get('LINFORM_OWNER_SUB', '')
    return bool(isinstance(subject, str) and SUB.fullmatch(subject) and configured and hmac.compare_digest(configured, subject))

def has_premium_access(client, subject):
    return owner_access(subject) or entitled(client, subject)
\n'''

def patch_code(source):
    if MARKER in source:
        if 'def owner_access(subject):' not in source or 'def has_premium_access(client, subject):' not in source:
            raise ValueError('Unexpected existing owner-access implementation')
        return source
    if 'def entitled(client,subject):' not in source or "claims.get('token_use')!='access'" not in source:
        raise ValueError('Unrecognized Premium backend; no changes made')
    replacements = {
        "def ready(client):": HELPER + "\ndef ready(client):",
        "if not entitled(client,subject):": "if not has_premium_access(client,subject):",
        "if entitled(client,subject):return respond(409,": "if has_premium_access(client,subject):return respond(409,",
        "{'purchased':entitled(client,subject),'checkoutReady':ready(client),": "{'purchased':entitled(client,subject),'owner':owner_access(subject),'checkoutReady':ready(client),",
    }
    if source.count('if not entitled(client,subject):') != 2:
        raise ValueError('Unexpected library or mentoring access checks')
    for old, new in replacements.items():
        if old not in source:
            raise ValueError('Backend shape changed; no changes made')
        source = source.replace(old, new)
    compile(source, '<owner-backend>', 'exec')
    return source

def build_template(template, subject):
    if not re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', subject):
        raise ValueError('Expected a verified Cognito subject')
    updated = copy.deepcopy(template)
    function = updated['Resources']['Function']
    if function['Type'] != 'AWS::Lambda::Function':
        raise ValueError('Unexpected Function resource')
    props = function['Properties']
    if props.get('Handler') != 'index.handler' or not props.get('Runtime', '').startswith('python'):
        raise ValueError('Unexpected runtime or handler')
    props['Code']['ZipFile'] = patch_code(props['Code']['ZipFile'])
    props['Environment']['Variables']['LINFORM_OWNER_SUB'] = subject
    return updated

def aws(*args):
    result = subprocess.run(['aws', '--region', REGION, *args, '--output', 'json', '--no-cli-pager'], capture_output=True, text=True)
    if result.returncode:
        # Output from commands is never dumped: templates may contain private implementation details.
        raise RuntimeError('AWS command failed: ' + ' '.join(args[:2]) + '. Check your CloudShell permissions and stack status.')
    return json.loads(result.stdout) if result.stdout.strip() else {}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account-id', required=True)
    parser.add_argument('--user-pool-id', required=True)
    parser.add_argument('--stack-name', required=True)
    parser.add_argument('--owner-email', required=True)
    args = parser.parse_args()
    account, pool, stack_name, owner_email = args.account_id, args.user_pool_id, args.stack_name, args.owner_email.strip().lower()
    if not re.fullmatch(r'[0-9]{12}', account) or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', owner_email):
        raise ValueError('Use a valid AWS account ID and owner email')
    if aws('sts', 'get-caller-identity')['Account'] != account:
        raise RuntimeError('Wrong AWS account; no changes made')
    user = aws('cognito-idp', 'admin-get-user', '--user-pool-id', pool, '--username', owner_email)
    attrs = {item['Name']: item['Value'] for item in user.get('UserAttributes', [])}
    if not user.get('Enabled') or attrs.get('email', '').lower() != owner_email or attrs.get('email_verified') != 'true':
        raise RuntimeError('Create and verify this Linform account first: ' + owner_email)
    subject = attrs.get('sub', '')
    stack = aws('cloudformation', 'describe-stacks', '--stack-name', stack_name)['Stacks'][0]
    if stack['StackStatus'] not in ('CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'):
        raise RuntimeError('Stack is not ready for an update; no changes made')
    template = aws('cloudformation', 'get-template', '--stack-name', stack_name, '--template-stage', 'Original')['TemplateBody']
    if isinstance(template, str):
        template = json.loads(template)
    updated = build_template(template, subject)
    if updated == template:
        print('Owner access is already configured for ' + owner_email)
        return
    with tempfile.TemporaryDirectory(prefix='linform-owner-') as folder:
        template_path = Path(folder) / 'template.json'
        params_path = Path(folder) / 'parameters.json'
        payload = json.dumps(updated)
        if len(payload.encode()) > 51200:
            raise RuntimeError('Template exceeds the direct AWS update limit; no changes made')
        template_path.write_text(payload)
        params_path.write_text(json.dumps([{'ParameterKey': p['ParameterKey'], 'UsePreviousValue': True} for p in stack.get('Parameters', [])]))
        name = 'linform-owner-' + uuid.uuid4().hex[:12]
        args = ['cloudformation', 'create-change-set', '--stack-name', stack_name, '--change-set-name', name,
                '--change-set-type', 'UPDATE', '--template-body', 'file://' + str(template_path),
                '--parameters', 'file://' + str(params_path)]
        capabilities = stack.get('Capabilities') or ['CAPABILITY_IAM']
        if capabilities:
            args += ['--capabilities', *capabilities]
        change_id = aws(*args)['Id']
        print('Checking owner-access change…', flush=True)
        aws('cloudformation', 'wait', 'change-set-create-complete', '--stack-name', stack_name, '--change-set-name', change_id)
        change = aws('cloudformation', 'describe-change-set', '--stack-name', stack_name, '--change-set-name', change_id)
        resources = [item.get('ResourceChange', {}) for item in change.get('Changes', [])]
        safe = (len(resources) == 1 and resources[0].get('LogicalResourceId') == 'Function'
                and resources[0].get('Action') == 'Modify' and resources[0].get('Replacement') == 'False'
                and not change.get('NextToken'))
        if not safe:
            aws('cloudformation', 'delete-change-set', '--stack-name', stack_name, '--change-set-name', change_id)
            raise RuntimeError('Unexpected infrastructure changes were blocked; nothing was executed')
        print('Updating the Premium function. Keeping existing sales settings, prices and infrastructure…', flush=True)
        aws('cloudformation', 'execute-change-set', '--stack-name', stack_name, '--change-set-name', change_id)
        aws('cloudformation', 'wait', 'stack-update-complete', '--stack-name', stack_name)
    print('Owner access enabled for ' + owner_email)
    print('Sign out of Linform, sign back in, then open Premium on desktop and mobile.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError) as error:
        raise SystemExit(str(error))
