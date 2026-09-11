//go:build windows

package host

import (
	"encoding/json"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

type legacyReaderFixture struct {
	config mgr.Config
	status svc.Status
	reads  int
	change bool
	mutate func(*mgr.Config)
}

func (f *legacyReaderFixture) Config() (mgr.Config, error) {
	f.reads++
	value := f.config
	if f.change && f.reads > 1 {
		value.BinaryPathName = `C:\foreign.exe`
	}
	if f.mutate != nil && f.reads > 1 {
		f.mutate(&value)
	}
	return value, nil
}
func (f *legacyReaderFixture) Query() (svc.Status, error) { return f.status, nil }
func legacyFixture() *legacyReaderFixture {
	return &legacyReaderFixture{config: mgr.Config{ServiceType: windows.SERVICE_WIN32_OWN_PROCESS,
		BinaryPathName: `"C:\old\daemon\onebotsgateway.exe"`, ServiceStartName: "LocalSystem", Password: "must-never-export"},
		status: svc.Status{State: svc.Running, ProcessId: 123}}
}
func legacySecurity() (string, error) { return "O:SYG:SYD:(A;;GA;;;SY)", nil }
func legacyProcess(pid uint32) (*legacySCMProcess, error) {
	return &legacySCMProcess{PID: pid, Created: "123456789", Image: `C:\old\daemon\onebotsgateway.exe`}, nil
}
func TestLegacyInspectionStableIdentityWithoutRollbackClaim(t *testing.T) {
	value, err := stableLegacySCMInspection(legacyFixture(), legacySecurity, legacyProcess)
	if err != nil {
		t.Fatal(err)
	}
	if value.ServiceName != "onebotsgateway.exe" || value.RestorationReady || value.Process.PID != 123 {
		t.Fatal(value)
	}
	bytes, err := json.Marshal(value)
	if err != nil || strings.Contains(string(bytes), "must-never-export") || strings.Contains(string(bytes), "Password") {
		t.Fatal("password exposed")
	}
}
func TestLegacyInspectionRejectsChangedConfigOrProcessIdentity(t *testing.T) {
	f := legacyFixture()
	f.change = true
	if _, err := stableLegacySCMInspection(f, legacySecurity, legacyProcess); err == nil {
		t.Fatal("accepted drift")
	}
	count := 0
	if _, err := stableLegacySCMInspection(legacyFixture(), legacySecurity, func(pid uint32) (*legacySCMProcess, error) {
		count++
		p, _ := legacyProcess(pid)
		if count > 1 {
			p.Created = "new-process"
		}
		return p, nil
	}); err == nil {
		t.Fatal("accepted PID reuse")
	}
}
func TestLegacyInspectionRejectsTransientOrUnownedStates(t *testing.T) {
	for _, status := range []svc.Status{{State: svc.StartPending}, {State: svc.Running}, {State: svc.Stopped, ProcessId: 123}} {
		f := legacyFixture()
		f.status = status
		if _, err := stableLegacySCMInspection(f, legacySecurity, legacyProcess); err == nil {
			t.Fatal("accepted ambiguous state")
		}
	}
	f := legacyFixture()
	f.status = svc.Status{State: svc.Stopped}
	value, err := stableLegacySCMInspection(f, legacySecurity, legacyProcess)
	if err != nil || value.Process != nil || value.RestorationReady {
		t.Fatal("stopped is not descendant exit evidence")
	}
}

func TestLegacySnapshotRejectsAccountsRequiringUnrecoverableCredentials(t *testing.T) {
	for _, account := range []string{"", `DOMAIN\user`, `DOMAIN\gmsa$`, `NT SERVICE\onebotsgateway.exe`, ".\\user", "LocalSystem "} {
		f := legacyFixture()
		f.config.ServiceStartName = account
		if _, err := stableLegacySCMInspection(f, legacySecurity, legacyProcess); err == nil {
			t.Fatalf("accepted account %q", account)
		}
	}
	for _, account := range []string{"LocalSystem", `NT AUTHORITY\LocalService`, `nt authority\networkservice`} {
		f := legacyFixture()
		f.config.ServiceStartName = account
		value, err := stableLegacySCMInspection(f, legacySecurity, legacyProcess)
		if err != nil || value.Configuration.Account != account {
			t.Fatalf("lost original account %q", account)
		}
	}
}

func TestLegacySnapshotRejectsSecurityAndConfigurationDrift(t *testing.T) {
	calls := 0
	if _, err := stableLegacySCMInspection(legacyFixture(), func() (string, error) {
		calls++
		if calls > 1 {
			return "O:SYG:SYD:(A;;GA;;;BA)", nil
		}
		return legacySecurity()
	}, legacyProcess); err == nil {
		t.Fatal("accepted changed DACL")
	}
}

func TestLegacySnapshotBindsEveryReadableConfigurationField(t *testing.T) {
	changes := map[string]func(*mgr.Config){
		"startType":        func(c *mgr.Config) { c.StartType++ },
		"errorControl":     func(c *mgr.Config) { c.ErrorControl++ },
		"binaryPath":       func(c *mgr.Config) { c.BinaryPathName += " changed" },
		"loadOrderGroup":   func(c *mgr.Config) { c.LoadOrderGroup = "changed" },
		"tagId":            func(c *mgr.Config) { c.TagId++ },
		"dependencies":     func(c *mgr.Config) { c.Dependencies = []string{"changed"} },
		"account":          func(c *mgr.Config) { c.ServiceStartName = `NT AUTHORITY\LocalService` },
		"displayName":      func(c *mgr.Config) { c.DisplayName = "changed" },
		"description":      func(c *mgr.Config) { c.Description = "changed" },
		"sidType":          func(c *mgr.Config) { c.SidType++ },
		"delayedAutoStart": func(c *mgr.Config) { c.DelayedAutoStart = !c.DelayedAutoStart },
	}
	for name, mutate := range changes {
		t.Run(name, func(t *testing.T) {
			f := legacyFixture()
			f.mutate = mutate
			if _, err := stableLegacySCMInspection(f, legacySecurity, legacyProcess); err == nil {
				t.Fatal("accepted configuration drift")
			}
		})
	}
}
