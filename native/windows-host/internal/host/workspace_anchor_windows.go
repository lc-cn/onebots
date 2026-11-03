//go:build windows

package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"

	"golang.org/x/sys/windows"
)

var workspaceHandlePattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

func workspaceParent() (windows.Handle, error) {
	pid, err := directParentProcessID(windows.GetCurrentProcessId())
	if err != nil {
		return 0, err
	}
	parent, err := windows.OpenProcess(windows.PROCESS_DUP_HANDLE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, err
	}
	self, err := windows.GetCurrentProcess()
	if err != nil {
		_ = windows.CloseHandle(parent)
		return 0, err
	}
	var parentCreation, childCreation, exit, kernel, user windows.Filetime
	if err = windows.GetProcessTimes(parent, &parentCreation, &exit, &kernel, &user); err == nil {
		err = windows.GetProcessTimes(self, &childCreation, &exit, &kernel, &user)
	}
	if err != nil || parentCreation.Nanoseconds() >= childCreation.Nanoseconds() {
		_ = windows.CloseHandle(parent)
		return 0, errors.New("private anchor parent process identity unavailable")
	}
	return parent, nil
}

// DuplicateHandle preserves the same directory object and share restrictions in the parent
// Node process. No helper remains running; parent exit releases these non-inheritable handles.
// https://learn.microsoft.com/windows/win32/api/handleapi/nf-handleapi-duplicatehandle
func retainWorkspaceAnchors(anchor *workspaceAnchor) ([]string, error) {
	if len(anchor.handles) > 128 {
		return nil, errors.New("private path too deep")
	}
	parent, err := workspaceParent()
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(parent)
	self, err := windows.GetCurrentProcess()
	if err != nil {
		return nil, err
	}
	remote := []windows.Handle{}
	failed := true
	defer func() {
		if failed {
			for _, handle := range remote {
				_ = windows.DuplicateHandle(parent, handle, 0, nil, 0, false, windows.DUPLICATE_CLOSE_SOURCE)
			}
		}
	}()
	result := []string{}
	for _, handle := range anchor.handles {
		var copy windows.Handle
		if err := windows.DuplicateHandle(self, handle, parent, &copy, 0, false, windows.DUPLICATE_SAME_ACCESS); err != nil {
			return nil, err
		}
		remote = append(remote, copy)
		result = append(result, fmt.Sprintf("%016x", uintptr(copy)))
	}
	failed = false
	return result, nil
}

func runWorkspaceAnchorRelease(input io.Reader, output io.Writer) error {
	var request struct {
		Version int      `json:"version"`
		Handles []string `json:"handles"`
	}
	decoder := json.NewDecoder(io.LimitReader(input, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF || request.Version != 1 || len(request.Handles) < 1 || len(request.Handles) > 128 {
		return errors.New("private anchor release invalid")
	}
	handles := []windows.Handle{}
	seen := map[string]bool{}
	for _, value := range request.Handles {
		if !workspaceHandlePattern.MatchString(value) || seen[value] {
			return errors.New("private anchor token invalid")
		}
		seen[value] = true
		parsed, err := strconv.ParseUint(value, 16, 64)
		if err != nil || parsed == 0 || windows.Handle(parsed) == windows.InvalidHandle {
			return errors.New("private anchor token invalid")
		}
		handles = append(handles, windows.Handle(parsed))
	}
	parent, err := workspaceParent()
	if err != nil {
		return err
	}
	defer windows.CloseHandle(parent)
	var failures []error
	for index := len(handles) - 1; index >= 0; index-- {
		// CLOSE_SOURCE may take effect even when DuplicateHandle reports an error.
		// The caller must never replay numeric handle tokens after an unknown outcome.
		if err := windows.DuplicateHandle(parent, handles[index], 0, nil, 0, false, windows.DUPLICATE_CLOSE_SOURCE); err != nil {
			failures = append(failures, err)
		}
	}
	if len(failures) != 0 {
		return errors.Join(failures...)
	}
	return workspaceStorageProof(output)
}
