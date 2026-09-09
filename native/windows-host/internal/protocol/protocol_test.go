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

func TestDecodeResponseRequiresExactContract(t *testing.T) {
	state := HostState{
		Service: "running", Manager: ManagerState{State: "running", PID: 42}, StartedAt: time.Now(),
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
