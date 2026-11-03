//go:build windows

package host

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"regexp"

	"golang.org/x/sys/windows"
)

const maxWorkspaceFileBytes = 4 * 1024 * 1024

var privateFileNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
var privateDigestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type privateReplacementRequest struct {
	Version        int             `json:"version"`
	Directory      string          `json:"directory"`
	FileName       string          `json:"fileName"`
	ExpectedDigest json.RawMessage `json:"expectedDigest"`
	Bytes          string          `json:"bytes"`
}

func readWorkspaceFile(name string) ([]byte, error) {
	anchor, err := openWorkspacePath(name, false, true)
	if err != nil {
		return nil, err
	}
	defer anchor.close()
	size := uint64(anchor.info.FileSizeHigh)<<32 | uint64(anchor.info.FileSizeLow)
	if size > maxWorkspaceFileBytes {
		return nil, errors.New("private file too large")
	}
	bytes := make([]byte, size)
	offset := 0
	for offset < len(bytes) {
		var read uint32
		if err := windows.ReadFile(anchor.handle, bytes[offset:], &read, nil); err != nil {
			return nil, err
		}
		if read == 0 {
			return nil, io.ErrUnexpectedEOF
		}
		offset += int(read)
	}
	var after windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(anchor.handle, &after); err != nil {
		return nil, err
	}
	if after.FileSizeHigh != anchor.info.FileSizeHigh || after.FileSizeLow != anchor.info.FileSizeLow || after.LastWriteTime != anchor.info.LastWriteTime {
		return nil, errors.New("private file changed while reading")
	}
	return bytes, nil
}

func checkPrivateExpected(name string, expected *string) error {
	bytes, err := readWorkspaceFile(name)
	if expected == nil {
		if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
			return nil
		}
		if err != nil {
			return err
		}
		return errors.New("private target already exists")
	}
	if err != nil {
		return err
	}
	sum := sha256.Sum256(bytes)
	if hex.EncodeToString(sum[:]) != *expected {
		return errors.New("private target changed")
	}
	return nil
}

// Same-volume WRITE_THROUGH is the Windows durability barrier; never substitute Node rename.
// https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-movefileexw
func runPrivateFileReplace(input io.Reader, output io.Writer) error {
	decoder := json.NewDecoder(io.LimitReader(input, 6*1024*1024))
	decoder.DisallowUnknownFields()
	var request privateReplacementRequest
	if err := decoder.Decode(&request); err != nil {
		return err
	}
	var trailing interface{}
	if decoder.Decode(&trailing) != io.EOF {
		return errors.New("private request trailing data")
	}
	if request.Version != 1 || !privateFileNamePattern.MatchString(request.FileName) || request.FileName == "." || request.FileName == ".." || len(request.ExpectedDigest) == 0 {
		return errors.New("private request invalid")
	}
	var expected *string
	if err := json.Unmarshal(request.ExpectedDigest, &expected); err != nil {
		return err
	}
	if expected != nil && !privateDigestPattern.MatchString(*expected) {
		return errors.New("private digest invalid")
	}
	bytes, err := base64.StdEncoding.Strict().DecodeString(request.Bytes)
	if err != nil || len(bytes) > maxWorkspaceFileBytes {
		return errors.New("private bytes invalid")
	}
	parent, err := openWorkspacePath(request.Directory, true, true)
	if err != nil {
		return err
	}
	defer parent.close()
	target := filepath.Join(request.Directory, request.FileName)
	if err := checkPrivateExpected(target, expected); err != nil {
		return err
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	temporary := filepath.Join(request.Directory, ".onebots-private-"+hex.EncodeToString(random)+".tmp")
	attributes, err := workspaceSecurity(false)
	if err != nil {
		return err
	}
	pointer, err := windows.UTF16PtrFromString(temporary)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(pointer, windows.GENERIC_WRITE|windows.READ_CONTROL, 0, attributes, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_WRITE_THROUGH, 0)
	if err != nil {
		return err
	}
	closed := false
	defer func() {
		if !closed {
			_ = windows.CloseHandle(handle)
		}
	}()
	if err := checkWorkspaceACL(handle, false); err != nil {
		return err
	}
	offset := 0
	for offset < len(bytes) {
		var written uint32
		if err := windows.WriteFile(handle, bytes[offset:], &written, nil); err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		offset += int(written)
	}
	if err := windows.FlushFileBuffers(handle); err != nil {
		return err
	}
	closeErr := windows.CloseHandle(handle)
	closed = true
	if closeErr != nil {
		return closeErr
	}
	if err := checkPrivateExpected(target, expected); err != nil {
		return err
	}
	targetPointer, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	flags := uint32(windows.MOVEFILE_WRITE_THROUGH)
	if expected != nil {
		flags |= windows.MOVEFILE_REPLACE_EXISTING
	}
	if err := windows.MoveFileEx(pointer, targetPointer, flags); err != nil {
		return err
	}
	actual, err := readWorkspaceFile(target)
	if err != nil {
		return err
	}
	if sha256.Sum256(actual) != sha256.Sum256(bytes) {
		return errors.New("private replacement mismatch")
	}
	return workspaceStorageProof(output)
}
