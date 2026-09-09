//go:build windows

package host

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procAttachConsole         = kernel32.NewProc("AttachConsole")
	procFreeConsole           = kernel32.NewProc("FreeConsole")
	procSetConsoleCtrlHandler = kernel32.NewProc("SetConsoleCtrlHandler")
)

type managedProcess struct {
	job     windows.Handle
	process windows.Handle
	pid     uint32
	done    chan struct{}
	once    sync.Once
	waitErr error
}

func startManagedProcess(config Config) (*managedProcess, error) {
	if !filepath.IsAbs(config.ManagerPath) {
		return nil, errors.New("manager executable path must be absolute")
	}
	if config.WorkingDir != "" && !filepath.IsAbs(config.WorkingDir) {
		return nil, errors.New("manager working directory must be absolute")
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("create manager job object: %w", err)
	}
	cleanupJob := true
	defer func() {
		if cleanupJob {
			_ = windows.CloseHandle(job)
		}
	}()

	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		uint32(unsafe.Sizeof(limits)),
	); err != nil {
		return nil, fmt.Errorf("set KILL_ON_JOB_CLOSE: %w", err)
	}

	application, err := windows.UTF16PtrFromString(config.ManagerPath)
	if err != nil {
		return nil, fmt.Errorf("encode manager path: %w", err)
	}
	commandLine, err := windows.UTF16PtrFromString(
		windows.ComposeCommandLine(append([]string{config.ManagerPath}, config.ManagerArgs...)),
	)
	if err != nil {
		return nil, fmt.Errorf("encode manager command line: %w", err)
	}
	var workingDirectory *uint16
	if config.WorkingDir != "" {
		workingDirectory, err = windows.UTF16PtrFromString(config.WorkingDir)
		if err != nil {
			return nil, fmt.Errorf("encode manager working directory: %w", err)
		}
	}
	startup := windows.StartupInfo{
		Cb:         uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Flags:      windows.STARTF_USESHOWWINDOW,
		ShowWindow: windows.SW_HIDE,
	}
	var info windows.ProcessInformation
	flags := uint32(windows.CREATE_SUSPENDED | windows.CREATE_NEW_CONSOLE | windows.CREATE_UNICODE_ENVIRONMENT)
	if err := windows.CreateProcess(
		application,
		commandLine,
		nil,
		nil,
		false,
		flags,
		nil,
		workingDirectory,
		&startup,
		&info,
	); err != nil {
		return nil, fmt.Errorf("create suspended manager: %w", err)
	}
	defer windows.CloseHandle(info.Thread)
	assigned := false
	defer func() {
		if !assigned {
			_ = windows.TerminateProcess(info.Process, 1)
			_ = windows.CloseHandle(info.Process)
		}
	}()
	if err := windows.AssignProcessToJobObject(job, info.Process); err != nil {
		return nil, fmt.Errorf("assign suspended manager to job: %w", err)
	}
	assigned = true
	if _, err := windows.ResumeThread(info.Thread); err != nil {
		_ = windows.TerminateJobObject(job, 1)
		_ = windows.CloseHandle(info.Process)
		return nil, fmt.Errorf("resume assigned manager: %w", err)
	}

	process := &managedProcess{
		job: job, process: info.Process, pid: info.ProcessId, done: make(chan struct{}),
	}
	cleanupJob = false
	go process.wait()
	return process, nil
}

func (process *managedProcess) wait() {
	_, process.waitErr = windows.WaitForSingleObject(process.process, windows.INFINITE)
	close(process.done)
}

func (process *managedProcess) gracefulStop(timeout time.Duration) error {
	select {
	case <-process.done:
		return process.closeHandles()
	default:
	}

	signalErr := sendGracefulInterrupt(process.pid)
	if signalErr == nil {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-process.done:
			return process.closeHandles()
		case <-timer.C:
		}
	}

	// Closing a KILL_ON_JOB_CLOSE job is the bounded fallback and terminates the
	// manager's complete descendant tree. It is deliberately done only after the
	// graceful CTRL_C deadline expires.
	closeErr := process.closeJob()
	killTimer := time.NewTimer(5 * time.Second)
	defer killTimer.Stop()
	select {
	case <-process.done:
		return errors.Join(closeErr, process.closeHandles())
	case <-killTimer.C:
		return errors.Join(closeErr, errors.New("manager did not exit after job closure"))
	}
}

func (process *managedProcess) closeJob() error {
	var err error
	process.once.Do(func() { err = windows.CloseHandle(process.job) })
	return err
}

func (process *managedProcess) closeHandles() error {
	return errors.Join(process.closeJob(), windows.CloseHandle(process.process), process.waitErr)
}

func sendGracefulInterrupt(pid uint32) error {
	// The child owns a fresh hidden console. An interactive acceptance host may
	// already have another console, while an SCM service normally has none.
	// Detach first so both modes follow the same control-event path.
	procFreeConsole.Call()
	if result, _, callErr := procAttachConsole.Call(uintptr(pid)); result == 0 {
		return fmt.Errorf("attach manager console: %w", callErr)
	}
	// A nil handler makes the host ignore control events while it is temporarily
	// attached to the manager console.
	if result, _, callErr := procSetConsoleCtrlHandler.Call(0, 1); result == 0 {
		procFreeConsole.Call()
		return fmt.Errorf("ignore host console events: %w", callErr)
	}
	// The child has its own console, so CTRL_C reaches only this job's console
	// processes. Node translates it to SIGINT, which is the manager's existing
	// graceful shutdown contract. CREATE_NEW_PROCESS_GROUP is intentionally not
	// used because Windows disables CTRL_C delivery to such groups.
	err := windows.GenerateConsoleCtrlEvent(windows.CTRL_C_EVENT, 0)
	procSetConsoleCtrlHandler.Call(0, 0)
	procFreeConsole.Call()
	if err != nil {
		return fmt.Errorf("send manager CTRL_C: %w", err)
	}
	return nil
}
