//go:build windows

package host

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const legacyReceiptServiceSDDL = "D:P(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWLOSDRCWDWO;;;BA)"
const legacyReceiptFileSDDL = "D:P(A;;FA;;;SY)(A;;FA;;;BA)"

type legacyRebootReceipt struct {
	SchemaVersion  int    `json:"schemaVersion"`
	OperationID    string `json:"operationId"`
	SnapshotDigest string `json:"snapshotDigest"`
	Nonce          string `json:"nonce"`
	HostDigest     string `json:"hostDigest"`
	StartReason    string `json:"startReason"`
}

func legacyRebootPaths(request legacyRebootRequest) (directory, before, after, receipt string) {
	directory = filepath.Join(request.StateDirectory, "migration-reboot", request.OperationID)
	return directory, filepath.Join(directory, "before.marker"), filepath.Join(directory, "after.marker"), filepath.Join(directory, "receipt.json")
}

func legacyRebootMarker(request legacyRebootRequest, hostDigest string) []byte {
	return []byte(request.OperationID + "\n" + request.SnapshotDigest + "\n" + request.Nonce + "\n" + hostDigest + "\n")
}

func executableDigest(name string) (string, string, error) {
	bytes, err := os.ReadFile(name)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(bytes)
	return name, hex.EncodeToString(digest[:]), nil
}

func inspectFixedLegacyService() (legacySCMInspection, error) {
	manager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return legacySCMInspection{}, err
	}
	defer windows.CloseServiceHandle(manager)
	name, _ := windows.UTF16PtrFromString(legacySystemServiceName)
	handle, err := windows.OpenService(manager, name, windows.SERVICE_QUERY_CONFIG|windows.SERVICE_QUERY_STATUS|windows.READ_CONTROL)
	if err != nil {
		return legacySCMInspection{}, err
	}
	defer windows.CloseServiceHandle(handle)
	service := &mgr.Service{Name: legacySystemServiceName, Handle: handle}
	return inspectOpenedLegacyService(service)
}

func inspectOpenedLegacyService(service *mgr.Service) (legacySCMInspection, error) {
	handle := service.Handle
	return stableLegacySCMInspection(service, func() (string, error) {
		sd, err := windows.GetSecurityInfo(handle, windows.SE_SERVICE, windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
		if err != nil {
			return "", err
		}
		return sd.String(), nil
	}, inspectLegacyProcess)
}

func legacyDisabledForRollback(current, expected legacySCMInspection) bool {
	if current.Configuration == nil || expected.Configuration == nil || current.Security != expected.Security || current.Configuration.StartType != uint32(mgr.StartDisabled) {
		return false
	}
	left, right := *current.Configuration, *expected.Configuration
	left.StartType = right.StartType
	if !reflect.DeepEqual(left, right) {
		return false
	}
	if current.State == expected.State {
		return reflect.DeepEqual(current.Process, expected.Process)
	}
	return expected.State == "running" && current.State == "stopped" && current.Process == nil
}

func legacyDisabledAndStopped(current, expected legacySCMInspection) bool {
	return current.State == "stopped" && current.Process == nil && legacyDisabledForRollback(current, expected)
}

func legacyConfigurationRestored(current, expected legacySCMInspection) bool {
	return current.Configuration != nil && expected.Configuration != nil && current.Security == expected.Security &&
		reflect.DeepEqual(*current.Configuration, *expected.Configuration)
}

func disableLegacyService(expected legacySCMInspection) error {
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	service, err := manager.OpenService(legacySystemServiceName)
	if err != nil {
		return err
	}
	defer service.Close()
	config, err := service.Config()
	if err != nil {
		return err
	}
	config.StartType = mgr.StartDisabled
	if err := service.UpdateConfig(config); err != nil {
		return err
	}
	current, err := inspectFixedLegacyService()
	if err != nil || !legacyDisabledForRollback(current, expected) {
		return errors.New("legacy service disable readback failed")
	}
	return nil
}

func receiptControllerAccess() uint32 {
	return windows.SERVICE_QUERY_CONFIG | windows.SERVICE_CHANGE_CONFIG | windows.SERVICE_QUERY_STATUS |
		windows.DELETE | windows.READ_CONTROL | windows.WRITE_DAC
}

func openOrCreateReceiptService(command string) (*mgr.Service, bool, error) {
	manager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT|windows.SC_MANAGER_CREATE_SERVICE)
	if err != nil {
		return nil, false, err
	}
	defer windows.CloseServiceHandle(manager)
	name, _ := windows.UTF16PtrFromString(legacyRebootServiceName)
	handle, err := windows.OpenService(manager, name, receiptControllerAccess())
	if err == nil {
		return &mgr.Service{Name: legacyRebootServiceName, Handle: handle}, false, nil
	}
	if !errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return nil, false, err
	}
	display, _ := windows.UTF16PtrFromString("OneBots Legacy Migration Reboot Receipt")
	path, _ := windows.UTF16PtrFromString(command)
	handle, err = windows.CreateService(manager, name, display, windows.SERVICE_ALL_ACCESS,
		windows.SERVICE_WIN32_OWN_PROCESS, mgr.StartManual, windows.SERVICE_ERROR_NORMAL,
		path, nil, nil, nil, nil, nil)
	if err != nil {
		return nil, false, err
	}
	return &mgr.Service{Name: legacyRebootServiceName, Handle: handle}, true, nil
}

func openReceiptService(access uint32) (*mgr.Service, error) {
	manager, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return nil, err
	}
	defer windows.CloseServiceHandle(manager)
	name, _ := windows.UTF16PtrFromString(legacyRebootServiceName)
	handle, err := windows.OpenService(manager, name, access)
	if err != nil {
		return nil, err
	}
	return &mgr.Service{Name: legacyRebootServiceName, Handle: handle}, nil
}

func expectedReceiptServiceSDDL() (string, error) {
	sd, err := windows.SecurityDescriptorFromString(legacyReceiptServiceSDDL)
	if err != nil {
		return "", err
	}
	return sd.String(), nil
}

func receiptServiceSecurityMatches(service *mgr.Service) bool {
	expected, err := expectedReceiptServiceSDDL()
	if err != nil {
		return false
	}
	sd, err := windows.GetSecurityInfo(service.Handle, windows.SE_SERVICE, windows.DACL_SECURITY_INFORMATION)
	return err == nil && sd.String() == expected
}

func applyReceiptServiceDACL(handle windows.Handle) error {
	sd, err := windows.SecurityDescriptorFromString(legacyReceiptServiceSDDL)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetSecurityInfo(handle, windows.SE_SERVICE, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func verifyReceiptServiceIdentity(service *mgr.Service, command string, startType uint32, secure bool) error {
	first, err := service.Config()
	if err != nil {
		return err
	}
	status, err := service.Query()
	if err != nil || (status.State != svc.Stopped && status.State != svc.StartPending && status.State != svc.Running) ||
		first.BinaryPathName != command || first.StartType != startType || first.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS ||
		first.ErrorControl != windows.SERVICE_ERROR_NORMAL || first.DisplayName != "OneBots Legacy Migration Reboot Receipt" ||
		first.LoadOrderGroup != "" || len(first.Dependencies) != 0 || first.Description != "" || first.SidType != 0 ||
		!strings.EqualFold(first.ServiceStartName, "LocalSystem") || first.DelayedAutoStart {
		return errors.New("legacy receipt service identity changed")
	}
	if secure {
		expected, expectedErr := expectedReceiptServiceSDDL()
		sd, securityErr := windows.GetSecurityInfo(service.Handle, windows.SE_SERVICE, windows.DACL_SECURITY_INFORMATION)
		if expectedErr != nil || securityErr != nil || sd.String() != expected {
			return errors.New("legacy receipt service security changed")
		}
	}
	second, err := service.Config()
	if err != nil || !reflect.DeepEqual(first, second) {
		return errors.New("legacy receipt service changed during inspection")
	}
	return nil
}

func disarmReceiptService(request legacyRebootRequest) error {
	executable, _, err := currentExecutableDigest()
	if err != nil {
		return err
	}
	command, err := legacyReceiptCommand(executable, request)
	if err != nil {
		return err
	}
	service, err := openReceiptService(receiptControllerAccess())
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return nil
	}
	if err != nil {
		return err
	}
	defer service.Close()
	config, err := service.Config()
	if err != nil {
		return err
	}
	if config.StartType == mgr.StartDisabled {
		return verifyReceiptServiceIdentity(service, command, mgr.StartDisabled, true)
	}
	if config.StartType != mgr.StartAutomatic && config.StartType != mgr.StartManual {
		return errors.New("legacy receipt service has invalid start mode")
	}
	if err := verifyReceiptServiceIdentity(service, command, config.StartType, true); err != nil {
		return err
	}
	if !waitReceiptServiceStopped(service, 30*time.Second) {
		return errors.New("legacy receipt service is not stopped")
	}
	config.StartType = mgr.StartDisabled
	if err := service.UpdateConfig(config); err != nil {
		return err
	}
	return verifyReceiptServiceIdentity(service, command, mgr.StartDisabled, true)
}

func deleteReceiptService(request legacyRebootRequest) error {
	if err := disarmReceiptService(request); err != nil {
		return err
	}
	service, err := openReceiptService(receiptControllerAccess())
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := service.Delete(); err != nil {
		service.Close()
		return err
	}
	if err := service.Close(); err != nil {
		return err
	}
	deadline := time.Now().Add(120 * time.Second)
	for {
		probe, openErr := openReceiptService(windows.SERVICE_QUERY_STATUS)
		if errors.Is(openErr, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		if openErr == nil {
			_ = probe.Close()
		} else if !errors.Is(openErr, windows.ERROR_SERVICE_MARKED_FOR_DELETE) {
			return openErr
		}
		if time.Now().After(deadline) {
			return errors.New("legacy receipt service deletion timeout")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func disarmAndDeleteReceiptService(request legacyRebootRequest) error {
	return deleteReceiptService(request)
}

func verifyLegacyRollbackResult(expected legacySCMInspection) error {
	deadline := time.Now().Add(120 * time.Second)
	for {
		current, err := inspectFixedLegacyService()
		if err == nil && legacyConfigurationRestored(current, expected) && current.State == expected.State {
			if expected.State == "stopped" && current.Process == nil {
				return nil
			}
			if expected.State == "running" && current.Process != nil && current.Process.PID != 0 {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return errors.New("legacy service rollback readback failed")
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func waitReceiptServiceStopped(service *mgr.Service, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		status, err := service.Query()
		if err == nil && status.State == svc.Stopped && status.ProcessId == 0 {
			return true
		}
		if err != nil || time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func createProtectedDirectory(directory string) error {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	attributes, err := windows.GetFileAttributes(syscall.StringToUTF16Ptr(directory))
	if err != nil || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return errors.New("legacy reboot state directory is not a plain directory")
	}
	return applyPathDACL(directory)
}

func applyPathDACL(name string) error {
	sd, err := windows.SecurityDescriptorFromString(legacyReceiptFileSDDL)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(name, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func expectedReceiptFileSDDL() (string, error) {
	sd, err := windows.SecurityDescriptorFromString(legacyReceiptFileSDDL)
	if err != nil {
		return "", err
	}
	return sd.String(), nil
}

func createOrVerifyProtectedFile(name string, content []byte) error {
	file, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		if protectedFileEquals(name, content) {
			return nil
		}
		return errors.New("legacy reboot evidence changed")
	}
	if err != nil {
		return err
	}
	_, writeErr := file.Write(content)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return applyPathDACL(name)
}

func createProtectedAtomicFile(name string, content []byte) error {
	if exists(name) {
		if protectedFileEquals(name, content) {
			return nil
		}
		return errors.New("legacy reboot receipt changed")
	}
	temporary := name + ".tmp"
	if err := createOrVerifyProtectedFile(temporary, content); err != nil {
		return err
	}
	from, _ := windows.UTF16PtrFromString(temporary)
	to, _ := windows.UTF16PtrFromString(name)
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return err
	}
	if !protectedFileEquals(name, content) {
		return errors.New("legacy reboot receipt commit readback failed")
	}
	return nil
}

func protectedFileEquals(name string, expected []byte) bool {
	info, err := os.Lstat(name)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	attributes, err := windows.GetFileAttributes(syscall.StringToUTF16Ptr(name))
	if err != nil || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return false
	}
	expectedSDDL, _ := expectedReceiptFileSDDL()
	sd, err := windows.GetNamedSecurityInfo(name, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil || sd.String() != expectedSDDL {
		return false
	}
	bytes, err := os.ReadFile(name)
	return err == nil && string(bytes) == string(expected)
}

func scheduleMarkerRename(before, after string) error {
	from, _ := windows.UTF16PtrFromString(before)
	to, _ := windows.UTF16PtrFromString(after)
	return windows.MoveFileEx(from, to, windows.MOVEFILE_DELAY_UNTIL_REBOOT)
}

func readLegacyRebootReceipt(name string) (legacyRebootReceipt, error) {
	bytes, err := os.ReadFile(name)
	if err != nil || len(bytes) > 4096 || !protectedFileEquals(name, bytes) || !legacyJSONKeysUnique(bytes) {
		return legacyRebootReceipt{}, errors.New("invalid legacy reboot receipt")
	}
	var value legacyRebootReceipt
	decoder := json.NewDecoder(strings.NewReader(string(bytes)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || value.SchemaVersion != 1 {
		return legacyRebootReceipt{}, errors.New("invalid legacy reboot receipt")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return legacyRebootReceipt{}, errors.New("invalid legacy reboot receipt")
	}
	return value, nil
}

func removeExactLegacyEvidence(request legacyRebootRequest) error {
	_, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return err
	}
	_, before, after, receipt := legacyRebootPaths(request)
	marker := legacyRebootMarker(request, hostDigest)
	for _, name := range []string{before, after} {
		if exists(name) {
			if !protectedFileEquals(name, marker) {
				return errors.New("legacy reboot marker changed before cleanup")
			}
			if err := os.Remove(name); err != nil {
				return err
			}
		}
	}
	if exists(receipt) {
		value, err := readLegacyRebootReceipt(receipt)
		if err != nil || value != (legacyRebootReceipt{1, request.OperationID, request.SnapshotDigest, request.Nonce, hostDigest, "auto"}) {
			if err != nil {
				return err
			}
			return errors.New("legacy reboot receipt changed before cleanup")
		}
		if err := os.Remove(receipt); err != nil {
			return err
		}
	}
	return nil
}

func exists(name string) bool {
	_, err := os.Lstat(name)
	return err == nil
}
