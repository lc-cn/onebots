package host

import (
	"bytes"
	"testing"
)

func TestLegacyInspectionRejectsCallerSelectedServiceOrMutation(t *testing.T) {
	for _, arguments := range [][]string{
		{"--service-name", "foreign"}, {"stop"}, {"--request", "e30"}, {"--service-name", "onebotsgateway.exe"},
	} {
		var output, diagnostic bytes.Buffer
		if RunCLI(append([]string{"legacy-scm-inspect"}, arguments...), &output, &diagnostic) != 2 {
			t.Fatal("legacy inspection accepted extra arguments")
		}
		if output.Len() != 0 {
			t.Fatal("rejected request produced an observation")
		}
	}
}
