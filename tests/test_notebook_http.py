import json
import socket
import thread
import urllib

from keepnote import notebook as notebooklib
from keepnote.notebook.connection.http import NoteBookConnectionHttp
from keepnote.notebook.connection import mem
from keepnote.server import NoteBookHttpServer

from .test_notebook_conn import TestConnBase


class TestHttp(TestConnBase):

    def test_api(self):
        # Make pure memory notebook.
        self.conn = mem.NoteBookConnectionMem()
        self.notebook = notebooklib.NoteBook()
        self.notebook.create('', self.conn)

        # Start server in another thread
        host = "localhost"
        self.port = 8123
        url = "http://%s:%d/notebook/" % (host, self.port)
        server = NoteBookHttpServer(self.conn, port=self.port)
        thread.start_new_thread(server.serve_forever, ())

        # Connect to server.
        self.conn2 = NoteBookConnectionHttp()
        self.conn2.connect(url)

        # Wait for server to start.
        while True:
            try:
                self.conn2.get_rootid()
                break
            except socket.error:
                # Try again.
                pass

        # Test full notebook API.
        self._test_api(self.conn2)

        # Test new node without specifying nodeid.
        attr = {
            "key1": 123,
            "key2": 456,
        }
        data = urllib.urlopen(url + 'nodes/', json.dumps(attr)).read()
        nodeid = json.loads(data)['nodeid']
        data = urllib.urlopen(url + 'nodes/%s' % nodeid).read()
        attr2 = json.loads(data)
        self.assertEqual(attr, attr2)

        # Close server.
        server.shutdown()
