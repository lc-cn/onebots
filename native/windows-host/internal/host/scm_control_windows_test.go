//go:build windows

package host

import (
	"testing"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

type fakeSCMService struct {
	config  mgr.Config
	status  svc.Status
	drift   bool
	queries int
	actions []string
}

func (f *fakeSCMService) Config() (mgr.Config, error) { return f.config, nil }
func (f *fakeSCMService) Query() (svc.Status, error) {
	f.queries++
	state := f.status
	if f.drift && f.queries == 2 {
		state.ProcessId = 99
	}
	return state, nil
}
func (f *fakeSCMService) UpdateConfig(config mgr.Config) error {
	f.actions = append(f.actions, "configure")
	f.config = config
	return nil
}
func (f *fakeSCMService) Start(...string) error {
	f.actions = append(f.actions, "start")
	return nil
}
func (f *fakeSCMService) Control(svc.Cmd) (svc.Status, error) {
	f.actions = append(f.actions, "stop")
	return f.status, nil
}
func (f *fakeSCMService) Delete() error {
	f.actions = append(f.actions, "delete")
	return nil
}
func (f *fakeSCMService) Close() error { return nil }

func TestSCMControlRejectsRaceBeforeEveryMutation(t *testing.T) {
	for _, operation := range []string{"configure", "start", "quiesce", "delete"} {
		t.Run(operation, func(t *testing.T) {
			service := &fakeSCMService{
				config: mgr.Config{BinaryPathName: "old", StartType: mgr.StartManual},
				status: svc.Status{State: svc.Stopped},
				drift:  true,
			}
			request := scmControlRequest{Operation: operation, ExpectedLoaded: true, ExpectedPath: "old"}
			if operation == "configure" {
				request.TargetPath = "new"
			}
			if err := applySCMControl(service, request); err == nil {
				t.Fatal("expected race rejection")
			}
			if len(service.actions) != 0 {
				t.Fatalf("race dispatched %v", service.actions)
			}
		})
	}
}

func TestSCMControlUsesOneVerifiedHandleForAction(t *testing.T) {
	service := &fakeSCMService{
		config: mgr.Config{BinaryPathName: "old", StartType: mgr.StartManual},
		status: svc.Status{State: svc.Stopped},
	}
	if err := applySCMControl(service, scmControlRequest{
		Operation: "configure", ExpectedLoaded: true, ExpectedPath: "old", TargetPath: "new", Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if len(service.actions) != 1 || service.actions[0] != "configure" || service.config.BinaryPathName != "new" {
		t.Fatalf("unexpected action: %#v %#v", service.actions, service.config)
	}
}
