//go:build windows

package host

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func privateWorkspaceFixture(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "private")
	if err := runWorkspaceStorage("private-directory-create", root, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	return root
}

func replacementRequest(directory string, expected *string, contents string) *bytes.Reader {
	encoded, _ := json.Marshal(map[string]interface{}{"version": 1, "directory": directory, "fileName": "auth.json", "expectedDigest": expected, "bytes": base64.StdEncoding.EncodeToString([]byte(contents))})
	return bytes.NewReader(encoded)
}

type privateTestFileIdentity struct {
	VolumeSerial uint64
	FileID       [16]byte
}

func snapshotPrivateTestFileIdentity(t *testing.T, name string) privateTestFileIdentity {
	t.Helper()
	pointer, err := windows.UTF16PtrFromString(name)
	if err != nil {
		t.Fatal(err)
	}
	// Capture the ID now: os.Stat may defer this read until SameFile reopens the
	// replaced path. Close before replacement: legacy rename can reject an open
	// destination even when the observer specified FILE_SHARE_DELETE.
	handle, err := windows.CreateFile(pointer, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := windows.CloseHandle(handle); err != nil {
			t.Error(err)
		}
	}()
	var identity privateTestFileIdentity
	if err := windows.GetFileInformationByHandleEx(handle, windows.FileIdInfo, (*byte)(unsafe.Pointer(&identity)), uint32(unsafe.Sizeof(identity))); err != nil {
		t.Fatal(err)
	}
	return identity
}

func TestWorkspaceIdentityPersistsRenameAndRejectsOtherObjects(t *testing.T) {
	root := privateWorkspaceFixture(t)
	var original bytes.Buffer
	if err := runWorkspaceStorage("workspace-identity", root, &original); err != nil {
		t.Fatal(err)
	}
	renamed := root + "-renamed"
	if err := os.Rename(root, renamed); err != nil {
		t.Fatal(err)
	}
	var after bytes.Buffer
	if err := runWorkspaceStorage("workspace-identity", renamed, &after); err != nil {
		t.Fatal(err)
	}
	if original.String() != after.String() {
		t.Fatal("same physical directory identity changed after rename")
	}
	other := privateWorkspaceFixture(t)
	var otherProof bytes.Buffer
	if err := runWorkspaceStorage("workspace-identity", other, &otherProof); err != nil {
		t.Fatal(err)
	}
	if original.String() == otherProof.String() {
		t.Fatal("different objects have same identity")
	}
	if err := runWorkspaceStorage("private-directory-create", other, &bytes.Buffer{}); err == nil {
		t.Fatal("existing directory was claimed")
	}
}

func TestPrivateReplacementChecksExpectedStateAndFlushesSameBytesAgain(t *testing.T) {
	root := privateWorkspaceFixture(t)
	if err := runPrivateFileReplace(replacementRequest(root, nil, "first"), &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "auth.json")
	before := snapshotPrivateTestFileIdentity(t, file)
	if err := runWorkspaceStorage("private-file-inspect", file, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if err := runPrivateFileReplace(replacementRequest(root, nil, "overwrite"), &bytes.Buffer{}); err == nil {
		t.Fatal("expected missing overwrote existing target")
	}
	wrong := "0000000000000000000000000000000000000000000000000000000000000000"
	if err := runPrivateFileReplace(replacementRequest(root, &wrong, "overwrite"), &bytes.Buffer{}); err == nil {
		t.Fatal("wrong digest overwrote target")
	}
	if snapshotPrivateTestFileIdentity(t, file) != before {
		t.Fatal("rejected replacement changed target identity")
	}
	if content, err := os.ReadFile(file); err != nil || string(content) != "first" {
		t.Fatal("rejected replacement changed target contents")
	}
	sum := sha256.Sum256([]byte("first"))
	digest := hex.EncodeToString(sum[:])
	if err := runPrivateFileReplace(replacementRequest(root, &digest, "first"), &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	after := snapshotPrivateTestFileIdentity(t, file)
	// runPrivateFileReplace allocates its CREATE_NEW temporary while the old target
	// still exists. Their live IDs must differ; closing this observer cannot cause
	// the new temporary to reuse the old target's identity.
	if before == after {
		t.Fatal("same bytes skipped durable replacement")
	}
	if err := runWorkspaceStorage("private-file-inspect", file, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if err := runPrivateFileReplace(replacementRequest(root, &digest, "second"), &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(file)
	if err != nil || string(content) != "second" {
		t.Fatal("replacement not published")
	}
}

func TestPrivateReplacementRejectsPublicACLWithoutRepair(t *testing.T) {
	root := privateWorkspaceFixture(t)
	if err := runPrivateFileReplace(replacementRequest(root, nil, "first"), &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "auth.json")
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(file, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	if err := runWorkspaceStorage("private-file-inspect", file, &bytes.Buffer{}); err == nil {
		t.Fatal("public file accepted")
	}
	sum := sha256.Sum256([]byte("first"))
	digest := hex.EncodeToString(sum[:])
	if err := runPrivateFileReplace(replacementRequest(root, &digest, "second"), &bytes.Buffer{}); err == nil {
		t.Fatal("public file silently repaired")
	}
	content, err := os.ReadFile(file)
	if err != nil || string(content) != "first" {
		t.Fatal("rejected replacement mutated target")
	}
}
