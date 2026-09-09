package host

import (
	"testing"
	"time"
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
