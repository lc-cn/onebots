//go:build windows

package host

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func runLegacyRebootControl(encoded string, output io.Writer) error {
	request, err := decodeLegacyRebootRequest(encoded, "prepare", "inspect", "cleanup", "rollback", "restart", "commit")
	if err != nil {
		return err
	}
	phase := "awaiting-restart"
	ready := false
	switch request.Operation {
	case "prepare":
		ready, err = prepareLegacyReboot(request)
	case "inspect":
		ready, err = inspectLegacyRebootReady(request)
	case "cleanup":
		err = cleanupLegacyReboot(request)
		phase = "cleaned"
		ready = err == nil
	case "rollback":
		err = rollbackLegacyReboot(request)
		phase = "rolled-back"
	case "restart":
		err = requestLegacyFullRestart(request)
		phase = "restart-requested"
	case "commit":
		err = commitLegacyReboot(request)
		phase = "legacy-removed"
	}
	if err != nil {
		return err
	}
	if ready {
		phase = "restoration-ready"
	}
	return json.NewEncoder(output).Encode(legacyRebootResult{1, request.OperationID, phase, ready})
}

// commit is deliberately separate from cleanup: callers may remove the old
// registration only after the replacement manager has passed its own checks.
// The reboot receipt remains available to reconcile an unknown delete result.
func commitLegacyReboot(request legacyRebootRequest) error {
	if !inspectLegacyRebootBoundary(request) {
		return errors.New("legacy reboot receipt is not restoration-ready")
	}
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	legacy, err := manager.OpenService(legacySystemServiceName)
	if err != nil {
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		return err
	}
	current, err := inspectOpenedLegacyService(legacy)
	if err != nil || !legacyDisabledAndStopped(current, request.Expected) {
		_ = legacy.Close()
		return errors.New("legacy service changed before commit")
	}
	if err := legacy.Delete(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_MARKED_FOR_DELETE) {
		_ = legacy.Close()
		return err
	}
	if err := legacy.Close(); err != nil {
		return err
	}
	deadline := time.Now().Add(120 * time.Second)
	for !fixedLegacyServiceAbsent() {
		if time.Now().After(deadline) {
			return errors.New("legacy service deletion timeout")
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}

func inspectLegacyRebootBoundary(request legacyRebootRequest) bool {
	executable, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return false
	}
	command, err := legacyReceiptCommand(executable, request)
	if err != nil {
		return false
	}
	helper, err := openReceiptService(receiptControllerAccess())
	if err != nil {
		return false
	}
	defer helper.Close()
	if verifyReceiptServiceIdentity(helper, command, mgr.StartAutomatic, true) != nil {
		return false
	}
	_, before, after, receiptPath := legacyRebootPaths(request)
	if exists(before) || !protectedFileEquals(after, legacyRebootMarker(request, hostDigest)) {
		return false
	}
	receipt, err := readLegacyRebootReceipt(receiptPath)
	expected := legacyRebootReceipt{1, request.OperationID, request.SnapshotDigest, request.Nonce, hostDigest, "auto"}
	return err == nil && receipt == expected
}

func prepareLegacyReboot(request legacyRebootRequest) (bool, error) {
	if ready, _ := inspectLegacyRebootReady(request); ready {
		return true, nil
	}
	current, err := inspectFixedLegacyService()
	if err != nil || (!reflect.DeepEqual(current, request.Expected) && !legacyDisabledForRollback(current, request.Expected)) {
		return false, errors.New("legacy service changed before reboot preparation")
	}
	executable, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return false, err
	}
	directory, before, after, receipt := legacyRebootPaths(request)
	if err := createProtectedDirectory(directory); err != nil {
		return false, err
	}
	marker := legacyRebootMarker(request, hostDigest)
	if exists(after) || exists(receipt) {
		return false, errors.New("legacy reboot evidence changed before preparation")
	}
	if err := createOrVerifyProtectedFile(before, marker); err != nil {
		return false, err
	}
	if err := scheduleMarkerRename(before, after); err != nil {
		return false, err
	}
	command, err := legacyReceiptCommand(executable, request)
	if err != nil {
		return false, err
	}
	helper, created, err := openOrCreateReceiptService(command)
	if err != nil {
		return false, err
	}
	defer helper.Close()
	config, err := helper.Config()
	if err != nil {
		return false, err
	}
	if config.StartType != mgr.StartManual && config.StartType != mgr.StartAutomatic {
		return false, errors.New("legacy receipt service has invalid start mode")
	}
	if err := verifyReceiptServiceIdentity(helper, command, config.StartType, false); err != nil {
		return false, err
	}
	if created || !receiptServiceSecurityMatches(helper) {
		if err := applyReceiptServiceDACL(helper.Handle); err != nil {
			return false, err
		}
	}
	if err := verifyReceiptServiceIdentity(helper, command, config.StartType, true); err != nil {
		return false, err
	}
	if reflect.DeepEqual(current, request.Expected) {
		if err := disableLegacyService(request.Expected); err != nil {
			return false, err
		}
	}
	if config.StartType != mgr.StartAutomatic {
		config.StartType = mgr.StartAutomatic
		if err := helper.UpdateConfig(config); err != nil {
			return false, err
		}
	}
	if err := verifyReceiptServiceIdentity(helper, command, mgr.StartAutomatic, true); err != nil {
		return false, err
	}
	return false, nil
}

func inspectLegacyRebootReady(request legacyRebootRequest) (bool, error) {
	executable, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return false, err
	}
	command, err := legacyReceiptCommand(executable, request)
	if err != nil {
		return false, err
	}
	helper, err := openReceiptService(receiptControllerAccess())
	if err != nil {
		return false, err
	}
	defer helper.Close()
	if err := verifyReceiptServiceIdentity(helper, command, mgr.StartAutomatic, true); err != nil {
		return false, err
	}
	_, before, after, receiptPath := legacyRebootPaths(request)
	if exists(before) || !protectedFileEquals(after, legacyRebootMarker(request, hostDigest)) {
		return false, nil
	}
	current, err := inspectFixedLegacyService()
	if err != nil || !legacyDisabledAndStopped(current, request.Expected) {
		return false, nil
	}
	receipt, err := readLegacyRebootReceipt(receiptPath)
	if err != nil {
		return false, nil
	}
	expected := legacyRebootReceipt{1, request.OperationID, request.SnapshotDigest, request.Nonce, hostDigest, "auto"}
	return receipt == expected, nil
}

func cleanupLegacyReboot(request legacyRebootRequest) error {
	if receiptServiceAbsent() && fixedLegacyServiceAbsent() && inspectCommittedLegacyRebootEvidence(request) {
		return nil
	}
	ready, err := inspectLegacyRebootReady(request)
	if err != nil {
		ready = inspectLegacyRebootEvidence(request)
	}
	if !ready && inspectLegacyRebootBoundary(request) {
		ready = fixedLegacyServiceAbsent()
	}
	if !ready {
		return errors.New("legacy reboot receipt is not restoration-ready")
	}
	return disarmAndDeleteReceiptService(request)
}

func inspectCommittedLegacyRebootEvidence(request legacyRebootRequest) bool {
	_, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return false
	}
	_, before, after, receiptPath := legacyRebootPaths(request)
	if exists(before) || !protectedFileEquals(after, legacyRebootMarker(request, hostDigest)) {
		return false
	}
	receipt, err := readLegacyRebootReceipt(receiptPath)
	expected := legacyRebootReceipt{1, request.OperationID, request.SnapshotDigest, request.Nonce, hostDigest, "auto"}
	return err == nil && receipt == expected
}

func fixedLegacyServiceAbsent() bool {
	manager, err := mgr.Connect()
	if err != nil {
		return false
	}
	defer manager.Disconnect()
	service, err := manager.OpenService(legacySystemServiceName)
	if err == nil {
		service.Close()
		return false
	}
	return errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST)
}

func rollbackLegacyReboot(request legacyRebootRequest) error {
	current, err := inspectFixedLegacyService()
	if err != nil || (!legacyDisabledForRollback(current, request.Expected) && !legacyConfigurationRestored(current, request.Expected)) {
		return errors.New("legacy service changed before rollback")
	}
	if legacyConfigurationRestored(current, request.Expected) && receiptServiceAbsent() {
		return removeExactLegacyEvidence(request)
	}
	if err := disarmReceiptService(request); err != nil {
		return err
	}
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	legacy, err := manager.OpenService(legacySystemServiceName)
	if err != nil {
		return err
	}
	defer legacy.Close()
	config, err := legacy.Config()
	if err != nil {
		return err
	}
	if config.StartType == mgr.StartDisabled {
		config.StartType = request.Expected.Configuration.StartType
		if err := legacy.UpdateConfig(config); err != nil {
			return err
		}
	}
	if request.Expected.State == "running" && current.State == "stopped" {
		if err := legacy.Start(); err != nil {
			return err
		}
	}
	if err := verifyLegacyRollbackResult(request.Expected); err != nil {
		return err
	}
	if err := deleteReceiptService(request); err != nil {
		return err
	}
	return removeExactLegacyEvidence(request)
}

func receiptServiceAbsent() bool {
	service, err := openReceiptService(windows.SERVICE_QUERY_STATUS)
	if err == nil {
		_ = service.Close()
		return false
	}
	return errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST)
}

func inspectLegacyRebootEvidence(request legacyRebootRequest) bool {
	_, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return false
	}
	_, before, after, receiptPath := legacyRebootPaths(request)
	if exists(before) || !protectedFileEquals(after, legacyRebootMarker(request, hostDigest)) {
		return false
	}
	current, err := inspectFixedLegacyService()
	if err != nil || !legacyDisabledAndStopped(current, request.Expected) {
		return false
	}
	receipt, err := readLegacyRebootReceipt(receiptPath)
	return err == nil && receipt == (legacyRebootReceipt{1, request.OperationID, request.SnapshotDigest, request.Nonce, hostDigest, "auto"})
}

func requestLegacyFullRestart(request legacyRebootRequest) error {
	executable, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return err
	}
	command, err := legacyReceiptCommand(executable, request)
	if err != nil {
		return err
	}
	helper, err := openReceiptService(receiptControllerAccess())
	if err != nil {
		return err
	}
	defer helper.Close()
	if err := verifyReceiptServiceIdentity(helper, command, mgr.StartAutomatic, true); err != nil {
		return err
	}
	_, before, after, receipt := legacyRebootPaths(request)
	if !protectedFileEquals(before, legacyRebootMarker(request, hostDigest)) || exists(after) || exists(receipt) {
		return errors.New("legacy reboot preparation is incomplete")
	}
	current, err := inspectFixedLegacyService()
	if err != nil || !legacyDisabledForRollback(current, request.Expected) {
		return errors.New("legacy service changed before restart")
	}
	return initiateFullRestart()
}

func initiateFullRestart() error {
	token := windows.Token(0)
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY, &token); err != nil {
		return err
	}
	defer token.Close()
	var luid windows.LUID
	if err := windows.LookupPrivilegeValue(nil, windows.StringToUTF16Ptr("SeShutdownPrivilege"), &luid); err != nil {
		return err
	}
	privileges := windows.Tokenprivileges{PrivilegeCount: 1}
	privileges.Privileges[0] = windows.LUIDAndAttributes{Luid: luid, Attributes: windows.SE_PRIVILEGE_ENABLED}
	if err := windows.AdjustTokenPrivileges(token, false, &privileges, 0, nil, nil); err != nil {
		return err
	}
	procedure := windows.NewLazySystemDLL("advapi32.dll").NewProc("InitiateShutdownW")
	message, _ := windows.UTF16PtrFromString("OneBots 旧服务迁移需要完成一次完整重启")
	const shutdownRestart = 0x00000004
	const reasonPlannedReconfiguration = 0x80000000 | 0x00040000 | 0x00000004
	result, _, _ := procedure.Call(0, uintptr(unsafe.Pointer(message)), 0, shutdownRestart, reasonPlannedReconfiguration)
	if result != 0 {
		return fmt.Errorf("InitiateShutdownW failed: %d", result)
	}
	return nil
}

func encodeLegacyRebootRequest(request legacyRebootRequest) (string, error) {
	bytes, err := json.Marshal(request)
	return base64.RawURLEncoding.EncodeToString(bytes), err
}

func legacyReceiptCommand(executable string, request legacyRebootRequest) (string, error) {
	receipt := request
	receipt.Operation = "receipt"
	encoded, err := encodeLegacyRebootRequest(receipt)
	return quoteLegacyWindowsArgument(executable) + " legacy-reboot-receipt --request " + encoded, err
}

func quoteLegacyWindowsArgument(value string) string {
	if !strings.ContainsAny(value, " \t\"") {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func runLegacyRebootReceipt(encoded string) error {
	request, err := decodeLegacyRebootRequest(encoded, "receipt")
	if err != nil {
		return err
	}
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		return errors.New("legacy reboot receipt must be launched by SCM")
	}
	return svc.Run(legacyRebootServiceName, &legacyReceiptHandler{request: request})
}

type legacyReceiptHandler struct{ request legacyRebootRequest }

func (handler *legacyReceiptHandler) Execute(_ []string, _ <-chan svc.ChangeRequest, statuses chan<- svc.Status) (bool, uint32) {
	statuses <- svc.Status{State: svc.StartPending, WaitHint: 30_000}
	reason, err := svc.DynamicStartReason()
	if err != nil || reason != svc.StartReasonAuto {
		return true, 2
	}
	if err := createLegacyRebootReceipt(handler.request); err != nil {
		return true, 3
	}
	statuses <- svc.Status{State: svc.Stopped}
	return false, 0
}

func createLegacyRebootReceipt(request legacyRebootRequest) error {
	executable, hostDigest, err := currentExecutableDigest()
	if err != nil {
		return err
	}
	command, err := legacyReceiptCommand(executable, request)
	if err != nil {
		return err
	}
	helper, err := openReceiptService(receiptControllerAccess())
	if err != nil {
		return err
	}
	defer helper.Close()
	if err := verifyReceiptServiceIdentity(helper, command, mgr.StartAutomatic, true); err != nil {
		return err
	}
	_, before, after, receiptPath := legacyRebootPaths(request)
	if exists(before) || !protectedFileEquals(after, legacyRebootMarker(request, hostDigest)) {
		return errors.New("legacy reboot marker was not completed")
	}
	current, err := inspectFixedLegacyService()
	if err != nil || !legacyDisabledAndStopped(current, request.Expected) {
		return errors.New("legacy service is not safely stopped after reboot")
	}
	receipt := legacyRebootReceipt{1, request.OperationID, request.SnapshotDigest, request.Nonce, hostDigest, "auto"}
	bytes, _ := json.Marshal(receipt)
	bytes = append(bytes, '\n')
	return createProtectedAtomicFile(receiptPath, bytes)
}

func currentExecutableDigest() (string, string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	return executableDigest(executable)
}
