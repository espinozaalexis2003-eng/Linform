"""Apply only the Premium support-policy code change to an existing stack."""
import argparse
import ast
import copy
import json
from pathlib import Path
import re
import subprocess
import tempfile
import uuid

REGION = 'us-east-2'
HELPERS = "# Linform support allowances v1. Only this helper block and save_mentoring are patched into live code.\ndef support_period(now=None):\n    return time.strftime('%Y-%m', time.gmtime(time.time() if now is None else now))\n\ndef support_usage(subject):\n    period = support_period()\n    def used(key):\n        row = table.get_item(Key={'pk': 'USER#'+subject, 'sk': key}, ConsistentRead=True).get('Item') or {}\n        return int(row.get('used', 0))\n    return {'policyVersion': 1, 'month': period,\n            'mentoringUsed': used('SUPPORT#MENTORING#'+period),\n            'customProjectUsed': used('SUPPORT#CUSTOM#'+period),\n            'resumeUsed': used('SUPPORT#RESUME')}\n\ndef support_kind(topic, message):\n    # Preserve compatibility with the existing public request contract.\n    if topic == 'learning-plan' and message.startswith('[Resume final revision]\\n'):\n        return 'resume-revision'\n    if topic == 'learning-plan' and message.startswith('[Resume review]\\n'):\n        return 'resume-review'\n    if topic == 'project-feedback' and message.startswith('[Custom project]\\n'):\n        return 'custom-project'\n    return 'mentoring'\n\ndef save_support_request(subject, kind, row):\n    period = support_period(row['created'])\n    key = 'SUPPORT#RESUME' if kind.startswith('resume-') else ('SUPPORT#CUSTOM#' if kind == 'custom-project' else 'SUPPORT#MENTORING#')+period\n    current = table.get_item(Key={'pk': 'USER#'+subject, 'sk': key}, ConsistentRead=True).get('Item') or {}\n    used = int(current.get('used', 0))\n    if kind == 'resume-revision' and used == 0:\n        return respond(409, {'error': 'Submit your initial resume review before the final revision.'})\n    limit = 2 if kind == 'resume-revision' else 1\n    if used >= limit:\n        label = 'Your resume review and final revision have been used.' if kind == 'resume-revision' else 'Your initial resume review has been requested; use the final revision option after receiving feedback.' if kind == 'resume-review' else 'Your custom-project request for this calendar month has been used.' if kind == 'custom-project' else 'Your mentoring request for this calendar month has been used.'\n        return respond(429, {'error': label})\n    marker = {'pk': 'USER#'+subject, 'sk': key, 'used': used+1, 'policyVersion': 1,\n              'lastRequestId': row['requestId'], 'created': row['created']}\n    def encode(item):\n        return {key: ({'BOOL': value} if isinstance(value, bool) else {'N': str(value)} if isinstance(value, int) else {'S': value}) for key, value in item.items()}\n    quota = {'TableName': os.environ['ENTITLEMENTS_TABLE'], 'Item': encode(marker),\n             'ConditionExpression': '#used = :expected' if current else 'attribute_not_exists(pk)',\n             **({'ExpressionAttributeNames': {'#used': 'used'}, 'ExpressionAttributeValues': {':expected': {'N': str(used)}}} if current else {})}\n    row['supportKind'] = kind\n    try:\n        # Two conditional puts consume the allowance and save the request atomically.\n        # Existing table-scoped PutItem permission covers both transactional puts.\n        boto3.client('dynamodb').transact_write_items(TransactItems=[\n            {'Put': quota},\n            {'Put': {'TableName': os.environ['ENTITLEMENTS_TABLE'], 'Item': encode(row), 'ConditionExpression': 'attribute_not_exists(pk)'}}\n        ])\n    except Exception as error:\n        response = getattr(error, 'response', {})\n        reasons = response.get('CancellationReasons', [])\n        if response.get('Error', {}).get('Code') == 'TransactionCanceledException' and any(reason.get('Code') == 'ConditionalCheckFailed' for reason in reasons):\n            return respond(429, {'error': 'Another request used this allowance. Refresh Premium to see your remaining support.'})\n        raise\n    return respond(201, {'requestId': row['requestId'], 'status': 'requested', 'support': support_usage(subject),\n                         'message': 'Saved for Alexis. Reply timing and availability are confirmed individually.'})\n\ndef save_mentoring(event, client, subject):\n    headers = {k.lower(): v for k, v in event.get('headers', {}).items()}\n    if headers.get('origin') != ORIGIN:\n        return respond(403, {'error': 'Invalid origin'})\n    allowed = has_premium_access(client, subject) if 'has_premium_access' in globals() else entitled(client, subject)\n    if not allowed:\n        return respond(403, {'error': 'A verified Premium purchase is required'})\n    raw = event.get('body', '')\n    if not isinstance(raw, str) or len(raw) > 16000:\n        return respond(400, {'error': 'Invalid mentoring request'})\n    try:\n        if event.get('isBase64Encoded'):\n            raw = base64.b64decode(raw, validate=True).decode('utf-8')\n        data = json.loads(raw)\n    except (ValueError, UnicodeError):\n        return respond(400, {'error': 'Invalid mentoring request'})\n    fields = {'topic', 'message', 'replyEmail', 'projectUrl', 'consent'}\n    if not isinstance(data, dict) or set(data) != fields or data.get('consent') is not True:\n        return respond(400, {'error': 'Consent and request fields are required'})\n    if data.get('topic') not in ('study-question', 'project-feedback', 'learning-plan'):\n        return respond(400, {'error': 'Choose a mentoring topic'})\n    message, email, url = data.get('message'), data.get('replyEmail'), data.get('projectUrl')\n    if not isinstance(message, str) or not 20 <= len(message.strip()) <= 3000:\n        return respond(400, {'error': 'Use 20 to 3000 characters for your question'})\n    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\\s@]+@[^\\s@]+\\.[^\\s@]+', email):\n        return respond(400, {'error': 'Enter a reply email'})\n    if not isinstance(url, str) or len(url) > 300 or (url and not re.fullmatch(r'https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+', url)):\n        return respond(400, {'error': 'Use an optional public GitHub repository URL'})\n    now = int(time.time())\n    request_id = str(now)+'-'+secrets.token_hex(8)\n    row = {'pk': 'USER#'+subject, 'sk': 'MENTOR#'+request_id, 'requestId': request_id, 'created': now,\n           'status': 'requested', 'topic': data['topic'], 'message': message.strip(),\n           'replyEmail': email, 'projectUrl': url, 'consent': True}\n    return save_support_request(subject, support_kind(data['topic'], message.strip()), row)\n"

def patch_code(source):
    if '# Linform support allowances v1' in source:
        compile(source, '<premium>', 'exec')
        return source
    tree = ast.parse(source)
    function = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'save_mentoring'), None)
    if function is None or 'def entitled(client,subject):' not in source or "claims.get('token_use')!='access'" not in source:
        raise ValueError('Unrecognized Premium backend; no changes made')
    lines = source.splitlines(keepends=True)
    updated = ''.join(lines[:function.lineno-1])+HELPERS+'\n\n'+''.join(lines[function.end_lineno:])
    target = "'amount':1500,'currency':'usd'"
    if updated.count(target) != 1:
        raise ValueError('Unrecognized access response; no changes made')
    updated = updated.replace(target, target+",'support':support_usage(subject)", 1)
    compile(updated, '<premium>', 'exec')
    return updated

def patch_template(template):
    updated = copy.deepcopy(template)
    resource = updated.get('Resources', {}).get('Function', {})
    props = resource.get('Properties', {})
    if resource.get('Type') != 'AWS::Lambda::Function' or props.get('Handler') != 'index.handler' or not props.get('Runtime', '').startswith('python'):
        raise ValueError('Unexpected Lambda resource; no changes made')
    code = props.get('Code', {})
    if set(code) != {'ZipFile'}:
        raise ValueError('Expected inline Lambda code; no changes made')
    code['ZipFile'] = patch_code(code['ZipFile'])
    return updated

def safe_changes(change, template):
    rows = [item.get('ResourceChange', {}) for item in change.get('Changes', [])]
    if change.get('NextToken') or sorted(row.get('LogicalResourceId', '') for row in rows) not in (['Function'], ['Function', 'Integration']):
        return False
    for row in rows:
        if row.get('Action') != 'Modify' or row.get('Replacement') != 'False' or row.get('Scope') != ['Properties']:
            return False
        details = row.get('Details', [])
        if not details:
            return False
        for detail in details:
            target = detail.get('Target', {})
            if target.get('Attribute') != 'Properties' or target.get('RequiresRecreation') != 'Never':
                return False
            if row['LogicalResourceId'] == 'Function':
                if row.get('ResourceType') != 'AWS::Lambda::Function' or target.get('Name') != 'Code' or detail.get('Evaluation') != 'Static' or detail.get('ChangeSource') != 'DirectModification':
                    return False
            else:
                integration = template.get('Resources', {}).get('Integration', {})
                if row.get('ResourceType') != 'AWS::ApiGatewayV2::Integration' or len(details) != 1 or target.get('Name') != 'IntegrationUri' or detail.get('Evaluation') != 'Dynamic' or detail.get('ChangeSource') != 'ResourceAttribute' or detail.get('CausingEntity') != 'Function.Arn' or integration.get('Properties', {}).get('IntegrationUri') != {'Fn::GetAtt': ['Function', 'Arn']}:
                    return False
    return True

def aws(*arguments):
    result = subprocess.run(['aws', *arguments, '--region', REGION, '--output', 'json', '--no-cli-pager'], check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else {}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--account-id', required=True)
    parser.add_argument('--stack-name', required=True)
    parser.add_argument('--review-only', action='store_true')
    options = parser.parse_args()
    if not re.fullmatch(r'[0-9]{12}', options.account_id):
        raise ValueError('Use your intended 12-digit AWS account ID')
    if aws('sts', 'get-caller-identity')['Account'] != options.account_id:
        raise RuntimeError('Wrong AWS account; no changes made')
    stack = aws('cloudformation', 'describe-stacks', '--stack-name', options.stack_name)['Stacks'][0]
    if stack['StackStatus'] not in ('CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'):
        raise RuntimeError('Stack is not stable; no changes made')
    template = aws('cloudformation', 'get-template', '--stack-name', options.stack_name, '--template-stage', 'Original')['TemplateBody']
    if isinstance(template, str):
        template = json.loads(template)
    updated = patch_template(template)
    if updated == template:
        print('Premium support limits are already installed. Refresh Premium to see your remaining requests.')
        return
    payload = json.dumps(updated)
    if len(payload.encode()) > 51200:
        raise RuntimeError('Template exceeds the direct update size limit; no changes made')
    with tempfile.TemporaryDirectory(prefix='linform-support-') as folder:
        path = Path(folder)/'template.json';path.write_text(payload)
        params = Path(folder)/'parameters.json'
        params.write_text(json.dumps([{'ParameterKey': item['ParameterKey'], 'UsePreviousValue': True} for item in stack.get('Parameters', [])]))
        name = 'linform-support-'+uuid.uuid4().hex[:12]
        result = aws('cloudformation', 'create-change-set', '--stack-name', options.stack_name, '--change-set-name', name, '--change-set-type', 'UPDATE', '--template-body', 'file://'+str(path), '--parameters', 'file://'+str(params), '--capabilities', *(stack.get('Capabilities') or ['CAPABILITY_IAM']))
        change_id = result['Id']
        print('Checking support-policy update…', flush=True)
        aws('cloudformation', 'wait', 'change-set-create-complete', '--stack-name', options.stack_name, '--change-set-name', change_id)
        change = aws('cloudformation', 'describe-change-set', '--stack-name', options.stack_name, '--change-set-name', change_id)
        if options.review_only or not safe_changes(change, template):
            summary = [{'resource': row.get('ResourceChange', {}).get('LogicalResourceId'), 'action': row.get('ResourceChange', {}).get('Action'), 'replacement': row.get('ResourceChange', {}).get('Replacement')} for row in change.get('Changes', [])]
            print(json.dumps({'changes': summary}, indent=2))
            aws('cloudformation', 'delete-change-set', '--stack-name', options.stack_name, '--change-set-name', change_id)
            if options.review_only:
                print('Review complete. No update executed.');return
            raise RuntimeError('Unexpected infrastructure change blocked; nothing executed')
        aws('cloudformation', 'execute-change-set', '--stack-name', options.stack_name, '--change-set-name', change_id)
        aws('cloudformation', 'wait', 'stack-update-complete', '--stack-name', options.stack_name)
        print('SUCCESS: Premium support limits enabled. Owner access, checkout, secrets and private content were preserved.')
        print('Monthly: one mentoring request and one custom-project request. Resume: one initial review and one final revision per account.')

if __name__ == '__main__':
    main()
