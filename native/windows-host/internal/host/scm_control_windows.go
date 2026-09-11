//go:build windows

package host

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const managedServiceName = "onebots-gateway"
const managedServiceDisplayName = "OneBots Control Service"

type scmManagedConfig struct {
	ServiceType      string   `json:"serviceType"`
	ErrorControl     string   `json:"errorControl"`
	LoadOrderGroup   string   `json:"loadOrderGroup"`
	Dependencies     []string `json:"dependencies"`
	ServiceStartName string   `json:"serviceStartName"`
	DisplayName      string   `json:"displayName"`
	TagID            uint32   `json:"tagId"`
	Description      string   `json:"description"`
	SIDType          uint32   `json:"sidType"`
	DelayedAutoStart bool     `json:"delayedAutoStart"`
}

type scmControlRequest struct {
	Operation         string `json:"operation"`
	ExpectedLoaded    bool   `json:"expectedLoaded"`
	ExpectedPath      string `json:"expectedPath,omitempty"`
	ExpectedStartMode string `json:"expectedStartMode,omitempty"`
	TargetPath        string `json:"targetPath,omitempty"`
	Enabled           bool   `json:"enabled,omitempty"`
}

type scmControlState struct {
	Loaded    bool              `json:"loaded"`
	Path      string            `json:"path"`
	State     string            `json:"state"`
	ProcessID uint32            `json:"processId"`
	Enabled   bool              `json:"enabled"`
	StartMode string            `json:"startMode,omitempty"`
	Config    *scmManagedConfig `json:"config,omitempty"`
}

type scmServiceHandle interface {
	Config() (mgr.Config, error)
	Query() (svc.Status, error)
	UpdateConfig(mgr.Config) error
	Start(...string) error
	Control(svc.Cmd) (svc.Status, error)
	Delete() error
	Close() error
}

func decodeSCMRequest(encoded string) (scmControlRequest, error) {
	bytes, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(bytes) == 0 || len(bytes) > 32*1024 {
		return scmControlRequest{}, errors.New("invalid SCM request encoding")
	}
	var request scmControlRequest
	decoder := json.NewDecoder(strings.NewReader(string(bytes)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return scmControlRequest{}, errors.New("invalid SCM request")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return scmControlRequest{}, errors.New("SCM request must contain one document")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(bytes, &fields); err != nil {
		return scmControlRequest{}, errors.New("invalid SCM request object")
	}
	if request.Operation != "inspect" && request.Operation != "configure" && request.Operation != "start" && request.Operation != "quiesce" && request.Operation != "delete" {
		return scmControlRequest{}, errors.New("invalid SCM operation")
	}
	if request.ExpectedLoaded && request.ExpectedPath == "" {
		return scmControlRequest{}, errors.New("loaded SCM request requires expectedPath")
	}
	if request.ExpectedLoaded && request.ExpectedStartMode != "auto" && request.ExpectedStartMode != "manual" && request.ExpectedStartMode != "disabled" {
		return scmControlRequest{}, errors.New("loaded SCM request requires expectedStartMode")
	}
	if (request.Operation == "configure") != (request.TargetPath != "") {
		return scmControlRequest{}, errors.New("configure requires targetPath only")
	}
	if strings.ContainsAny(request.ExpectedPath+request.TargetPath, "\x00\r\n") {
		return scmControlRequest{}, errors.New("invalid SCM path")
	}
	expected := []string{"operation", "expectedLoaded", "expectedPath", "expectedStartMode"}
	if request.Operation == "inspect" {
		expected = []string{"operation", "expectedLoaded"}
	} else if request.Operation == "configure" {
		expected = []string{"operation", "expectedLoaded", "targetPath", "enabled"}
		if request.ExpectedLoaded {
			expected = append(expected, "expectedPath", "expectedStartMode")
		}
	}
	if len(fields) != len(expected) {
		return scmControlRequest{}, errors.New("SCM request fields are not closed")
	}
	for _, name := range expected {
		if _, ok := fields[name]; !ok {
			return scmControlRequest{}, errors.New("SCM request fields are not closed")
		}
	}
	return request, nil
}

func runSCMControl(encoded string, output io.Writer) error {
	request, err := decodeSCMRequest(encoded)
	if err != nil {
		return err
	}
	manager, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("open SCM: %w", err)
	}
	defer manager.Disconnect()
	service, err := manager.OpenService(managedServiceName)
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		if request.Operation == "inspect" {
			return json.NewEncoder(output).Encode(scmControlState{Loaded: false, State: "stopped"})
		}
		if request.ExpectedLoaded || request.Operation != "configure" {
			return errors.New("SCM service identity changed")
		}
		startType := uint32(mgr.StartManual)
		if request.Enabled {
			startType = mgr.StartAutomatic
		}
		service, err = createRawSCMService(manager, request.TargetPath, startType)
		if err != nil {
			return fmt.Errorf("create SCM service: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("open SCM service: %w", err)
	} else {
		if request.Operation != "inspect" {
			if err := applySCMControl(service, request); err != nil {
				return err
			}
		}
	}
	if request.Operation == "delete" {
		if err := service.Close(); err != nil {
			return err
		}
		deadline := time.Now().Add(120 * time.Second)
		for {
			probe, openErr := manager.OpenService(managedServiceName)
			if errors.Is(openErr, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
				return json.NewEncoder(output).Encode(scmControlState{Loaded: false, State: "stopped"})
			}
			if openErr == nil {
				_ = probe.Close()
			} else if !errors.Is(openErr, windows.ERROR_SERVICE_MARKED_FOR_DELETE) {
				return openErr
			}
			if time.Now().After(deadline) {
				return errors.New("SCM deletion timeout")
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	defer service.Close()
	if request.Operation == "inspect" {
		first, _, err := observeSCM(service)
		if err != nil {
			return err
		}
		second, _, err := observeSCM(service)
		if err != nil || !reflect.DeepEqual(first, second) {
			return errors.New("SCM service changed during inspection")
		}
		return json.NewEncoder(output).Encode(second)
	}
	state, err := stableSCMState(service, request)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(state)
}

func createRawSCMService(manager *mgr.Mgr, command string, startType uint32) (*mgr.Service, error) {
	name, err := windows.UTF16PtrFromString(managedServiceName)
	if err != nil {
		return nil, err
	}
	display, err := windows.UTF16PtrFromString(managedServiceDisplayName)
	if err != nil {
		return nil, err
	}
	path, err := windows.UTF16PtrFromString(command)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateService(
		manager.Handle, name, display, windows.SERVICE_ALL_ACCESS,
		windows.SERVICE_WIN32_OWN_PROCESS, startType, windows.SERVICE_ERROR_NORMAL,
		path, nil, nil, nil, nil, nil,
	)
	if err != nil {
		return nil, err
	}
	return &mgr.Service{Name: managedServiceName, Handle: handle}, nil
}

func observeSCM(service scmServiceHandle) (scmControlState, mgr.Config, error) {
	config, err := service.Config()
	if err != nil {
		return scmControlState{}, mgr.Config{}, err
	}
	managed, err := normalizeManagedSCMConfig(config)
	if err != nil {
		return scmControlState{}, mgr.Config{}, err
	}
	status, err := service.Query()
	if err != nil {
		return scmControlState{}, mgr.Config{}, err
	}
	state := "transitioning"
	if status.State == svc.Stopped {
		state = "stopped"
	} else if status.State == svc.Running {
		state = "running"
	}
	startMode, err := normalizedStartMode(config.StartType)
	if err != nil {
		return scmControlState{}, mgr.Config{}, err
	}
	return scmControlState{Loaded: true, Path: config.BinaryPathName, State: state, ProcessID: status.ProcessId, Enabled: startMode == "auto", StartMode: startMode, Config: &managed}, config, nil
}

func normalizedStartMode(value uint32) (string, error) {
	switch value {
	case mgr.StartAutomatic:
		return "auto", nil
	case mgr.StartManual:
		return "manual", nil
	case mgr.StartDisabled:
		return "disabled", nil
	default:
		return "", errors.New("SCM start mode identity changed")
	}
}

func normalizeManagedSCMConfig(config mgr.Config) (scmManagedConfig, error) {
	if config.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS ||
		config.ErrorControl != windows.SERVICE_ERROR_NORMAL ||
		config.LoadOrderGroup != "" || config.TagId != 0 || len(config.Dependencies) != 0 ||
		config.ServiceStartName != "LocalSystem" || config.DisplayName != managedServiceDisplayName ||
		config.SidType != windows.SERVICE_SID_TYPE_NONE || config.DelayedAutoStart ||
		config.Description != "" {
		return scmManagedConfig{}, errors.New("SCM managed configuration identity changed")
	}
	return scmManagedConfig{
		ServiceType: "own-process", ErrorControl: "normal", LoadOrderGroup: "",
		Dependencies: []string{}, ServiceStartName: "LocalSystem",
		DisplayName: managedServiceDisplayName, TagID: 0, Description: "",
		SIDType:          windows.SERVICE_SID_TYPE_NONE,
		DelayedAutoStart: false,
	}, nil
}

func applySCMControl(service scmServiceHandle, request scmControlRequest) error {
	first, config, err := observeSCM(service)
	if err != nil {
		return err
	}
	second, _, err := observeSCM(service)
	if err != nil || !reflect.DeepEqual(first, second) || !request.ExpectedLoaded ||
		second.Path != request.ExpectedPath || second.StartMode != request.ExpectedStartMode {
		return errors.New("SCM service changed before action")
	}
	switch request.Operation {
	case "configure":
		if second.State != "stopped" || second.ProcessID != 0 {
			return errors.New("SCM service is not quiescent")
		}
		config.BinaryPathName = request.TargetPath
		if request.Enabled {
			config.StartType = mgr.StartAutomatic
		} else {
			config.StartType = mgr.StartManual
		}
		return service.UpdateConfig(config)
	case "start":
		if second.State != "stopped" || second.ProcessID != 0 {
			return errors.New("SCM service is not quiescent")
		}
		return service.Start()
	case "quiesce":
		config.StartType = mgr.StartDisabled
		if err := service.UpdateConfig(config); err != nil {
			return err
		}
		if second.State != "stopped" {
			_, err = service.Control(svc.Stop)
			return err
		}
		return nil
	case "delete":
		if second.State != "stopped" || second.ProcessID != 0 {
			return errors.New("SCM service is not quiescent")
		}
		return service.Delete()
	}
	return errors.New("unsupported SCM operation")
}

func stableSCMState(service scmServiceHandle, request scmControlRequest) (scmControlState, error) {
	deadline := time.Now().Add(120 * time.Second)
	for {
		state, _, err := observeSCM(service)
		if err != nil {
			if request.Operation == "delete" && errors.Is(err, windows.ERROR_SERVICE_MARKED_FOR_DELETE) {
				return scmControlState{Loaded: false, State: "stopped"}, nil
			}
			return scmControlState{}, err
		}
		accepted := request.Operation == "start" && state.State == "running" && state.Path == request.ExpectedPath && state.StartMode == request.ExpectedStartMode
		if request.Operation == "configure" {
			targetMode := "manual"
			if request.Enabled {
				targetMode = "auto"
			}
			accepted = state.State == "stopped" && state.ProcessID == 0 && state.Path == request.TargetPath && state.Enabled == request.Enabled && state.StartMode == targetMode
		}
		if request.Operation == "quiesce" {
			accepted = state.State == "stopped" && state.ProcessID == 0 && !state.Enabled && state.StartMode == "disabled" && state.Path == request.ExpectedPath
		}
		if accepted {
			second, _, err := observeSCM(service)
			if err == nil && reflect.DeepEqual(second, state) {
				return state, nil
			}
		}
		if time.Now().After(deadline) {
			return scmControlState{}, errors.New("SCM transition timeout")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
