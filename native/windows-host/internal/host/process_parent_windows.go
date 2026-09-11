//go:build windows

package host

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// directParentProcessID reads the immutable parent recorded for the live client PID.
// authorize keeps a handle to that client open and rechecks the pipe PID around this lookup,
// preventing a replaced pipe client from borrowing another process relationship.
func directParentProcessID(pid uint32) (uint32, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return 0, err
	}
	for {
		if entry.ProcessID == pid {
			if entry.ParentProcessID == 0 {
				return 0, errors.New("pipe client parent pid is zero")
			}
			return entry.ParentProcessID, nil
		}
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
				return 0, errors.New("pipe client process is absent from snapshot")
			}
			return 0, err
		}
	}
}
