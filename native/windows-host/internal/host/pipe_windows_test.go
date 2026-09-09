//go:build windows

package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
	"golang.org/x/sys/windows"
)

func TestStatusPipeHasVerifiedSecurityAndServesState(t *testing.T) {
	state := newStateStore(time.Now())
	state.set("running", "running", 42)
	config := withDefaults(Config{
		ManagerPath: "unused.exe",
		PipeName:    fmt.Sprintf(`\\.\pipe\onebots-host-test-%d`, windows.GetCurrentProcessId()),
	})
	server, err := startStatusPipe(config, state)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	var output bytes.Buffer
	if err := queryStatus(config.PipeName, 5*time.Second, &output); err != nil {
		t.Fatal(err)
	}
	var response protocol.Response
	if err := json.Unmarshal(output.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.State == nil || response.State.Manager.PID != 42 {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestControlSIDHasClientOnlyRights(t *testing.T) {
	controlSID := "S-1-5-21-1-2-3-1001"
	sddl, allowed, err := controlPipeSecurity(controlSID)
	if err != nil {
		t.Fatal(err)
	}
	if allowed.controlSID != controlSID {
		t.Fatalf("unexpected allowed identity: %#v", allowed)
	}
	if strings.Contains(sddl, "(A;;GA;;;"+controlSID+")") {
		t.Fatalf("control SID received GENERIC_ALL: %s", sddl)
	}
	expected := fmt.Sprintf("(A;;0x%08x;;;%s)", uint32(pipeClientAccess), controlSID)
	if !strings.Contains(sddl, expected) {
		t.Fatalf("control SID did not receive exact client rights: %s", sddl)
	}
}

func TestVerifyPipeDACLUsesEffectiveMasks(t *testing.T) {
	allowed := allowedPipeClients{
		serviceSID: "S-1-5-21-1-2-3-1000",
		controlSID: "S-1-5-21-1-2-3-1001",
	}
	valid := "D:P" +
		"(A;;FA;;;SY)" +
		"(A;;FA;;;S-1-5-21-1-2-3-1000)" +
		fmt.Sprintf("(A;;0x%08x;;;S-1-5-21-1-2-3-1001)", uint32(pipeClientAccess))
	tests := []struct {
		name    string
		sddl    string
		wantErr bool
	}{
		{name: "canonical file access", sddl: valid},
		{name: "extra identity", sddl: valid + "(A;;FR;;;BA)", wantErr: true},
		{name: "control all access", sddl: strings.Replace(valid, fmt.Sprintf("0x%08x", uint32(pipeClientAccess)), "FA", 1), wantErr: true},
		{name: "unprotected", sddl: strings.Replace(valid, "D:P", "D:", 1), wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			descriptor, err := windows.SecurityDescriptorFromString(test.sddl)
			if err != nil {
				t.Fatal(err)
			}
			err = verifyPipeDACL(descriptor, allowed)
			if (err != nil) != test.wantErr {
				t.Fatalf("verifyPipeDACL() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func TestStatusPipeClosesStalledAuthorizedClient(t *testing.T) {
	state := newStateStore(time.Now())
	config := withDefaults(Config{
		ManagerPath: "unused.exe",
		PipeName:    fmt.Sprintf(`\\.\pipe\onebots-host-deadline-test-%d`, windows.GetCurrentProcessId()),
	})
	server, err := startStatusPipe(config, state)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	connection, err := winio.DialPipeAccess(ctx, config.PipeName, uint32(pipeClientAccess))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.SetReadDeadline(time.Now().Add(pipeRequestTimeout + 2*time.Second)); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	response, err := io.ReadAll(io.LimitReader(connection, protocol.MaxMessageBytes+1))
	if err != nil {
		t.Fatalf("stalled client was not closed cleanly: %v", err)
	}
	// The single absolute deadline bounds both read and write. Once an authorized client
	// consumes the whole window without sending a frame, the server closes it instead of
	// extending the connection to deliver an error document.
	if len(response) != 0 {
		t.Fatalf("stalled client received data after the absolute deadline: %d bytes", len(response))
	}
	elapsed := time.Since(started)
	if elapsed < pipeRequestTimeout-time.Second || elapsed > pipeRequestTimeout+2*time.Second {
		t.Fatalf("stalled client closed outside the bounded deadline: %s", elapsed)
	}
}

func TestStatusPipeRejectsUNCRemoteClient(t *testing.T) {
	state := newStateStore(time.Now())
	config := withDefaults(Config{
		ManagerPath: "unused.exe",
		PipeName:    fmt.Sprintf(`\\.\pipe\onebots-host-remote-test-%d`, windows.GetCurrentProcessId()),
	})
	server, err := startStatusPipe(config, state)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	remoteName := strings.Replace(config.PipeName, `\\.\pipe\`, `\\localhost\pipe\`, 1)
	name, err := windows.UTF16PtrFromString(remoteName)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(
		name,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		0,
		nil,
		windows.OPEN_EXISTING,
		0,
		0,
	)
	if err == nil {
		windows.CloseHandle(handle)
		t.Fatal("remote UNC client unexpectedly connected to local-only control pipe")
	}
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		t.Fatalf("remote UNC client failed for an unexpected reason: %v", err)
	}
}
