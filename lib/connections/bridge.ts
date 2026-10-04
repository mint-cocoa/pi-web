// Fixed read-only helper, passed as a quoted SSH command. No caller paths or code.
// The remote process keeps the session-id -> file map; browsers never choose files.
export const REMOTE_BRIDGE = String.raw`
import os, sys, json, socket, getpass, pathlib, hashlib, shutil, datetime, stat, sqlite3
home = pathlib.Path.home()
roots = {'pi': home / '.pi/agent/sessions', 'codex': home / '.codex/sessions'}
index = {}
def text(content):
    if isinstance(content, str): return content[:6000]
    if isinstance(content, list): return '\n'.join(str(x.get('text', '')) for x in content if isinstance(x, dict) and x.get('type') in ('text', 'input_text', 'output_text'))[:6000]
    return ''
def human_message(message):
    if not isinstance(message, dict) or message.get('role') != 'user': return False
    metadata = message.get('internal_chat_message_metadata_passthrough')
    kinds = metadata.get('content_item_kinds') if isinstance(metadata, dict) else None
    if isinstance(kinds, list): return any(isinstance(kind, str) and kind.startswith('user.') for kind in kinds)
    value = text(message.get('content')).lstrip()
    return bool(value) and not value.startswith(('# AGENTS.md instructions', '<environment_context>', '<recommended_plugins>', '<in-app-browser-context', '<app-context>', '<skills_instructions>'))
def regular(path, root):
    try: return root.resolve() in path.resolve().parents and stat.S_ISREG(path.lstat().st_mode) and not path.is_symlink()
    except OSError: return False
def records(path, root, max_bytes=12000000):
    if not regular(path, root): raise ValueError('Session is unavailable.')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    with os.fdopen(os.open(path, flags), 'rb') as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode): raise ValueError('Session is unavailable.')
        total = 0
        while total < max_bytes:
            raw = f.readline(min(1000000, max_bytes - total) + 1)
            if not raw: return
            total += len(raw)
            if len(raw) > 1000000 or total > max_bytes: return
            try:
                value = json.loads(raw)
                if isinstance(value, dict): yield value
            except (ValueError, UnicodeError): continue
def codex_metadata():
    # Native thread titles are not the injected setup messages in rollout files.
    files = sorted((home / '.codex').glob('state_*.sqlite'), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files:
        if path.is_symlink(): continue
        try:
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1) as db:
                columns = {row[1] for row in db.execute('pragma table_info(threads)')}
                if not {'id', 'title'}.issubset(columns): continue
                archived = 'archived' if 'archived' in columns else '0'
                pinned = 'is_pinned' if 'is_pinned' in columns else '0'
                order = ' ORDER BY updated_at DESC' if 'updated_at' in columns else ''
                title = "COALESCE(NULLIF(name,''),title)" if 'name' in columns else 'title'
                query = 'SELECT id,' + title + ',' + archived + ',' + pinned + ' FROM threads' + order + ' LIMIT 10000'
                return {row[0]: {'title': str(row[1] or '')[:160], 'archived': bool(row[2]), 'pinned': bool(row[3])} for row in db.execute(query)}
        except (OSError, sqlite3.Error): continue
    return {}
def inventory():
    index.clear()
    files = []
    limited = False
    for backend, root in roots.items():
        if not root.is_dir(): continue
        count = 0
        for folder, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not pathlib.Path(folder, d).is_symlink()]
            for name in names:
                if not name.endswith('.jsonl'): continue
                path = pathlib.Path(folder, name)
                if not regular(path, root): continue
                try: files.append((path.stat().st_mtime, backend, path))
                except OSError: continue
                count += 1
                if count >= 5000: limited = True; break
            if count >= 5000: break
    files.sort(reverse=True)
    sessions = []
    thread_metadata = codex_metadata()
    for modified, backend, path in files[:300]:
        try:
            iterator = records(path, roots[backend], 256000)
            header = next(iterator, {})
            meta = header.get('payload', {}) if backend == 'codex' else header
            if not isinstance(meta, dict): continue
            cwd = str(meta.get('cwd', ''))[:1000]
            title = ''
            for n, row in enumerate(iterator):
                if n >= 40: break
                if row.get('type') == 'session_info': title = str(row.get('name', ''))[:160]; break
                msg = row.get('message', {}) if backend == 'pi' else row.get('payload', {})
                if not isinstance(msg, dict): continue
                if backend == 'pi' and msg.get('role') == 'user': title = text(msg.get('content'))[:160]; break
                if backend == 'codex' and row.get('type') == 'response_item' and human_message(msg): title = text(msg.get('content'))[:160]; break
                if backend == 'codex' and row.get('type') == 'event_msg' and msg.get('type') == 'user_message': title = str(msg.get('message', ''))[:160]; break
            thread = thread_metadata.get(meta.get('id'), {}) if backend == 'codex' else {}
            title = thread.get('title') or title
            sid = hashlib.sha256((backend + ':' + str(path.relative_to(roots[backend]))).encode()).hexdigest()
            index[sid] = (backend, path)
            sessions.append({'id': sid, 'backend': backend, 'title': title or str(meta.get('id', path.stem))[:160], 'cwd': cwd, 'updatedAt': datetime.datetime.fromtimestamp(modified, datetime.timezone.utc).isoformat(), 'archived': bool(thread.get('archived')), 'pinned': bool(thread.get('pinned'))})
        except (OSError, ValueError, TypeError): continue
    pi_candidates = [home / '.local/bin/pi', home / 'apps/pi-web/npm/lib/node_modules/@agegr/pi-web/node_modules/@earendil-works/pi-coding-agent/dist/cli.js']
    codex_candidates = [home / '.local/bin/codex']
    return {'hostname': socket.gethostname(), 'user': getpass.getuser(), 'agents': {'pi': bool(shutil.which('pi') or any(p.is_file() for p in pi_candidates)), 'codex': bool(shutil.which('codex') or any(p.is_file() for p in codex_candidates))}, 'sessions': sessions, 'truncated': limited or len(files) > 300}
def transcript(sid):
    if sid not in index: raise ValueError('Refresh the session list before opening this session.')
    backend, path = index[sid]
    messages = []
    count = 0
    for row in records(path, roots[backend]):
        count += 1
        payload = row.get('payload', {})
        if not isinstance(payload, dict): payload = {}
        if backend == 'pi' and row.get('type') == 'message': msg = row.get('message', {})
        elif backend == 'codex' and row.get('type') == 'event_msg' and payload.get('type') == 'user_message': msg = {'role': 'user', 'content': payload.get('message', '')}
        elif backend == 'codex' and row.get('type') == 'response_item' and payload.get('type') == 'message' and (payload.get('role') == 'assistant' or human_message(payload)): msg = payload
        else: continue
        if not isinstance(msg, dict): continue
        role = msg.get('role', '')
        if role not in ('user', 'assistant'): continue
        value = text(msg.get('content'))
        if value:
            message = {'role': role, 'text': value}
            # Older rollouts may contain both a user event and its response item.
            if role != 'user' or not messages or messages[-1] != message: messages.append(message)
        if len(messages) > 100: messages.pop(0)
    return {'messages': messages, 'truncated': count > 100 or path.stat().st_size > 12000000}
for line in sys.stdin:
    if len(line) > 4096: break
    try:
        request = json.loads(line)
        method = request.get('method')
        if method == 'inventory': result = inventory()
        elif method == 'transcript': result = transcript(request.get('sessionId'))
        elif method == 'ping': result = {'alive': True}
        else: raise ValueError('Unsupported operation.')
        response = {'id': request.get('id'), 'result': result}
    except Exception:
        response = {'id': request.get('id') if 'request' in locals() else None, 'error': 'Remote session data is unavailable. Refresh the session list.'}
    print(json.dumps(response, ensure_ascii=True), flush=True)
`;
