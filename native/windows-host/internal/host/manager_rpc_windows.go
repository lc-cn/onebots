//go:build windows

package host

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
)

const managerRPCConnectTimeout = 30 * time.Second
const managerRPCMaxTimeout = 120 * time.Second

type managerRPC struct {
	listener    net.Listener
	conn        net.Conn
	reader      *bufio.Reader
	mu          sync.Mutex
	serviceSID  string
	managerPID  uint32
	pendingConn chan net.Conn
	pendingErr  chan error
}

func createManagerRPCPipe() (*managerRPC, string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return nil, "", fmt.Errorf("generate manager RPC pipe name: %w", err)
	}
	pipeName := `\\.\pipe\onebots-manager-rpc-` + hex.EncodeToString(random)
	sddl, allowed, err := controlPipeSecurity("")
	if err != nil {
		return nil, "", err
	}
	listener, err := winio.ListenPipe(pipeName, &winio.PipeConfig{
		SecurityDescriptor: sddl,
		MessageMode:        false,
		InputBufferSize:    protocol.MaxMessageBytes,
		OutputBufferSize:   protocol.MaxMessageBytes,
	})
	if err != nil {
		return nil, "", fmt.Errorf("create manager RPC pipe: %w", err)
	}
	failed := true
	defer func() {
		if failed {
			_ = listener.Close()
		}
	}()
	if err := verifyPipeAfterCreation(listener, pipeName, allowed); err != nil {
		return nil, "", fmt.Errorf("verify manager RPC pipe: %w", err)
	}
	failed = false
	return &managerRPC{listener: listener, serviceSID: allowed.serviceSID}, pipeName, nil
}

func (rpc *managerRPC) acceptManager(pid uint32) error {
	rpc.managerPID = pid
	return rpc.acceptConnection()
}

func (rpc *managerRPC) acceptConnection() error {
	rpc.ensurePendingAccept()
	timeout := time.NewTimer(managerRPCConnectTimeout)
	defer timeout.Stop()
	select {
	case conn := <-rpc.pendingConn:
		rpc.clearPendingAccept()
		client, err := (&statusPipe{allowed: allowedPipeClients{serviceSID: rpc.serviceSID, controlSID: rpc.serviceSID}}).authorize(conn)
		if err != nil || client.pid != rpc.managerPID || client.sid != rpc.serviceSID {
			_ = conn.Close()
			if err == nil {
				err = errors.New("manager RPC client identity does not match the managed process")
			}
			return err
		}
		rpc.conn = conn
		rpc.reader = bufio.NewReaderSize(conn, protocol.MaxControlResultBytes+1)
		return nil
	case err := <-rpc.pendingErr:
		rpc.clearPendingAccept()
		return err
	case <-timeout.C:
		return errors.New("timed out waiting for manager RPC connection")
	}
}

func (rpc *managerRPC) ensurePendingAccept() {
	if rpc.pendingConn != nil || rpc.pendingErr != nil {
		return
	}
	pendingConn := make(chan net.Conn, 1)
	pendingErr := make(chan error, 1)
	rpc.pendingConn = pendingConn
	rpc.pendingErr = pendingErr
	go func() {
		conn, err := rpc.listener.Accept()
		if err != nil {
			pendingErr <- err
			return
		}
		pendingConn <- conn
	}()
}

func (rpc *managerRPC) clearPendingAccept() {
	rpc.pendingConn = nil
	rpc.pendingErr = nil
}

func (rpc *managerRPC) exchange(request protocol.Request, timeout time.Duration) (int, json.RawMessage, error) {
	if timeout <= 0 || timeout > managerRPCMaxTimeout {
		return 0, nil, errors.New("manager RPC timeout is invalid")
	}
	rpc.mu.Lock()
	defer rpc.mu.Unlock()
	if rpc.conn == nil || rpc.reader == nil {
		if err := rpc.acceptConnection(); err != nil {
			return 0, nil, fmt.Errorf("reconnect manager RPC: %w", err)
		}
	}
	valid := false
	defer func() {
		if !valid {
			rpc.discardConnection()
		}
	}()
	if err := rpc.conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return 0, nil, err
	}
	var body io.Reader
	if request.Body != nil {
		body = bytes.NewReader(request.Body)
	}
	httpRequest, err := http.NewRequestWithContext(context.Background(), request.Method, "http://onebots.local"+request.Route, body)
	if err != nil {
		return 0, nil, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Connection", "keep-alive")
	if err := httpRequest.Write(rpc.conn); err != nil {
		return 0, nil, fmt.Errorf("write manager RPC request: %w", err)
	}
	response, err := http.ReadResponse(rpc.reader, httpRequest)
	if err != nil {
		return 0, nil, fmt.Errorf("read manager RPC response: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, protocol.MaxControlResultBytes+1))
	if err != nil {
		return 0, nil, fmt.Errorf("read manager RPC body: %w", err)
	}
	if len(payload) == 0 || len(payload) > protocol.MaxControlResultBytes || !json.Valid(payload) {
		return 0, nil, errors.New("manager RPC returned an invalid JSON body")
	}
	valid = true
	return response.StatusCode, json.RawMessage(payload), nil
}

func (rpc *managerRPC) discardConnection() {
	if rpc.conn != nil {
		_ = rpc.conn.Close()
	}
	rpc.conn = nil
	rpc.reader = nil
}

func (rpc *managerRPC) Close() error {
	var listenerErr error
	if rpc.listener != nil {
		listenerErr = rpc.listener.Close()
	}
	if errors.Is(listenerErr, net.ErrClosed) {
		listenerErr = nil
	}
	rpc.mu.Lock()
	defer rpc.mu.Unlock()
	var connErr error
	if rpc.conn != nil {
		connErr = rpc.conn.Close()
	}
	if rpc.pendingConn != nil {
		select {
		case conn := <-rpc.pendingConn:
			_ = conn.Close()
		default:
		}
	}
	if rpc.pendingErr != nil {
		select {
		case <-rpc.pendingErr:
		default:
		}
	}
	rpc.clearPendingAccept()
	rpc.conn = nil
	rpc.reader = nil
	return errors.Join(connErr, listenerErr)
}
