//go:build !windows

package main

import "errors"

func folderPickerAvailable() bool { return false }
func pickFolder(_, _ string) (string, error) {
	return "", errors.New("selettore grafico disponibile nell'app Quadra Desktop per Windows")
}
