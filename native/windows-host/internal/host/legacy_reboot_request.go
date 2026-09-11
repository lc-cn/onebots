package host

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"
)

const legacyRebootServiceName = "onebots-legacy-migration-receipt"

// Historical node-windows/WinSW service ID. Never supplied by a caller.
const legacySystemServiceName = "onebotsgateway.exe"

type legacySCMConfiguration struct {
	ServiceType      uint32   `json:"serviceType"`
	StartType        uint32   `json:"startType"`
	ErrorControl     uint32   `json:"errorControl"`
	BinaryPath       string   `json:"binaryPath"`
	LoadOrderGroup   string   `json:"loadOrderGroup"`
	TagID            uint32   `json:"tagId"`
	Dependencies     []string `json:"dependencies"`
	Account          string   `json:"account"`
	DisplayName      string   `json:"displayName"`
	Description      string   `json:"description"`
	SIDType          uint32   `json:"sidType"`
	DelayedAutoStart bool     `json:"delayedAutoStart"`
}

type legacySCMProcess struct {
	PID     uint32 `json:"pid"`
	Created string `json:"created"`
	Image   string `json:"image"`
}

type legacySCMInspection struct {
	SchemaVersion int    `json:"schemaVersion"`
	ServiceName   string `json:"serviceName"`
	Loaded        bool   `json:"loaded"`
	// Inspection never proves all descendants exited or that rollback is ready.
	RestorationReady bool                    `json:"restorationReady"`
	State            string                  `json:"state"`
	Configuration    *legacySCMConfiguration `json:"configuration"`
	Security         string                  `json:"security"`
	Process          *legacySCMProcess       `json:"process"`
}

// SCM cannot return account passwords. These built-in accounts are the only
// identities this migration may reconstruct without unavailable credentials.
func restorableLegacyAccount(account string) bool {
	switch strings.ToLower(account) {
	case "localsystem", `nt authority\localservice`, `nt authority\networkservice`:
		return true
	default:
		return false
	}
}

var (
	legacyRebootID     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	legacyRebootDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
	legacyWindowsPath  = regexp.MustCompile(`^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\)`)
	legacySecuritySDDL = regexp.MustCompile(`^O:[\s\S]+G:[\s\S]+D:[\s\S]+$`)
)

type legacyRebootRequest struct {
	SchemaVersion  int                 `json:"schemaVersion"`
	Operation      string              `json:"operation"`
	OperationID    string              `json:"operationId"`
	StateDirectory string              `json:"stateDirectory"`
	SnapshotDigest string              `json:"snapshotDigest"`
	Nonce          string              `json:"nonce"`
	Expected       legacySCMInspection `json:"expected"`
}

type legacyRebootResult struct {
	SchemaVersion    int    `json:"schemaVersion"`
	OperationID      string `json:"operationId"`
	Phase            string `json:"phase"`
	RestorationReady bool   `json:"restorationReady"`
}

func decodeLegacyRebootRequest(encoded string, allowed ...string) (legacyRebootRequest, error) {
	bytes, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(bytes) == 0 || len(bytes) > 128*1024 || !legacyJSONKeysUnique(bytes) {
		return legacyRebootRequest{}, errors.New("invalid legacy reboot request encoding")
	}
	var request legacyRebootRequest
	decoder := json.NewDecoder(strings.NewReader(string(bytes)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return legacyRebootRequest{}, errors.New("invalid legacy reboot request")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return legacyRebootRequest{}, errors.New("legacy reboot request must contain one document")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(bytes, &fields) != nil || len(fields) != 7 {
		return legacyRebootRequest{}, errors.New("legacy reboot request fields are not closed")
	}
	for _, name := range []string{"schemaVersion", "operation", "operationId", "stateDirectory", "snapshotDigest", "nonce", "expected"} {
		if _, ok := fields[name]; !ok {
			return legacyRebootRequest{}, errors.New("legacy reboot request fields are not closed")
		}
	}
	operationAllowed := false
	for _, value := range allowed {
		operationAllowed = operationAllowed || request.Operation == value
	}
	if request.SchemaVersion != 1 || !operationAllowed || !legacyRebootID.MatchString(request.OperationID) ||
		!legacyRebootDigest.MatchString(request.SnapshotDigest) || !legacyRebootDigest.MatchString(request.Nonce) ||
		!validLegacyWindowsPath(request.StateDirectory) ||
		!validLegacyRebootExpected(request.Expected) {
		return legacyRebootRequest{}, errors.New("invalid legacy reboot request contract")
	}
	return request, nil
}

func legacyJSONKeysUnique(input []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.UseNumber()
	var value func() bool
	value = func() bool {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return true
		}
		switch delimiter {
		case '{':
			keys := map[string]struct{}{}
			for decoder.More() {
				key, err := decoder.Token()
				name, valid := key.(string)
				if err != nil || !valid {
					return false
				}
				if _, duplicate := keys[name]; duplicate {
					return false
				}
				keys[name] = struct{}{}
				if !value() {
					return false
				}
			}
			end, err := decoder.Token()
			return err == nil && end == json.Delim('}')
		case '[':
			for decoder.More() {
				if !value() {
					return false
				}
			}
			end, err := decoder.Token()
			return err == nil && end == json.Delim(']')
		default:
			return false
		}
	}
	if !value() {
		return false
	}
	_, err := decoder.Token()
	return err == io.EOF
}

func validLegacyRebootExpected(value legacySCMInspection) bool {
	if value.SchemaVersion != 1 || value.ServiceName != legacySystemServiceName || !value.Loaded ||
		value.RestorationReady || value.Configuration == nil ||
		(value.State != "running" && value.State != "stopped") || !legacySecuritySDDL.MatchString(value.Security) || len(value.Security) > 65536 {
		return false
	}
	config := value.Configuration
	if config.ServiceType != 16 || (config.StartType != 2 && config.StartType != 3 && config.StartType != 4) ||
		config.ErrorControl > 3 || (config.SIDType != 0 && config.SIDType != 1 && config.SIDType != 3) ||
		config.BinaryPath == "" || len(config.BinaryPath) > 32768 || !validLegacyText(config.LoadOrderGroup, 32768, true) ||
		!validLegacyText(config.Account, 256, false) || !validLegacyText(config.DisplayName, 32768, false) ||
		!validLegacyText(config.Description, 32768, true) || strings.ContainsAny(config.BinaryPath+value.Security, "\x00\r\n") ||
		config.DisplayName != "onebots-gateway" || !restorableLegacyAccount(config.Account) ||
		(config.DelayedAutoStart && config.StartType != 2) ||
		(value.State == "running" && config.StartType == 4) || len(config.Dependencies) > 128 {
		return false
	}
	for _, dependency := range config.Dependencies {
		if !validLegacyText(dependency, 256, false) {
			return false
		}
	}
	if value.State == "stopped" {
		return value.Process == nil
	}
	if value.Process == nil || value.Process.PID == 0 || value.Process.Created == "" || !validLegacyWindowsPath(value.Process.Image) {
		return false
	}
	created, err := strconv.ParseUint(value.Process.Created, 10, 64)
	return err == nil && created > 0
}

func validLegacyText(value string, limit int, empty bool) bool {
	return (empty || value != "") && len(value) <= limit && !strings.ContainsAny(value, "\x00\r\n")
}

func validLegacyWindowsPath(value string) bool {
	if len(value) < 3 || len(value) > 32768 || !legacyWindowsPath.MatchString(value) || strings.ContainsAny(value, "\x00\r\n\"*?") {
		return false
	}
	rest := value
	if len(rest) >= 2 && rest[1] == ':' {
		rest = rest[2:]
	}
	if strings.Contains(rest, ":") || strings.Contains(rest, "/") {
		return false
	}
	for _, part := range strings.Split(rest, `\`) {
		if part == "." || part == ".." {
			return false
		}
	}
	return true
}
