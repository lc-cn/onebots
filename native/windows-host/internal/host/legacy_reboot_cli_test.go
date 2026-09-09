package host

import (
	"bytes"
	"testing"
)

func TestLegacyRebootCLIRejectsIncompleteRequestsBeforeEffects(t *testing.T) {
	for _, command := range []string{"legacy-reboot-control", "legacy-reboot-receipt"} {
		for _, arguments := range [][]string{{command}, {command, "--request", "invalid"}, {command, "--request", "invalid", "extra"}} {
			var output, diagnostic bytes.Buffer
			code := RunCLI(arguments, &output, &diagnostic)
			if code == 0 {
				t.Fatalf("%s accepted incomplete request", command)
			}
			if output.Len() != 0 {
				t.Fatalf("%s emitted a success document", command)
			}
		}
	}
}
