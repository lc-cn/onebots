package protocol

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDecodeStatusRequest(t *testing.T) {
	request, err := DecodeRequest([]byte(`{"version":2,"requestId":"doctor:1","operation":"status"}`))
	if err != nil {
		t.Fatal(err)
	}
	if request.RequestID != "doctor:1" || request.Operation != "status" {
		t.Fatalf("unexpected request: %#v", request)
	}
}

func controlState() ControlState {
	return ControlState{
		Revision: 1,
		Manager:  ControlManagerState{ID: "123e4567-e89b-42d3-a456-426614174000", Version: "1.2.12", PID: 42},
		Gateway:  ControlGatewayState{Desired: "running", Actual: "stopped"},
	}
}

func TestDecodeInvalidateStatusRequest(t *testing.T) {
	manager := controlState().Manager
	request := Request{Version: Version, RequestID: "invalidate:2", Operation: "invalidate_status", Manager: &manager, Revision: 2}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeRequest(encoded); err != nil {
		t.Fatal(err)
	}
	invalid := []string{
		`{"version":2,"requestId":"invalidate:2","operation":"invalidate_status","revision":2}`,
		`{"version":2,"requestId":"invalidate:2","operation":"invalidate_status","manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42}}`,
	}
	for _, input := range invalid {
		if _, err := DecodeRequest([]byte(input)); err == nil {
			t.Fatalf("expected invalidation rejection: %s", input)
		}
	}
}

func TestDecodePublishStatusRequest(t *testing.T) {
	request := Request{Version: Version, RequestID: "publish:1", Operation: "publish_status", Control: ptr(controlState())}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeRequest(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Control == nil || decoded.Control.Manager.PID != 42 {
		t.Fatalf("unexpected control state: %#v", decoded.Control)
	}

	invalid := []string{
		`{"version":2,"requestId":"publish:1","operation":"publish_status"}`,
		`{"version":2,"requestId":"status:1","operation":"status","control":{"revision":1,"manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42},"gateway":{"desired":"running","actual":"stopped"}}}`,
		strings.Replace(string(encoded), `"pid":42`, `"pid":0`, 1),
		strings.Replace(string(encoded), `"version":"1.2.12"`, `"version":"latest"`, 1),
		strings.Replace(string(encoded), `"actual":"stopped"`, `"actual":"unknown"`, 1),
	}
	for _, input := range invalid {
		if _, err := DecodeRequest([]byte(input)); err == nil {
			t.Fatalf("expected invalid publish rejection: %s", input)
		}
	}
}

func ptr[T any](value T) *T { return &value }

func TestDecodeResponseRequiresExactContract(t *testing.T) {
	state := HostState{
		Service: "running", Manager: ManagerState{State: "running", PID: 42}, StartedAt: time.Now(), Control: ptr(controlState()),
	}
	state.Control.PublishedAt = time.Now().UTC()
	encoded, err := json.Marshal(Success("status:1", state))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeResponse(encoded, "status:1"); err != nil {
		t.Fatal(err)
	}
	invalid := []string{
		string(encoded) + `{}`,
		strings.Replace(string(encoded), `"requestId":"status:1"`, `"requestId":"other"`, 1),
		strings.Replace(string(encoded), `"ok":true`, `"ok":true,"unknown":1`, 1),
		strings.Repeat("x", MaxMessageBytes+1),
	}
	for _, input := range invalid {
		if _, err := DecodeResponse([]byte(input), "status:1"); err == nil {
			t.Fatalf("expected invalid response rejection: %.120s", input)
		}
	}
}

func TestDecodeRequestRejectsUnknownContract(t *testing.T) {
	tests := []string{
		`{"version":1,"requestId":"a","operation":"status"}`,
		`{"version":2,"requestId":"../unsafe","operation":"status"}`,
		`{"version":2,"requestId":"a","operation":"stop"}`,
		`{"version":2,"requestId":"a","operation":"status","unknown":true}`,
		`{"version":2,"requestId":"a","operation":"status"}{}`,
	}
	for _, input := range tests {
		if _, err := DecodeRequest([]byte(input)); err == nil {
			t.Fatalf("expected rejection for %s", input)
		}
	}
}

func TestDecodeRequestEnforcesBound(t *testing.T) {
	if _, err := DecodeRequest([]byte(strings.Repeat("x", MaxMessageBytes+1))); err == nil {
		t.Fatal("expected oversized request rejection")
	}
}

func TestDecodeBoundControlRequest(t *testing.T) {
	request, err := DecodeRequest([]byte(`{"version":2,"requestId":"control:1","operation":"control_request","binding":{"revision":7,"manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42}},"method":"POST","route":"/api/control/auth/bootstrap","body":{}}`))
	if err != nil || request.Binding == nil || request.Binding.Revision != 7 {
		t.Fatalf("valid bound request rejected: %#v, %v", request, err)
	}
	for _, input := range []string{
		`{"version":2,"requestId":"control:2","operation":"control_request","binding":{"revision":7,"manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42}},"method":"POST","route":"/api/control/auth/bootstrap\r\nX: bad"}`,
		`{"version":2,"requestId":"control:3","operation":"control_request","binding":{"revision":0,"manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42}},"method":"GET","route":"/api/control/status"}`,
		`{"version":2,"requestId":"control:4","operation":"control_request","binding":{"revision":7,"manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42}},"method":"GET","route":"/api/control/status","body":{}}`,
	} {
		if _, err := DecodeRequest([]byte(input)); err == nil {
			t.Fatalf("invalid bound request accepted: %s", input)
		}
	}
}

func TestDecodeControlResponse(t *testing.T) {
	response, err := DecodeResponse([]byte(`{"version":2,"requestId":"control:1","ok":true,"result":{"status":201,"body":{"code":"123456"}}}`), "control:1")
	if err != nil || response.Result == nil || response.Result.Status != 201 {
		t.Fatalf("valid control response rejected: %#v, %v", response, err)
	}
}

func TestDecodeControlResponseHasIndependentOneMiBBound(t *testing.T) {
	body := strings.Repeat("x", 70*1024)
	encoded, err := json.Marshal(ControlSuccess("control:large", 200, json.RawMessage(`{"payload":"`+body+`"}`)))
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) <= MaxMessageBytes {
		t.Fatal("fixture did not cross status bound")
	}
	if _, err := DecodeResponse(encoded, "control:large"); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeResponse([]byte(strings.Repeat("x", MaxControlResultBytes+1)), "control:large"); err == nil {
		t.Fatal("oversized control response accepted")
	}
}
