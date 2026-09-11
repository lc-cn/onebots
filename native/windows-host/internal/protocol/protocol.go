package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

const Version = 2

const MaxMessageBytes = 64 * 1024
const MaxControlResultBytes = 1024 * 1024

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
	Version   int                  `json:"version"`
	RequestID string               `json:"requestId"`
	Operation string               `json:"operation"`
	Control   *ControlState        `json:"control,omitempty"`
	Manager   *ControlManagerState `json:"manager,omitempty"`
	Revision  uint64               `json:"revision,omitempty"`
	Binding   *ControlBinding      `json:"binding,omitempty"`
	Method    string               `json:"method,omitempty"`
	Route     string               `json:"route,omitempty"`
	Body      json.RawMessage      `json:"body,omitempty"`
}

type ControlBinding struct {
	Revision uint64              `json:"revision"`
	Manager  ControlManagerState `json:"manager"`
}

type ControlResult struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
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
	Revision    uint64              `json:"revision"`
	PublishedAt time.Time           `json:"publishedAt,omitempty"`
	Manager     ControlManagerState `json:"manager"`
	Gateway     ControlGatewayState `json:"gateway"`
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
	Version   int            `json:"version"`
	RequestID string         `json:"requestId,omitempty"`
	OK        bool           `json:"ok"`
	State     *HostState     `json:"state,omitempty"`
	Error     *ErrorInfo     `json:"error,omitempty"`
	Result    *ControlResult `json:"result,omitempty"`
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
	if request.Operation != "status" && request.Operation != "publish_status" && request.Operation != "invalidate_status" && request.Operation != "control_request" {
		return Request{}, fmt.Errorf("unsupported operation %q", request.Operation)
	}
	if request.Operation == "status" && (request.Control != nil || request.Manager != nil || request.Revision != 0 || request.Binding != nil || request.Method != "" || request.Route != "" || request.Body != nil) {
		return Request{}, errors.New("status request must not contain control state")
	}
	if request.Operation == "publish_status" {
		if request.Control == nil || request.Manager != nil || request.Revision != 0 || hasControlRequestFields(request) {
			return Request{}, errors.New("publish_status request is missing control state")
		}
		if err := ValidateControlState(*request.Control); err != nil {
			return Request{}, err
		}
		if !request.Control.PublishedAt.IsZero() {
			return Request{}, errors.New("publish_status publishedAt is assigned by the host")
		}
	}
	if request.Operation == "invalidate_status" {
		if request.Control != nil || request.Manager == nil || request.Revision == 0 || hasControlRequestFields(request) {
			return Request{}, errors.New("invalidate_status request is incomplete")
		}
		if err := ValidateControlManagerState(*request.Manager); err != nil {
			return Request{}, err
		}
	}
	if request.Operation == "control_request" {
		if request.Control != nil || request.Manager != nil || request.Revision != 0 || request.Binding == nil {
			return Request{}, errors.New("control_request binding is incomplete")
		}
		if request.Binding.Revision == 0 {
			return Request{}, errors.New("control_request revision is invalid")
		}
		if err := ValidateControlManagerState(request.Binding.Manager); err != nil {
			return Request{}, err
		}
		if request.Method != "GET" && request.Method != "POST" {
			return Request{}, errors.New("control_request method is invalid")
		}
		if len(request.Route) == 0 || len(request.Route) > 2048 || !strings.HasPrefix(request.Route, "/api/control/") || strings.ContainsAny(request.Route, "\r\n\\") {
			return Request{}, errors.New("control_request route is invalid")
		}
		if request.Method == "GET" && request.Body != nil {
			return Request{}, errors.New("GET control_request must not contain a body")
		}
		if request.Body != nil && !json.Valid(request.Body) {
			return Request{}, errors.New("control_request body is invalid")
		}
	}
	return request, nil
}

func hasControlRequestFields(request Request) bool {
	return request.Binding != nil || request.Method != "" || request.Route != "" || request.Body != nil
}

func ValidateControlState(state ControlState) error {
	if state.Revision == 0 {
		return errors.New("control revision is invalid")
	}
	if err := ValidateControlManagerState(state.Manager); err != nil {
		return err
	}
	if _, ok := validGatewayDesiredStates[state.Gateway.Desired]; !ok {
		return errors.New("control gateway desired state is invalid")
	}
	if _, ok := validGatewayActualStates[state.Gateway.Actual]; !ok {
		return errors.New("control gateway actual state is invalid")
	}
	return nil
}

func ValidateControlManagerState(state ControlManagerState) error {
	if !managerIDPattern.MatchString(state.ID) {
		return errors.New("control manager id is invalid")
	}
	if !versionPattern.MatchString(state.Version) || len(state.Version) > 128 {
		return errors.New("control manager version is invalid")
	}
	if state.PID == 0 {
		return errors.New("control manager pid is invalid")
	}
	return nil
}

func Success(requestID string, state HostState) Response {
	return Response{Version: Version, RequestID: requestID, OK: true, State: &state}
}

func ControlSuccess(requestID string, status int, body json.RawMessage) Response {
	return Response{Version: Version, RequestID: requestID, OK: true, Result: &ControlResult{Status: status, Body: body}}
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
	if len(data) > MaxControlResultBytes {
		return Response{}, fmt.Errorf("response exceeds %d bytes", MaxControlResultBytes)
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
		if len(data) > MaxMessageBytes {
			return Response{}, errors.New("error response is too large")
		}
		if response.State != nil || response.Result != nil || response.Error == nil || response.Error.Code == "" || response.Error.Message == "" {
			return Response{}, errors.New("invalid failed response")
		}
		return response, nil
	}
	if response.Error != nil || (response.State == nil) == (response.Result == nil) {
		return Response{}, errors.New("invalid successful response")
	}
	if response.Result != nil {
		if len(data) > MaxControlResultBytes {
			return Response{}, errors.New("control response is too large")
		}
		if response.Result.Status < 100 || response.Result.Status > 599 || len(response.Result.Body) == 0 || !json.Valid(response.Result.Body) {
			return Response{}, errors.New("invalid control response")
		}
		return response, nil
	}
	if len(data) > MaxMessageBytes {
		return Response{}, errors.New("status response is too large")
	}
	if response.State.StartedAt.IsZero() {
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
		if response.State.Control.PublishedAt.IsZero() {
			return Response{}, errors.New("control state is missing host publication time")
		}
	}
	return response, nil
}
