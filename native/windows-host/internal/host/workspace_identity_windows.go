//go:build windows

package host

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

func workspaceStorageProof(output io.Writer) error {
	return json.NewEncoder(output).Encode(struct {
		Version  int  `json:"version"`
		Verified bool `json:"verified"`
	}{1, true})
}

func runWorkspaceStorage(operation, name string, output io.Writer) error {
	if operation == "private-directory-create" {
		if err := validateWorkspacePath(name); err != nil {
			return err
		}
		parent, err := openWorkspacePath(filepath.Dir(name), true, false)
		if err != nil {
			return err
		}
		defer parent.close()
		// Validate target syntax with the same local path constraints before creating anything.
		if filepath.Clean(name) != name || filepath.Base(name) == "." || filepath.VolumeName(name) != filepath.VolumeName(filepath.Dir(name)) {
			return fmt.Errorf("private directory path invalid")
		}
		attributes, err := workspaceSecurity(true)
		if err != nil {
			return err
		}
		pointer, err := windows.UTF16PtrFromString(name)
		if err != nil {
			return err
		}
		if err := windows.CreateDirectory(pointer, attributes); err != nil {
			return err
		}
	}
	if operation == "private-file-inspect" {
		parent, err := openWorkspacePath(filepath.Dir(name), true, true)
		if err != nil {
			return err
		}
		defer parent.close()
		file, err := openWorkspacePath(name, false, true)
		if err != nil {
			return err
		}
		defer file.close()
		return workspaceStorageProof(output)
	}
	directory, err := openWorkspacePath(name, true, true)
	if err != nil {
		return err
	}
	defer directory.close()
	if operation == "private-directory-create" {
		return workspaceStorageProof(output)
	}
	var identity struct {
		VolumeSerial uint64
		FileID       [16]byte
	}
	if err := windows.GetFileInformationByHandleEx(directory.handle, windows.FileIdInfo, (*byte)(unsafe.Pointer(&identity)), uint32(unsafe.Sizeof(identity))); err != nil {
		return err
	}
	proof := struct {
		Version      int      `json:"version"`
		VolumeSerial string   `json:"volumeSerial"`
		FileID       string   `json:"fileId"`
		Handles      []string `json:"handles,omitempty"`
	}{Version: 1, VolumeSerial: fmt.Sprintf("%016x", identity.VolumeSerial), FileID: hex.EncodeToString(identity.FileID[:])}
	if operation == "workspace-anchor" {
		proof.Handles, err = retainWorkspaceAnchors(directory)
		if err != nil {
			return err
		}
	}
	return json.NewEncoder(output).Encode(proof)
}
