package host

import (
	"errors"
	"sync"
	"time"

	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
)

type stateStore struct {
	mu        sync.RWMutex
	startedAt time.Time
	service   string
	manager   protocol.ManagerState
	control   *protocol.ControlState
	revision  uint64
	now       func() time.Time
	published time.Time
}

const controlFreshness = 30 * time.Second

func newStateStore(now time.Time) *stateStore {
	return &stateStore{
		startedAt: now.UTC(),
		service:   "starting",
		manager:   protocol.ManagerState{State: "stopped"},
		now:       time.Now,
	}
}

func (store *stateStore) set(service, manager string, pid uint32) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.service = service
	previous := store.manager
	store.manager = protocol.ManagerState{State: manager, PID: pid}
	if manager != "running" || previous.PID != pid || (store.control != nil && store.control.Manager.PID != pid) {
		store.control = nil
		store.revision = 0
		store.published = time.Time{}
	}
}

func (store *stateStore) invalidate(manager protocol.ControlManagerState, revision uint64) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.manager.State != "running" || store.manager.PID == 0 || manager.PID != store.manager.PID {
		return errors.New("invalidating manager pid does not match the running child")
	}
	if store.control != nil && (store.control.Manager.ID != manager.ID || store.control.Manager.Version != manager.Version) {
		return errors.New("invalidating manager identity does not match current control state")
	}
	if revision <= store.revision {
		return errors.New("invalidation revision is not newer")
	}
	store.control = nil
	store.revision = revision
	store.published = time.Time{}
	return nil
}

func (store *stateStore) publish(control protocol.ControlState) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.manager.State != "running" || store.manager.PID == 0 || control.Manager.PID != store.manager.PID {
		return errors.New("published manager pid does not match the running child")
	}
	if control.Revision <= store.revision {
		return errors.New("published control revision is not newer")
	}
	if store.control != nil && (store.control.Manager.ID != control.Manager.ID || store.control.Manager.Version != control.Manager.Version) {
		return errors.New("published manager identity changed without a child generation change")
	}
	now := store.now()
	copy := control
	copy.PublishedAt = now.UTC()
	store.control = &copy
	store.revision = copy.Revision
	store.published = now
	return nil
}

func (store *stateStore) snapshot() protocol.HostState {
	store.mu.RLock()
	defer store.mu.RUnlock()
	state := protocol.HostState{
		Service:   store.service,
		Manager:   store.manager,
		StartedAt: store.startedAt,
	}
	age := store.now().Sub(store.published)
	if store.control != nil && age >= 0 && age <= controlFreshness {
		copy := *store.control
		state.Control = &copy
	}
	return state
}
