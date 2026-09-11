//go:build !windows

package host

import (
	"errors"
	"io"
	"time"
)

var errWindowsOnly = errors.New("onebots-windows-host is only supported on Windows")

func runService(Config) error { return errWindowsOnly }

func runConsole(Config) error { return errWindowsOnly }

func queryStatus(string, time.Duration, io.Writer) error { return errWindowsOnly }
func exchangeControlRequest(string, time.Duration, io.Reader, io.Writer) error {
	return errWindowsOnly
}
func runSCMControl(string, io.Writer) error          { return errWindowsOnly }
func runLegacySCMInspect(io.Writer) error            { return errWindowsOnly }
func runLegacyRebootControl(string, io.Writer) error { return errWindowsOnly }
func runLegacyRebootReceipt(string) error            { return errWindowsOnly }
func runIdentity(io.Writer) error                    { return errWindowsOnly }
