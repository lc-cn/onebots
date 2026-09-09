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
		Revision: 1,
		Manager:  protocol.ControlManagerState{ID: "123e4567-e89b-42d3-a456-426614174000", Version: "1.2.12", PID: 42},
		Gateway:  protocol.ControlGatewayState{Desired: "running", Actual: "stopped"},
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

func TestControlInvalidationRevisionAndFreshnessFailClosed(t *testing.T) {
	now := time.Date(2026, 9, 10, 1, 2, 3, 0, time.UTC)
	store := newStateStore(now)
	store.now = func() time.Time { return now }
	store.set("running", "running", 42)
	manager := protocol.ControlManagerState{ID: "123e4567-e89b-42d3-a456-426614174000", Version: "1.2.12", PID: 42}
	control := protocol.ControlState{
		Revision: 1,
		Manager:  manager,
		Gateway:  protocol.ControlGatewayState{Desired: "running", Actual: "stopped"},
	}
	if err := store.publish(control); err != nil {
		t.Fatal(err)
	}
	if got := store.snapshot().Control; got == nil || got.Revision != 1 || !got.PublishedAt.Equal(now) {
		t.Fatalf("published state was not host-stamped: %#v", got)
	}
	if err := store.invalidate(manager, 2); err != nil {
		t.Fatal(err)
	}
	if store.snapshot().Control != nil {
		t.Fatal("invalidated state remained readable")
	}
	control.Revision = 2
	if err := store.publish(control); err == nil {
		t.Fatal("same revision was accepted after invalidation")
	}
	control.Revision = 3
	if err := store.publish(control); err != nil {
		t.Fatal(err)
	}
	now = now.Add(controlFreshness + time.Second)
	if store.snapshot().Control != nil {
		t.Fatal("expired state remained readable")
	}
}
