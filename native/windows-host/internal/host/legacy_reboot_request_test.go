package host

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func validLegacyRebootRequest() legacyRebootRequest {
	return legacyRebootRequest{SchemaVersion: 1, Operation: "inspect", OperationID: "op_1",
		StateDirectory: `C:\ProgramData\OneBots`,
		Expected: legacySCMInspection{SchemaVersion: 1, ServiceName: legacySystemServiceName, Loaded: true,
			State: "stopped", Security: "O:SYG:SYD:P(A;;FA;;;SY)", Configuration: &legacySCMConfiguration{
				ServiceType: 16, StartType: 3, ErrorControl: 1, BinaryPath: `C:\OneBots\onebotsgateway.exe`,
				Account: "LocalSystem", DisplayName: "onebots-gateway", Dependencies: []string{}}}}
}

func encodeLegacyRebootRequestForTest(value any) string {
	bytes, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(bytes)
}

func TestDecodeLegacyRebootRequest(t *testing.T) {
	value := validLegacyRebootRequest()
	value.SnapshotDigest = "a" + strings.Repeat("0", 63)
	value.Nonce = "b" + strings.Repeat("1", 63)
	if _, err := decodeLegacyRebootRequest(encodeLegacyRebootRequestForTest(value), "inspect"); err != nil {
		t.Fatal(err)
	}
	value.Operation = "prepare"
	if _, err := decodeLegacyRebootRequest(encodeLegacyRebootRequestForTest(value), "inspect"); err == nil {
		t.Fatal("unexpected operation accepted")
	}
	value.Operation = "inspect"
	bytes, _ := json.Marshal(value)
	var object map[string]any
	_ = json.Unmarshal(bytes, &object)
	object["extra"] = true
	if _, err := decodeLegacyRebootRequest(encodeLegacyRebootRequestForTest(object), "inspect"); err == nil {
		t.Fatal("open request accepted")
	}
}

func TestDecodeLegacyRebootRequestUsesAnExplicitOperationAllowlist(t *testing.T) {
	value := validLegacyRebootRequest()
	value.SnapshotDigest = strings.Repeat("a", 64)
	value.Nonce = strings.Repeat("b", 64)
	for _, operation := range []string{"prepare", "inspect", "cleanup", "rollback", "restart", "commit"} {
		value.Operation = operation
		if _, err := decodeLegacyRebootRequest(encodeLegacyRebootRequestForTest(value), operation); err != nil {
			t.Fatalf("allowed operation %s rejected: %v", operation, err)
		}
		if _, err := decodeLegacyRebootRequest(encodeLegacyRebootRequestForTest(value), "inspect"); operation != "inspect" && err == nil {
			t.Fatalf("operation %s bypassed allowlist", operation)
		}
	}
}

func TestDecodeLegacyRebootRequestRejectsUnsafeEvidence(t *testing.T) {
	base := validLegacyRebootRequest()
	base.SnapshotDigest = strings.Repeat("a", 64)
	base.Nonce = strings.Repeat("b", 64)
	cases := []func(*legacyRebootRequest){
		func(value *legacyRebootRequest) { value.StateDirectory = `C:\ProgramData\..\escape` },
		func(value *legacyRebootRequest) { value.Expected.RestorationReady = true },
		func(value *legacyRebootRequest) { value.Expected.Configuration.Account = `DOMAIN\user` },
		func(value *legacyRebootRequest) { value.Expected.Configuration.DelayedAutoStart = true },
		func(value *legacyRebootRequest) { value.Expected.Security = "D:(A;;FA;;;SY)" },
		func(value *legacyRebootRequest) {
			value.Expected.State = "running"
			value.Expected.Process = nil
		},
	}
	for index, mutate := range cases {
		value := base
		config := *base.Expected.Configuration
		value.Expected.Configuration = &config
		mutate(&value)
		if _, err := decodeLegacyRebootRequest(encodeLegacyRebootRequestForTest(value), "inspect"); err == nil {
			t.Fatalf("unsafe case %d accepted", index)
		}
	}
}

func TestDecodeLegacyRebootRequestRejectsDuplicateNestedKeys(t *testing.T) {
	value := validLegacyRebootRequest()
	value.SnapshotDigest = strings.Repeat("a", 64)
	value.Nonce = strings.Repeat("b", 64)
	encoded := encodeLegacyRebootRequestForTest(value)
	bytes, _ := base64.RawURLEncoding.DecodeString(encoded)
	tampered := strings.Replace(string(bytes), `"startType":3`, `"startType":2,"startType":3`, 1)
	if _, err := decodeLegacyRebootRequest(base64.RawURLEncoding.EncodeToString([]byte(tampered)), "inspect"); err == nil {
		t.Fatal("duplicate nested key accepted")
	}
}
