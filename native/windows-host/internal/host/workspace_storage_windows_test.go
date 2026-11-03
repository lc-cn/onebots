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
	before, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
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
	sum := sha256.Sum256([]byte("first"))
	digest := hex.EncodeToString(sum[:])
	if err := runPrivateFileReplace(replacementRequest(root, &digest, "first"), &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(before, after) {
		t.Fatal("same bytes skipped durable replacement")
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
