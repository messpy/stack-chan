"""Fail-closed GitHub identity checks shared by the kmac Issue consumers."""
import json
import subprocess
from datetime import datetime, timezone

REPO = 'messpy/stack-chan'
ISSUE = 111
OWNER = 'messpy'
OWNER_ID = 110882522  # Stable GitHub account id; a login alone is insufficient.


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('timestamp required')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None or result.utcoffset().total_seconds() != 0:
        raise ValueError('UTC timestamp required')
    return result


def verified_comment(comment):
    """Re-read an immutable id; do not trust body/login supplied by callers."""
    try:
        cid = comment['id']
        if type(cid) is not int or cid <= 0:
            return None
        result = subprocess.run(
            ['gh', 'api', f'repos/{REPO}/issues/comments/{cid}'],
            capture_output=True, text=True, timeout=60, check=True)
        fresh = json.loads(result.stdout)
        user = fresh.get('user', {})
        if (type(fresh.get('id')) is not int or fresh['id'] != cid
                or fresh.get('issue_url') != f'https://api.github.com/repos/{REPO}/issues/{ISSUE}'
                or user.get('login') != OWNER or type(user.get('id')) is not int
                or user['id'] != OWNER_ID or user.get('type') != 'User'
                or fresh.get('author_association') != 'OWNER'
                or fresh.get('body') != comment.get('body')
                or fresh.get('created_at') != fresh.get('updated_at')):
            return None
        created = timestamp(fresh['created_at'])
        if created > datetime.now(timezone.utc):
            return None
        return fresh
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
        return None
