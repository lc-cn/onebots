package host

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	defaultPipeName    = `\\.\pipe\onebots-manager-host-v1`
	defaultStopTimeout = 20 * time.Second
)

type Config struct {
	ServiceName  string
	ManagerPath  string
	ManagerArgs  []string
	WorkingDir   string
	PipeName     string
	ControlSID   string
	StopTimeout  time.Duration
	NoManagerRPC bool
}

func (config Config) Validate() error {
	if strings.TrimSpace(config.ServiceName) == "" {
		return errors.New("service name is required")
	}
	if strings.TrimSpace(config.ManagerPath) == "" {
		return errors.New("manager executable is required")
	}
	if !strings.HasPrefix(strings.ToLower(config.PipeName), `\\.\pipe\`) {
		return fmt.Errorf("pipe must use the local \\.\\pipe\\ namespace")
	}
	if config.StopTimeout <= 0 || config.StopTimeout > 5*time.Minute {
		return errors.New("stop timeout must be between 1ns and 5m")
	}
	return nil
}

func withDefaults(config Config) Config {
	if config.ServiceName == "" {
		config.ServiceName = "onebots-manager"
	}
	if config.PipeName == "" {
		config.PipeName = defaultPipeName
	}
	if config.StopTimeout == 0 {
		config.StopTimeout = defaultStopTimeout
	}
	return config
}
