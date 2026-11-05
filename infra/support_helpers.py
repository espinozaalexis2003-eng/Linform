# Linform support allowances v1. Only this helper block and save_mentoring are patched into live code.
def support_period(now=None):
    return time.strftime('%Y-%m', time.gmtime(time.time() if now is None else now))

def support_usage(subject):
    period = support_period()
    def used(key):
        row = table.get_item(Key={'pk': 'USER#'+subject, 'sk': key}, ConsistentRead=True).get('Item') or {}
        return int(row.get('used', 0))
    return {'policyVersion': 1, 'month': period,
            'mentoringUsed': used('SUPPORT#MENTORING#'+period),
            'customProjectUsed': used('SUPPORT#CUSTOM#'+period),
            'resumeUsed': used('SUPPORT#RESUME')}

def support_kind(topic, message):
    # Preserve compatibility with the existing public request contract.
    if topic == 'learning-plan' and message.startswith('[Resume final revision]\n'):
        return 'resume-revision'
    if topic == 'learning-plan' and message.startswith('[Resume review]\n'):
        return 'resume-review'
    if topic == 'project-feedback' and message.startswith('[Custom project]\n'):
        return 'custom-project'
    return 'mentoring'

def save_support_request(subject, kind, row):
    period = support_period(row['created'])
    key = 'SUPPORT#RESUME' if kind.startswith('resume-') else ('SUPPORT#CUSTOM#' if kind == 'custom-project' else 'SUPPORT#MENTORING#')+period
    current = table.get_item(Key={'pk': 'USER#'+subject, 'sk': key}, ConsistentRead=True).get('Item') or {}
    used = int(current.get('used', 0))
    if kind == 'resume-revision' and used == 0:
        return respond(409, {'error': 'Submit your initial resume review before the final revision.'})
    limit = 2 if kind == 'resume-revision' else 1
    if used >= limit:
        label = 'Your resume review and final revision have been used.' if kind == 'resume-revision' else 'Your initial resume review has been requested; use the final revision option after receiving feedback.' if kind == 'resume-review' else 'Your custom-project request for this calendar month has been used.' if kind == 'custom-project' else 'Your mentoring request for this calendar month has been used.'
        return respond(429, {'error': label})
    marker = {'pk': 'USER#'+subject, 'sk': key, 'used': used+1, 'policyVersion': 1,
              'lastRequestId': row['requestId'], 'created': row['created']}
    def encode(item):
        return {key: ({'BOOL': value} if isinstance(value, bool) else {'N': str(value)} if isinstance(value, int) else {'S': value}) for key, value in item.items()}
    quota = {'TableName': os.environ['ENTITLEMENTS_TABLE'], 'Item': encode(marker),
             'ConditionExpression': '#used = :expected' if current else 'attribute_not_exists(pk)',
             **({'ExpressionAttributeNames': {'#used': 'used'}, 'ExpressionAttributeValues': {':expected': {'N': str(used)}}} if current else {})}
    row['supportKind'] = kind
    try:
        # Two conditional puts consume the allowance and save the request atomically.
        # Existing table-scoped PutItem permission covers both transactional puts.
        boto3.client('dynamodb').transact_write_items(TransactItems=[
            {'Put': quota},
            {'Put': {'TableName': os.environ['ENTITLEMENTS_TABLE'], 'Item': encode(row), 'ConditionExpression': 'attribute_not_exists(pk)'}}
        ])
    except Exception as error:
        response = getattr(error, 'response', {})
        reasons = response.get('CancellationReasons', [])
        if response.get('Error', {}).get('Code') == 'TransactionCanceledException' and any(reason.get('Code') == 'ConditionalCheckFailed' for reason in reasons):
            return respond(429, {'error': 'Another request used this allowance. Refresh Premium to see your remaining support.'})
        raise
    return respond(201, {'requestId': row['requestId'], 'status': 'requested', 'support': support_usage(subject),
                         'message': 'Saved for Alexis. Reply timing and availability are confirmed individually.'})

def save_mentoring(event, client, subject):
    headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
    if headers.get('origin') != ORIGIN:
        return respond(403, {'error': 'Invalid origin'})
    allowed = has_premium_access(client, subject) if 'has_premium_access' in globals() else entitled(client, subject)
    if not allowed:
        return respond(403, {'error': 'A verified Premium purchase is required'})
    raw = event.get('body', '')
    if not isinstance(raw, str) or len(raw) > 16000:
        return respond(400, {'error': 'Invalid mentoring request'})
    try:
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw, validate=True).decode('utf-8')
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        return respond(400, {'error': 'Invalid mentoring request'})
    fields = {'topic', 'message', 'replyEmail', 'projectUrl', 'consent'}
    if not isinstance(data, dict) or set(data) != fields or data.get('consent') is not True:
        return respond(400, {'error': 'Consent and request fields are required'})
    if data.get('topic') not in ('study-question', 'project-feedback', 'learning-plan'):
        return respond(400, {'error': 'Choose a mentoring topic'})
    message, email, url = data.get('message'), data.get('replyEmail'), data.get('projectUrl')
    if not isinstance(message, str) or not 20 <= len(message.strip()) <= 3000:
        return respond(400, {'error': 'Use 20 to 3000 characters for your question'})
    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        return respond(400, {'error': 'Enter a reply email'})
    if not isinstance(url, str) or len(url) > 300 or (url and not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+', url)):
        return respond(400, {'error': 'Use an optional public GitHub repository URL'})
    now = int(time.time())
    request_id = str(now)+'-'+secrets.token_hex(8)
    row = {'pk': 'USER#'+subject, 'sk': 'MENTOR#'+request_id, 'requestId': request_id, 'created': now,
           'status': 'requested', 'topic': data['topic'], 'message': message.strip(),
           'replyEmail': email, 'projectUrl': url, 'consent': True}
    return save_support_request(subject, support_kind(data['topic'], message.strip()), row)
