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
}

func newStateStore(now time.Time) *stateStore {
	return &stateStore{
		startedAt: now.UTC(),
		service:   "starting",
		manager:   protocol.ManagerState{State: "stopped"},
	}
}

func (store *stateStore) set(service, manager string, pid uint32) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.service = service
	store.manager = protocol.ManagerState{State: manager, PID: pid}
	if manager != "running" || (store.control != nil && store.control.Manager.PID != pid) {
		store.control = nil
	}
}

func (store *stateStore) publish(control protocol.ControlState) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.manager.State != "running" || store.manager.PID == 0 || control.Manager.PID != store.manager.PID {
		return errors.New("published manager pid does not match the running child")
	}
	copy := control
	store.control = &copy
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
	if store.control != nil {
		copy := *store.control
		state.Control = &copy
	}
	return state
}
