//go:build windows

package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"golang.org/x/sys/windows"
)

type processIdentity struct {
	Version  int    `json:"version"`
	SID      string `json:"sid"`
	Elevated bool   `json:"elevated"`
}

func runIdentity(output io.Writer) error {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return fmt.Errorf("open current process token: %w", err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return fmt.Errorf("read current process token user: %w", err)
	}
	if user == nil || user.User.Sid == nil {
		return errors.New("read current process token user: missing SID")
	}
	return json.NewEncoder(output).Encode(processIdentity{
		Version:  1,
		SID:      user.User.Sid.String(),
		Elevated: token.IsElevated(),
	})
}
