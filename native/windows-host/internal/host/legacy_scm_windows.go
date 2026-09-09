//go:build windows

package host

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strconv"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

// Historical node-windows/WinSW service ID. Never supplied by a caller.
const legacySystemServiceName = "onebotsgateway.exe"

// SCM cannot return account passwords. Never treat virtual/domain/gMSA identities
// as recreatable registrations merely because their current process can be read.
func restorableLegacyAccount(account string) bool {
	switch strings.ToLower(account) {
	case "localsystem", `nt authority\localservice`, `nt authority\networkservice`:
		return true
	default:
		return false
	}
}

type legacySCMConfiguration struct {
	ServiceType      uint32   `json:"serviceType"`
	StartType        uint32   `json:"startType"`
	ErrorControl     uint32   `json:"errorControl"`
	BinaryPath       string   `json:"binaryPath"`
	LoadOrderGroup   string   `json:"loadOrderGroup"`
	TagID            uint32   `json:"tagId"`
	Dependencies     []string `json:"dependencies"`
	Account          string   `json:"account"`
	DisplayName      string   `json:"displayName"`
	Description      string   `json:"description"`
	SIDType          uint32   `json:"sidType"`
	DelayedAutoStart bool     `json:"delayedAutoStart"`
}
type legacySCMProcess struct {
	PID     uint32 `json:"pid"`
	Created string `json:"created"`
	Image   string `json:"image"`
}
type legacySCMInspection struct {
	SchemaVersion int    `json:"schemaVersion"`
	ServiceName   string `json:"serviceName"`
	Loaded        bool   `json:"loaded"`
	// Inspection never proves all descendants exited or that rollback is ready.
	RestorationReady bool                    `json:"restorationReady"`
	State            string                  `json:"state"`
	Configuration    *legacySCMConfiguration `json:"configuration"`
	Security         string                  `json:"security"`
	Process          *legacySCMProcess       `json:"process"`
}
type legacySCMReader interface {
	Config() (mgr.Config, error)
	Query() (svc.Status, error)
}

// Read-only boundary: its handles lack SERVICE_STOP/CHANGE_CONFIG/DELETE rights.
func runLegacySCMInspect(output io.Writer) error {
	manager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return errors.New("legacy SCM inspection unavailable")
	}
	defer windows.CloseServiceHandle(manager)
	name, _ := windows.UTF16PtrFromString(legacySystemServiceName)
	handle, err := windows.OpenService(manager, name, windows.SERVICE_QUERY_CONFIG|windows.SERVICE_QUERY_STATUS|windows.READ_CONTROL)
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return json.NewEncoder(output).Encode(legacySCMInspection{SchemaVersion: 1, ServiceName: legacySystemServiceName, State: "absent"})
	}
	if err != nil {
		return errors.New("legacy SCM inspection unavailable")
	}
	defer windows.CloseServiceHandle(handle)
	service := &mgr.Service{Name: legacySystemServiceName, Handle: handle}
	security := func() (string, error) {
		value, err := windows.GetSecurityInfo(handle, windows.SE_SERVICE,
			windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
		if err != nil {
			return "", err
		}
		return value.String(), nil
	}
	value, err := stableLegacySCMInspection(service, security, inspectLegacyProcess)
	if err != nil {
		return errors.New("legacy SCM inspection unstable or incomplete")
	}
	return json.NewEncoder(output).Encode(value)
}

func stableLegacySCMInspection(service legacySCMReader, security func() (string, error), process func(uint32) (*legacySCMProcess, error)) (legacySCMInspection, error) {
	first, err := observeLegacySCM(service, security, process)
	if err != nil {
		return legacySCMInspection{}, err
	}
	second, err := observeLegacySCM(service, security, process)
	if err != nil || !reflect.DeepEqual(first, second) {
		return legacySCMInspection{}, errors.New("legacy service changed")
	}
	return second, nil
}
func observeLegacySCM(service legacySCMReader, security func() (string, error), process func(uint32) (*legacySCMProcess, error)) (legacySCMInspection, error) {
	fail := errors.New("legacy service observation invalid")
	config, err := service.Config()
	if err != nil {
		return legacySCMInspection{}, err
	}
	if !restorableLegacyAccount(config.ServiceStartName) {
		return legacySCMInspection{}, errors.New("legacy service account cannot be restored without unavailable credentials")
	}
	status, err := service.Query()
	if err != nil {
		return legacySCMInspection{}, err
	}
	// Reject drivers/shared services and transient states; no inference of quiescence.
	if config.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS || config.BinaryPathName == "" ||
		(status.State != svc.Running && status.State != svc.Stopped) ||
		(status.State == svc.Running && status.ProcessId == 0) ||
		(status.State == svc.Stopped && status.ProcessId != 0) {
		return legacySCMInspection{}, fail
	}
	sddl, err := security()
	if err != nil || sddl == "" {
		return legacySCMInspection{}, fail
	}
	value := legacySCMInspection{SchemaVersion: 1, ServiceName: legacySystemServiceName, Loaded: true,
		State: "stopped", Security: sddl, Configuration: &legacySCMConfiguration{
			config.ServiceType, config.StartType, config.ErrorControl, config.BinaryPathName,
			config.LoadOrderGroup, config.TagId, append([]string{}, config.Dependencies...),
			config.ServiceStartName, config.DisplayName, config.Description, config.SidType, config.DelayedAutoStart,
		}}
	if status.State == svc.Running {
		value.State = "running"
		value.Process, err = process(status.ProcessId)
		if err != nil || value.Process == nil || value.Process.PID != status.ProcessId ||
			value.Process.Created == "" || value.Process.Image == "" {
			return legacySCMInspection{}, fail
		}
	}
	return value, nil
}

func inspectLegacyProcess(pid uint32) (*legacySCMProcess, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(handle)
	var created, exited, kernel, user windows.Filetime
	if err = windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return nil, err
	}
	image := make([]uint16, 32768)
	size := uint32(len(image))
	if err = windows.QueryFullProcessImageName(handle, 0, &image[0], &size); err != nil {
		return nil, err
	}
	state, err := windows.WaitForSingleObject(handle, 0)
	if err != nil || state != uint32(windows.WAIT_TIMEOUT) {
		return nil, errors.New("legacy process exited")
	}
	return &legacySCMProcess{PID: pid, Created: strconv.FormatUint(uint64(created.HighDateTime)<<32|uint64(created.LowDateTime), 10),
		Image: windows.UTF16ToString(image[:size])}, nil
}
