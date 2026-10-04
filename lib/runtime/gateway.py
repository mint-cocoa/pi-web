"""Private per-user execution gateway. SSH clients are disposable; jobs are not.
Only fixed Pi RPC and Codex app-server operations are exposed over an owner-only Unix socket.
"""
import base64, collections, concurrent.futures, fcntl, hashlib, json, os, pathlib, shutil, socket, socketserver, struct, subprocess, sys, threading, time, uuid

ROOT = pathlib.Path(os.environ.get('PI_WEB_RUNTIME_STATE', str(pathlib.Path.home() / '.local/state/pi-web-runtime')))
SOCKET = ROOT / 'gateway.sock'
MAX_FRAME = 16_000_000

def encode(value): return (json.dumps(value, ensure_ascii=True) + '\n').encode()
def message_text(content):
    if isinstance(content, str): return content
    if isinstance(content, list): return '\n'.join(str(x.get('text','')) for x in content if isinstance(x,dict) and x.get('type') in ('text','input_text','output_text'))
    return ''
def checked_cwd(value):
    if not isinstance(value,str) or len(value)>2000 or '\x00' in value: raise ValueError('Invalid working directory.')
    path=pathlib.Path(value).expanduser().resolve()
    if not path.is_dir() or not os.access(path,os.R_OK|os.X_OK): raise ValueError('Working directory is unavailable on this host.')
    return str(path)
def safe_id(value):
    if not isinstance(value,str) or not value or len(value)>200 or any(x in value for x in '/\\\r\n\x00'): raise ValueError('Invalid session id.')
    return value

class WebSocket:
    def __init__(self,path):
        self.sock=socket.socket(socket.AF_UNIX);self.sock.settimeout(10);self.sock.connect(str(path))
        key=base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        header=b''
        while not header.endswith(b'\r\n\r\n'):
            header+=self.exact(1)
            if len(header)>16000: raise ValueError('Invalid control socket handshake.')
        if not header.startswith(b'HTTP/1.1 101'): raise ValueError('Codex control socket refused connection.')
        expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if expected.lower() not in header.lower(): raise ValueError('Invalid WebSocket upgrade.')
        self.sock.settimeout(None);self.lock=threading.Lock()
    def exact(self,count):
        result=b''
        while len(result)<count:
            data=self.sock.recv(count-len(result))
            if not data: raise EOFError('Control socket closed.')
            result+=data
        return result
    def send(self,value,opcode=1):
        data=json.dumps(value).encode() if opcode==1 else value
        length=len(data);mask=os.urandom(4)
        header=bytes([0x80|opcode,0x80|length]) if length<126 else bytes([0x80|opcode,0xfe])+struct.pack('!H',length) if length<65536 else bytes([0x80|opcode,0xff])+struct.pack('!Q',length)
        with self.lock:self.sock.sendall(header+mask+bytes(x^mask[n%4]for n,x in enumerate(data)))
    def receive(self):
        chunks=[]
        while True:
            header=self.exact(2);opcode=header[0]&15;length=header[1]&127
            if length==126:length=struct.unpack('!H',self.exact(2))[0]
            elif length==127:length=struct.unpack('!Q',self.exact(8))[0]
            if length>MAX_FRAME:raise ValueError('Control message too large.')
            mask=self.exact(4) if header[1]&128 else None;data=self.exact(length)
            if mask:data=bytes(x^mask[n%4]for n,x in enumerate(data))
            if opcode==8:raise EOFError('Control socket closed.')
            if opcode==9:self.send(data,10);continue
            if opcode==10:continue
            if opcode not in (0,1):raise ValueError('Unsupported control frame.')
            chunks.append(data)
            if sum(map(len,chunks))>MAX_FRAME:raise ValueError('Control message too large.')
            if header[0]&128:return json.loads(b''.join(chunks))

class Rpc:
    def __init__(self,backend,callback,cwd=None,session_file=None):
        self.backend=backend;self.callback=callback;self.pending={};self.requests={};self.request_threads={};self.lock=threading.RLock();self.closed=False
        self.ws=None;self.proc=None
        if backend=='codex':
            control=pathlib.Path.home()/'.codex/app-server-control/app-server-control.sock'
            if control.exists():self.ws=WebSocket(control)
            else:
                binary=shutil.which('codex') or str(pathlib.Path.home()/'.local/bin/codex')
                self.proc=subprocess.Popen([binary,'app-server','--listen','stdio://'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        else:
            cli=shutil.which('pi');env=dict(os.environ)
            if cli:args=[cli,'--mode','rpc']
            else:
                base=pathlib.Path.home()/'apps/pi-web';node=base/'runtime/current/bin/node';script=base/'current/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
                if not node.is_file() or not script.is_file():raise ValueError('Pi runtime is not installed on this host.')
                args=[str(node),str(script),'--mode','rpc'];env['PATH']=str(node.parent)+':'+env.get('PATH','')
            if session_file:args+=['--session',str(session_file)]
            self.proc=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        threading.Thread(target=self.read_loop,daemon=True).start()
        if backend=='codex':
            self.call('initialize',{'clientInfo':{'name':'pi-web-runtime','title':'Pi Web','version':'0.1.0'},'capabilities':{'experimentalApi':True}})
            self.write({'method':'initialized'})
    def write(self,value):
        with self.lock:
            if self.closed:raise ValueError('Runtime connection closed.')
            if self.ws:self.ws.send(value)
            else:self.proc.stdin.write(encode(value));self.proc.stdin.flush()
    def call(self,method,params=None,timeout=30):
        identifier=uuid.uuid4().hex;future=concurrent.futures.Future()
        with self.lock:self.pending[identifier]=future
        value={'id':identifier,'method':method,'params':params or {}} if self.backend=='codex' else {'id':identifier,'type':method,**(params or {})}
        try:self.write(value);return future.result(timeout=timeout)
        finally:
            with self.lock:self.pending.pop(identifier,None)
    def reply(self,identifier,result):
        with self.lock:
            if identifier not in self.requests:raise ValueError('Approval request is no longer pending.')
            self.write({'id':identifier,'result':result} if self.backend=='codex' else {'type':'extension_ui_response','id':identifier,**result});self.requests.pop(identifier,None)
    def read_loop(self):
        try:
            while True:
                if self.ws:value=self.ws.receive()
                else:
                    line=self.proc.stdout.readline(MAX_FRAME+1)
                    if not line:raise EOFError()
                    if len(line)>MAX_FRAME:raise ValueError('Runtime frame too large.')
                    value=json.loads(line)
                identifier=value.get('id')
                with self.lock:future=self.pending.get(identifier)
                response=('result'in value or 'error'in value) if self.backend=='codex' else value.get('type')=='response'
                if future and response:
                    if value.get('error') or value.get('success') is False:
                        error=value.get('error');text=error.get('message','Runtime request failed.') if isinstance(error,dict) else str(error or 'Runtime request failed.')
                        future.set_exception(ValueError(text[:2000]))
                    else:future.set_result(value.get('result') if self.backend=='codex' else value.get('data'))
                else:
                    with self.lock:
                        if identifier is not None and 'method'in value:
                            self.requests[identifier]=value
                            if self.backend=='codex':self.request_threads[identifier]=value.get('params',{}).get('threadId')
                        if value.get('method')=='serverRequest/resolved':
                            params=value.setdefault('params',{});req=params.get('requestId');self.requests.pop(req,None)
                            thread=self.request_threads.pop(req,None)
                            if thread:params.setdefault('threadId',thread)
                        if self.backend=='pi' and value.get('type')=='agent_settled':self.requests.clear()
                        if value.get('method')=='turn/completed':
                            thread=value.get('params',{}).get('threadId')
                            for req in [req for req,pending in self.requests.items()if pending.get('params',{}).get('threadId')==thread]:self.requests.pop(req,None);self.request_threads.pop(req,None)
                    self.callback(value)
        except Exception:
            self.closed=True
            with self.lock:
                for future in self.pending.values():
                    if not future.done():future.set_exception(ValueError('Runtime transport disconnected.'))
            self.callback({'method':'gateway/disconnected','params':{}})

class Gateway:
    def __init__(self):
        self.lock=threading.RLock();self.start_lock=threading.Lock();self.create_lock=threading.Lock();self.codex=None;self.pi={};self.events=collections.deque(maxlen=3000);self.seq=0;self.loaded=set();self.turns={};self.receipts={}
        receipt=ROOT/'created.json'
        if receipt.exists():
            try:self.receipts=json.loads(receipt.read_text())
            except Exception:raise ValueError('Invalid creation receipt store.')
    def event(self,backend,session_id,value):
        params=value.get('params',{}) if backend=='codex' else value
        tid=params.get('threadId') or session_id
        if not tid and isinstance(params.get('thread'),dict):tid=params['thread'].get('id')
        if value.get('method')=='turn/started' and tid:self.turns[tid]=params.get('turn',{}).get('id')
        if value.get('method')=='turn/completed' and tid:self.turns.pop(tid,None)
        with self.lock:
            self.seq+=1;self.events.append({'seq':self.seq,'backend':backend,'sessionId':tid,'record':value})
    def codex_rpc(self):
        with self.start_lock:
            if self.codex is None or self.codex.closed:self.codex=Rpc('codex',lambda value:self.event('codex',None,value));self.loaded.clear()
            return self.codex
    def pi_files(self):
        root=pathlib.Path.home()/'.pi/agent/sessions';records={}
        if not root.is_dir():return records
        for n,path in enumerate(root.rglob('*.jsonl')):
            if n>=5000:break
            if path.is_symlink() or root.resolve() not in path.resolve().parents:continue
            try:
                with path.open() as file:header=json.loads(file.readline(100000))
                if header.get('type')!='session':continue
                records[header['id']]={'id':header['id'],'cwd':header.get('cwd',''),'title':header['id'],'updatedAt':path.stat().st_mtime,'path':path}
            except Exception:continue
        return records
    def pi_rpc(self,identifier):
        identifier=safe_id(identifier)
        with self.lock:
            rpc=self.pi.get(identifier)
            if rpc and not rpc.closed:return rpc
            saved=self.pi_files().get(identifier)
            if not saved:raise ValueError('Pi session not found on this host.')
            rpc=Rpc('pi',lambda value:self.event('pi',identifier,value),checked_cwd(saved['cwd']),saved['path']);self.pi[identifier]=rpc
            return rpc
    def read_thread(self,rpc,identifier):
        try:result=rpc.call('thread/read',{'threadId':identifier,'includeTurns':True})
        except ValueError as error:
            if 'not materialized yet'not in str(error):raise
            result=rpc.call('thread/read',{'threadId':identifier,'includeTurns':False});result['thread']['turns']=[]
        with rpc.lock:result['requests']=[value for value in rpc.requests.values()if value.get('params',{}).get('threadId')==identifier]
        return result
    def dispatch(self,request):
        method=request.get('method');backend=request.get('backend');params=request.get('params',{})
        if backend not in ('pi','codex') or not isinstance(params,dict):raise ValueError('Invalid runtime request.')
        if method=='info':
            boot=pathlib.Path('/proc/sys/kernel/random/boot_id')
            return {'hostname':socket.gethostname(),'user':__import__('getpass').getuser(),'bootId':boot.read_text().strip()if boot.is_file()else None,'home':str(pathlib.Path.home()),'codex':bool(shutil.which('codex') or (pathlib.Path.home()/'.local/bin/codex').is_file()),'pi':bool(shutil.which('pi') or (pathlib.Path.home()/'apps/pi-web/current/node_modules/@earendil-works/pi-coding-agent/dist/cli.js').is_file())}
        if method=='events':
            after=params.get('after',0)
            if not isinstance(after,int) or after<0:raise ValueError('Invalid event cursor.')
            with self.lock:
                batch=[x for x in self.events if x['backend']==backend and x['seq']>after][:400]
                return {'events':batch,'cursor':batch[-1]['seq']if len(batch)==400 else self.seq,'reset':after>self.seq or bool(self.events and after and after<self.events[0]['seq']-1)}
        if method=='create':
            key=params.get('requestId');fingerprint=json.dumps([backend,params.get('cwd'),params.get('model')],sort_keys=True)
            if not isinstance(key,str) or len(key)>100 or not key:raise ValueError('Creation request id is required.')
            with self.create_lock:
                if key in self.receipts:
                    receipt=self.receipts[key]
                    if receipt['fingerprint']!=fingerprint:raise ValueError('Creation request id was reused with different options.')
                    return receipt['result']
                cwd=checked_cwd(params.get('cwd'))
                if backend=='codex':
                    args={'cwd':cwd,'historyMode':'legacy'}
                    if params.get('model'):args['model']=params['model']
                    result=self.codex_rpc().call('thread/start',args);thread=result['thread'];self.loaded.add(thread['id']);created={'id':thread['id'],'cwd':thread.get('cwd',cwd),'title':thread.get('name') or 'New thread'}
                else:
                    holder={'id':None};rpc=Rpc('pi',lambda value:self.event('pi',holder['id'],value),cwd)
                    state=rpc.call('get_state');holder['id']=state['sessionId'];self.pi[state['sessionId']]=rpc
                    if params.get('model'):
                        model=params['model'];parts=model.split('/',1);rpc.call('set_model',{'provider':parts[0]if len(parts)>1 else 'openai-codex','modelId':parts[-1]})
                    created={'id':state['sessionId'],'cwd':cwd,'title':'New session'}
                self.receipts[key]={'fingerprint':fingerprint,'result':created};temporary=ROOT/'created.tmp';temporary.write_text(json.dumps(self.receipts));os.chmod(temporary,0o600);os.replace(temporary,ROOT/'created.json')
                return created
        if backend=='codex':
            rpc=self.codex_rpc()
            if method=='models':return rpc.call('model/list',{'limit':100})
            if method=='list':return rpc.call('thread/list',{'limit':min(int(params.get('limit',100)),300),**({'cursor':params['cursor']}if params.get('cursor')else {})})
            identifier=safe_id(params.get('sessionId'))
            if method=='open':
                metadata=rpc.call('thread/read',{'threadId':identifier,'includeTurns':False})['thread']
                if metadata.get('status',{}).get('type')=='notLoaded':rpc.call('thread/resume',{'threadId':identifier})
                self.loaded.add(identifier)
                return self.read_thread(rpc,identifier)
            if method=='state':return self.read_thread(rpc,identifier)
            if method=='send':
                if identifier not in self.loaded:raise ValueError('Open the session before sending.')
                message=params.get('message')
                if not isinstance(message,str) or not message.strip() or len(message)>100000:raise ValueError('Invalid message.')
                if identifier in self.turns:raise ValueError('Session is already running.')
                return rpc.call('turn/start',{'threadId':identifier,'input':[{'type':'text','text':message}]})
            if method=='interrupt':
                turn=self.turns.get(identifier)
                if not turn:
                    thread=rpc.call('thread/read',{'threadId':identifier,'includeTurns':True})['thread'];turn=next((x['id']for x in reversed(thread.get('turns',[]))if x.get('status')=='inProgress'),None)
                if turn:return rpc.call('turn/interrupt',{'threadId':identifier,'turnId':turn})
                return {}
            if method=='reply':
                req=params.get('requestId');pending=rpc.requests.get(req);payload=pending.get('params',{}) if pending else {}
                if payload.get('threadId')!=identifier:raise ValueError('Approval belongs to another session.')
                answer=params.get('answer')
                if not isinstance(answer,dict):raise ValueError('Invalid request answer.')
                operation=pending.get('method');decision=answer.get('decision')
                if operation in ('item/commandExecution/requestApproval','item/fileChange/requestApproval'):
                    if decision not in ('accept','decline','cancel'):raise ValueError('Invalid approval decision.')
                    result={'decision':decision}
                elif operation=='item/permissions/requestApproval':
                    if decision not in ('accept','decline'):raise ValueError('Invalid permission decision.')
                    result={'permissions':payload.get('permissions',{})if decision=='accept'else {},'scope':'turn'}
                elif operation=='item/tool/requestUserInput':
                    answers=answer.get('answers',{})
                    if not isinstance(answers,dict):raise ValueError('Invalid question answers.')
                    result={'answers':{question['id']:{'answers':[]if answer.get('cancelled')else [str(answers.get(question['id'],''))]}for question in payload.get('questions',[])}}
                else:raise ValueError('Unsupported runtime request type.')
                rpc.reply(req,result);return {}
        else:
            if method=='list':return {'data':[{k:v for k,v in row.items()if k!='path'} for row in sorted(self.pi_files().values(),key=lambda x:x['updatedAt'],reverse=True)[:300]]}
            if method=='models':
                if not self.pi:raise ValueError('Create or open a Pi session to inspect its models.')
                return next(iter(self.pi.values())).call('get_available_models')
            identifier=safe_id(params.get('sessionId'));rpc=self.pi_rpc(identifier)
            if method in ('open','state'):
                state=rpc.call('get_state');messages=rpc.call('get_messages')['messages']
                with rpc.lock:requests=list(rpc.requests.values())
                return {'state':state,'messages':messages,'requests':requests}
            if method=='send':
                message=params.get('message')
                if not isinstance(message,str) or not message.strip() or len(message)>100000:raise ValueError('Invalid message.')
                return rpc.call('prompt',{'message':message})
            if method=='interrupt':return rpc.call('abort')
            if method=='reply':
                req=params.get('requestId');pending=rpc.requests.get(req);answer=params.get('answer')
                if not pending or not isinstance(answer,dict):raise ValueError('Request is no longer pending.')
                operation=pending.get('method')
                if operation=='confirm':
                    if answer.get('decision')not in ('accept','decline'):raise ValueError('Invalid confirmation answer.')
                    result={'confirmed':answer['decision']=='accept'}
                elif operation in ('input','editor','select'):
                    result={'cancelled':True}if answer.get('cancelled')else {'value':str(answer.get('value')or answer.get('answers',{}).get('value',''))}
                    if operation=='select' and not result.get('cancelled')and result['value']not in pending.get('options',[]):raise ValueError('Invalid selection answer.')
                else:raise ValueError('Unsupported Pi request type.')
                rpc.reply(req,result);return {}
        raise ValueError('Unsupported runtime operation.')

def serve():
    ROOT.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(ROOT,0o700)
    lock=(ROOT/'gateway.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return
    if SOCKET.exists():SOCKET.unlink()
    gateway=Gateway()
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            if hasattr(socket,'SO_PEERCRED'):
                _pid,uid,_gid=struct.unpack('3i',self.request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                if uid!=os.getuid():return
            while True:
                line=self.rfile.readline(200001)
                if not line or len(line)>200000:return
                try:
                    request=json.loads(line);result=gateway.dispatch(request);response={'id':request.get('id'),'result':result}
                except Exception as error:response={'id':request.get('id')if 'request'in locals()else None,'error':str(error)[:2000]}
                try:self.wfile.write(encode(response));self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):return
    class Server(socketserver.ThreadingUnixStreamServer):daemon_threads=True
    with Server(str(SOCKET),Handler) as server:
        os.chmod(SOCKET,0o600);server.serve_forever()

def client():
    ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
    def connect():
        conn=socket.socket(socket.AF_UNIX);conn.connect(str(SOCKET));return conn
    try:conn=connect()
    except OSError:
        log_path=ROOT/'gateway.log';fd=os.open(log_path,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
        with os.fdopen(fd,'ab') as log:subprocess.Popen([sys.executable,__file__,'--server'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        for attempt in range(50):
            try:conn=connect();break
            except OSError:time.sleep(.1)
        else:raise ValueError('Execution gateway did not start.')
    reader=conn.makefile('rb')
    def relay():
        for line in reader:
            sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
    threading.Thread(target=relay,daemon=True).start()
    try:
        while True:
            line=sys.stdin.buffer.readline(200001)
            if not line or len(line)>200000:break
            conn.sendall(line)
    finally:conn.close()

if __name__=='__main__':
    if '--server'in sys.argv:serve()
    elif '--client'in sys.argv:client()
    else:raise SystemExit('Use --server or --client.')
