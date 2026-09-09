package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"
)

const Version = 1

const MaxMessageBytes = 64 * 1024

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)

var validServiceStates = map[string]struct{}{
	"starting": {}, "running": {}, "stopping": {}, "stopped": {}, "failed": {},
}

var validManagerStates = map[string]struct{}{
	"running": {}, "stopping": {}, "stopped": {}, "exited": {},
}

var validGatewayDesiredStates = map[string]struct{}{"running": {}, "stopped": {}}
var validGatewayActualStates = map[string]struct{}{
	"starting": {}, "running": {}, "stopping": {}, "stopped": {}, "failed": {},
}

var managerIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

type Request struct {
	Version   int           `json:"version"`
	RequestID string        `json:"requestId"`
	Operation string        `json:"operation"`
	Control   *ControlState `json:"control,omitempty"`
}

type ControlManagerState struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	PID     uint32 `json:"pid"`
}

type ControlGatewayState struct {
	Desired string `json:"desired"`
	Actual  string `json:"actual"`
}

type ControlState struct {
	Manager ControlManagerState `json:"manager"`
	Gateway ControlGatewayState `json:"gateway"`
}

type ManagerState struct {
	State string `json:"state"`
	PID   uint32 `json:"pid,omitempty"`
}

type HostState struct {
	Service   string        `json:"service"`
	Manager   ManagerState  `json:"manager"`
	StartedAt time.Time     `json:"startedAt"`
	Control   *ControlState `json:"control,omitempty"`
}

type Response struct {
	Version   int        `json:"version"`
	RequestID string     `json:"requestId,omitempty"`
	OK        bool       `json:"ok"`
	State     *HostState `json:"state,omitempty"`
	Error     *ErrorInfo `json:"error,omitempty"`
}

type ErrorInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func DecodeRequest(data []byte) (Request, error) {
	if len(data) == 0 {
		return Request{}, errors.New("request is empty")
	}
	if len(data) > MaxMessageBytes {
		return Request{}, fmt.Errorf("request exceeds %d bytes", MaxMessageBytes)
	}
	var request Request
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("decode request: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Request{}, errors.New("request must contain exactly one JSON document")
	}
	if request.Version != Version {
		return Request{}, fmt.Errorf("unsupported protocol version %d", request.Version)
	}
	if !requestIDPattern.MatchString(request.RequestID) {
		return Request{}, errors.New("requestId must contain 1-64 safe ASCII characters")
	}
	if request.Operation != "status" && request.Operation != "publish_status" {
		return Request{}, fmt.Errorf("unsupported operation %q", request.Operation)
	}
	if request.Operation == "status" && request.Control != nil {
		return Request{}, errors.New("status request must not contain control state")
	}
	if request.Operation == "publish_status" {
		if request.Control == nil {
			return Request{}, errors.New("publish_status request is missing control state")
		}
		if err := ValidateControlState(*request.Control); err != nil {
			return Request{}, err
		}
	}
	return request, nil
}

func ValidateControlState(state ControlState) error {
	if !managerIDPattern.MatchString(state.Manager.ID) {
		return errors.New("control manager id is invalid")
	}
	if !versionPattern.MatchString(state.Manager.Version) || len(state.Manager.Version) > 128 {
		return errors.New("control manager version is invalid")
	}
	if state.Manager.PID == 0 {
		return errors.New("control manager pid is invalid")
	}
	if _, ok := validGatewayDesiredStates[state.Gateway.Desired]; !ok {
		return errors.New("control gateway desired state is invalid")
	}
	if _, ok := validGatewayActualStates[state.Gateway.Actual]; !ok {
		return errors.New("control gateway actual state is invalid")
	}
	return nil
}

func Success(requestID string, state HostState) Response {
	return Response{Version: Version, RequestID: requestID, OK: true, State: &state}
}

func Failure(requestID, code, message string) Response {
	return Response{
		Version:   Version,
		RequestID: requestID,
		OK:        false,
		Error:     &ErrorInfo{Code: code, Message: message},
	}
}

func DecodeResponse(data []byte, expectedRequestID string) (Response, error) {
	if len(data) == 0 {
		return Response{}, errors.New("response is empty")
	}
	if len(data) > MaxMessageBytes {
		return Response{}, fmt.Errorf("response exceeds %d bytes", MaxMessageBytes)
	}
	var response Response
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&response); err != nil {
		return Response{}, fmt.Errorf("decode response: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Response{}, errors.New("response must contain exactly one JSON document")
	}
	if response.Version != Version {
		return Response{}, fmt.Errorf("unsupported protocol version %d", response.Version)
	}
	if !requestIDPattern.MatchString(response.RequestID) || response.RequestID != expectedRequestID {
		return Response{}, errors.New("response requestId does not match the request")
	}
	if !response.OK {
		if response.State != nil || response.Error == nil || response.Error.Code == "" || response.Error.Message == "" {
			return Response{}, errors.New("invalid failed response")
		}
		return response, nil
	}
	if response.Error != nil || response.State == nil || response.State.StartedAt.IsZero() {
		return Response{}, errors.New("invalid successful response")
	}
	if _, exists := validServiceStates[response.State.Service]; !exists {
		return Response{}, errors.New("invalid service state")
	}
	if _, exists := validManagerStates[response.State.Manager.State]; !exists {
		return Response{}, errors.New("invalid manager state")
	}
	if response.State.Manager.State == "running" && response.State.Manager.PID == 0 {
		return Response{}, errors.New("running manager response is missing pid")
	}
	if response.State.Control != nil {
		if err := ValidateControlState(*response.State.Control); err != nil {
			return Response{}, fmt.Errorf("invalid control state: %w", err)
		}
		if response.State.Manager.State != "running" || response.State.Control.Manager.PID != response.State.Manager.PID {
			return Response{}, errors.New("control manager pid does not match host manager")
		}
	}
	return response, nil
}
