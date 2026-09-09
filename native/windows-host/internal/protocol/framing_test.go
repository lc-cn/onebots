package protocol

import (
	"bytes"
	"strings"
	"testing"
)

func TestReadSingleMessage(t *testing.T) {
	message, err := ReadSingleMessage(strings.NewReader("{}\n"))
	if err != nil || string(message) != "{}" {
		t.Fatalf("unexpected result %q, %v", message, err)
	}
	for _, input := range []string{"{}", "{}\n{}\n", strings.Repeat("x", MaxMessageBytes+1) + "\n"} {
		if _, err := ReadSingleMessage(strings.NewReader(input)); err == nil {
			t.Fatalf("expected framing rejection for %d bytes", len(input))
		}
	}
	maximum := append(bytes.Repeat([]byte{'x'}, MaxMessageBytes), '\n')
	if message, err := ReadSingleMessage(bytes.NewReader(maximum)); err != nil || len(message) != MaxMessageBytes {
		t.Fatalf("expected exact maximum payload, got %d bytes, %v", len(message), err)
	}
}
