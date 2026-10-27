"""Lambda integration; API Gateway validates JWT signature/audience/scope first."""
import base64
import json
import os
import re

import boto3

_table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
_ID = re.compile(r"[a-z][a-z0-9-]{0,79}\Z")
_SUB = re.compile(r"[a-zA-Z0-9-]{1,128}\Z")


def response(code, value):
    return {"statusCode": code,
            "headers": {"content-type": "application/json", "cache-control": "no-store"},
            "body": json.dumps(value)}


def handler(event, context):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    subject = claims.get("sub", "")
    if not isinstance(subject, str) or not _SUB.fullmatch(subject) or claims.get("token_use") != "access":
        return response(401, {"error": "Authentication required"})
    method = event.get("requestContext", {}).get("http", {}).get("method")
    if method not in ("GET", "PUT"):
        return response(405, {"error": "Method not allowed"})
    try:
        if method == "PUT":
            raw = event.get("body", "")
            if not isinstance(raw, str) or len(raw) > 24000:
                return response(400, {"error": "Invalid progress data"})
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            data = json.loads(raw)
            ids = data.get("completed") if isinstance(data, dict) else None
            if (not isinstance(ids, list) or len(ids) > 200 or set(data) != {"completed"}
                    or any(not isinstance(i, str) or not _ID.fullmatch(i) for i in ids)):
                return response(400, {"error": "Expected up to 200 valid lesson IDs"})
            # One immutable completion per lesson avoids lost updates from other devices.
            with _table.batch_writer() as writer:
                for lesson_id in set(ids):
                    writer.put_item(Item={"userId": subject, "lessonId": lesson_id})
            return response(200, {"saved": True})
        result = []
        args = {"KeyConditionExpression": "userId = :u", "ExpressionAttributeValues": {":u": subject},
                "ConsistentRead": True, "ProjectionExpression": "lessonId"}
        while True:
            page = _table.query(**args)
            result.extend(item["lessonId"] for item in page.get("Items", []))
            if len(result) > 5000:
                return response(413, {"error": "Account progress is too large"})
            if "LastEvaluatedKey" not in page:
                break
            args["ExclusiveStartKey"] = page["LastEvaluatedKey"]
        return response(200, {"userId": subject, "completed": result})
    except (ValueError, UnicodeDecodeError, TypeError):
        return response(400, {"error": "Invalid progress data"})
    except Exception:
        # Never log bearer tokens, emails, request bodies, or exception payloads.
        return response(503, {"error": "Progress service temporarily unavailable"})
