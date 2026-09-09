//go:build windows

package host

import (
	"strings"
	"testing"

	"golang.org/x/sys/windows/svc/mgr"
)

func TestLegacyDisabledEvidenceAllowsOnlyExpectedRebootTransition(t *testing.T) {
	expected := validLegacyRebootRequest().Expected
	expected.State = "running"
	expected.Process = &legacySCMProcess{PID: 42, Created: "123", Image: `C:\OneBots\onebotsgateway.exe`}
	current := expected
	configuration := *expected.Configuration
	configuration.StartType = uint32(mgr.StartDisabled)
	current.Configuration = &configuration
	if !legacyDisabledForRollback(current, expected) {
		t.Fatal("running disabled legacy instance should remain rollback-safe before reboot")
	}
	current.State = "stopped"
	current.Process = nil
	if !legacyDisabledAndStopped(current, expected) {
		t.Fatal("stopped disabled legacy service should be restoration-ready after reboot")
	}
	configuration.BinaryPath = `C:\Other\service.exe`
	if legacyDisabledForRollback(current, expected) {
		t.Fatal("changed legacy configuration accepted")
	}
}

func TestLegacyReceiptCommandBindsClosedRequest(t *testing.T) {
	request := validLegacyRebootRequest()
	request.SnapshotDigest = strings.Repeat("a", 64)
	request.Nonce = strings.Repeat("b", 64)
	command, err := legacyReceiptCommand(`C:\Program Files\OneBots\onebots-windows-host.exe`, request)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(command, `"C:\Program Files\OneBots\onebots-windows-host.exe" legacy-reboot-receipt --request `) {
		t.Fatalf("unexpected receipt command: %s", command)
	}
	encoded := command[strings.LastIndex(command, " ")+1:]
	decoded, err := decodeLegacyRebootRequest(encoded, "receipt")
	if err != nil || decoded.OperationID != request.OperationID || decoded.Nonce != request.Nonce {
		t.Fatal("receipt command lost its closed request binding")
	}
}

func TestLegacyReceiptMarkerBindsHostAndSnapshot(t *testing.T) {
	request := validLegacyRebootRequest()
	request.SnapshotDigest = strings.Repeat("a", 64)
	request.Nonce = strings.Repeat("b", 64)
	marker := string(legacyRebootMarker(request, strings.Repeat("c", 64)))
	for _, expected := range []string{request.OperationID, request.SnapshotDigest, request.Nonce, strings.Repeat("c", 64)} {
		if !strings.Contains(marker, expected+"\n") {
			t.Fatalf("marker omitted %s", expected)
		}
	}
}
