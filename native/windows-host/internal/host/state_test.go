package host

import (
	"testing"
	"time"

	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
)

func TestStateSnapshotIsConsistent(t *testing.T) {
	now := time.Date(2026, 9, 9, 1, 2, 3, 0, time.UTC)
	store := newStateStore(now)
	store.set("running", "running", 42)
	snapshot := store.snapshot()
	if snapshot.Service != "running" || snapshot.Manager.State != "running" || snapshot.Manager.PID != 42 {
		t.Fatalf("unexpected state: %#v", snapshot)
	}
	if !snapshot.StartedAt.Equal(now) {
		t.Fatalf("unexpected start time: %s", snapshot.StartedAt)
	}
}

func TestControlStatusIsBoundToCurrentManagerGeneration(t *testing.T) {
	store := newStateStore(time.Now())
	store.set("running", "running", 42)
	control := protocol.ControlState{
		Manager: protocol.ControlManagerState{ID: "123e4567-e89b-42d3-a456-426614174000", Version: "1.2.12", PID: 42},
		Gateway: protocol.ControlGatewayState{Desired: "running", Actual: "stopped"},
	}
	if err := store.publish(control); err != nil {
		t.Fatal(err)
	}
	if store.snapshot().Control == nil {
		t.Fatal("published status missing")
	}
	store.set("stopping", "stopping", 42)
	if store.snapshot().Control != nil {
		t.Fatal("stale status survived manager transition")
	}
	store.set("running", "running", 43)
	if err := store.publish(control); err == nil {
		t.Fatal("old manager status attached to new generation")
	}
}
