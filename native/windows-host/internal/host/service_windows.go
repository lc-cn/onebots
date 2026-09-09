//go:build windows

package host

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sys/windows/svc"
)

type windowsService struct {
	config Config
}

func runService(config Config) error {
	isService, err := svc.IsWindowsService()
	if err != nil {
		return fmt.Errorf("detect Windows service context: %w", err)
	}
	if !isService {
		return errors.New("service-run must be launched by Windows SCM; use console-run only for acceptance testing")
	}
	if err := svc.Run(config.ServiceName, &windowsService{config: config}); err != nil {
		return fmt.Errorf("run Windows service dispatcher: %w", err)
	}
	return nil
}

func (service *windowsService) Execute(
	_ []string,
	requests <-chan svc.ChangeRequest,
	statuses chan<- svc.Status,
) (bool, uint32) {
	statuses <- svc.Status{State: svc.StartPending}
	runtime, err := startRuntime(service.config)
	if err != nil {
		return true, 1
	}
	statuses <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				statuses <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				if err := stopWithSCMProgress(runtime, service.config.StopTimeout, statuses); err != nil {
					return true, 3
				}
				statuses <- svc.Status{State: svc.Stopped}
				return false, 0
			}
		case <-runtime.process.done:
			_ = runtime.pipe.Close()
			runtime.state.set("failed", "exited", 0)
			_ = runtime.process.closeHandles()
			return true, 2
		}
	}
}

func stopWithSCMProgress(runtime *hostRuntime, timeout time.Duration, statuses chan<- svc.Status) error {
	waitHint := timeout + 5*time.Second
	if waitHint > time.Duration(^uint32(0))*time.Millisecond {
		waitHint = time.Duration(^uint32(0)) * time.Millisecond
	}
	checkpoint := uint32(1)
	statuses <- svc.Status{
		State: svc.StopPending, CheckPoint: checkpoint, WaitHint: uint32(waitHint / time.Millisecond),
	}
	done := make(chan error, 1)
	go func() { done <- runtime.stop(timeout) }()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return err
		case <-ticker.C:
			checkpoint++
			statuses <- svc.Status{
				State: svc.StopPending, CheckPoint: checkpoint, WaitHint: uint32(waitHint / time.Millisecond),
			}
		}
	}
}

type hostRuntime struct {
	process *managedProcess
	pipe    *statusPipe
	state   *stateStore
}

func startRuntime(config Config) (*hostRuntime, error) {
	state := newStateStore(time.Now())
	process, err := startManagedProcess(config)
	if err != nil {
		return nil, err
	}
	state.set("starting", "running", process.pid)
	pipeServer, err := startStatusPipe(config, state)
	if err != nil {
		_ = process.gracefulStop(config.StopTimeout)
		return nil, err
	}
	state.set("running", "running", process.pid)
	return &hostRuntime{process: process, pipe: pipeServer, state: state}, nil
}

func (runtime *hostRuntime) stop(timeout time.Duration) error {
	runtime.state.set("stopping", "stopping", runtime.process.pid)
	pipeErr := runtime.pipe.Close()
	processErr := runtime.process.gracefulStop(timeout)
	runtime.state.set("stopped", "stopped", 0)
	return errors.Join(pipeErr, processErr)
}

func runConsole(config Config) error {
	runtime, err := startRuntime(config)
	if err != nil {
		return err
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case <-signals:
		return runtime.stop(config.StopTimeout)
	case <-runtime.process.done:
		_ = runtime.pipe.Close()
		runtime.state.set("failed", "exited", 0)
		_ = runtime.process.closeHandles()
		return errors.New("manager exited unexpectedly")
	}
}
