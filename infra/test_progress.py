import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest

class FakeTable:
    def __init__(self): self.items = {}
    def batch_writer(self): return self
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def put_item(self, Item): self.items[(Item['userId'], Item['lessonId'])] = Item
    def query(self, **kwargs):
        user = kwargs['ExpressionAttributeValues'][':u']
        return {'Items': [{'lessonId': lesson} for account, lesson in self.items if account == user]}

table = FakeTable()
os.environ['TABLE_NAME'] = 'test'
sys.modules['boto3'] = types.SimpleNamespace(resource=lambda name: types.SimpleNamespace(Table=lambda name: table))
spec = importlib.util.spec_from_file_location('progress', Path(__file__).with_name('progress.py'))
progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progress)

class ProgressTests(unittest.TestCase):
    def setUp(self): table.items.clear()
    def event(self, method='GET', body=None, user='student-a'):
        return {'requestContext': {'http': {'method': method}, 'authorizer': {'jwt': {'claims': {'sub': user, 'token_use': 'access'}}}}, 'body': json.dumps(body)}
    def call(self, event):
        result = progress.handler(event, None)
        return result['statusCode'], json.loads(result['body'])
    def test_missing_auth_and_id_tokens_rejected(self):
        self.assertEqual(self.call({})[0], 401)
        event = self.event(); event['requestContext']['authorizer']['jwt']['claims']['token_use'] = 'id'
        self.assertEqual(self.call(event)[0], 401)
    def test_account_isolation(self):
        self.call(self.event('PUT', {'completed': ['linux-location']}, 'student-a'))
        self.assertEqual(self.call(self.event(user='student-b'))[1]['completed'], [])
        self.assertEqual(self.call(self.event(user='student-a'))[1]['completed'], ['linux-location'])
    def test_two_devices_merge_without_lost_completion(self):
        for ids in [['linux-location'], ['aws-foundations'], ['linux-location']]:
            self.assertEqual(self.call(self.event('PUT', {'completed': ids}))[0], 200)
        self.assertEqual(set(self.call(self.event())[1]['completed']), {'linux-location', 'aws-foundations'})
    def test_client_cannot_override_subject(self):
        self.assertEqual(self.call(self.event('PUT', {'completed': ['linux-location'], 'userId': 'victim'}))[0], 400)
        self.assertFalse(table.items)
    def test_bad_data_rejected(self):
        for data in [{'completed': ['../secret']}, {'completed': [True]}, {'completed': ['valid'] * 201}, [], None, {'completed': 'all'}]:
            self.assertEqual(self.call(self.event('PUT', data))[0], 400)
        event = self.event('PUT'); event['body'] = '{'; self.assertEqual(self.call(event)[0], 400)
    def test_unsupported_method(self):
        self.assertEqual(self.call(self.event('DELETE'))[0], 405)
    def test_template_has_scoped_auth_and_no_secret(self):
        template = json.loads(Path(__file__).with_name('accounts.template.json').read_text())
        resources = template['Resources']
        self.assertFalse(resources['Client']['Properties']['GenerateSecret'])
        self.assertEqual(resources['Client']['Properties']['AllowedOAuthFlows'], ['code'])
        for method in ['GET', 'PUT']:
            props = resources[method + 'Route']['Properties']
            self.assertEqual(props['AuthorizationType'], 'JWT')
            self.assertEqual(props['AuthorizationScopes'], ['openid'])
        self.assertEqual(resources['ProgressTable']['DeletionPolicy'], 'Retain')

if __name__ == '__main__': unittest.main()
