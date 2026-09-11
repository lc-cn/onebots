package host

import (
	"testing"
	"time"
)

func TestConfigDefaultsAndValidation(t *testing.T) {
	config := withDefaults(Config{ManagerPath: `C:\OneBots\node.exe`})
	if config.ServiceName != "onebots-manager" || config.PipeName != defaultPipeName {
		t.Fatalf("unexpected defaults: %#v", config)
	}
	if config.StopTimeout != 20*time.Second {
		t.Fatalf("unexpected stop timeout: %s", config.StopTimeout)
	}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestConfigRejectsRemoteOrUnboundedInputs(t *testing.T) {
	config := withDefaults(Config{ManagerPath: "node.exe", PipeName: `\\server\pipe\onebots`})
	if err := config.Validate(); err == nil {
		t.Fatal("expected remote pipe rejection")
	}
	config = withDefaults(Config{ManagerPath: "node.exe", StopTimeout: 6 * time.Minute})
	if err := config.Validate(); err == nil {
		t.Fatal("expected timeout rejection")
	}
}
