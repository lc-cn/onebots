//go:build windows

package host

import (
	"testing"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

type fakeSCMService struct {
	config        mgr.Config
	status        svc.Status
	drift         bool
	driftConfig   bool
	configQueries int
	postUpdate    func(*mgr.Config)
	queries       int
	actions       []string
}

func testManagedSCMConfig(path string) mgr.Config {
	return mgr.Config{
		ServiceType: windows.SERVICE_WIN32_OWN_PROCESS, StartType: mgr.StartManual,
		ErrorControl: windows.SERVICE_ERROR_NORMAL, BinaryPathName: path,
		Dependencies: []string{}, ServiceStartName: "LocalSystem",
		DisplayName: managedServiceDisplayName, SidType: windows.SERVICE_SID_TYPE_NONE,
	}
}

func (f *fakeSCMService) Config() (mgr.Config, error) {
	f.configQueries++
	config := f.config
	if f.driftConfig && f.configQueries == 2 {
		config.ServiceStartName = "drifted-account"
	}
	return config, nil
}
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
	if f.postUpdate != nil {
		f.postUpdate(&f.config)
	}
	return nil
}

func TestSCMControlRejectsConfigurationRaceBeforeMutation(t *testing.T) {
	service := &fakeSCMService{
		config: testManagedSCMConfig("old"), status: svc.Status{State: svc.Stopped},
		driftConfig: true,
	}
	err := applySCMControl(service, scmControlRequest{
		Operation: "configure", ExpectedLoaded: true, ExpectedPath: "old",
		ExpectedStartMode: "manual", TargetPath: "new", Enabled: true,
	})
	if err == nil || len(service.actions) != 0 {
		t.Fatalf("configuration race was accepted: err=%v actions=%v", err, service.actions)
	}
}

func TestSCMControlRejectsConfigurationDriftAfterMutation(t *testing.T) {
	service := &fakeSCMService{
		config: testManagedSCMConfig("old"), status: svc.Status{State: svc.Stopped},
		postUpdate: func(config *mgr.Config) { config.Dependencies = []string{"Tcpip"} },
	}
	request := scmControlRequest{
		Operation: "configure", ExpectedLoaded: true, ExpectedPath: "old",
		ExpectedStartMode: "manual", TargetPath: "new", Enabled: true,
	}
	if err := applySCMControl(service, request); err != nil {
		t.Fatal(err)
	}
	if _, err := stableSCMState(service, request); err == nil {
		t.Fatal("post-action configuration drift was accepted")
	}
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
				config: testManagedSCMConfig("old"),
				status: svc.Status{State: svc.Stopped},
				drift:  true,
			}
			request := scmControlRequest{Operation: operation, ExpectedLoaded: true, ExpectedPath: "old", ExpectedStartMode: "manual"}
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
		config: testManagedSCMConfig("old"),
		status: svc.Status{State: svc.Stopped},
	}
	if err := applySCMControl(service, scmControlRequest{
		Operation: "configure", ExpectedLoaded: true, ExpectedPath: "old", ExpectedStartMode: "manual", TargetPath: "new", Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if len(service.actions) != 1 || service.actions[0] != "configure" || service.config.BinaryPathName != "new" {
		t.Fatalf("unexpected action: %#v %#v", service.actions, service.config)
	}
}

func TestSCMControlRejectsManagedConfigurationDriftBeforeMutation(t *testing.T) {
	mutations := map[string]func(*mgr.Config){
		"account":       func(c *mgr.Config) { c.ServiceStartName = `.\\LocalSystem` },
		"service-type":  func(c *mgr.Config) { c.ServiceType = windows.SERVICE_WIN32_SHARE_PROCESS },
		"error-control": func(c *mgr.Config) { c.ErrorControl = windows.SERVICE_ERROR_IGNORE },
		"dependencies":  func(c *mgr.Config) { c.Dependencies = []string{"Tcpip"} },
		"load-group":    func(c *mgr.Config) { c.LoadOrderGroup = "network" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			config := testManagedSCMConfig("old")
			mutate(&config)
			service := &fakeSCMService{config: config, status: svc.Status{State: svc.Stopped}}
			err := applySCMControl(service, scmControlRequest{
				Operation: "configure", ExpectedLoaded: true, ExpectedPath: "old", ExpectedStartMode: "manual",
				TargetPath: "new", Enabled: true,
			})
			if err == nil || len(service.actions) != 0 {
				t.Fatalf("drift was accepted: err=%v actions=%v", err, service.actions)
			}
		})
	}
}
