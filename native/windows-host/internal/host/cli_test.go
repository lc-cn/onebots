package host

import (
	"bytes"
	"testing"
)

func TestIdentityRejectsArgumentsBeforePlatformCall(t *testing.T) {
	var output bytes.Buffer
	if code := RunCLI([]string{"identity", "unexpected"}, &output, &output); code != 2 {
		t.Fatalf("identity with arguments returned %d", code)
	}
}

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

func TestNoManagerRPCIsRestrictedToConsoleRun(t *testing.T) {
	var output bytes.Buffer
	config, err := parseRunConfig("console-run", []string{"--manager", "node.exe", "--no-manager-rpc"}, &output)
	if err != nil || !config.NoManagerRPC {
		t.Fatalf("console-run did not accept isolated worker mode: %#v, %v", config, err)
	}
	if _, err := parseRunConfig("service-run", []string{"--manager", "node.exe", "--no-manager-rpc"}, &output); err == nil {
		t.Fatal("service-run accepted no-manager-rpc")
	}
}
