//go:build windows

package host

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
)

func rpcPair(t *testing.T, delay time.Duration, body string) *managerRPC {
	t.Helper()
	server, client := net.Pipe()
	go func() {
		defer client.Close()
		request, err := http.ReadRequest(bufio.NewReader(client))
		if err != nil {
			return
		}
		_ = request.Body.Close()
		time.Sleep(delay)
		_, _ = fmt.Fprintf(client, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", len(body), body)
	}()
	return &managerRPC{conn: server, reader: bufio.NewReaderSize(server, protocol.MaxControlResultBytes+1)}
}

func rpcRequest() protocol.Request {
	return protocol.Request{Method: "GET", Route: "/api/control/status"}
}

func TestManagerRPCSurvivesMoreThanNodeDefaultKeepAlive(t *testing.T) {
	rpc := rpcPair(t, 5100*time.Millisecond, `{"ready":true}`)
	defer rpc.Close()
	status, _, err := rpc.exchange(rpcRequest(), 6*time.Second)
	if err != nil || status != 200 {
		t.Fatalf("idle-safe exchange failed: status=%d err=%v", status, err)
	}
}

func TestManagerRPCDiscardsTimedOutOrOversizedConnectionBeforeNextRequest(t *testing.T) {
	for _, test := range []struct {
		name    string
		delay   time.Duration
		body    string
		timeout time.Duration
	}{
		{name: "delayed", delay: 50 * time.Millisecond, body: `{"old":true}`, timeout: time.Millisecond},
		{name: "oversized", body: `"` + strings.Repeat("x", protocol.MaxControlResultBytes) + `"`, timeout: time.Second},
	} {
		t.Run(test.name, func(t *testing.T) {
			rpc := rpcPair(t, test.delay, test.body)
			if _, _, err := rpc.exchange(rpcRequest(), test.timeout); err == nil || rpc.conn != nil || rpc.reader != nil {
				t.Fatalf("failed exchange retained transport: %v", err)
			}
			next := rpcPair(t, 0, `{"next":true}`)
			rpc.conn, rpc.reader = next.conn, next.reader
			status, body, err := rpc.exchange(rpcRequest(), time.Second)
			if err != nil || status != 200 || string(body) != `{"next":true}` {
				t.Fatalf("next exchange was polluted: status=%d body=%s err=%v", status, body, err)
			}
		})
	}
}
