package argocd

import (
	"context"
	"errors"
	"net/http"
	"sync"
)

// InstanceInfo is what the browser is allowed to know about an instance:
// never the token.
type InstanceInfo struct {
	Name       string `json:"name"`
	Color      string `json:"color"`
	Production bool   `json:"production"`
	URL        string `json:"url"`
	Reachable  bool   `json:"reachable"`
	TokenValid bool   `json:"tokenValid"`
	Error      string `json:"error,omitempty"`
}

// Instances probes every instance in parallel, in configuration order.
func (r *Registry) Instances(ctx context.Context) []InstanceInfo {
	clients := r.All()
	out := make([]InstanceInfo, len(clients))
	var wg sync.WaitGroup
	for i, c := range clients {
		wg.Add(1)
		go func(i int, c *Client) {
			defer wg.Done()
			inst := c.Instance()
			info := InstanceInfo{
				Name:       inst.Name,
				Color:      inst.Color,
				Production: inst.Production,
				URL:        inst.URL,
			}
			reqCtx, cancel := context.WithTimeout(ctx, instanceTimeout)
			defer cancel()

			var userinfo struct {
				LoggedIn bool `json:"loggedIn"`
			}
			err := c.Get(reqCtx, "session/userinfo", &userinfo)
			switch {
			case err == nil && userinfo.LoggedIn:
				info.Reachable, info.TokenValid = true, true
			case err == nil:
				info.Reachable = true
				info.Error = "the instance token is not accepted"
			default:
				var se *StatusError
				if errors.As(err, &se) {
					// A reply, even a rejecting one, means the server is up.
					info.Reachable = true
					if se.Code == http.StatusUnauthorized || se.Code == http.StatusForbidden {
						info.Error = "the instance token is invalid or revoked"
					} else {
						info.Error = se.Error()
					}
				} else {
					info.Error = err.Error()
				}
			}
			out[i] = info
		}(i, c)
	}
	wg.Wait()
	return out
}
