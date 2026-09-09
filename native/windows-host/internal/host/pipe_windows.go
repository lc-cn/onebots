//go:build windows

package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
	"golang.org/x/sys/windows"
)

const (
	pipeClientAccess    = windows.FILE_READ_DATA | windows.FILE_WRITE_DATA | windows.FILE_READ_ATTRIBUTES | windows.FILE_WRITE_ATTRIBUTES | windows.SYNCHRONIZE
	pipeServerAccess    = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0x1ff
	pipeConnectionLimit = 16
	pipeRequestTimeout  = 5 * time.Second
)

type pipeConnectionHandle interface {
	net.Conn
	Fd() uintptr
}

type pipeCloseWriter interface {
	CloseWrite() error
}

type allowedPipeClients struct {
	serviceSID string
	controlSID string
}

type statusPipe struct {
	listener net.Listener
	state    *stateStore
	allowed  allowedPipeClients
	slots    chan struct{}
	handlers sync.WaitGroup
	done     chan struct{}
	once     sync.Once
}

func startStatusPipe(config Config, state *stateStore) (*statusPipe, error) {
	sddl, allowed, err := controlPipeSecurity(config.ControlSID)
	if err != nil {
		return nil, err
	}
	pipeConfig := &winio.PipeConfig{
		SecurityDescriptor: sddl,
		MessageMode:        true,
		InputBufferSize:    protocol.MaxMessageBytes,
		OutputBufferSize:   protocol.MaxMessageBytes,
	}
	listener, err := winio.ListenPipe(config.PipeName, pipeConfig)
	if err != nil {
		return nil, fmt.Errorf("create first local control pipe instance: %w", err)
	}
	failed := true
	defer func() {
		if failed {
			_ = listener.Close()
		}
	}()

	// go-winio creates an atomic FILE_CREATE sentinel before any server instance.
	// A second first listener must fail; accepting it would permit an ambiguous
	// lifecycle owner.
	duplicate, duplicateErr := winio.ListenPipe(config.PipeName, pipeConfig)
	if duplicateErr == nil {
		_ = duplicate.Close()
		return nil, errors.New("control pipe did not enforce a unique first instance")
	}
	if err := verifyPipeAfterCreation(listener, config.PipeName, allowed); err != nil {
		return nil, err
	}

	server := &statusPipe{
		listener: listener,
		state:    state,
		allowed:  allowed,
		slots:    make(chan struct{}, pipeConnectionLimit),
		done:     make(chan struct{}),
	}
	failed = false
	go server.serve()
	return server, nil
}

func controlPipeSecurity(controlSID string) (string, allowedPipeClients, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", allowedPipeClients{}, fmt.Errorf("open service token: %w", err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", allowedPipeClients{}, fmt.Errorf("read service identity: %w", err)
	}
	serviceSID := user.User.Sid.String()
	if controlSID == "" {
		controlSID = serviceSID
	} else if _, err := windows.StringToSid(controlSID); err != nil {
		return "", allowedPipeClients{}, fmt.Errorf("invalid control SID: %w", err)
	}

	var descriptor strings.Builder
	descriptor.WriteString("D:P")
	descriptor.WriteString("(A;;GA;;;SY)")
	if serviceSID != "S-1-5-18" {
		fmt.Fprintf(&descriptor, "(A;;GA;;;%s)", serviceSID)
	}
	if controlSID != serviceSID && controlSID != "S-1-5-18" {
		// Client-only rights exclude FILE_APPEND_DATA/FILE_CREATE_PIPE_INSTANCE,
		// WRITE_DAC, WRITE_OWNER, DELETE and all generic mappings.
		fmt.Fprintf(&descriptor, "(A;;0x%08x;;;%s)", uint32(pipeClientAccess), controlSID)
	}
	return descriptor.String(), allowedPipeClients{serviceSID: serviceSID, controlSID: controlSID}, nil
}

func verifyPipeAfterCreation(listener net.Listener, pipeName string, allowed allowedPipeClients) error {
	accepted := make(chan net.Conn, 1)
	acceptError := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			acceptError <- err
			return
		}
		accepted <- connection
	}()

	handle, err := openPipeForVerification(pipeName, 2*time.Second)
	if err != nil {
		return fmt.Errorf("open pipe security verification connection: %w", err)
	}
	defer windows.CloseHandle(handle)

	var serverConnection net.Conn
	select {
	case serverConnection = <-accepted:
		defer serverConnection.Close()
	case err := <-acceptError:
		return fmt.Errorf("accept pipe security verification connection: %w", err)
	case <-time.After(2 * time.Second):
		return errors.New("timed out accepting pipe security verification connection")
	}

	actual, err := windows.GetSecurityInfo(
		handle,
		windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return fmt.Errorf("read created pipe DACL: %w", err)
	}
	if err := verifyPipeDACL(actual, allowed); err != nil {
		return fmt.Errorf("created pipe DACL mismatch: %w", err)
	}
	return nil
}

func verifyPipeDACL(descriptor *windows.SECURITY_DESCRIPTOR, allowed allowedPipeClients) error {
	control, _, err := descriptor.Control()
	if err != nil {
		return fmt.Errorf("read security descriptor control: %w", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("DACL is not protected")
	}
	dacl, defaulted, err := descriptor.DACL()
	if err != nil {
		return fmt.Errorf("read DACL: %w", err)
	}
	if dacl == nil || defaulted {
		return errors.New("DACL is absent or defaulted")
	}
	expected := map[string]windows.ACCESS_MASK{"S-1-5-18": windows.ACCESS_MASK(pipeServerAccess)}
	if allowed.serviceSID != "S-1-5-18" {
		expected[allowed.serviceSID] = windows.ACCESS_MASK(pipeServerAccess)
	}
	if allowed.controlSID != allowed.serviceSID && allowed.controlSID != "S-1-5-18" {
		expected[allowed.controlSID] = windows.ACCESS_MASK(pipeClientAccess)
	}
	if int(dacl.AceCount) != len(expected) {
		return fmt.Errorf("got %d ACEs, expected %d", dacl.AceCount, len(expected))
	}
	seen := make(map[string]struct{}, len(expected))
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return fmt.Errorf("read ACE %d: %w", index, err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags != 0 {
			return fmt.Errorf("ACE %d has type %d or flags 0x%x", index, ace.Header.AceType, ace.Header.AceFlags)
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
		mask, exists := expected[sid]
		if !exists {
			return fmt.Errorf("ACE %d grants unexpected SID %s", index, sid)
		}
		if _, duplicate := seen[sid]; duplicate {
			return fmt.Errorf("SID %s has duplicate ACEs", sid)
		}
		if ace.Mask != mask {
			return fmt.Errorf("SID %s has mask 0x%x, expected 0x%x", sid, ace.Mask, mask)
		}
		seen[sid] = struct{}{}
	}
	return nil
}

func openPipeForVerification(pipeName string, timeout time.Duration) (windows.Handle, error) {
	name, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return windows.InvalidHandle, err
	}
	deadline := time.Now().Add(timeout)
	for {
		handle, openErr := windows.CreateFile(
			name,
			windows.GENERIC_READ|windows.GENERIC_WRITE,
			0,
			nil,
			windows.OPEN_EXISTING,
			0,
			0,
		)
		if openErr == nil {
			return handle, nil
		}
		if time.Now().After(deadline) {
			return windows.InvalidHandle, openErr
		}
		if !errors.Is(openErr, windows.ERROR_PIPE_BUSY) && !errors.Is(openErr, windows.ERROR_FILE_NOT_FOUND) {
			return windows.InvalidHandle, openErr
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (server *statusPipe) serve() {
	defer close(server.done)
	for {
		server.slots <- struct{}{}
		connection, err := server.listener.Accept()
		if err != nil {
			<-server.slots
			return
		}
		server.handlers.Add(1)
		go server.handle(connection)
	}
}

func (server *statusPipe) handle(connection net.Conn) {
	defer server.handlers.Done()
	defer func() { <-server.slots }()
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(pipeRequestTimeout)); err != nil {
		return
	}
	if err := server.authorize(connection); err != nil {
		server.writeFailure(connection, "unauthorized_client", "named pipe client identity is not authorized")
		return
	}
	message, err := protocol.ReadSingleMessage(connection)
	if err != nil {
		server.writeFailure(connection, "invalid_request", "request must contain exactly one JSON document")
		return
	}
	request, err := protocol.DecodeRequest(message)
	if err != nil {
		server.writeFailure(connection, "invalid_request", err.Error())
		return
	}
	_ = json.NewEncoder(connection).Encode(protocol.Success(request.RequestID, server.state.snapshot()))
}

func (server *statusPipe) authorize(connection net.Conn) error {
	handled, ok := connection.(pipeConnectionHandle)
	if !ok {
		return errors.New("pipe connection does not expose its kernel handle")
	}
	handle := windows.Handle(handled.Fd())
	var firstPID uint32
	if err := windows.GetNamedPipeClientProcessId(handle, &firstPID); err != nil {
		return fmt.Errorf("read pipe client pid: %w", err)
	}
	if firstPID == 0 {
		return errors.New("pipe client pid is zero")
	}
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, firstPID)
	if err != nil {
		return fmt.Errorf("open pipe client process: %w", err)
	}
	defer windows.CloseHandle(process)
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return fmt.Errorf("open pipe client token: %w", err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return fmt.Errorf("read pipe client SID: %w", err)
	}
	var secondPID uint32
	if err := windows.GetNamedPipeClientProcessId(handle, &secondPID); err != nil {
		return fmt.Errorf("re-read pipe client pid: %w", err)
	}
	if secondPID != firstPID {
		return errors.New("pipe client process identity changed during authorization")
	}
	clientSID := user.User.Sid.String()
	if clientSID != server.allowed.serviceSID && clientSID != server.allowed.controlSID && clientSID != "S-1-5-18" {
		return fmt.Errorf("pipe client SID %s is not authorized", clientSID)
	}
	return nil
}

func (server *statusPipe) writeFailure(connection io.Writer, code, message string) {
	_ = json.NewEncoder(connection).Encode(protocol.Failure("", code, message))
}

func (server *statusPipe) Close() error {
	var err error
	server.once.Do(func() { err = server.listener.Close() })
	<-server.done
	server.handlers.Wait()
	return err
}

func queryStatus(pipeName string, timeout time.Duration, output io.Writer) error {
	if timeout <= 0 || timeout > time.Minute {
		return errors.New("status timeout must be between 1ns and 1m")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	connection, err := winio.DialPipeAccess(ctx, pipeName, uint32(pipeClientAccess))
	if err != nil {
		return fmt.Errorf("connect host status pipe: %w", err)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(timeout)); err != nil {
		return fmt.Errorf("set status deadline: %w", err)
	}
	request := protocol.Request{
		Version: protocol.Version, RequestID: fmt.Sprintf("status:%x", time.Now().UnixNano()), Operation: "status",
	}
	if err := json.NewEncoder(connection).Encode(request); err != nil {
		return fmt.Errorf("write status request: %w", err)
	}
	closeWriter, ok := connection.(pipeCloseWriter)
	if !ok {
		return errors.New("status pipe does not support request EOF")
	}
	if err := closeWriter.CloseWrite(); err != nil {
		return fmt.Errorf("finish status request: %w", err)
	}
	message, err := protocol.ReadSingleMessage(connection)
	if err != nil {
		return fmt.Errorf("read status response: %w", err)
	}
	response, err := protocol.DecodeResponse(message, request.RequestID)
	if err != nil {
		return fmt.Errorf("validate status response: %w", err)
	}
	if !response.OK {
		return fmt.Errorf("host status failed: %s", response.Error.Message)
	}
	return json.NewEncoder(output).Encode(response)
}
