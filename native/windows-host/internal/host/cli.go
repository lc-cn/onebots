package host

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"
)

type repeatedString []string

func (values *repeatedString) String() string { return fmt.Sprintf("%q", []string(*values)) }

func (values *repeatedString) Set(value string) error {
	*values = append(*values, value)
	return nil
}

func RunCLI(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		printUsage(stderr)
		return 2
	}
	switch args[0] {
	case "service-run", "console-run":
		config, err := parseRunConfig(args[0], args[1:], stderr)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		if args[0] == "service-run" {
			err = runService(config)
		} else {
			err = runConsole(config)
		}
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case "status":
		set := flag.NewFlagSet("status", flag.ContinueOnError)
		set.SetOutput(stderr)
		pipeName := set.String("pipe", defaultPipeName, "local host status pipe")
		timeout := set.Duration("timeout", 5*time.Second, "request timeout")
		if err := set.Parse(args[1:]); err != nil {
			return 2
		}
		if set.NArg() != 0 {
			fmt.Fprintln(stderr, "status does not accept positional arguments")
			return 2
		}
		if err := queryStatus(*pipeName, *timeout, stdout); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	default:
		printUsage(stderr)
		return 2
	}
}

func parseRunConfig(command string, args []string, output io.Writer) (Config, error) {
	set := flag.NewFlagSet(command, flag.ContinueOnError)
	set.SetOutput(output)
	var managerArgs repeatedString
	config := Config{}
	set.StringVar(&config.ServiceName, "service-name", "onebots-manager", "Windows SCM service name")
	set.StringVar(&config.ManagerPath, "manager", "", "absolute manager executable path")
	set.StringVar(&config.WorkingDir, "working-dir", "", "manager working directory")
	set.StringVar(&config.PipeName, "pipe", defaultPipeName, "local host status pipe")
	set.StringVar(&config.ControlSID, "control-sid", "", "installer-authorized Windows SID")
	set.DurationVar(&config.StopTimeout, "stop-timeout", defaultStopTimeout, "graceful manager stop deadline")
	set.Var(&managerArgs, "manager-arg", "manager argument; repeat for each argument")
	if err := set.Parse(args); err != nil {
		return Config{}, err
	}
	if set.NArg() != 0 {
		return Config{}, errors.New("unexpected positional arguments")
	}
	config.ManagerArgs = managerArgs
	config = withDefaults(config)
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func printUsage(output io.Writer) {
	fmt.Fprintln(output, "usage: onebots-windows-host <service-run|console-run|status> [options]")
}

func Main() {
	os.Exit(RunCLI(os.Args[1:], os.Stdout, os.Stderr))
}
