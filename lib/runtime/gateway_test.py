"""Tests use temporary stores and fake RPCs; they never start a user's agent."""
import importlib.util, json, pathlib, socket, struct, tempfile, unittest

spec=importlib.util.spec_from_file_location('gateway',pathlib.Path(__file__).with_name('gateway.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

class FakeRpc:
    def __init__(self):self.requests={};self.calls=[];self.closed=False;self.lock=g.threading.RLock()
    def call(self,method,params=None):
        self.calls.append((method,params))
        if method=='thread/start':return {'thread':{'id':'new-thread','cwd':params['cwd']}}
        if method=='thread/read':return {'thread':{'id':'new-thread','turns':[]}}
        return {}
    def reply(self,identifier,result):self.calls.append(('reply',result));self.requests.pop(identifier)

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.original=g.ROOT;g.ROOT=pathlib.Path(self.temp.name)
        self.gateway=g.Gateway();self.rpc=FakeRpc();self.gateway.codex=self.rpc
    def tearDown(self):g.ROOT=self.original;self.temp.cleanup()
    def call(self,method,**params):return self.gateway.dispatch({'backend':'codex','method':method,'params':params})
    def test_creation_receipt_is_persistent_and_checks_fingerprint(self):
        first=self.call('create',cwd=self.temp.name,requestId='one')
        self.assertEqual(first,self.call('create',cwd=self.temp.name,requestId='one'))
        self.assertEqual(len([x for x in self.rpc.calls if x[0]=='thread/start']),1)
        self.assertEqual(self.rpc.calls[0][1]['historyMode'],'legacy')
        restarted=g.Gateway();restarted.codex=self.rpc
        self.assertEqual(first,restarted.dispatch({'backend':'codex','method':'create','params':{'cwd':self.temp.name,'requestId':'one'}}))
        with self.assertRaises(ValueError):self.call('create',cwd=self.temp.name,requestId='one',model='changed')
    def test_event_batches_do_not_skip_a_burst_larger_than_400(self):
        for n in range(950):self.gateway.event('codex','thread',{'method':'delta','params':{'n':n}})
        a=self.call('events',after=0);b=self.call('events',after=a['cursor']);c=self.call('events',after=b['cursor'])
        self.assertEqual([len(x['events'])for x in (a,b,c)],[400,400,150]);self.assertEqual(c['cursor'],950)
    def test_empty_thread_reads_metadata_until_first_message_is_materialized(self):
        original=self.rpc.call
        def read(method,params=None):
            if method=='thread/read' and params.get('includeTurns'):raise ValueError('thread is not materialized yet; includeTurns is unavailable before first user message')
            return original(method,params)
        self.rpc.call=read
        self.assertEqual(self.gateway.read_thread(self.rpc,'new-thread')['thread']['turns'],[])
    def test_questions_and_permissions_have_protocol_specific_responses(self):
        self.rpc.requests[4]={'method':'item/tool/requestUserInput','params':{'threadId':'thread','questions':[{'id':'q'}]}}
        self.call('reply',sessionId='thread',requestId=4,answer={'answers':{'q':'one'}})
        self.assertEqual(self.rpc.calls[-1][1],{'answers':{'q':{'answers':['one']}}})
        self.rpc.requests[5]={'method':'item/permissions/requestApproval','params':{'threadId':'thread','permissions':{'network':{'enabled':True}}}}
        self.call('reply',sessionId='thread',requestId=5,answer={'decision':'decline'})
        self.assertEqual(self.rpc.calls[-1][1],{'permissions':{},'scope':'turn'})
    def test_cross_thread_approval_cannot_be_answered(self):
        self.rpc.requests[4]={'method':'item/commandExecution/requestApproval','params':{'threadId':'other'}}
        with self.assertRaises(ValueError):self.call('reply',sessionId='thread',requestId=4,answer={'decision':'accept'})
        self.assertIn(4,self.rpc.requests)
    def test_running_turn_cannot_admit_a_second_send(self):
        self.gateway.loaded.add('thread');self.gateway.turns['thread']='turn'
        with self.assertRaises(ValueError):self.call('send',sessionId='thread',message='hello')
        self.assertEqual(self.rpc.calls,[])
    def test_attaching_to_a_loaded_thread_does_not_resume_a_second_executor(self):
        self.call('open',sessionId='new-thread')
        self.assertFalse(any(method=='thread/resume'for method,params in self.rpc.calls))
        self.assertIn('new-thread',self.gateway.loaded)
    def test_paths_and_method_allowlist_are_validated(self):
        for identifier in ('../thread','a/b','a\n'):
            with self.assertRaises(ValueError):self.call('state',sessionId=identifier)
        with self.assertRaises(ValueError):self.call('shell',sessionId='thread')
        with self.assertRaises(ValueError):g.checked_cwd('/missing/pi-web-test-folder')
    def test_websocket_fragmentation_and_ping_are_handled(self):
        left,right=socket.socketpair();ws=g.WebSocket.__new__(g.WebSocket);ws.sock=left;ws.lock=g.threading.Lock()
        try:
            right.sendall(bytes([0x01,5])+b'{"ok"'+bytes([0x89,1])+b'p'+bytes([0x80,6])+b':true}')
            self.assertEqual(ws.receive(),{'ok':True});pong=right.recv(20)
            self.assertEqual(pong[0],0x8a);self.assertTrue(pong[1]&0x80)
        finally:left.close();right.close()
    def test_resolved_approval_retains_its_thread_route_for_all_attached_views(self):
        records=[{'id':4,'method':'item/tool/requestUserInput','params':{'threadId':'thread'}},{'method':'serverRequest/resolved','params':{'requestId':4}}]
        class Stream:
            def receive(self):
                if records:return records.pop(0)
                raise EOFError()
        received=[];rpc=g.Rpc.__new__(g.Rpc);rpc.backend='codex';rpc.ws=Stream();rpc.lock=g.threading.RLock();rpc.pending={};rpc.requests={};rpc.request_threads={};rpc.callback=received.append
        rpc.read_loop()
        self.assertEqual(received[1]['params']['threadId'],'thread');self.assertEqual(rpc.requests,{})

if __name__=='__main__':unittest.main()
