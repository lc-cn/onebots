//go:build windows

package host

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const managedServiceName = "onebots-gateway"

type scmControlRequest struct {
	Operation      string `json:"operation"`
	ExpectedLoaded bool   `json:"expectedLoaded"`
	ExpectedPath   string `json:"expectedPath,omitempty"`
	TargetPath     string `json:"targetPath,omitempty"`
	Enabled        bool   `json:"enabled,omitempty"`
}

type scmControlState struct {
	Loaded    bool   `json:"loaded"`
	Path      string `json:"path"`
	State     string `json:"state"`
	ProcessID uint32 `json:"processId"`
	Enabled   bool   `json:"enabled"`
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
	if (request.Operation == "configure") != (request.TargetPath != "") {
		return scmControlRequest{}, errors.New("configure requires targetPath only")
	}
	if strings.ContainsAny(request.ExpectedPath+request.TargetPath, "\x00\r\n") {
		return scmControlRequest{}, errors.New("invalid SCM path")
	}
	expected := []string{"operation", "expectedLoaded", "expectedPath"}
	if request.Operation == "inspect" {
		expected = []string{"operation", "expectedLoaded"}
	} else if request.Operation == "configure" {
		expected = []string{"operation", "expectedLoaded", "targetPath", "enabled"}
		if request.ExpectedLoaded {
			expected = append(expected, "expectedPath")
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
		if err != nil || first != second {
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
	display, err := windows.UTF16PtrFromString("OneBots Control Service")
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
	return scmControlState{Loaded: true, Path: config.BinaryPathName, State: state, ProcessID: status.ProcessId, Enabled: config.StartType == mgr.StartAutomatic}, config, nil
}

func applySCMControl(service scmServiceHandle, request scmControlRequest) error {
	first, config, err := observeSCM(service)
	if err != nil {
		return err
	}
	second, _, err := observeSCM(service)
	if err != nil || first != second || !request.ExpectedLoaded || second.Path != request.ExpectedPath {
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
		accepted := request.Operation == "start" && state.State == "running" && state.Path == request.ExpectedPath
		if request.Operation == "configure" {
			accepted = state.State == "stopped" && state.ProcessID == 0 && state.Path == request.TargetPath && state.Enabled == request.Enabled
		}
		if request.Operation == "quiesce" {
			accepted = state.State == "stopped" && state.ProcessID == 0 && !state.Enabled && state.Path == request.ExpectedPath
		}
		if accepted {
			second, _, err := observeSCM(service)
			if err == nil && second == state {
				return state, nil
			}
		}
		if time.Now().After(deadline) {
			return scmControlState{}, errors.New("SCM transition timeout")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
