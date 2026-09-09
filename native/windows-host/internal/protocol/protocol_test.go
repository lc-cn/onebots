package protocol

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDecodeStatusRequest(t *testing.T) {
	request, err := DecodeRequest([]byte(`{"version":1,"requestId":"doctor:1","operation":"status"}`))
	if err != nil {
		t.Fatal(err)
	}
	if request.RequestID != "doctor:1" || request.Operation != "status" {
		t.Fatalf("unexpected request: %#v", request)
	}
}

func controlState() ControlState {
	return ControlState{
		Manager: ControlManagerState{ID: "123e4567-e89b-42d3-a456-426614174000", Version: "1.2.12", PID: 42},
		Gateway: ControlGatewayState{Desired: "running", Actual: "stopped"},
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
		`{"version":1,"requestId":"publish:1","operation":"publish_status"}`,
		`{"version":1,"requestId":"status:1","operation":"status","control":{"manager":{"id":"123e4567-e89b-42d3-a456-426614174000","version":"1.2.12","pid":42},"gateway":{"desired":"running","actual":"stopped"}}}`,
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
		`{"version":2,"requestId":"a","operation":"status"}`,
		`{"version":1,"requestId":"../unsafe","operation":"status"}`,
		`{"version":1,"requestId":"a","operation":"stop"}`,
		`{"version":1,"requestId":"a","operation":"status","unknown":true}`,
		`{"version":1,"requestId":"a","operation":"status"}{}`,
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
