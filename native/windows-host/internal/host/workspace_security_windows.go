//go:build windows

package host

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const workspaceAllAccess = 0x1f01ff

type workspaceAnchor struct {
	handles []windows.Handle
	handle  windows.Handle
	info    windows.ByHandleFileInformation
}

func (anchor *workspaceAnchor) close() {
	for index := len(anchor.handles) - 1; index >= 0; index-- {
		_ = windows.CloseHandle(anchor.handles[index])
	}
	anchor.handles = nil
}

func currentWorkspaceSID() (string, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return "", errors.New("private storage identity unavailable")
	}
	return user.User.Sid.String(), nil
}

func checkWorkspaceACL(handle windows.Handle, directory bool) error {
	current, err := currentWorkspaceSID()
	if err != nil {
		return err
	}
	allowed := map[string]bool{current: true, "S-1-5-18": true, "S-1-5-32-544": true}
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || !allowed[owner.String()] {
		return errors.New("private storage owner invalid")
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("private storage ACL is not protected")
	}
	acl, defaulted, err := descriptor.DACL()
	if err != nil || defaulted || acl == nil || acl.AceCount < 1 || acl.AceCount > 3 {
		return errors.New("private storage ACL invalid")
	}
	seen := map[string]bool{}
	for index := uint32(0); index < uint32(acl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(acl, index, &ace); err != nil {
			return err
		}
		flags := byte(0)
		if directory {
			flags = windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags & ^flags != 0 {
			return errors.New("private storage ACE invalid")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
		if !allowed[sid] || seen[sid] || (ace.Mask != workspaceAllAccess && ace.Mask != windows.GENERIC_ALL) {
			return errors.New("private storage permissions invalid")
		}
		seen[sid] = true
	}
	if !seen[owner.String()] {
		return errors.New("private storage owner has no explicit access")
	}
	return nil
}

func workspaceSecurity(directory bool) (*windows.SecurityAttributes, error) {
	current, err := currentWorkspaceSID()
	if err != nil {
		return nil, err
	}
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return nil, err
	}
	elevated := token.IsElevated()
	_ = token.Close()
	// SCM runs as LocalSystem; elevated offline enrollment must create the same
	// Administrators/SYSTEM private state that the service can subsequently verify.
	if elevated || current == "S-1-5-18" {
		current = "S-1-5-32-544"
	}
	flags := ""
	if directory {
		flags = "OICI"
	}
	descriptor := "O:" + current + "D:P"
	seen := map[string]bool{}
	for _, sid := range []string{current, "S-1-5-18", "S-1-5-32-544"} {
		if !seen[sid] {
			descriptor += "(A;" + flags + ";FA;;;" + sid + ")"
			seen[sid] = true
		}
	}
	sd, err := windows.SecurityDescriptorFromString(descriptor)
	if err != nil {
		return nil, err
	}
	return &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}, nil
}

// Hold every ancestor without FILE_SHARE_DELETE; reject reparse traversal and network filesystems.
func validateWorkspacePath(name string) error {
	volume := filepath.VolumeName(name)
	if len(volume) != 2 || volume[1] != ':' || !filepath.IsAbs(name) || filepath.Clean(name) != name || strings.ContainsAny(name, "\x00\r\n") {
		return errors.New("private storage path invalid")
	}
	for _, part := range strings.Split(strings.TrimPrefix(name, volume+`\`), `\`) {
		if strings.Contains(part, ":") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return errors.New("private storage component invalid")
		}
	}
	return nil
}

func openWorkspacePath(name string, directory, private bool) (*workspaceAnchor, error) {
	if err := validateWorkspacePath(name); err != nil {
		return nil, err
	}
	volume := filepath.VolumeName(name)
	root := volume + `\`
	rootPointer, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return nil, err
	}
	if windows.GetDriveType(rootPointer) != windows.DRIVE_FIXED {
		return nil, errors.New("private storage requires a local fixed volume")
	}
	parts := []string{root}
	current := root
	for _, part := range strings.Split(strings.TrimPrefix(name, root), `\`) {
		if part == "" {
			continue
		}
		if strings.Contains(part, ":") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return nil, errors.New("private storage component invalid")
		}
		current = filepath.Join(current, part)
		parts = append(parts, current)
	}
	anchor := &workspaceAnchor{}
	failed := true
	defer func() {
		if failed {
			anchor.close()
		}
	}()
	for index, part := range parts {
		last := index == len(parts)-1
		pointer, err := windows.UTF16PtrFromString(part)
		if err != nil {
			return nil, err
		}
		access := uint32(windows.FILE_READ_ATTRIBUTES | windows.GENERIC_READ)
		if last && private {
			access |= windows.READ_CONTROL
		}
		if last && !directory {
			access |= windows.GENERIC_READ
		}
		handle, err := windows.CreateFile(pointer, access, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
		if err != nil {
			return nil, err
		}
		anchor.handles = append(anchor.handles, handle)
		var info windows.ByHandleFileInformation
		if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
			return nil, err
		}
		isDirectory := info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0
		if info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || isDirectory != (!last || directory) || (last && !directory && info.NumberOfLinks != 1) {
			return nil, errors.New("private storage object invalid")
		}
		if last {
			anchor.handle = handle
			anchor.info = info
		}
	}
	var fileSystem [32]uint16
	if err := windows.GetVolumeInformationByHandle(anchor.handle, nil, 0, nil, nil, nil, &fileSystem[0], uint32(len(fileSystem))); err != nil {
		return nil, err
	}
	format := windows.UTF16ToString(fileSystem[:])
	if format != "NTFS" && format != "ReFS" {
		return nil, fmt.Errorf("private storage filesystem unsupported")
	}
	if private {
		if err := checkWorkspaceACL(anchor.handle, directory); err != nil {
			return nil, err
		}
	}
	failed = false
	return anchor, nil
}
