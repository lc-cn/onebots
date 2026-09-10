//go:build windows

package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
)

// exchangeControlRequest is the narrow-rights bridge used by the Node CLI. libuv opens
// Windows named pipes with generic read/write rights, which intentionally exceed the
// control SID's DACL. The native bridge keeps the pipe ACL minimal and accepts the
// request only through bounded stdin, so secrets never appear in process arguments.
func exchangeControlRequest(pipeName string, timeout time.Duration, input io.Reader, output io.Writer) error {
	if timeout <= 0 || timeout > managerRPCMaxTimeout {
		return errors.New("exchange timeout must be between 1ns and 2m")
	}
	const prefix = `\\.\pipe\`
	if !strings.HasPrefix(strings.ToLower(pipeName), prefix) || !safePipeLeaf(pipeName[len(prefix):]) {
		return errors.New(`exchange pipe must use the local \\.\pipe\ namespace`)
	}
	message, err := io.ReadAll(io.LimitReader(input, protocol.MaxMessageBytes+1))
	if err != nil {
		return fmt.Errorf("read control request: %w", err)
	}
	if len(message) > protocol.MaxMessageBytes {
		return errors.New("control request exceeds 64KiB")
	}
	request, err := protocol.DecodeRequest(message)
	if err != nil {
		return fmt.Errorf("validate control request: %w", err)
	}
	if request.Operation != "status" && request.Operation != "control_request" {
		return errors.New("exchange accepts only client control operations")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	connection, err := winio.DialPipeAccess(ctx, pipeName, uint32(pipeClientAccess))
	if err != nil {
		return fmt.Errorf("connect host control pipe: %w", err)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(timeout)); err != nil {
		return fmt.Errorf("set control deadline: %w", err)
	}
	if err := json.NewEncoder(connection).Encode(request); err != nil {
		return fmt.Errorf("write control request: %w", err)
	}
	closeWriter, ok := connection.(pipeCloseWriter)
	if !ok {
		return errors.New("control pipe does not support request EOF")
	}
	if err := closeWriter.CloseWrite(); err != nil {
		return fmt.Errorf("finish control request: %w", err)
	}
	responseBytes, err := io.ReadAll(io.LimitReader(connection, protocol.MaxControlResultBytes+1))
	if err != nil {
		return fmt.Errorf("read control response: %w", err)
	}
	if len(responseBytes) > protocol.MaxControlResultBytes {
		return errors.New("control response exceeds 1MiB")
	}
	response, err := protocol.DecodeResponse(responseBytes, request.RequestID)
	if err != nil {
		return fmt.Errorf("validate control response: %w", err)
	}
	return json.NewEncoder(output).Encode(response)
}

func safePipeLeaf(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '.' && character != '_' && character != '-' {
			return false
		}
	}
	return true
}
