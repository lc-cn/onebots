package host

import (
	"sync"
	"time"

	"github.com/lc-cn/onebots/native/windows-host/internal/protocol"
)

type stateStore struct {
	mu        sync.RWMutex
	startedAt time.Time
	service   string
	manager   protocol.ManagerState
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
}

func (store *stateStore) snapshot() protocol.HostState {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return protocol.HostState{
		Service:   store.service,
		Manager:   store.manager,
		StartedAt: store.startedAt,
	}
}
