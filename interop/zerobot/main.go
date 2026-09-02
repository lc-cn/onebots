package main

import (
	"encoding/json"
	"os"

	zero "github.com/wdvxdr1123/ZeroBot"
	"github.com/wdvxdr1123/ZeroBot/driver"
)

type evidence struct {
	Framework        string      `json:"framework"`
	FrameworkVersion string      `json:"frameworkVersion"`
	Event            *zero.Event `json:"event"`
	Login            any         `json:"login"`
	MessageID        string      `json:"messageId"`
}

func main() {
	endpoint := required("ONEBOTS_INTEROP_ENDPOINT")
	token := required("ONEBOTS_INTEROP_TOKEN")
	evidencePath := required("ONEBOTS_INTEROP_EVIDENCE")

	zero.OnMessage().Handle(func(ctx *zero.Ctx) {
		messageID := ctx.Send("onebots-zerobot-interop-reply")
		payload, error := json.Marshal(evidence{
			Framework:        "zerobot",
			FrameworkVersion: "1.8.2",
			Event:            ctx.Event,
			Login:            ctx.GetLoginInfo().Value(),
			MessageID:        messageID.String(),
		})
		if error != nil {
			panic(error)
		}
		if error = os.WriteFile(evidencePath, payload, 0o600); error != nil {
			panic(error)
		}
	})

	zero.RunAndBlock(&zero.Config{
		NickName:   []string{"onebots"},
		SuperUsers: []int64{10001},
		RingLen:    16,
		Driver:     []zero.Driver{driver.NewWebSocketClient(endpoint, token)},
	}, nil)
}

func required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		panic(name + " is required")
	}
	return value
}
