package protocol

import (
	"bufio"
	"errors"
	"fmt"
	"io"
)

func ReadSingleMessage(input io.Reader) ([]byte, error) {
	reader := bufio.NewReaderSize(io.LimitReader(input, MaxMessageBytes+2), MaxMessageBytes+2)
	framed, err := reader.ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("read newline-terminated JSON document: %w", err)
	}
	payload := framed[:len(framed)-1]
	if len(payload) > MaxMessageBytes {
		return nil, fmt.Errorf("JSON document exceeds %d bytes", MaxMessageBytes)
	}
	trailing := make([]byte, 1)
	if count, trailingErr := reader.Read(trailing); count != 0 || !errors.Is(trailingErr, io.EOF) {
		return nil, errors.New("expected EOF after one JSON document")
	}
	return payload, nil
}
