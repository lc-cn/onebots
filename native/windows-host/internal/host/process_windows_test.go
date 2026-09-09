//go:build windows

package host

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

const helperEnvironment = "ONEBOTS_WINDOWS_HOST_TEST_HELPER"

func TestManagedProcessGracefulConsoleStop(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	ready := filepath.Join(directory, "ready")
	stoppedMarker := filepath.Join(directory, "stopped")
	t.Setenv(helperEnvironment, strings.Join([]string{"graceful", ready, stoppedMarker}, "|"))
	process, err := startManagedProcess(withDefaults(Config{
		ManagerPath: executable,
		ManagerArgs: []string{"-test.run=^TestWindowsProcessHelper$"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	processStopped := false
	t.Cleanup(func() {
		if !processStopped {
			_ = process.gracefulStop(0)
		}
	})
	waitForFile(t, ready, 5*time.Second)
	if err := process.gracefulStop(5 * time.Second); err != nil {
		t.Fatal(err)
	}
	processStopped = true
	if _, err := os.Stat(stoppedMarker); err != nil {
		t.Fatalf("manager did not record graceful CTRL_C handling: %v", err)
	}
}

func TestManagedProcessJobClosureKillsGrandchild(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	ready := filepath.Join(directory, "manager.ready")
	grandchildPIDFile := filepath.Join(directory, "grandchild.pid")
	grandchildReady := filepath.Join(directory, "grandchild.ready")
	t.Setenv(helperEnvironment, strings.Join([]string{
		"stubborn-manager", ready, grandchildPIDFile, grandchildReady,
	}, "|"))
	process, err := startManagedProcess(withDefaults(Config{
		ManagerPath: executable,
		ManagerArgs: []string{"-test.run=^TestWindowsProcessHelper$"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	processStopped := false
	t.Cleanup(func() {
		if !processStopped {
			_ = process.gracefulStop(0)
		}
	})
	waitForFile(t, ready, 5*time.Second)
	waitForFile(t, grandchildReady, 5*time.Second)
	pidBytes, err := os.ReadFile(grandchildPIDFile)
	if err != nil {
		t.Fatal(err)
	}
	grandchildPID, err := strconv.ParseUint(strings.TrimSpace(string(pidBytes)), 10, 32)
	if err != nil {
		t.Fatal(err)
	}
	managerHandle := openProcessForExitTest(t, process.pid)
	defer windows.CloseHandle(managerHandle)
	grandchildHandle := openProcessForExitTest(t, uint32(grandchildPID))
	defer windows.CloseHandle(grandchildHandle)

	if err := process.gracefulStop(250 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
	processStopped = true
	assertProcessExited(t, managerHandle, "manager")
	assertProcessExited(t, grandchildHandle, "grandchild")
}

func TestWindowsProcessHelper(t *testing.T) {
	parts := strings.Split(os.Getenv(helperEnvironment), "|")
	if len(parts) == 0 || parts[0] == "" {
		return
	}
	switch parts[0] {
	case "graceful":
		if len(parts) != 3 {
			os.Exit(91)
		}
		interrupt := make(chan os.Signal, 1)
		signal.Notify(interrupt, os.Interrupt)
		if err := os.WriteFile(parts[1], []byte("ready"), 0o600); err != nil {
			os.Exit(92)
		}
		<-interrupt
		if err := os.WriteFile(parts[2], []byte("stopped"), 0o600); err != nil {
			os.Exit(93)
		}
	case "stubborn-manager":
		if len(parts) != 4 {
			os.Exit(94)
		}
		executable, err := os.Executable()
		if err != nil {
			os.Exit(95)
		}
		child := exec.Command(executable, "-test.run=^TestWindowsProcessHelper$")
		child.Env = replaceEnvironment(os.Environ(), helperEnvironment, "grandchild|"+parts[3])
		if err := child.Start(); err != nil {
			os.Exit(96)
		}
		if err := os.WriteFile(parts[2], []byte(strconv.Itoa(child.Process.Pid)), 0o600); err != nil {
			os.Exit(97)
		}
		if err := os.WriteFile(parts[1], []byte("ready"), 0o600); err != nil {
			os.Exit(98)
		}
		ignored := make(chan os.Signal, 1)
		signal.Notify(ignored, os.Interrupt)
		select {}
	case "grandchild":
		if len(parts) != 2 {
			os.Exit(99)
		}
		if err := os.WriteFile(parts[1], []byte("ready"), 0o600); err != nil {
			os.Exit(100)
		}
		select {}
	default:
		os.Exit(101)
	}
}

func replaceEnvironment(environment []string, key, value string) []string {
	prefix := key + "="
	result := make([]string, 0, len(environment)+1)
	for _, entry := range environment {
		if !strings.HasPrefix(strings.ToUpper(entry), strings.ToUpper(prefix)) {
			result = append(result, entry)
		}
	}
	return append(result, prefix+value)
}

func waitForFile(t *testing.T, path string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", path)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func openProcessForExitTest(t *testing.T, pid uint32) windows.Handle {
	t.Helper()
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	if err != nil {
		t.Fatalf("open process %d: %v", pid, err)
	}
	return handle
}

func assertProcessExited(t *testing.T, handle windows.Handle, label string) {
	t.Helper()
	result, err := windows.WaitForSingleObject(handle, 5_000)
	if err != nil {
		t.Fatalf("wait for %s: %v", label, err)
	}
	if result != windows.WAIT_OBJECT_0 {
		t.Fatalf("%s remains alive after job closure: wait result 0x%x", label, result)
	}
}

func Example_replaceEnvironment() {
	fmt.Println(replaceEnvironment([]string{"A=1", "B=2"}, "a", "3"))
	// Output: [B=2 a=3]
}
