package host

import (
	"bytes"
	"testing"
)

func TestParseRunConfigKeepsArgumentBoundaries(t *testing.T) {
	var output bytes.Buffer
	config, err := parseRunConfig("service-run", []string{
		"--manager", `C:\One Bots\node.exe`,
		"--manager-arg", `C:\One Bots\manager.js`,
		"--manager-arg", "--data-dir",
		"--manager-arg", `C:\ProgramData\One Bots`,
	}, &output)
	if err != nil {
		t.Fatal(err)
	}
	if len(config.ManagerArgs) != 3 || config.ManagerArgs[2] != `C:\ProgramData\One Bots` {
		t.Fatalf("manager argument boundaries changed: %#v", config.ManagerArgs)
	}
}

func TestParseRunConfigRejectsPositionalArguments(t *testing.T) {
	var output bytes.Buffer
	if _, err := parseRunConfig("service-run", []string{"--manager", "node.exe", "extra"}, &output); err == nil {
		t.Fatal("expected positional argument rejection")
	}
}
